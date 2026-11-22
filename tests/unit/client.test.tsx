// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import {act,render,screen,fireEvent,cleanup,waitFor,within} from '@testing-library/react';
import {Translate} from '../../src/client/views/Translate';
import {Mail} from '../../src/client/views/Mail';
import {MailCompose} from '../../src/client/views/MailCompose';
import {Reading} from '../../src/client/views/Reading';
import {State,stateDefinitions} from '../../src/client/components/States';
import {Tabs} from '../../src/client/components/Tabs';
import {MailBodyFrame} from '../../src/client/components/MailBodyFrame';
import {ProviderIcon} from '../../src/client/components/AccountChip';
import {AppearanceSettings} from '../../src/client/views/settings/AppearanceSettings';
import {MailSettings} from '../../src/client/views/settings/MailSettings';
import {TranslationSettings} from '../../src/client/views/settings/TranslationSettings';
import {ReadingSettings} from '../../src/client/views/settings/ReadingSettings';
import {Settings} from '../../src/client/views/Settings';
import {App} from '../../src/client/App';
import {sanitizeClient,frameDocument} from '../../src/client/sanitize/html-allowlist';
import {resolveSlot} from '../../src/client/adapter/host';
import {call,copyText} from '../../src/client/rpc-client';
import {decodeAppearanceSave} from '../../src/shared/appearance-wire';
import {clearRemoteImageCache,useRemoteImage} from '../../src/client/hooks/use-remote-image';
import {
  appearanceDefaults,applyAppearance,currentBackground,currentBackgrounds,loadAppearance,uploadAppearanceBackground
} from '../../src/client/appearance';
// jsdom 的 navigator.language 默认 en-US；测试断言以中文文案为准，显式锁定 zh。
(window as any).__ekkoLocale='zh';
if(typeof (Blob.prototype as any).arrayBuffer!=='function'){
  Object.defineProperty(Blob.prototype,'arrayBuffer',{configurable:true,value:function(this:Blob){
    return new Promise<ArrayBuffer>((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result as ArrayBuffer);
      reader.onerror=()=>reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  }});
}
if(typeof (URL as any).createObjectURL!=='function'){
  Object.defineProperty(URL,'createObjectURL',{configurable:true,writable:true,value:()=>''});
}
if(typeof (URL as any).revokeObjectURL!=='function'){
  Object.defineProperty(URL,'revokeObjectURL',{configurable:true,writable:true,value:()=>{}});
}
const ctx:any={slot:'workspace',view:'translate',location:{path:'translate',query:{}},rpc:{call:vi.fn(async()=>({ok:true,data:[]}))},ui:{notify:vi.fn(),confirm:vi.fn(async()=>true),navigate:vi.fn()},messages:{on:()=>()=>{}},lifecycle:{add:(fn:any)=>fn},signal:new AbortController().signal};
const setViewport=(width:number)=>Object.defineProperty(window,'innerWidth',{configurable:true,value:width});
function choose(label:string,option:string|RegExp){
  fireEvent.click(screen.getByLabelText(label));
  const match=screen.getAllByRole('option').find(node=>typeof option==='string'?node.textContent?.trim()===option:option.test(node.textContent||''));
  if(!match)throw new Error(`未找到下拉选项：${String(option)}`);
  fireEvent.click(match);
}
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.clearAllMocks();setViewport(1024);});
it('13类状态均有图标、文字和语义角色',()=>{const {container}=render(<>{stateDefinitions.map(s=><State key={s[0]} kind={s[0]}/>)}</>);expect(container.querySelectorAll('[data-state]')).toHaveLength(13);for(const node of container.querySelectorAll('[data-state]')){expect(node.querySelector('svg')).not.toBeNull();expect(node.textContent!.length).toBeGreaterThan(1);expect(['status','alert']).toContain(node.getAttribute('role'));}});
it('远程图标经服务端代理加载，不在移动端直连外链',async()=>{
  clearRemoteImageCache();
  const calls:any[]=[];
  const iconCtx:any={...ctx,rpc:{call:vi.fn(async(name:string,input:any)=>{
    calls.push({name,input});
    if(name==='media.image')return {ok:true,data:{data:'data:image/png;base64,YQ=='}};
    return {ok:true,data:{}};
  })}};
  const {container}=render(<ProviderIcon ctx={iconCtx} provider="163" address="fixture@example.com" status="connected"/>);
  await waitFor(()=>expect(calls.some(call=>call.name==='media.image')).toBe(true));
  await waitFor(()=>expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,YQ=='));
  expect(container.querySelector('img')?.getAttribute('src')).not.toContain('mail.163.com');
});
function RemoteImageProbe({ctx:probeCtx}:{ctx:any}){const src=useRemoteImage(probeCtx,'https://example.com/probe.png');return src?<img alt="" src={src}/>:null;}
it('远程图片代理失败时返回空地址并保留回退内容',async()=>{
  clearRemoteImageCache();
  const failing:any={...ctx,rpc:{call:vi.fn(async()=>({ok:true,data:{data:''}}))}};
  const {container}=render(<RemoteImageProbe ctx={failing}/>);
  await waitFor(()=>expect(failing.rpc.call).toHaveBeenCalledWith('media.image',expect.objectContaining({url:'https://example.com/probe.png'})));
  expect(container.querySelector('img')?.getAttribute('src')||'').toBe('');
});
it('空输入不发翻译请求；字数随输入更新',()=>{const {container}=render(<Translate ctx={ctx} onTarget={()=>{}} onSettings={()=>{}}/>);const input=screen.getByLabelText('原文');fireEvent.keyDown(input,{key:'Enter'});expect(ctx.rpc.call.mock.calls.some((c:any)=>c[0]==='translate.run')).toBe(false);fireEvent.change(input,{target:{value:'你好 abc 🙂'}});expect(container.querySelector('.count')!.textContent).toBe('6 / 5000 字');});
it('源目标交换，选择器皆可键盘访问',()=>{render(<Translate ctx={ctx} onTarget={()=>{}} onSettings={()=>{}}/>);choose('源语言','English');fireEvent.click(screen.getByLabelText('交换源语言和目标语言'));expect(screen.getByLabelText('源语言').textContent).toContain('简体中文');expect(screen.getByLabelText('目标语言').textContent).toContain('English');});
it('翻译页中英自动互译，输出只显示译文',async()=>{
  const calls:any[]=[];
  const autoCtx:any={...ctx,rpc:{call:vi.fn(async(name:string,input:any)=>{
    calls.push({name,input});
    if(name==='translate.history')return {ok:true,data:[]};
    if(name==='translate.run'){
      const translated=input.to==='en'?'Hello':'你好';
      return {ok:true,data:{id:'job',request:{text:input.text,from:input.from,to:input.to,provider:'hostModel'},status:'done',result:{provider:'hostModel',translated,latencyMs:1},attempts:1,createdAt:0}};
    }
    return {ok:true,data:{}};
  })}};
  render(<Translate ctx={autoCtx} onTarget={()=>{}} onSettings={()=>{}}/>);
  expect(screen.getByLabelText('目标语言').textContent).toContain('自动（中↔英）');
  expect(screen.queryByText('对照')).toBeNull();
  expect(screen.queryByText('仅译文')).toBeNull();
  const input=screen.getByLabelText('原文');
  fireEvent.change(input,{target:{value:'你好'}});
  fireEvent.keyDown(input,{key:'Enter'});
  await waitFor(()=>expect(calls.some(call=>call.name==='translate.run'&&call.input.to==='en')).toBe(true));
  await waitFor(()=>expect(screen.getByText('Hello')).toBeTruthy());
  fireEvent.change(input,{target:{value:'Hello'}});
  fireEvent.keyDown(input,{key:'Enter'});
  await waitFor(()=>expect(calls.some(call=>call.name==='translate.run'&&call.input.to==='zh')).toBe(true));
  await waitFor(()=>expect(screen.getByText('你好')).toBeTruthy());
});
it('停止输入后自动翻译，Enter 立即翻译且 Shift+Enter 不提交',async()=>{
  const calls:any[]=[];
  const autoCtx:any={...ctx,rpc:{call:vi.fn(async(name:string,input:any)=>{
    calls.push({name,input});
    if(name==='translate.run')return {ok:true,data:{id:'job',request:{text:input.text,from:input.from,to:input.to,provider:'hostModel'},status:'done',result:{provider:'hostModel',translated:'译文',latencyMs:1},attempts:1,createdAt:0}};
    return {ok:true,data:{}};
  })}};
  render(<Translate ctx={autoCtx} onTarget={()=>{}} onSettings={()=>{}}/>);
  const input=screen.getByLabelText('原文');
  fireEvent.change(input,{target:{value:'自动翻译'}});
  expect(calls.some(call=>call.name==='translate.run')).toBe(false);
  await waitFor(()=>expect(calls.some(call=>call.name==='translate.run')).toBe(true),{timeout:2000});
  fireEvent.change(input,{target:{value:'立即翻译'}});
  fireEvent.keyDown(input,{key:'Enter',shiftKey:true});
  expect(calls.filter(call=>call.name==='translate.run')).toHaveLength(1);
  fireEvent.keyDown(input,{key:'Enter'});
  await waitFor(()=>expect(calls.filter(call=>call.name==='translate.run')).toHaveLength(2));
});
it('输入法组词期间回车不触发，组词结束后恢复自动翻译',async()=>{
  const calls:any[]=[];
  const imeCtx:any={...ctx,rpc:{call:vi.fn(async(name:string,input:any)=>{
    calls.push({name,input});
    if(name==='translate.run')return {ok:true,data:{id:'job',request:{text:input.text,from:input.from,to:input.to,provider:'hostModel'},status:'done',result:{provider:'hostModel',translated:'Hello',latencyMs:1},attempts:1,createdAt:0}};
    return {ok:true,data:{}};
  })}};
  render(<Translate ctx={imeCtx} onTarget={()=>{}} onSettings={()=>{}}/>);
  const input=screen.getByLabelText('原文');
  fireEvent.compositionStart(input);
  fireEvent.change(input,{target:{value:'你好'}});
  fireEvent.keyDown(input,{key:'Enter',keyCode:229});
  expect(calls.some(call=>call.name==='translate.run')).toBe(false);
  fireEvent.compositionEnd(input);
  await waitFor(()=>expect(calls.some(call=>call.name==='translate.run'&&call.input.text==='你好')).toBe(true),{timeout:2000});
});
it('分段控件方向键与roving tabindex',()=>{const change=vi.fn();render(<Tabs items={['翻译','收件箱']} value="翻译" onChange={change} label="模块"/>);fireEvent.keyDown(screen.getByRole('tab',{name:'翻译'}),{key:'ArrowRight'});expect(change).toHaveBeenCalledWith('收件箱');expect(screen.getByRole('tab',{name:'收件箱'})).toBe(document.activeElement);});
it('客户端复检阻断脚本、事件、CSS、远程图和混淆URL',()=>{const raw='<script>x</script><svg onload=x/><img src="https://tracker.invalid/x" onerror=x><a href="JaVa&#x09;Script:x">x</a><div style="background:url(x)">text</div>';const clean=sanitizeClient(raw);expect(clean.html).not.toMatch(/<script|<svg|onerror|onload|javascript:|style=|https:\/\/tracker/i);expect(frameDocument(raw)).toContain('Content-Security-Policy');});
it('文章正文应用预设样式并过滤危险自定义CSS',()=>{
  const html=frameDocument('<p>正文</p>',false,'article',{theme:'dark',font:'sans',fontSize:18,lineHeight:1.9,width:800,
    customCss:'p{color:#fff} @import url(https://evil.invalid/x.css); body{background:url(https://evil.invalid/x.png)} .x{position:fixed;z-index:9}'});
  expect(html).toContain('background:#232624');
  expect(html).toContain('font:18px/1.90');
  expect(html).toContain('max-width:800px');
  expect(html).toContain('p{color:#fff}');
  expect(html).not.toMatch(/@import|background:url|position:fixed|z-index:9/i);
});
it('移动端正文使用独立视口、更宽版心和更大的基础字号',()=>{
  const html=frameDocument('<p>正文</p>',false,'article',undefined,true);
  expect(html).toContain('name="viewport"');
  expect(html).toContain('width=device-width');
  expect(html).toContain('max-width:none');
  expect(html).toContain('font-size:17px');
});
it('外观按窄屏环境自动选择移动背景，缺图时回退 Web 背景',()=>{
  let narrow=false;
  const query:any={get matches(){return narrow;},addEventListener:vi.fn(),addListener:vi.fn(),removeEventListener:vi.fn()};
  Object.defineProperty(window,'matchMedia',{configurable:true,value:vi.fn(()=>query)});
  applyAppearance(appearanceDefaults,{desktop:'https://example.com/desktop.jpg',mobile:'https://example.com/mobile.jpg'});
  expect(document.documentElement.style.getPropertyValue('--ek-user-bg-image')).toContain('desktop.jpg');
  expect(document.documentElement.style.getPropertyValue('--ek-user-bg-image-mobile')).toContain('mobile.jpg');
  expect(currentBackground()).toBe('https://example.com/desktop.jpg');
  narrow=true;
  expect(currentBackground()).toBe('https://example.com/mobile.jpg');
  applyAppearance(appearanceDefaults,{desktop:'https://example.com/desktop.jpg',mobile:''});
  expect(currentBackground()).toBe('https://example.com/desktop.jpg');
  applyAppearance(appearanceDefaults,{desktop:'',mobile:''});
  expect(document.documentElement.style.getPropertyValue('--ek-user-bg-image-mobile')).toBe('');
  delete (window as any).matchMedia;
});
it('上传预览不会被稍后返回的旧外观读取覆盖',async()=>{
  applyAppearance(appearanceDefaults,{desktop:'',mobile:''});
  let sequence=0;
  if(!URL.createObjectURL)Object.defineProperty(URL,'createObjectURL',{configurable:true,writable:true,value:()=>''});
  if(!URL.revokeObjectURL)Object.defineProperty(URL,'revokeObjectURL',{configurable:true,writable:true,value:()=>{}});
  vi.spyOn(URL,'createObjectURL').mockImplementation(()=>`blob:preview-${++sequence}`);
  vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
  const calls:any[]=[];
  const uploadCtx:any={...ctx,rpc:{call:vi.fn(async(name:string,input:any)=>{
    calls.push({name,input});
    if(name==='appearance.background-start')return {ok:true,data:{uploadId:'upload'}};
    if(name==='appearance.background-chunk')return {ok:true,data:{received:8}};
    if(name==='appearance.background-complete'){
      await new Promise(resolve=>setTimeout(resolve,30));
      return {ok:true,data:{saved:true,name:'wall.jpg',bytes:8}};
    }
    if(name==='appearance.get')return {ok:true,data:{settings:appearanceDefaults,hasBackground:false,updatedAt:0}};
    return {ok:true,data:{}};
  })}};
  const file=new File([new Uint8Array([0xff,0xd8,0xff,0xdb,1,2,3,4])],'wall.jpg',{type:'image/jpeg'});
  const uploading=uploadAppearanceBackground(uploadCtx,file,'desktop');
  await waitFor(()=>expect(document.documentElement.style.getPropertyValue('--ek-user-bg-image')).toContain('blob:preview-'));
  const loaded=await loadAppearance(uploadCtx);
  expect(loaded.backgrounds.desktop).toContain('blob:preview-');
  expect(document.documentElement.style.getPropertyValue('--ek-user-bg-image')).toContain('blob:preview-');
  await uploading;
  expect(calls.some(call=>call.name==='appearance.background-read')).toBe(false);
});
it('挂载时已开始的外观读取不会覆盖随后上传的预览',async()=>{
  applyAppearance(appearanceDefaults,{desktop:'',mobile:''});
  vi.spyOn(URL,'createObjectURL').mockImplementation(()=>'blob:race-preview');
  vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
  let releaseRead:()=>void=()=>{};
  const readGate=new Promise<void>(resolve=>{releaseRead=resolve;});
  const raceCtx:any={...ctx,rpc:{call:vi.fn(async(name:string)=>{
    if(name==='appearance.get'){
      await readGate;
      return {ok:true,data:{settings:appearanceDefaults,hasBackground:false,updatedAt:0}};
    }
    if(name==='appearance.background-start')return {ok:true,data:{uploadId:'race-upload'}};
    if(name==='appearance.background-chunk')return {ok:true,data:{received:8}};
    if(name==='appearance.background-complete')return {ok:true,data:{saved:true,name:'race.jpg',bytes:8}};
    return {ok:true,data:{}};
  })}};
  const loading=loadAppearance(raceCtx);
  const file=new File([new Uint8Array([0xff,0xd8,0xff,0xdb,5,6,7,8])],'race.jpg',{type:'image/jpeg'});
  const uploading=uploadAppearanceBackground(raceCtx,file,'desktop');
  await waitFor(()=>expect(document.documentElement.style.getPropertyValue('--ek-user-bg-image')).toContain('blob:race-preview'));
  releaseRead();
  const loaded=await loading;
  await uploading;
  expect(loaded.backgrounds.desktop).toBe('blob:race-preview');
  expect(document.documentElement.style.getPropertyValue('--ek-user-bg-image')).toContain('blob:race-preview');
});
it('单个背景读取失败时保留当前背景而不是清空',async()=>{
  applyAppearance(appearanceDefaults,{desktop:'https://example.com/keep.jpg',mobile:''});
  const brokenCtx:any={...ctx,rpc:{call:vi.fn(async(name:string)=>{
    if(name==='appearance.get')return {ok:true,data:{settings:appearanceDefaults,hasBackground:true,backgroundMime:'image/jpeg',updatedAt:1}};
    if(name==='appearance.background-read')return {ok:false,error:{code:'NETWORK_UNREACHABLE',message:'读取失败',retryable:true}};
    return {ok:true,data:{}};
  })}};
  const loaded=await loadAppearance(brokenCtx);
  expect(loaded.backgrounds.desktop).toBe('https://example.com/keep.jpg');
  expect(currentBackgrounds().desktop).toBe('https://example.com/keep.jpg');
  expect(document.documentElement.style.getPropertyValue('--ek-user-bg-image')).toContain('example.com/keep.jpg');
});
it('同一张背景再次加载时复用已有图片，不重复读取',async()=>{
  applyAppearance(appearanceDefaults,{desktop:'',mobile:''});
  vi.spyOn(URL,'createObjectURL').mockImplementation(()=>'blob:reuse-background');
  vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
  let reads=0;
  const reuseCtx:any={...ctx,rpc:{call:vi.fn(async(name:string)=>{
    if(name==='appearance.get')return {ok:true,data:{
      settings:appearanceDefaults,hasBackground:true,backgroundName:'wall.jpg',backgroundBytes:3,
      backgroundMime:'image/jpeg',updatedAt:1
    }};
    if(name==='appearance.background-read'){
      reads+=1;
      return {ok:true,data:{data:'AQID',nextOffset:3,eof:true}};
    }
    return {ok:true,data:{}};
  })}};
  await loadAppearance(reuseCtx);
  const again=await loadAppearance(reuseCtx);
  expect(reads).toBe(1);
  expect(again.backgrounds.desktop).toBe('blob:reuse-background');
});
it('客户端保留安全邮件样式表并拒绝外部 CSS',()=>{const raw='<style>.mail{color:#123456}.bad{background:url(https://evil.invalid/a.png);position:fixed}@import url(https://evil.invalid/a.css);</style><p class="mail">正文</p>';const clean=sanitizeClient(raw);expect(clean.html).toContain('.mail{color:#123456}');expect(clean.html).toContain('class="mail"');expect(clean.html).not.toMatch(/@import|url\(|position/i);});
it('邮件 iframe 禁脚本且正文外链可直接点击跳转',()=>{
  const {container}=render(<MailBodyFrame html='<a href="https://example.com/docs">资料</a>'/>);
  const iframe=container.querySelector('iframe')!;
  expect(iframe.getAttribute('sandbox')).toContain('allow-same-origin');
  expect(iframe.getAttribute('sandbox')).not.toContain('allow-scripts');
  expect(iframe.getAttribute('srcdoc')).toContain('href="https://example.com/docs"');
  expect(iframe.getAttribute('srcdoc')).toContain('target="_blank"');
  expect(iframe.getAttribute('srcdoc')).toContain('font-size:16px');
  expect(screen.queryByText('正文链接（打开前确认目标）')).toBeNull();
});
it('邮件正文缩放值写入安全文档并限制在可用范围',()=>{
  const view=render(<MailBodyFrame html='<p>正文</p>' zoom={120}/>);
  expect(view.container.querySelector('iframe')!.getAttribute('srcdoc')).toContain('html{zoom:1.20}');
  view.rerender(<MailBodyFrame html='<p>正文</p>' zoom={300}/>);
  expect(view.container.querySelector('iframe')!.getAttribute('srcdoc')).toContain('html{zoom:2.00}');
  view.rerender(<MailBodyFrame html='<p>正文</p>' zoom={10}/>);
  expect(view.container.querySelector('iframe')!.getAttribute('srcdoc')).toContain('html{zoom:0.20}');
});
it('移动端邮件正文缩放工具栏可放大并复位',async()=>{
  const account:any={id:'a1',provider:'163',address:'a@example.com',alias:'163',colorToken:'a1',state:{status:'connected'},createdAt:0};
  const summary:any={accountId:'a1',messageId:'m1',from:{name:'Sender',address:'s@example.com'},to:[{address:'a@example.com'}],cc:[],subject:'主题',snippet:'摘要',date:0,unread:false,hasAttachments:false};
  const message:any={accountId:'a1',messageId:'m1',from:summary.from,to:summary.to,cc:[],subject:'主题',date:0,text:'正文',html:'<p>正文</p>',attachments:[],remoteContentBlocked:false};
  const calls:any[]=[];
  const mailCtx:any={...ctx,rpc:{call:vi.fn(async(name:string,input:any)=>{
    calls.push({name,input});
    if(name==='mail.list')return {ok:true,data:{items:[summary],partial:[],updated:1,total:1}};
    if(name==='mail.get')return {ok:true,data:message};
    return {ok:true,data:{}};
  })}};
  const {container}=render(<Mail ctx={mailCtx} accounts={[account]} target="zh" onSettings={()=>{}} compact={false} refreshAccounts={async()=>{}}/>);
  await waitFor(()=>expect(screen.getByRole('option')).toBeTruthy());
  fireEvent.click(screen.getByRole('option'));
  const iframe=await waitFor(()=>{
    const node=container.querySelector('iframe');
    expect(node).not.toBeNull();
    return node!;
  });
  fireEvent.click(screen.getByRole('button',{name:'放大正文'}));
  await waitFor(()=>expect(iframe.getAttribute('srcdoc')).toContain('html{zoom:1.10}'));
  expect(screen.getByRole('button',{name:'恢复正文大小'}).textContent).toBe('110%');
  expect(calls.some(call=>call.name==='settings.save'&&call.input.mailBodyZoom===110)).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'恢复正文大小'}));
  await waitFor(()=>expect(iframe.getAttribute('srcdoc')).not.toContain('html{zoom:'));
  expect(screen.getByRole('button',{name:'恢复正文大小'}).textContent).toBe('100%');
  for(let step=0;step<8;step++)fireEvent.click(screen.getByRole('button',{name:'缩小正文'}));
  await waitFor(()=>expect(iframe.getAttribute('srcdoc')).toContain('html{zoom:0.20}'));
  expect(screen.getByRole('button',{name:'恢复正文大小'}).textContent).toBe('20%');
  expect((screen.getByRole('button',{name:'缩小正文'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'恢复正文大小'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'恢复正文大小'}).textContent).toBe('100%'));
});
it('邮件正文缩放从偏好恢复',async()=>{
  const account:any={id:'a1',provider:'163',address:'a@example.com',alias:'163',colorToken:'a1',state:{status:'connected'},createdAt:0};
  const summary:any={accountId:'a1',messageId:'m1',from:{name:'Sender',address:'s@example.com'},to:[],cc:[],subject:'主题',snippet:'摘要',date:0,unread:false,hasAttachments:false};
  const message:any={accountId:'a1',messageId:'m1',from:summary.from,to:[],cc:[],subject:'主题',date:0,text:'正文',html:'<p>正文</p>',attachments:[],remoteContentBlocked:false};
  const mailCtx:any={...ctx,rpc:{call:vi.fn(async(name:string)=>{
    if(name==='settings.get')return {ok:true,data:{mailBodyZoom:130}};
    if(name==='mail.list')return {ok:true,data:{items:[summary],partial:[],updated:1,total:1}};
    if(name==='mail.get')return {ok:true,data:message};
    return {ok:true,data:{}};
  })}};
  const {container}=render(<Mail ctx={mailCtx} accounts={[account]} target="zh" onSettings={()=>{}} compact={false} refreshAccounts={async()=>{}}/>);
  await waitFor(()=>expect(screen.getByRole('option')).toBeTruthy());
  fireEvent.click(screen.getByRole('option'));
  const iframe=await waitFor(()=>{
    const node=container.querySelector('iframe');
    expect(node).not.toBeNull();
    return node!;
  });
  await waitFor(()=>expect(screen.getByRole('button',{name:'恢复正文大小'}).textContent).toBe('130%'));
  await waitFor(()=>expect(iframe.getAttribute('srcdoc')).toContain('html{zoom:1.30}'));
});
it('slot 分流符合 workspace-sidebar 与完整页面契约',()=>{expect(resolveSlot({...ctx,slot:'workspace-sidebar'})).toBe('sidebar');expect(resolveSlot({...ctx,view:'mail'})).toBe('mail');expect(resolveSlot({...ctx,slot:'settings'})).toBe('settings');expect(resolveSlot(ctx)).toBe('translate');});
it('剪贴板失败时保留选区并提示手动复制',async()=>{const element=document.createElement('div');element.tabIndex=0;element.textContent='译文';document.body.append(element);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:vi.fn(async()=>{throw Error('blocked');})}});Object.defineProperty(document,'execCommand',{configurable:true,value:()=>false});expect(await copyText('译文',element,ctx)).toBe(false);expect(window.getSelection()!.toString()).toBe('译文');expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('Ctrl/⌘+C'));element.remove();});
it('RPC 入参剔除 undefined，避免宿主 JSON 校验拒绝',async()=>{
  const inputs:any[]=[],cleanCtx:any={...ctx,rpc:{call:vi.fn(async(_name:string,input:any)=>{inputs.push(input);return {ok:true,data:{}};})}};
  await call(cleanCtx,'mail.list',{limit:20,cursor:undefined,accountIds:undefined,__owner:'inbox'});
  expect(inputs[0]).toEqual({limit:20,__owner:'inbox',__requestId:expect.any(String)});
  expect('cursor' in inputs[0]).toBe(false);
});
it('邮箱授权码提交到 mail.account.add；连接失败仍保留输入并刷新账号',async()=>{
  const calls:any[]=[],mailCtx:any={...ctx,rpc:{call:vi.fn(async(name:string,input:any)=>{calls.push({name,input});return name==='mail.account.add'?{ok:false,error:{code:'AUTH_FAILED',message:'授权失败，请核对授权码或翻译密钥',retryable:false}}:{ok:true,data:{}};})},ui:{...ctx.ui,notify:vi.fn(),confirm:vi.fn(async()=>true)}};
  const data:any={providers:[],accounts:[],languages:[],vaultWarning:false},refresh=vi.fn(async()=>{});
  render(<MailSettings ctx={mailCtx} data={data} refresh={refresh}/>);
  fireEvent.change(screen.getByLabelText('邮箱地址'),{target:{value:'mailtest@163.com'}});
  fireEvent.change(screen.getByLabelText('客户端授权码'),{target:{value:'fixture-auth-code'}});
  fireEvent.click(screen.getByRole('button',{name:'校验并保存'}));
  await waitFor(()=>expect(calls.some(call=>call.name==='mail.account.add')).toBe(true));
  expect(calls.find(call=>call.name==='mail.account.add').input).toMatchObject({provider:'163',address:'mailtest@163.com',secret:'fixture-auth-code'});
  await waitFor(()=>expect(refresh).toHaveBeenCalled());
  expect((screen.getByLabelText('客户端授权码') as HTMLInputElement).value).toBe('fixture-auth-code');
  expect(screen.getByText(/授权码已保存/)).toBeTruthy();
});
it('沙箱 iframe 不依赖原生表单提交：回车与按钮均直接调用 RPC',async()=>{
  const calls:any[]=[],sandboxCtx:any={...ctx,rpc:{call:vi.fn(async(name:string,input:any)=>{calls.push({name,input});return {ok:true,data:{}};})}};
  const data:any={providers:[{id:'hostModel',configured:true}],accounts:[],languages:[],vaultWarning:false};
  const mail=render(<MailSettings ctx={sandboxCtx} data={data} refresh={async()=>{}}/>);
  expect(mail.container.querySelector('form')).toBeNull();
  expect(screen.getByRole('button',{name:'校验并保存'}).getAttribute('type')).toBe('button');
  fireEvent.change(screen.getByLabelText('邮箱地址'),{target:{value:'mailtest@163.com'}});
  fireEvent.change(screen.getByLabelText('客户端授权码'),{target:{value:'fixture-auth-code'}});
  fireEvent.keyDown(screen.getByLabelText('客户端授权码'),{key:'Enter'});
  await waitFor(()=>expect(calls.some(call=>call.name==='mail.account.add')).toBe(true));
  cleanup();
  const translate=render(<TranslationSettings ctx={sandboxCtx} data={data} refresh={async()=>{}} onSelection={()=>{}}/>);
  expect(translate.container.querySelector('form')).toBeNull();
  expect(screen.getByRole('button',{name:'保存设置'}).getAttribute('type')).toBe('button');
});
it('自建邮箱表单提交 IMAP/SMTP 主机、端口与登录名',async()=>{
  const calls:any[]=[],customCtx:any={...ctx,rpc:{call:vi.fn(async(name:string,input:any)=>{calls.push({name,input});return {ok:true,data:{}};})}};
  const data:any={providers:[],accounts:[],languages:[],vaultWarning:false};
  render(<MailSettings ctx={customCtx} data={data} refresh={async()=>{}}/>);
  choose('邮箱服务商',/自建邮箱/);
  fireEvent.change(screen.getByLabelText('邮箱地址'),{target:{value:'me@self.example'}});
  fireEvent.change(screen.getByLabelText('邮箱密码'),{target:{value:'mail-password'}});
  fireEvent.change(screen.getByLabelText('登录用户名（默认邮箱地址）'),{target:{value:'self-user'}});
  fireEvent.change(screen.getByLabelText('IMAP 服务器'),{target:{value:'mail.self.example'}});
  fireEvent.change(screen.getByLabelText('SMTP 服务器'),{target:{value:'smtp.self.example'}});
  fireEvent.change(screen.getByLabelText('SMTP 端口'),{target:{value:'587'}});
  fireEvent.click(screen.getByRole('button',{name:'校验并保存'}));
  await waitFor(()=>expect(calls.some(call=>call.name==='mail.account.add')).toBe(true));
  expect(calls.find(call=>call.name==='mail.account.add').input).toMatchObject({
    provider:'custom',address:'me@self.example',username:'self-user',
    imap:{host:'mail.self.example',port:993,secure:true},smtp:{host:'smtp.self.example',port:587,secure:false},
  });
});
it('邮箱账号卡片可修改本地别名',async()=>{
  const calls:any[]=[];
  const renameCtx:any={...ctx,rpc:{call:vi.fn(async(name:string,input:any)=>{calls.push({name,input});return {ok:true,data:{}};})},
    ui:{...ctx.ui,notify:vi.fn()}};
  const data:any={providers:[],accounts:[{id:'a1',provider:'163',address:'me@example.com',alias:'163',colorToken:'a1',state:{status:'connected'},createdAt:0}],languages:[],vaultWarning:false};
  const refresh=vi.fn(async()=>{});
  const {container}=render(<MailSettings ctx={renameCtx} data={data} refresh={refresh}/>);
  const card=container.querySelector('.settings-account') as HTMLElement;
  fireEvent.click(within(card).getByRole('button',{name:'修改别名'}));
  fireEvent.change(within(card).getByLabelText('账号别名（最多 6 字）'),{target:{value:'工作号'}});
  fireEvent.click(within(card).getByRole('button',{name:'保存'}));
  await waitFor(()=>expect(calls.some(call=>call.name==='mail.account.rename'&&call.input.accountId==='a1'&&call.input.alias==='工作号')).toBe(true));
  expect(refresh).toHaveBeenCalled();
});
it('独立设置页分区导航：默认邮箱账号，翻译设置单独进入',async()=>{
  const data:any={providers:[{id:'hostModel',configured:true}],accounts:[],languages:[],vaultWarning:false};
  const {container}=render(<Settings ctx={ctx} data={data} refresh={async()=>{}} onSelection={()=>{}}/>);
  expect(container.querySelector('.settings-layout')).not.toBeNull();
  expect(screen.getByRole('navigation',{name:'设置分区'})).toBeTruthy();
  expect(screen.getByLabelText('邮箱地址')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'翻译服务'}));
  await waitFor(()=>expect(screen.getByLabelText('翻译供应商')).toBeTruthy());
});
it('设置页跟随外部 section 查询切换分区',async()=>{
  const data:any={providers:[{id:'hostModel',configured:true}],accounts:[],languages:[],vaultWarning:false};
  const navCtx:any={...ctx,location:{path:'settings',query:{section:'mail'}},
    rpc:{call:vi.fn(async(name:string)=>name==='settings.get'?{ok:true,data:{provider:'hostModel',glossary:[],selection:true}}:{ok:true,data:{}})}};
  const view=render(<Settings ctx={navCtx} data={data} refresh={async()=>{}} onSelection={()=>{}}/>);
  expect(screen.getByLabelText('邮箱地址')).toBeTruthy();
  navCtx.location={path:'settings',query:{section:'translate'}};
  view.rerender(<Settings ctx={navCtx} data={data} refresh={async()=>{}} onSelection={()=>{}}/>);
  await waitFor(()=>expect(screen.getByLabelText('翻译供应商')).toBeTruthy());
});
it('iOS 标题桥截断旧保存请求，但不会截断新保存请求',async()=>{
  applyAppearance(appearanceDefaults,{desktop:'',mobile:''});
  const channel='c'.repeat(64),diagnostics='as-123456abcdef';
  function titleLength(name:string,input:unknown){
    const text=JSON.stringify({channel,type:'request',id:12345,method:'rpc',args:{name,input}});
    return `ekko-plugin://${channel}/12345/${encodeURIComponent(JSON.stringify({id:12345,part:0,total:1,text}))}#12345`.length;
  }
  expect(titleLength('appearance.get',{__requestId:diagnostics})).toBeLessThan(1000);
  expect(titleLength('appearance.save',{...appearanceDefaults,__requestId:diagnostics})).toBeGreaterThan(1000);
  const rpc=vi.fn(async(name:string,input:unknown)=>name==='appearance.save'
    ?titleLength(name,input)<=1000?{ok:true,data:{saved:true}}:new Promise(()=>{})
    :{ok:true,data:{settings:{...appearanceDefaults,followStudio:false}}});
  const {container}=render(<AppearanceSettings ctx={{...ctx,rpc:{call:rpc}}}/>);
  try{
    fireEvent.click(await screen.findByRole('button',{name:'深色'}));
    fireEvent.click(screen.getByRole('button',{name:'保存外观'}));
    expect((await within(container.querySelector<HTMLElement>('.appearance-footer')!).findByRole('status')).textContent).toBe('外观设置已保存');
  }finally{applyAppearance(appearanceDefaults,{desktop:'',mobile:''});}
});
it('外观保存入口就近显示失败，重试时仍提交原修改',async()=>{
  applyAppearance(appearanceDefaults,{desktop:'',mobile:''});
  const save=vi.fn()
    .mockResolvedValueOnce({ok:false,error:{code:'TIMEOUT',message:'保存超时',retryable:true}})
    .mockResolvedValueOnce({ok:true,data:{saved:true}});
  const appearanceCtx={...ctx,rpc:{call:vi.fn(async(name:string,input:any)=>name==='appearance.save'
    ?save(input):{ok:true,data:{settings:{...appearanceDefaults,followStudio:false}}})}};
  const {container}=render(<AppearanceSettings ctx={appearanceCtx}/>);
  try{
    await screen.findByRole('button',{name:'深色'});
    fireEvent.click(screen.getByRole('button',{name:'深色'}));
    const actions=within(container.querySelector<HTMLElement>('.appearance-footer')!);
    fireEvent.click(actions.getByRole('button',{name:'保存外观'}));
    expect((await actions.findByRole('alert')).textContent).toContain('TIMEOUT');
    expect(actions.queryByRole('status')).toBeNull();
    fireEvent.click(actions.getByRole('button',{name:'保存外观'}));
    expect((await actions.findByRole('status')).textContent).toBe('外观设置已保存');
    expect(actions.queryByRole('alert')).toBeNull();
    expect(save.mock.calls.map(([input])=>decodeAppearanceSave(input.wire).colorScheme)).toEqual(['dark','dark']);
  }finally{applyAppearance(appearanceDefaults,{desktop:'',mobile:''});}
});
it('外观保存未收到回包时退出等待并允许重试，忽略迟到的回包',async()=>{
  applyAppearance(appearanceDefaults,{desktop:'',mobile:''});
  let finishFirst!: (response:{ok:true;data:{saved:true}})=>void;
  const first=new Promise(resolve=>{finishFirst=resolve;});
  const saved={ok:true,data:{saved:true}} as const;
  const save=vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(saved);
  const rpc=vi.fn(async(name:string,input:any)=>name==='appearance.save'?save(input)
    :{ok:true,data:{settings:{...appearanceDefaults,followStudio:false}}});
  const notify=vi.fn();
  const {container}=render(<AppearanceSettings ctx={{...ctx,rpc:{call:rpc},ui:{...ctx.ui,notify}}}/>);
  try{
    fireEvent.click(await screen.findByRole('button',{name:'深色'}));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button',{name:'保存外观'}));
    expect((screen.getByRole('button',{name:'正在保存…'}) as HTMLButtonElement).disabled).toBe(true);
    await act(()=>vi.advanceTimersByTimeAsync(15_000));
    expect(screen.getByRole('alert').textContent).toContain('TIMEOUT');
    const diagnosticId=save.mock.calls[0][0].__requestId;
    expect(diagnosticId).toMatch(/^as-[a-f0-9]{12}$/);
    expect(screen.getByRole('alert').textContent).toContain(diagnosticId);
    expect(rpc).toHaveBeenCalledWith('appearance.get',{__requestId:`${diagnosticId}-check`});
    expect((screen.getByRole('button',{name:'保存外观'}) as HTMLButtonElement).disabled).toBe(false);
    expect(rpc).toHaveBeenCalledWith('app.cancel',{requestId:diagnosticId});
    await act(async()=>finishFirst(saved));
    expect(notify).not.toHaveBeenCalled();
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'保存外观'}));});
    expect(within(container.querySelector<HTMLElement>('.appearance-footer')!).getByRole('status').textContent).toBe('外观设置已保存');
    expect(save.mock.calls.map(([input])=>decodeAppearanceSave(input.wire).colorScheme)).toEqual(['dark','dark']);
  }finally{
    vi.useRealTimers();applyAppearance(appearanceDefaults,{desktop:'',mobile:''});
  }
});
it('丢失保存回包但读回一致时确认成功，不重新发送写入或读取壁纸',async()=>{
  applyAppearance(appearanceDefaults,{desktop:'',mobile:''});
  let persisted:unknown={...appearanceDefaults,followStudio:false};
  let hasBackground=false;
  const rpc=vi.fn(async(name:string,input:any)=>{
    if(name==='appearance.save'){
      persisted={...decodeAppearanceSave(input.wire),backgroundName:'desktop.jpg'};
      hasBackground=true;
      return new Promise(()=>{});
    }
    return {ok:true,data:{settings:persisted,hasBackground}};
  });
  const notify=vi.fn();
  const {container}=render(<AppearanceSettings ctx={{...ctx,rpc:{call:rpc},ui:{...ctx.ui,notify}}}/>);
  try{
    fireEvent.click(await screen.findByRole('button',{name:'深色'}));
    rpc.mockClear();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button',{name:'保存外观'}));
    await act(()=>vi.advanceTimersByTimeAsync(15_000));
    expect(within(container.querySelector<HTMLElement>('.appearance-footer')!).getByRole('status').textContent).toBe('外观设置已保存');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(rpc.mock.calls.map(([name])=>name)).toEqual(['appearance.save','app.cancel','appearance.get']);
  }finally{
    vi.useRealTimers();applyAppearance(appearanceDefaults,{desktop:'',mobile:''});
  }
});
it('移动背景的分块回包丢失时退出上传，不误显示正在保存外观',async()=>{
  applyAppearance(appearanceDefaults,{desktop:'',mobile:''});
  const rpc=vi.fn(async(name:string)=>{
    if(name==='appearance.background-start')return {ok:true,data:{uploadId:'upload'}};
    if(name==='appearance.background-chunk')return new Promise(()=>{});
    return {ok:true,data:{settings:{...appearanceDefaults,followStudio:false}}};
  });
  const notify=vi.fn();
  const {container}=render(<AppearanceSettings ctx={{...ctx,rpc:{call:rpc},ui:{...ctx.ui,notify}}}/>);
  try{
    await screen.findByRole('button',{name:'深色'});
    const bytes=new Uint8Array([0xff,0xd8,0xff,0xdb]);
    vi.spyOn(Blob.prototype,'arrayBuffer').mockResolvedValue(bytes.buffer);
    vi.useFakeTimers();
    const files=[new File([bytes],'phone.jpg',{type:'image/jpeg'})];
    await act(async()=>{fireEvent.change(container.querySelectorAll('input[type=file]')[1],{target:{files}});});
    expect(rpc).toHaveBeenCalledWith('appearance.background-chunk',expect.any(Object));
    expect(screen.getByRole('button',{name:'正在上传…'})).toBeTruthy();
    expect(screen.queryByRole('button',{name:'正在保存…'})).toBeNull();
    await act(()=>vi.advanceTimersByTimeAsync(15_000));
    expect(screen.getByRole('alert').textContent).toContain('TIMEOUT');
    expect(screen.queryByRole('button',{name:'正在上传…'})).toBeNull();
    expect((screen.getByRole('button',{name:'保存外观'}) as HTMLButtonElement).disabled).toBe(false);
  }finally{
    vi.useRealTimers();applyAppearance(appearanceDefaults,{desktop:'',mobile:''});
  }
});

