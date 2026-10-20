import {setTimeout as delay} from 'node:timers/promises';

/** A safety read must succeed before the caller may issue another write batch. */
export function createMigrationSafetyReader(options:{now?:()=>number;sleep?:(ms:number)=>Promise<void>}={}){
  const now=options.now??Date.now,sleep=options.sleep??(async ms=>{await delay(ms);});
  let nextReadAt=0;
  return async function read(request:()=>Promise<Response>){
    for(let attempt=0;;attempt++){
      const wait=nextReadAt-now();if(wait>0)await sleep(wait);
      nextReadAt=now()+2000; // <=30 calls/minute; leave room for other log readers.
      const response=await request();
      if(response.status!==429||attempt>=2)return response;
      // No writes occur while monitoring is unavailable. Bound retries so an
      // unavailable safety service still stops the release instead of bypassing it.
      const retry=Number(response.headers.get('retry-after'));
      nextReadAt=now()+Math.max(60000,Number.isFinite(retry)?Math.min(retry*1000,120000):0);
      await response.body?.cancel();
    }
  };
}
