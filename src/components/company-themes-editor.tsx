"use client";
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import {useAuth} from '@/components/providers/auth-provider';
import {useLocale} from './providers/locale-provider';
import type {ThemeAssignment} from '@/lib/company-themes/classification';
type Editor={version:string;themes:{id:string;names:{en:string;'zh-CN':string};roles:string[];roleNames?:Record<string,{en:string;'zh-CN':string}>}[];assignments:ThemeAssignment[]};
export function CompanyThemesEditor({companyId}:{companyId:string}){
  const {user,getIdToken}=useAuth(),{text,chinese}=useLocale(),router=useRouter();
  const [data,setData]=useState<Editor|null>(null),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  const lock=useRef(false);
  const url='/api/admin/company-themes?'+new URLSearchParams({companyId});
  useEffect(()=>{let active=true;setData(null);if(user)void(async()=>{try{const token=await getIdToken();if(!token)return;const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});if(r.ok){const value=await r.json();if(active)setData(value);}}catch{/* Admin controls stay hidden without verified access. */}})();return()=>{active=false;};},[user,getIdToken,url]);
  if(!data)return null;
  function change(theme:string,patch:Partial<ThemeAssignment>){setSaved(false);setData(d=>d&&({...d,assignments:d.assignments.map(a=>a.theme===theme?{...a,...patch}:a)}));}
  async function save(event:FormEvent){
    event.preventDefault();if(lock.current||!data)return;lock.current=true;setBusy(true);setError('');setSaved(false);
    try{const token=await getIdToken();if(!token)throw Error(text('Sign in again.','请重新登录。'));const r=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({version:data.version,assignments:data.assignments})});
      if(!r.ok)throw Error(r.status===409?text('Company changed. Reload the page before saving.','公司资料已更改，请重新加载后保存。'):text('Unable to save. Check themes and source evidence.','无法保存，请检查主题及来源依据。'));
      const fresh=await fetch(url,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});if(!fresh.ok)throw Error(text('Saved. Reload the page to see the current assignments.','已保存，请重新加载页面查看。'));setData(await fresh.json());setSaved(true);router.refresh();
    }catch(e){setError(e instanceof Error?e.message:'Unable to save');}finally{lock.current=false;setBusy(false);}
  }
  return <section className="my-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.025] p-4" aria-label={text('Admin theme controls','管理员主题设置')}>
    <button type="button" aria-expanded={open} onClick={()=>setOpen(!open)} className="text-sm text-[var(--accent-intelligence)]">{text('Edit company themes','编辑公司主题')}</button>
    {open&&<form onSubmit={save} className="mt-4 space-y-4"><p className="text-sm text-[var(--text-secondary)]">{text('Changes publish immediately. Keep at least one theme and provide source evidence.','更改将立即发布。请至少保留一个主题并提供来源依据。')}</p>
      <fieldset disabled={busy} className="max-h-[32rem] space-y-3 overflow-y-auto"><legend className="sr-only">{text('Company themes','公司主题')}</legend>{data.themes.map(theme=>{
        const a=data.assignments.find(a=>a.theme===theme.id),name=theme.names[chinese?'zh-CN':'en'];
        return <div key={theme.id} className="rounded-xl border border-slate-400/20 p-3"><label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(a)} onChange={e=>{setSaved(false);setData(d=>d&&({...d,assignments:e.target.checked?[...d.assignments,{theme:theme.id,primarySector:theme.roles[0],secondaryRoles:[],sources:[{url:'',title:'Official company source',summary:''}]}]:d.assignments.filter(row=>row.theme!==theme.id)}));}}/>{name}</label>
          {a&&<div className="mt-3 grid gap-3"><label className="text-sm">{text('Sector or stage','领域或阶段')}<select aria-label={`${name} ${text('sector','领域')}`} className="mt-1 block w-full rounded border border-slate-400/30 bg-transparent p-2" value={a.primarySector} onChange={e=>change(theme.id,{primarySector:e.target.value,secondaryRoles:[],aiStageIds:undefined})}>{[...new Set([a.primarySector,...theme.roles])].map(role=><option key={role} value={role}>{theme.roleNames?.[role]?.[chinese?'zh-CN':'en']??role}</option>)}</select></label>
            <label className="text-sm">{text('Source URL','来源网址')}<input required type="url" aria-label={`${name} ${text('source URL','来源网址')}`} className="mt-1 block w-full rounded border border-slate-400/30 bg-transparent p-2" value={a.sources[0]?.url??''} onChange={e=>change(theme.id,{sources:[{...(a.sources[0]??{title:'Official company source',summary:''}),url:e.target.value},...a.sources.slice(1)]})}/></label>
            <label className="text-sm">{text('Business evidence','业务依据')}<textarea required maxLength={2400} aria-label={`${name} ${text('business evidence','业务依据')}`} className="mt-1 block w-full rounded border border-slate-400/30 bg-transparent p-2" value={a.sources[0]?.summary??''} onChange={e=>change(theme.id,{sources:[{...(a.sources[0]??{title:'Official company source',url:''}),summary:e.target.value},...a.sources.slice(1)]})}/></label>
          </div>}
        </div>;
      })}</fieldset>
      {error&&<p role="alert" className="text-sm text-red-500">{error}</p>}{saved&&<p role="status" className="text-sm text-emerald-600">{text('Themes saved.','主题已保存。')}</p>}
      <button disabled={busy||!data.assignments.length} className="rounded-xl bg-cyan-300 px-4 py-2 font-medium text-slate-950">{busy?text('Saving…','保存中…'):text('Save themes','保存主题')}</button>
    </form>}
  </section>;
}
