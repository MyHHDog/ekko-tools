import {useRef} from 'react';
import type {MailDraftAttachment} from '../../shared/mail';
import {usesTitleBridgeBudget} from '../draft-upload';
import {Icon} from '../components/States';
import {t,tFormat} from '../i18n';

const formatBytes=(size:number)=>size<1024?`${size} B`:size<1024*1024?`${(size/1024).toFixed(1)} KB`:`${(size/(1024*1024)).toFixed(1)} MB`;

export function MailComposeAttachments({files,disabled,progress,add,remove,cancel}:{files:MailDraftAttachment[];disabled:boolean;progress?:number;add:(files:File[])=>void;remove:(id:string)=>void;cancel:()=>void}){
  const input=useRef<HTMLInputElement>(null);
  return <section className="compose-field compose-attachments" aria-label={t('附件')}>
    <div className="compose-attachment-head">
      <input ref={input} type="file" multiple hidden disabled={disabled} aria-label={t('选择附件文件')} onChange={event=>{
        add(Array.from(event.currentTarget.files??[]));event.currentTarget.value='';
      }}/>
      <button className="compact" type="button" disabled={disabled} onClick={()=>input.current?.click()}><Icon name="clip" sm/>{t('添加附件')}</button>
      <span className="small">{t('最多 5 个附件，合计不超过 10 MB')}</span>
    </div>
    {!!files.length&&<ul className="compose-file-list">{files.map(file=><li key={file.id}>
      <Icon name="draft" sm/><span title={file.name}>{file.name}</span><span className="small">{formatBytes(file.bytes)}</span>
      <button className="compact" type="button" disabled={disabled} aria-label={tFormat('移除附件 {name}',{name:file.name})} onClick={()=>remove(file.id)}><Icon name="close" sm/></button>
    </li>)}</ul>}
    {!!files.length&&usesTitleBridgeBudget()&&<span className="small">{t('iOS 上传大文件较慢，建议使用较小的附件。')}</span>}
    {progress!==undefined&&<div className="compose-attachment-head">
      <progress value={progress} max={100} aria-label={t('附件上传进度')}/>
      <span className="small" role="status">{tFormat('上传附件 {percent}%',{percent:progress})}</span>
      <button className="compact" type="button" onClick={cancel}>{t('取消上传')}</button>
    </div>}
  </section>;
}
