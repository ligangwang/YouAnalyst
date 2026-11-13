import {pathToFileURL} from 'node:url';

/** Releases preserve operator-selected capacity, including a later scale-down. */
export function onboardingWorkerCapacity(revision) {
  const annotations=revision?.metadata?.annotations;
  const parse=(key,lowerBound)=>{
    const raw=annotations?.[key];
    if(raw===undefined&&lowerBound===0)return 0; // Cloud Run omits minScale at zero.
    if(typeof raw!=='string'||!/^\d+$/.test(raw))throw Error(`Missing or invalid onboarding capacity: ${key}`);
    const value=Number(raw);
    if(!Number.isSafeInteger(value)||value<lowerBound||value>1000)throw Error(`Out-of-range onboarding capacity: ${key}`);
    return value;
  };
  const minimum=parse('autoscaling.knative.dev/minScale',0);
  const maximum=parse('autoscaling.knative.dev/maxScale',1);
  if(minimum>maximum)throw Error('Onboarding minimum exceeds maximum');
  return {minimum,maximum};
}

async function main(){
  let input='';for await(const chunk of process.stdin)input+=chunk;
  const {minimum,maximum}=onboardingWorkerCapacity(JSON.parse(input));
  console.log(`${minimum} ${maximum}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
