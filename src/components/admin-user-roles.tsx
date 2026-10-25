"use client";
import {useEffect,useRef,useState} from 'react';
import {useAuth} from '@/components/providers/auth-provider';
import {useLocale} from '@/components/providers/locale-provider';
import type {UserRoleRecord} from '@/lib/admin-user-roles/service';
import styles from './admin-user-roles.module.css';

export function AdminUserRoles(){
  const {user,getIdToken}=useAuth(),{text}=useLocale();
  const [identifier,setIdentifier]=useState(''),[target,setTarget]=useState<UserRoleRecord|null>(null);
  const [busy,setBusy]=useState(false),[confirm,setConfirm]=useState<boolean|null>(null),[error,setError]=useState(''),[message,setMessage]=useState('');
  const lock=useRef(false),generation=useRef(0),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  async function lookup(){
    if(lock.current||!identifier.trim())return;
    lock.current=true;setBusy(true);setError('');setMessage('');setTarget(null);setConfirm(null);const version=++generation.current;
    try{
      const token=await getIdToken();if(!token)throw Error('Sign in with an admin account.');
      const response=await fetch('/api/admin/users/role?'+new URLSearchParams({q:identifier.trim()}),{headers:{Authorization:`Bearer ${token}`},cache:'no-store'}),data=await response.json();
      if(!response.ok)throw Error(data.error??'Unable to look up account');
      if(mounted.current&&version===generation.current)setTarget(data.user);
    }catch(error){if(mounted.current&&version===generation.current)setError(error instanceof Error?error.message:'Unable to look up account');}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  async function save(){
    if(lock.current||!target||confirm===null)return;
    const selected=target,next=confirm;lock.current=true;setBusy(true);setError('');setMessage('');
    try{
      const token=await getIdToken();if(!token)throw Error('Sign in with an admin account.');
      const response=await fetch('/api/admin/users/role',{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({userId:selected.id,admin:next,version:selected.version})}),data=await response.json();
      if(!response.ok)throw Error(data.error??'Unable to update admin access');
      if(mounted.current){setTarget(data.user);if(data.user.admin!==next)throw Error(text('Access changed again. Look up the account to check current permissions.','权限再次变更，请重新查找账户以检查当前权限。'));setMessage(next?text('Administrator access granted.','已授予管理员权限。'):text('Administrator access revoked.','已撤销管理员权限。'));}
    }catch(error){if(mounted.current)setError(error instanceof Error?error.message:'Unable to update admin access');}
    finally{lock.current=false;if(mounted.current){setConfirm(null);setBusy(false);}}
  }
  if(!user)return null;
  return <section className={styles.card} aria-labelledby="admin-user-roles-heading">
    <p className={styles.eyebrow}>{text('ACCESS MANAGEMENT','权限管理')}</p><h2 id="admin-user-roles-heading">{text('Manage administrator access','管理管理员权限')}</h2>
    <p>{text('Find an existing account by UID, email, or @nickname. Review the exact account before changing access.','使用 UID、邮箱或 @昵称查找现有账户，更改权限前请核对账户。')}</p>
    <form onSubmit={event=>{event.preventDefault();void lookup();}} className={styles.lookup}>
      <label><span>{text('Account identifier','账户标识')}</span><input value={identifier} maxLength={254} disabled={busy} autoComplete="off" placeholder={text('UID, email, or @nickname','UID、邮箱或 @昵称')} onChange={event=>{generation.current++;setIdentifier(event.target.value);setTarget(null);setConfirm(null);setError('');setMessage('');}}/></label>
      <button disabled={busy||!identifier.trim()} type="submit">{busy?text('Working…','处理中…'):text('Look up account','查找账户')}</button>
    </form>
    {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status">{message}</p>}
    {target&&<div className={styles.account}>
      <strong>{target.nickname?`@${target.nickname}`:target.displayName??target.id}</strong><p>{target.email??text('No email address','无邮箱地址')}</p><p>{text('UID: ','用户 UID：')}<code>{target.id}</code></p>
      <p>{text('Current access','当前权限')}: <strong>{target.admin?text('Administrator','管理员'):text('Standard user','普通用户')}</strong></p>
      {target.claimsAdmin&&<p>{text('Admin access is managed by Firebase authentication claims. Manage those claims separately.','管理员权限由 Firebase 身份验证声明管理，请单独管理这些声明。')}</p>}
      {target.disabled&&<p>{text('This account is disabled in Firebase Authentication.','此账户已在 Firebase 身份验证中停用。')}</p>}
      {target.self&&target.admin&&<p>{text('You cannot revoke your own admin access.','不能撤销您自己的管理员权限。')}</p>}
      {confirm===null?<button disabled={busy||target.claimsAdmin||target.disabled||(target.self&&target.admin)} onClick={()=>setConfirm(!target.admin)}>{target.admin?text('Revoke admin access','撤销管理员权限'):text('Grant admin access','授予管理员权限')}</button>:<div className={styles.confirm} role="group" aria-label={text('Confirm administrator access change','确认管理员权限更改')} onKeyDown={event=>{if(event.key==='Escape'&&!busy)setConfirm(null);}}>
        <strong>{confirm?text('Grant full administrator access?','授予完整管理员权限？'):text('Revoke administrator access?','撤销管理员权限？')}</strong><p>{target.email??target.nickname??target.id}{text(' · UID: ',' · 用户 UID：')}{target.id}</p>
        <p>{confirm?text('This account will be able to use all admin tools.','此账户将能够使用全部管理工具。'):text('This removes admin access stored in the user profile.','这将移除用户资料中保存的管理员权限。')}</p>
        <div><button type="button" disabled={busy} onClick={()=>void save()}>{confirm?text('Confirm grant','确认授予'):text('Confirm revoke','确认撤销')}</button><button type="button" disabled={busy} onClick={()=>setConfirm(null)}>{text('Cancel','取消')}</button></div>
      </div>}
    </div>}
  </section>;
}
