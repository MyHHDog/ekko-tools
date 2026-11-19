import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {writeChunks} from './write.mjs';
const require=createRequire(import.meta.url);
try{
  const baseline=await readFile('../design/design-tokens.css','utf8');
  if(baseline!==await readFile('src/client/styles/design-tokens.css','utf8'))throw Error('上游 token 快照不一致');
}catch(error){
  if(error?.code!=='ENOENT')throw error;
}
const common={bundle:true,format:'esm',minify:true,write:false,legalComments:'none',target:'es2022'};
async function output(entry,file,platform,extra={}){
  const result=await build({...common,entryPoints:[entry],platform,...extra});
  await writeChunks(file,result.outputFiles[0].text);
}
await output('src/client/main.tsx','dist/client.mjs','browser',{loader:{'.css':'text','.jpg':'dataurl'},define:{'process.env.NODE_ENV':'"production"'}});
await output('src/server/index.ts','dist/server.mjs','node',{banner:{js:"import { createRequire as __createRequire } from 'node:module';const require=__createRequire(import.meta.url);"}});
console.log('构建完成：server/client 自包含 ESM。');
