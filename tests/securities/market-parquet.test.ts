import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import type { Bucket } from '@google-cloud/storage';
import { Timestamp, FieldValue, FieldPath, type Firestore } from 'firebase-admin/firestore';
import {MarketRepository,headId} from '../../src/lib/market-store/repository';
import {CleanupGate,capacityRegression} from '../../scripts/market-migration-safety';
import { MarketFiles, shardFor, calendarIndexFile, type MarketRow } from '../../src/lib/market-store/files';
import { MarketBlob } from '../../src/lib/market-store/blobs';
import {announcementBucket,announcementIndexFile} from '../../src/lib/market-store/announcement-sidecar';
import {collectMarketGarbage} from '../../src/lib/market-store/maintenance';
import {PrefixCache,buildPrefixLookup,encodePrefixLookup,decodePrefixLookup} from '../../src/lib/market-store/prefix-cache';
import { applyMutation, sortKey } from '../../src/lib/market-store/value';
import { splitRecord } from '../../src/lib/market-store/policy';
import {cleanupRecord} from '../../src/lib/market-store/migration';
function fixture(downloads:string[] = [],queryBudget?:number) { const objects = new Map<string, Buffer>(); const bucket = { file: (name: string) => ({ download: async (options?: {
            destination: string;
        }) => { downloads.push(name); const bytes = objects.get(name); if (!bytes)
            throw Error('Missing object'); if (options)
            await writeFile(options.destination, bytes); return [bytes]; }, save: async (bytes: Buffer) => { if (objects.has(name))
            throw Object.assign(Error('exists'), { code: 412 }); objects.set(name, bytes); } }), upload: async (path: string, options: {
        destination: string;
    }) => { assert(!objects.has(options.destination)); objects.set(options.destination, await readFile(path)); } } as unknown as Bucket; return new MarketFiles(bucket,queryBudget); }
