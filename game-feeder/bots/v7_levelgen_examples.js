'use strict';
// Offline examples for the task-59 handover. No AI/backend/network calls.
// node bots/v7_levelgen_examples.js <2|3|4> [seconds=15] [output.json]
const fs=require('node:fs'),path=require('node:path');
const generator=require('../v7/shared/levelgen/generate.js'),cutter=require('../v7/shared/levelgen/cut.js');
const base=require('../v7/hk/hk-base.json'),demand=require('../v7/hk/hk-demand-am.json');
const mode=Number(process.argv[2]),seconds=Number(process.argv[3]||15),file=process.argv[4];
if(![2,3,4].includes(mode)||!Number.isFinite(seconds)||seconds<=0||seconds>20)throw Error('mode 2|3|4, seconds (0,20]');
const engine=require('../v7/'+({2:'mode2-metro',3:'mode3-roads',4:'mode4-tod'}[mode])+'/engine.js');
const client=require('../v7/ai/client.js'),change=(place,what,pct,by_year)=>({place,what,pct,...(by_year?{by_year}:{})});
const request=(area,changes=[])=>({area,mode,period:'am',changes,title:area+' · '+mode,story:['Offline teaching example; not a forecast.']});
let requests;
if(mode===2)requests=[request('tung-chung'),request('tseung-kwan-o',[change('康城站一帶','jobs',30)]),request('sha-tin-tai-wai',[change('第一城站一帶','people',30,4)])];
if(mode===4)requests=[client.pickExample('东涌东卖地建新屋苑'),client.pickExample('洪水桥物业开发'),request('kowloon-east',[change('啟德','people',50,4)])];
if(mode===3)requests=[request('kowloon-east',[change('觀塘道','road_cap',-40)]),...['sha-tin-tai-wai','tsuen-wan-kwai-tsing'].map(area=>{const raw=cutter.cut(base,demand,request(area));return request(area,[change(raw.level.origins[0].name,'people',30)]);})];
const results=requests.map(req=>{const start=Date.now(),result=generator.evaluate(base,demand,req,engine,seconds);result.elapsedSeconds=(Date.now()-start)/1000;console.log(mode,req.area,result.report?.best,result.problems.map(p=>p.code).join(',')||'ok');return result;});
if(file){fs.mkdirSync(path.dirname(path.resolve(file)),{recursive:true});fs.writeFileSync(file,JSON.stringify({mode,seconds,results},null,2));}
else console.log(JSON.stringify({mode,seconds,results},null,2));
