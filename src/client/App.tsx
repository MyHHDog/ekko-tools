import {useState,useEffect,useRef} from 'react';
import type {ClientHost} from './adapter/host';
import {resolveSlot,settingsPath} from './adapter/host';
import type {Bootstrap} from '../shared/rpc-contract';
import {call,readable} from './rpc-client';
import {Translate} from './views/Translate';
import {Mail} from './views/Mail';
import {Reading} from './views/Reading';
import {Settings} from './views/Settings';
import {State} from './components/States';
import {SelectionPopover} from './components/SelectionPopover';
import {installStudioSelection} from './studio-selection';
import {readBootstrapCache,writeBootstrapCache} from './bootstrap-cache';
import {t,tFormat} from './i18n';
import {defaultNotifications,inQuietHours,normalizeNotifications} from '../shared/notifications';
export function App({ctx,initialData,refreshOnMount=false}:{ctx:ClientHost;initialData?:Bootstrap;refreshOnMount?:boolean}){
  const slot=resolveSlot(ctx),requested=String(ctx.view||ctx.location.query.view||'');
  const initialTab=requested==='mail'||slot==='mail'?'收件箱':requested==='reading'||slot==='reading'?'阅读':'翻译';
  const [tab,setTab]=useState(initialTab);
  const [mounted,setMounted]=useState<Set<string>>(()=>new Set([initialTab]));
  const showTab=(next:string)=>{setMounted(old=>old.has(next)?old:new Set(old).add(next));setTab(next);};
  const activeTabRef=useRef(tab);
  activeTabRef.current=tab;
  const [data,setData]=useState<Bootstrap|undefined>(()=>initialData??readBootstrapCache(ctx)),[error,setError]=useState<any>(),[fragment,setFragment]=useState(''),[target,setTarget]=useState('zh'),[selection,setSelection]=useState(true),[selectionReady,setSelectionReady]=useState(false),[unread,setUnread]=useState(0);
  const bootstrapped=useRef(initialData);
  const [node,setNode]=useState<HTMLElement|null>(null),active=useRef(true),seen=useRef(new Set<string>()),polling=useRef(false);
  const notifySettings=useRef(defaultNotifications);
  async function refresh(){const value=await call<Bootstrap>(ctx,'app.bootstrap');if(active.current){setData(value);setError(undefined);writeBootstrapCache(ctx,value);}}
  useEffect(()=>{
    active.current=true;
    void (async()=>{
      try{
        if(bootstrapped.current&&!refreshOnMount)writeBootstrapCache(ctx,bootstrapped.current);else await refresh();
      }catch(e){if(active.current)setError(readable(e));}
      try{
        const settings=await call(ctx,'settings.get');if(!active.current)return;
        setSelection(settings.selection!==false);notifySettings.current=normalizeNotifications(settings.notifications);setSelectionReady(true);
      }catch(e){if(active.current){setError(readable(e));setSelectionReady(true);}}
    })();
    const unsubscribe=['account.state','mail.arrived','translate.progress'].map(type=>ctx.messages.on(type,event=>{
      if(event.identity&&ctx.identity&&(event.identity.userId!==ctx.identity.userId||event.identity.profile!==ctx.identity.profile))return;
      const value=event.data||event;if(!value.eventId||seen.current.has(value.eventId))return;seen.current.add(value.eventId);
      if(seen.current.size>500)seen.current.delete(seen.current.values().next().value!);
      if(type==='account.state')setData(old=>old?{...old,accounts:old.accounts.map(a=>a.id===value.accountId?{...a,state:value.state}:a)}:old);
      if(type==='mail.arrived'){
        if(activeTabRef.current==='收件箱')return;
        const settings=notifySettings.current;
        const muted=settings.mutedAccountIds.includes(value.accountId);
        if(value.count<=0||!settings.enabled||muted||inQuietHours(settings))return;
        ctx.ui.notify(tFormat('收到 {count} 封新邮件',{count:value.count}));
      }
    }));
    return()=>{active.current=false;unsubscribe.forEach(fn=>fn());};
  },[]);
  useEffect(()=>{
    const next=String(ctx.view||ctx.location.query.view||'');
    if(next==='mail'||slot==='mail')showTab('收件箱');else if(next==='reading'||slot==='reading')showTab('阅读');else if(next==='translate')showTab('翻译');
  },[ctx.view,ctx.location.query.view,slot]);
  useEffect(()=>{
    if(!selectionReady)return;
    installStudioSelection({enabled:selection,target,pluginId:ctx.plugin?.id||'ekko-tools'});
  },[selection,selectionReady,target,ctx.plugin?.id]);
  useEffect(()=>{
    const mailMounted=slot!=='settings'&&slot!=='sidebar'&&tab==='收件箱';
    if(!data?.accounts.length||mailMounted)return;
    const timer=window.setInterval(()=>{
      if(polling.current||document.visibilityState!=='visible')return;
      polling.current=true;
      void call(ctx,'mail.list',{limit:20,__owner:'poll'}).catch(()=>{}).finally(()=>{polling.current=false;});
    },60000);
    return()=>window.clearInterval(timer);
  },[ctx,slot,tab,data?.accounts.length]);
  if(slot==='sidebar')return null;
  if(!data)return <main className="ek-panel workspace" aria-busy="true">{error?<div className="panel-error"><State kind="syncError" detail={error.message} action={<button onClick={()=>refresh().catch(e=>setError(readable(e)))}>重试</button>}/></div>:<BootShell/>}</main>;
  if(slot==='settings')return <Settings ctx={ctx} data={data} refresh={refresh} onSelection={setSelection}/>;
  return <main className={`ek-panel workspace view-${tab==='收件箱'?'mail':tab==='阅读'?'reading':'translate'}`} ref={setNode} onKeyDown={e=>{
    if(e.altKey&&e.key==='1'){e.preventDefault();showTab('翻译');}if(e.altKey&&e.key==='2'){e.preventDefault();showTab('收件箱');}if(e.altKey&&e.key==='3'){e.preventDefault();showTab('阅读');}
  }}>
    {error&&<div className="panel-error"><State kind="syncError" detail={error.message} action={<button className="compact" onClick={()=>setError(undefined)}>{t('关闭提示')}</button>}/></div>}
    <div className="panel-content">
      <div className="view-slot" hidden={tab!=='翻译'}>
        {mounted.has('翻译')&&<Translate ctx={ctx} fragment={fragment} target={target} onTarget={setTarget} onSettings={()=>ctx.ui.navigate(settingsPath+'?section=translate')} selection={selection} onSelection={setSelection} providers={data.providers}/>}
      </div>
      <div className="view-slot" hidden={tab!=='阅读'}>
        {mounted.has('阅读')&&<Reading ctx={ctx}/>}
      </div>
      <div className="view-slot" hidden={tab!=='收件箱'}>
        {mounted.has('收件箱')&&<Mail ctx={ctx} accounts={data.accounts} target={target} onTarget={setTarget} onSettings={()=>ctx.ui.navigate(settingsPath+'?section=mail')} compact={false} refreshAccounts={refresh} onUnread={setUnread} hidden={tab!=='收件箱'}/>}
      </div>
    </div>
    <SelectionPopover ctx={ctx} root={node} enabled={selection} target={target} onSend={text=>{setFragment(text);showTab('翻译');}}/>
  </main>;
}
function BootShell(){
  return <div className="boot-shell" role="status" aria-busy="true" aria-label={t('正在加载')}>
    <div className="boot-head"><span className="boot-title"/><span className="boot-icon"/></div>
    <div className="boot-body"><span className="boot-line"/><span className="boot-line short"/></div>
  </div>;
}
