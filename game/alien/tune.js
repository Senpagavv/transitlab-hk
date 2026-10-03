// Automatic play-tests for the alien demo (node game/alien/tune.js): bus lanes only.
const data = require('../../game-ui/alien/data.js');
const Sim = require('../../game-ui/alien/sim.js');
const idx = (name) => data.edges.findIndex((e) => e.name === name);
function play(name, lanes, t = 0) {
  const s = Sim.replay(data, lanes.map((n) => ({ t, type: 'lane', edge: idx(n) })), 999);
  const r = s.summary();
  const jams = s.edges.filter((e) => e.player).map((e) => [e.name, Math.round(Math.max(...e.delayLog))]).filter((x) => x[1] > 10).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`${name.padEnd(30)} arrived ${r.arrived.toLocaleString().padStart(8)} gave ${r.gave.toLocaleString().padStart(8)} by ${JSON.stringify(r.by)} vehH ${r.vehHours}  worst ${JSON.stringify(jams)}`);
}
play('no action', []);
play('final 4 lanes', ['龙翔道', '太子道东', '观塘道', '亚皆老街']);
play('final 2 + tunnels 2', ['龙翔道', '太子道东', '狮子山隧道', '红磡海底隧道']);
play('tunnels only', ['狮子山隧道', '大老山隧道', '红磡海底隧道', '东区海底隧道']);
play('final 4 lanes late (t=60)', ['龙翔道', '太子道东', '观塘道', '亚皆老街'], 60);
play('one lane 龙翔道', ['龙翔道']);
play('one lane 太子道东', ['太子道东']);
