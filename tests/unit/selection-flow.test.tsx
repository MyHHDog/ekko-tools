// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup,within} from '@testing-library/react';
import {SelectionPopover} from '../../src/client/components/SelectionPopover';
import {MailDetail} from '../../src/client/views/MailDetail';
import {MailBodyFrame} from '../../src/client/components/MailBodyFrame';
// jsdom 的 navigator.language 默认 en-US；测试断言以中文文案为准，显式锁定 zh。
(window as any).__ekkoLocale='zh';
afterEach(()=>cleanup());
it('G07：面板选区→浮条翻译，只显示译文且不注入双语对照',async()=>{
  const root=document.createElement('main');document.body.append(root);
  const account:any={id:'account',provider:'163',address:'demo@example.com',alias:'163',state:{status:'connected'}};
  const mail={accountId:'account',messageId:'m-1',from:{address:'sender@example.com'},to:[],cc:[],subject:'邮件',date:0,text:'所选句子',attachments:[],remoteContentBlocked:false};
  const ctx:any={signal:new AbortController().signal,ui:{notify:vi.fn(),confirm:vi.fn(async()=>true)},messages:{on:()=>()=>{}},
    rpc:{call:vi.fn(async(name:string)=>({ok:true,data:name==='mail.get'?mail:name==='translate.run'?{result:{translated:'片段译文'}}:{ok:true}}))}};
  render(<><MailDetail ctx={ctx} account={account} messageId="m-1" target="zh" onBack={()=>{}} onTranslated={()=>{}} neighbors={[]} onOpen={()=>{}}/>
    <SelectionPopover ctx={ctx} root={root} enabled target="zh" onSend={()=>{}}/></>,{container:root});
  const source=await screen.findByLabelText('可划词的邮件正文');
  const range=document.createRange();range.selectNodeContents(source);
  Object.assign(range,{getBoundingClientRect:()=>({bottom:100})});
  window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);
  fireEvent(document,new Event('selectionchange'));
  fireEvent.click(await within(root).findByRole('button',{name:'译'}));
  await screen.findByText('片段译文');
  expect(screen.queryByRole('button',{name:'替换为双语'})).toBeNull();
  expect(screen.getByLabelText('邮件详情').textContent).not.toContain('片段译文');
  root.remove();
});

it('G07b：结果卡片上真实鼠标 mouseup（选区未变）不清空译文',async()=>{
  const root=document.createElement('main');document.body.append(root);
  const ctx:any={signal:new AbortController().signal,ui:{notify:vi.fn(),confirm:vi.fn(async()=>true)},messages:{on:()=>()=>{}},
    rpc:{call:vi.fn(async()=>({ok:true,data:{result:{translated:'稳定译文'}}}))}};
  render(<SelectionPopover ctx={ctx} root={root} enabled target="zh" onSend={()=>{}}/>,{container:root});
  const host=document.createElement('div');host.textContent='被选择的一段文字';root.append(host);
  const range=document.createRange();range.selectNodeContents(host);
  Object.assign(range,{getBoundingClientRect:()=>({bottom:100})});
  window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);
  fireEvent(document,new Event('selectionchange'));
  fireEvent.click(await screen.findByRole('button',{name:'译'}));
  await screen.findByText('稳定译文');
  // 真实浏览器行为：点击结果按钮时 mouseup 冒泡回 root，选区保持不变
  fireEvent.mouseUp(root);
  await new Promise(r=>setTimeout(r,20));
  expect(screen.getByText('稳定译文')).toBeDefined();
  expect(screen.queryByRole('button',{name:'替换为双语'})).toBeNull();
  // 选区变化后才重置并更新浮条文本
  const range2=document.createRange();range2.selectNodeContents(host);
  Object.assign(range2,{getBoundingClientRect:()=>({bottom:120})});
  window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range2);
  fireEvent(document,new Event('selectionchange'));
  root.remove();
});

it('G07c：HTML 邮件正文 iframe 内划词可翻译，并跟随最新目标语言',async()=>{
  const root=document.createElement('main');document.body.append(root);
  const ctx:any={signal:new AbortController().signal,ui:{notify:vi.fn(),confirm:vi.fn(async()=>true)},messages:{on:()=>()=>{}},
    rpc:{call:vi.fn(async(name:string)=>({ok:true,data:name==='translate.run'?{result:{translated:'框架译文'}}:{}}))}};
  const view=render(<><MailBodyFrame html="<p>iframe</p>"/><SelectionPopover ctx={ctx} root={root} enabled target="zh" onSend={()=>{}}/></>,{container:root});
  const frame=root.querySelector('iframe')!;
  const doc=frame.contentDocument!;
  doc.body.innerHTML='<p id="inside">iframe 内文字</p>';
  fireEvent.load(frame);
  const range=doc.createRange();range.selectNodeContents(doc.getElementById('inside')!);
  Object.assign(range,{getBoundingClientRect:()=>({bottom:42})});
  const selection=frame.contentWindow!.getSelection()!;
  selection.removeAllRanges();selection.addRange(range);
  fireEvent(doc,new Event('selectionchange'));
  view.rerender(<><MailBodyFrame html="<p>iframe</p>"/><SelectionPopover ctx={ctx} root={root} enabled target="en" onSend={()=>{}}/></>);
  fireEvent.click(await within(root).findByRole('button',{name:'译'}));
  await vi.waitFor(()=>expect(ctx.rpc.call).toHaveBeenCalledWith('translate.run',expect.objectContaining({text:'iframe 内文字',to:'en'})));
  await screen.findByText('框架译文');
  expect(ctx.rpc.call).toHaveBeenCalledWith('translate.run',expect.objectContaining({text:'iframe 内文字',to:'en'}));
  root.remove();
});
