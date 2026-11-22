import {useImperativeHandle,type Ref} from 'react';
import type {Account} from '../../shared/types';
import {isMailboxAddress} from '../../shared/mail';
import type {ClientHost} from '../adapter/host';
import {Select} from '../components/Select';
import {Icon,State} from '../components/States';
import {t} from '../i18n';
import {useMailDraft} from './useMailDraft';
import {MailBodyEditor} from './MailBodyEditor';
import {MailComposeAttachments} from './MailComposeAttachments';

export type LeaveMailCompose=(onLeave:()=>void)=>Promise<void>;

export function MailCompose({ctx,accounts,draftId,defaultAccount,onChange,onClose,leaveRef}:{ctx:ClientHost;accounts:Account[];draftId:string|null;defaultAccount:string;onChange:()=>void;onClose:()=>void;leaveRef?:Ref<LeaveMailCompose>}){
  const {fields,set,saved,ready,dirty,action,error,setError,run,retry,attachments,addFiles,removeFile,progress,cancelUpload}=useMailDraft(ctx,draftId,defaultAccount,onChange,onClose);
  useImperativeHandle(leaveRef,()=>onLeave=>run('back',onLeave));
  const hasSender=accounts.some(account=>account.id===fields.accountId);
  return <article className="detail detail-pane mail-compose">
    <div className="row compose-head">
      <button className="compact" autoFocus disabled={!!action} onClick={()=>void run('back')}><Icon name="arrow-left" sm/>{t('返回')}</button>
      <h2 className="mail-title">{t('写邮件')}</h2>
    </div>
    {!ready?(error?<State kind="syncError" detail={error} action={<button onClick={retry}>{t('重试')}</button>}/>:<State kind="syncing" detail={t('正在打开草稿…')}/>):
      <form className="compose-form" noValidate onSubmit={event=>{
        event.preventDefault();
        if(!hasSender){setError(t('请选择发件账号'));return;}
        if(!isMailboxAddress(fields.to.trim())){setError(t('请输入一个有效的收件地址'));return;}
        if(!fields.subject.trim()){setError(t('请填写邮件主题'));return;}
        if(!fields.body.trim()&&!attachments.length){setError(t('请填写正文或添加附件'));return;}
        void run('send');
      }}>
        <div className="compose-field">
          <label htmlFor="compose-account">{t('发件账号')}</label>
          <Select id="compose-account" label={t('发件账号')} value={hasSender?fields.accountId:''} disabled={!!action||!accounts.length}
            options={[{value:'',label:t(accounts.length?'请选择发件账号':'请先添加邮箱账号'),disabled:true},...accounts.map(account=>({value:account.id,label:`${account.alias} · ${account.address}`}))]} onChange={value=>set('accountId',value)}/>
        </div>
        <div className="compose-field">
          <label htmlFor="compose-to">{t('收件人')}</label>
          <input id="compose-to" type="email" maxLength={254} disabled={!!action} value={fields.to} onChange={event=>set('to',event.target.value)}/>
        </div>
        <div className="compose-field">
          <label htmlFor="compose-subject">{t('主题')}</label>
          <input id="compose-subject" maxLength={200} disabled={!!action} value={fields.subject} onChange={event=>set('subject',event.target.value)}/>
        </div>
        <MailBodyEditor body={fields.body} format={fields.format??'plain'} disabled={!!action} onBody={value=>set('body',value)} onFormat={value=>set('format',value)}/>
        <MailComposeAttachments files={attachments} disabled={!!action} progress={progress} add={addFiles} remove={removeFile} cancel={cancelUpload}/>
        {error&&<p className="state bad" role="alert">{error}</p>}
        <div className="row compose-actions">
          <button type="button" disabled={!!action||!dirty} onClick={()=>void run('save')}>{t('保存草稿')}</button>
          {saved&&<button type="button" disabled={!!action} onClick={()=>void run('delete')}>{t('删除草稿')}</button>}
          <span className="small compose-status" role="status">{action==='save'||(action==='back'&&dirty)?t('正在保存草稿…'):dirty?t('未保存'):saved?t('已保存到草稿箱'):''}</span>
          <button className="primary" type="submit" disabled={!!action}>{t(action==='send'?'发送中…':'发送')}</button>
        </div>
      </form>}
  </article>;
}
