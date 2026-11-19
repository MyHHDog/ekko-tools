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
