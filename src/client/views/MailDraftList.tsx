import {useEffect,useState} from 'react';
import type {MailDraftSummary} from '../../shared/mail';
import type {ClientHost} from '../adapter/host';
import {State} from '../components/States';
import {call,readable} from '../rpc-client';
import {currentLocale,t} from '../i18n';

export function MailDraftList({ctx,selected,revision,onOpen}:{ctx:ClientHost;selected:string|null|undefined;revision:number;onOpen:(id:string)=>void}){
  const [items,setItems]=useState<MailDraftSummary[]>(),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let active=true;setError('');
    call<MailDraftSummary[]>(ctx,'mail.draft.list').then(data=>{if(active)setItems(data);})
      .catch(reason=>{if(active)setError(readable(reason).message);});
    return()=>{active=false;};
  },[ctx,revision,retry]);
  if(error)return <State kind="syncError" detail={error} action={<button onClick={()=>setRetry(value=>value+1)}>{t('重试')}</button>}/>;
  if(!items)return <State kind="syncing" detail={t('正在加载草稿…')}/>;
  if(!items.length)return <div className="state" role="status"><strong>{t('还没有草稿')}</strong></div>;
  return <div className="mail-list draft-list" aria-label={t('草稿箱')}>
    {items.map(draft=><button type="button" key={draft.id} className={'mail-row draft-row'+(draft.id===selected?' sel':'')} aria-current={draft.id===selected?true:undefined} onClick={()=>onOpen(draft.id)}>
      <span className="mail-row-top"><span className="from truncate">{draft.to||t('未填写收件人')}</span></span>
      <span className="subj truncate">{draft.subject||t('无主题')}</span>
      <span className="mail-row-foot"><time className="time" dateTime={new Date(draft.updatedAt).toISOString()}>{new Date(draft.updatedAt).toLocaleString(currentLocale()==='en'?'en-US':'zh-CN')}</time></span>
    </button>)}
  </div>;
}