it('新邮件事件只刷新一次列表，且无部分失败时不显示 0/N 提示',async()=>{
  const account:any={id:'a1',provider:'163',address:'a@example.com',alias:'163',colorToken:'a1',state:{status:'connected'},createdAt:0};
  const calls=vi.fn(async(name:string)=>({ok:true,data:name==='mail.list'?{items:[],partial:[],updated:0,total:1}:{}}));
  let arrived:(event:any)=>void=()=>{};
  const mailCtx:any={...ctx,rpc:{call:calls},messages:{on:(type:string,fn:(event:any)=>void)=>{if(type==='mail.arrived')arrived=fn;return()=>{};}}};
  render(<Mail ctx={mailCtx} accounts={[account]} target="zh" onSettings={()=>{}} compact={false} refreshAccounts={async()=>{}}/>);
  await waitFor(()=>expect(calls.mock.calls.filter((c:any)=>c[0]==='mail.list')).toHaveLength(1));
  expect(screen.queryByText('0/1 个账号已更新')).toBeNull();
  arrived({data:{accountId:'a1',count:1}});
  await waitFor(()=>expect(calls.mock.calls.filter((c:any)=>c[0]==='mail.list').length).toBeGreaterThanOrEqual(2));
});
it('邮件三栏布局：文件夹、列表与右侧阅读窗格',async()=>{
  const account:any={id:'a1',provider:'163',address:'a@example.com',alias:'163',colorToken:'a1',state:{status:'connected'},createdAt:0};
  const summary:any={accountId:'a1',messageId:'m1',from:{name:'Sender',address:'s@example.com'},to:[{address:'a@example.com'}],cc:[],subject:'主题',snippet:'摘要',date:0,unread:true,hasAttachments:false};
  const message:any={accountId:'a1',messageId:'m1',from:summary.from,to:summary.to,cc:[],subject:'主题',date:0,text:'正文',attachments:[],remoteContentBlocked:false};
  const navigate=vi.fn(),mailCtx:any={...ctx,ui:{...ctx.ui,navigate},rpc:{call:vi.fn(async(name:string)=>name==='mail.list'?{ok:true,data:{items:[summary],partial:[],updated:1,total:1}}:name==='mail.get'?{ok:true,data:message}:{ok:true,data:{}})}};
  const {container}=render(<Mail ctx={mailCtx} accounts={[account]} target="zh" onSettings={()=>{}} compact={false} refreshAccounts={async()=>{}}/>);
  await waitFor(()=>expect(container.querySelector('.mail-row')).not.toBeNull());
  const row=container.querySelector('.mail-row')!, top=row.querySelector('.mail-row-top')!, body=row.querySelector('.mail-row-body')!;
  expect(top.querySelector('.source')).toBeTruthy();
  expect(top.compareDocumentPosition(body)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const folders=screen.getByRole('navigation',{name:'邮件文件夹'});
  expect(within(folders).getAllByRole('button').map(item=>item.querySelector('span')?.textContent)).toEqual(['收件箱','未读','有附件','写邮件','草稿箱']);
  expect(within(folders).getByRole('button',{name:'写邮件'})).toBeTruthy();
  expect(container.querySelector('.mail-list-head .mail-write')).toBeNull();
  const folderIcons=['收件箱','草稿箱','有附件'].map(text=>within(folders).getByRole('button',{name:new RegExp(`^${text}`)}).querySelector('svg[aria-hidden="true"] path')?.getAttribute('d'));
  expect(folderIcons.every(Boolean)).toBe(true);
  expect(new Set(folderIcons).size).toBe(3);
  expect(container.querySelector('.mail-list-pane')).not.toBeNull();
  expect(container.querySelector('.mail-list-pane .sbar')).toBeNull();
  expect(container.querySelector('.reader-empty')).not.toBeNull();
  fireEvent.click(screen.getByRole('option'));
  await waitFor(()=>expect(container.querySelector('.mail-reader-pane .detail')).not.toBeNull());
  expect(navigate).not.toHaveBeenCalled();
});
it('切换账号筛选时关闭已打开邮件详情',async()=>{
  const account:any={id:'a1',provider:'163',address:'a@example.com',alias:'163',colorToken:'a1',state:{status:'connected'},createdAt:0};
  const summary:any={accountId:'a1',messageId:'m1',from:{name:'Sender',address:'s@example.com'},to:[{address:'a@example.com'}],cc:[],subject:'主题',snippet:'摘要',date:0,unread:false,hasAttachments:false};
  const message:any={accountId:'a1',messageId:'m1',from:summary.from,to:summary.to,cc:[],subject:'主题',date:0,text:'正文',attachments:[],remoteContentBlocked:false};
  const mailCtx:any={...ctx,rpc:{call:vi.fn(async(name:string)=>name==='mail.list'?{ok:true,data:{items:[summary],partial:[],updated:1,total:1}}:name==='mail.get'?{ok:true,data:message}:{ok:true,data:{}})}};
  const {container}=render(<Mail ctx={mailCtx} accounts={[account]} target="zh" onSettings={()=>{}} compact={false} refreshAccounts={async()=>{}}/>);
  await waitFor(()=>expect(screen.getByRole('option')).toBeTruthy());
  fireEvent.click(screen.getByRole('option'));
  await waitFor(()=>expect(container.querySelector('.mail-reader-pane .detail')).not.toBeNull());
  fireEvent.click(container.querySelector('.folder-accounts button') as HTMLButtonElement);
  await waitFor(()=>expect(container.querySelector('.reader-empty')).not.toBeNull());
});
it('邮件列表滚动到底部自动加载，且不显示加载更多和正文占位提示',async()=>{
  const account:any={id:'a1',provider:'163',address:'a@example.com',alias:'163',colorToken:'a1',state:{status:'connected'},createdAt:0};
  const first=Array.from({length:20},(_,i)=>({accountId:'a1',messageId:'m'+i,from:{name:'Sender',address:'s@example.com'},subject:'主题'+i,snippet:i===0?'打开查看正文':'',date:20-i,unread:false,hasAttachments:false}));
  const second=[{accountId:'a1',messageId:'m20',from:{name:'Sender',address:'s@example.com'},subject:'主题20',snippet:'',date:0,unread:false,hasAttachments:false}];
  const calls:any[]=[];
  const mailCtx:any={...ctx,rpc:{call:vi.fn(async(name:string,input:any)=>{
    calls.push({name,input});
    if(name==='mail.list')return {ok:true,data:input.cursor
      ?{items:second,partial:[],updated:0,total:1}
      :{items:first,nextCursor:'20',partial:[],updated:1,total:1}};
    return {ok:true,data:{}};
  })}};
  const {container}=render(<Mail ctx={mailCtx} accounts={[account]} target="zh" onSettings={()=>{}} compact={false} refreshAccounts={async()=>{}}/>);
  await waitFor(()=>expect(container.querySelectorAll('.mail-row')).toHaveLength(20));
  expect(screen.queryByText('打开查看正文')).toBeNull();
  expect(screen.queryByRole('button',{name:'加载更多'})).toBeNull();
  fireEvent.scroll(screen.getByRole('listbox',{name:'邮件列表'}));
  await waitFor(()=>expect(calls.some(call=>call.name==='mail.list'&&call.input.cursor==='20')).toBe(true));
});
it('未读为零时不再观察列表底部或翻查已读邮件，返回收件箱仍可加载',async()=>{
  const account={id:'a1',provider:'163',address:'a@example.com',alias:'163',colorToken:'a1',state:{status:'connected',checkedAt:0},createdAt:0} as const;
  const read={accountId:'a1',messageId:'read',from:{address:'s@example.com'},subject:'已读邮件',snippet:'',date:1,unread:false,hasAttachments:false};
  const observe=vi.fn(),disconnect=vi.fn();
  let intersect=()=>{};
  vi.stubGlobal('IntersectionObserver',class {
    constructor(notify:IntersectionObserverCallback){intersect=()=>notify([{isIntersecting:true} as IntersectionObserverEntry],this as unknown as IntersectionObserver);}
    observe=observe;
    disconnect=disconnect;
  });
  try{
    const rpc=vi.fn(async(name:string,input:{cursor?:string})=>({ok:true,data:name==='mail.list'
      ?{items:[input.cursor?{...read,messageId:'older',subject:'更早的邮件'}:read],...(!input.cursor?{nextCursor:'20'}:{}),updated:0,total:1,unreadByAccount:{}}:{}}));
    const {container}=render(<Mail ctx={{...ctx,rpc:{call:rpc}}} accounts={[account]} target="zh" onSettings={()=>{}} refreshAccounts={async()=>{}}/>);
    await screen.findByRole('option');
    expect(observe).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'未读 0'}));
    expect(screen.getByText('没有符合条件的邮件')).toBeTruthy();
    intersect();
    fireEvent.scroll(screen.getByRole('listbox',{name:'邮件列表'}));
    expect(rpc.mock.calls.filter(([name])=>name==='mail.list')).toHaveLength(1);
    expect(disconnect).toHaveBeenCalled();
    expect(container.querySelector('.mail-list-sentinel,.mail-loading-more')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:/^收件箱/}));
    intersect();
    await screen.findByRole('option',{name:/更早的邮件/});
  }finally{vi.unstubAllGlobals();}
});
it('有未读邮件不在当前页时继续加载，已找到全部未读后停止',async()=>{
  const account={id:'a1',provider:'163',address:'a@example.com',alias:'163',colorToken:'a1',state:{status:'connected',checkedAt:0},createdAt:0} as const;
  const read={accountId:'a1',messageId:'read',from:{address:'s@example.com'},subject:'已读邮件',snippet:'',date:1,unread:false,hasAttachments:false};
  const olderUnread={...read,messageId:'unread',subject:'更早的未读',unread:true};
  const rpc=vi.fn(async(name:string,input:{cursor?:string})=>({ok:true,data:name==='mail.list'
    ?{items:input.cursor?[olderUnread]:[read],nextCursor:input.cursor?'40':'20',updated:0,total:1,unreadByAccount:{a1:1}}:{}}));
  render(<Mail ctx={{...ctx,rpc:{call:rpc}}} accounts={[account]} target="zh" onSettings={()=>{}} refreshAccounts={async()=>{}}/>);
  await screen.findByRole('option');
  fireEvent.click(screen.getByRole('button',{name:'未读 1'}));
  const list=screen.getByRole('listbox',{name:'邮件列表'});
  fireEvent.scroll(list);
  await screen.findByRole('option',{name:/更早的未读/});
  fireEvent.scroll(list);
  expect(rpc.mock.calls.filter(([name])=>name==='mail.list').map(([,input])=>input.cursor)).toEqual([undefined,'20']);
});
it('详情页原地回复走 mail.reply，不切换页面',async()=>{
  const account:any={id:'a1',provider:'163',address:'a@example.com',alias:'163',colorToken:'a1',state:{status:'connected'},createdAt:0};
  const summary:any={accountId:'a1',messageId:'m1',from:{name:'Sender',address:'s@example.com'},to:[{address:'a@example.com'}],cc:[],subject:'主题',snippet:'摘要',date:0,unread:false,hasAttachments:false};
  const message:any={accountId:'a1',messageId:'m1',from:summary.from,to:summary.to,cc:[],subject:'主题',date:0,text:'正文',attachments:[],remoteContentBlocked:false,unread:false};
  const calls:any[]=[],replyCtx:any={...ctx,ui:{...ctx.ui,navigate:vi.fn(),notify:vi.fn()},rpc:{call:vi.fn(async(name:string,input:any)=>{calls.push({name,input});return {ok:true,data:name==='mail.list'?{items:[summary],partial:[],updated:1,total:1}:name==='mail.get'?message:name==='mail.reply'?{sent:true}:{}};})}};
  render(<Mail ctx={replyCtx} accounts={[account]} target="zh" onSettings={()=>{}} compact={false} refreshAccounts={async()=>{}}/>);
  await waitFor(()=>expect(screen.getByRole('option')).toBeTruthy());
  fireEvent.click(screen.getByRole('option'));
  await waitFor(()=>expect(screen.getByRole('button',{name:'回复'})).toBeTruthy());
  fireEvent.click(screen.getByRole('button',{name:'回复'}));
  fireEvent.change(screen.getByLabelText('回复内容'),{target:{value:'收到，谢谢'}});
  fireEvent.click(screen.getByRole('button',{name:'发送'}));
  await waitFor(()=>expect(replyCtx.ui.notify).toHaveBeenCalledWith('发件服务器已接收回复','success'));
  expect(calls.find(call=>call.name==='mail.reply').input).toMatchObject({accountId:'a1',messageId:'m1',body:'收到，谢谢'});
  expect(replyCtx.ui.navigate).not.toHaveBeenCalled();
});
it('手机端删除邮件先确认，失败保留详情，成功返回更新后的列表',async()=>{
  setViewport(320);
  const account={id:'a1',provider:'163',address:'a@example.com',alias:'163',colorToken:'a1',state:{status:'connected',checkedAt:0},createdAt:0} as const;
  const summary={accountId:account.id,messageId:'m1',from:{address:'s@example.com'},subject:'主题',snippet:'摘要',date:0,unread:true,hasAttachments:false};
  const message={...summary,unread:false,to:[],cc:[],text:'正文',attachments:[],remoteContentBlocked:false};
  let attempts=0,deleted=false;
  const confirm=vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true),notify=vi.fn();
  const rpc=vi.fn(async(name:string,_input:any)=>{
    if(name==='mail.list')return {ok:true,data:{items:deleted?[]:[summary],updated:1,total:1,unreadByAccount:{a1:deleted?0:1}}};
    if(name==='mail.get')return {ok:true,data:message};
    if(name==='mail.delete'){
      if(++attempts===1)return {ok:false,error:{code:'MAIL_DELETE_FAILED',message:'邮箱暂不可用',retryable:false}};
      deleted=true;return {ok:true,data:{deleted:true}};
    }
    return {ok:true,data:{}};
  });
  const onUnread=vi.fn(),mailCtx:any={...ctx,ui:{...ctx.ui,confirm,notify},rpc:{call:rpc}};
  render(<Mail ctx={mailCtx} accounts={[account]} target="zh" onSettings={()=>{}} refreshAccounts={async()=>{}} onUnread={onUnread}/>);
  fireEvent.click(await screen.findByRole('option'));
  const remove=await screen.findByRole('button',{name:'删除邮件'});
  fireEvent.click(remove);
  await waitFor(()=>expect((remove as HTMLButtonElement).disabled).toBe(false));
  expect(confirm).toHaveBeenCalledWith('将这封邮件移到邮箱垃圾箱？');
  expect(attempts).toBe(0);
  fireEvent.click(remove);
  expect((await screen.findByRole('alert')).textContent).toContain('邮箱暂不可用');
  expect(screen.getByText('正文')).toBeTruthy();
  fireEvent.click(remove);
  await waitFor(()=>expect(screen.queryByRole('button',{name:'删除邮件'})).toBeNull());
  expect(screen.queryByRole('option')).toBeNull();
  expect(rpc).toHaveBeenCalledWith('mail.delete',expect.objectContaining({accountId:'a1',messageId:'m1'}));
  expect(onUnread).toHaveBeenLastCalledWith(0);
  expect(notify).toHaveBeenCalledWith('已移到垃圾箱','success');
});
it('正文编辑和 Markdown 预览共用主框，切换后保留原文',()=>{
  render(<MailCompose ctx={ctx} accounts={[]} draftId={null} defaultAccount="" onChange={()=>{}} onClose={()=>{}}/>);
  const frame=screen.getByLabelText('正文').closest('.compose-body-frame')!;
  expect(screen.queryByRole('button',{name:'预览'})).toBeNull();
  choose('正文格式','Markdown');
  const modes=screen.getByRole('group',{name:'正文视图'});
  const preview=within(modes).getByRole('button',{name:'预览'}),edit=within(modes).getByRole('button',{name:'编辑'});
  fireEvent.click(preview);
  expect(preview.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('还没有正文可预览')).toBeTruthy();
  expect(screen.queryByRole('group',{name:'正文格式工具'})).toBeNull();
  fireEvent.click(edit);
  const body=screen.getByLabelText<HTMLTextAreaElement>('正文');
  const markdown='## 本周进度\n\n- **已完成**\n\n> 等待确认\n\n`ticket-42`';
  fireEvent.change(body,{target:{value:markdown}});
  fireEvent.click(preview);
  const region=screen.getByRole('region',{name:'正文预览'});
  expect(region.closest('.compose-body-frame')).toBe(frame);
  expect(within(region).getByRole('heading',{name:'本周进度'})).toBeTruthy();
  expect(region.querySelector('li strong')?.textContent).toBe('已完成');
  expect(region.querySelector('blockquote')?.textContent).toBe('等待确认');
  expect(region.querySelector('code')?.textContent).toBe('ticket-42');
  fireEvent.click(edit);
  expect(edit.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByLabelText<HTMLTextAreaElement>('正文').value).toBe(markdown);
  fireEvent.click(preview);
  choose('正文格式','纯文本');
  expect(screen.queryByRole('region',{name:'正文预览'})).toBeNull();
  expect(screen.getByLabelText<HTMLTextAreaElement>('正文').value).toBe(markdown);
});

