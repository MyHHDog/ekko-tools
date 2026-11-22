import {assert} from '../../shared/error-codes';
export function validateRpc(name:string,input:any) {
  assert(input===undefined||(input&&typeof input==='object'&&!Array.isArray(input)));
  if(!input)return;
  for(const key of ['__requestId','__owner'])assert(input[key]===undefined||(typeof input[key]==='string'&&input[key].length<=200));
  if(name.startsWith('mail.draft.')||name==='mail.send'){
    assert(input.id===undefined||/^[\w-]{1,200}$/.test(input.id));
    assert(input.accountId===undefined||/^[\w:-]{0,200}$/.test(input.accountId));
    return;
  }
  if(name.startsWith('mail.')&&!['mail.account.add','mail.list','mail.mark-all-read'].includes(name)){
    assert(typeof input.accountId==='string'&&/^[\w:-]{1,200}$/.test(input.accountId));
    if(!['mail.account.test','mail.account.remove','mail.account.rename','mail.unread-status'].includes(name))assert(typeof input.messageId==='string'&&/^[\w:-]{1,200}$/.test(input.messageId));
  }
  if(name==='mail.account.add'){
    assert(['163','qq','gmail','custom'].includes(input.provider));
    assert(typeof input.address==='string'&&typeof input.secret==='string');
    assert(input.alias===undefined||(typeof input.alias==='string'&&Array.from(input.alias).length<=6));
  }
  if(name==='mail.account.rename'){
    const value=typeof input.alias==='string'?input.alias.trim():'';
    assert(value.length>0&&Array.from(value).length<=6);
  }
  if(name==='mail.list'){
    assert(input.cursor===undefined||(typeof input.cursor==='string'&&/^\d{1,10}$/.test(input.cursor)));
    assert(input.limit===undefined||(Number.isInteger(input.limit)&&input.limit>=1&&input.limit<=100));
    assert(input.refresh===undefined||typeof input.refresh==='boolean');
    assert(input.accountIds===undefined||(Array.isArray(input.accountIds)&&input.accountIds.length<=100&&input.accountIds.every((id:unknown)=>typeof id==='string'&&/^[\w:-]{1,200}$/.test(id))));
  }
  if(name==='mail.attachment')assert(typeof input.attachmentId==='string'&&/^[\w.-]{1,100}$/.test(input.attachmentId));
  if(name==='mail.reply')assert(typeof input.body==='string'&&input.body.trim().length>0&&input.body.length<=20000);
  if(name==='mail.mark-read')assert(typeof input.read==='boolean');
  if(name==='mail.mark-all-read')assert(input.accountIds===undefined||(Array.isArray(input.accountIds)&&input.accountIds.length<=100&&input.accountIds.every((id:unknown)=>typeof id==='string'&&/^[\w:-]{1,200}$/.test(id))));
  if(name==='mail.bilingual'){
    assert(input.segmentIndex===undefined||(Number.isInteger(input.segmentIndex)&&input.segmentIndex>=0&&input.segmentIndex<20000));
    for(const key of ['retry','continue'])assert(input[key]===undefined||typeof input[key]==='boolean');
  }
  if(name==='mail.images')assert(Array.isArray(input.allowedDomains)&&input.allowedDomains.length<=24&&input.allowedDomains.every((host:unknown)=>typeof host==='string'&&host.length<=253));
}
