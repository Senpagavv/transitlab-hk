'use strict';
// No extraction and no archive-supplied code. Both ZIP and folder paths are data.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {TextDecoder}=require('node:util');
const MAX_FILE=2*1024*1024,MAX_TOTAL=64*1024*1024,MAX_ENTRIES=512;
const utf8=new TextDecoder('utf-8',{fatal:true});
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(b){let n=0xffffffff;for(const c of b)n=table[(n^c)&255]^(n>>>8);return(n^0xffffffff)>>>0;}
function safeName(s){
  if(!s||s.includes('\0')||/[\x00-\x1f]/.test(s)||/^[\\/]/.test(s)||s.includes(':'))return false;
  return !s.replace(/\\/g,'/').split('/').some(x=>x==='..'||x==='.');
}
function parseJSON(b){return JSON.parse(utf8.decode(b).replace(/^\uFEFF/,''));}
function readZip(file){
  if(fs.statSync(file).size>MAX_TOTAL)throw Error('ZIP 超过 64 MiB 容器上限');
  const b=fs.readFileSync(file),rows=[];let end=-1;
  for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--){
    if(b.readUInt32LE(i)===0x06054b50&&i+22+b.readUInt16LE(i+20)===b.length){end=i;break;}
  }
  if(end<0)throw Error('ZIP 缺少完整目录尾');
  const count=b.readUInt16LE(end+10),size=b.readUInt32LE(end+12),start=b.readUInt32LE(end+16);
  if(b.readUInt16LE(end+4)||b.readUInt16LE(end+6)||b.readUInt16LE(end+8)!==count)throw Error('不接受分卷 ZIP');
  if(count===65535||size===0xffffffff||start===0xffffffff)throw Error('不接受 ZIP64');
  if(count>MAX_ENTRIES||start+size!==end)throw Error('ZIP 目录越界或超过 512 项');
  let p=start,total=0;const used=new Set(),ranges=[];
  for(let n=0;n<count;n++){
    if(p+46>end||b.readUInt32LE(p)!==0x02014b50)throw Error('ZIP 目录损坏');
    const flags=b.readUInt16LE(p+8),method=b.readUInt16LE(p+10),crc=b.readUInt32LE(p+16),packed=b.readUInt32LE(p+20),plain=b.readUInt32LE(p+24);
    const nl=b.readUInt16LE(p+28),el=b.readUInt16LE(p+30),cl=b.readUInt16LE(p+32),disk=b.readUInt16LE(p+34),attrs=b.readUInt32LE(p+38),offset=b.readUInt32LE(p+42);
    if(p+46+nl+el+cl>end)throw Error('ZIP 文件名越界');
    const nameBytes=b.subarray(p+46,p+46+nl);let name;
    try{if(!(flags&0x800)&&nameBytes.some(x=>x>127))throw Error();name=utf8.decode(nameBytes);}catch{name='[无法解码的文件名 '+n+']';}
    const row={file:name,issues:[]};rows.push(row);p+=46+nl+el+cl;
    try{
      if(name.startsWith('[无法解码'))throw Error('文件名必须是 UTF-8 或 ASCII');
      if(!safeName(name))throw Error('拒绝路径穿越、绝对路径或不安全文件名');
      const norm=name.replace(/\\/g,'/').toLowerCase();
      if(used.has(norm))throw Error('ZIP 同名条目重复');used.add(norm);
      const unixType=(attrs>>>16)&0xf000;
      if(unixType&&unixType!==0x8000&&unixType!==0x4000)throw Error('拒绝符号链接或特殊文件');
      if(name.endsWith('/')||name.endsWith('\\')){row.directory=true;if(plain||packed)throw Error('目录条目含数据');continue;}
      if(path.posix.extname(norm)!=='.json')throw Error('拒绝非 JSON 文件');
      if(flags&0x41||disk)throw Error('拒绝加密或分卷条目');
      if(method!==0&&method!==8)throw Error('仅接受 stored/deflate ZIP');
      if(plain>MAX_FILE)throw Error('文件超过 2 MiB');
      total+=plain;if(total>MAX_TOTAL)throw Error('展开数据超过 64 MiB');
      if(offset+30>start||b.readUInt32LE(offset)!==0x04034b50)throw Error('ZIP 本地头损坏');
      const ln=b.readUInt16LE(offset+26),le=b.readUInt16LE(offset+28),dataAt=offset+30+ln+le,finish=dataAt+packed;
      if(finish>start||b.readUInt16LE(offset+6)!==flags||b.readUInt16LE(offset+8)!==method||!b.subarray(offset+30,offset+30+ln).equals(nameBytes))throw Error('ZIP 本地头与目录不一致');
      if(!(flags&8)&&(b.readUInt32LE(offset+14)!==crc||b.readUInt32LE(offset+18)!==packed||b.readUInt32LE(offset+22)!==plain))throw Error('ZIP 本地大小或 CRC 不一致');
      if(ranges.some(([a,z])=>offset<z&&finish>a))throw Error('ZIP 条目区间重叠');ranges.push([offset,finish]);
      const raw=b.subarray(dataAt,finish),data=method===0?raw:zlib.inflateRawSync(raw,{maxOutputLength:MAX_FILE+1});
      if(data.length>MAX_FILE||data.length!==plain||crc32(data)!==crc)throw Error('ZIP 展开大小或 CRC 不符');
      row.entry=parseJSON(data);
    }catch(e){row.issues.push(e.message);row.rejected=true;}
  }
  if(p!==end)throw Error('ZIP 目录长度不符');
  return rows.filter(r=>!r.directory||r.rejected);
}
function readFolder(root){
  const rows=[];let count=0,total=0;
  function visit(dir,depth){
    if(depth>16){rows.push({file:path.relative(root,dir),rejected:true,issues:['目录超过 16 层']});return;}
    for(const de of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
      if(++count>MAX_ENTRIES)throw Error('目录超过 512 项');
      const full=path.join(dir,de.name),row={file:path.relative(root,full).replace(/\\/g,'/'),issues:[]};
      try{
        const st=fs.lstatSync(full);
        if(st.isSymbolicLink())throw Error('拒绝符号链接 / junction');
        if(!safeName(row.file))throw Error('不安全文件名');
        if(st.isDirectory()){visit(full,depth+1);continue;}
        if(!st.isFile())throw Error('拒绝特殊文件');
        if(path.extname(de.name).toLowerCase()!=='.json')throw Error('拒绝非 JSON 文件');
        if(st.size>MAX_FILE)throw Error('文件超过 2 MiB');
        total+=st.size;if(total>MAX_TOTAL)throw Error('输入超过 64 MiB');
        const data=fs.readFileSync(full);if(data.length>MAX_FILE)throw Error('文件超过 2 MiB');
        row.entry=parseJSON(data);
      }catch(e){row.rejected=true;row.issues.push(e.message);}
      rows.push(row);
    }
  }
  visit(root,0);return rows;
}
function readInput(input){
  const st=fs.lstatSync(input);if(st.isSymbolicLink())throw Error('输入不能是符号链接');
  if(st.isDirectory())return readFolder(input);
  if(!st.isFile()||path.extname(input).toLowerCase()!=='.zip')throw Error('输入必须是 ZIP 或文件夹');
  return readZip(input);
}
module.exports={readInput,readZip,safeName,parseJSON,crc32,MAX_FILE};
