import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {runSerialPull,type PullTransport,type PullDelivery} from '../../src/lib/serial-pull';

const delivery=(id:string):PullDelivery=>({ackId:id,message:{data:Buffer.from(JSON.stringify({id})).toString('base64')}});

test('pull does not prefetch while processing and acknowledges only completed work',async()=>{
  const stop=new AbortController(),events:string[]=[];let pulls=0,active=false;
  const transport:PullTransport={
    async pull(){assert.equal(active,false);pulls++;return delivery(String(pulls));},
    async deadline(id,seconds){events.push(`lease:${id}:${seconds}`);},
    async acknowledge(id){assert.equal(active,false);events.push(`ack:${id}`);if(id==='2')stop.abort();},
  };
  await runSerialPull({transport,signal:stop.signal,error:()=>assert.fail('unexpected error'),async process(data){
    active=true;const id=(data as {id:string}).id;events.push(`work:${id}`);await delay(5);active=false;events.push(`done:${id}`);
  }});
  assert.equal(pulls,2);
  assert.deepEqual(events,['lease:1:600','work:1','done:1','ack:1','lease:2:600','work:2','done:2','ack:2']);
});

test('failed work and uncertain acknowledgements release the message for retry, never claim success',async()=>{
  for(const failAt of ['work','ack']){
    const stop=new AbortController();const leases:number[]=[],errors:string[]=[];let acks=0;
    await runSerialPull({signal:stop.signal,pause:async()=>{stop.abort();},
      error:(_stage,error)=>{errors.push((error as Error).message);},
      transport:{pull:async()=>delivery('one'),deadline:async(_id,seconds)=>{leases.push(seconds);},
        acknowledge:async()=>{acks++;if(failAt==='ack')throw Error('uncertain ack');}},
      process:async()=>{if(failAt==='work')throw Error('work failed');},
    });
    assert.deepEqual(leases,[600,0]);assert.equal(acks,failAt==='ack'?1:0);assert.equal(errors.length,1);
  }
});

test('lease renewal failure cancels work and prevents acknowledgement',async()=>{
  const stop=new AbortController();let renewals=0,acked=false,cancelled=false;
  await runSerialPull({signal:stop.signal,renewMs:5,pause:async()=>{stop.abort();},error:()=>{},
    transport:{pull:async()=>delivery('one'),acknowledge:async()=>{acked=true;},
      deadline:async(_id,seconds)=>{if(seconds===600&&++renewals>1)throw Error('lease lost');}},
    process:async(_data,signal)=>{await delay(30,undefined,{signal}).catch(()=>{cancelled=true;});},
  });
  assert(cancelled);assert.equal(acked,false);assert.equal(renewals,2);
});

test('shutdown interrupts work without acknowledging and does not pull again',async()=>{
  const stop=new AbortController();let pulls=0,acked=false;const leases:number[]=[];
  await runSerialPull({signal:stop.signal,error:()=>{},
    transport:{pull:async()=>{pulls++;return delivery('one');},acknowledge:async()=>{acked=true;},deadline:async(_id,seconds)=>{leases.push(seconds);}},
    process:async(_data,signal)=>{stop.abort();signal.throwIfAborted();},
  });
  assert.equal(pulls,1);assert.equal(acked,false);assert.deepEqual(leases,[600,0]);
});

test('empty pulls and transport failures back off without touching message state',async()=>{
  for(const fail of [false,true]){
    const stop=new AbortController();let polls=0,pauses=0,errors=0;
    await runSerialPull({signal:stop.signal,error:()=>{errors++;},pause:async()=>{pauses++;stop.abort();},
      transport:{pull:async()=>{polls++;if(fail)throw Error('unavailable');return undefined;},
        acknowledge:async()=>assert.fail(),deadline:async()=>assert.fail()},process:async()=>assert.fail(),
    });
    assert.equal(polls,1);assert.equal(pauses,1);assert.equal(errors,fail?1:0);
  }
});

test('malformed messages are nacked without starting provider work',async()=>{
  const stop=new AbortController();let ran=false,acked=false;const deadlines:number[]=[];
  await runSerialPull({signal:stop.signal,error:()=>{},pause:async()=>{stop.abort();},
    transport:{pull:async()=>({ackId:'bad',message:{data:Buffer.from('not json').toString('base64')}}),
      acknowledge:async()=>{acked=true;},deadline:async(_id,seconds)=>{deadlines.push(seconds);}},
    process:async()=>{ran=true;},
  });
  assert.equal(ran,false);assert.equal(acked,false);assert.deepEqual(deadlines,[600,0]);
});