it('iOS 写邮件的 Markdown 预览与文件分片可保存，重开后可移除附件',async()=>{
  vi.spyOn(navigator,'userAgent','get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
  const account={id:'a1',provider:'163',address:'me@example.com',alias:'邮件',colorToken:'a1',state:{status:'connected',checkedAt:0},createdAt:0} as const;
  const chunks=new Map<string,Buffer>(),channel='c'.repeat(128);
  let draft:any,sequence=123456789;
  const rpc=vi.fn(async(name:string,input:any)=>{
    const id=sequence++,text=JSON.stringify({channel,type:'request',id,method:'rpc',args:{name,input}});
    expect(`ekko-plugin://${channel}/${id}/${encodeURIComponent(JSON.stringify({id,part:0,total:1,text}))}#${id}`.length).toBeLessThanOrEqual(1000);
    if(name==='mail.draft.upload-start'){const uploadId=String(id).padStart(36,'0');chunks.set(uploadId,Buffer.alloc(0));return {ok:true,data:{uploadId}};}
    if(name==='mail.draft.upload-chunk'){
      const [uploadId,offset,encoded]=input.wire.split('!'),previous=chunks.get(uploadId)!;
      expect(Number.parseInt(offset,36)).toBe(previous.length);
      const data=Buffer.concat([previous,Buffer.from(encoded,'base64url')]);
      chunks.set(uploadId,data);return {ok:true,data:{received:data.length}};
    }
    if(name==='mail.draft.commit'||name==='mail.draft.save'){
      const snapshot=name==='mail.draft.commit'?JSON.parse(chunks.get(input.uploadId)!.toString('utf8')):input;
      const {accountId,to,subject,body,format,attachments}=snapshot;
      draft={id:'d1',accountId,to,subject,body,format,updatedAt:0,attachments:attachments.map((file:any)=>({...file,bytes:chunks.get(file.id)!.length}))};
    }
    return {ok:true,data:draft};
  });
  const props={ctx:{...ctx,rpc:{call:rpc}},accounts:[account],defaultAccount:'a1',onChange:vi.fn(),onClose:vi.fn()};
  const view=render(<MailCompose {...props} draftId={null}/>);
  choose('正文格式','Markdown');
  const editor=screen.getByLabelText<HTMLTextAreaElement>('正文');
  fireEvent.change(editor,{target:{value:'重点\n'+'段落。'.repeat(90)}});
  editor.setSelectionRange(0,2);
  fireEvent.click(screen.getByRole('button',{name:'加粗'}));
  fireEvent.click(screen.getByRole('button',{name:'预览'}));
  expect(screen.getByRole('region',{name:'正文预览'}).querySelector('strong')?.textContent).toBe('重点');
  fireEvent.change(screen.getByLabelText('选择附件文件'),{target:{files:[new File(['a'.repeat(750)],'记录.txt')]}});
  fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));
  await screen.findByText('已保存到草稿箱');
  expect(rpc.mock.calls.filter(([name])=>name==='mail.draft.upload-chunk').length).toBeGreaterThan(3);
  view.unmount();render(<MailCompose {...props} draftId="d1"/>);
  await screen.findByText('记录.txt');
  expect(screen.getByLabelText('正文格式').textContent).toContain('Markdown');
  fireEvent.click(screen.getByRole('button',{name:'移除附件 记录.txt'}));
  fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));
  await waitFor(()=>expect(draft.attachments).toEqual([]));
});

