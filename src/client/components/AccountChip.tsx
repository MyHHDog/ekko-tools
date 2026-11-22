import {useEffect,useState} from 'react';
import type { Account } from '../../shared/types';
import type { ClientHost } from '../adapter/host';
import { Icon } from './States';
import { useRemoteImage } from '../hooks/use-remote-image';
import { t } from '../i18n';
export const sources={'163':{shape:'■',name:'163'},qq:{shape:'●',name:'QQ'},gmail:{shape:'▲',name:'Gmail'},custom:{shape:'◆',name:'IMAP'}};
export const connectionLabels={connecting:'连接中',connected:'已连接',auth_failed:'需要重新授权',offline:'连接中断'};
const statusMark={connected:['check','ok'],connecting:['sync',''],auth_failed:['lock','bad'],offline:['alert','warn']} as const;
const providerIconPaths:Record<string,string>={
  '163':'M3 5h18v14H3z M3 5l9 8 9-8',
  qq:'M4 5h16v11H9l-5 4z M8 9h8 M8 12h5',
  gmail:'M3 6v12h3V9l6 5 6-5v9h3V6l-9 7z',
  custom:'M4 5h16v6H4z M4 13h16v6H4z M8 8h.01 M8 16h.01'
};
const providerFavicons:Record<string,string>={'163':'https://mail.163.com/favicon.ico',qq:'https://mail.qq.com/favicon.ico',gmail:'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico'};
function addressHost(address?:string){
  const host=(address||'').split('@').pop()||'';
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)?host:'';
}
function faviconFor(provider:string,address?:string){
  if(providerFavicons[provider])return providerFavicons[provider];
  const host=addressHost(address);
  return host?`https://${host}/favicon.ico`:'';
}
export function ProviderIcon({ctx,provider,address,status}:{ctx:ClientHost;provider:string;address?:string;status?:string}){
  const src=useRemoteImage(ctx,faviconFor(provider,address));
  const [failed,setFailed]=useState(!src);
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{setFailed(!src);setLoaded(false);},[src]);
  return <span className={'provider-icon p-'+provider+(status?' '+status:'')} aria-hidden="true">
    {(!src||!loaded||failed)&&<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={providerIconPaths[provider]||providerIconPaths.custom}/></svg>}
    {!!src&&!failed&&<img className={loaded?'loaded':''} src={src} alt="" loading="lazy" onLoad={()=>setLoaded(true)} onError={()=>setFailed(true)}/>}
  </span>;
}
export function Source({account}:{account:Account}) {const source=sources[account.provider],name=account.provider==='custom'?account.alias:source.name;return <span className={'source src-'+account.provider}><span className="shape" aria-hidden="true">{source.shape}</span>{name}</span>;}
export function AccountChip({account,selected,onClick,tabIndex}:{account:Account;selected?:boolean;onClick:()=>void;tabIndex?:number}){
  const [icon,tone]=statusMark[account.state.status];
  return <button className="chip" tabIndex={tabIndex} aria-pressed={!!selected} aria-label={`${account.alias}，${t(connectionLabels[account.state.status])}`} onClick={onClick}>
    <span className={'st '+tone}><Icon name={icon} sm/></span>{account.provider==='custom'?account.alias:sources[account.provider].name}</button>;
}
