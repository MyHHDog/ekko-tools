import {useEffect,useState,useRef} from 'react';
import type {Account,MailSummary} from '../../shared/types';
import type {MailPage} from '../../shared/rpc-contract';
import type {ClientHost} from '../adapter/host';
import {mailPath} from '../adapter/host';
import {call,readable,cancelPending} from '../rpc-client';
import {Source} from '../components/AccountChip';
import {State,Icon} from '../components/States';
import {t,tFormat,currentLocale} from '../i18n';
import {MailDetail} from './MailDetail';
function relative(ts:number){const d=new Date(ts),now=new Date();const pad=(n:number)=>String(n).padStart(2,'0');
  if(d.toDateString()===now.toDateString())return pad(d.getHours())+':'+pad(d.getMinutes());
  const yesterday=new Date(now);yesterday.setDate(now.getDate()-1);
  if(d.toDateString()===yesterday.toDateString())return t('昨天');
  if(now.getTime()-ts<604800000)return currentLocale()==='en'?d.toLocaleDateString('en-US',{weekday:'short'}):t('周')+['日','一','二','三','四','五','六'][d.getDay()];
  return tFormat('{m}/{d}',{m:d.getMonth()+1,d:d.getDate()});}
const srcClass:Record<string,string>={'163':'s163',qq:'sqq',gmail:'sgm',custom:'scustom'};
export function Mail({ctx,accounts,target,onTarget,onSettings,compact=false,refreshAccounts,onUnread}:{ctx:ClientHost;accounts:Account[];target:string;onTarget?:(s:string)=>void;onSettings:()=>void;compact?:boolean;refreshAccounts:()=>Promise<void>;onUnread?:(n:number)=>void}){
  const [filter,setFilter]=useState(''),[search,setSearch]=useState(''),[status,setStatus]=useState('全部');
  const [page,setPage]=useState<MailPage>({items:[],updated:0,total:0}),[busy,setBusy]=useState(false),[moreBusy,setMoreBusy]=useState(false),[marking,setMarking]=useState(false),[error,setError]=useState<any>();
  const [selected,setSelected]=useState<MailSummary>(),[index,setIndex]=useState(-1),[translated,setTranslated]=useState<Set<string>>(new Set());
  const list=useRef<HTMLDivElement>(null),sentinel=useRef<HTMLDivElement>(null),alive=useRef(true),generation=useRef(0);
  const inFlight=useRef(false),queued=useRef(false),loadMoreRef=useRef<()=>void>(()=>{});
  const accountKey=accounts.map(a=>a.id).join(',');
  const unreadTotal=Object.values(page.unreadByAccount||{}).reduce((sum,value)=>sum+value,0);
  useEffect(()=>{onUnread?.(unreadTotal);},[unreadTotal,onUnread]);
  async function sync(more=false,silent=false,remote=false){
    if(inFlight.current){if(!more)queued.current=true;return;}
    inFlight.current=true;
    const version=++generation.current;if(!silent)setBusy(true);if(more)setMoreBusy(true);
    try{const data=await call<MailPage>(ctx,'mail.list',{accountIds:filter?[filter]:undefined,cursor:more?page.nextCursor:undefined,limit:20,...(remote?{refresh:true}:{}),__owner:'inbox'});
      if(alive.current&&version===generation.current){
        setPage(old=>{
          const items=more?[...old.items,...data.items]:data.items;
          return {...data,items};
        });
        if(data.partial?.length)setError(data.partial[0]);
        else setError(undefined);
      }
    }catch(e){if(alive.current&&version===generation.current)setError(readable(e));}
    finally{inFlight.current=false;if(more&&alive.current)setMoreBusy(false);if(alive.current&&version===generation.current&&!silent)setBusy(false);
      if(queued.current&&alive.current){queued.current=false;void sync();}}
  }
  loadMoreRef.current=()=>{if(!compact&&page.nextCursor&&!inFlight.current)void sync(true,true);};
  useEffect(()=>{alive.current=true;void sync();const timer=window.setInterval(()=>{if(!inFlight.current&&document.visibilityState==='visible')void sync(false,true);},60000);
    return()=>{alive.current=false;generation.current++;inFlight.current=false;window.clearInterval(timer);cancelPending(ctx,'inbox');};},[filter,accountKey]);
  useEffect(()=>{
    if(compact||!page.nextCursor)return;
    const root=list.current,node=sentinel.current;
    if(!root||!node||typeof IntersectionObserver==='undefined')return;
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))loadMoreRef.current();},{root,rootMargin:'240px 0px'});
    observer.observe(node);return()=>observer.disconnect();
  },[compact,page.nextCursor,filter,accountKey]);
  useEffect(()=>ctx.messages.on('mail.arrived',event=>{
    const value=event.data||event;
    if(filter&&value.accountId&&value.accountId!==filter)return;
    if(!inFlight.current)void sync();
  }),[ctx,filter]);
  useEffect(()=>ctx.messages.on('mail.read',event=>{
    const value=event.data||event;
    if(value.accountId&&value.messageId)setReadState(value.accountId,value.messageId,value.read===true);
  }),[ctx]);
  useEffect(()=>{setSelected(undefined);setIndex(-1);},[filter,status,search]);
  useEffect(()=>{
    const id=String(ctx.location.query.id||''),accountId=String(ctx.location.query.accountId||'');
    if(id&&accountId&&!compact)setSelected({accountId,messageId:id} as MailSummary);
  },[]);
  const visible=page.items.filter(m=>(status!=='未读'||m.unread)&&(status!=='有附件'||m.hasAttachments)&&`${m.subject} ${m.from.name||''} ${m.from.address}`.toLowerCase().includes(search.toLowerCase()));
  function open(mail:MailSummary){if(compact)ctx.ui.navigate(mailPath(mail.accountId,mail.messageId));else setSelected(mail);}
  function close(){setSelected(undefined);void sync();requestAnimationFrame(()=>list.current?.focus());}
  function setReadState(accountId:string,messageId:string,read:boolean){
    const update=(mail:MailSummary)=>mail.accountId===accountId&&mail.messageId===messageId?{...mail,unread:!read}:mail;
    setPage(old=>{
      const current=old.items.find(mail=>mail.accountId===accountId&&mail.messageId===messageId);
      const unreadByAccount={...(old.unreadByAccount||{})};
      if(current&&current.unread!==!read){
        const next=Math.max(0,(unreadByAccount[accountId]||0)+(read?-1:1));
        unreadByAccount[accountId]=next;
      }
      return {...old,items:old.items.map(update),unreadByAccount};
    });
    setSelected(old=>old?update(old):old);
  }
  async function markAllRead(){
    if(marking)return;
    setMarking(true);setError(undefined);
    const previous=page;
    setPage(old=>({...old,items:old.items.map(mail=>({...mail,unread:false})),
      unreadByAccount:Object.fromEntries(Object.entries(old.unreadByAccount||{}).map(([id,count])=>[id,!filter||id===filter?0:count]))}));
    try{
      const result=await call<{updated:number;synced?:boolean}>(ctx,'mail.mark-all-read',{accountIds:filter?[filter]:undefined});
      if(result.synced===false)ctx.ui.notify(t('已在本机标记；服务器同步失败'),'error');
      else ctx.ui.notify(tFormat('{count} 封已标为已读',{count:result.updated}),'success');
      await sync();
    }catch(e){setPage(previous);setError(readable(e));}
    finally{setMarking(false);}
  }
  const selectedAccount=selected?accounts.find(a=>a.id===selected.accountId):undefined;
  const attachmentCount=page.items.filter(m=>m.hasAttachments).length;
  const cached=page.cached??page.items.length;
  return <section className={'mail-view mail-client'+(compact?' compact':'')+(selected?' has-selection':'')} role="tabpanel" aria-label={compact?t('最近邮件'):t('收件箱')}>
    <aside className="mail-folders" aria-label={t('邮箱导航')}>
      <div className="folder-brand"><span className="folder-avatar"><Icon name="mail"/></span><div><strong>{accounts.length===1?accounts[0].alias:t('统一收件箱')}</strong><span className="small">{accounts.length===1?accounts[0].address:tFormat('{count} 个账号',{count:accounts.length})}</span></div></div>
      <nav className="folder-nav" aria-label={t('邮件文件夹')}>
        <button className={status==='全部'&&!filter?'active':''} aria-pressed={status==='全部'&&!filter} onClick={()=>{setStatus('全部');setFilter('');setSelected(undefined);setIndex(-1);}}><Icon name="mail" sm/><span>{t('收件箱')}</span><b>{cached}</b></button>
        <button className={status==='未读'?'active':''} aria-pressed={status==='未读'} onClick={()=>{setStatus('未读');setFilter('');setSelected(undefined);setIndex(-1);}}><Icon name="edit" sm/><span>{t('未读')}</span><b>{unreadTotal}</b></button>
        <button className={status==='有附件'?'active':''} aria-pressed={status==='有附件'} onClick={()=>{setStatus('有附件');setFilter('');setSelected(undefined);setIndex(-1);}}><Icon name="clip" sm/><span>{t('有附件')}</span><b>{attachmentCount}</b></button>
      </nav>
      <div className="folder-accounts">
        <h3>{t('账号')}</h3>
        {accounts.map(a=><button key={a.id} className={filter===a.id?'active':''} aria-pressed={filter===a.id} title={a.address} onClick={()=>{setFilter(filter===a.id?'':a.id);setStatus('全部');setSelected(undefined);setIndex(-1);}}>
          <i className={'dot '+a.provider+' '+a.state.status} aria-hidden="true"/><span className="truncate">{a.alias}</span>{!!page.unreadByAccount?.[a.id]&&<b className="acct-count">{page.unreadByAccount[a.id]}</b>}{a.state.status!=='connected'&&<small>{t('待处理')}</small>}
        </button>)}
        <button className="folder-add" onClick={onSettings}><Icon name="plus" sm/>{t('添加邮箱')}</button>
      </div>
    </aside>
    <section className="mail-list-pane" aria-label={t('邮件列表')}>
      <div className="mail-list-head"><div className="field"><Icon name="search" sm/><input type="search" value={search} aria-label={t('搜索邮件')} onChange={e=>{setSearch(e.target.value);setIndex(-1);}} placeholder={t('搜索发件人、主题')}/></div><button className="ibtn" aria-label={t('全部标为已读')} title={t('全部标为已读')} disabled={busy||marking||!unreadTotal} onClick={()=>void markAllRead()}><Icon name="check" sm/></button><button className="ibtn" aria-label={t('同步')} title={t('同步')} disabled={busy} onClick={()=>sync(false,false,true)}><Icon name="refresh" sm/></button></div>
    {accounts.filter(a=>a.state.status==='auth_failed'||a.state.status==='offline').map(a=>{
      const bad=a.state.status==='auth_failed';
      return <div key={a.id} className={'state '+(bad?'bad':'warn')} role={bad?'alert':'status'}>
        <Icon name={bad?'lock':'alert'}/><div><strong>{a.alias} {bad?t('需要重新授权'):t('连接中断')}</strong>
        <p>{bad?t('登录已过期，重新授权后恢复收信。'):t('正在尝试重新连接，期间不会收到新邮件。')}</p>
        <button className="compact" style={{marginTop:6,display:'flex'}} onClick={bad?onSettings:async()=>{try{await call(ctx,'mail.account.test',{accountId:a.id});await refreshAccounts();await sync(false,false,true);}catch(e){setError(readable(e));}}}>{bad?t('重新授权'):t('立即重连')}</button></div></div>;
    })}
    {error&&<div className="state bad" role="alert"><Icon name="alert"/><div><strong>{t('同步失败')}</strong><p>{error.message}</p>
      <button className="compact" style={{marginTop:6,display:'flex'}} onClick={()=>sync(false,false,true)}>{t('重试')}</button></div></div>}
    {!!page.partial?.length&&page.total>0&&!busy&&<p role="status" className="small">{tFormat('{done}/{total} 个账号已更新',{done:page.updated,total:page.total})}</p>}
    {busy&&!page.items.length&&<State kind="syncing"/>}
    {!accounts.length?<State kind="noAccounts" action={<button onClick={onSettings}>{t('添加邮箱')}</button>}/>:
      !busy&&!visible.length?<State kind={search||status!=='全部'?'emptyFilter':'emptyInbox'} action={<button className="compact" onClick={()=>{const filtered=!!search||status!=='全部';setSearch('');setStatus('全部');void sync(false,false,!filtered);}}>{search||status!=='全部'?t('清除筛选'):t('立即同步')}</button>}/>:null}
    <div className="mail-list" role="listbox" aria-label={t('邮件列表')} tabIndex={0} ref={list} aria-busy={busy||moreBusy} aria-activedescendant={visible[index]?'mail-'+index:undefined} onScroll={e=>{
      const el=e.currentTarget;if(!compact&&page.nextCursor&&!inFlight.current&&el.scrollHeight-el.scrollTop-el.clientHeight<240)loadMoreRef.current();
    }} onKeyDown={e=>{
      if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();setIndex(old=>e.key==='Home'?0:e.key==='End'?visible.length-1:Math.max(0,Math.min(visible.length-1,old+(e.key==='ArrowDown'?1:-1))));}
      if(e.key==='Enter'&&visible[index]){e.preventDefault();open(visible[index]);}
      if(e.key.toLowerCase()==='r')void sync(false,false,true);
    }}>{visible.slice(0,compact?20:visible.length).map((mail,i)=>{
      const account=accounts.find(a=>a.id===mail.accountId);if(!account)return null;
      const who=mail.from.name||mail.from.address;
      const isSelected=selected?.accountId===mail.accountId&&selected?.messageId===mail.messageId;
      return <div id={'mail-'+i} key={mail.accountId+mail.messageId} className={`mail-row ${srcClass[account.provider]}${mail.unread?' unread':''}${isSelected?' sel':''}`} role="option" aria-selected={isSelected} aria-label={`${mail.unread?t('未读邮件，'):''}${who}，${mail.subject}`} onClick={()=>{setIndex(i);open(mail);}}>
        <div className="mail-row-top"><Source account={account}/><span className="time" title={new Date(mail.date).toLocaleString('zh-CN')}>{relative(mail.date)}</span></div>
        <div className="mail-row-body">
          <span className={'udot'+(mail.unread?'':' off')} aria-hidden="true"></span>
          <span className="badge" aria-hidden="true">{(who.trim()[0]||'?').toUpperCase()}</span>
          <div className="main"><div className="l1"><span className="from truncate" title={who}>{who}</span></div>
            <div className="subj truncate" title={mail.subject}>{mail.subject}</div>
            {mail.snippet&&mail.snippet!=='打开查看正文'&&<div className="pv" title={mail.snippet}>{mail.snippet}</div>}
            <div className="l3">{(mail.translated||translated.has(mail.accountId+':'+mail.messageId))&&<span className="tag">{t('已译')}</span>}
              {mail.hasAttachments&&<span className="st" aria-label={t('有附件')}><Icon name="clip" sm/></span>}
            </div></div>
        </div>
      </div>;
    })}
      {page.nextCursor&&!compact&&<div ref={sentinel} className="mail-list-sentinel" aria-hidden="true"/>}
      {moreBusy&&!compact&&<div className="mail-loading-more" role="status"><span className="spin"/></div>}
    </div>
    </section>
    <section className="mail-reader-pane" aria-label={t('邮件阅读')}>
      {selected?selectedAccount?<MailDetail pane key={selected.accountId+selected.messageId} ctx={ctx} account={selectedAccount} messageId={selected.messageId} target={target} onTarget={onTarget} onBack={close} onTranslated={()=>setTranslated(old=>new Set([...old,selected.accountId+':'+selected.messageId]))} onReadChange={read=>setReadState(selected.accountId,selected.messageId,read)} neighbors={visible} onOpen={setSelected}/>:
        <State kind="syncError" detail={t('账号不存在或已移除，请返回收件箱刷新。')} action={<button className="compact" onClick={()=>setSelected(undefined)}>{t('返回收件箱')}</button>}/>:
        <div className="reader-empty"><span className="empty-icon"><Icon name="mail"/></span><h3>{t('选择一封邮件')}</h3></div>}
    </section>
  </section>;
}
