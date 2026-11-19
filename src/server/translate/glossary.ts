import type { GlossaryEntry } from '../../shared/types';
import { assert } from '../../shared/error-codes';

export function normalizeGlossary(value:unknown):GlossaryEntry[] {
  if(value===undefined)return [];
  assert(Array.isArray(value)&&value.length<=100);
  const seen=new Set<string>(),result:GlossaryEntry[]=[];
  for(const raw of value){
    assert(raw&&typeof raw==='object');
    const entry=raw as Partial<GlossaryEntry>;
    assert(typeof entry.source==='string'&&typeof entry.target==='string');
    const source=entry.source.trim(),target=entry.target.trim();
    assert(source.length>=1&&source.length<=100&&target.length>=1&&target.length<=200);
    const key=source.toLowerCase();
    if(seen.has(key))continue;
    seen.add(key);result.push({source,target});
  }
  return result;
}

function escaped(value:string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
}

export function protectGlossary(text:string,entries:GlossaryEntry[]) {
  const active=entries.filter(entry=>text.toLowerCase().includes(entry.source.toLowerCase()));
  if(!active.length)return {text,tokens:new Map<string,string>()};
  const tokens=new Map<string,string>();
  active.forEach((entry,index)=>tokens.set(`⟦EK${index}⟧`,entry.target));
  const pattern=new RegExp(active.slice().sort((a,b)=>b.source.length-a.source.length).map(entry=>`(${escaped(entry.source)})`).join('|'),'giu');
  return {text:text.replace(pattern,match=>{const index=active.findIndex(entry=>entry.source.toLowerCase()===match.toLowerCase());return index<0?match:`⟦EK${index}⟧`;}),tokens};
}

export function restoreGlossary(text:string,tokens:Map<string,string>) {
  let value=text;
  for(const [token,target] of tokens){const index=token.match(/\d+/)?.[0]||'';value=value.replace(new RegExp(`⟦\\s*EK${index}\\s*⟧`,'g'),target);}
  return value;
}

export function glossaryKey(entries:GlossaryEntry[]) {
  return entries.map(entry=>`${entry.source}\u0000${entry.target}`).join('\u0001');
}
