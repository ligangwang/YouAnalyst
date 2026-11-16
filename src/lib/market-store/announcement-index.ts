import {fieldName,queryIndex,type Data} from './value';
import {compileMarketQuery,type Step} from './query';
import type {PrefixRows} from './prefix-cache';

// A secondary index value in the existing field/payload lookup file. It adds
// no document fields: each lookup identity carries the existing date key/ID.
export const ANNOUNCEMENT_LOOKUP='companyId/publication_date';
export function announcementLookup(rows:Array<{id:string;data:Data}>):PrefixRows{
    return rows.flatMap(row=>{
        const company=row.data.companyId,date=queryIndex({publication_date:row.data.publication_date}).keys.publication_date;
        return typeof company==='string'&&company.length>0&&!company.includes('\0')&&date!==undefined
            ?[{id:JSON.stringify([date,row.id]),values:[company]}]:[];
    });
}
export function announcementPlan(steps:Step[]){
    const where=steps.filter(step=>step.method==='where'),order=steps.filter(step=>step.method==='orderBy');
    if(where.length!==1||fieldName(where[0].args[0])!=='companyId'||where[0].args[1]!=='=='
        ||typeof where[0].args[2]!=='string'||!where[0].args[2]||where[0].args[2].includes('\0')
        ||order.length!==1||fieldName(order[0].args[0])!=='publication_date'
        ||steps.some(step=>!['where','orderBy','select','limit','offset'].includes(step.method)))return undefined;
    const query=compileMarketQuery(steps);
    if(query.limit===undefined||query.limit+query.offset>2048)return undefined;
    return {company:where[0].args[2],desc:order[0].args[1]==='desc',limit:query.limit,offset:query.offset};
}
export function announcementIds(values:string[],plan:NonNullable<ReturnType<typeof announcementPlan>>){
    const rows=values.map(value=>{
        const tuple:unknown=JSON.parse(value);
        if(!Array.isArray(tuple)||tuple.length!==2||tuple.some(value=>typeof value!=='string'))throw Error('Invalid announcement lookup');
        return tuple as [string,string];
    });
    rows.sort((a,b)=>(plan.desc?-1:1)*(Buffer.compare(Buffer.from(a[0]),Buffer.from(b[0]))||Buffer.compare(Buffer.from(a[1]),Buffer.from(b[1]))));
    return rows.slice(plan.offset,plan.offset+plan.limit).map(row=>row[1]);
}
