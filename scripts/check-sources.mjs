import {writeChunks} from './write.mjs';
import sanitize from 'sanitize-html';
const sources=[
  ['baidu','https://api.fanyi.baidu.com/doc/21',/52003|54001|54003|54004/g],
  ['baiduLegacy','https://fanyi-api.baidu.com/doc/21',/52003|54001|54003|54004/g],
  ['gmailImap','https://support.google.com/mail/answer/7126229?hl=en',/imap\.gmail\.com|993/g],
  ['gmailAppPassword','https://support.google.com/accounts/answer/185833?hl=en',/16-digit|2-Step Verification/g],
  ['qq','https://service.mail.qq.com/detail/0/339',/imap\.qq\.com|993|授权码/g],
  ['163','https://help.mail.163.com/faq.do?m=list&categoryID=197',/imap\.163\.com|993|授权码/g]
];
const results=await Promise.allSettled(sources.map(async([id,url,pattern])=>{
  const started=Date.now();
  try{
    const response=await fetch(url,{signal:AbortSignal.timeout(10000)});
    const html=await response.text(),text=sanitize(html,{allowedTags:[],allowedAttributes:{},nonTextTags:['script','style']});
    const matches=[...text.matchAll(pattern)].map(m=>text.slice(Math.max(0,m.index-100),m.index+180)).slice(0,20);
    await writeChunks(`docs/evidence/source-${id}.txt`,text);
    return {id,url,finalUrl:response.url,status:response.status,matches,bytes:Buffer.byteLength(html),elapsedMs:Date.now()-started,conclusion:matches.length?'存在相关正文，需按上下文核对':'正文未取得所需参数，不能作为已证实'};
  }catch(e){return {id,url,error:e.name,reason:e.cause?.code||e.message,elapsedMs:Date.now()-started,conclusion:'未取得正文，保留未证实'};}
}));
await writeChunks('docs/evidence/source-check.json',JSON.stringify({date:new Date().toISOString(),results},null,2));
console.log(JSON.stringify(results.map(r=>r.value||r.reason),null,2));
