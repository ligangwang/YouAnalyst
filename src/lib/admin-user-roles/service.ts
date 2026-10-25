import {FieldValue,type Firestore,type DocumentSnapshot} from 'firebase-admin/firestore';
import type {Auth} from 'firebase-admin/auth';
import {hasAdminRole} from '../firebase/admin-role';

export class UserRoleError extends Error{constructor(message:string,public status:number){super(message);}}
export type UserRoleRecord={id:string;displayName:string|null;nickname:string|null;email:string|null;admin:boolean;profileAdmin:boolean;claimsAdmin:boolean;version:string;self:boolean;disabled:boolean};
type Actor={uid:string;claimsAdmin:boolean};
type RoleAuth=Pick<Auth,'getUser'>;
const version=(doc:DocumentSnapshot)=>doc.updateTime?`${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`:'';
const text=(value:unknown)=>typeof value==='string'?value:null;
export const validUserRoleUid=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=128&&!value.includes('/');

async function account(auth:RoleAuth,uid:string){
  try{return await auth.getUser(uid);}catch(error){if((error as {code?:unknown})?.code==='auth/user-not-found')throw new UserRoleError('User not found',404);throw error;}
}

export async function authorizeUserRoleAdmin(db:Firestore,auth:RoleAuth,uid:string):Promise<Actor>{
  const user=await account(auth,uid);if(user.disabled)throw new UserRoleError('Forbidden',403);
  const profile=await db.collection('users').doc(uid).get(),claimsAdmin=hasAdminRole(user.customClaims);
  if(!claimsAdmin&&!hasAdminRole(profile.data()))throw new UserRoleError('Forbidden',403);
  return {uid,claimsAdmin};
}

function record(doc:DocumentSnapshot,user:Awaited<ReturnType<RoleAuth['getUser']>>,actor:Actor):UserRoleRecord{
  const data=doc.data()??{},profileAdmin=hasAdminRole(data),claimsAdmin=hasAdminRole(user.customClaims);
  return {id:doc.id,displayName:text(data.displayName),nickname:text(data.nickname),email:user.email??null,admin:profileAdmin||claimsAdmin,profileAdmin,claimsAdmin,version:version(doc),self:doc.id===actor.uid,disabled:user.disabled};
}

export async function lookupUserRole(db:Firestore,auth:RoleAuth,actor:Actor,raw:string):Promise<UserRoleRecord>{
  const identifier=raw.trim(),nickname=identifier.startsWith('@');
  const value=nickname?identifier.slice(1):identifier;
  if(!value||value.length>254||value.includes('/'))throw new UserRoleError('Enter a user UID, email, or nickname',400);
  const users=db.collection('users');let found:DocumentSnapshot|undefined;
  if(!nickname&&validUserRoleUid(value)){const direct=await users.doc(value).get();if(direct.exists)found=direct;}
  if(!found){
    const queries=nickname?[users.where('nickname','==',value).limit(2).get()]:[users.where('email','==',value).limit(2).get(),users.where('nickname','==',value).limit(2).get()];
    const pages=await Promise.all(queries),matches=new Map(pages.flatMap(page=>page.docs).map(doc=>[doc.id,doc]));
    if(matches.size>1)throw new UserRoleError('Multiple users matched. Use the exact UID.',409);
    found=[...matches.values()][0];
  }
  if(!found?.exists)throw new UserRoleError('User profile not found. The user must sign in first.',404);
  return record(found,await account(auth,found.id),actor);
}

/** Existing profile fields only; preserve unrelated roles and all account data. */
export function userRolePatch(data:Record<string,unknown>,admin:boolean){
  if(admin)return {role:'admin'};
  const patch:Record<string,unknown>={};
  if(typeof data.role==='string'&&data.role.trim().toLowerCase()==='admin')patch.role=FieldValue.delete();
  if(data.admin===true)patch.admin=FieldValue.delete();
  if(data.isAdmin===true)patch.isAdmin=FieldValue.delete();
  if(Array.isArray(data.roles))patch.roles=data.roles.filter(role=>typeof role!=='string'||role.trim().toLowerCase()!=='admin');
  return patch;
}

export async function changeUserRole(db:Firestore,auth:RoleAuth,actor:Actor,targetUid:string,admin:boolean,expectedVersion:string):Promise<UserRoleRecord>{
  if(!validUserRoleUid(targetUid)||!/^\d+:\d+$/.test(expectedVersion))throw new UserRoleError('Invalid user or version',400);
  if(targetUid===actor.uid&&!admin)throw new UserRoleError('You cannot revoke your own admin access.',409);
  const user=await account(auth,targetUid);
  if(hasAdminRole(user.customClaims))throw new UserRoleError('Admin access is managed by Firebase authentication claims. Manage those claims separately.',409);
  if(user.disabled)throw new UserRoleError('This account is disabled. Manage it in Firebase Authentication first.',409);
  const target=db.collection('users').doc(targetUid),caller=db.collection('users').doc(actor.uid);
  const changed=await db.runTransaction(async tx=>{
    const [current,adminProfile]=await tx.getAll(target,caller);
    if(!actor.claimsAdmin&&!hasAdminRole(adminProfile.data()))throw new UserRoleError('Forbidden',403);
    if(!current.exists)throw new UserRoleError('User profile not found',404);
    if(version(current)!==expectedVersion)throw new UserRoleError('User changed. Look up the account again before confirming.',409);
    const data=current.data()??{},patch=userRolePatch(data,admin);
    const changed=hasAdminRole(data)!==admin;
    if(changed)tx.update(target,{...patch,updatedAt:new Date().toISOString()});
    return changed;
  });
  console.info(JSON.stringify({event:changed?'admin_role_changed':'admin_role_unchanged',actorUid:actor.uid,targetUid,admin}));
  // Refresh the optimistic version for the next deliberate change.
  const after=await target.get();if(!after.exists)throw new UserRoleError('User profile changed. Look up the account again.',409);
  return record(after,user,actor);
}
