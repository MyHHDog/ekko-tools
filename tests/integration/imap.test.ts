import {it,expect} from 'vitest';
import {ImapConnector} from '../../src/server/mail/imap';
import {fixtureImap} from '../fixtures/imap';
import {harness,unwrap,lifecycle} from '../helpers';
it('测试 IMAP 经真实连接层、vault 和 RPC 跑通收件箱→详情→双语，命令只读',async()=>{
  const fixture=fixtureImap(),life=lifecycle(),connector=new ImapConnector(life,3000,fixture.factory),h=await harness({real:connector});
  try{
    await unwrap(h,'settings.save',{provider:'hostModel',model:'fixture-model'});
    const account=await unwrap(h,'mail.account.add',{provider:'163',address:'fixture@163.com',secret:'fixture-authorization-only'});
    const page=await unwrap(h,'mail.list',{limit:20});expect(page.items).toHaveLength(1);expect(page.items[0].messageId).toBe('1:1');
    const mail=await unwrap(h,'mail.get',{accountId:account.id,messageId:'1:1'});expect(mail.text).toContain('Hello team.');
    const bilingual=await unwrap(h,'mail.bilingual',{accountId:account.id,messageId:'1:1',target:'zh'});expect(bilingual.complete).toBe(true);expect(bilingual.segments).toHaveLength(1);expect(bilingual.segments[0].source).toContain('Hello team.\n\nPlease review the schedule.');
    await unwrap(h,'mail.mark-read',{accountId:account.id,messageId:'1:1',read:true});
    expect(fixture.commands).toContain('EXAMINE');expect(fixture.commands).toContain('UID FETCH BODY.PEEK');
    expect(fixture.commands.filter(c=>c==='LOGIN')).toHaveLength(1);
    expect(fixture.commands.some(c=>/STORE|EXPUNGE|APPEND|SMTP/.test(c))).toBe(false);
    expect(fixture.options.every(o=>o.secure&&o.port===993&&o.logger===false&&o.tls.rejectUnauthorized)).toBe(true);
    expect(life.handles.size).toBeGreaterThan(0);
    expect(JSON.stringify(h.logs)).not.toContain('fixture-authorization-only');expect(JSON.stringify(h.events)).not.toContain('fixture-authorization-only');
    await unwrap(h,'mail.account.remove',{accountId:account.id});expect((await unwrap(h,'mail.list',{limit:20})).items).toHaveLength(0);
  }finally{await h.close();await life.close();expect(life.handles.size).toBe(0);}
});
it('UIDVALIDITY 变化拒绝旧 messageId；增量游标不会重复下载正文',async()=>{
  const fixture=fixtureImap(),life=lifecycle(),connector=new ImapConnector(life,3000,fixture.factory),signal=new AbortController().signal;
  const acc={account:{id:'fixture',provider:'163',address:'fixture@163.com'},secret:'fixture'} as any;
  try{
    expect((await connector.list({...acc},{limit:20},signal)).items).toHaveLength(1);
    expect((await connector.list({...acc},{limit:20},signal)).items).toHaveLength(0);
    await expect(connector.fetch({...acc},'2:1',signal)).rejects.toMatchObject({code:'NOT_FOUND'});
  }finally{connector.close();await life.close();}
});
it('翻页加载旧邮件不会跳过期间到达的新邮件',async()=>{
  const fixture=fixtureImap(1n,3),life=lifecycle(),connector=new ImapConnector(life,3000,fixture.factory);
  const acc={account:{id:'fixture',provider:'163',address:'fixture@163.com'},secret:'fixture'} as any;
  const signal=new AbortController().signal;
  try{
    const first=await connector.list({...acc},{limit:2},signal);
    expect(first.items.map(mail=>mail.messageId)).toEqual(['1:2','1:3']);
    fixture.deliver();
    const older=await connector.list({...acc},{limit:2,cursor:first.nextCursor},signal);
    expect(older.items.map(mail=>mail.messageId)).toEqual(['1:1']);
    const newest=await connector.list({...acc},{limit:2},signal);
    expect(newest.items).toMatchObject([{messageId:'1:4',unread:true}]);
    expect((await connector.list({...acc},{limit:2},signal)).items).toHaveLength(0);
  }finally{connector.close();await life.close();}
});

it.each([['MOVE',['UID MOVE 1 Trash']],['UIDPLUS',['UID COPY 1 Trash','UID EXPUNGE 1']]])('通过 %s 仅移动目标邮件并清理缓存',async(capability,writes)=>{
  const fixture=fixtureImap(1n,2,{capabilities:[capability],trash:true}),life=lifecycle();
  const h=await harness({real:new ImapConnector(life,3000,fixture.factory)});
  try{
    const account=await unwrap(h,'mail.account.add',{provider:'163',address:'fixture@163.com',secret:'fixture-authorization-only'});
    const input={accountId:account.id,messageId:'1:1'};
    await unwrap(h,'mail.get',input);
    expect((await unwrap(h,'mail.list')).unreadByAccount[account.id]).toBe(2);
    expect(await h.call('mail.delete',input,{userId:2,profile:'test'})).toMatchObject({ok:false,error:{code:'NOT_FOUND'}});
    expect(await h.call('mail.delete',{...input,messageId:'2:1'})).toMatchObject({ok:false,error:{code:'NOT_FOUND'}});
    expect(await unwrap(h,'mail.delete',input)).toEqual({deleted:true});
    expect(fixture.commands.filter(cmd=>/MOVE|COPY|EXPUNGE/.test(cmd))).toEqual(writes);
    expect(h.events).toContainEqual(expect.objectContaining({type:'mail.deleted',data:expect.objectContaining(input)}));
    expect(await h.call('mail.get',input)).toMatchObject({ok:false,error:{code:'NOT_FOUND'}});
    const page=await unwrap(h,'mail.list',{refresh:true});
    expect(page.items.map((mail:any)=>mail.messageId)).toEqual(['1:2']);
    expect(page.unreadByAccount[account.id]).toBe(1);
  }finally{await h.close();await life.close();}
});

it.each([
  [{capabilities:['MOVE'],trash:false},'MAIL_TRASH_UNAVAILABLE',[]],
  [{capabilities:[],trash:true},'MAIL_TRASH_UNAVAILABLE',[]],
  [{capabilities:['MOVE'],trash:true,rejectMove:true},'MAIL_DELETE_FAILED',['UID MOVE 1 Trash']],
  [{capabilities:['UIDPLUS'],trash:true,rejectMove:true},'MAIL_DELETE_FAILED',['UID COPY 1 Trash']],
])('无法安全移动时保留邮件且不永久删除：%j',async(options,code,writes)=>{
  const fixture=fixtureImap(1n,1,options),life=lifecycle();
  const h=await harness({real:new ImapConnector(life,3000,fixture.factory)});
  try{
    const account=await unwrap(h,'mail.account.add',{provider:'163',address:'fixture@163.com',secret:'fixture-authorization-only'});
    const input={accountId:account.id,messageId:'1:1'};
    await unwrap(h,'mail.list');
    expect(await h.call('mail.delete',input)).toMatchObject({ok:false,error:{code}});
    expect(fixture.commands.filter(cmd=>/MOVE|COPY|EXPUNGE/.test(cmd))).toEqual(writes);
    expect((await unwrap(h,'mail.list')).items).toMatchObject([input]);
    expect(h.events.some(event=>event.type==='mail.deleted')).toBe(false);
  }finally{await h.close();await life.close();}
});