test('market downloads refill bounded slots while retaining ordered pinned files',async()=>{
    let releaseSlow!:()=>void,reachedLast!:()=>void,active=0,peak=0;
    const slow=new Promise<void>(resolve=>releaseSlow=resolve),last=new Promise<void>(resolve=>reachedLast=resolve);
    const names=Array.from({length:65},(_,i)=>String(i));
    const bucket={file:(name:string)=>({download:async({destination}:{destination:string})=>{
        active++;peak=Math.max(peak,active);
        try{if(name==='0')await slow;await writeFile(destination,name);if(name==='64')reachedLast();}
        finally{active--;}
    }})} as unknown as Bucket;
    const files=new MarketFiles(bucket),local=files as unknown as {local<T>(names:string[],work:(paths:string[])=>Promise<T>):Promise<T>};
    const work=local.local(names,async paths=>Promise.all(paths.map(path=>readFile(path,'utf8'))));
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
        await Promise.race([last,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('A slow first download blocked later slots')),5000);})]);
        assert(peak<=32);releaseSlow();assert.deepEqual(await work,names);
    }finally{clearTimeout(timer);releaseSlow();await work.catch(()=>{});await files.close();}
});
test('market download failures stop new work and release pins before closing',async()=>{
    const started:string[]=[];let release!:()=>void;
    const blocked=new Promise<void>(resolve=>release=resolve);
    const bucket={file:(name:string)=>({download:async()=>{
        started.push(name);await blocked;throw Error('download failed');
    }})} as unknown as Bucket;
    const files=new MarketFiles(bucket),local=files as unknown as {local<T>(names:string[],work:(paths:string[])=>Promise<T>):Promise<T>};
    let called=false;const work=local.local(Array.from({length:65},(_,i)=>String(i)),async()=>{called=true;});
    const rejected=assert.rejects(work,/download failed/);
    try{await new Promise(resolve=>setImmediate(resolve));release();await rejected;assert.equal(called,false);assert(started.length<=32);}
    finally{release();await work.catch(()=>{});await files.close();}
});
test('garbage collection preserves current event sidecars and retires only old orphan generations',async()=>{
    const prefix='market-parquet/v1/data/events/00/abcdef.parquet',calendarOnly='market-parquet/v1/data/events/01/abcdef.parquet';
    const active=[prefix,calendarOnly,calendarIndexFile(prefix),calendarIndexFile(calendarOnly),...Array.from({length:16},(_,bucket)=>announcementIndexFile(prefix,bucket))];
    const orphan='market-parquet/v1/data/events/00/0123-a0.parquet',recent='market-parquet/v1/data/events/00/0124-ca.parquet',now=Date.now(),deleted:string[]=[];
    const heads=[{prefixFile:prefix,format:112},{prefixFile:calendarOnly,format:111}];
    const raw={doc:()=>({get:async()=>({get:()=>true})}),collection:()=>({where:(_field:string,_op:string,collection:string)=>({get:async()=>({docs:collection==='events'?heads.map(head=>({get:()=>head})):[]})})})} as unknown as Firestore;
    const bucket={getFilesStream:async function*(){for(const name of [...active,orphan,recent])yield {name,metadata:{timeCreated:new Date(now-(name===recent?1:8)*86400000).toISOString(),generation:'3'},delete:async(options:unknown)=>{assert.deepEqual(options,{ifGenerationMatch:'3'});deleted.push(name);}};}} as unknown as Bucket;
    assert.deepEqual(await collectMarketGarbage(raw,bucket,now),{deleted:1});assert.deepEqual(deleted,[orphan]);
});
test('announcement partitions cover every company bucket and preserve mixed bundled ownership',async()=>{
    const downloads:string[]=[],files=fixture(downloads),version=Timestamp.now(),companies=new Map<number,string>();
    for(let n=0;companies.size<16;n++){const company='US:COMPANY'+n;companies.set(announcementBucket(company),company);}
    const names=[...companies.values(),"US:quote'company:aa",'CN:中文:ab'];let id=0;
    const rows=names.map(company=>{while(shardFor('bucket-'+id)!=='00')id++;return {id:'bucket-'+id++,version,data:{companyId:company,publication_date:'2026-11-17',title:company}};});
    while(shardFor('bucket-'+id)!=='01')id++;const other={id:'bucket-'+id,version,data:{...rows[0].data,title:'Another shard'}};
    const steps=(company:string)=>[{method:'where',args:['companyId','==',company]},{method:'orderBy',args:['publication_date','desc']},{method:'limit',args:[30]},{method:'select',args:['title','companyId']}];
    try{
        const standalone=[await files.write('events','00',rows,[]),await files.write('events','01',[other],[])];
        assert.deepEqual(await files.query(standalone,steps(names.at(-1)!)),await files.filter([...rows,other],steps(names.at(-1)!)),'unbundled company suffixes are not shard suffixes');
        const heads=await files.bundleIndexes(standalone);
        for(const company of names){
            const start=downloads.length;
            assert.deepEqual(await files.query(heads,steps(company)),await files.filter([...rows,other],steps(company)));
            assert(downloads.slice(start).every(file=>file===announcementIndexFile(heads[0].prefixFile!,announcementBucket(company))),'read only the requested company bucket');
        }
        assert.deepEqual(await files.query(heads,steps('US:ABSENT')),[],'empty companies still require complete shard markers');
        assert.deepEqual(await files.query([{...heads[0],format:111},heads[1]],steps(names[0])),await files.filter([...rows,other],steps(names[0])),'old and new lookup formats coexist');
        assert.deepEqual(await files.query([heads[1]],steps(names[0])),await files.filter([other],steps(names[0])),'unowned bundled records stay hidden');
        assert.throws(()=>announcementIndexFile(heads[0].prefixFile!,16),/Invalid announcement bucket/);
    }finally{await files.close();}
});
test('company projections reuse unchanged shards while live replacements invalidate their rows',async()=>{
    const files=fixture([],32*1024*1024),version=Timestamp.now();let second='other';while(shardFor(second)===shardFor('first'))second+='x';
    const rows=[{id:'first',version,data:{companyId:'US:NVDA',publication_date:'2026-11-16',title:'first'}},{id:second,version,data:{companyId:'US:NVDA',publication_date:'2026-11-15',title:'second'}}];
    const probe=files as unknown as {announcementRowsUncached(heads:Array<{shard:string}>,company:string):Promise<MarketRow[]>};
    const original=probe.announcementRowsUncached.bind(files),reads:string[][]=[];
    probe.announcementRowsUncached=(heads,company)=>{reads.push(heads.map(h=>h.shard));return original(heads,company);};
    const steps=[{method:'where',args:['companyId','==','US:NVDA']},{method:'orderBy',args:['publication_date','desc']},{method:'limit',args:[30]},{method:'select',args:['title','companyId']}];
    try{
        const heads=await files.bundleIndexes(await Promise.all(rows.map(row=>files.write('events',shardFor(row.id),[row],[]))));
        assert.deepEqual(await files.query(heads,steps),await files.filter(rows,steps));
        rows[0]={...rows[0],data:{...rows[0].data,title:'updated'}};heads[0]=await files.write('events',heads[0].shard,[rows[0]],[]);
        assert.deepEqual(await files.query(heads,steps),await files.filter(rows,steps));
        assert.deepEqual(reads,[heads.map(h=>h.shard),[heads[0].shard]]);
        heads[0]=await files.write('events',heads[0].shard,[],[]);
        assert.deepEqual(await files.query(heads,steps),await files.filter([rows[1]],steps));
        assert.equal(reads.length,2,'empty shards must not retain obsolete projected records');
    }finally{await files.close();}
});
test('shared index bundles preserve shard boundaries across live rewrites and rebundling',async()=>{
    const downloads:string[]=[],files=fixture(downloads),version=Timestamp.now();
    const ids:string[]=[];for(let n=0;ids.length<8;n++)if(!ids.some(id=>shardFor(id)===shardFor('bundle-'+n)))ids.push('bundle-'+n);
    let rows=ids.map((id,i)=>({id,version,data:{companyId:'US:NVDA',publication_date:`2026-11-${String(i+1).padStart(2,'0')}`,title:'original-'+i}}));
    try{
        const original=await Promise.all(rows.map(row=>files.write('events',shardFor(row.id),[row],[])));
        let heads=await files.bundleIndexes(original);
        assert.equal(new Set(heads.map(head=>head.indexFile)).size,1);assert.equal(new Set(heads.map(head=>head.prefixFile)).size,1);
        assert.deepEqual(heads.map(head=>head.file),original.map(head=>head.file),'data shards remain unchanged');
        const steps=[{method:'where',args:['companyId','==','US:NVDA']},{method:'orderBy',args:['publication_date','desc']},{method:'limit',args:[5]},{method:'select',args:['title','companyId']}];
        const start=downloads.length;
        assert.deepEqual(await files.query(heads,steps),await files.filter(rows,steps));
        assert.equal(new Set(downloads.slice(start)).size,1,'one shared covering company lookup');
        assert.deepEqual(await files.query([heads[0]],steps),await files.filter([rows[0]],steps),'a partial head set cannot expose other bundled shards');
        // A normal writer replaces one head with a standalone v7 index. The old
        // shared file still contains its obsolete row, which must not leak in.
        rows=rows.map((row,i)=>i?row:{...row,data:{...row.data,title:'changed',publication_date:'2026-11-30'}});
        heads[0]=await files.write('events',heads[0].shard,[rows[0]],[]);
        assert.deepEqual(await files.query(heads,steps),await files.filter(rows,steps));
        const points=[{method:'where',args:['__name__','in',rows.map(row=>row.id)]},{method:'select',args:['title','companyId']}];
        assert.deepEqual(await files.query(heads,points),await files.filter(rows,points),'point reads choose the replacement shard rather than its obsolete bundled row');
        assert.deepEqual(await files.query([heads[1]],points),await files.filter([rows[1]],points),'explicit IDs cannot expose unowned shards in a shared file');
        heads=await files.bundleIndexes(heads);
        assert.deepEqual(await files.query(heads,steps),await files.filter(rows,steps));
        await assert.rejects(files.bundleIndexes(heads.map((head,i)=>i?head:{...head,rows:head.rows+1})),/shard count mismatch/);
        heads[0]=await files.write('events',heads[0].shard,[],[]);rows=rows.slice(1);
        const scan=[{method:'where',args:['companyId','==','US:NVDA']},{method:'select',args:['title']}];
        assert.deepEqual(await files.query(heads,scan),await files.filter(rows,scan),'deleted shard data inside an old bundle stays invisible');
    }finally{await files.close();}
});
test('bounded shared-index scans preserve global ordering, offsets, and projections',async()=>{
    const files=fixture(),version=Timestamp.now(),ids:string[]=[];
    for(let i=0;ids.length<12;i++){const id='bounded-bundle-'+i;if(!ids.some(other=>shardFor(other)===shardFor(id)))ids.push(id);}
    const rows=ids.map((id,i)=>({id,version,data:{sourceType:'news',publication_date:`2026-11-${String(i+1).padStart(2,'0')}`,title:'Title '+i}}));
    try{
        const standalone=await Promise.all(rows.map(row=>files.write('events',shardFor(row.id),[row],[])));
        const heads=[];
        for(let i=0;i<standalone.length;i+=2)heads.push(...await files.bundleIndexes(standalone.slice(i,i+2)));
        const steps=[{method:'where',args:['__name__','in',ids]},{method:'where',args:['sourceType','==','news']},{method:'orderBy',args:['publication_date','desc']},{method:'offset',args:[3]},{method:'limit',args:[7]},{method:'select',args:['title']}];
        assert.deepEqual(await files.query(heads,steps),await files.filter(rows,steps));
    }finally{await files.close();}
});
test('bundled legacy indexes preserve missing-column fallbacks and mixed-format announcements',async()=>{
    const downloads:string[]=[],files=fixture(downloads),version=Timestamp.now();
    const ids=['legacy-bundle-one','legacy-bundle-two','legacy-bundle-three'];assert.equal(new Set(ids.map(shardFor)).size,3);
    const rows=ids.map((id,i)=>({id,version,data:{companyId:'US:AMD',publication_date:`2026-11-${10+i}`,title:'Full title '+i}}));
    try{
        const full=await Promise.all(rows.map(row=>files.write('events',shardFor(row.id),[row],[])));
        const legacy=await Promise.all(rows.slice(0,2).map(row=>files.write('events',shardFor(row.id),[{...row,data:{companyId:row.data.companyId,publication_date:row.data.publication_date}}],[])));
        const heads=await files.bundleIndexes(full.map((head,i)=>i<2?{...head,format:i?5:3,indexFile:legacy[i].indexFile,indexBytes:legacy[i].indexBytes,prefixFile:undefined,prefixBytes:undefined}:head));
        assert.deepEqual(heads.map(head=>head.format),[103,105,112]);
        const steps=[{method:'where',args:['companyId','==','US:AMD']},{method:'orderBy',args:['publication_date','desc']},{method:'limit',args:[3]},{method:'select',args:['title']}];
        const start=downloads.length;
        assert.deepEqual(await files.query(heads,steps),await files.filter(rows,steps));
        assert(downloads.slice(start).includes(full[0].file!));assert(downloads.slice(start).includes(full[1].file!));
        assert(!downloads.slice(start).includes(full[2].file!),'modern rows still use their covering index');
    }finally{await files.close();}
});
test('shared search indexes never leak another shard after a prefix changes',async()=>{
    const files=fixture(),version=Timestamp.now();
    const ids=['search-one','search-two','search-three'];assert.equal(new Set(ids.map(shardFor)).size,3);
    const rows=ids.map(id=>({id,version,data:{name:id,searchPrefixes:['nv','nvd']}}));
    try{
        let heads=await files.bundleIndexes(await Promise.all(rows.map(row=>files.write('company_directory',shardFor(row.id),[row],[]))));
        const steps=[{method:'where',args:['searchPrefixes','array-contains','nv']},{method:'select',args:['name']},{method:'limit',args:[10]}];
        assert.deepEqual(await files.query(heads,steps),await files.filter(rows,steps));
        assert.deepEqual(await files.query([heads[1]],steps),await files.filter([rows[1]],steps));
        rows[0]={...rows[0],data:{...rows[0].data,searchPrefixes:['amd']}};
        heads[0]=await files.write('company_directory',heads[0].shard,[rows[0]],[]);
        assert.deepEqual(await files.query(heads,steps),await files.filter(rows,steps));
        heads=await files.bundleIndexes(heads);
        assert.deepEqual(await files.query(heads,steps),await files.filter(rows,steps));
    }finally{await files.close();}
});
test('ordered company lookup matches SQL pages and downloads only selected payload shards',async()=>{
    const downloads:string[]=[],files=fixture(downloads),version=Timestamp.now();
    const ids=['a','b','c','d','e','f','é','😀'];
    const rows=ids.map((id,i)=>({id,version,data:{companyId:i===7?'other':'company',...(i===6?{}:{publication_date:i===5?null:Timestamp.fromMillis(Math.floor(i/2)*1000)}),title:id}}));
    try{
        const heads=await Promise.all([...new Set(ids.map(shardFor))].map(shard=>files.write('events',shard,rows.filter(row=>shardFor(row.id)===shard),[])));
        for(const direction of ['asc','desc'])for(const offset of [0,1,4]){
            const steps=[{method:'where',args:['companyId','==','company']},{method:'orderBy',args:['publication_date',direction]},{method:'offset',args:[offset]},{method:'limit',args:[2]},{method:'select',args:['title']}];
            const expected=await files.filter(rows,steps),start=downloads.length;
            assert.deepEqual(await files.query(heads,steps),expected);
            const selected=new Set(expected.map(row=>shardFor(row.id)));
            assert(downloads.slice(start).filter(name=>heads.some(head=>head.indexFile===name)).every(name=>heads.some(head=>selected.has(head.shard)&&head.indexFile===name)));
            assert(!downloads.some(name=>heads.some(head=>head.file===name)));
            assert.deepEqual(await files.query(heads.map((head,i)=>i?head:{...head,format:6}),steps),expected,'mixed generations preserve the global page');
        }
        const steps=[{method:'where',args:['companyId','==','absent']},{method:'orderBy',args:['publication_date','desc']},{method:'limit',args:[2]}];
        assert.deepEqual(await files.query(heads,steps),[]);
        // A mixed generation cannot assume older shards contain the lookup.
        assert.deepEqual(await files.query(heads.map((head,i)=>i?head:{...head,format:6}),steps),[]);
        await assert.rejects(files.query(heads.map(head=>({...head,prefixFile:undefined})),steps),/Missing announcement index/);
    }finally{await files.close();}
});
test('announcement projections use covering indexes with safe fallback for older heads',async()=>{
    const downloads:string[]=[],files=fixture(downloads),id='announcement',version=Timestamp.now();
    const data={companyId:'US:NVDA',publication_date:version,title:'Quarterly results',url:'https://example.com/results',sourceId:'filing',category:'earnings',form:'10-Q',version:2,id:'source-id',body:'irrelevant'.repeat(1000)};
    const fields=['companyId','publication_date','title','url','sourceId','category','form','version','id'];
    const steps=[{method:'where',args:['companyId','==','US:NVDA']},{method:'orderBy',args:['publication_date','desc']},{method:'select',args:fields},{method:'limit',args:[12]}];
    try{
        const head=await files.write('events',shardFor(id),[{id,version,data}],[]);
        const rows=await files.query([head],steps);assert.equal(rows.length,1);assert.deepEqual(rows[0].data,Object.fromEntries(fields.map(field=>[field,data[field as keyof typeof data]])));
        assert(downloads.includes(announcementIndexFile(head.prefixFile!,announcementBucket(data.companyId))));assert(!downloads.includes(head.indexFile!),'company projection must not reopen broad indexes');assert(!downloads.includes(head.file!),'covered projection must not download full shards');
        assert.deepEqual(await files.query([{...head,format:9}],steps),rows,'rolling v9 shards retain the existing lookup path');
        assert.deepEqual(await files.query([head],steps.map(step=>step.method==='select'?{method:'select',args:['body']}:step)),[{id,version,data:{body:data.body}}],'uncovered fields still load full payloads');
        const older={...head,format:5};assert.deepEqual(await files.query([older],steps),rows);assert(downloads.includes(head.file!),'older index formats must use full payload fallback');
    }finally{await files.close();}
});
test('head listeners decode only changed shards and preserve newer committed heads',async()=>{
    const files=fixture();let decoded=0,emit!:(snapshot:FirebaseFirestore.QuerySnapshot)=>void;
    const id='watched-event',target=shardFor(id),time=(n:number)=>Timestamp.fromMillis(n);
    const head=(shard:string,revision='initial')=>({collection:'events' as const,shard,rows:0,retained:[],revision});
    const doc=(value:ReturnType<typeof head>,at=100)=>({id:headId('events',value.shard),exists:true,readTime:time(at),get:(field:string)=>{if(field==='marketHead'){decoded++;return value;}return value.shard;}});
    const committed=doc(head(target,'committed'),300);
    const source={where:()=>source,onSnapshot:(next:typeof emit)=>{emit=next;return()=>{};},doc:(id:string)=>({path:'collectors/'+id})};
    const raw={collection:()=>source,getAll:async()=>[committed]} as unknown as Firestore;
    const repo=new MarketRepository(raw,files);
    const docs=Array.from({length:256},(_,i)=>doc(head(i.toString(16).padStart(2,'0'))));
    const snapshot=(changes:Array<{type:string;doc:ReturnType<typeof doc>}>,at:number)=>({docs,readTime:time(at),docChanges:()=>changes}) as unknown as FirebaseFirestore.QuerySnapshot;
    try{
        const ready=repo.heads('events');emit(snapshot(docs.map(doc=>({type:'added',doc})),100));assert.equal((await ready).size,256);
        decoded=0;const changed=doc(head(target,'changed'));docs[parseInt(target,16)]=changed;emit(snapshot([{type:'modified',doc:changed}],200));
        assert.equal(decoded,1,'one changed shard must not decode the other 255 retained-ID arrays');
        assert.equal((await repo.heads('events')).get(target)?.revision,'changed');
        await repo.committed(['events/'+id]);assert.equal((await repo.heads('events')).get(target)?.revision,'committed');
        emit(snapshot([{type:'modified',doc:changed}],250));assert.equal((await repo.heads('events')).get(target)?.revision,'committed');
        emit(snapshot([{type:'removed',doc:committed}],400));assert.equal((await repo.heads('events')).has(target),false);
    }finally{await repo.close();}
});
test('web compact groups can grow while full payload groups remain bounded',async()=>{
    const previous=process.env.K_SERVICE;process.env.K_SERVICE='ifindata-web';let files:MarketFiles;
    try{files=fixture([],0);}finally{if(previous===undefined)delete process.env.K_SERVICE;else process.env.K_SERVICE=previous;}
    const batches:string[][]=[],internal=files as unknown as {local:(names:string[],work:(paths:string[])=>Promise<unknown>)=>Promise<unknown>};
    const local=internal.local.bind(files);internal.local=(names,work)=>{batches.push(names);return local(names,work);};
    try{
        const rows=['a','b'].map(id=>({id,version:Timestamp.now(),data:{name:id,body:'full payload'}}));assert.notEqual(shardFor('a'),shardFor('b'));
        const heads=await Promise.all(rows.map(row=>files.write('events',shardFor(row.id),[row],[])));for(const head of heads){head.bytes=20*1024*1024;head.indexBytes=20*1024*1024;}
        assert.deepEqual((await files.query(heads,[{method:'select',args:['name']},{method:'limit',args:[2]}])).map(row=>row.data),[{name:'a'},{name:'b'}]);
        assert.deepEqual(batches,[heads.map(head=>head.indexFile)]);batches.length=0;
        assert.deepEqual((await files.query(heads,[{method:'where',args:['__name__','in',['a','b']]}])).map(row=>row.data.body),['full payload','full payload']);
        assert.deepEqual(batches,heads.map(head=>[head.file]));
    }finally{await files.close();}
});
test('initial head snapshot reconciles a locally installed head absent from the server',async()=>{
    for(const readTime of [200,400]){
        const files=fixture(),id='initial-race',shard=shardFor(id);let emit!:(snapshot:FirebaseFirestore.QuerySnapshot)=>void;
        const doc={exists:true,id:headId('events',shard),readTime:Timestamp.fromMillis(300),get:()=>({collection:'events',shard,rows:0,retained:[],revision:'local'})};
        const source={where:()=>source,onSnapshot:(next:typeof emit)=>{emit=next;return()=>{};},doc:(id:string)=>({id})};
        const repo=new MarketRepository({collection:()=>source,getAll:async()=>[doc]} as unknown as Firestore,files);
        try{
            const initial=repo.heads('events');await repo.committed(['events/'+id]);
            emit({docs:[],docChanges:()=>[],readTime:Timestamp.fromMillis(readTime)} as unknown as FirebaseFirestore.QuerySnapshot);
            assert.equal((await initial).has(shard),readTime<300,'newer initial snapshots must reconcile absent local heads');
        }finally{await repo.close();}
    }
});
test('projected ID reads reuse unchanged documents across batches and shard updates',async()=>{
    const files=fixture([],1024*1024),calls:string[][]=[];
    const internal=files as unknown as {local:(names:string[],work:(paths:string[])=>Promise<unknown>)=>Promise<unknown>};
    const local=internal.local.bind(files);internal.local=(names,work)=>{calls.push(names);return local(names,work);};
    try{
        const row=(id:string,value:number)=>({id,data:{marketCap:value},version:Timestamp.fromMillis(value)});
        const a=await files.write('company_fundamentals',shardFor('a'),[row('a',1)],[]),b=await files.write('company_fundamentals',shardFor('b'),[row('b',2)],[]);
        const query=(heads:typeof a[],ids:string[])=>files.query(heads,[{method:'where',args:['__name__','in',ids]},{method:'select',args:['marketCap']}]);
        assert.deepEqual((await query([a,b],['a','b'])).map(row=>row.data.marketCap),[1,2]);calls.length=0;
        assert.deepEqual((await query([{...a,revision:'operational'},b],['a'])).map(row=>row.data.marketCap),[1]);assert.equal(calls.length,0);
        const changed=await files.write('company_fundamentals',b.shard,[row('b',3)],[]);
        assert.deepEqual((await query([a,changed],['b','a'])).map(row=>row.data.marketCap),[1,3]);
        assert(calls.flat().every(name=>name===changed.indexFile),'only the changed shard should be scanned');calls.length=0;
        const deleted=await files.write('company_fundamentals',b.shard,[],[]);
        assert.deepEqual((await query([a,deleted],['a','b'])).map(row=>row.id),['a']);
        const restored=await files.write('company_fundamentals',b.shard,[row('b',4)],[]);
        assert.deepEqual((await query([a,restored],['b'])).map(row=>row.data.marketCap),[4]);
    }finally{await files.close();}
});
test('small queries inspect only matching retained shards and refresh membership with new heads',async()=>{
    const id='membership-event',target=shardFor(id);let reads=0,emit!:(snapshot:FirebaseFirestore.QuerySnapshot)=>void;
    const counted=(ids:string[])=>new Proxy(ids,{get:(array,key,receiver)=>{if(typeof key==='string'&&/^\d+$/.test(key))reads++;return Reflect.get(array,key,receiver);}});
    const head=(shard:string,ids:string[])=>({collection:'events',shard,rows:1,retained:counted(ids),revision:'fixture'});
    const doc=(value:ReturnType<typeof head>)=>({exists:true,get:(field:string)=>field==='marketHead'?value:value.shard});
    const docs=Array.from({length:256},(_,i)=>{const shard=i.toString(16).padStart(2,'0');return doc(head(shard,shard===target?[id]:['unrelated-'+shard]));});
    const query={where:()=>query,limit:()=>query,get:async()=>({docs:[]}),doc:(id:string)=>({id,path:'events/'+id}),onSnapshot:(next:typeof emit)=>{emit=next;return()=>{};}};
    let overlays=0;
    const raw={collection:()=>query,getAll:async(...refs:Array<{path:string}>)=>{overlays+=refs.length;return refs.map(ref=>({exists:false,ref,data:()=>undefined}));}} as unknown as Firestore;
    const row={id,data:{type:'news'},version:Timestamp.now()};
    const files={query:async()=>[row],filter:async(rows:MarketRow[])=>rows,hydrate:async(row:MarketRow)=>row,close:async()=>{}} as unknown as MarketFiles;
    const repo=new MarketRepository(raw,files,undefined,true);
    try{
        const ready=repo.heads('events');emit({docs,readTime:Timestamp.fromMillis(100),docChanges:()=>docs.map(doc=>({type:'added',doc}))} as unknown as FirebaseFirestore.QuerySnapshot);await ready;reads=0;
        const steps=[{method:'where',args:['type','==','news']},{method:'limit',args:[1]}];
        assert.deepEqual(await repo.query('events',steps),[row]);assert.equal(reads,1,'unrelated retained shards must not be expanded');assert.equal(overlays,1);
        const other=target==='00'?'01':'00';
        repo.invalidate('events',new Set([other]));
        await repo.query('events',steps);
        assert.equal(overlays,1,'an unrelated head change must not reread the unchanged retained overlay');
        repo.invalidate('events');await repo.query('events',steps);assert.equal(reads,1,'immutable membership must be reused');assert.equal(overlays,2);
        const changed=doc(head(target,[]));emit({docs,readTime:Timestamp.fromMillis(200),docChanges:()=>[{type:'modified',doc:changed}]} as unknown as FirebaseFirestore.QuerySnapshot);
        await repo.query('events',steps);assert.equal(overlays,2,'new head membership must replace the preceding set');
    }finally{await repo.close();}
});
test('production web defaults enable immutable query reuse without a budget override',async()=>{
    const previous=process.env.K_SERVICE;process.env.K_SERVICE='ifindata-web';
    let files:MarketFiles;
    try{files=fixture();}finally{if(previous===undefined)delete process.env.K_SERVICE;else process.env.K_SERVICE=previous;}
    const internal=files as unknown as {queryUncached:MarketFiles['query']};
    const original=internal.queryUncached.bind(files);let scans=0;
    internal.queryUncached=async(...args)=>{scans++;return original(...args);};
    try{
        const id='web-default',head=await files.write('companies',shardFor(id),[{id,version:Timestamp.now(),data:{name:'Company'}}],[]);
        const steps=[{method:'where',args:['__name__','==',id]}];
        await files.query([head],steps);const first=scans;await files.query([head],steps);assert.equal(scans,first);
    }finally{await files.close();}
});
test('immutable queries survive operational revisions but observe new files and distinct bounds',async()=>{
    const files=fixture([],1024*1024),id='cached-company',version=Timestamp.now();
    const internal=files as unknown as {queryUncached:MarketFiles['query']};
    const original=internal.queryUncached.bind(files);let scans=0;
    internal.queryUncached=async(...args)=>{scans++;return original(...args);};
    const steps=[{method:'where',args:['__name__','==',id]},{method:'select',args:['name']}];
    try{
        const head=await files.write('companies',shardFor(id),[{id,version,data:{name:'Before'}}],[]);
        assert.equal((await files.query([head],steps))[0].data.name,'Before');const first=scans;
        await Promise.all([files.query([{...head,revision:'operational-change',retained:[id]}],steps),files.query([head],steps)]);
        assert.equal(scans,first,'unchanged external files must not be rescanned');
        assert.deepEqual(await files.query([head],[...steps,{method:'startAfter',args:[id]}]),[]);
        const next=await files.write('companies',shardFor(id),[{id,version,data:{name:'After'}}],[]);
        assert.equal((await files.query([next],steps))[0].data.name,'After');
        assert.equal((await files.query([head],steps))[0].data.name,'Before','old immutable generation remains addressable');
    }finally{await files.close();}
});
test('immutable query cache evicts oversized results and does not cache failures',async()=>{
    const files=fixture([],1),id='tiny-cache',version=Timestamp.now();
    const internal=files as unknown as {queryUncached:MarketFiles['query']};
    const original=internal.queryUncached.bind(files);let scans=0,fail=true;
    internal.queryUncached=async(...args)=>{scans++;if(fail){fail=false;throw Error('transient read');}return original(...args);};
    const steps=[{method:'where',args:['__name__','==',id]}];
    try{
        const head=await files.write('companies',shardFor(id),[{id,version,data:{name:'Company'}}],[]);
        await assert.rejects(files.query([head],steps),/transient read/);
        assert.equal((await files.query([head],steps))[0].data.name,'Company');const first=scans;
        await files.query([head],steps);assert(scans>first,'oversized results must not remain cached');
    }finally{await files.close();}
});

