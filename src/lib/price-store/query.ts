import {FieldPath,Timestamp} from 'firebase-admin/firestore';
import {priceColumns,quote,timestampNanos} from './parquet';
import type {Row} from '../entity-snapshots/sync';

export type Step={method:string;args:unknown[]};
export function field(value:unknown):string{
 const name=value instanceof FieldPath&&value.isEqual(FieldPath.documentId())?'id':String(value)==='__name__'?'id':String(value);
 if(!Object.hasOwn(priceColumns,name)||name==='payload')throw Error(`Unsupported price query field: ${name}`);
 return name;
}
export function literal(value:unknown):string{
 if(value instanceof Timestamp)return String(timestampNanos(value));
 if(typeof value==='string')return quote(value);
 if(typeof value==='number'&&Number.isFinite(value))return String(value);
 if(typeof value==='boolean')return String(value);
 if(value===null)return 'NULL';
 throw Error('Unsupported price query value');
}
export function compileQuery(steps:Step[]){
 const filters:string[]=[],orders:Array<{field:string;direction:'asc'|'desc'}>=[];
 let limit=10000,selection:string[]|undefined;
 for(const step of steps){
  const [a,b,c]=step.args;
  if(step.method==='where'){
   const name=field(a),column=`"${name}"`;
   const op=String(b);
   if(op==='in'){
    if(!Array.isArray(c)||!c.length||c.length>1000)throw Error('Invalid price IN filter');
    filters.push(`${column} IN (${c.map(literal).join(',')})`);
   }else{
    if(!['==','!=','<','<=','>','>='].includes(op))throw Error('Unsupported price query operator');
    filters.push(c===null?`${column} IS ${op==='!='?'NOT ':''}NULL`:`${column} ${op==='=='?'=':op} ${literal(c)}`);
   }
  }else if(step.method==='orderBy'){
   if(b!==undefined&&b!=='asc'&&b!=='desc')throw Error('Invalid price order');
   orders.push({field:field(a),direction:(b??'asc') as 'asc'|'desc'});
  }else if(step.method==='limit'){
   if(!Number.isSafeInteger(a)||Number(a)<1||Number(a)>10000)throw Error('Price query must be bounded to 10000 rows');
   limit=Number(a);
  }else if(step.method==='select')selection=step.args.map(field);
  else if(!['startAfter','startAt','endBefore','endAt'].includes(step.method))throw Error(`Unsupported price query: ${step.method}`);
 }
 if(!orders.length){
  const inequalities=steps.filter(s=>s.method==='where'&&['<','<=','>','>=','!='].includes(String(s.args[1]))).map(s=>field(s.args[0]));
  for(const name of [...new Set(inequalities)].sort())orders.push({field:name,direction:'asc'});
 }
 if(!orders.some(order=>order.field==='id'))orders.push({field:'id',direction:orders.at(-1)?.direction??'asc'});
 for(const {field:name} of orders)filters.push(`"${name}" IS NOT NULL`);
 for(const step of steps.filter(s=>['startAfter','startAt','endBefore','endAt'].includes(s.method))){
  const first=step.args[0] as {id?:string;get?:(name:string)=>unknown};
  const values=first?.get?orders.map(o=>o.field==='id'?first.id:first.get!(o.field)):step.args;
  if(!values.length||values.length>orders.length)throw Error('Invalid price cursor');
  const after=step.method.startsWith('start'),inclusive=step.method==='startAt'||step.method==='endAt';
  const terms=values.map((value,i)=>{
   const equal=values.slice(0,i).map((v,n)=>`"${orders[n].field}" = ${literal(v)}`);
   const greater=after===(orders[i].direction==='asc');
   return '('+[...equal,`"${orders[i].field}" ${greater?'>':'<'}${inclusive&&i===values.length-1?'=':''} ${literal(value)}`].join(' AND ')+')';
  });
  filters.push('('+terms.join(' OR ')+')');
 }
 const compare=(left:Row,right:Row)=>{
  for(const o of orders){
   const a=o.field==='id'?left.id:left.data[o.field],b=o.field==='id'?right.id:right.data[o.field];
   const av=a instanceof Timestamp?timestampNanos(a):a,bv=b instanceof Timestamp?timestampNanos(b):b;
   if(av===bv)continue;return (av<bv?-1:1)*(o.direction==='asc'?1:-1);
  }return 0;
 };
 return {where:filters.length?filters.join(' AND '):'TRUE',order:orders.map(o=>`"${o.field}" ${o.direction}`).join(','),limit,selection,compare};
}
