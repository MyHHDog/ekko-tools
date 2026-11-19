import {spawn} from 'node:child_process';
import {writeChunks} from './write.mjs';
const date=new Date().toISOString();
const child=process.platform==='win32'?spawn('cmd.exe',['/d','/s','/c','npm.cmd test'],{windowsHide:true,env:{...process.env,NODE_ENV:'development'}}):
  spawn('npm',['test'],{env:{...process.env,NODE_ENV:'development'}});
let log='';child.stdout.on('data',d=>{log+=d;process.stdout.write(d);});child.stderr.on('data',d=>{log+=d;process.stderr.write(d);});
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
await writeChunks('docs/evidence/test-final.log',log);
const summary={date,command:'npm.cmd test',reason:'0.7.0 DeepL、连接测试与缓存管理回归',exitCode:code,log:'docs/evidence/test-final.log'};
await writeChunks('docs/evidence/test-final-result.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary));process.exitCode=code;