test('relationship endpoint equality and singleton in share immutable scans and follow new files',async()=>{
    const files=fixture([],1024*1024),id='endpoint-edge',version=Timestamp.now();
    const internal=files as unknown as {queryUncached:MarketFiles['query']};
    const original=internal.queryUncached.bind(files);let scans=0;
    internal.queryUncached=async(...args)=>{scans++;return original(...args);};
    const eq=[{method:'where',args:['source','==','US:NVDA']}];
    const one=[{method:'where',args:['source','in',['US:NVDA']]}];
    try{
        const head=await files.write('company_relationships',shardFor(id),[{id,version,data:{source:'US:NVDA',target:'US:AMD'}}],[]);
        const [a,b]=await Promise.all([files.query([head],eq),files.query([head],one)]);
        assert.deepEqual(a,b);assert.equal(a[0].id,id);const first=scans;
        await files.query([{...head,revision:'overlay-only',retained:[id]}],one);
        assert.equal(scans,first,'equivalent requests and operational revisions reuse external membership');
        assert.deepEqual(await files.query([head],[{method:'where',args:['source','==','US:AMD']}]),[]);
        assert.equal((await files.query([head],[{method:'where',args:['target','in',['US:AMD']]}]))[0].id,id);
        const next=await files.write('company_relationships',shardFor(id),[{id,version,data:{source:'US:AMD',target:'US:NVDA'}}],[]);
        assert.deepEqual(await files.query([next],one),[],'new immutable generation invalidates membership');
        assert.equal((await files.query([head],eq))[0].id,id);
        assert.deepEqual(one,[{method:'where',args:['source','in',['US:NVDA']]}],'caller steps remain unchanged');
    }finally{await files.close();}
});

