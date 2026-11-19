import {it,expect} from 'vitest';
import {endpointSecure,normalizeEndpoint} from '../../src/shared/mail';

it('常用端口自动匹配 TLS 与 STARTTLS',()=>{
  expect(endpointSecure('imap',993,false)).toBe(true);
  expect(endpointSecure('imap',143,true)).toBe(false);
  expect(endpointSecure('smtp',465,false)).toBe(true);
  expect(endpointSecure('smtp',587,true)).toBe(false);
  expect(endpointSecure('smtp',25,true)).toBe(false);
  expect(endpointSecure('smtp',2525,true)).toBe(true);
});

it('旧配置会在原地修正 secure 标记',()=>{
  const smtp={host:'mail.example.com',port:587,secure:true};
  const imap={host:'mail.example.com',port:993,secure:false};
  expect(normalizeEndpoint(smtp,'smtp')).toBe(true);
  expect(normalizeEndpoint(imap,'imap')).toBe(true);
  expect(smtp.secure).toBe(false);
  expect(imap.secure).toBe(true);
  expect(normalizeEndpoint(smtp,'smtp')).toBe(false);
});
