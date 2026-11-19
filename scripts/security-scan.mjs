import {readFile,readdir} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {writeChunks} from './write.mjs';
const root=resolve('.'),excluded=new Set(['node_modules','.cache','coverage','.git']);
const runtimeRoots=['dist','contracts','assets','plugin.json','package.json','package-lock.json','README.md','CHANGELOG.md'];
const known=['fixture-only-authorization','fixture-only-passphrase','fixture-authorization-only','fixture_key','private-key-placeholder'];
const forbidden=[
  {name:'private-key-block',pattern:/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g},
  {name:'bearer-token',pattern:/Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi},
  {name:'api-key-shape',pattern:/(?:sk|key|token|secret)[-_][A-Za-z0-9]{24,}/gi},
  {name:'password-assignment',pattern:/["'](?:password|passwd|authCode|accessToken)["']\s*:\s*["'][^"']{8,}["']/gi},
  {name:'local-absolute-path',pattern:/[A-Za-z]:\\(?:Users|Tools|Projects|Downloads|Desktop)\\[^\s"'<>]+/g}
];
const files=[];
async function walk(path){
  const info=await readdir(path,{withFileTypes:true});
  for(const item of info){
    if(excluded.has(item.name))continue;
    const file=join(path,item.name);
    if(item.isDirectory())await walk(file);else files.push(file);
  }
}
for(const entry of runtimeRoots){
  const path=resolve(entry);try{if((await readdir(path).catch(()=>null)))await walk(path);else files.push(path);}catch{}
}
const findings=[],knownFixture=[],dataArtifacts=[];
for(const file of [...new Set(files)]){
  const name=relative(root,file).replace(/\\/g,'/');
  if(/(?:^|\/)(?:vault\.bin|vault\.key)$|\.(?:db|sqlite3?|db-wal|db-shm|key|pem|p12|pfx)$/i.test(name)){
    dataArtifacts.push(name);continue;
  }
  let text;try{text=await readFile(file,'utf8');}catch{continue;}
  for(const value of known)if(text.includes(value))knownFixture.push({file:name,value});
  for(const rule of forbidden)for(const match of text.matchAll(rule.pattern))findings.push({file:name,rule:rule.name,match:match[0].slice(0,80)});
}
const result={date:new Date().toISOString(),scope:'runtime dist/contracts/assets/manifest/package metadata/docs；测试夹具不进入发布包',files:files.length,forbiddenFindings:findings,dataArtifacts,knownFixtureLiterals:knownFixture,exitCode:findings.length||dataArtifacts.length?1:0};
await writeChunks('docs/evidence/security-scan.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));process.exitCode=result.exitCode;