test('relationship endpoint cache keeps its byte cap and retries failed reads',async()=>{
    const files=fixture([],1),id='endpoint-cap',version=Timestamp.now();
    const internal=files as unknown as {queryUncached:MarketFiles['query']};
    const original=internal.queryUncached.bind(files);let scans=0,fail=true;
    internal.queryUncached=async(...args)=>{scans++;if(fail){fail=false;throw Error('endpoint read failed');}return original(...args);};
    const steps=[{method:'where',args:['source','==','US:NVDA']}];
    try{
        const head=await files.write('company_relationships',shardFor(id),[{id,version,data:{source:'US:NVDA'}}],[]);
        await assert.rejects(files.query([head],steps),/endpoint read failed/);
        assert.equal((await files.query([head],steps))[0].id,id);const first=scans;
        await files.query([head],steps);assert(scans>first,'oversized endpoint results are evicted');
    }finally{await files.close();}
});
test('broad and oversized queries cannot evict a cached bounded lookup',async()=>{
    const files=fixture([],2048),id='small-result',version=Timestamp.now();
    const internal=files as unknown as {queryUncached:MarketFiles['query']};
    const original=internal.queryUncached.bind(files);let scans=0;
    internal.queryUncached=async(...args)=>{scans++;return original(...args);};
    try{
        const head=await files.write('companies',shardFor(id),[{id,version,data:{name:'Small',body:'large'.repeat(10000)}}],[]);
        const small=[{method:'where',args:['__name__','==',id]},{method:'select',args:['name']}];
        await files.query([head],small);
        await files.query([head],[]);const broad=scans;await files.query([head],[]);assert(scans>broad,'unbounded scans must not be retained');
        await files.query([head],[{method:'where',args:['__name__','==',id]}]);
        const before=scans;assert.equal((await files.query([head],small))[0].data.name,'Small');assert.equal(scans,before,'large results must not evict the small lookup');
    }finally{await files.close();}
});
test('merged filtering reads only predicate and ordering fields while retaining full rows',async()=>{
    const files=fixture(),version=Timestamp.now();
    const rows=[1,2,3].map(score=>({id:String(score),version,data:{score,name:'Company '+score}}));
    for(const row of rows)Object.defineProperty(row.data,'unusedEvidence',{enumerable:true,get(){throw Error('Unrelated field was indexed');}});
    try{
        const selected=await files.filter(rows,[{method:'where',args:['score','>=',2]},{method:'orderBy',args:['score','desc']},{method:'limit',args:[2]}]);
        assert.deepEqual(selected.map(row=>row.id),['3','2']);assert.equal(selected[0],rows[2]);assert.equal(selected[0].data.name,'Company 3');
        assert.deepEqual((await files.filter(rows,[{method:'startAfter',args:['1']}])).map(row=>row.id),['2','3']);
    }finally{await files.close();}
});
test('prefix bytes preserve exact membership, reuse generations and evict within the budget',async()=>{
    let loads=0;const cache=new PrefixCache(),load=async()=>{loads++;return [{id:'a',values:['nvda','nv','英伟达','nvda']},{id:'b',values:['amd','nvda-x','bad\0nvda\0value']},{id:'c',values:['nvda']}];};
    assert.deepEqual(await cache.matching('generation1','nvda',load),['a','c']);
    assert.deepEqual(await cache.matching('generation1','英伟达',load),['a']);
    assert.deepEqual(await cache.matching('generation1','amd',load),['b']);assert.equal(loads,1);
    assert.deepEqual(await cache.matching('generation2','nvda',async()=>[{id:'b',values:['nvda']}]),['b']);
    const tiny=new PrefixCache(1);await tiny.matching('generation1','amd',load);await tiny.matching('generation1','amd',load);assert.equal(loads,3);
});
test('persisted prefix indexes preserve exact values and reject invalid offsets',async()=>{
    const encoded=encodePrefixLookup(buildPrefixLookup([{id:'a',values:['nvda','英伟达']},{id:'b',values:['amd']}]));
    const cache=new PrefixCache();
    assert.deepEqual(await cache.matching('stored','英伟达',async()=>decodePrefixLookup(encoded)),['a']);
    const packed=decodePrefixLookup(encoded,true);
    assert.deepEqual(packed.ids,[]);assert(packed.packedIds);
    assert.equal(encodePrefixLookup(packed),encoded);
    assert.deepEqual(await cache.matching('packed','英伟达',async()=>packed),['a']);
    assert.deepEqual(await cache.matching('packed','amd',async()=>{throw Error('cached');}),['b']);
    const invalid=JSON.parse(encoded);invalid.rawBytes++;
    assert.throws(()=>decodePrefixLookup(JSON.stringify(invalid)),/offsets/);
});
test('prefix projections use persisted indexes and remain compatible with legacy heads',async()=>{
    const downloads:string[]=[],files=fixture(downloads),row={id:'company',version:Timestamp.now(),data:{name:'Company',searchPrefixes:['nvda','nv'],body:'large '.repeat(10000)}};
    try{
        const head=await files.write('companies',shardFor(row.id),[row],[]);
        const steps=[{method:'where',args:['searchPrefixes','array-contains','nvda']},{method:'select',args:['name']}];
        assert.deepEqual((await files.query([head],steps))[0].data,{name:'Company'});
        assert(downloads.includes(head.prefixFile!));assert(!downloads.includes(head.file!));
        const legacy={...head,format:4,prefixFile:undefined,prefixBytes:undefined};
        (files as unknown as {prefixes:PrefixCache}).prefixes.clear();
        assert.deepEqual((await files.query([legacy],steps))[0].data,{name:'Company'});
        assert(downloads.includes(head.file!));
    }finally{await files.close();}
});
test('prefix candidate lookup preserves other predicates, order, projection and new head contents',async()=>{
    const files=fixture(),version=Timestamp.now();
    const rows=Array.from({length:12},(_,i)=>({id:'prefix-'+i,version,data:{searchPrefixes:[i%2?'amd':'nvda','英伟达'],score:i,name:'Company '+i}}));
    try{
        const heads=[];for(const shard of new Set(rows.map(row=>shardFor(row.id))))heads.push(await files.write('companies',shard,rows.filter(row=>shardFor(row.id)===shard),[]));
        const steps=[{method:'where',args:['searchPrefixes','array-contains','nvda']},{method:'where',args:['score','>=',4]},{method:'orderBy',args:['score','desc']},{method:'limit',args:[2]},{method:'select',args:['name']}];
        assert.deepEqual(await files.query(heads,steps),await files.filter(rows,steps));
        const page=[{method:'where',args:['searchPrefixes','array-contains','nvda']},{method:'offset',args:[1]},{method:'limit',args:[2]},{method:'select',args:['name']}];
        assert.deepEqual(await files.query(heads,page),await files.filter(rows,page));
        const old=heads[0],oldRows=rows.filter(row=>shardFor(row.id)===old.shard);
        const next=await files.write('companies',old.shard,oldRows.map(row=>({...row,data:{...row.data,searchPrefixes:['changed']}})),[]);
        const updated=[next,...heads.slice(1)];
        assert.deepEqual((await files.query(updated,[{method:'where',args:['searchPrefixes','array-contains','changed']}])).map(row=>row.id).sort(),oldRows.map(row=>row.id).sort());
        assert.equal((await files.query([next],[{method:'where',args:['searchPrefixes','array-contains','nvda']}])).length,0);
    }finally{await files.close();}
});
test('Parquet round trips timestamps, bytes, nested arrays and query semantics', async () => {
    const files = fixture(), version = new Timestamp(1794770000, 123);
    const ids = Array.from({ length: 40 }, (_, i) => 'record-' + i);
    const rows: MarketRow[] = ids.map((id, i) => ({ id, version, data: { ticker: i % 2 ? 'NVDA' : 'AMD', score: i, tags: i % 3 ? ['ai', 'us'] : ['cn'], time: new Timestamp(10, i), nested: { text: 'quote\' \\ 中文' }, bytes: Buffer.from([0, 1, 255]), nullable: null } }));
    try {
        const heads = [];
        for (const shard of new Set(ids.map(shardFor)))
            heads.push(await files.write('events', shard, rows.filter(r => shardFor(r.id) === shard), []));
        const all = (await Promise.all(heads.map(head => files.read(head)))).flat().sort((a, b) => a.id.localeCompare(b.id));
        assert.deepEqual(all, rows.toSorted((a, b) => a.id.localeCompare(b.id)));
        const selected = await files.query(heads, [{ method: 'where', args: ['ticker', '==', 'NVDA'] }, { method: 'where', args: ['score', '>=', 10] }, { method: 'orderBy', args: ['score', 'desc'] }, { method: 'limit', args: [3] }]);
        assert.deepEqual(selected.map(r => r.data.score), [39, 37, 35]);
        const arrays = await files.query(heads, [{ method: 'where', args: ['tags', 'array-contains', 'cn'] }, { method: 'orderBy', args: ['score'] }, { method: 'startAfter', args: [12] }, { method: 'limit', args: [2] }]);
        assert.deepEqual(arrays.map(r => r.data.score), [15, 18]);
        const projected = await files.query(heads, [{ method: 'where', args: [FieldPath.documentId(), 'in', ['record-1', 'record-2']] }, { method: 'select', args: ['nested.text'] }]);
        assert.deepEqual(projected.map(r => r.data), [{ nested: { text: 'quote\' \\ 中文' } }, { nested: { text: 'quote\' \\ 中文' } }]);
        const last = await files.query(heads, [{ method: 'orderBy', args: ['score'] }, { method: 'limitToLast', args: [2] }]);
        assert.deepEqual(last.map(r => r.data.score), [38, 39]);
    }
    finally {
        await files.close();
    }
});
test('transforms preserve merge, replace, field paths, timestamps and preconditions', () => {
    const at = new Timestamp(42, 123), before = { nested: { keep: 1, change: 2 }, list: ['a'], counter: 3 };
    assert.deepEqual(applyMutation(before, 'set', [{ nested: { change: 4 } }, { merge: true }], at), { ...before, nested: { keep: 1, change: 4 } });
    assert.deepEqual(applyMutation(before, 'update', [{ 'nested.change': FieldValue.delete(), counter: FieldValue.increment(2), list: FieldValue.arrayUnion('a', 'b'), stamp: FieldValue.serverTimestamp() }], at), { nested: { keep: 1 }, counter: 5, list: ['a', 'b'], stamp: at });
    assert.deepEqual(applyMutation(before, 'set', [{ fresh: true }], at), { fresh: true });
    assert.throws(() => applyMutation(undefined, 'update', [{ fresh: true }], at));
    assert.throws(() => applyMutation(before, 'create', [{}], at));
    const ordered = [-Infinity, -9, -0, 0, 0.01, 100, Infinity];
    assert.deepEqual(ordered.map(sortKey).toSorted(), ordered.map(sortKey));
    assert(sortKey(new Timestamp(1, 1))! < sortKey(new Timestamp(1, 2))!);
});
test('compact predicates and projections avoid downloading full payload shards',async()=>{
    const downloads:string[]=[],files=fixture(downloads);
    try{
        const row={id:'event',version:Timestamp.now(),data:{companyIds:['US:NVDA'],name:'Announcement',date:'2026-11-13',body:'large article '.repeat(20000)}};
        const head=await files.write('events',shardFor(row.id),[row],[]);
        const projected=await files.query([head],[{method:'where',args:['companyIds','array-contains','US:NVDA']},{method:'select',args:['name','date']}]);
        assert.deepEqual(projected[0].data,{name:'Announcement',date:'2026-11-13'});
        assert(downloads.includes(head.indexFile!));assert(!downloads.includes(head.file!));
        const full=await files.query([head],[{method:'where',args:['companyIds','array-contains','US:NVDA']}]);
        assert.deepEqual(full[0].data,row.data);assert(downloads.includes(head.file!));
        const fallback=await files.query([head],[{method:'where',args:['body','==',row.data.body]}]);
        assert.equal(fallback.length,1);
        const calendar={...row,id:'calendar',data:{type:'scheduled_event',scheduled_date:'2026-11-13',confirmation:'official',dateEvidence:'Company announcement'}};
        const calendarHead=await files.write('events',shardFor(calendar.id),[calendar],[]);
        const schedule=await files.query([calendarHead],[{method:'where',args:['type','==','scheduled_event']}]);
        assert.deepEqual(schedule[0].data,calendar.data);assert(!downloads.includes(calendarHead.file!));
    }finally{await files.close();}
});
test('UGC, active queues, leases and deduplication stay in Firestore', () => {
    const ugc = { status: 'PUBLISHED', createdBy: 'user', description: 'authored' };
    assert.deepEqual(splitRecord('companies', 'US:EXAMPLE', ugc), { external: {}, retained: ugc });
    const source = { recordType: 'source', status: 'processing', source: { url: 'https://example.com' }, leaseOwner: 'worker' };
    assert.deepEqual(splitRecord('earnings_sources', 'earnings_source_1', source).retained, source);
    const fundamentals = { value: { revenue: 100 }, pending: true, requestedAt: 'now', cnLeaseOwner: 'owner' };
    assert.deepEqual(splitRecord('company_fundamentals', 'US:EXAMPLE', fundamentals), { external: { value: { revenue: 100 } }, retained: { pending: true, requestedAt: 'now', cnLeaseOwner: 'owner' } });
    const filing = { form: '10-K', discoveryPending: true, discoveryEvents: { delivery: { state: 'pending' } } };
    assert.deepEqual(splitRecord('sec_filings', 'accession', filing), { external: { form: '10-K' }, retained: { discoveryPending: true, discoveryEvents: filing.discoveryEvents } });
    const history = { completed: true, request: { eventId: 'dedup' }, result: { records: 20 } };
    assert.deepEqual(splitRecord('company_fundamentals', '_finished_work', history), { external: { result: { records: 20 } }, retained: { completed: true, request: { eventId: 'dedup' } } });
});
test('cleanup resumes safely after external fields have already been stripped',()=>{
    const doc=(data:Record<string,unknown>)=>({exists:true,id:'US:NVDA',data:()=>data}) as Parameters<typeof cleanupRecord>[1];
    const retained={companyId:'US:NVDA',pending:true,updatedAt:Timestamp.now()};
    assert.equal(cleanupRecord('company_fundamentals',doc(retained),undefined).kind,'retained');
    assert.equal(cleanupRecord('company_fundamentals',doc({...retained,value:{revenue:100}}),undefined).kind,'strip');
});
test('large binary captures stay in GCS and only selected records hydrate their bytes', async () => {
    const files = fixture(), data = { recordType: 'raw_chunk', bytes: Buffer.alloc(400000, 42) }, row = { id: 'chunk', data, version: Timestamp.now() };
    try {
        const head = await files.write('earnings_sources', shardFor(row.id), [row], []), stored = await files.read(head);
        assert(stored[0].data.bytes instanceof MarketBlob);
        assert.deepEqual((await files.hydrate(stored[0])).data, data);
        const second = await files.write('earnings_sources', head.shard, stored, []);
        assert.deepEqual((await files.hydrate((await files.read(second))[0])).data, data);
    }
    finally {
        await files.close();
    }
});
test('a local shard refresh cannot hide another shard in an older listener snapshot',async()=>{
    const files=fixture(),a=shardFor('a'),b=shardFor('b');assert.notEqual(a,b);
    const doc=(shard:string,revision:string,seconds:number)=>({exists:true,id:headId('events',shard),readTime:new Timestamp(seconds,0),get:(field:string)=>field==='marketHead.shard'?shard:{collection:'events',shard,rows:0,retained:[],revision}});
    type Change={type:'added'|'modified';doc:ReturnType<typeof doc>};
    let emit: (snapshot:{readTime:Timestamp;docs:ReturnType<typeof doc>[];docChanges:()=>Change[]})=>void=()=>{throw Error('Listener not connected');};
    const raw={collection:()=>({doc:(id:string)=>({id}),where:()=>({onSnapshot:(next:typeof emit)=>{emit=next;return()=>{};}})}),getAll:async()=>[doc(a,'a-new',30)]} as unknown as Firestore;
    const repo=new MarketRepository(raw,files);
    try{
        const initial=repo.heads('events'),initialDocs=[doc(a,'a-old',10),doc(b,'b-old',10)];emit({readTime:new Timestamp(10,0),docs:initialDocs,docChanges:()=>initialDocs.map(doc=>({type:'added',doc}))});await initial;
        await repo.committed(['events/a']);
        emit({readTime:new Timestamp(20,0),docs:[doc(a,'a-old',20),doc(b,'b-new',20)],docChanges:()=>[{type:'modified',doc:doc(b,'b-new',20)}]});
        const heads=await repo.heads('events');assert.equal(heads.get(a)?.revision,'a-new');assert.equal(heads.get(b)?.revision,'b-new');
    }finally{await repo.close();}
});
test('cleanup capacity failures latch closed and queue growth cannot pass a healthy endpoint',async()=>{
    const base={requestErrors:0,backlogs:{cache:10}};
    assert.equal(capacityRegression(base,{requestErrors:0,backlogs:{cache:20}}),undefined);
    assert.match(capacityRegression(base,{requestErrors:0,backlogs:{cache:111}})!,/backlog/);
    let samples=0;const gate=new CleanupGate(async()=>{samples++;return {requestErrors:1,backlogs:{cache:0}};});
    await assert.rejects(gate.before(1),/request errors/);await assert.rejects(gate.before(1),/request errors/);assert.equal(samples,1);
});

