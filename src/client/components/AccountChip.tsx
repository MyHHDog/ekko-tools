import type { Account } from '../../shared/types';
import { Icon } from './States';
import { t } from '../i18n';
export const sources={'163':{shape:'■',name:'163'},qq:{shape:'●',name:'QQ'},gmail:{shape:'▲',name:'Gmail'},custom:{shape:'◆',name:'IMAP'}};
export const connectionLabels={connecting:'连接中',connected:'已连接',auth_failed:'需要重新授权',offline:'连接中断'};
const statusMark={connected:['check','ok'],connecting:['sync',''],auth_failed:['lock','bad'],offline:['alert','warn']} as const;
export function Source({account}:{account:Account}) {const source=sources[account.provider],name=account.provider==='custom'?account.alias:source.name;return <span className={'source src-'+account.provider}><span className="shape" aria-hidden="true">{source.shape}</span>{name}</span>;}
export function AccountChip({account,selected,onClick,tabIndex}:{account:Account;selected?:boolean;onClick:()=>void;tabIndex?:number}){
  const [icon,tone]=statusMark[account.state.status];
  return <button className="chip" tabIndex={tabIndex} aria-pressed={!!selected} aria-label={`${account.alias}，${t(connectionLabels[account.state.status])}`} onClick={onClick}>
    <span className={'st '+tone}><Icon name={icon} sm/></span>{account.provider==='custom'?account.alias:sources[account.provider].name}</button>;
}
