import {useRef,useState} from 'react';
import type {MailBodyFormat} from '../../shared/mail';
import {renderMailMarkdown} from '../../shared/mail-markdown';
import {Select} from '../components/Select';
import {Icon} from '../components/States';
import {t} from '../i18n';

const tools=[
  {label:'加粗',icon:'bold',prefix:'**',suffix:'**'}, {label:'斜体',icon:'italic',prefix:'*',suffix:'*'},
  {label:'标题',icon:'heading',prefix:'## ',block:true}, {label:'项目列表',icon:'list',prefix:'- ',block:true},
  {label:'引用',icon:'quote',prefix:'> ',block:true}, {label:'行内代码',icon:'code',prefix:'`',suffix:'`'},
  {label:'插入链接',icon:'link',prefix:'[',suffix:'](https://)'},
] as const;

export function MailBodyEditor({body,format,disabled,onBody,onFormat}:{body:string;format:MailBodyFormat;disabled:boolean;onBody:(body:string)=>void;onFormat:(format:MailBodyFormat)=>void}){
  const area=useRef<HTMLTextAreaElement>(null),[preview,setPreview]=useState(false);
  const markdown=format==='markdown',showPreview=markdown&&preview;
  function insert(tool:typeof tools[number]){
    const editor=area.current;if(!editor)return;
    let start=editor.selectionStart,end=editor.selectionEnd;
    const block='block' in tool;
    if(block){start=start===0?0:body.lastIndexOf('\n',start-1)+1;const next=body.indexOf('\n',end);end=next===-1?body.length:next;}
    const selected=body.slice(start,end)||t('文字');
    const replacement=block?selected.split('\n').map(line=>tool.prefix+line).join('\n'):tool.prefix+selected+('suffix' in tool?tool.suffix:'');
    if(body.length-(end-start)+replacement.length>editor.maxLength)return;
    onBody(body.slice(0,start)+replacement+body.slice(end));editor.focus();
    const first=tool.label==='插入链接'?start+replacement.length-9:start+tool.prefix.length;
    requestAnimationFrame(()=>editor.setSelectionRange(first,tool.label==='插入链接'?first+8:Math.min(start+replacement.length,first+selected.length)));
  }
  return <div className="compose-field">
    <div className="compose-body-heading">
      <label htmlFor={showPreview?undefined:'compose-body'}>{t('正文')}</label>
      <Select className="compose-format" label={t('正文格式')} value={format} disabled={disabled} options={[{value:'plain',label:t('纯文本')},{value:'markdown',label:'Markdown'}]}
        onChange={value=>{setPreview(false);onFormat(value as MailBodyFormat);}}/>
    </div>
    <div className="compose-body-frame">
      {markdown&&<div className="compose-toolbar">
        <div className="compose-modes" role="group" aria-label={t('正文视图')}>
          <button type="button" className="compact" aria-pressed={!showPreview} onClick={()=>setPreview(false)}>{t('编辑')}</button>
          <button type="button" className="compact" aria-pressed={showPreview} onClick={()=>setPreview(true)}>{t('预览')}</button>
        </div>
        {!showPreview&&<div className="compose-tools" role="group" aria-label={t('正文格式工具')}>
          {tools.map(tool=><button key={tool.label} className="compact compose-tool" type="button" title={t(tool.label)} aria-label={t(tool.label)} disabled={disabled}
            onMouseDown={event=>event.preventDefault()} onClick={()=>insert(tool)}><Icon name={tool.icon} sm/></button>)}
        </div>}
      </div>}
      {showPreview?<div className="compose-preview compose-body-surface" role="region" aria-label={t('正文预览')}>
        {body.trim()?<div className="compose-preview-content" dangerouslySetInnerHTML={{__html:renderMailMarkdown(body)}}/>:<p className="compose-preview-empty">{t('还没有正文可预览')}</p>}
      </div>:<textarea className="compose-body-surface" ref={area} id="compose-body" maxLength={20000} rows={4} disabled={disabled} value={body} onChange={event=>onBody(event.target.value)}/>}
    </div>
  </div>;
}
