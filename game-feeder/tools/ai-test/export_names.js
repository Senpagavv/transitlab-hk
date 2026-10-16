'use strict';
const fs=require('node:fs');
const {makeNames}=require('../../v7/ai/client.js');
const base=JSON.parse(fs.readFileSync(process.argv[2]||require('node:path').join(__dirname,'../../v7/hk/hk-base.json'),'utf8'));
process.stdout.write(JSON.stringify(makeNames(base)));
