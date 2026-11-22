import {afterEach,expect,it,vi} from 'vitest';
import nodemailer from 'nodemailer';
import {simpleParser} from 'mailparser';
import {sendReply} from '../../src/server/mail/smtp';

afterEach(()=>vi.restoreAllMocks());

it('SMTP 邮件的 MIME 保留纯文本、富格式正文和附件原始字节',async()=>{
  const transport=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'windows'});
  const send=vi.spyOn(transport,'sendMail');
  vi.spyOn(nodemailer,'createTransport').mockReturnValue(transport);
  const account={id:'a1',provider:'163',alias:'邮件',address:'me@example.com',colorToken:'a1',state:{status:'connected',checkedAt:0},createdAt:0} as const;
  const bytes=Buffer.from([0,42,255,10]);
  await sendReply(account,'fake',{to:'you@example.com',subject:'邮件',text:'**正文**',html:'<p><strong>正文</strong></p>',attachments:[{filename:'记录.txt',content:bytes}]},new AbortController().signal,1000);
  const info=await send.mock.results[0].value;
  const mail=await simpleParser(info.message);
  expect(mail.text?.trim()).toBe('**正文**');
  expect(mail.html).toContain('<strong>正文</strong>');
  expect(mail.attachments).toHaveLength(1);
  expect(mail.attachments[0]).toMatchObject({filename:'记录.txt',content:bytes});
});
