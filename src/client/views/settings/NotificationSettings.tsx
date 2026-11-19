import {useEffect,useState} from 'react';
import type {ClientHost} from '../../adapter/host';
import type {Bootstrap} from '../../../shared/rpc-contract';
import {defaultNotifications,inQuietHours,normalizeNotifications} from '../../../shared/notifications';
import type {NotificationSettings as Settings} from '../../../shared/notifications';
import {call,readable} from '../../rpc-client';
import {Icon} from '../../components/States';
import {t,tFormat} from '../../i18n';

export function NotificationSettings({ctx,data}:{ctx:ClientHost;data:Bootstrap}){
  const [draft,setDraft]=useState<Settings>(defaultNotifications),[busy,setBusy]=useState(false),[error,setError]=useState<any>(),[saved,setSaved]=useState(false);
  useEffect(()=>{let active=true;call(ctx,'settings.get').then(value=>{if(active)setDraft(normalizeNotifications(value.notifications));}).catch(e=>{if(active)setError(readable(e));});return()=>{active=false;};},[]);
  function change(next:Partial<Settings>){setDraft(current=>({...current,...next}));setSaved(false);}
  function toggleMute(id:string){change({mutedAccountIds:draft.mutedAccountIds.includes(id)?draft.mutedAccountIds.filter(item=>item!==id):[...draft.mutedAccountIds,id]});}
  async function save(){
    setBusy(true);setError(undefined);setSaved(false);
    const notifications=normalizeNotifications(draft);setDraft(notifications);
    try{await call(ctx,'settings.save',{notifications});setSaved(true);ctx.ui.notify(t('通知设置已保存'),'success');}
    catch(e){setError(readable(e));}
    finally{setBusy(false);}
  }
  const quiet=draft.enabled&&inQuietHours(draft);
  return <section className="settings-section" aria-label={t('通知设置')}>
    <div className="section-heading"><div><h2>{t('通知设置')}</h2><p className="small">{t('控制新邮件提醒与免打扰时段。')}</p></div></div>
    <div className="card settings-form notify-form">
      <label className="notify-row"><span><strong>{t('新邮件提醒')}</strong><small>{t('插件打开时每 60 秒检查一次新邮件。')}</small></span>
        <input type="checkbox" checked={draft.enabled} onChange={e=>change({enabled:e.target.checked})}/><span className="notify-switch" aria-hidden="true"/></label>
      <label className="notify-row"><span><strong>{t('免打扰时段')}</strong><small>{quiet?tFormat('当前处于免打扰（{start}–{end}）',{start:draft.dndStart,end:draft.dndEnd}):t('在设定时段内不弹提醒。')}</small></span>
        <input type="checkbox" checked={draft.dndEnabled} onChange={e=>change({dndEnabled:e.target.checked})}/><span className="notify-switch" aria-hidden="true"/></label>
      {draft.dndEnabled&&<div className="notify-times">
        <label>{t('开始')}<input type="time" value={draft.dndStart} onChange={e=>change({dndStart:e.target.value})}/></label>
        <span className="time-arrow" aria-hidden="true"><Icon name="arrow-right" sm/></span>
        <label>{t('结束')}<input type="time" value={draft.dndEnd} onChange={e=>change({dndEnd:e.target.value})}/></label>
      </div>}
      <div className="notify-accounts">
        <div className="row"><strong>{t('静音账号')}</strong><span className="spacer"/><small>{tFormat('已静音 {count} 个',{count:draft.mutedAccountIds.length})}</small></div>
        {data.accounts.length?data.accounts.map(account=><label key={account.id} className="notify-account">
          <input type="checkbox" checked={draft.mutedAccountIds.includes(account.id)} onChange={()=>toggleMute(account.id)}/>
          <span className="notify-check" aria-hidden="true"/>
          <span>{account.alias}<small>{account.address}</small></span>
        </label>):<p className="small">{t('添加邮箱后可单独静音某个账号。')}</p>}
      </div>
      {error&&<p className="state bad" role="alert"><Icon name="alert"/><span>{error.code} · {error.message}</span></p>}
      {saved&&<p className="state" role="status"><Icon name="check"/><span>{t('通知设置已保存')}</span></p>}
      <div className="row wrap"><button type="button" className="primary" disabled={busy} onClick={()=>void save()}>{busy?t('正在保存…'):t('保存通知设置')}</button></div>
    </div>
  </section>;
}