test('direct ID reads skip the compact index while projections retain the smaller source',async()=>{
    const downloads:string[]=[],files=fixture(downloads),row={id:'direct-id',version:Timestamp.now(),data:{name:'Company',body:'External body'}};
    try{
        const head=await files.write('companies',shardFor(row.id),[row],[]);
        assert.deepEqual(await files.query([head],[{method:'where',args:['__name__','==',row.id]}]),[row]);
        assert.deepEqual(downloads,[head.file]);
        downloads.length=0;
        assert.deepEqual((await files.query([head],[{method:'where',args:['__name__','==',row.id]},{method:'select',args:['name']}]))[0].data,{name:'Company'});
        assert.deepEqual(downloads,[head.indexFile]);
    }finally{await files.close();}
});

test('ID ordering without an exact predicate still uses the compact index',async()=>{
    const downloads:string[]=[],files=fixture(downloads),row={id:'range-id',version:Timestamp.now(),data:{name:'Company',body:'External body'}};
    try{
        const head=await files.write('companies',shardFor(row.id),[row],[]);
        assert.deepEqual(await files.query([head],[{method:'orderBy',args:['__name__']},{method:'startAt',args:['range']},{method:'limit',args:[1]}]),[row]);
        assert.deepEqual(downloads,[head.indexFile,head.file]);
    }finally{await files.close();}
});
test('sparse calendar projections avoid news scans and follow live shard replacements',async()=>{
 const downloads:string[]=[],files=fixture(downloads,32*1024*1024),version=Timestamp.now();
 const ids=['calendar-a','calendar-b','calendar-c'];assert.equal(new Set(ids.map(shardFor)).size,3);
 let rows:MarketRow[]=ids.map((id,i)=>({id,version,data:{type:'scheduled_event',scheduled_date:`2026-11-${16+i}`,title:'Calendar '+i,summary:'Evidence'}}));
 const steps=[{method:'where',args:['type','==','scheduled_event']},{method:'where',args:['scheduled_date','>=','2026-11-16']},{method:'orderBy',args:['scheduled_date']},{method:'limit',args:[1000]}];
 try{
  const original=await Promise.all(rows.map(row=>files.write('events',shardFor(row.id),[row],[])));
  let heads=await files.bundleIndexes(original);const start=downloads.length;
  assert.deepEqual(await files.query(heads,steps),await files.filter(rows,steps));
  assert(downloads.slice(start).every(name=>heads.some(head=>calendarIndexFile(head.prefixFile!)===name)),'calendar must load only small calendar sidecars');
  assert.deepEqual(await files.query([heads[1]],steps),await files.filter([rows[1]],steps),'old bundled shards cannot leak into a partial read');
  assert.deepEqual(await files.query(heads.map((head,i)=>i?head:{...head,format:110}),steps),await files.filter(rows,steps),'format 10 lookups remain readable alongside sidecars');
  rows=rows.map((row,i)=>i?row:{...row,data:{...row.data,scheduled_date:'2026-11-25',title:'Rescheduled'}});
  heads[0]=await files.write('events',heads[0].shard,[rows[0]],[]);
  assert.deepEqual(await files.query(heads,steps),await files.filter(rows,steps));
  assert.deepEqual(await files.query(heads,[...steps,{method:'select',args:['title']}]),await files.filter(rows,[...steps,{method:'select',args:['title']}]));
  assert.deepEqual(await files.query(heads.map((head,i)=>i?head:{...head,format:7}),steps),await files.filter(rows,steps),'mixed old/new writers keep the legacy fallback');
  heads=await files.bundleIndexes(heads);assert.deepEqual(await files.query(heads,steps),await files.filter(rows,steps));
  heads[0]=await files.write('events',heads[0].shard,[],[]);rows=rows.slice(1);
  assert.deepEqual(await files.query(heads,steps),await files.filter(rows,steps));
 }finally{await files.close();}
});

