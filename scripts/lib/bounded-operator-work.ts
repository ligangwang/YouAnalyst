/** Stop admitting work on failure and drain every already-started operation. */
export async function boundedOperatorWork<T>(items:Iterable<T>|AsyncIterable<T>,limit:number,work:(item:T)=>Promise<void>) {
    if(!Number.isInteger(limit)||limit<1||limit>4)throw Error('Invalid operator concurrency');
    const pending=new Set<Promise<void>>();let failed=false,failure:unknown;
    const fail=(error:unknown)=>{if(!failed){failed=true;failure=error;}};
    try{
        for await(const item of items){
            if(failed)break;
            const task=Promise.resolve().then(()=>work(item)).catch(fail).finally(()=>pending.delete(task));
            pending.add(task);
            if(pending.size>=limit)await Promise.race(pending);
            if(failed)break;
        }
    }catch(error){fail(error);}
    await Promise.all(pending);
    if(failed)throw failure;
}
