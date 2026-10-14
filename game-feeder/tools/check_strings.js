// Every text key a v7 page uses must be defined (else the page shows the key itself, e.g. «r3.hlToday»).
//   node game-feeder/tools/check_strings.js        → lists the missing keys per mode; exit 1 if any
// Keys used: t('…') / I.t('…') in the mode's ui.js and shared scripts, data-i18n* in its index.html. Keys defined:
// I18N.add({…}) in shared/i18n.js, shared/nav.js, shared/save.js and the mode's strings.js. Keys built at run time
// (t('r.t'+tier), 'nav.m'+n …) cannot be seen here; they are listed by prefix in DYNAMIC and skipped.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const V7=path.join(__dirname,'../v7');
const DYNAMIC=[/\.$/,/^sep$/,/^close$/,/^r\.t$/,/^nav\.m$/,/^hub\.tier$/,/^hub\.m$/,/^g\.l$/,/^tip\./,/^i\.r$/];
const read=f=>fs.existsSync(f)?fs.readFileSync(f,'utf8'):'';
const defined=src=>new Set([...src.matchAll(/'([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)'\s*:\s*L\(/g)].map(m=>m[1]));
const used=(js,html)=>new Set([...[...js.matchAll(/\bt\('([A-Za-z0-9_.]+)'/g)].map(m=>m[1]),...[...html.matchAll(/data-i18n(?:-html|-title|-aria)?="([A-Za-z0-9_.]+)"/g)].map(m=>m[1])]);
const shared=['shared/i18n.js','shared/nav.js','shared/save.js'].map(f=>read(path.join(V7,f))).join('\n');
let bad=0;
for(const m of ['mode1-bus','mode2-metro','mode3-roads','mode4-tod']){
  const d=defined(shared+read(path.join(V7,m,'strings.js')));
  const u=used(read(path.join(V7,m,'ui.js'))+read(path.join(V7,m,'demo.js')),read(path.join(V7,m,'index.html')));
  for(const k of defined(read(path.join(V7,m,'demo.js'))))d.add(k);
  const miss=[...u].filter(k=>!d.has(k)&&!DYNAMIC.some(r=>r.test(k))).sort();
  bad+=miss.length;console.log(m+': '+(miss.length?miss.length+' missing → '+miss.join(' '):'all defined'));}
process.exit(bad?1:0);
