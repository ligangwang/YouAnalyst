'use client';
import {useEffect,useState} from 'react';

/** Keep typing responsive; apply the search after 350 ms of inactivity. */
export function DebouncedCompanySearch({value,onSearch,onTyping,disabled,placeholder,resetKey}:{value:string;onSearch:(value:string)=>void;onTyping:()=>void;disabled:boolean;placeholder:string;resetKey:string}){
  const [input,setInput]=useState({value,draft:value,resetKey});
  if(input.value!==value||input.resetKey!==resetKey)setInput({value,draft:value,resetKey});
  useEffect(()=>{
    if(disabled||input.draft===value)return;
    const timer=setTimeout(()=>onSearch(input.draft),350);
    return()=>clearTimeout(timer);
  },[input.draft,value,disabled,onSearch]);
  return <input disabled={disabled} value={input.draft} placeholder={placeholder} onChange={event=>{onTyping();setInput({value,draft:event.target.value,resetKey});}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();onSearch(input.draft);}}}/>;
}
