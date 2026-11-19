import {useEffect,useState} from 'react';
import type {ClientHost} from '../adapter/host';
import type {Bootstrap} from '../../shared/rpc-contract';
import {Icon} from '../components/States';
import {t} from '../i18n';
import {MailSettings} from './settings/MailSettings';
import {TranslationSettings} from './settings/TranslationSettings';
import {SystemSettings} from './settings/SystemSettings';
import {NotificationSettings} from './settings/NotificationSettings';
import {AppearanceSettings} from './settings/AppearanceSettings';
import {ReadingSettings} from './settings/ReadingSettings';
type Section='mail'|'translate'|'reading'|'appearance'|'notify'|'system';
const sections:{id:Section;label:string;icon:string}[]=[
  {id:'mail',label:'邮箱账号',icon:'mail'},
  {id:'translate',label:'翻译服务',icon:'translate'},
  {id:'reading',label:'阅读设置',icon:'rss'},
  {id:'appearance',label:'外观',icon:'palette'},
  {id:'notify',label:'通知设置',icon:'bell'},
  {id:'system',label:'数据与诊断',icon:'settings'}
];
export function Settings({ctx,data,refresh,onSelection}:{ctx:ClientHost;data:Bootstrap;refresh:()=>Promise<void>;onSelection:(v:boolean)=>void}){
  const requested=String(ctx.location.query.section||'');
  const [section,setSection]=useState<Section>(sections.some(item=>item.id===requested)?requested as Section:'mail');
  useEffect(()=>{if(sections.some(item=>item.id===requested))setSection(requested as Section);},[requested]);
  return <main className="ek-panel workspace settings-page">
    <div className="settings-layout">
      <nav className="settings-nav" aria-label={t('设置分区')}>{sections.map(item=>
        <button key={item.id} aria-pressed={section===item.id} onClick={()=>setSection(item.id)}>
          <Icon name={item.icon} sm/>{t(item.label)}{item.id==='mail'&&data.accounts.length>0&&<span className="seg-badge">{data.accounts.length}</span>}
        </button>)}</nav>
      <div className="settings-body">
        {section==='mail'&&<MailSettings ctx={ctx} data={data} refresh={refresh}/>}
        {section==='translate'&&<TranslationSettings ctx={ctx} data={data} refresh={refresh} onSelection={onSelection}/>}
        {section==='reading'&&<ReadingSettings ctx={ctx}/>}
        {section==='appearance'&&<AppearanceSettings ctx={ctx}/>}
        {section==='notify'&&<NotificationSettings ctx={ctx} data={data}/>}
        {section==='system'&&<SystemSettings ctx={ctx} data={data}/>}
      </div>
    </div>
  </main>;
}
