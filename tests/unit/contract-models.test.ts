import {it,expect} from 'vitest';
import {contract} from '../../src/server/index';
import {validateModel} from '../../sdk/harness/contracts.mjs';
import {addFixtures,harness,unwrap} from '../helpers';

it('契约：未知模型名与违反模型的输入被拒绝',()=>{
  expect(()=>validateModel(contract,'not_a_model',{})).toThrow();
  // 未知属性（additionalProperties:false）
  expect(()=>validateModel(contract,'markReadInput',{accountId:'a',messageId:'m',read:true,evil:1})).toThrow(/unknown property/);
  // 缺失必填
  expect(()=>validateModel(contract,'markReadInput',{accountId:'a',messageId:'m'})).toThrow(/missing read/);
  // 枚举外取值
  expect(()=>validateModel(contract,'settingsSaveInput',{provider:'magic'})).toThrow();
  // 超长字符串
  expect(()=>validateModel(contract,'accountIdInput',{accountId:'x'.repeat(201)})).toThrow(/invalid length/);
  // 动态键映射接受任意键但值仍须为 JSON
  expect(()=>validateModel(contract,'readMap',{'a:m':true,'other':false})).not.toThrow();
  // 原型污染字段一律拒绝（JSON.parse 才会生成自有 __proto__ 键）
  expect(()=>validateModel(contract,'readMap',JSON.parse('{"__proto__":1}'))).toThrow(/reserved/);
  expect(()=>validateModel(contract,'mailListInput',{limit:101})).toThrow(/outside range/);
  expect(()=>validateModel(contract,'markAllReadInput',{})).not.toThrow();
  expect(()=>validateModel(contract,'settingsSaveInput',{notifications:{enabled:true,dndEnabled:false,dndStart:'22:00',dndEnd:'08:00',mutedAccountIds:[]}})).not.toThrow();
  expect(()=>validateModel(contract,'settingsSaveInput',{notifications:{enabled:true}})).toThrow(/missing/);
});

it('契约：真实业务输出全部通过对应输出模型',async()=>{
  const h=await harness();
  try{
    const boot=await unwrap(h,'app.bootstrap');
    expect(()=>validateModel(contract,'bootstrapOutput',boot)).not.toThrow();
    await addFixtures(h);
    const custom=await unwrap(h,'mail.account.add',{
      provider:'custom',address:'me@self.example',secret:'custom-password',username:'self-user',
      imap:{host:'mail.self.example',port:993,secure:true},
      smtp:{host:'mail.self.example',port:587,secure:false},
    });
    const booted=await unwrap(h,'app.bootstrap');
    expect(booted.accounts.find((account:any)=>account.id===custom.id)).toMatchObject({
      provider:'custom',username:'self-user',
      imap:{host:'mail.self.example',port:993,secure:true},
      smtp:{host:'mail.self.example',port:587,secure:false},
    });
    expect(()=>validateModel(contract,'bootstrapOutput',booted)).not.toThrow();
    const page=await unwrap(h,'mail.list',{limit:5});
    expect(()=>validateModel(contract,'mailPage',page)).not.toThrow();
    const first=page.items[0];
    const mail=await unwrap(h,'mail.get',{accountId:first.accountId,messageId:first.messageId});
    expect(()=>validateModel(contract,'mailMessage',mail)).not.toThrow();
    const job=await unwrap(h,'translate.run',{text:'hello world',from:'en',to:'zh'});
    expect(()=>validateModel(contract,'translationJob',job)).not.toThrow();
    const settings=await unwrap(h,'settings.get');
    expect(()=>validateModel(contract,'settingsGetOutput',settings)).not.toThrow();
    const diagnostics=await unwrap(h,'app.diagnostics');
    expect(()=>validateModel(contract,'diagnosticsOutput',diagnostics)).not.toThrow();
    const domains=await unwrap(h,'mail.image-domains',{accountId:first.accountId,messageId:first.messageId});
    expect(()=>validateModel(contract,'imageDomainsOutput',domains)).not.toThrow();
    const history=await unwrap(h,'translate.history',{limit:5});
    expect(Array.isArray(history)).toBe(true);
    for(const item of history)expect(()=>validateModel(contract,'translationJob',item)).not.toThrow();
    // secret 永不出现在任何输出：深扫 bootstrap 与 mail 详情
    const scan=(value:any):string[]=>Object.entries(value||{}).flatMap(([k,v])=>k==='secret'||k==='dataBase64'&&false?[k]:typeof v==='object'?scan(v):[]);
    expect(scan(boot)).toEqual([]);expect(scan(mail)).toEqual([]);
  }finally{await h.close();}
});
