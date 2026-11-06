type EventDocument={name?:string;status?:string};
type WriteEvent={value?:EventDocument;oldValue?:EventDocument};

// Wire fields from google/events/cloud/firestore/v1/data.proto. Unknown or
// malformed data falls back to live reads; it must never discard ready work.
function fields(bytes:Uint8Array){
  let offset=0;const result=new Map<number,Uint8Array[]>();
  const integer=()=>{
    let value=0,shift=0;
    for(;;){if(offset>=bytes.length||shift>49)throw Error('Invalid protobuf');const byte=bytes[offset++];value+=(byte&127)*2**shift;if(!(byte&128)){if(!Number.isSafeInteger(value))throw Error('Invalid protobuf integer');return value;}shift+=7;}
  };
  while(offset<bytes.length){
    const tag=integer(),field=Math.floor(tag/8),wire=tag%8;
    if(field<1||field>536870911)throw Error('Invalid protobuf field');
    if(wire===2){const size=integer();if(offset+size>bytes.length)throw Error('Truncated protobuf');result.set(field,[...(result.get(field)??[]),bytes.subarray(offset,offset+size)]);offset+=size;}
    else if(wire===0){let count=0;for(;;){if(offset>=bytes.length||++count>10)throw Error('Invalid protobuf varint');if(!(bytes[offset++]&128))break;}}
    else if(wire===1||wire===5){offset+=wire===1?8:4;if(offset>bytes.length)throw Error('Truncated protobuf');}
    else throw Error('Unsupported protobuf wire type');
  }
  return result;
}
const text=(value?:Uint8Array)=>value?Buffer.from(value).toString('utf8'):undefined;
function document(bytes:Uint8Array):EventDocument{
  const value=fields(bytes);let status:string|undefined;
  for(const entry of value.get(2)??[]){const item=fields(entry);if(text(item.get(1)?.at(-1))==='status'){const data=item.get(2)?.at(-1);status=data?text(fields(data).get(17)?.at(-1)):undefined;}}
  return {name:text(value.get(1)?.at(-1)),status};
}
function decode(body:Uint8Array,contentType:string):WriteEvent|null{
  if(!body.length)return null;
  try{
    if(contentType.includes('json')){
      const data=JSON.parse(Buffer.from(body).toString('utf8'));
      const doc=(value:unknown):EventDocument|undefined=>{
        if(!value||typeof value!=='object')return undefined;
        const item=value as {name?:unknown;fields?:{status?:{stringValue?:unknown}}};
        return {name:typeof item.name==='string'?item.name:undefined,status:typeof item.fields?.status?.stringValue==='string'?item.fields.status.stringValue:undefined};
      };
      return {value:doc(data?.value),oldValue:doc(data?.oldValue)};
    }
    if(contentType.includes('protobuf')){
      const data=fields(body),value=data.get(1)?.at(-1),oldValue=data.get(2)?.at(-1);
      return {value:value?document(value):undefined,oldValue:oldValue?document(oldValue):undefined};
    }
  }catch{/* Legacy/unknown payloads still go through the live admission check. */}
  return null;
}

export function onboardingEventDisposition(body:Uint8Array,contentType:string,project:string,id:string){
  const event=decode(body,contentType);if(!event)return 'unknown';
  const expected=`projects/${project}/databases/(default)/documents/instrument_onboarding_requests/${id}`;
  for(const value of [event.value,event.oldValue])if(value?.name&&value.name!==expected)throw Error('Onboarding document does not match event routing');
  if(!event.value&&event.oldValue?.name===expected)return 'deleted_event';
  if(event.value?.name!==expected)return 'unknown';
  if(event.value.status==='PROCESSING')return 'claim_event';
  if(event.value.status==='SUPPORTED'||event.value.status==='BLOCKED')return 'terminal_event';
  return 'ready_event';
}
