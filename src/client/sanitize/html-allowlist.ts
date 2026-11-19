import type { RssArticleFont, RssArticleTheme } from '../../shared/rss';

export interface ArticleStyle {
  theme: RssArticleTheme;
  font: RssArticleFont;
  fontSize: number;
  lineHeight: number;
  width: number;
  customCss: string;
}
export const defaultArticleStyle: ArticleStyle = {
  theme: 'paper', font: 'serif', fontSize: 16, lineHeight: 1.85, width: 720, customCss: '',
};
const tags=new Set('A B I U EM STRONG P BR HR DIV SPAN BLOCKQUOTE PRE CODE UL OL LI DL DT DD TABLE THEAD TBODY TR TD TH COLGROUP COL CAPTION IMG FIGURE FIGCAPTION H1 H2 H3 H4 H5 H6 SUB SUP FONT CENTER STYLE'.split(' '));
const drop=new Set('SCRIPT LINK META BASE IFRAME FRAME OBJECT EMBED FORM INPUT BUTTON TEXTAREA SELECT SVG MATH AUDIO VIDEO SOURCE'.split(' '));
const attrs=new Set('href src alt title colspan rowspan span style class width height align valign bgcolor border cellpadding cellspacing color face size dir lang'.split(' '));
const transparentPixel='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
function cleanStyleSheet(value:string){
  return value.replace(/\/\*[\s\S]*?\*\//g,'').replace(/<!--|-->/g,'').replace(/<\/style/gi,'')
    .replace(/@(import|charset)[^;]*(;|$)/gi,'')
    .replace(/(expression|javascript:|vbscript:|behavior\s*:|-moz-binding|url\s*\(|position\s*:\s*(fixed|sticky)|z-index\s*:)[^;}]*;?/gi,'')
    .slice(0,65536);
}
function cleanStyle(value:string){
  return value.split(';').map(item=>item.trim()).filter(Boolean).filter(item=>{
    const at=item.indexOf(':');if(at<1)return false;
    const property=item.slice(0,at).trim().toLowerCase(),body=item.slice(at+1).trim();
    if(!/^[a-z-]+$/.test(property)||!body)return false;
    if(/url\(|expression|javascript:|@import/i.test(body))return false;
    return !/^(position|top|right|bottom|left|z-index|behavior)$/.test(property);
  }).join(';');
}
export function sanitizeClient(raw:string,remoteImages=false) {
  const doc=new DOMParser().parseFromString(raw.slice(0,512*1024),'text/html');
  const styles:string[]=[];
  for(const style of Array.from(doc.querySelectorAll('style'))){
    const css=cleanStyleSheet(style.textContent||'');
    if(css.trim())styles.push(css);
    style.remove();
  }
  for(const element of Array.from(doc.body.querySelectorAll('*'))){
    if(drop.has(element.tagName)){element.remove();continue;}
    if(!tags.has(element.tagName)){element.replaceWith(...element.childNodes);continue;}
    for(const attr of Array.from(element.attributes)){
      if(!attrs.has(attr.name)){element.removeAttribute(attr.name);continue;}
      if(attr.name==='style'){const style=cleanStyle(attr.value);style?element.setAttribute('style',style):element.removeAttribute('style');}
    }
    if(element.tagName==='A'){
      const href=(element.getAttribute('href')||'').replace(/[\u0000-\u0020\u007f]/g,'');
      if(/^(https?:|mailto:)/i.test(href)){
        element.setAttribute('rel','noopener noreferrer nofollow');element.setAttribute('target','_blank');
      }else element.removeAttribute('href');
    }
    if(element.tagName==='IMG'&&!/^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,[a-z0-9+/=]+$/i.test(element.getAttribute('src')||'')){
      if(remoteImages&&/^https?:/i.test(element.getAttribute('src')||'')){
        element.setAttribute('referrerpolicy','no-referrer');
      }else{element.setAttribute('src',transparentPixel);element.setAttribute('alt','');}
    }
  }
  return {html:styles.map(css=>`<style>${css}</style>`).join('')+doc.body.innerHTML};
}
const MAIL_STYLE='html,body{margin:0;padding:0;background:#fff;color:#111;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}img{max-width:100%;height:auto}table{max-width:100%;border-collapse:collapse}td,th{vertical-align:top}a{color:#1a5fb4}';
const ARTICLE_STYLE=`html{background:#fbfaf6}
*{box-sizing:border-box}
html,body{margin:0;color:#20242b;font:16px/1.85 "Noto Serif SC","Source Han Serif SC","Songti SC",Georgia,serif;text-rendering:optimizeLegibility}
body{max-width:720px;margin:0 auto;padding:40px 44px 56px;overflow-wrap:break-word}
h1,h2,h3,h4{line-height:1.38;letter-spacing:-.012em;color:#151a22;margin:1.5em 0 .6em}
h1{margin-top:.2em;font-size:1.82em;letter-spacing:-.02em}
h2{font-size:1.4em}
h3{font-size:1.18em}
h4{font-size:1.04em}
p{margin:0 0 1.1em}
ul,ol{margin:0 0 1.1em;padding-left:1.4em}
li+li{margin-top:.3em}
img{display:block;max-width:100%;height:auto;margin:1.6em auto;border-radius:10px}
figure{margin:1.6em 0}
figcaption{margin-top:.55em;font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#4b5666;text-align:center}
a{color:#2d5f9a;text-underline-offset:2px}
blockquote{margin:1.4em 0;padding:.35em 0 .35em 1.1em;border-left:3px solid #c9d3e2;color:#4b5666}
hr{border:0;border-top:1px solid #d9dee7;margin:2em 0}
pre{overflow:auto;padding:14px 16px;border-radius:10px;background:#eef1f5;font:13px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace}
code{font:13px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace}
table{display:block;width:100%;max-width:100%;overflow-x:auto;border-collapse:collapse;font-size:.92em}
td,th{vertical-align:top;padding:7px 10px;border:1px solid #d9dee7;text-align:left}
th{background:#eef1f5;font-weight:600}
@media (max-width:560px){body{padding:24px 18px 40px;font-size:15px}h1{font-size:1.6em}}`;
const ARTICLE_THEMES: Record<RssArticleTheme, {
  bg: string; text: string; muted: string; heading: string; rule: string; link: string; surface: string;
}> = {
  paper: { bg: '#fbfaf6', text: '#20242b', muted: '#4b5666', heading: '#151a22', rule: '#d9dee7', link: '#2d5f9a', surface: '#eef1f5' },
  sepia: { bg: '#f4ecd8', text: '#43382a', muted: '#766851', heading: '#30271b', rule: '#d8cbb2', link: '#845a1c', surface: '#ece0c7' },
  dark: { bg: '#121a26', text: '#d8e2f0', muted: '#94a5bc', heading: '#f2f6fc', rule: '#2a3648', link: '#8fb8f0', surface: '#1b2533' },
};
const ARTICLE_FONTS: Record<RssArticleFont, string> = {
  serif: '"Noto Serif SC","Source Han Serif SC","Songti SC",Georgia,serif',
  sans: '"Noto Sans SC","PingFang SC","Microsoft YaHei",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  mono: 'ui-monospace,SFMono-Regular,"SF Mono",Consolas,"Liberation Mono",monospace',
};
function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
export function sanitizeArticleCss(value: string) {
  return String(value || '').slice(0, 12000)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--|-->/g, '').replace(/<\/style/gi, '')
    .replace(/@(import|charset|namespace)\b[^;]*(;|$)/gi, '')
    .replace(/(expression|javascript:|vbscript:|behavior\s*:|-moz-binding|url\s*\()[^;}]*;?/gi, '')
    .replace(/(position\s*:\s*(fixed|sticky)|z-index\s*:)[^;}]*;?/gi, '');
}
export function articleDocumentStyle(style?: Partial<ArticleStyle>) {
  const value = { ...defaultArticleStyle, ...style };
  const theme = ARTICLE_THEMES[value.theme] || ARTICLE_THEMES.paper;
  const fontSize = Math.round(clamp(value.fontSize, 12, 24, 16));
  const lineHeight = clamp(value.lineHeight, 1.4, 2.4, 1.85).toFixed(2);
  const width = Math.round(clamp(value.width, 520, 1024, 720));
  const font = ARTICLE_FONTS[value.font] || ARTICLE_FONTS.serif;
  return `${ARTICLE_STYLE}
html{background:${theme.bg}}
html,body{color:${theme.text};font:${fontSize}px/${lineHeight} ${font}}
body{max-width:${width}px}
h1,h2,h3,h4{color:${theme.heading}}
figcaption,blockquote{color:${theme.muted}}
a{color:${theme.link}}
hr,td,th{border-color:${theme.rule}}
pre,code,th{background:${theme.surface}}
blockquote{border-left-color:${theme.rule}}
@media (max-width:560px){body{font-size:${Math.max(12, fontSize - 1)}px}}`;
}
export function articleStyleSheet(style?: Partial<ArticleStyle>) {
  return articleDocumentStyle(style);
}
export function frameDocument(html:string,remoteImages=false,mode:'mail'|'article'='mail',articleStyle?:Partial<ArticleStyle>) {
  const safe=sanitizeClient(html,remoteImages);
  const doc=new DOMParser().parseFromString(safe.html,'text/html');
  const meta=doc.createElement('meta');meta.httpEquiv='Content-Security-Policy';
  meta.content=`default-src 'none'; img-src ${remoteImages?'https: data:':'data:'}; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'`;
  const base=doc.createElement('style');
  base.textContent=mode==='article'?articleStyleSheet(articleStyle):MAIL_STYLE;
  doc.head.prepend(meta);doc.head.append(base);
  const custom=sanitizeArticleCss(articleStyle?.customCss||'');
  if(mode==='article'&&custom.trim()){
    const style=doc.createElement('style');style.textContent=custom;doc.head.append(style);
  }
  return '<!doctype html>'+doc.documentElement.outerHTML;
}
