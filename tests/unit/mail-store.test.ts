import {describe,expect,it} from 'vitest';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {MailStorage} from '../../src/server/mail/store';
import {cleanup,tempdir} from '../helpers';
import type {Account,MailSummary} from '../../src/shared/types';

describe('邮件 SQLite 存储',()=>{
  it('自动迁移旧草稿，并在移除附件和删除草稿时清理对应字节',async()=>{
    const dir=await tempdir(),database=join(dir,'mail.db'),legacy=new DatabaseSync(database),store=new MailStorage(database);
    const original={id:'draft',accountId:'a1',to:'',subject:'旧稿',body:'正文',updatedAt:0};
    const content=Buffer.from('file'),file={id:'12345678-1234-1234-1234-123456789abc',name:'文件.txt',bytes:content.length};
    try{
      legacy.exec('CREATE TABLE drafts(id TEXT PRIMARY KEY,accountId TEXT NOT NULL,"to" TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,updatedAt INTEGER NOT NULL)');
      legacy.prepare('INSERT INTO drafts VALUES(?,?,?,?,?,?)').run(...Object.values(original));
      expect(store.getDraft(original.id)).toEqual(original);
      const updated={...original,format:'markdown' as const,attachments:[file]};
      store.saveDraft(updated,true,[{...file,content}]);
      expect(store.getDraft(original.id)).toEqual(updated);
      expect(store.draftAttachments(original.id)).toEqual([{filename:file.name,content}]);
      store.saveDraft({...updated,attachments:[]},true);
      expect(store.draftAttachments(original.id)).toEqual([]);
      store.saveDraft(updated,true,[{...file,content}]);
      expect(store.deleteDraft(original.id)).toEqual({deleted:true});
      expect(store.draftAttachments(original.id)).toEqual([]);
    }finally{store.close();legacy.close();await cleanup(dir);}
  });
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
  it('已读、待回写与已见索引按邮件原子更新',async()=>{
    const dir=await tempdir(),store=new MailStorage(join(dir,'mail.db'));
    try{
      await store.setReadFlag('a1','m1',true);
      await store.setReadFlag('a1','m2',false);
      expect(store.readFlag('a1','m1')).toBe(true);
      expect(store.readFlag('a1','m2')).toBe(false);
      await store.setPendingRead('a1','m1',false);
      expect(store.pendingRead('a1','m1')).toBe(false);
      await store.setPendingReads([
        {accountId:'a1',messageId:'m1',read:true},
        {accountId:'a1',messageId:'m2',read:true},
      ]);
      expect(await store.get('read-pending')).toEqual({'a1:m1':true,'a1:m2':true});
      await store.deletePendingRead('a1','m1');
      expect(store.pendingRead('a1','m1')).toBeUndefined();
      await store.markKnown([
        {accountId:'a1',messageId:'m1',at:1},
        {accountId:'a1',messageId:'m2',at:2},
      ]);
      expect(store.knownCount('a1')).toBe(2);
      await store.saveSyncState('a1',{initialized:true,knownCount:2});
      expect(await store.get('mail-sync')).toEqual({a1:{initialized:true,knownCount:2}});
      store.clearAccount('a1');
      expect(store.readFlag('a1','m1')).toBeUndefined();
      expect(store.knownCount('a1')).toBe(0);
      expect(await store.get('mail-sync')).toEqual({});
    }finally{store.close();await cleanup(dir);}
  });
});