it('桌面写邮件时可点草稿箱，保存失败时保留编辑，重试成功才切换',async()=>{
  setViewport(1280);
  const account={id:'a1',provider:'163',address:'me@example.com',alias:'邮件',colorToken:'a1',state:{status:'connected',checkedAt:0},createdAt:0} as const;
  let attempts=0,draft:any,finishSave:()=>void=()=>{};
  const rpc=vi.fn(async(name:string,input:any)=>{
    if(name==='mail.list')return {ok:true,data:{items:[],updated:0,total:1}};
    if(name==='mail.draft.save'){
      if(++attempts===1)return {ok:false,error:{code:'INTERNAL',message:'草稿暂时无法保存',retryable:true}};
      await new Promise<void>(resolve=>{finishSave=resolve;});
      draft={...input,id:'d1',updatedAt:0};return {ok:true,data:draft};
    }
    if(name==='mail.draft.list')return {ok:true,data:draft?[draft]:[]};
    if(name==='mail.draft.get')return {ok:true,data:draft};
    return {ok:true,data:{}};
  });
  render(<Mail ctx={{...ctx,rpc:{call:rpc}}} accounts={[account]} target="zh" onSettings={()=>{}} refreshAccounts={async()=>{}}/>);
  const folders=screen.getByRole('navigation',{name:'邮件文件夹'});
  const write=within(folders).getByRole('button',{name:'写邮件'}),drafts=within(folders).getByRole('button',{name:'草稿箱'});
  fireEvent.click(write);
  expect(drafts.closest('[inert]')).toBeNull();
  fireEvent.change(screen.getByLabelText('主题'),{target:{value:'桌面草稿'}});
  const body=screen.getByLabelText<HTMLTextAreaElement>('正文');
  fireEvent.change(body,{target:{value:'这段内容不能丢'}});
  fireEvent.click(drafts);
  await screen.findByText('草稿暂时无法保存');
  expect(body.value).toBe('这段内容不能丢');
  expect(drafts.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(drafts);
  await waitFor(()=>expect(attempts).toBe(2));
  expect(screen.getByText('正在保存草稿…')).toBeTruthy();
  fireEvent.click(within(folders).getByRole('button',{name:/^收件箱/}));
  expect(screen.getByLabelText('正文')).toBe(body);
  await act(async()=>finishSave());
  expect(drafts.getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByLabelText('正文')).toBeNull();
  fireEvent.click(await screen.findByRole('button',{name:/桌面草稿/}));
  expect((await screen.findByLabelText<HTMLTextAreaElement>('正文')).value).toBe('这段内容不能丢');
  fireEvent.click(drafts);
  await screen.findByRole('button',{name:/桌面草稿/});
  expect(attempts).toBe(2);
});

it('手机端可保存草稿、重开编辑并发送，失败时仍显示草稿内容',async()=>{
  setViewport(320);
  const account={id:'a1',provider:'163',address:'a@example.com',alias:'163',colorToken:'a1',state:{status:'connected',checkedAt:0},createdAt:0} as const;
  const accounts=[account,{...account,id:'a2',alias:'工作',address:'work@example.com'}];
  let draft:any, sends=0;
  const notify=vi.fn(),rpc=vi.fn(async(name:string,input:any)=>{
    if(name==='mail.list')return {ok:true,data:{items:[],updated:0,total:2}};
    if(name==='mail.draft.save'){
      const {accountId,to,subject,body}=input;
      draft={id:'d1',accountId,to,subject,body,updatedAt:0};return {ok:true,data:draft};
    }
    if(name==='mail.draft.list')return {ok:true,data:draft?[draft]:[]};
    if(name==='mail.draft.get')return {ok:true,data:draft};
    if(name==='mail.draft.delete'){draft=undefined;return {ok:true,data:{deleted:true}};}
    if(name==='mail.send'){
      if(++sends===1)return {ok:false,error:{code:'SEND_FAILED',message:'SMTP 拒绝发送',retryable:false}};
      draft=undefined;return {ok:true,data:{sent:true}};
    }
    return {ok:true,data:{}};
  });
  const mailCtx:any={...ctx,ui:{...ctx.ui,notify},rpc:{call:rpc}};
  const {container}=render(<Mail ctx={mailCtx} accounts={accounts} target="zh" onSettings={()=>{}} refreshAccounts={async()=>{}}/>);
  const toggle=screen.getByRole('button',{name:'邮箱导航'});
  const folders=container.querySelector<HTMLElement>('.mail-folders')!;
  expect(folders.hasAttribute('inert')).toBe(true);
  fireEvent.click(toggle);
  expect(folders.hasAttribute('inert')).toBe(false);
  const write=within(folders).getByRole('button',{name:'写邮件'});
  expect(within(write).getByText('写邮件')).toBeTruthy();
  fireEvent.click(write);
  expect(container.querySelector('.mail-client.has-selection.is-composing')).not.toBeNull();
  expect(container.querySelector('.mail-list-pane')?.hasAttribute('inert')).toBe(true);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  choose('发件账号',/work@example.com/);
  fireEvent.change(screen.getByLabelText('收件人'),{target:{value:'recipient@example.invalid'}});
  fireEvent.change(screen.getByLabelText('主题'),{target:{value:'下周安排'}});
  fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));
  await screen.findByText('已保存到草稿箱');
  fireEvent.click(screen.getByRole('button',{name:'返回'}));
  expect(container.querySelector('.mail-client.is-composing')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'邮箱导航'}));
  fireEvent.click(screen.getByRole('button',{name:'草稿箱'}));
  fireEvent.click(await screen.findByRole('button',{name:/下周安排/}));
  const body=await screen.findByLabelText<HTMLTextAreaElement>('正文');
  fireEvent.change(body,{target:{value:'周一开会'}});
  fireEvent.click(screen.getByRole('button',{name:'发送'}));
  await screen.findByText('SMTP 拒绝发送');
  expect(body.value).toBe('周一开会');
  expect(draft).toMatchObject({id:'d1',accountId:'a2',subject:'下周安排',body:'周一开会'});
  fireEvent.click(screen.getByRole('button',{name:'发送'}));
  await screen.findByText('还没有草稿');
  expect(rpc).toHaveBeenCalledWith('mail.send',expect.objectContaining({id:'d1'}));
  expect(notify).toHaveBeenCalledWith('发件服务器已接收邮件','success');
  fireEvent.click(toggle);
  fireEvent.click(within(folders).getByRole('button',{name:'写邮件'}));
  fireEvent.change(screen.getByLabelText('正文'),{target:{value:'自动保存的正文'}});
  fireEvent.click(screen.getByRole('button',{name:'返回'}));
  fireEvent.click(await screen.findByRole('button',{name:/无主题/}));
  expect((await screen.findByLabelText<HTMLTextAreaElement>('正文')).value).toBe('自动保存的正文');
  fireEvent.click(screen.getByRole('button',{name:'删除草稿'}));
  await screen.findByText('还没有草稿');
  expect(ctx.ui.confirm).toHaveBeenCalledWith('删除这份草稿？');
});
it('打开邮件后列表立即已读，详情可即时切回未读',async()=>{
  const account:any={id:'a1',provider:'163',address:'a@example.com',alias:'163',colorToken:'a1',state:{status:'connected'},createdAt:0};
  const summary:any={accountId:'a1',messageId:'m1',from:{name:'Sender',address:'s@example.com'},to:[{address:'a@example.com'}],cc:[],subject:'主题',snippet:'摘要',date:0,unread:true,hasAttachments:false};
  const message:any={accountId:'a1',messageId:'m1',from:summary.from,to:summary.to,cc:[],subject:'主题',date:0,text:'正文',unread:true,attachments:[],remoteContentBlocked:false};
  const calls:any[]=[],mailCtx:any={...ctx,rpc:{call:vi.fn(async(name:string,input:any)=>{calls.push({name,input});
    if(name==='mail.list')return {ok:true,data:{items:[{...summary}],partial:[],updated:1,total:1}};
    if(name==='mail.get')return {ok:true,data:{...message}};
    return {ok:true,data:{ok:true}};
  })}};
  render(<Mail ctx={mailCtx} accounts={[account]} target="zh" onSettings={()=>{}} compact={false} refreshAccounts={async()=>{}}/>);
  const list=()=>within(screen.getByRole('listbox',{name:'邮件列表'})).getByRole('option');
  await waitFor(()=>expect(list()).toBeTruthy());
  fireEvent.click(list());
  await waitFor(()=>expect(list().getAttribute('aria-label')).not.toContain('未读邮件'));
  expect(calls.some(call=>call.name==='mail.mark-read'&&call.input.read===true)).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'标为未读'}));
  await waitFor(()=>expect(list().getAttribute('aria-label')).toContain('未读邮件'));
  expect(screen.getByRole('button',{name:'标为已读'})).toBeTruthy();
  expect(calls.some(call=>call.name==='mail.mark-read'&&call.input.read===false)).toBe(true);
});
it('全部标为已读立即更新列表与未读统计',async()=>{
  const account:any={id:'a1',provider:'163',address:'a@example.com',alias:'163',colorToken:'a1',state:{status:'connected'},createdAt:0};
  const summary:any={accountId:'a1',messageId:'m1',from:{name:'Sender',address:'s@example.com'},to:[{address:'a@example.com'}],cc:[],subject:'主题',snippet:'摘要',date:0,unread:true,hasAttachments:false};
  let marked=false;const calls:any[]=[];
  const mailCtx:any={...ctx,rpc:{call:vi.fn(async(name:string,input:any)=>{calls.push({name,input});
    if(name==='mail.list')return {ok:true,data:{items:[{...summary,unread:!marked}],unreadByAccount:marked?{}:{a1:1},partial:[],updated:1,total:1}};
    if(name==='mail.mark-all-read'){marked=true;return {ok:true,data:{updated:1}};}
    return {ok:true,data:{}};
  })}};
  const {container}=render(<Mail ctx={mailCtx} accounts={[account]} target="zh" onSettings={()=>{}} compact={false} refreshAccounts={async()=>{}}/>);
  await waitFor(()=>expect(screen.getByRole('option')).toBeTruthy());
  fireEvent.click(screen.getByRole('button',{name:'全部标为已读'}));
  await waitFor(()=>expect(calls.some(call=>call.name==='mail.mark-all-read')).toBe(true));
  await waitFor(()=>expect(screen.getByRole('option').getAttribute('aria-label')).not.toContain('未读邮件'));
  expect(container.querySelector('.acct-count')).toBeNull();
});
it('通知设置保存开关、免打扰与静音账号',async()=>{
  const data:any={providers:[{id:'hostModel',configured:true}],accounts:[{id:'a1',provider:'163',address:'a@example.com',alias:'163',colorToken:'a1',state:{status:'connected'},createdAt:0}],languages:[],vaultWarning:false};
  const calls:any[]=[],notifyCtx:any={...ctx,rpc:{call:vi.fn(async(name:string,input:any)=>{calls.push({name,input});
    if(name==='settings.get')return {ok:true,data:{notifications:{enabled:true,dndEnabled:false,dndStart:'22:00',dndEnd:'08:00',mutedAccountIds:[]}}};
    return {ok:true,data:{saved:true}};
  })}};
  render(<Settings ctx={notifyCtx} data={data} refresh={async()=>{}} onSelection={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'通知设置'}));
  fireEvent.click(await screen.findByRole('checkbox',{name:/免打扰时段/}));
  fireEvent.change(screen.getByLabelText('开始'),{target:{value:'23:00'}});
  fireEvent.click(screen.getByRole('checkbox',{name:/163/}));
  fireEvent.click(screen.getByRole('button',{name:'保存通知设置'}));
  await waitFor(()=>expect(calls.some(call=>call.name==='settings.save')).toBe(true));
  expect(calls.find(call=>call.name==='settings.save').input.notifications).toMatchObject({dndEnabled:true,dndStart:'23:00',mutedAccountIds:['a1']});
});
it('常用 OpenAI 兼容服务预设填入接口地址与模型',async()=>{
  const data:any={providers:[{id:'openai',configured:false}],accounts:[],languages:[],vaultWarning:false};
  const presetCtx:any={...ctx,rpc:{call:vi.fn(async(name:string)=>name==='settings.get'?{ok:true,data:{provider:'hostModel',glossary:[],selection:true}} : {ok:true,data:{}})}};
  render(<TranslationSettings ctx={presetCtx} data={data} refresh={async()=>{}} onSelection={()=>{}}/>);
  choose('翻译供应商','OpenAI 兼容服务');
  choose('快速填入服务',/DeepSeek/);
  expect((screen.getByLabelText('接口地址') as HTMLInputElement).value).toBe('https://api.deepseek.com/v1');
  expect((screen.getByLabelText('模型 ID') as HTMLInputElement).value).toBe('deepseek-chat');
});
it('阅读设置统一保存 AI 服务与摘要参数',async()=>{
  const settings={summaryProvider:'hostModel',summaryModel:'',summaryLang:'zh',autoSummary:false,pollMinutes:15,retentionDays:90,maxEntriesPerFeed:500,fullText:true,remoteImages:true};
  const calls:any[]=[];
  const readingCtx:any={...ctx,rpc:{call:vi.fn(async(name:string,input:any)=>{
    calls.push({name,input});
    if(name==='rss.settings.get')return {ok:true,data:{settings}};
    if(name==='settings.get')return {ok:true,data:{openaiBaseUrl:'',openaiConfigured:false}};
    if(name==='rss.settings.save')return {ok:true,data:{settings:{...settings,...input}}};
    return {ok:true,data:{saved:true}};
  })}};
  render(<ReadingSettings ctx={readingCtx}/>);
  await screen.findByLabelText('摘要服务');
  choose('摘要服务','OpenAI 兼容');
  choose('快速填入服务','DeepSeek');
  fireEvent.change(screen.getByLabelText('API Key'),{target:{value:'fixture-key'}});
  choose('正文主题','深色');
  fireEvent.change(screen.getByLabelText('自定义 CSS'),{target:{value:'p{color:#fff}'}});
  fireEvent.click(screen.getByRole('button',{name:'保存设置'}));
  await waitFor(()=>expect(calls.some(call=>call.name==='settings.save')).toBe(true));
  expect(calls.find(call=>call.name==='settings.save').input).toMatchObject({openaiBaseUrl:'https://api.deepseek.com/v1',openaiApiKey:'fixture-key'});
  expect(calls.find(call=>call.name==='rss.settings.save').input).toMatchObject({summaryProvider:'openai',summaryModel:'deepseek-chat',articleTheme:'dark',articleCustomCss:'p{color:#fff}'});
});
it('切换界面重放到达事件时，只提示当前仍未读的邮件',async()=>{
  let arrived:(event:any)=>void=()=>{};
  const notify=vi.fn(),read=new Set<string>();
  const appCtx:any={...ctx,view:'mail',ui:{...ctx.ui,notify},messages:{on:(type:string,fn:(event:any)=>void)=>{
    if(type==='mail.arrived')arrived=fn;return()=>{};
  }},rpc:{call:vi.fn(async(name:string,input:any)=>{
    if(name==='settings.get')return {ok:true,data:{}};
    if(name==='mail.list')return {ok:true,data:{items:[],partial:[],updated:0,total:0}};
    if(name==='mail.unread-status')return {ok:true,data:{messageIds:input.messageIds.filter((id:string)=>!read.has(id))}};
    return {ok:true,data:{}};
  })}};
  const boot={providers:[],accounts:[],languages:['zh'],vaultWarning:false};
  const oldEvent={data:{eventId:'old',accountId:'a1',count:1,messageIds:['m1']}};
  const inbox=render(<App ctx={appCtx} initialData={boot}/>);
  await waitFor(()=>expect(appCtx.rpc.call).toHaveBeenCalledWith('settings.get',expect.anything()));
  arrived(oldEvent);
  expect(notify).not.toHaveBeenCalled();
  read.add('m1');
  inbox.unmount();
  render(<App ctx={{...appCtx,view:'reading'}} initialData={boot}/>);
  await waitFor(()=>expect(appCtx.rpc.call.mock.calls.filter((call:any)=>call[0]==='settings.get')).toHaveLength(3));
  arrived(oldEvent);
  expect(notify).not.toHaveBeenCalled();
  read.add('m3');
  arrived({data:{eventId:'new',accountId:'a1',count:2,messageIds:['m2','m3']}});
  await waitFor(()=>expect(notify).toHaveBeenCalledWith('收到 1 封新邮件'));
  expect(notify).toHaveBeenCalledTimes(1);
});
it('新邮件提醒遵守总开关与静音账号',async()=>{
  let arrived:(event:any)=>void=()=>{};
  const notify=vi.fn();
  const appCtx:any={...ctx,ui:{...ctx.ui,notify},messages:{on:(type:string,fn:(event:any)=>void)=>{if(type==='mail.arrived')arrived=fn;return()=>{};}},
    rpc:{call:vi.fn(async(name:string,input:any)=>name==='app.bootstrap'
      ?{ok:true,data:{providers:[{id:'hostModel',configured:true}],accounts:[],languages:['auto','zh','en'],vaultWarning:false}}
      :name==='settings.get'?{ok:true,data:{selection:true,notifications:{enabled:true,dndEnabled:false,dndStart:'22:00',dndEnd:'08:00',mutedAccountIds:['a2']}}}
      :name==='mail.unread-status'?{ok:true,data:{messageIds:input.messageIds}}
      :{ok:true,data:[]})}};
  render(<App ctx={appCtx}/>);
  await waitFor(()=>expect(appCtx.rpc.call.mock.calls.some((call:any)=>call[0]==='settings.get')).toBe(true));
  arrived({data:{eventId:'e1',accountId:'a2',count:1,messageIds:['m1']}});
  arrived({data:{eventId:'legacy',accountId:'a1',count:3}});
  expect(appCtx.rpc.call).not.toHaveBeenCalledWith('mail.unread-status',expect.anything());
  arrived({data:{eventId:'e2',accountId:'a1',count:2,messageIds:['m1','m2']}});
  await waitFor(()=>expect(notify).toHaveBeenCalledWith('收到 2 封新邮件'));
  expect(notify).toHaveBeenCalledTimes(1);
});
it('同一封邮件的事件重复到达只提示一次，已读后不再提示',async()=>{
  let arrived:(event:any)=>void=()=>{},read:(event:any)=>void=()=>{};
  const notify=vi.fn();
  const appCtx:any={...ctx,ui:{...ctx.ui,notify},messages:{on:(type:string,fn:(event:any)=>void)=>{
    if(type==='mail.arrived')arrived=fn;
    if(type==='mail.read')read=fn;
    return()=>{};
  }},rpc:{call:vi.fn(async(name:string,input:any)=>name==='app.bootstrap'
    ?{ok:true,data:{providers:[{id:'hostModel',configured:true}],accounts:[],languages:['auto','zh','en'],vaultWarning:false}}
    :name==='settings.get'?{ok:true,data:{selection:true,notifications:{enabled:true,dndEnabled:false,dndStart:'22:00',dndEnd:'08:00',mutedAccountIds:[]}}}
    :name==='mail.unread-status'?{ok:true,data:{messageIds:input.messageIds}}
    :{ok:true,data:[]})}};
  render(<App ctx={appCtx}/>);
  await waitFor(()=>expect(appCtx.rpc.call.mock.calls.some((call:any)=>call[0]==='settings.get')).toBe(true));
  arrived({data:{eventId:'n1',accountId:'a1',count:1,messageIds:['m1']}});
  arrived({data:{eventId:'n2',accountId:'a1',count:1,messageIds:['m1']}});
  await waitFor(()=>expect(notify).toHaveBeenCalledTimes(1));
  read({data:{eventId:'r1',accountId:'a1',messageId:'m2',read:true}});
  arrived({data:{eventId:'n3',accountId:'a1',count:1,messageIds:['m2']}});
  expect(notify).toHaveBeenCalledTimes(1);
  arrived({data:{eventId:'n4',accountId:'a1',count:1,messageIds:['m3']}});
  await waitFor(()=>expect(notify).toHaveBeenCalledTimes(2));
});
it('当前已经在邮箱页时，到达事件只刷新列表不再弹新邮件提示',async()=>{
  let arrived:(event:any)=>void=()=>{};
  const notify=vi.fn(),account:any={id:'a1',provider:'163',address:'a@example.com',alias:'163',colorToken:'a1',state:{status:'connected'},createdAt:0};
  const appCtx:any={...ctx,view:'mail',location:{path:'mail',query:{}},ui:{...ctx.ui,notify},messages:{on:(type:string,fn:(event:any)=>void)=>{if(type==='mail.arrived')arrived=fn;return()=>{};}},
    rpc:{call:vi.fn(async(name:string)=>name==='app.bootstrap'
      ?{ok:true,data:{providers:[{id:'hostModel',configured:true}],accounts:[account],languages:['auto','zh','en'],vaultWarning:false}}
      :name==='settings.get'?{ok:true,data:{selection:true,notifications:{enabled:true,dndEnabled:false,dndStart:'22:00',dndEnd:'08:00',mutedAccountIds:[]}}}
      :name==='mail.list'?{ok:true,data:{items:[],partial:[],updated:0,total:1,unreadByAccount:{}}}
      :{ok:true,data:[]})}};
  render(<App ctx={appCtx}/>);
  await waitFor(()=>expect(appCtx.rpc.call.mock.calls.some((call:any)=>call[0]==='mail.list')).toBe(true));
  arrived({data:{eventId:'e3',accountId:'a1',count:2,messageIds:['m1','m2']}});
  expect(appCtx.rpc.call).not.toHaveBeenCalledWith('mail.unread-status',expect.anything());
  expect(notify).not.toHaveBeenCalled();
});
it('正文远程图片按域名白名单自动加载',async()=>{
  const account:any={id:'a1',provider:'163',address:'a@example.com',alias:'163',colorToken:'a1',state:{status:'connected'},createdAt:0};
  const summary:any={accountId:'a1',messageId:'m1',from:{name:'Sender',address:'s@example.com'},to:[{address:'a@example.com'}],cc:[],subject:'主题',snippet:'摘要',date:0,unread:true,hasAttachments:false};
  const message:any={accountId:'a1',messageId:'m1',from:summary.from,to:summary.to,cc:[],subject:'主题',date:0,text:'正文',html:'<p>正文</p><img src="https://img.example.com/a.png">',attachments:[],remoteContentBlocked:true};
  const calls:string[]=[],mailCtx:any={...ctx,rpc:{call:vi.fn(async(name:string)=>{calls.push(name);
    if(name==='mail.list')return {ok:true,data:{items:[summary],partial:[],updated:1,total:1}};
    if(name==='mail.get')return {ok:true,data:message};
    if(name==='mail.image-domains')return {ok:true,data:{domains:['img.example.com']}};
    if(name==='mail.images')return {ok:true,data:{...message,remoteContentBlocked:false,html:'<p>正文</p><img src="data:image/png;base64,YQ==">'}};
    return {ok:true,data:{}};
  })}};
  render(<Mail ctx={mailCtx} accounts={[account]} target="zh" onSettings={()=>{}} compact={false} refreshAccounts={async()=>{}}/>);
  await waitFor(()=>expect(screen.getByRole('option')).toBeTruthy());
  fireEvent.click(screen.getByRole('option'));
  await waitFor(()=>expect(calls).toContain('mail.images'));
});
it('邮件正文一键原地翻译：自动识别源语言且不显示双语对照',async()=>{
  const account:any={id:'a1',provider:'163',address:'a@example.com',alias:'163',colorToken:'a1',state:{status:'connected'},createdAt:0};
  const summary:any={accountId:'a1',messageId:'m1',from:{name:'Sender',address:'s@example.com'},to:[{address:'a@example.com'}],cc:[],subject:'主题',snippet:'摘要',date:0,unread:true,hasAttachments:false};
  const message:any={accountId:'a1',messageId:'m1',from:summary.from,to:summary.to,cc:[],subject:'主题',date:0,text:'Hello team.\n\nSecond paragraph.',html:'<p>Hello team.</p><p>Second paragraph.</p>',attachments:[],remoteContentBlocked:false};
  const calls:any[]=[];let rounds=0;const onTarget=vi.fn();
  const mailCtx:any={...ctx,rpc:{call:vi.fn(async(name:string,input:any)=>{calls.push({name,input});
    if(name==='mail.list')return {ok:true,data:{items:[summary],partial:[],updated:1,total:1}};
    if(name==='mail.get')return {ok:true,data:message};
    if(name==='mail.bilingual'){rounds++;return {ok:true,data:{messageId:'m1',complete:rounds>1,segments:[
      {index:0,source:'Hello team.',translated:'大家好。'},
      {index:1,source:'Second paragraph.',translated:rounds>1?'第二段。':undefined},
    ]}};}
    return {ok:true,data:{}};
  })}};
  const {container}=render(<Mail ctx={mailCtx} accounts={[account]} target="zh" onTarget={onTarget} onSettings={()=>{}} compact={false} refreshAccounts={async()=>{}}/>);
  await waitFor(()=>expect(screen.getByRole('option')).toBeTruthy());
  fireEvent.click(screen.getByRole('option'));
  const target=await waitFor(()=>screen.getByLabelText('邮件翻译目标'));
  const group=target.closest('.translate-control') as HTMLElement;
  expect(group).not.toBeNull();
  expect(within(group).getByRole('button',{name:'翻译'})).toBeTruthy();
  choose('邮件翻译目标','English');
  expect(onTarget).toHaveBeenCalledWith('en');
  choose('邮件翻译目标','简体中文');
  fireEvent.click(await screen.findByRole('button',{name:'翻译'}));
  await waitFor(()=>expect(calls.some(call=>call.name==='mail.bilingual')).toBe(true));
  const request=calls.find(call=>call.name==='mail.bilingual').input;
  expect(request).toMatchObject({accountId:'a1',messageId:'m1',target:'zh'});
  expect(request).not.toHaveProperty('from');
  expect(calls.filter(call=>call.name==='mail.bilingual')).toHaveLength(2);
  expect(calls.filter(call=>call.name==='mail.bilingual')[1].input.continue).toBe(true);
  await waitFor(()=>expect(container.querySelector('iframe')).not.toBeNull());
  expect(container.querySelector('iframe')!.getAttribute('srcdoc')).toContain('大家好。');
  expect(container.querySelector('iframe')!.getAttribute('srcdoc')).toContain('第二段。');
  expect(container.querySelector('iframe')!.getAttribute('srcdoc')).not.toMatch(/Hello team|Second paragraph/);
  fireEvent.click(screen.getByRole('button',{name:'查看原文'}));
  await waitFor(()=>expect(container.querySelector('iframe')!.getAttribute('srcdoc')).toContain('Hello team.'));
});

