// Automatic play-tests for the alien demo: no action vs a few strategies (node game/alien/tune.js).
const data = require('../../game-ui/alien/data.js');
const Sim = require('../../game-ui/alien/sim.js');

function play(name, setup, settings) {
  const s = Sim.create(data, settings);
  const plan = setup || (() => {});
  while (!s.done) { plan(s); s.step(); }
  const r = s.summary();
  const jams = s.edges.filter((e) => e.player).map((e) => [e.name, Math.round(s.delay(e))]).filter((x) => x[1] > 5);
  console.log(`${name.padEnd(28)} arrived ${r.arrived.toLocaleString().padStart(9)} / want ${r.want.toLocaleString()}  gave ${r.gave.toLocaleString().padStart(9)}  by ${JSON.stringify(r.by)}  vehH ${r.vehHours} busH ${r.busHours} railQ ${r.railQueue}  jams@end ${JSON.stringify(jams)}`);
  return r;
}
const at = (t, fn) => (s) => { if (s.t === t) fn(s); };
const all = (...fs) => (s) => fs.forEach((f) => f(s));
const lane = (name) => (s) => s.toggleLane(s.edges.find((e) => e.name === name).i);
const pick = (lat, lon, n) => (s) => s.addPickup(lat, lon, n);

const settings = JSON.parse(process.argv[2] || '{}');
play('no action', null, settings);
play('3 pickups NT x100 @0', all(at(0, (s) => { pick(22.383, 114.189, 100)(s); pick(22.392, 113.976, 100)(s); pick(22.307, 114.260, 100)(s); })), settings);
play('3 pickups NT x100 @0 + lanes', all(at(0, (s) => { pick(22.383, 114.189, 100)(s); pick(22.392, 113.976, 100)(s); pick(22.307, 114.260, 100)(s);
  lane('龙翔道')(s); lane('狮子山隧道')(s); lane('将军澳隧道')(s); })), settings);
play('spread 6 x50 @0 + lanes', all(at(0, (s) => {
  pick(22.383, 114.189, 50)(s); pick(22.392, 113.976, 50)(s); pick(22.307, 114.260, 50)(s);
  pick(22.4460, 114.0060, 50)(s); pick(22.3570, 114.1300, 50)(s); pick(22.2850, 114.2150, 50)(s);
  lane('龙翔道')(s); lane('太子道东')(s); lane('观塘道')(s); })), settings);
play('late (t=60) 3x100 + lanes', all(at(60, (s) => { pick(22.383, 114.189, 100)(s); pick(22.392, 113.976, 100)(s); pick(22.307, 114.260, 100)(s);
  lane('龙翔道')(s); lane('狮子山隧道')(s); lane('将军澳隧道')(s); })), settings);
play('final lanes + 6 towns x60', all(at(0, (s) => {
  pick(22.383, 114.189, 60)(s); pick(22.392, 113.976, 60)(s); pick(22.307, 114.260, 60)(s);
  pick(22.4460, 114.0060, 60)(s); pick(22.3570, 114.1300, 60)(s); pick(22.2850, 114.2150, 60)(s);
  lane('龙翔道')(s); lane('太子道东')(s); lane('观塘道')(s); })), settings);
play('final lanes + 4 near x100', all(at(0, (s) => {
  pick(22.383, 114.189, 100)(s); pick(22.3570, 114.1300, 100)(s); pick(22.2850, 114.2150, 100)(s); pick(22.307, 114.260, 100)(s);
  lane('龙翔道')(s); lane('太子道东')(s); lane('观塘道')(s); })), settings);
