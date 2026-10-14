import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { buildCompanySlugPlan, type CompanySlugPlan } from '../src/lib/market-companies/slug-plan';

async function main() {
  assert(process.env.GCP_PROJECT_ID === 'ifindata-80905','Production project required');
  const apply = process.argv.includes('--apply');
  assert(apply || process.argv.includes('--preview'),'Use --preview or --apply');
  initializeApp({credential:applicationDefault(),projectId:process.env.GCP_PROJECT_ID});
  const db = getFirestore();
  const snapshot = await db.collection('companies').select('name','names','en','slug','slugAliases').get();
  const rows = snapshot.docs.map(doc=>({id:doc.id,...doc.data()}));
  const plan = buildCompanySlugPlan(rows);
  await mkdir('.company-slugs',{recursive:true});
  await writeFile('.company-slugs/preview.json',JSON.stringify(plan,null,2)+'\n');
  await writeFile('.company-slugs/manifest.json',JSON.stringify(Object.fromEntries(plan.map(row=>[row.id,row.slug])),null,2)+'\n');
  if (apply) {
    const expected:CompanySlugPlan[] = JSON.parse(await readFile('data/company-slug-migration.json','utf8'));
    assert.deepEqual(plan.map(row=>[row.id,row.name,row.slug]),expected.map(row=>[row.id,row.name,row.slug]),'Company inventory changed; regenerate preview');
    // A retry may see previously applied rows. Preserve all other fields and IDs.
    for (let offset=0;offset<expected.length;offset+=200) await db.runTransaction(async tx=>{
      const batch = expected.slice(offset,offset+200), refs = batch.map(row=>db.collection('companies').doc(row.id));
      const docs = await tx.getAll(...refs);
      batch.forEach((row,i)=>{
        const current = docs[i].data();
        assert(current && current.name===row.name,'Company changed during migration');
        assert(current.slug===undefined && row.previousSlug===null || current.slug===row.previousSlug || current.slug===row.slug,'Slug changed during migration');
        const aliases = current.slugAliases ?? [];
        assert.deepEqual(aliases,current.slug===row.slug?row.slugAliases:row.previousAliases,'Slug aliases changed during migration');
        tx.update(refs[i],{slug:row.slug,slugAliases:row.slugAliases});
      });
    });
  }
  console.log(JSON.stringify({mode:apply?'applied':'preview',companies:plan.length,changes:plan.filter(row=>row.previousSlug!==row.slug).length,micron:plan.find(row=>row.id==='US:MU')?.slug}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Company slug migration failed');process.exitCode=1;});
