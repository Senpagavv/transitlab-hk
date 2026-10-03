/* 外星人降临启德 - the simulation, one game minute per step. Runs in the browser and in Node (game/alien/tune.js).
   Real inputs come from data.js (zones, corridors, normal transit times); everything in P is a game setting.

   People: news spreads from Kai Tak; at home people decide whether to go (give up if the trip looks too long:
   the gravity model's "more resistance, less will to travel") and how (car/taxi, MTR, walk, the player's buses).
   Roads: 13 corridors + connectors, each a point queue: vehicles wanting to enter queue up, at most `capacity`
   enter per minute, then take the free-flow time. A jam stops growing when fewer vehicles come than leave, then
   drains from the front. MTR: one gate at Kai Tak with a fixed capacity. Buses: the player's pickup points;
   buses deploy, load, drive the corridors (bus lanes let them skip the queue), unload, return. */
(function (root) {
  'use strict';

  const P = {
    DURATION: 180,          // game minutes until the aliens leave
    WANT_SHARE: 0.08,       // share of residents who want a gift
    NEWS_KM_PER_MIN: 0.4,   // news spreads outwards from Kai Tak
    DEPART_RATE: 1 / 15,    // share of the people still at home who decide each minute
    GIVEUP_BETA: 0.035,     // will to go = exp(-beta * minutes over what feels OK)
    OK_EXTRA: 15,           // minutes over the normal transit time before people start giving up
    THETA: 0.12,            // mode choice sensitivity (per minute)
    CAR_PENALTY: 8,         // parking and hassle, minutes
    OCC: 1.4,               // people per car / taxi
    BG_FACTOR: 0.85,        // background traffic = normal v/c x this
    RAIL_CAP: 600,          // people per minute through the Kai Tak MTR gate (36,000 an hour)
    WALK_KM: 3, WALK_KMPM: 0.075,
    BUS_CAP: 120, BUS_PCU: 2.5, BUS_DEPLOY: 10, BUS_DWELL: 3, FLEET: 400,
    LANES_MAX: 3, LANE_SETUP: 10, LANE_BUS_PER_MIN: 4,
    PICKUP_KM: 2, LOCAL_KMPM: 25 / 60,
  };

  function km(a, b) {
    return Math.hypot((b.lat - a.lat) * 110.57, (b.lon - a.lon) * 111.32 * Math.cos(22.35 * Math.PI / 180));
  }

  function create(data, settings) {
    const p = Object.assign({}, P, settings || {});
    const nodes = data.nodes, nodeIds = Object.keys(nodes);
    const kt = { lat: data.kt[0], lon: data.kt[1] };
    const edges = data.edges.map((e, i) => {
      const bg = Math.min(0.85, e.vc * p.BG_FACTOR);
      return Object.assign({}, e, { i, avail: e.cap * (1 - bg) / 60, queue: [], busQueue: [], transit: [],
        lane: null, inflow: 0, outflow: 0, flowHist: [] });
    });
    const out = {}; nodeIds.forEach((n) => { out[n] = []; });
    edges.forEach((e) => out[e.from].push(e.i));
    const zones = data.zones.map((z) => {
      const want = z.pop * p.WANT_SHARE;
      return Object.assign({}, z, { want, home: want, gave: 0, dep: { car: 0, rail: 0, walk: 0, bus: 0 }, arr: 0,
        newsAt: km(z, kt) / p.NEWS_KM_PER_MIN, best: null });
    });

    const S = { p, t: 0, edges, zones, nodes, kt, pickups: [], lanesUsed: 0, railQueue: 0, railComing: 0, railHist: [],
      arrived: 0, arrivedBy: { car: 0, rail: 0, walk: 0, bus: 0 }, gave: 0, wantTotal: zones.reduce((a, z) => a + z.want, 0),
      vehMin: 0, busMin: 0, history: [], alerts: [], pending: {}, done: false, alerted: {} };

    // ---------- route times: reverse Dijkstra from Kai Tak on the small graph ----------
    function laneOn(e) { return e.lane && e.lane.readyAt <= S.t; }
    function capNow(e) { return laneOn(e) ? e.avail * (e.lanes - 1) / e.lanes : e.avail; }
    function queueVeh(e) { return e.queue.reduce((a, k) => a + k.veh * (k.mode === 'bus' ? p.BUS_PCU : 1), 0); }
    function delay(e, bus) {
      if (bus && laneOn(e)) return e.busQueue.length / p.LANE_BUS_PER_MIN;
      return queueVeh(e) / Math.max(capNow(e), 1e-6);
    }
    function routes(bus) {
      const dist = {}, next = {};
      nodeIds.forEach((n) => { dist[n] = Infinity; });
      dist.KT = 0;
      const done = new Set();
      for (;;) {
        let u = null;
        for (const n of nodeIds) if (!done.has(n) && dist[n] < Infinity && (u === null || dist[n] < dist[u])) u = n;
        if (u === null) break;
        done.add(u);
        for (const e of edges) if (e.to === u) {
          const d = dist[u] + e.free_min + delay(e, bus);
          if (d < dist[e.from]) { dist[e.from] = d; next[e.from] = e.i; }
        }
      }
      return { dist, next };
    }
    function pathFrom(node, r) {
      const path = []; let n = node, guard = 0;
      while (n !== 'KT' && r.next[n] !== undefined && guard++ < 30) { path.push(r.next[n]); n = edges[r.next[n]].to; }
      return path;
    }
    S.routes = { car: routes(false), bus: routes(true) };

    // ---------- pending arrivals at a place, by minute ----------
    function later(min, kind, item) {
      const k = Math.max(Math.ceil(min), S.t + 1);   // never the current minute: it may already be processed
      (S.pending[k] = S.pending[k] || []).push(Object.assign({ kind }, item));
    }

    // ---------- buses ----------
    function pickupAccess(pk) { return km(pk, nodes[pk.node]) * 1.3 / p.LOCAL_KMPM; }
    function cycleEstimate(pk) {
      const ride = pickupAccess(pk) + S.routes.bus.dist[pk.node];
      return 2 * ride + 2 * p.BUS_DWELL;
    }
    function busWait(pk) {
      const active = pk.buses.filter((b) => b.state !== 'deploy').length;
      const deployLeft = Math.max(0, pk.deployAt - S.t);
      if (!pk.buses.length) return Infinity;
      const seatsPerMin = Math.max(pk.buses.length, 1) * p.BUS_CAP / Math.max(cycleEstimate(pk), 5);
      return (active ? 0 : deployLeft) + pk.queue / seatsPerMin + 2;
    }
    function busFleetUsed() { return S.pickups.reduce((a, k) => a + k.buses.length, 0); }

    function nearestZone(lat, lon) {
      let best = null, bd = Infinity;
      for (const z of zones) { const d = km(z, { lat, lon }); if (d < bd) { bd = d; best = z; } }
      return best;
    }
    function addPickup(lat, lon, n) {
      const z = nearestZone(lat, lon);
      n = Math.max(0, Math.min(n, p.FLEET - busFleetUsed()));
      const pk = { id: 'P' + (S.pickups.length + 1) + '-' + Math.round(S.t), lat, lon, node: z.node, area: z.label, queue: 0,
        deployAt: S.t + p.BUS_DEPLOY, buses: [], served: 0, covered: [] };
      zones.forEach((zz) => { const d = km(zz, pk); if (d <= p.PICKUP_KM) pk.covered.push({ z: zz, walk: d * 1.25 / p.WALK_KMPM }); });
      setBuses(pk, n);
      S.pickups.push(pk);
      return pk;
    }
    function setBuses(pk, n) {
      n = Math.max(0, Math.min(n, p.FLEET - busFleetUsed() + pk.buses.length));
      while (pk.buses.length < n) pk.buses.push({ state: 'deploy', until: S.t + p.BUS_DEPLOY, load: 0 });
      while (pk.buses.length > n) {
        const k = pk.buses.findIndex((b) => b.state !== 'run');
        if (k < 0) break;
        pk.buses.splice(k, 1);
      }
    }
    function removePickup(id) {
      const k = S.pickups.findIndex((x) => x.id === id);
      if (k >= 0) { S.pickups[k].buses = S.pickups[k].buses.filter((b) => b.state === 'run'); S.pickups[k].closed = true; }
    }
    function toggleLane(i) {
      const e = edges[i];
      if (!e.player) return false;
      if (e.lane) { e.lane = null; S.lanesUsed--; return true; }
      if (S.lanesUsed >= p.LANES_MAX) return false;
      e.lane = { readyAt: S.t + p.LANE_SETUP }; S.lanesUsed++;
      return true;
    }
    function previewPickup(lat, lon, n) {
      const z = nearestZone(lat, lon);
      const fake = { lat, lon, node: z.node, buses: new Array(n).fill({ state: 'board' }), queue: 0, deployAt: S.t + p.BUS_DEPLOY };
      let atHome = 0;
      zones.forEach((zz) => { if (km(zz, fake) <= p.PICKUP_KM && zz.newsAt <= S.t + 60) atHome += zz.home; });
      const cyc = cycleEstimate(fake);
      return { area: z.label, node: nodes[z.node].name, atHome: Math.round(atHome), cycle: Math.round(cyc),
        perHour: Math.round(n * p.BUS_CAP * 60 / Math.max(cyc, 5)), ride: Math.round(pickupAccess(fake) + S.routes.bus.dist[z.node]) };
    }

    // ---------- one game minute ----------
    function step() {
      if (S.done) return;
      const t = S.t;
      S.alerts = [];
      S.routes = { car: routes(false), bus: routes(true) };
      const railWait = (S.railQueue + S.railComing) / p.RAIL_CAP;   // people can see how crowded the MTR is
      const left = p.DURATION - t;
      const carIn = {};

      // 1. decisions at home
      for (const z of zones) {
        if (z.newsAt > t || z.home < 0.5) { z.best = null; continue; }
        const cand = z.home * p.DEPART_RATE;
        z.home -= cand;
        const opt = {};
        opt.car = z.access + S.routes.car.dist[z.node] + p.CAR_PENALTY;
        opt.rail = z.pt + railWait;
        if (z.kt_km <= p.WALK_KM) opt.walk = z.kt_km * 1.25 / p.WALK_KMPM;
        let bestPk = null;
        for (const pk of S.pickups) {
          if (pk.closed || !pk.buses.length) continue;
          const c = pk.covered.find((x) => x.z === z);
          if (!c) continue;
          const tb = c.walk + busWait(pk) + pickupAccess(pk) + S.routes.bus.dist[pk.node];
          if (opt.bus === undefined || tb < opt.bus) { opt.bus = tb; bestPk = { pk, walk: c.walk }; }
        }
        let tBest = Infinity;
        for (const m in opt) tBest = Math.min(tBest, opt[m]);
        z.best = tBest; z.opt = opt;
        let go = tBest > left ? 0 : Math.exp(-p.GIVEUP_BETA * Math.max(0, tBest - (z.pt + p.OK_EXTRA)));
        const goers = cand * go;
        z.gave += cand - goers; S.gave += cand - goers;
        let wsum = 0; const w = {};
        for (const m in opt) { w[m] = Math.exp(-p.THETA * (opt[m] - tBest)); wsum += w[m]; }
        for (const m in opt) {
          const n = goers * w[m] / wsum;
          if (n <= 0) continue;
          z.dep[m] += n;
          if (m === 'car') { const k = Math.round(t + z.access); carIn[k + '|' + z.node] = (carIn[k + '|' + z.node] || 0) + n; }
          else if (m === 'rail') { S.railComing += n; later(t + Math.max(z.pt - 3, 1), 'rail', { people: n, z }); }
          else if (m === 'walk') later(t + opt.walk, 'arrive', { people: n, mode: 'walk', z });
          else if (m === 'bus') later(t + bestPk.walk, 'pickup', { people: n, pk: bestPk.pk });
        }
      }
      for (const key in carIn) {
        const [k, node] = key.split('|');
        later(Number(k), 'car', { people: carIn[key], node });
      }

      // 2. things arriving this minute
      for (const item of (S.pending[t] || [])) {
        if (item.kind === 'rail') { S.railQueue += item.people; S.railComing -= item.people; }
        else if (item.kind === 'arrive') arrive(item.people, item.mode, item.z);
        else if (item.kind === 'pickup') item.pk.queue += item.people;
        else if (item.kind === 'car') inject({ mode: 'car', veh: item.people / p.OCC, people: item.people, origin: item.node }, item.node);
        else if (item.kind === 'bus') inject(item.pkt, item.pkt.origin);
        else if (item.kind === 'busfree') { item.bus.state = 'board'; item.bus.load = 0; }
      }
      delete S.pending[t];

      // 3. buses at pickups
      for (const pk of S.pickups) {
        for (const b of pk.buses) {
          if (b.state === 'deploy' && b.until <= t) b.state = 'board';
          if (b.state === 'board') {
            const take = Math.min(p.BUS_CAP - b.load, pk.queue);
            b.load += take; pk.queue -= take;
            b.waited = (b.waited || 0) + 1;
            if (b.load >= p.BUS_CAP || (b.load >= 20 && b.waited >= 4) || (b.load > 0 && b.waited >= 8)) {
              b.state = 'run'; b.waited = 0;
              later(t + pickupAccess(pk), 'bus', { pkt: { mode: 'bus', veh: 1, people: b.load, origin: pk.node, bus: b, pk } });
            }
          }
        }
      }

      // 4. roads: exits first, then admissions
      for (const e of edges) {
        e.outflow = 0;
        const still = [];
        for (const k of e.transit) {
          if (k.exitAt <= t) { e.outflow += k.veh; advance(k); } else still.push(k);
        }
        e.transit = still;
      }
      for (const e of edges) {
        let cap = capNow(e);
        e.inflow = 0;
        while (e.queue.length && cap > 1e-6) {
          const k = e.queue[0];
          const pcu = k.mode === 'bus' ? p.BUS_PCU : 1;
          const need = k.veh * pcu;
          if (need <= cap) { e.queue.shift(); cap -= need; enter(e, k); }
          else {
            const frac = cap / need;
            const part = Object.assign({}, k, { veh: k.veh * frac, people: k.people * frac });
            k.veh -= part.veh; k.people -= part.people;
            cap = 0; enter(e, part);
          }
        }
        if (laneOn(e)) {
          let bc = p.LANE_BUS_PER_MIN;
          while (e.busQueue.length && bc >= 1) { enter(e, e.busQueue.shift()); bc -= 1; }
        }
        const d = delay(e, false);
        e.flowHist.push(e.inflow);
        if (e.flowHist.length > 60) e.flowHist.shift();
        if (e.player && d >= 20 && !S.alerted[e.i]) { S.alerted[e.i] = true; S.alerts.push({ type: 'jam', edge: e.i, text: `${e.name} 堵了 ${Math.round(d)} 分钟！` }); }
        if (d < 10) S.alerted[e.i] = false;
      }

      // 5. MTR gate
      const served = Math.min(S.railQueue, p.RAIL_CAP);
      S.railQueue -= served;
      if (served > 0) arrive(served, 'rail', null);

      // 6. book-keeping
      let veh = 0;
      for (const e of edges) { for (const k of e.queue) veh += k.veh; for (const k of e.transit) veh += k.veh; veh += e.busQueue.length; }
      S.vehMin += veh;
      S.busMin += busFleetUsed();
      S.history.push({ t, arrived: S.arrived, gave: S.gave, veh, rail: S.railQueue });
      const recentGave = S.history.length > 5 ? S.gave - S.history[S.history.length - 6].gave : 0;
      if (recentGave > 6000 && !S.alerted.gave) { S.alerted.gave = true; S.alerts.push({ type: 'gave', text: `最近 5 分钟有 ${Math.round(recentGave / 1000)} 千人放弃了！` }); }
      if (recentGave < 2000) S.alerted.gave = false;
      S.t++;
      if (S.t >= p.DURATION) S.done = true;
    }

    function inject(k, node) {
      const r = k.mode === 'bus' ? S.routes.bus : S.routes.car;
      k.path = pathFrom(node, r); k.at = 0;
      if (!k.path.length) { reach(k); return; }
      queueOn(edges[k.path[0]], k);
    }
    function queueOn(e, k) {
      if (k.mode === 'bus' && laneOn(e)) e.busQueue.push(k); else e.queue.push(k);
    }
    function enter(e, k) {
      e.inflow += k.veh;
      k.enterAt = S.t; k.exitAt = S.t + e.free_min; k.edge = e.i;
      e.transit.push(k);
    }
    function advance(k) {
      k.at++;
      if (k.at >= k.path.length) { reach(k); return; }
      queueOn(edges[k.path[k.at]], k);
    }
    function reach(k) {
      arrive(k.people, k.mode, null);
      if (k.mode === 'bus') {
        k.pk.served += k.people;
        const back = 2 * p.BUS_DWELL + k.path.reduce((a, i) => a + edges[i].free_min, 0) + pickupAccess(k.pk);
        k.bus.state = 'back'; k.bus.load = 0;
        later(S.t + back, 'busfree', { bus: k.bus });
      }
    }
    function arrive(n, mode, z) {
      if (S.t > p.DURATION) return;
      S.arrived += n; S.arrivedBy[mode] += n;
      if (z) z.arr += n;
    }

    function summary() {
      return { arrived: Math.round(S.arrived), gave: Math.round(S.gave), want: Math.round(S.wantTotal),
        by: Object.fromEntries(Object.entries(S.arrivedBy).map(([k, v]) => [k, Math.round(v)])),
        vehHours: Math.round(S.vehMin / 60), busHours: Math.round(S.busMin / 60), railQueue: Math.round(S.railQueue) };
    }

    Object.assign(S, { step, addPickup, setBuses, removePickup, toggleLane, previewPickup, summary, delay, capNow, laneOn,
      queueVeh, busFleetUsed, km, pathFrom });
    return S;
  }

  const api = { create, P, km };
  root.AlienSim = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : this);
