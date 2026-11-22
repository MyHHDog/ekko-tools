import {useEffect,useRef,useState} from 'react';
import type {MailDraft,MailDraftAttachment,MailDraftFields} from '../../shared/mail';
import {blockedAttachmentExtension,cleanDraftFilename,maxDraftAttachmentBytes,maxDraftAttachments} from '../../shared/mail';
import type {ClientHost} from '../adapter/host';
import {call,readable} from '../rpc-client';
import {t,tFormat} from '../i18n';
import {dropDraftUpload,readDraftFile,saveDraftSnapshot,stageDraftUpload} from '../draft-upload';
import {uuid} from '../uuid';

type ComposeFile=MailDraftAttachment&{file?:File};

export function useMailDraft(ctx:ClientHost,draftId:string|null,defaultAccount:string,onChange:()=>void,onClose:()=>void){
  const [fields,setFields]=useState<MailDraftFields>({accountId:defaultAccount,to:'',subject:'',body:''});
  const [saved,setSaved]=useState<MailDraft>(),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const [action,setAction]=useState(''),locked=useRef(false),transfer=useRef<AbortController>(null);
  const [attachments,setAttachments]=useState<ComposeFile[]>([]),[progress,setProgress]=useState<number>();
  const filesChanged=attachments.map(file=>file.id).join(',')!==(saved?.attachments??[]).map(file=>file.id).join(',');
  const ready=!draftId||!!saved,hasContent=!!(fields.to.trim()||fields.subject.trim()||fields.body.trim()||fields.format==='markdown');
  const dirty=filesChanged||(saved?Object.keys(fields).some(key=>fields[key as keyof MailDraftFields]!==saved[key as keyof MailDraftFields]):hasContent);
  useEffect(()=>()=>transfer.current?.abort(),[]);
  useEffect(()=>{
    if(!draftId)return;
    let active=true;
    call<MailDraft>(ctx,'mail.draft.get',{id:draftId}).then(draft=>{
      if(!active)return;
      const {accountId,to,subject,body,format}=draft;
      setFields({accountId,to,subject,body,format});setAttachments(draft.attachments??[]);setSaved(draft);
    }).catch(reason=>{if(active)setError(readable(reason).message);});
    return()=>{active=false;};
  },[ctx,draftId,attempt]);
  const set=<Key extends keyof MailDraftFields>(key:Key,value:MailDraftFields[Key])=>{setError('');setFields(previous=>({...previous,[key]:value}));};
  const retry=()=>{setError('');setAttempt(value=>value+1);};
  function addFiles(files:File[]){
    const list=[...attachments],issues:string[]=[];
    let total=list.reduce((sum,file)=>sum+file.bytes,0);
    for(const file of files){
      const name=cleanDraftFilename(file.name);
      if(!name||!file.size||blockedAttachmentExtension(file.name.trim())||blockedAttachmentExtension(name)){
        issues.push(tFormat('无法添加附件：{name}',{name:file.name}));continue;
      }
      if(list.length>=maxDraftAttachments||total+file.size>maxDraftAttachmentBytes){issues.push(t('最多 5 个附件，合计不超过 10 MB'));break;}
      list.push({id:uuid(),name,bytes:file.size,file});total+=file.size;
    }
    setAttachments(list);setError(issues[0]??'');
  }
  async function save(){
    if(saved&&!dirty)return saved;
    const controller=new AbortController();transfer.current=controller;
    const toUpload=attachments.reduce((sum,file)=>sum+(file.file?file.bytes:0),0),staged:string[]=[];
    const selected:{id:string;name:string}[]=[];
    let uploaded=0,lastPercent=-1;
    const update=(bytes:number)=>{const percent=Math.floor(bytes*100/toUpload);if(percent!==lastPercent){lastPercent=percent;setProgress(percent);}};
    try{
      if(toUpload)update(0);
      for(const entry of attachments){
        let id=entry.id;
        if(entry.file){
          const bytes=await readDraftFile(entry.file);
          id=await stageDraftUpload(ctx,'attachment',bytes,controller.signal,received=>update(uploaded+received));
          staged.push(id);uploaded+=entry.bytes;
        }
        selected.push({id,name:entry.name});
      }
      setProgress(undefined);
      const draft=await saveDraftSnapshot(ctx,{...fields,...(saved?{id:saved.id}:{}),...(filesChanged?{attachments:selected}:{})},controller.signal);
      setSaved(draft);setAttachments(draft.attachments??[]);onChange();return draft;
    }catch(reason){
      for(const id of staged)void dropDraftUpload(ctx,id);
      throw reason;
    }finally{transfer.current=null;setProgress(undefined);}
  }
  async function run(name:'save'|'send'|'delete'|'back',onBack=onClose){
    if(locked.current)return;
    locked.current=true;setAction(name);setError('');
    let submitting=false;
    try{
      if(name==='save'){await save();}
      if(name==='back'){if(ready&&dirty)await save();onBack();}
      if(name==='delete'&&saved&&await ctx.ui.confirm(t('删除这份草稿？'))){
        await call(ctx,'mail.draft.delete',{id:saved.id});onChange();onClose();
      }
      if(name==='send'){
        const draft=await save();submitting=true;
        await call(ctx,'mail.send',{id:draft.id});ctx.ui.notify(t('发件服务器已接收邮件'),'success');onChange();onClose();
      }
    }catch(reason){
      const failure=readable(reason);
      setError(reason instanceof Error&&reason.name==='AbortError'?t('已取消附件上传，可以重新保存或发送。'):
        submitting&&['TIMEOUT','NETWORK_UNREACHABLE','INTERNAL'].includes(failure.code)?t('发送结果未确认，请先检查邮箱再重试。'):failure.message);
    }finally{locked.current=false;setAction('');}
  }
  const removeFile=(id:string)=>{setError('');setAttachments(list=>list.filter(file=>file.id!==id));};
  const cancelUpload=()=>{transfer.current?.abort();setProgress(undefined);};
  return {fields,set,saved,ready,dirty,action,error,setError,run,retry,attachments,addFiles,removeFile,progress,cancelUpload};
}
