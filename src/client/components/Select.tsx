import {useEffect,useId,useRef,useState} from 'react';
import type {CSSProperties,KeyboardEvent,ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from './States';

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

interface MenuBox {
  left: number;
  width: number;
  anchor: number;
  maxHeight: number;
  above: boolean;
}

export function Select({value,options,onChange,label,disabled=false,className='',id}:SelectProps){
  const [open,setOpen]=useState(false);
  const [active,setActive]=useState(-1);
  const [box,setBox]=useState<MenuBox>({left:8,width:180,anchor:0,maxHeight:240,above:false});
  const root=useRef<HTMLDivElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const menu=useRef<HTMLDivElement>(null);
  const listId=useId();
  const selectedIndex=options.findIndex(option=>option.value===value);
  const selected=options[selectedIndex>=0?selectedIndex:0];

  function position(){
    const node=trigger.current;
    if(!node)return;
    const rect=node.getBoundingClientRect();
    const viewport=window.innerWidth||document.documentElement.clientWidth||360;
    const height=window.innerHeight||document.documentElement.clientHeight||640;
    const width=Math.min(Math.max(rect.width,190),viewport-16);
    const left=Math.min(Math.max(rect.left,8),Math.max(8,viewport-width-8));
    const below=height-rect.bottom-14;
    const above=rect.top-14;
    const wanted=Math.min(280,options.length*42+12);
    const placeAbove=below<Math.min(wanted,170)&&above>below;
    setBox({
      left,width,
      anchor:placeAbove?rect.top-6:rect.bottom+6,
      maxHeight:Math.max(120,Math.min(wanted,placeAbove?above:below)),
      above:placeAbove,
    });
  }

  function show(){
    if(disabled)return;
    position();
    setActive(selectedIndex>=0?selectedIndex:0);
    setOpen(true);
  }

  function close(focusTrigger=false){
    setOpen(false);
    if(focusTrigger)trigger.current?.focus();
  }

  function choose(option:SelectOption){
    if(option.disabled)return;
    onChange(option.value);
    close(true);
  }

  useEffect(()=>{
    if(!open)return;
    const outside=(event:MouseEvent)=>{
      const target=event.target as Node;
      if(root.current?.contains(target)||menu.current?.contains(target))return;
      setOpen(false);
    };
    const scroll=(event:Event)=>{
      if(menu.current?.contains(event.target as Node))return;
      setOpen(false);
    };
    const keydown=(event:globalThis.KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();close(true);}
    };
    document.addEventListener('mousedown',outside,true);
    window.addEventListener('scroll',scroll,true);
    window.addEventListener('resize',position);
    document.addEventListener('keydown',keydown);
    return()=>{
      document.removeEventListener('mousedown',outside,true);
      window.removeEventListener('scroll',scroll,true);
      window.removeEventListener('resize',position);
      document.removeEventListener('keydown',keydown);
    };
  },[open]);

  useEffect(()=>{
    if(!open||active<0)return;
    const node=menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[active];
    node?.focus();
  },[open,active]);

  function triggerKeys(event:KeyboardEvent<HTMLButtonElement>){
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      if(open)setActive(index=>Math.min(options.length-1,Math.max(0,index+(event.key==='ArrowDown'?1:-1))));
      else show();
    }else if(event.key==='Enter'||event.key===' '){
      event.preventDefault();
      if(open)close();else show();
    }
  }

  function menuKeys(event:KeyboardEvent<HTMLDivElement>){
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      const direction=event.key==='ArrowDown'?1:-1;
      setActive(index=>Math.min(options.length-1,Math.max(0,index+direction)));
    }else if(event.key==='Home'||event.key==='End'){
      event.preventDefault();
      setActive(event.key==='Home'?0:options.length-1);
    }else if(event.key==='Tab'){
      close();
    }
  }

  const menuStyle:CSSProperties={
    left:box.left,width:box.width,maxHeight:box.maxHeight,
    top:box.anchor,
    transform:box.above?'translateY(-100%)':undefined,
  };

  return <div ref={root} className={'ek-select'+(open?' is-open':'')+(className?' '+className:'')}>
    <button ref={trigger} id={id} type="button" className="ek-select-trigger"
      aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open?listId:undefined}
      disabled={disabled} onClick={()=>open?close():show()} onKeyDown={triggerKeys}>
      <span className="ek-select-value">{selected?.label??''}</span>
      <Icon name="chevron-down" sm/>
    </button>
    {open&&createPortal(<div ref={menu} id={listId} className="ek-select-menu" role="listbox" aria-label={label}
      style={menuStyle} onKeyDown={menuKeys}>
      {options.map((option,index)=><button key={option.value} type="button" role="option"
        aria-selected={option.value===value} disabled={option.disabled}
        className={'ek-select-option'+(index===active?' is-active':'')}
        onMouseEnter={()=>setActive(index)}
        onClick={()=>choose(option)}>
        <span>{option.label}</span>
        {option.value===value&&<Icon name="check" sm/>}
      </button>)}
    </div>,document.body)}
  </div>;
}
