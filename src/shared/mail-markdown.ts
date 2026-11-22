const escape = (text:string) => text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const inlinePattern = /(`[^`\r\n]+`|\*\*[^*\r\n]+\*\*|\*[^*\r\n]+\*|\[[^[\]\r\n]+\]\(https?:\/\/[^\s()<>]+\))/gi;

function inline(text:string) {
  return text.split(inlinePattern).map((part,index)=>{
    if(index%2===0)return escape(part);
    if(part.startsWith('`'))return `<code>${escape(part.slice(1,-1))}</code>`;
    if(part.startsWith('**'))return `<strong>${escape(part.slice(2,-2))}</strong>`;
    if(part.startsWith('*'))return `<em>${escape(part.slice(1,-1))}</em>`;
    const split=part.lastIndexOf(']('),label=part.slice(1,split),href=part.slice(split+2,-1);
    try{
      const url=new URL(href);
      if(['http:','https:'].includes(url.protocol))return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>`;
    }catch{return escape(part);}
    return escape(part);
  }).join('');
}

export function renderMailMarkdown(text:string) {
  const blocks:string[]=[],pending:string[]=[];
  let kind='p', fenced=false;
  function flush(){
    if(!pending.length)return;
    if(kind==='pre')blocks.push(`<pre><code>${escape(pending.join('\n'))}</code></pre>`);
    else if(kind==='ul'||kind==='ol')blocks.push(`<${kind}>${pending.map(line=>`<li>${inline(line)}</li>`).join('')}</${kind}>`);
    else blocks.push(`<${kind}>${pending.map(inline).join('<br>')}</${kind}>`);
    pending.length=0;
  }
  for(const line of text.replace(/\r\n?/g,'\n').split('\n')){
    if(/^```[\w-]*\s*$/.test(line)){flush();fenced=!fenced;kind=fenced?'pre':'p';continue;}
    if(fenced){pending.push(line);continue;}
    if(!line.trim()){flush();continue;}
    const heading=/^(#{1,3})\s+(.+)$/.exec(line);
    if(heading){flush();const tag=`h${heading[1].length}`;blocks.push(`<${tag}>${inline(heading[2])}</${tag}>`);continue;}
    const bullet=/^\s*((?:[-*+]|\d+\.)\s+|>\s?)(.*)$/.exec(line);
    const next=bullet?bullet[1].startsWith('>')?'blockquote':/^\d/.test(bullet[1])?'ol':'ul':'p';
    if(kind!==next){flush();kind=next;}
    pending.push(bullet?bullet[2]:line);
  }
  flush();return blocks.join('\n');
}
