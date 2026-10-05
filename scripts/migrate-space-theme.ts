import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {GoogleAuth} from 'google-auth-library';
import batch from '../data/space/company-memberships.json';
import {planThemeEnrollment,validateThemeBatch} from '../src/lib/company-themes/migration';
import {company,encode,type Document,type Request} from './migrate-company-themes';
import type {KnowledgeGraph} from '../src/lib/knowledge-graph/model';
import type {ThemedCompany} from '../src/lib/company-themes/model';

/** Additive enrollment into existing companies; backup and preconditions fence every write. */
export async function migrateSpaceTheme({project,request,write=false,backupDir='output/company-theme-backups',graph}:{project:string;request:Request;write?:boolean;backupDir?:string;graph?:KnowledgeGraph}) {
  validateThemeBatch(batch,'space');assert(/^[a-z][a-z0-9-]+$/.test(project));
  const root=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  const beforeGraph=graph??await fetch('https://youanalyst.com/api/knowledge-graph',{signal:AbortSignal.timeout(30_000)}).then(async response=>{assert(response.ok);return await response.json() as KnowledgeGraph;});
  assert(beforeGraph,'AI graph unavailable');
  const aiIds=beforeGraph.nodes.filter(node=>node.kind==='COMPANY').map(node=>node.id);assert.equal(new Set(aiIds).size,134,'Review changed AI universe');
  const enrolled=await request(`${root}:runQuery`,'POST',{structuredQuery:{from:[{collectionId:'companies'}],where:{fieldFilter:{field:{fieldPath:'themeIds'},op:'ARRAY_CONTAINS_ANY',value:{arrayValue:{values:[{stringValue:'ai'},{stringValue:'robotics'}]}}}}}}) as {document?:Document}[];
  const originals=new Map(enrolled.flatMap(row=>row.document?[[company(row.document).id,row.document] as const]:[]));
  const missing:ThemedCompany[]=[];
  for(const proposal of batch.companies){
    if(!originals.has(proposal.id)){
      const doc=await request(`${root}/companies/${encodeURIComponent(proposal.id)}`) as Document|null;
      if(doc) originals.set(proposal.id,doc);
      else {
        const matches=await request(`${root}:runQuery`,'POST',{structuredQuery:{from:[{collectionId:'companies'}],where:{fieldFilter:{field:{fieldPath:'name'},op:'EQUAL',value:{stringValue:proposal.expectedName}}}}}) as {document?:Document}[];
        const aliases=await request(`${root}:runQuery`,'POST',{structuredQuery:{from:[{collectionId:'companies'}],where:{fieldFilter:{field:{fieldPath:'aliases'},op:'ARRAY_CONTAINS',value:{stringValue:proposal.expectedName}}}}}) as {document?:Document}[];
        assert(![...matches,...aliases].some(row=>row.document),`${proposal.id}: existing identity under another canonical ID`);
        missing.push({id:proposal.id,status:'PUBLISHED',symbol:proposal.id.startsWith('ORG:')?'':proposal.id.split(':')[1],...proposal.profile});
      }
    }
  }
  const records=[...originals.values()].map(company).concat(missing);
  const retired:Document[]=[];
  for(const correction of batch.identityCorrections){
    assert(batch.companies.some(row=>row.id===correction.to),'Correction target must be enrolled');
    const doc=await request(`${root}/companies/${encodeURIComponent(correction.from)}`) as Document|null;
    if(!doc)continue;
    const row=company(doc);
    if(row.status==='MERGED'){assert.equal(row.canonicalCompanyId,correction.to);continue;}
    assert(row.name===correction.expectedName&&row.status==='PUBLISHED'&&row.listingStatus==='UNKNOWN','Unexpected superseded profile');
    assert.deepEqual(row.themeIds,['space'],'Only this new Space enrollment may be retired');
    assert.deepEqual(Object.keys(row.themeMemberships??{}),['space'],'Existing theme decisions must not be retired');
    assert.equal(row.themeMemberships!.space.reviewedAt,batch.reviewedAt);
    retired.push(doc);
  }
  // Dry-run reports conflicts for human/code review, never silently renames master records.
  const conflicts=batch.companies.flatMap(proposal=>{const current=records.find(row=>row.id===proposal.id);return current?.name!==proposal.expectedName?[{id:proposal.id,expected:proposal.expectedName,actual:current?.name}]:[];});
  if(conflicts.length&&!write)return {mode:'preview',conflicts};
  assert(!conflicts.length,`Identity conflicts: ${JSON.stringify(conflicts)}`);
  const patches=planThemeEnrollment(records,batch,'space');assert(patches.length<=500);
  const relationships:Document[]=[];let pageToken='';
  do{const page=await request(`${root}/company_relationships?pageSize=1000${pageToken?`&pageToken=${encodeURIComponent(pageToken)}`:''}`) as {documents?:Document[];nextPageToken?:string};relationships.push(...page.documents??[]);pageToken=page.nextPageToken??'';}while(pageToken);
  for(const doc of retired)assert(!relationships.some(edge=>['source','target'].some(key=>edge.fields[key]?.stringValue===company(doc).id)),'Referenced identities require a separate reviewed merge');
  await mkdir(backupDir,{recursive:true});const backup=`${backupDir}/space-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  await writeFile(backup,JSON.stringify({project,beforeGraph,documents:[...originals.values()],missing,retired,relationships,patches},null,2),{flag:'wx'});
  if(write&&(patches.length||retired.length)){
    await request(`${root}:commit`,'POST',{writes:[...patches.map(patch=>{
      const existing=originals.get(patch.id),fields={themeMemberships:encode(patch.themeMemberships),themeIds:encode(patch.themeIds)};
      return existing?{update:{name:existing.name,fields},updateMask:{fieldPaths:['themeMemberships','themeIds']},currentDocument:{updateTime:existing.updateTime}}:
        {update:{name:`${root.replace('https://firestore.googleapis.com/v1/','')}/companies/${patch.id}`,fields:{...encode(missing.find(row=>row.id===patch.id)).mapValue!.fields,...fields}},currentDocument:{exists:false}};
    }),...retired.map(doc=>{const row=company(doc),correction=batch.identityCorrections.find(item=>item.from===row.id)!;return {update:{name:doc.name,fields:{status:encode('MERGED'),canonicalCompanyId:encode(correction.to),themeIds:encode([]),themeMemberships:encode({space:{...row.themeMemberships!.space,status:'WITHDRAWN'}})}},updateMask:{fieldPaths:['status','canonicalCompanyId','themeIds','themeMemberships']},currentDocument:{updateTime:doc.updateTime}};})]});
    const after=await Promise.all(records.map(row=>request(`${root}/companies/${encodeURIComponent(row.id)}`) as Promise<Document>));
    for(const previous of originals.values()){
      const next=after.find(doc=>doc.name===previous.name)!;assert(next);
      for(const [key,value]of Object.entries(previous.fields))if(!['themeMemberships','themeIds'].includes(key))assert.deepEqual(next.fields[key],value,`${previous.name}: unrelated field changed`);
      const oldMemberships=company(previous).themeMemberships??{},newMemberships=company(next).themeMemberships??{};
      for(const [theme,membership]of Object.entries(oldMemberships))assert.deepEqual(newMemberships[theme],membership,`${previous.name}: existing theme changed`);
    }
    assert.equal(planThemeEnrollment(after.map(company),batch,'space').length,0,'Migration must be idempotent');
    for(const previous of relationships){const next=await request(`https://firestore.googleapis.com/v1/${previous.name}`) as Document;assert.deepEqual(next.fields,previous.fields,'Existing relationship changed');}
    for(const previous of retired){const next=await request(`https://firestore.googleapis.com/v1/${previous.name}`) as Document;assert.equal(company(next).status,'MERGED');assert.equal(company(next).themeMemberships!.space.status,'WITHDRAWN');}
  }
  return {mode:write?'written':'preview',backup,aiCompanies:aiIds.length,spaceCompanies:batch.companies.length,newProfiles:missing.map(row=>row.id),changedCompanies:patches.length,retiredProfiles:retired.map(doc=>company(doc).id),existingRelationships:relationships.length};
}
if(process.argv[1]?.replace(/\\/g,'/').endsWith('/migrate-space-theme.ts')){
  const project=process.env.GOOGLE_CLOUD_PROJECT;assert(project,'Set an explicit production project');
  void (async()=>{
    const auth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/datastore']}),client=await auth.getClient();
    const request:Request=async(url,method='GET',data)=>{const response=await client.request({url,method,data,validateStatus:status=>status>=200&&status<300||method==='GET'&&status===404});return response.status===404?null:response.data;};
    console.log(JSON.stringify(await migrateSpaceTheme({project,request,write:process.argv.includes('--write')})));
  })().catch(error=>{console.error(error.message);process.exitCode=1;});
}
