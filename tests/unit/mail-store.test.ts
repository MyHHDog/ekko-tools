import {describe,expect,it} from 'vitest';
import {join} from 'node:path';
import {MailStorage} from '../../src/server/mail/store';
import {cleanup,tempdir} from '../helpers';
import type {Account,MailSummary} from '../../src/shared/types';

describe('邮件 SQLite 存储',()=>{
  it('账号、邮件、状态、缓存与正文索引按账号落库并清理',async()=>{
    const dir=await tempdir(),store=new MailStorage(join(dir,'mail.db'));
    const account:Account={id:'a1',provider:'custom',address:'me@example.com',alias:'自建',colorToken:'a4',
      imap:{host:'mail.example.com',port:993,secure:true},smtp:{host:'mail.example.com',port:587,secure:false},
      state:{status:'connected',checkedAt:1},createdAt:1};
    const message:MailSummary={accountId:'a1',messageId:'42',from:{name:'Sender',address:'sender@example.com'},
      subject:'Hello',snippet:'Hi',date:10,unread:true,hasAttachments:false};
    const key='a1:42';
    try{
      await store.set('accounts',[account]);
      expect(await store.get<Account[]>('accounts')).toMatchObject([{id:'a1',smtp:{port:587,secure:false}}]);
      await store.set('mail-cache',[message]);
      expect(await store.get<MailSummary[]>('mail-cache')).toMatchObject([{messageId:'42',subject:'Hello'}]);
      await store.set('read',{[key]:true});
      await store.set('read-pending',{[key]:true});
      await store.set('translated',{[key]:true});
      expect(await store.get('read')).toEqual({[key]:true});
      expect(await store.get('read-pending')).toEqual({[key]:true});
      expect(await store.get('translated')).toEqual({[key]:true});
      await store.set('mail-sync',{a1:{initialized:true,lastSyncAt:10}});
      expect(await store.get('mail-sync')).toEqual({a1:{initialized:true,lastSyncAt:10}});
      await store.set('mail-known',{[key]:10});
      expect(await store.get('mail-known')).toEqual({[key]:10});
      await store.set('bilingual',{[key+':zh']:{messageId:'42',segments:[],complete:true}});
      await store.set('images',{[key]:{}});
      await store.set('mail-body-index',{[key]:{at:10,bytes:123}});
      expect(await store.get('mail-body-index')).toEqual({[key]:{at:10,bytes:123}});
      store.clearAccount('a1');
      expect(await store.get('mail-cache')).toEqual([]);
      expect(await store.get('read')).toEqual({});
      expect(await store.get('mail-sync')).toEqual({});
      expect(await store.get('mail-known')).toEqual({});
      expect(await store.get('mail-body-index')).toEqual({});
    }finally{store.close();await cleanup(dir);}
  });
});