it('编辑文本后点击重新翻译会发 run 并带 retryNonce，而不是重放旧作业',async()=>{
  const calls:any[]=[];
  const translateCtx:any={...ctx,rpc:{call:vi.fn(async(name:string,input:any)=>{calls.push({name,input});return name==='translate.history'?{ok:true,data:[]}:{ok:true,data:{id:'job',request:{text:input?.text||'one',from:'auto',to:'zh'},status:'done',result:{provider:'hostModel',translated:'译文'}}};})}};
  render(<Translate ctx={translateCtx} onTarget={()=>{}} onSettings={()=>{}}/>);
  const input=screen.getByLabelText('原文');
  fireEvent.change(input,{target:{value:'one'}});
  fireEvent.keyDown(input,{key:'Enter'});
  await waitFor(()=>expect(screen.getByRole('button',{name:'重新翻译'})).toBeTruthy());
  fireEvent.change(input,{target:{value:'two'}});
  fireEvent.click(screen.getByRole('button',{name:'重新翻译'}));
  await waitFor(()=>expect(calls.some(c=>c.name==='translate.run'&&c.input.text==='two'&&c.input.retryNonce)).toBe(true));
  expect(calls.some(c=>c.name==='translate.retry')).toBe(false);
});
it('阅读模块三栏布局，添加订阅走真实 RPC 并刷新列表',async()=>{
  const settings={summaryProvider:'hostModel',summaryModel:'',summaryLang:'zh',autoSummary:false,pollMinutes:15,retentionDays:90,maxEntriesPerFeed:500,fullText:true,remoteImages:true};
  const boot={folders:[{id:'f1',name:'技术',createdAt:1,unread:0}],feeds:[],settings,counts:{feeds:0,unread:0,today:0,starred:0}};
  const calls:any[]=[];
  const readingCtx:any={...ctx,slot:'workspace',view:'reading',location:{path:'reading',query:{}},
    rpc:{call:vi.fn(async(name:string,input:any)=>{calls.push({name,input});
      if(name==='rss.bootstrap')return {ok:true,data:boot};
      if(name==='rss.entries.list')return {ok:true,data:{items:[],total:0,unread:0}};
      if(name==='rss.feed.add')return {ok:true,data:{feed:{id:'n1',url:input.url,title:'新订阅',siteUrl:'',description:'',icon:'',enabled:true}}};
      return {ok:true,data:{}};
    })}};
  const {container}=render(<Reading ctx={readingCtx}/>);
  await waitFor(()=>expect(container.querySelector('.reading-view')).not.toBeNull());
  expect(container.querySelector('.reading-sources')).not.toBeNull();
  expect(container.querySelector('.reading-list-pane')).not.toBeNull();
  expect(container.querySelector('.reading-detail-pane')).not.toBeNull();
  fireEvent.click(screen.getAllByRole('button',{name:'添加订阅'})[0]);
  fireEvent.change(screen.getByLabelText('订阅地址'),{target:{value:'https://example.com/feed.xml'}});
  fireEvent.click(screen.getByRole('button',{name:'添加'}));
  await waitFor(()=>expect(calls.some(call=>call.name==='rss.feed.add'&&call.input.url==='https://example.com/feed.xml')).toBe(true));
  expect(calls.some(call=>call.name==='rss.bootstrap')).toBe(true);
});
it('阅读发现面板按分类筛选并一键订阅精选源',async()=>{
  const settings={summaryProvider:'hostModel',summaryModel:'',summaryLang:'zh',autoSummary:false,pollMinutes:15,retentionDays:90,maxEntriesPerFeed:500,fullText:true,remoteImages:true};
  const title='\u962E\u4E00\u5CF0\u7684\u7F51\u7EDC\u65E5\u5FD7';
  const feed={id:'f1',url:'https://www.ruanyifeng.com/blog/atom.xml',title,siteUrl:'https://www.ruanyifeng.com/blog/',description:'',icon:'',enabled:true,unread:0};
  let added=false;
  const calls:any[]=[];
  const discoverCtx:any={...ctx,slot:'workspace',view:'reading',location:{path:'reading',query:{}},
    rpc:{call:vi.fn(async(name:string,input:any)=>{calls.push({name,input});
      if(name==='rss.bootstrap')return {ok:true,data:{folders:[],feeds:added?[feed]:[],settings,counts:{feeds:added?1:0,unread:0,today:0,starred:0}}};
      if(name==='rss.entries.list')return {ok:true,data:{items:[],total:0,unread:0}};
      if(name==='rss.feed.add'){added=true;return {ok:true,data:{feed}};}
      return {ok:true,data:{}};
    })}};
  render(<Reading ctx={discoverCtx}/>);
  fireEvent.click(await screen.findByRole('button',{name:'发现订阅源'}));
  const dialog=screen.getByRole('dialog',{name:'发现订阅源'});
  expect(within(dialog).queryByText('EKKO READING')).toBeNull();
  expect(within(dialog).getByText('27 个精选源，已验证可用。')).toBeTruthy();
  expect(within(dialog).getByRole('tab',{name:/全部/})).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('tab',{name:/开发技术/}));
  const card=within(dialog).getByText(title).closest('article')!;
  fireEvent.click(within(card).getByRole('button',{name:'\u8ba2\u9605 '+title}));
  await waitFor(()=>expect(calls.some(call=>call.name==='rss.feed.add'&&call.input.url==='https://www.ruanyifeng.com/blog/atom.xml')).toBe(true));
  await waitFor(()=>expect(within(dialog).getByText('已订阅')).toBeTruthy());
});
it('打开文章后进入阅读区并可用返回列表恢复',async()=>{
  const settings={summaryProvider:'hostModel',summaryModel:'',summaryLang:'zh',autoSummary:false,pollMinutes:15,retentionDays:90,maxEntriesPerFeed:500,fullText:true,remoteImages:true};
  const item={id:'e1',feedId:'f1',feedTitle:'示例订阅',title:'示例文章',snippet:'摘要',publishedAt:0,read:false,starred:false,hasSummary:false};
  const entry={...item,url:'https://example.com/a',contentHtml:'<p>正文</p>',contentText:'正文',feedIcon:''};
  const readerCtx:any={...ctx,slot:'workspace',view:'reading',location:{path:'reading',query:{}},
    rpc:{call:vi.fn(async(name:string)=>{
      if(name==='rss.bootstrap')return {ok:true,data:{folders:[],feeds:[],settings,counts:{feeds:1,unread:1,today:1,starred:0}}};
      if(name==='rss.entries.list')return {ok:true,data:{items:[item],total:1,unread:1}};
      if(name==='rss.entry.get')return {ok:true,data:entry};
      return {ok:true,data:{}};
    })}};
  const {container}=render(<Reading ctx={readerCtx}/>);
  await waitFor(()=>expect(container.querySelector('.reading-row')).not.toBeNull());
  fireEvent.click(container.querySelector('.reading-row') as HTMLElement);
  await waitFor(()=>expect(container.querySelector('.reading-view.article-open')).not.toBeNull());
  const title=container.querySelector('.reading-detail-title')!;
  const meta=title.querySelector('.meta')!;
  const source=meta.querySelector('.source')!;
  expect(source).toBeTruthy();
  expect(source.compareDocumentPosition(meta.querySelector('time')!)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(title.querySelector('.reading-detail-body .feed-avatar')).toBeTruthy();
  const back=screen.getByRole('button',{name:'返回列表'});
  expect(back.closest('.reading-detail-nav')).not.toBeNull();
  expect(back.querySelector('.reading-back-icon')).not.toBeNull();
  fireEvent.click(back);
  await waitFor(()=>expect(container.querySelector('.reading-view.article-open')).toBeNull());
});

it('正文滚到底或顶部继续滑动会切换当前订阅源的下一篇与上一篇',async()=>{
  const settings={summaryProvider:'hostModel',summaryModel:'',summaryLang:'zh',autoSummary:false,pollMinutes:15,retentionDays:90,maxEntriesPerFeed:500,fullText:true,remoteImages:true};
  const first={id:'n1',feedId:'f1',feedTitle:'IT之家',title:'第一篇',snippet:'摘要一',publishedAt:2,read:false,starred:false,hasSummary:false};
  const second={id:'n2',feedId:'f1',feedTitle:'IT之家',title:'第二篇',snippet:'摘要二',publishedAt:1,read:false,starred:false,hasSummary:false};
  const entries:any={n1:{...first,url:'https://example.com/1',contentHtml:'',contentText:'第一篇正文',feedIcon:''},
    n2:{...second,url:'https://example.com/2',contentHtml:'',contentText:'第二篇正文',feedIcon:''}};
  const calls:any[]=[];
  const ctxNext:any={...ctx,slot:'workspace',view:'reading',location:{path:'reading',query:{}},
    rpc:{call:vi.fn(async(name:string,input:any)=>{
      calls.push({name,input});
      if(name==='rss.bootstrap')return {ok:true,data:{folders:[],feeds:[{id:'f1',url:'https://example.com/feed',title:'IT之家',siteUrl:'https://example.com',description:'',icon:'',enabled:true,unread:2}],settings,counts:{feeds:1,unread:2,today:2,starred:0}}};
      if(name==='rss.entries.list')return {ok:true,data:{items:[first,second],total:2,unread:2}};
      if(name==='rss.entry.get')return {ok:true,data:entries[input.id]};
      return {ok:true,data:{}};
    })}};
  const {container}=render(<Reading ctx={ctxNext}/>);
  await waitFor(()=>expect(container.querySelectorAll('.reading-row')).toHaveLength(2));
  fireEvent.click(container.querySelectorAll('.reading-row')[0]);
  const plain=await waitFor(()=>{
    const node=container.querySelector('.reading-plain') as HTMLParagraphElement;
    expect(node).not.toBeNull(); return node;
  });
  Object.defineProperty(plain,'clientHeight',{configurable:true,value:300});
  Object.defineProperty(plain,'scrollHeight',{configurable:true,value:600});
  Object.defineProperty(plain,'scrollTop',{configurable:true,value:300});
  fireEvent.wheel(plain,{deltaY:120});
  await waitFor(()=>expect(calls.some(call=>call.name==='rss.entry.get'&&call.input.id==='n2')).toBe(true));
  await waitFor(()=>expect(container.querySelector('.reading-detail-title h2')?.textContent).toBe('第二篇'));
  await new Promise(resolve => setTimeout(resolve, 700));
  const previous=container.querySelector('.reading-plain') as HTMLParagraphElement;
  Object.defineProperty(previous,'clientHeight',{configurable:true,value:300});
  Object.defineProperty(previous,'scrollHeight',{configurable:true,value:600});
  Object.defineProperty(previous,'scrollTop',{configurable:true,value:0});
  fireEvent.wheel(previous,{deltaY:-120});
  await waitFor(()=>expect(container.querySelector('.reading-detail-title h2')?.textContent).toBe('第一篇'));
});

it('阅读 AI 解读在当前文章页内生成摘要并支持关闭',async()=>{
  const settings={summaryProvider:'hostModel',summaryModel:'',summaryLang:'zh',autoSummary:false,pollMinutes:15,retentionDays:90,maxEntriesPerFeed:500,fullText:true,remoteImages:true};
  const item={id:'e2',feedId:'f1',feedTitle:'示例订阅',title:'AI 解读文章',snippet:'摘要',publishedAt:0,read:false,starred:false,hasSummary:false};
  const entry={...item,url:'https://example.com/ai',contentHtml:'<p>正文</p>',contentText:'正文',feedIcon:''};
  const calls:any[]=[];
  const readerCtx:any={...ctx,slot:'workspace',view:'reading',location:{path:'reading',query:{}},
    rpc:{call:vi.fn(async(name:string,input:any)=>{
      calls.push({name,input});
      if(name==='rss.bootstrap')return {ok:true,data:{folders:[],feeds:[],settings,counts:{feeds:1,unread:1,today:1,starred:0}}};
      if(name==='rss.entries.list')return {ok:true,data:{items:[item],total:1,unread:1}};
      if(name==='rss.entry.get')return {ok:true,data:entry};
      if(name==='rss.entry.summarize')return {ok:true,data:{summary:{tldr:'一句话摘要',points:['要点一'],whyRead:'值得阅读',tags:['AI'],model:'host-model',createdAt:1}}};
      return {ok:true,data:{}};
    })}};
  render(<Reading ctx={readerCtx}/>);
  await waitFor(()=>expect(screen.getByText('AI 解读文章')).toBeTruthy());
  fireEvent.click(screen.getByText('AI 解读文章'));
  await waitFor(()=>expect(screen.getByRole('button',{name:'AI 解读'})).toBeTruthy());
  fireEvent.click(screen.getByRole('button',{name:'AI 解读'}));
  const analysis=await screen.findByRole('complementary',{name:'AI 解读'});
  await waitFor(()=>expect(within(analysis).getByText('一句话摘要')).toBeTruthy());
  expect(screen.getByTitle('文章正文')).toBeTruthy();
  expect(calls.some(call=>call.name==='rss.entry.summarize'&&call.input.id==='e2')).toBe(true);
  fireEvent.click(within(analysis).getByRole('button',{name:'关闭面板'}));
  await waitFor(()=>expect(screen.queryByRole('complementary',{name:'AI 解读'})).toBeNull());
  expect(screen.getByTitle('文章正文')).toBeTruthy();
});

it('阅读文章列表滚动到底部自动加载下一页',async()=>{
  const settings={summaryProvider:'hostModel',summaryModel:'',summaryLang:'zh',autoSummary:false,pollMinutes:15,retentionDays:90,maxEntriesPerFeed:500,fullText:true,remoteImages:true};
  const feed={id:'f1',url:'https://example.com/feed.xml',title:'示例订阅',siteUrl:'https://example.com',description:'',icon:'',enabled:true,unread:35};
  const makeItems=(start:number,count:number)=>Array.from({length:count},(_,index)=>({
    id:'e'+(start+index),feedId:'f1',feedTitle:'示例订阅',title:'文章 '+(start+index),url:'https://example.com/'+(start+index),
    publishedAt:1000-index,snippet:'摘要',read:false,starred:false,hasSummary:false,
  }));
  const calls:any[]=[];
  const readingCtx:any={...ctx,slot:'workspace',view:'reading',location:{path:'reading',query:{}},
    rpc:{call:vi.fn(async(name:string,input:any)=>{
      calls.push({name,input});
      if(name==='rss.bootstrap')return {ok:true,data:{folders:[],feeds:[feed],settings,counts:{feeds:1,unread:35,today:0,starred:0}}};
      if(name==='rss.entries.list')return Number(input.cursor||0)===0
        ?{ok:true,data:{items:makeItems(0,30),nextCursor:30,total:43,unread:43}}
        :Number(input.cursor)===30
          ?{ok:true,data:{items:makeItems(30,10),nextCursor:40,total:43,unread:43}}
          :{ok:true,data:{items:makeItems(40,3),total:43,unread:43}};
      return {ok:true,data:{}};
    })}};
  const {container}=render(<Reading ctx={readingCtx}/>);
  await waitFor(()=>expect(container.querySelectorAll('.reading-row')).toHaveLength(30));
  const list=container.querySelector('.reading-list') as HTMLDivElement;
  Object.defineProperty(list,'clientHeight',{configurable:true,value:300});
  Object.defineProperty(list,'scrollHeight',{configurable:true,value:900});
  Object.defineProperty(list,'scrollTop',{configurable:true,writable:true,value:600});
  fireEvent.scroll(list);
  await waitFor(()=>expect(container.querySelectorAll('.reading-row')).toHaveLength(40));
  expect(calls.some(call=>call.name==='rss.entries.list'&&call.input.cursor===30)).toBe(true);
  fireEvent.scroll(list);
  await waitFor(()=>expect(container.querySelectorAll('.reading-row')).toHaveLength(43));
  expect(calls.some(call=>call.name==='rss.entries.list'&&call.input.cursor===40)).toBe(true);
});

it('列表滚过顶部自动标为已读，并支持一键全部已读',async()=>{
  const settings={summaryProvider:'hostModel',summaryModel:'',summaryLang:'zh',autoSummary:false,pollMinutes:15,retentionDays:90,maxEntriesPerFeed:500,fullText:true,remoteImages:true};
  const items=[
    {id:'a1',feedId:'f1',feedTitle:'示例源',title:'第一篇',snippet:'摘要一',publishedAt:2,read:false,starred:false,hasSummary:false},
    {id:'a2',feedId:'f1',feedTitle:'示例源',title:'第二篇',snippet:'摘要二',publishedAt:1,read:false,starred:false,hasSummary:false},
  ];
  const calls:any[]=[];
  const readingCtx:any={...ctx,slot:'workspace',view:'reading',location:{path:'reading',query:{}},
    rpc:{call:vi.fn(async(name:string,input:any)=>{
      calls.push({name,input});
      if(name==='rss.bootstrap')return {ok:true,data:{folders:[],feeds:[{id:'f1',url:'https://example.com/feed',title:'示例源',siteUrl:'https://example.com',description:'',icon:'',enabled:true,unread:2}],settings,counts:{feeds:1,unread:2,today:2,starred:0}}};
      if(name==='rss.entries.list')return {ok:true,data:{items,total:2,unread:2}};
      return {ok:true,data:{ok:true}};
    })}};
  const {container}=render(<Reading ctx={readingCtx}/>);
  await waitFor(()=>expect(container.querySelectorAll('.reading-row')).toHaveLength(2));
  const list=container.querySelector('.reading-list') as HTMLElement;
  const rows=container.querySelectorAll<HTMLElement>('.reading-row');
  list.getBoundingClientRect=()=>({top:100,bottom:600,left:0,right:300,width:300,height:500,x:0,y:100,toJSON:()=>({})}) as DOMRect;
  rows[0].getBoundingClientRect=()=>({top:40,bottom:90,left:0,right:300,width:300,height:50,x:0,y:40,toJSON:()=>({})}) as DOMRect;
  rows[1].getBoundingClientRect=()=>({top:110,bottom:200,left:0,right:300,width:300,height:90,x:0,y:110,toJSON:()=>({})}) as DOMRect;
  fireEvent.scroll(list);
  await waitFor(()=>expect(calls.some(call=>call.name==='rss.entry.mark-read'&&call.input.id==='a1'&&call.input.read===true)).toBe(true));
  expect(calls.some(call=>call.name==='rss.entry.mark-read'&&call.input.id==='a2')).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'全部标为已读'}));
  await waitFor(()=>expect(calls.some(call=>call.name==='rss.entries.mark-all-read')).toBe(true));
  expect(calls.find(call=>call.name==='rss.entries.mark-all-read')?.input).toMatchObject({view:'unread'});
});

