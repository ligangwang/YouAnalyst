import { captureEarningsDocument, validateSource } from "./document";
import { extractEarnings, type ExtractionPlan } from "./extract";
import { emptyEarningsReplayState, stageEarningsRecord, type EarningsReplayState } from "./ledger";
import { type EarningsSource, type RawEarningsDocument, type ExtractionOutcome, sourceIdentity } from "./model";
import { classifyEarningsTitle } from "./discovery";

export type EarningsDownload = { bytes: Uint8Array; mediaType: RawEarningsDocument['mediaType']; pdfText?: string; completeness?: 'full' | 'excerpt' };
export type EarningsCollectionResult = { sourceId: string; status: 'staged' | 'duplicate' | 'review_required' | 'skipped' | 'failed'; reason?: string; capture?: Pick<RawEarningsDocument,'rawSha256'|'textSha256'|'completeness'>; outcome?: ExtractionOutcome };
/** Injection-only orchestration. A live caller must supply the existing SEC/CN
 * transports and a transactionally durable store; this module activates neither. */
export async function collectEarningsDocuments(options: {
  sources: EarningsSource[]; now: string; maxDocuments?: number; state?: EarningsReplayState;
  download: (source: EarningsSource) => Promise<EarningsDownload>;
  plan: (document: RawEarningsDocument) => Promise<ExtractionPlan | null>;
}) {
  const limit=options.maxDocuments??20;
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Invalid pilot document budget');
  let state=options.state??emptyEarningsReplayState();
  const results:EarningsCollectionResult[]=[],sources=[...new Map(options.sources.map(source=>[sourceIdentity(source),source])).values()];
  for(const source of sources.slice(0,limit)) {
    const id=sourceIdentity(source);
    try {
      validateSource(source);
      if(classifyEarningsTitle(source.title)==='calendar'){results.push({sourceId:id,status:'skipped',reason:'scheduled_announcement_is_not_results'});continue;}
      const downloaded=await options.download(source);
      const document=captureEarningsDocument(source,downloaded.bytes,{...downloaded,retrievedAt:options.now});
      const plan=await options.plan(document);
      if(!plan){results.push({sourceId:id,status:'review_required',reason:'no_reviewed_source_adapter'});continue;}
      const outcome=extractEarnings(document,plan,options.now);
      const capture={rawSha256:document.rawSha256,textSha256:document.textSha256,completeness:document.completeness};
      if(outcome.status!=='extracted'){results.push({sourceId:id,status:outcome.status,reason:outcome.reason,capture,outcome});continue;}
      const staged=stageEarningsRecord(state,outcome.record);
      state=staged.state;
      results.push({sourceId:id,status:staged.status==='predecessor_missing'?'review_required':staged.status,reason:staged.status==='predecessor_missing'?'predecessor_missing':undefined,capture,outcome});
    } catch(error) {
      results.push({sourceId:id,status:'failed',reason:error instanceof Error?error.message:'source_failed'});
    }
  }
  return {state,results,deferred:Math.max(0,sources.length-limit),complete:sources.length<=limit&&results.every(result=>['staged','duplicate','skipped'].includes(result.status))};
}
