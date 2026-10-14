// Levels as files (v7/levels/README.md). Two commands:
//   node game-feeder/tools/levels/levels.js export <mode 1-4> <key> [out.json]   a level written in a mode's data.js →
//        a «tl-level/1» file to start from (copy it, change it, give it a new key)
//   node game-feeder/tools/levels/levels.js check <file.json>                    the same checks as the build, then the
//        level is loaded into its mode's engine and run with nothing built — errors show up here, not in the page
'use strict';
const fs=require('node:fs'),path=require('node:path');
const V7=path.join(__dirname,'../../v7'),DIR={1:'mode1-bus',2:'mode2-metro',3:'mode3-roads',4:'mode4-tod'};
const NEEDS={1:['cols','rows'],2:['cols','rows','origins','destinations','tiers'],3:['cols','rows','origins','destinations','roads','tiers'],4:['cols','rows','origins','destinations','land','tiers']};
const builtin=JSON.parse(fs.readFileSync(path.join(V7,'levels/builtin.json'),'utf8')).levels;
const load=mode=>{const d=path.join(V7,DIR[mode]);return{D:require(path.join(d,'data.js')),M:require(path.join(d,'engine.js'))};};
function problems(e){const out=[];
  if(e.format!=='tl-level/1')out.push('format must be "tl-level/1"');
  if(!NEEDS[e.mode])return out.concat('mode must be 1, 2, 3 or 4');
  if(!/^[a-z0-9][a-z0-9-]*$/.test(String(e.key||'')))out.push('key: lower-case letters, digits and «-»');
  if(!e.title)out.push('title is missing');
  if(!e.level||typeof e.level!=='object')return out.concat('level is missing');
  for(const f of NEEDS[e.mode])if(!(f in e.level))out.push('level.'+f+' is missing');
  const t=e.level.tiers;if(t&&!(Array.isArray(t)&&t.length===3&&t[0]<=t[1]&&t[1]<=t[2]))out.push('level.tiers must be [pass, high, master], rising');
  return out;}
// run the level with nothing built: what a player starts from
function dryRun(e){const{D,M}=load(e.mode);D.use(JSON.parse(JSON.stringify(e.level)),e.key);if(M.reset)M.reset();
  const lv=e.level,people=(lv.origins||[]).reduce((s,o)=>s+(o.people||0),0);
  const out={cols:lv.cols,rows:lv.rows,origins:(lv.origins||[]).length,destinations:(lv.destinations||[]).length,people};
  if(e.mode===3){out.roads=M.G.sections.length+' sections';out.doNothingJam=M.G.doNothing.map(Math.round);
    const worst=M.G.base.extra.map((x,id)=>({x,road:M.G.sections[id].roads[0]})).sort((a,b)=>b.x-a.x).slice(0,3);out.worstRoads=worst.map(w=>w.road+' +'+w.x.toFixed(1));}
  if(e.mode===4)out.land=(lv.land||[]).length+' lots';
  if(e.mode===2||e.mode===4){const p=new M.Plan();out.budget=p.money;}
  if(e.mode===1)out.estates=(lv.estates||lv.origins||[]).length;
  return out;}
const [cmd,a,b,c]=process.argv.slice(2);
if(cmd==='export'){const mode=+a,{D}=load(mode),lv=D.example(b);
  if(!lv){console.error('no level '+b+' in mode '+mode);process.exit(1);}
  const meta=builtin.find(x=>x.mode===mode&&x.key===b)||{};
  const e={format:'tl-level/1',mode,key:b,order:meta.order||9,challenge:!!meta.challenge,title:meta.title||lv.title||b,story:[],hub:meta.hub||{},author:'',source:'',level:lv};
  const out=c||path.join(V7,'levels','m'+mode,b+'.json');fs.writeFileSync(out,JSON.stringify(e,null,1));console.log('written '+out);}
else if(cmd==='check'){const e=JSON.parse(fs.readFileSync(a,'utf8')),bad=problems(e);
  if(bad.length){console.log('✗ '+bad.join('\n✗ '));process.exit(1);}
  try{console.log('✓ format\n'+JSON.stringify(dryRun(e),null,1));}catch(err){console.log('✗ the engine could not run it: '+err.message);process.exit(1);}
  const t=e.level.tiers;if(t)console.log('tiers '+t.join(' / ')+' — set them from a bot run (see levels/README.md)');}
else{console.log('usage: levels.js export <mode> <key> [out.json] | check <file.json>');process.exit(1);}
