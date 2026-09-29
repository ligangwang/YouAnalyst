"use client";
import {useSyncExternalStore} from 'react';
import styles from './navigation-settings.module.css';
import {useLocale} from './providers/locale-provider';
const event='industry-navigation-change';
let speed=1;
const subscribe=(notify:()=>void)=>{window.addEventListener(event,notify);window.addEventListener('storage',notify);return()=>{window.removeEventListener(event,notify);window.removeEventListener('storage',notify);};};
function readSpeed(){try{const value=Number(localStorage.getItem('ya-navigation-speed'));if([.5,1,1.5,2].includes(value))return value;}catch{}return speed;}
export function useNavigationSettings(){
 const selectedSpeed=useSyncExternalStore(subscribe,readSpeed,()=>1);
 // Keep saved choices stable: tree reveal uses the faster baseline; graph uses selectedSpeed.
 return {selectedSpeed,speed:selectedSpeed*2};
}
export function NavigationSettings(){
 const {text}=useLocale(),settings=useNavigationSettings();
 return <div className={styles.controls}>
  <label>{text('Tour speed','巡视速度')} <select aria-label={text('Tour speed','巡视速度')} value={settings.selectedSpeed} onChange={e=>{speed=Number(e.target.value);try{localStorage.setItem('ya-navigation-speed',String(speed));}catch{}window.dispatchEvent(new Event(event));}}>
   {([[.5,'Slow','慢速'],[1,'Normal','正常'],[1.5,'Fast','快速'],[2,'Very fast','很快']] as const).map(([value,en,zh])=><option key={value} value={value}>{text(en,zh)} · {value}×</option>)}
  </select></label>
 </div>;
}
