import sanitize from 'sanitize-html';
export const BODY_LIMIT=512*1024;
export const tags='a b i u em strong p br hr div span blockquote pre code ul ol li table thead tbody tr td th colgroup col caption img h1 h2 h3 h4 h5 h6 sub sup center font'.split(' ');
const length=/^-?\d+(\.\d+)?(px|pt|em|rem|%|vw|vh)?$/;
const color=/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i;
const simple=/^[\w\s#%.,()+-]+$/;
const styles:Record<string,RegExp[]>={color:[color],'background-color':[color],background:[color],
  'font-size':[length],'font-family':[/^[\w\s,'"()-]+$/],'font-weight':[/^(normal|bold|[1-9]00)$/],'font-style':[/^(normal|italic|oblique)$/],
  'text-align':[/^(left|right|center|justify)$/],'text-decoration':[/^[\w\s-]+$/],'line-height':[length,/^normal$/],
  padding:[simple],'padding-top':[length],'padding-right':[length],'padding-bottom':[length],'padding-left':[length],
  margin:[simple],'margin-top':[length],'margin-right':[length],'margin-bottom':[length],'margin-left':[length],
  border:[simple],'border-top':[simple],'border-right':[simple],'border-bottom':[simple],'border-left':[simple],
  'border-color':[color],'border-width':[length],'border-style':[/^(none|solid|dashed|dotted)$/],'border-collapse':[/^(collapse|separate)$/],
  width:[length,/^auto$/],'max-width':[/^(100%|\d+(\.\d+)?(px|pt|em|rem|%))$/],height:[length,/^auto$/],'vertical-align':[/^(top|middle|bottom|baseline)$/],
  'white-space':[/^(normal|nowrap|pre|pre-wrap)$/],'word-break':[/^(normal|break-all|break-word)$/],'letter-spacing':[length,/^normal$/],
  'word-wrap':[/^(normal|break-word)$/],'overflow-wrap':[/^(normal|break-word|anywhere)$/],'text-transform':[/^(none|capitalize|uppercase|lowercase)$/],
  'text-indent':[length],'border-spacing':[simple],'border-radius':[simple],float:[/^(left|right|none)$/],'table-layout':[/^(auto|fixed)$/],
  'box-sizing':[/^(content-box|border-box)$/],'min-width':[length],'min-height':[length],opacity:[/^(0|1|0?\.\d+)$/],
  display:[/^(block|inline|inline-block|table|table-row|table-cell|none)$/]};
const tagsAttr=['style','class','width','height','align','valign','bgcolor','colspan','rowspan','span','dir','lang'];
const transparentPixel='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
export function safeMailCss(raw:string){
  return raw.replace(/\/\*[\s\S]*?\*\//g,'').replace(/<!--|-->/g,'').replace(/<\/style/gi,'')
    .replace(/@(import|charset)[^;]*(;|$)/gi,'')
    .replace(/(expression|javascript:|vbscript:|behavior\s*:|-moz-binding|url\s*\(|position\s*:\s*(fixed|sticky)|z-index\s*:)[^;}]*;?/gi,'')
    .slice(0,65536);
}
export function sanitizeHtml(raw:string,images:Record<string,string>={}) {
  let remoteBlocked=false;
  const truncated=Buffer.byteLength(raw)>BODY_LIMIT;
  const css=[...raw.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map(match=>safeMailCss(match[1])).filter(Boolean).join('\n');
  const options:sanitize.IOptions={
    allowedTags:tags,allowedAttributes:{a:['href','rel','target','title','style'],img:['src','alt','title','width','height','style'],
      table:['width','height','align','border','cellpadding','cellspacing','bgcolor','style'],td:tagsAttr,th:tagsAttr,
      colgroup:['width','span','style','align'],col:['width','span','style','align'],caption:['style','align'],
      font:['color','face','size','style'],'*':tagsAttr},
    allowedStyles:{'*':styles},
    allowedSchemes:['https','http','mailto'],allowedSchemesByTag:{img:['data']},allowProtocolRelative:false,
    disallowedTagsMode:'discard',nonTextTags:['script','style','textarea','option','svg','math'],
    transformTags:{
      a:(_tag,attrs)=>{
        const href=(attrs.href||'').replace(/[\u0000-\u0020\u007f]/g,'');
        return {tagName:'a',attribs:{href:/^(https?:|mailto:)/i.test(href)?href:'',rel:'noopener noreferrer nofollow',target:'_blank'}};
      },
      img:(_tag,attrs):sanitize.Tag=>{
        const source=images[attrs.src]||attrs.src||'';
        if(/^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,[a-z0-9+/=]+$/i.test(source)&&source.length<512000)
          return {tagName:'img',attribs:{...attrs,src:source,alt:attrs.alt||'内联图片'}};
        remoteBlocked=true;
        return {tagName:'img',attribs:{...attrs,src:transparentPixel,alt:attrs.alt||''}};
      }
    }
  };
  const styleHtml=css?`<style>${css}</style>`:'',budget=BODY_LIMIT-Buffer.byteLength(styleHtml);
  const input=Buffer.from(raw).subarray(0,BODY_LIMIT).toString('utf8');
  let html=sanitize(input,options);
  if(Buffer.byteLength(html)>budget)html=sanitize(Buffer.from(html).subarray(0,Math.max(0,budget-100)).toString(),options);
  html=styleHtml+html;
  return {html,remoteBlocked,truncated};
}
export function plainText(html:string) {
  return sanitize(html.replace(/<\/(p|div|li|h[1-6]|tr)>/gi,'$&\n\n').replace(/<br\s*\/?>/gi,'\n'),{allowedTags:[],allowedAttributes:{},nonTextTags:['script','style','svg','math']})
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
}
export function filename(value:string) {return value.replace(/[/\\:\u0000-\u001f\u007f]/g,'_').replace(/^\.+/,'_').slice(0,180)||'attachment';}
export function dangerous(name:string,mime:string) {
  return /\.(exe|com|bat|cmd|ps1|msi|scr|js|vbs|lnk|html?|svg|reg|jar|app|sh|hta)$/i.test(name)||
    /x-msdownload|javascript|text\/html|image\/svg|x-sh|x-executable/i.test(mime);
}
