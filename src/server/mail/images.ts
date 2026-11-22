import {lookup} from 'node:dns/promises';
import type {LookupAddress} from 'node:dns';
import {isIP} from 'node:net';
import type {LookupFunction} from 'node:net';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import sanitize from 'sanitize-html';
import {AppError,assert} from '../../shared/error-codes';
import type {Lifecycle} from '../adapter/host';
import {bounded} from '../retry';
const MAX_IMAGE_BYTES=383_000;
export function publicAddress(address:string) {
  if(isIP(address)===4){
    const [a,b]=address.split('.').map(Number);
    return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19));
  }
  // 仅允许全球单播IPv6，拒绝映射IPv4、回环、链路/站点本地和组播。
  return isIP(address)===6&&/^[23]/i.test(address)&&!address.includes('.');
}
export function remoteImages(html:string){
  const urls:string[]=[];
  sanitize(html,{allowedTags:['img'],allowedAttributes:{img:['src']},transformTags:{img:(tag,attrs)=>{
    if(/^https?:\/\//i.test(attrs.src||''))urls.push(attrs.src);return {tagName:tag,attribs:attrs};
  }}});
  return [...new Set(urls)].slice(0,24);
}
export function createPinnedLookup(results:LookupAddress[]):LookupFunction{
  return (_hostname,options,callback)=>{
    // Node 22 的 HTTPS 连接可能以 all:true 调用 lookup，必须按数组形式回调。
    if(options.all){
      callback(null,results);
      return;
    }
    const first=results[0];
    callback(null,first.address,first.family);
  };
}
export async function image(urlString:string,signal:AbortSignal,lifecycle:Lifecycle,allowedDomains:readonly string[]=[],upgradeHttp=true):Promise<string>{
  return bounded(s=>load(urlString,s,lifecycle,allowedDomains,upgradeHttp,0),signal,lifecycle,10000);
}
function imageUrl(value:string,upgradeHttp:boolean){
  const url=new URL(value);
  if(url.protocol==='http:'&&upgradeHttp){url.protocol='https:';if(url.port==='80')url.port='';}
  const port=url.protocol==='http:'?(!url.port||url.port==='80'):url.protocol==='https:'?(!url.port||url.port==='443'):false;
  assert((url.protocol==='http:'||url.protocol==='https:')&&!url.username&&!url.password&&port);
  return url;
}
async function load(urlString:string,signal:AbortSignal,lifecycle:Lifecycle,allowedDomains:readonly string[],upgradeHttp:boolean,redirects:number):Promise<string>{
  const url=imageUrl(urlString,upgradeHttp);
  if(redirects===0&&allowedDomains.length)assert(allowedDomains.includes(url.hostname.toLowerCase()));
  const results=await lookup(url.hostname,{all:true});assert(results.length&&results.every(r=>publicAddress(r.address)));
  if(signal.aborted)throw new AppError('TIMEOUT');
  const pinnedLookup=createPinnedLookup(results);
  const request=url.protocol==='https:'?httpsRequest:httpRequest;
  const result=await new Promise<{redirect?:string;data?:string}>((resolve,reject)=>{
    let finished=false,release:()=>unknown=()=>{};
    const finish=(error?:Error,value?:{redirect?:string;data?:string})=>{if(finished)return;finished=true;release();signal.removeEventListener('abort',abort);error?reject(error):resolve(value!);};
    const req=request(url,{agent:false,headers:{Accept:'image/avif,image/webp,image/png,image/jpeg,image/gif,image/bmp','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'},lookup:pinnedLookup},response=>{
      response.on('error',()=>finish(new AppError('NETWORK_UNREACHABLE')));
      const status=response.statusCode||0,location=String(response.headers.location||'');
      if([301,302,303,307,308].includes(status)&&location){response.resume();finish(undefined,{redirect:new URL(location,url).toString()});return;}
      let mime=String(response.headers['content-type']||'').split(';')[0].toLowerCase();
      if(mime==='application/octet-stream'&&/\.ico$/i.test(url.pathname))mime='image/x-icon';
      if(status!==200||!/^image\/(png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)$/.test(mime)){response.destroy();finish(new AppError('VALIDATION'));return;}
      const chunks:Buffer[]=[];let total=0;
      response.on('data',chunk=>{total+=chunk.length;if(total>MAX_IMAGE_BYTES){response.destroy();finish(new AppError('ATTACHMENT_TOO_LARGE'));}else chunks.push(chunk);});
      response.on('end',()=>finish(undefined,{data:`data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`}));
    });
    const abort=()=>{req.destroy();finish(new AppError('TIMEOUT'));};
    release=lifecycle.add(()=>{req.destroy();});signal.addEventListener('abort',abort,{once:true});
    req.setTimeout(10000,abort);req.on('error',()=>finish(new AppError('NETWORK_UNREACHABLE')));
    if(signal.aborted)abort();else req.end();
  });
  if(result.redirect){assert(redirects<3,'VALIDATION');return load(result.redirect,signal,lifecycle,allowedDomains,upgradeHttp,redirects+1);}
  return result.data!;
}