it('右键订阅源可移动分组、刷新与删除，右键分组可删除',async()=>{
  const settings={summaryProvider:'hostModel',summaryModel:'',summaryLang:'zh',autoSummary:false,pollMinutes:15,retentionDays:90,maxEntriesPerFeed:500,fullText:true,remoteImages:true};
  const folder={id:'f1',name:'技术',createdAt:1,unread:0};
  const feed={id:'feed-1',url:'https://example.com/feed.xml',title:'技术周刊',siteUrl:'https://example.com',description:'',icon:'',enabled:true,unread:2};
  const calls:any[]=[];
  const readingCtx:any={...ctx,slot:'workspace',view:'reading',location:{path:'reading',query:{}},
    rpc:{call:vi.fn(async(name:string,input:any)=>{
      calls.push({name,input});
      if(name==='rss.bootstrap')return {ok:true,data:{folders:[folder],feeds:[feed],settings,counts:{feeds:1,unread:2,today:0,starred:0}}};
      if(name==='rss.entries.list')return {ok:true,data:{items:[],total:0,unread:0}};
      return {ok:true,data:{ok:true}};
    })}};
  const {container}=render(<Reading ctx={readingCtx}/>);
  await screen.findByText('技术周刊');
  const feedRow=()=>screen.getByText('技术周刊').closest('.reading-feed') as HTMLElement;
  fireEvent.contextMenu(feedRow(),{clientX:120,clientY:160});
  let menu=await screen.findByRole('menu');
  expect(within(menu).getByText('移动到分组')).toBeTruthy();
  fireEvent.click(within(menu).getByRole('menuitem',{name:'技术'}));
  await waitFor(()=>expect(calls.some(call=>call.name==='rss.feed.move'&&call.input.id==='feed-1'&&call.input.folderId==='f1')).toBe(true));
  fireEvent.contextMenu(feedRow(),{clientX:120,clientY:160});
  menu=await screen.findByRole('menu');
  fireEvent.click(within(menu).getByRole('menuitem',{name:'刷新此订阅'}));
  await waitFor(()=>expect(calls.some(call=>call.name==='rss.feed.refresh'&&call.input.id==='feed-1')).toBe(true));
  fireEvent.contextMenu(feedRow(),{clientX:120,clientY:160});
  menu=await screen.findByRole('menu');
  fireEvent.click(within(menu).getByRole('menuitem',{name:'重命名订阅'}));
  const renameDialog=await screen.findByRole('dialog',{name:'重命名订阅'});
  fireEvent.change(within(renameDialog).getByLabelText('订阅名称'),{target:{value:'我的周刊'}});
  fireEvent.click(within(renameDialog).getByRole('button',{name:'保存'}));
  await waitFor(()=>expect(calls.some(call=>call.name==='rss.feed.rename'&&call.input.id==='feed-1'&&call.input.title==='我的周刊')).toBe(true));
  fireEvent.contextMenu(feedRow(),{clientX:120,clientY:160});
  menu=await screen.findByRole('menu');
  fireEvent.click(within(menu).getByRole('menuitem',{name:'删除订阅'}));
  await waitFor(()=>expect(calls.some(call=>call.name==='rss.feed.remove'&&call.input.id==='feed-1')).toBe(true));
  const sources=container.querySelector('.reading-sources') as HTMLElement;
  const folderButton=within(sources).getByRole('button',{name:'技术'});
  fireEvent.contextMenu(folderButton,{clientX:120,clientY:160});
  menu=await screen.findByRole('menu');
  fireEvent.click(within(menu).getByRole('menuitem',{name:'删除分组'}));
  await waitFor(()=>expect(calls.some(call=>call.name==='rss.folder.remove'&&call.input.id==='f1')).toBe(true));
});

