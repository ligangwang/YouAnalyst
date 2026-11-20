import {GoogleAuth, type OAuth2Client} from 'google-auth-library';
export type CapacitySample={requestErrors:number;backlogs:Record<string,number>};
export function capacityRegression(initial:CapacitySample,current:CapacitySample):string|undefined{
    if(current.requestErrors>0)return 'Production website request errors detected';
    for(const [name,count] of Object.entries(current.backlogs)){
        const before=initial.backlogs[name]??0;
        if(count>before+Math.max(100,Math.ceil(before*0.2)))return 'Subscriber backlog grew beyond the migration allowance';
    }
}
export function migrationCapacity(project:string, credentials?:OAuth2Client){
    const auth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']});
    return async():Promise<CapacitySample>=>{
        const client=credentials ?? await auth.getClient(),end=new Date(),start=new Date(end.getTime()-5*60000);
        const [logs,metrics]=await Promise.all([
            client.request<{entries?:unknown[]}>({url:'https://logging.googleapis.com/v2/entries:list',method:'POST',data:{resourceNames:['projects/'+project],filter:`resource.type="cloud_run_revision" AND resource.labels.service_name="ifindata-web" AND httpRequest.status>=500 AND timestamp>="${start.toISOString()}"`,pageSize:1,orderBy:'timestamp desc'},timeout:15000}),
            client.request<{timeSeries?:Array<{resource?:{labels?:{subscription_id?:string}};points?:Array<{value?:{int64Value?:string;doubleValue?:number}}>}>,nextPageToken?:string}>({url:`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries`,params:{filter:'metric.type="pubsub.googleapis.com/subscription/num_undelivered_messages"','interval.startTime':start.toISOString(),'interval.endTime':end.toISOString(),view:'FULL',pageSize:1000},timeout:15000}),
        ]);
        if(metrics.data.nextPageToken)throw Error('Incomplete queue-capacity sample');
        const backlogs:Record<string,number>={};
        for(const series of metrics.data.timeSeries??[]){
            const name=series.resource?.labels?.subscription_id;
            if(!name||/dead-letter|deadletter/i.test(name))continue;
            const value=series.points?.[0]?.value;
            const count=Number(value?.int64Value??value?.doubleValue);
            if(!Number.isFinite(count)||count<0)throw Error('Invalid queue-capacity sample');
            backlogs[name]=Math.max(backlogs[name]??0,count);
        }
        if(!Object.keys(backlogs).length)throw Error('Queue-capacity telemetry is unavailable');
        return {requestErrors:logs.data.entries?.length??0,backlogs};
    };
}
/** One shared limiter across operator workers. A failed observation latches
 * closed, so no later worker can start another batch after a capacity error. */
export class CleanupGate{
    private next=0;private checked=0;private pending?:Promise<void>;private failure?:unknown;private initial?:CapacitySample;
    constructor(private inspect:()=>Promise<CapacitySample>,private rate=1000){if(!Number.isFinite(rate)||rate<1||rate>5000)throw Error('Invalid cleanup rate');}
    async before(count:number){
        if(!Number.isInteger(count)||count<1||count>100)throw Error('Invalid cleanup batch');
        if(this.failure)throw this.failure;
        const reserved=Math.max(Date.now(),this.next);this.next=reserved+count*1000/this.rate;
        await new Promise(resolve=>setTimeout(resolve,Math.max(0,reserved-Date.now())));
        if(this.failure)throw this.failure;
        if(!this.pending&&Date.now()-this.checked>=15000){
            this.pending=(async()=>{
                const sample=await this.inspect();this.initial??=sample;
                const error=capacityRegression(this.initial,sample);if(error)throw Error(error);
                this.checked=Date.now();console.info(JSON.stringify({event:'market_cleanup_capacity',...sample,rate:this.rate}));
            })().catch(error=>{this.failure=error;throw error;}).finally(()=>{this.pending=undefined;});
        }
        await this.pending;
        if(this.failure)throw this.failure;
    }
}
