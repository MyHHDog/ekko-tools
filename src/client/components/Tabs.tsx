import {Icon} from './States';
export function Tabs({items,value,onChange,label,icons,badges}:{items:string[];value:string;onChange:(v:string)=>void;label:string;icons?:Record<string,string>;badges?:Record<string,number>}) {
  return <div className="tabs" role="tablist" aria-label={label}>{items.map((item,index)=><button key={item} role="tab"
    aria-selected={value===item} tabIndex={value===item?0:-1} onClick={()=>onChange(item)}
    onKeyDown={e=>{if(['ArrowRight','ArrowLeft','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowRight'?1:-1)+items.length)%items.length;onChange(items[next]);(e.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();}}}>
    {icons?.[item]&&<Icon name={icons[item]} sm/>}{item}{badges?.[item]?<span className="seg-badge">{badges[item]}</span>:null}</button>)}</div>;
}
