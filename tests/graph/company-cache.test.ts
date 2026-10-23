import {withThemeCatalog} from '../helpers/theme-catalog';
import test from 'node:test';
import assert from 'node:assert/strict';
import type {Firestore} from 'firebase-admin/firestore';
import {loadThemeEnrolledCompanies} from '../../src/lib/knowledge-graph/company-cache';
import {closeLocalCaches} from '../../src/lib/local-cache/watch';
test('theme enrollment observes source membership changes without checkpoint reads',async(t)=>{
 t.after(closeLocalCaches);let push!:(snapshot:unknown)=>void,calls=0;
 const query={where:()=>query,onSnapshot:(next:(snapshot:unknown)=>void)=>{calls++;push=next;next({docs:[{id:'US:A',data:()=>({})}]});return ()=>{};}};
 const db=withThemeCatalog({collection:(name:string)=>{assert.equal(name,'companies');return query;}} as unknown as Firestore);
 assert.equal((await loadThemeEnrolledCompanies(db)).docs.length,1);push({docs:[]});
 assert.equal((await loadThemeEnrolledCompanies(db)).docs.length,0);assert.equal(calls,1);
});