it('订阅源有图标时只显示图标，加载失败才回退首字',async()=>{
  clearRemoteImageCache();
  const settings={summaryProvider:'hostModel',summaryModel:'',summaryLang:'zh',autoSummary:false,pollMinutes:15,retentionDays:90,maxEntriesPerFeed:500,fullText:true,remoteImages:true};
  const feed={id:'feed-1',url:'https://example.com/feed.xml',title:'技术周刊',siteUrl:'https://example.com',description:'',icon:'https://example.com/icon.png',enabled:true,unread:2};
  const readingCtx:any={...ctx,slot:'workspace',view:'reading',location:{path:'reading',query:{}},
    rpc:{call:vi.fn(async(name:string)=>{
      if(name==='rss.bootstrap')return {ok:true,data:{folders:[],feeds:[feed],settings,counts:{feeds:1,unread:2,today:0,starred:0}}};
      if(name==='rss.entries.list')return {ok:true,data:{items:[],total:0,unread:0}};
      if(name==='media.image')return {ok:true,data:{data:'data:image/png;base64,YQ=='}};
      return {ok:true,data:{ok:true}};
    })}};
  const {container}=render(<Reading ctx={readingCtx}/>);
  const avatar=await waitFor(()=>{
    const node=container.querySelector('.reading-feed-list .feed-avatar');
    expect(node).not.toBeNull();
    return node as HTMLElement;
  });
  await waitFor(()=>expect(avatar.querySelector('img')).not.toBeNull());
  expect(avatar.querySelector('b')).toBeNull();
  fireEvent.error(avatar.querySelector('img')!);
  await waitFor(()=>expect(avatar.querySelector('b')?.textContent).toBe('技'));
  expect(avatar.querySelector('img')).toBeNull();
});

