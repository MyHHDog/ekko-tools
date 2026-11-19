import {useState,useEffect,useRef} from 'react';
import type {ClientHost} from '../adapter/host';
import {call,copyText,readable} from '../rpc-client';
import {t} from '../i18n';
import {Icon} from './States';
import {pickTranslationTarget} from '../../host/selection-overlay';
export function SelectionPopover({ctx,root,enabled,target,onSend}:{ctx:ClientHost;root:HTMLElement|null;enabled:boolean;target:string;onSend:(s:string)=>void}){
  const [text,setText]=useState(''),[result,setResult]=useState(''),[busy,setBusy]=useState(false),[top,setTop]=useState(0);
  const resultRef=useRef<HTMLDivElement>(null),textRef=useRef('');
  const targetRef=useRef(target);targetRef.current=target;
  const sourceRef=useRef<'doc'|'frame'>('doc');
  // 浮条内部交互（含按钮点击的 mouseup 冒泡）不重算选区；选区文本未变化时不重置结果卡片。
  const close=()=>{textRef.current='';setText('');setResult('');};
  useEffect(()=>{
    if(!root||!enabled){textRef.current='';setText('');setResult('');return;}
    const accept=(selected:string,box: {bottom:number}|undefined,source:'doc'|'frame',quiet=false)=>{
      if(selected.trim()&&Array.from(selected).length<=500){
        if(textRef.current!==selected){textRef.current=selected;setText(selected);setResult('');}
        sourceRef.current=source;
        setTop(Math.max(60,Math.min(window.innerHeight-230,(box?.bottom||100)+8)));
      }else if(textRef.current&&!(quiet&&sourceRef.current==='frame'))close();
    };
    const check=(event?:Event)=>{
      const targetWindow=(event?.target as Document|undefined)?.defaultView;
      if(targetWindow&&targetWindow!==window)return;
      if(root.querySelector('.selection-popover')?.contains(document.activeElement))return;
      if(event&&root.querySelector('.selection-popover')?.contains(event.target as Node))return;
      const input=document.activeElement;let selected='';let box:DOMRect|undefined;
      if(input instanceof HTMLTextAreaElement&&root.contains(input)){selected=input.value.slice(input.selectionStart,input.selectionEnd);box=input.getBoundingClientRect();}
      else{const selection=window.getSelection();if(selection?.anchorNode&&root.contains(selection.anchorNode)&&selection.rangeCount){selected=selection.toString();box=selection.getRangeAt(0).getBoundingClientRect();}}
      accept(selected,box,'doc',event?.type==='selectionchange'&&sourceRef.current==='frame');
    };
    const frames=new Map<HTMLIFrameElement,{win:Window;doc:Document;handler:()=>void}>();
    const loadHooks=new Map<HTMLIFrameElement,()=>void>();
    const unbind=(frame:HTMLIFrameElement)=>{
      const bound=frames.get(frame);if(!bound)return;
      bound.win.removeEventListener('mouseup',bound.handler);bound.win.removeEventListener('keyup',bound.handler);
      bound.doc.removeEventListener('selectionchange',bound.handler);frames.delete(frame);
    };
    const bind=(frame:HTMLIFrameElement)=>{
      let win:Window|null=null,doc:Document|null=null;
      try{win=frame.contentWindow;doc=frame.contentDocument;}catch{return;}
      if(!win||!doc)return;
      const bound=frames.get(frame);
      if(bound&&bound.win===win&&bound.doc===doc)return;
      unbind(frame);
      const handler=(event?:Event)=>{
        try{
          const selection=win!.getSelection();
          const range=selection?.rangeCount?selection.getRangeAt(0):undefined;
          if(!selection?.anchorNode||!range||range.collapsed){
            if(event?.type==='mouseup'&&textRef.current)close();
            return;
          }
          const box=range.getBoundingClientRect(),frameBox=frame.getBoundingClientRect();
          accept(selection.toString(),{bottom:frameBox.top+box.bottom},'frame');
        }catch{/* 跨域 iframe 不读取选区。 */}
      };
      win.addEventListener('mouseup',handler);win.addEventListener('keyup',handler);
      doc.addEventListener('selectionchange',handler);
      frames.set(frame,{win,doc,handler});
    };
    const bindFrames=()=>{
      for(const frame of Array.from(root.querySelectorAll('iframe'))){
        bind(frame);
        if(loadHooks.has(frame))continue;
        const onLoad=()=>bind(frame);
        frame.addEventListener('load',onLoad);loadHooks.set(frame,()=>frame.removeEventListener('load',onLoad));
      }
      for(const [frame,hook] of loadHooks)if(!root.contains(frame)){hook();loadHooks.delete(frame);}
      for(const frame of frames.keys())if(!root.contains(frame))unbind(frame);
    };
    const observer=typeof MutationObserver==='undefined'?undefined:new MutationObserver(bindFrames);
    observer?.observe(root,{childList:true,subtree:true});bindFrames();
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')close();};
    const wrappedCheck=(e:Event)=>check(e);
    document.addEventListener('selectionchange',wrappedCheck);root.addEventListener('keyup',wrappedCheck);root.addEventListener('mouseup',wrappedCheck);root.addEventListener('keydown',escape);
    return()=>{observer?.disconnect();document.removeEventListener('selectionchange',wrappedCheck);root.removeEventListener('keyup',wrappedCheck);root.removeEventListener('mouseup',wrappedCheck);root.removeEventListener('keydown',escape);
      for(const hook of loadHooks.values())hook();loadHooks.clear();
      for(const frame of frames.keys())unbind(frame);};
  },[root,enabled]);
  if(!text||!enabled)return null;
  return <aside className="selection-popover" style={{top}} role="toolbar" aria-label={t('划词翻译')} onMouseDown={e=>e.preventDefault()}>
    <div className="row"><button disabled={busy} onClick={async()=>{setBusy(true);try{const job=await call(ctx,'translate.run',{text,from:'auto',to:pickTranslationTarget(text,targetRef.current)});setResult(job.result.translated);}catch(e){setResult(readable(e).message);}finally{setBusy(false);}}}>{busy?t('翻译中…'):t('译')}</button>
      <button onClick={()=>{onSend(text);close();}}>{t('送入翻译')}</button><button className="ibtn" aria-label={t('关闭划词浮条')} title={t('关闭划词浮条')} onClick={close}><Icon name="close" sm/></button></div>
    {result&&<div className="card"><div className="reader" tabIndex={0} ref={resultRef}>{result}</div><button onClick={()=>resultRef.current&&copyText(result,resultRef.current,ctx)}>{t('复制')}</button></div>}
  </aside>;
}
