import type { Account, MailProviderId, ServerEndpoint } from '../../shared/types';
import { assert } from '../../shared/error-codes';
export const presets={
  '163':{host:'imap.163.com',port:993,secure:true,smtp:{host:'smtp.163.com',port:465,secure:true},label:'163',shape:'■',domains:['163.com','vip.163.com','126.com','vip.126.com','yeah.net']},
  qq:{host:'imap.qq.com',port:993,secure:true,smtp:{host:'smtp.qq.com',port:465,secure:true},label:'QQ',shape:'●',domains:['qq.com','foxmail.com']},
  gmail:{host:'imap.gmail.com',port:993,secure:true,smtp:{host:'smtp.gmail.com',port:465,secure:true},label:'Gmail',shape:'▲',domains:['gmail.com','googlemail.com']}
};
const presetIds=Object.keys(presets) as Exclude<MailProviderId,'custom'>[];
export function serverEndpoint(account:Pick<Account,'provider'|'imap'|'smtp'>,kind:'imap'|'smtp'):ServerEndpoint {
  if(account.provider==='custom'){const endpoint=account[kind];assert(endpoint,'VALIDATION');return endpoint;}
  const preset=presets[account.provider as Exclude<MailProviderId,'custom'>];
  assert(preset,'VALIDATION');
  return kind==='imap'?{host:preset.host,port:preset.port,secure:preset.secure}:preset.smtp;
}
function endpoint(value:ServerEndpoint|undefined) {
  assert(value&&typeof value==='object');
  assert(typeof value.host==='string'&&/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(value.host));
  assert(Number.isInteger(value.port)&&value.port>0&&value.port<=65535);
  assert(typeof value.secure==='boolean');
}
export function validateAccount(provider:MailProviderId,address:string,secret:string,custom?:Pick<Account,'username'|'imap'|'smtp'>) {
  assert(presetIds.includes(provider as any)||provider==='custom');
  assert(typeof address==='string'&&address.length<=254);
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(address));
  assert(typeof secret==='string'&&secret.length>0&&secret.length<=512);
  if(custom?.username!==undefined)assert(typeof custom.username==='string'&&custom.username.length<=254&&!/\s/.test(custom.username));
  if(provider==='custom'){
    assert(custom?.imap&&custom.smtp,'VALIDATION');endpoint(custom.imap);endpoint(custom.smtp);return;
  }
  assert(presets[provider as Exclude<MailProviderId,'custom'>].domains.includes(address.split('@')[1].toLowerCase()));
  if(provider==='gmail')assert(/^[a-zA-Z0-9]{16}$/.test(secret.replace(/\s/g,'')),'AUTH_REQUIRED_APP_PASSWORD');
}