test('company postings avoid decoding unrelated IDs and coexist with legacy shards',async()=>{
    const files=fixture(),version=Timestamp.now(),company="US:O'Reilly/测试:ab";
    const ids:string[]=[];for(let i=0;ids.length<4;i++)if(!ids.some(id=>shardFor(id)===shardFor('posting-'+i)))ids.push('posting-'+i);
    const rows=ids.map((id,i)=>({id,version,data:{companyId:i===3?'US:OTHER':company,publication_date:'2026-11-0'+(i+1),title:'row-'+i}}));
    const cache=(files as unknown as {announcementPrefixes:PrefixCache}).announcementPrefixes,matching=cache.matching.bind(cache);let legacyCalls=0;
    cache.matching=(...args:Parameters<PrefixCache['matching']>)=>{legacyCalls++;return matching(...args);};
    try{
        const original=await Promise.all(rows.map(row=>files.write('events',shardFor(row.id),[row],[]))),heads=await files.bundleIndexes(original);
        const steps=[{method:'where',args:['companyId','==',company]},{method:'orderBy',args:['publication_date','desc']},{method:'offset',args:[1]},{method:'limit',args:[2]},{method:'select',args:['title']}];
        assert.deepEqual(await files.query(heads,steps),await files.filter(rows,steps));assert.equal(legacyCalls,0);
        assert.deepEqual(await files.query([heads[3]],steps),[],'another company in the shared file cannot leak into this shard');
        assert.deepEqual(await files.query(heads,[{method:'where',args:['companyId','==','US:MISSING']},...steps.slice(1)]),[]);
        const mixed=[{...heads[0],format:108},...heads.slice(1)];
        assert.deepEqual(await files.query(mixed,steps),await files.filter(rows,steps));assert(legacyCalls>0,'old shards retain their original lookup');
    }finally{await files.close();}
});

