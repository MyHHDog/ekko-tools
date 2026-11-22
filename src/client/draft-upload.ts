import type {MailDraft,MailDraftSave} from '../shared/mail';
import type {ClientHost} from './adapter/host';
import {call} from './rpc-client';
import {t} from './i18n';
import {uuid} from './uuid';

const timeout=15_000;
export const usesTitleBridgeBudget=()=>/iPhone|iPad|iPod/i.test(navigator.userAgent)||
  (/Macintosh/i.test(navigator.userAgent)&&navigator.maxTouchPoints>1);
const encodeChunk=(bytes:Uint8Array)=>{
  let binary='';
  for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};

export const dropDraftUpload=(ctx:ClientHost,uploadId:string)=>call(ctx,'mail.draft.upload-drop',{uploadId},timeout).catch(()=>{});

export async function stageDraftUpload(ctx:ClientHost,kind:'attachment'|'snapshot',bytes:Uint8Array,signal:AbortSignal,progress?:(bytes:number)=>void){
  signal.throwIfAborted();
  const {uploadId}=await call<{uploadId:string}>(ctx,'mail.draft.upload-start',{kind,bytes:bytes.length},timeout);
  try{
    const size=usesTitleBridgeBudget()?150:/Android/i.test(navigator.userAgent)?12_288:196_608;
    for(let offset=0;offset<bytes.length;offset+=size){
      signal.throwIfAborted();
      const chunk=bytes.subarray(offset,offset+size);
      const wire=`${uploadId}!${offset.toString(36)}!${encodeChunk(chunk)}`;
      const requestId=`du-${uuid().slice(0,13).replace('-','')}`;
      const {received}=await call<{received:number}>(ctx,'mail.draft.upload-chunk',{wire},timeout,requestId);
      signal.throwIfAborted();
      if(received!==offset+chunk.length)throw new Error(t('附件上传未确认，请重试。'));
      progress?.(received);
    }
    signal.throwIfAborted();return uploadId;
  }catch(reason){void dropDraftUpload(ctx,uploadId);throw reason;}
}

export async function saveDraftSnapshot(ctx:ClientHost,input:MailDraftSave,signal:AbortSignal){
  signal.throwIfAborted();
  const json=JSON.stringify(input);
  if(!usesTitleBridgeBudget()||encodeURIComponent(JSON.stringify(json)).length<=250)return call<MailDraft>(ctx,'mail.draft.save',input,timeout);
  const uploadId=await stageDraftUpload(ctx,'snapshot',new TextEncoder().encode(json),signal);
  try{signal.throwIfAborted();return await call<MailDraft>(ctx,'mail.draft.commit',{uploadId},timeout);}
  catch(reason){void dropDraftUpload(ctx,uploadId);throw reason;}
}

export async function readDraftFile(file:File){
  if(typeof file.arrayBuffer==='function')return new Uint8Array(await file.arrayBuffer());
  return new Promise<Uint8Array>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(new Uint8Array(reader.result as ArrayBuffer));reader.onerror=()=>reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
