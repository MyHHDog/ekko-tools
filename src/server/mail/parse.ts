import { simpleParser } from 'mailparser';
import type { Account, MailMessage } from '../../shared/types';
import { sanitizeHtml, plainText, filename, dangerous } from './sanitize';
import {AppError} from '../../shared/error-codes';
export interface RawAttachment {id:string;filename:string;mime:string;size:number;inline?:boolean;cid?:string;dataBase64:string}
export interface RawMail {
  messageId:string;
  from:{name?:string;address:string};
  replyTo?:{name?:string;address:string}[];
  subject:string;
  date:number;
  text:string;
  html?:string;
  unread:boolean;
  to?:{address:string}[];
  cc?:{address:string}[];
  attachments:RawAttachment[];
  rfcMessageId?:string;
  references?:string[];
  inReplyTo?:string;
}
export async function parseMime(source:Buffer,messageId:string):Promise<RawMail> {
  let parsed;
  try{parsed=await simpleParser(source,{skipImageLinks:true,skipHtmlToText:true,skipTextToHtml:true});}
  catch{throw new AppError('PROVIDER_BAD_RESPONSE',false,'parse');}
  const addresses=(input:any)=>[input].flat().flatMap((x:any)=>x?.value||[]).map((x:any)=>({name:x.name,address:x.address||''}));
  const refs=Array.isArray(parsed.references)?parsed.references:[parsed.references].filter(Boolean) as string[];
  return {messageId,from:addresses(parsed.from)[0]||{address:''},replyTo:addresses(parsed.replyTo),to:addresses(parsed.to),cc:addresses(parsed.cc),
    subject:parsed.subject||'(无主题)',date:parsed.date?.getTime()||0,text:parsed.text||'',html:parsed.html||undefined,unread:true,
    rfcMessageId:parsed.messageId||undefined,references:refs,inReplyTo:parsed.inReplyTo||undefined,
    attachments:parsed.attachments.map((a,i)=>({id:String(i),filename:a.filename||'attachment',mime:a.contentType,size:a.size,inline:a.contentDisposition==='inline',cid:a.contentId?.replace(/[<>]/g,''),dataBase64:a.content.toString('base64')}))};
}
export function normalize(raw:RawMail,account:Account,maxBytes:number,remoteImages:Record<string,string>={}):MailMessage {
  const images=Object.fromEntries(raw.attachments.filter(a=>a.cid&&/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(a.mime)&&a.size<256000).map(a=>['cid:'+a.cid,`data:${a.mime};base64,${a.dataBase64}`]));
  const clean=sanitizeHtml(raw.html||'',{...images,...remoteImages});
  const text=(raw.text||plainText(clean.html)).slice(0,512*1024)+(clean.truncated?'\n[正文过长，已截断]':'');
  const contact=(value:{name?:string;address:string})=>({...(value.name?{name:value.name.slice(0,200)}:{}),address:value.address.slice(0,254)});
  return {accountId:account.id,messageId:raw.messageId,from:contact(raw.from),to:(raw.to||[]).map(contact),cc:(raw.cc||[]).map(contact),
    subject:raw.subject.slice(0,1000),
    snippet:text.slice(0,140),date:raw.date,unread:raw.unread,hasAttachments:raw.attachments.length>0,
    text,html:clean.html||undefined,remoteContentBlocked:clean.remoteBlocked,
    attachments:raw.attachments.map(a=>({id:String(a.id).slice(0,200),filename:filename(a.filename),mime:String(a.mime||'application/octet-stream').slice(0,100),
      size:Number(a.size)||0,inline:!!a.inline,
      blocked:dangerous(a.filename,a.mime)?'dangerous_type':a.size>maxBytes?'too_large':undefined}))};
}