test('small search point reads agree with DuckDB for selected and complete instrument payloads',async()=>{
    const files=fixture([],0);
    try{
        const id='US:NVDA',version=Timestamp.fromMillis(1700000000123);
        const head=await files.write('instruments',shardFor(id),[{id,version,data:{
            name:'NVIDIA',symbol:'NVDA',searchTerms:['nvidia'],nested:{at:version},active:true,
        }}],[]);
        const ids={method:'where',args:['__name__','in',[id,'US:missing']]};
        const direct=files as unknown as {directoryPointRows(heads:typeof head[],steps:{method:string;args:unknown[]}[]):Promise<MarketRow[]>};
        for(const steps of [[ids],[ids,{method:'select',args:['name','nested.at']}],[ids,{method:'select',args:['searchTerms']}]]){
            const expected=await files.query([head],steps);
            assert.equal(expected[0].id,id);
            assert.deepEqual(await direct.directoryPointRows([head],steps),expected);
        }
    }finally{await files.close();}
});
test('a cold subscription refreshes once for its initial head and once per later change',async()=>{
    const files=fixture();
    let emit!:(snapshot:FirebaseFirestore.QuerySnapshot)=>void;
    const source={where:()=>source,onSnapshot:(next:typeof emit)=>{emit=next;return()=>{};}};
    const repo=new MarketRepository({collection:()=>source} as unknown as Firestore,files);
    const shard=shardFor('watched'),calls:number[]=[];
    function publish(version:number){
        const head={collection:'companies',shard,rows:0,retained:[],revision:String(version)};
        const doc={id:headId('companies',shard),exists:true,get:(field:string)=>field==='marketHead'?head:shard};
        emit({docs:[doc],docChanges:()=>[{type:version===1?'added':'modified',doc}],readTime:Timestamp.fromMillis(version)} as unknown as FirebaseFirestore.QuerySnapshot);
    }
    try{
        const stop=repo.subscribe('companies',undefined,()=>calls.push(1),err=>{throw err;});
        publish(1);
        await new Promise<void>(resolve=>setImmediate(resolve));
        assert.equal(calls.length,1);
        publish(2);
        assert.equal(calls.length,2);
        stop();
        publish(3);
        assert.equal(calls.length,2);
    }finally{await repo.close();}
});