it('订阅源移动到分组后折叠在分组内，不再出现在订阅源列表',async()=>{
  const settings={summaryProvider:'hostModel',summaryModel:'',summaryLang:'zh',autoSummary:false,pollMinutes:15,retentionDays:90,maxEntriesPerFeed:500,fullText:true,remoteImages:true};
  const folder={id:'f1',name:'技术',createdAt:1,unread:0};
  let feed:any={id:'feed-1',url:'https://example.com/feed.xml',title:'技术周刊',siteUrl:'https://example.com',description:'',icon:'',enabled:true,unread:2};
  const calls:any[]=[];
  const readingCtx:any={...ctx,slot:'workspace',view:'reading',location:{path:'reading',query:{}},
    rpc:{call:vi.fn(async(name:string,input:any)=>{
      calls.push({name,input});
      if(name==='rss.bootstrap')return {ok:true,data:{folders:[folder],feeds:[{...feed}],settings,counts:{feeds:1,unread:2,today:0,starred:0}}};
      if(name==='rss.entries.list')return {ok:true,data:{items:[],total:0,unread:0}};
      if(name==='rss.feed.move'){feed={...feed,folderId:input.folderId||''};return {ok:true,data:{ok:true}};}
      return {ok:true,data:{ok:true}};
    })}};
  const {container}=render(<Reading ctx={readingCtx}/>);
  await screen.findByText('技术周刊');
  fireEvent.contextMenu(screen.getByText('技术周刊'),{clientX:120,clientY:160});
  const menu=await screen.findByRole('menu');
  fireEvent.click(within(menu).getByRole('menuitem',{name:'技术'}));
  await waitFor(()=>expect(calls.some(call=>call.name==='rss.feed.move'&&call.input.folderId==='f1')).toBe(true));
  await waitFor(()=>expect(container.querySelector('.reading-feed-list .reading-feed')).toBeNull());
  expect(container.querySelector('.reading-folder-feeds')).toBeNull();
  const folderRow=container.querySelector('.reading-folder') as HTMLElement;
  fireEvent.click(within(folderRow).getByRole('button',{name:'展开“技术”'}));
  await waitFor(()=>expect(container.querySelector('.reading-folder-feeds .reading-feed')).not.toBeNull());
});

it('窄屏邮件使用抽屉导航并支持返回收件箱',async()=>{
  setViewport(390);
  const account:any={id:'a1',provider:'163',address:'a@example.com',alias:'163',colorToken:'a1',state:{status:'connected'},createdAt:0};
  const summary:any={accountId:'a1',messageId:'m1',from:{name:'Sender',address:'s@example.com'},to:[],cc:[],subject:'窄屏主题',snippet:'摘要',date:0,unread:false,hasAttachments:false};
  const message:any={...summary,text:'正文',attachments:[],remoteContentBlocked:false};
  const mailCtx:any={...ctx,rpc:{call:vi.fn(async(name:string)=>name==='mail.list'
    ?{ok:true,data:{items:[summary],partial:[],updated:1,total:1}}
    :name==='mail.get'?{ok:true,data:message}:{ok:true,data:{}})}};
  const {container}=render(<Mail ctx={mailCtx} accounts={[account]} target="zh" onSettings={()=>{}} compact={false} refreshAccounts={async()=>{}}/>);
  await waitFor(()=>expect(container.querySelector('.mail-row')).not.toBeNull());
  const client=container.querySelector('.mail-client')!;
  const toggle=screen.getByRole('button',{name:'邮箱导航'});
  fireEvent.click(toggle);
  expect(client.classList.contains('nav-open')).toBe(true);
  fireEvent.click(container.querySelector('.mail-folders-scrim')!);
  expect(client.classList.contains('nav-open')).toBe(false);
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('option'));
  await waitFor(()=>expect(container.querySelector('.mail-reader-pane .detail')).not.toBeNull());
  expect(client.classList.contains('nav-open')).toBe(false);
  expect(container.querySelector('.mail-list-pane')?.hasAttribute('inert')).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'返回收件箱'}));
  await waitFor(()=>expect(client.classList.contains('has-selection')).toBe(false));
});

it('窄屏阅读主从切换会收起抽屉并隐藏列表交互',async()=>{
  setViewport(390);
  const settings={summaryProvider:'hostModel',summaryModel:'',summaryLang:'zh',autoSummary:false,pollMinutes:15,retentionDays:90,maxEntriesPerFeed:500,fullText:true,remoteImages:true};
  const item={id:'e1',feedId:'f1',feedTitle:'示例订阅',title:'窄屏文章',snippet:'摘要',publishedAt:0,read:false,starred:false,hasSummary:false};
  const entry={...item,url:'https://example.com/a',contentHtml:'<p>正文</p>',contentText:'正文',feedIcon:''};
  const readingCtx:any={...ctx,slot:'workspace',view:'reading',location:{path:'reading',query:{}},
    rpc:{call:vi.fn(async(name:string)=>name==='rss.bootstrap'
      ?{ok:true,data:{folders:[],feeds:[],settings,counts:{feeds:1,unread:1,today:1,starred:0}}}
      :name==='rss.entries.list'?{ok:true,data:{items:[item],total:1,unread:1}}
        :name==='rss.entry.get'?{ok:true,data:entry}:{ok:true,data:{}})}};
  const {container}=render(<Reading ctx={readingCtx}/>);
  await waitFor(()=>expect(container.querySelector('.reading-row')).not.toBeNull());
  const view=container.querySelector('.reading-view')!;
  expect(view.classList.contains('sources-collapsed')).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'展开订阅源'}));
  expect(view.classList.contains('sources-open')).toBe(true);
  fireEvent.click(container.querySelector('.reading-row')!);
  await waitFor(()=>expect(container.querySelector('.reading-view.article-open')).not.toBeNull());
  expect(view.classList.contains('sources-open')).toBe(false);
  expect(container.querySelector('.reading-list-pane')?.hasAttribute('inert')).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'返回列表'}));
  await waitFor(()=>expect(view.classList.contains('article-open')).toBe(false));
});

it('窄屏文章页提供上一篇和下一篇操作',async()=>{
  setViewport(390);
  const settings={summaryProvider:'hostModel',summaryModel:'',summaryLang:'zh',autoSummary:false,pollMinutes:15,retentionDays:90,maxEntriesPerFeed:500,fullText:true,remoteImages:true};
  const first={id:'m1',feedId:'f1',feedTitle:'示例订阅',title:'第一篇',snippet:'一',publishedAt:2,read:false,starred:false,hasSummary:false};
  const second={id:'m2',feedId:'f1',feedTitle:'示例订阅',title:'第二篇',snippet:'二',publishedAt:1,read:false,starred:false,hasSummary:false};
  const entries:Record<string,any>={
    m1:{...first,url:'https://example.com/1',contentHtml:'<p>正文一</p>',contentText:'正文一',feedIcon:''},
    m2:{...second,url:'https://example.com/2',contentHtml:'<p>正文二</p>',contentText:'正文二',feedIcon:''},
  };
  const readingCtx:any={...ctx,slot:'workspace',view:'reading',location:{path:'reading',query:{}},
    rpc:{call:vi.fn(async(name:string,input:any)=>name==='rss.bootstrap'
      ?{ok:true,data:{folders:[],feeds:[],settings,counts:{feeds:1,unread:2,today:2,starred:0}}}
      :name==='rss.entries.list'?{ok:true,data:{items:[first,second],total:2,unread:2}}
        :name==='rss.entry.get'?{ok:true,data:entries[input.id]}:{ok:true,data:{}})}};
  const {container}=render(<Reading ctx={readingCtx}/>);
  await waitFor(()=>expect(container.querySelectorAll('.reading-row')).toHaveLength(2));
  fireEvent.click(container.querySelectorAll('.reading-row')[0]);
  await waitFor(()=>expect(container.querySelector('.reading-detail-title h2')?.textContent).toBe('第一篇'));
  const next=screen.getByRole('button',{name:'下一篇'}) as HTMLButtonElement;
  expect(next.disabled).toBe(false);
  fireEvent.click(next);
  await waitFor(()=>expect(container.querySelector('.reading-detail-title h2')?.textContent).toBe('第二篇'));
  expect((screen.getByRole('button',{name:'上一篇'}) as HTMLButtonElement).disabled).toBe(false);
});

it('平板与横屏宽度下邮件列表保持可点击',async()=>{
  setViewport(844);
  const account:any={id:'a1',provider:'163',address:'a@example.com',alias:'163',colorToken:'a1',state:{status:'connected'},createdAt:0};
  const first:any={accountId:'a1',messageId:'m1',from:{name:'A',address:'a@example.com'},to:[],cc:[],subject:'第一封',snippet:'一',date:0,unread:false,hasAttachments:false};
  const second:any={...first,messageId:'m2',subject:'第二封',snippet:'二'};
  const mailCtx:any={...ctx,rpc:{call:vi.fn(async(name:string,input:any)=>name==='mail.list'
    ?{ok:true,data:{items:[first,second],partial:[],updated:1,total:2}}
    :name==='mail.get'?{ok:true,data:{...(input.messageId==='m1'?first:second),text:'正文',attachments:[],remoteContentBlocked:false}}
      :{ok:true,data:{}})}};
  const {container}=render(<Mail ctx={mailCtx} accounts={[account]} target="zh" onSettings={()=>{}} compact={false} refreshAccounts={async()=>{}}/>);
  await waitFor(()=>expect(container.querySelectorAll('.mail-row')).toHaveLength(2));
  fireEvent.click(container.querySelectorAll('.mail-row')[0]);
  await waitFor(()=>expect(container.querySelector('.mail-title')?.textContent).toBe('第一封'));
  expect(container.querySelector('.mail-list-pane')?.hasAttribute('inert')).toBe(false);
  fireEvent.click(container.querySelectorAll('.mail-row')[1]);
  await waitFor(()=>expect(container.querySelector('.mail-title')?.textContent).toBe('第二封'));
});

it('平板与横屏宽度下阅读列表保持可点击',async()=>{
  setViewport(844);
  const settings={summaryProvider:'hostModel',summaryModel:'',summaryLang:'zh',autoSummary:false,pollMinutes:15,retentionDays:90,maxEntriesPerFeed:500,fullText:true,remoteImages:true};
  const first={id:'m1',feedId:'f1',feedTitle:'示例订阅',title:'第一篇',snippet:'一',publishedAt:2,read:false,starred:false,hasSummary:false};
  const second={id:'m2',feedId:'f1',feedTitle:'示例订阅',title:'第二篇',snippet:'二',publishedAt:1,read:false,starred:false,hasSummary:false};
  const entries:Record<string,any>={
    m1:{...first,url:'https://example.com/1',contentHtml:'<p>正文一</p>',contentText:'正文一',feedIcon:''},
    m2:{...second,url:'https://example.com/2',contentHtml:'<p>正文二</p>',contentText:'正文二',feedIcon:''},
  };
  const readingCtx:any={...ctx,slot:'workspace',view:'reading',location:{path:'reading',query:{}},
    rpc:{call:vi.fn(async(name:string,input:any)=>name==='rss.bootstrap'
      ?{ok:true,data:{folders:[],feeds:[],settings,counts:{feeds:1,unread:2,today:2,starred:0}}}
      :name==='rss.entries.list'?{ok:true,data:{items:[first,second],total:2,unread:2}}
        :name==='rss.entry.get'?{ok:true,data:entries[input.id]}:{ok:true,data:{}})}};
  const {container}=render(<Reading ctx={readingCtx}/>);
  await waitFor(()=>expect(container.querySelectorAll('.reading-row')).toHaveLength(2));
  fireEvent.click(container.querySelectorAll('.reading-row')[0]);
  await waitFor(()=>expect(container.querySelector('.reading-detail-title h2')?.textContent).toBe('第一篇'));
  expect(container.querySelector('.reading-list-pane')?.hasAttribute('inert')).toBe(false);
  fireEvent.click(container.querySelectorAll('.reading-row')[1]);
  await waitFor(()=>expect(container.querySelector('.reading-detail-title h2')?.textContent).toBe('第二篇'));
});
