import type { ReactNode } from 'react';
import { t } from '../i18n';
export const stateDefinitions=[
  ['noAccounts','mail','还没有邮箱账号'],['emptyInbox','mail','收件箱是空的'],['emptyFilter','search','没有符合条件的邮件'],
  ['emptyInput','edit','输入或粘贴要翻译的文字'],['syncing','sync','正在同步邮件…'],['translating','sync','正在翻译…'],
  ['syncError','alert','同步失败，请稍后重试'],['translateError','alert','翻译失败，请检查网络后重试'],['missingKey','lock','请先在“翻译设置”里填写 APPID 和密钥'],
  ['unread','dot','未读'],['offline','alert','邮箱连接中断，请重连'],['invalid','lock','账号需要重新授权'],['attachmentError','alert','附件下载失败']
] as const;
const paths:Record<string,string>={mail:'M3 5h18v14H3z M3 5l9 8 9-8',search:'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14 M16 16l5 5',edit:'M4 20l4-1L20 7l-4-4L4 15z',sync:'M20 8A8 8 0 0 0 6 5L3 8 M3 3v5h5 M4 16a8 8 0 0 0 14 3l3-3 M16 16h5v5',alert:'M12 3 2 21h20L12 3z M12 9v5 M12 17v1',lock:'M6 10h12v11H6z M8 10V6a4 4 0 0 1 8 0v4',dot:'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14',trans:'M4 6h9M8.5 4v2M6 6c.5 3 3 6 6 7M12 6c-.5 3-3 6-6 7M13 20l4-9 4 9M14.5 17h5',check:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M8 12.5l3 3 5-6',clip:'M20 11l-8 8a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7-7',refresh:'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',swap:'M4 8h13 M14 5l3 3-3 3 M20 16H7 M10 13l-3 3 3 3',close:'M6 6l12 12 M18 6 6 18','arrow-up':'M12 19V5 M5 12l7-7 7 7','arrow-down':'M12 5v14 M5 12l7 7 7-7','arrow-left':'M19 12H5 M11 18l-6-6 6-6','arrow-right':'M5 12h14 M13 6l6 6-6 6',plus:'M12 5v14 M5 12h14'};
paths.settings='M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0';
paths.translate=paths.trans;
paths.bell='M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4';
paths.palette='M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h5a4 4 0 0 0 0-8h-5z M7.5 8.5h.01 M10.5 6.5h.01 M15.5 7.5h.01';
paths.image='M4 5h16v14H4z M4 15l4-4 3.5 3.5L15 10l5 5 M15.5 8.5h.01';
paths.upload='M12 16V4 M7 9l5-5 5 5 M4 16v4h16v-4';
paths.sliders='M4 6h7 M15 6h5 M11 4v4 M4 12h3 M11 12h9 M7 10v4 M4 18h9 M17 18h3 M13 16v4';
paths.trash='M4 7h16 M9 7V4h6v3 M7 7l1 14h8l1-14 M10 11v6 M14 11v6';
paths.grid='M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z';
paths.rss='M5 5a14 14 0 0 1 14 14 M5 11a8 8 0 0 1 8 8 M5 17h.01';
paths.star='M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z';
paths.spark='M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z';
paths.external='M14 4h6v6 M20 4l-9 9 M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5';
paths.folder='M3 6h7l2 2h9v11H3z';
paths.inbox='M5 4h14l3 9v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5z M2 13h6l1.5 3h5l1.5-3h6';
paths.draft='M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6';
paths['chevron-right']='M9 6l6 6-6 6';
paths['chevron-down']='M6 9l6 6 6-6';
paths.book='M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z M4 21.5V5.5 M8 7h8 M8 11h8';
paths.expand='M8 3H3v5 M16 3h5v5 M21 16v5h-5 M3 16v5h5';
paths.collapse='M3 8h5V3 M21 8h-5V3 M16 21v-5h5 M8 21v-5H3';
paths.bold='M6 4h7a4 4 0 0 1 0 8H6z M6 12h8a4 4 0 0 1 0 8H6z';
paths.italic='M11 4h9 M4 20h9 M15.5 4l-7 16';
paths.heading='M5 5v14 M19 5v14 M5 12h14';
paths.list='M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01';
paths.quote='M9 7H4v6h5l-2 5 M20 7h-5v6h5l-2 5';
paths.code='M8 6l-6 6 6 6 M16 6l6 6-6 6 M14 4l-4 16';
paths.link='M10 13l4-4 M9 16l-2 2a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0 M15 8l2-2a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0';
export function Icon({name='mail',sm=false}:{name?:string;sm?:boolean}){return <svg className={sm?'icon sm':'icon'} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]||paths.mail}/></svg>;}
const EMPTY=/^(noAccounts|emptyInbox|emptyFilter|emptyInput)$/,WARN=/^(missingKey|offline)$/,LOADING=/^(syncing|translating)$/;
export function State({kind,detail,action}:{kind:typeof stateDefinitions[number][0];detail?:string;action?:ReactNode}){
  const definition=stateDefinitions.find(s=>s[0]===kind)!;
  if(EMPTY.test(kind))return <div className="empty" data-state={kind} role="status">
    <span className="ring"><Icon name={definition[1]}/></span><h4>{t(definition[2])}</h4>{detail&&<p className="small">{detail}</p>}{action}
  </div>;
  const tone=WARN.test(kind)?'warn':LOADING.test(kind)?'':'bad';
  return <div className={'state '+tone} data-state={kind} role={tone&&!LOADING.test(kind)?'alert':'status'} aria-busy={LOADING.test(kind)||undefined}>
    <Icon name={definition[1]}/><div><strong>{t(definition[2])}</strong>{detail&&<p>{detail}</p>}{LOADING.test(kind)&&<div className="skeleton" aria-hidden="true"/>}{action}</div>
  </div>;
}
