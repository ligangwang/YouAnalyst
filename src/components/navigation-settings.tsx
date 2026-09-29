"use client";
import {useSyncExternalStore} from 'react';
import styles from './navigation-settings.module.css';
import {useLocale} from './providers/locale-provider';
const event='industry-navigation-change';
let speed=1, paused=false;
const subscribe=(notify:()=>void)=>{window.addEventListener(event,notify);window.addEventListener('storage',notify);return()=>{window.removeEventListener(event,notify);window.removeEventListener('storage',notify);};};
function readSpeed(){try{const value=Number(localStorage.getItem('ya-navigation-speed'));if([.5,1,1.5,2].includes(value))return value;}catch{}return speed;}
export function useNavigationSettings(){
 const selectedSpeed=useSyncExternalStore(subscribe,readSpeed,()=>1);
 // Keep labels and saved choices stable; every chart uses the doubled baseline.
 return {selectedSpeed,speed:selectedSpeed*2,paused:useSyncExternalStore(subscribe,()=>paused,()=>false)};
}
export function setNavigationPaused(value:boolean){paused=value;window.dispatchEvent(new Event(event));}
export function NavigationSettings(){
 const {text}=useLocale(),settings=useNavigationSettings();
 return <div className={styles.controls}>
  <label>{text('Tour speed','巡视速度')} <select aria-label={text('Tour speed','巡视速度')} value={settings.selectedSpeed} onChange={e=>{speed=Number(e.target.value);try{localStorage.setItem('ya-navigation-speed',String(speed));}catch{}window.dispatchEvent(new Event(event));}}>
   {([[.5,'Slow','慢速'],[1,'Normal','正常'],[1.5,'Fast','快速'],[2,'Very fast','很快']] as const).map(([value,en,zh])=><option key={value} value={value}>{text(en,zh)} · {value}×</option>)}
  </select></label><button type="button" onClick={()=>setNavigationPaused(!settings.paused)}>{settings.paused?text('Resume tour','继续巡视'):text('Pause tour','暂停巡视')}</button>
 </div>;
}
