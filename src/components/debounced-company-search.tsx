'use client';
import {useEffect,useState} from 'react';

/** Keep typing responsive; apply the search after 350 ms of inactivity. */
export function DebouncedCompanySearch({value,onSearch,disabled,placeholder}:{value:string;onSearch:(value:string)=>void;disabled:boolean;placeholder:string}){
  const [input,setInput]=useState({value,draft:value});
  if(input.value!==value)setInput({value,draft:value});
  useEffect(()=>{
    if(disabled||input.draft===value)return;
    const timer=setTimeout(()=>onSearch(input.draft),350);
    return()=>clearTimeout(timer);
  },[input.draft,value,disabled,onSearch]);
  return <input disabled={disabled} value={input.draft} placeholder={placeholder} onChange={event=>setInput({value,draft:event.target.value})} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();onSearch(input.draft);}}}/>;
}
