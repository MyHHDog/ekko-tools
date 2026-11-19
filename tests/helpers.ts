import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {createHarness,lifecycle} from './harness-host';
export {lifecycle};
export async function tempdir(){
  const base=resolve('.cache');await mkdir(base,{recursive:true});return mkdtemp(join(base,'test-'));
}
export async function cleanup(directory:string){
  const absolute=resolve(directory);if(!absolute.startsWith(resolve('.cache')+sep))throw Error('拒绝清理项目外路径');
  await rm(absolute,{recursive:true,force:true,maxRetries:8,retryDelay:100});
}
export async function harness(options:Parameters<typeof createHarness>[1]&{directory?:string}={}){
  const {directory:provided,...runtime}=options;
  const directory=provided||await tempdir(),h=createHarness(directory,runtime);
  return {...h,directory,async close(remove=true){await h.close();if(remove)await cleanup(directory);}};
}
export async function unwrap(h:Awaited<ReturnType<typeof harness>>,name:string,input?:any) {
  const result=await h.call(name,input);if(!result.ok)throw Error(JSON.stringify(result.error));return result.data;
}
export async function addFixtures(h:Awaited<ReturnType<typeof harness>>) {
  const accounts=[];
  for(const provider of ['163','qq','gmail'] as const){
    accounts.push(await unwrap(h,'mail.account.add',{provider,address:`fixture@${provider}.com`,secret:provider==='gmail'?'abcdefghijklmnop':'fixture-auth-code'}));
  }
  return accounts;
}
