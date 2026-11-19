import { Storage, type Bucket } from '@google-cloud/storage';
import { CN_COMPANY_ID } from '../knowledge-graph/cn-companies';

export type AnnualStatus = {outcome: 'ready' | 'retry'; checkedAtMs: number; retryAfter: number; lastError: string | null};
type Snapshot = {generation: string; status?: AnnualStatus};

export function annualStatusStore(bucket: Bucket) {
  function name(id: string) {
    if (!CN_COMPANY_ID.test(id)) throw Error('Invalid annual status company');
    return `worker-state/v1/cn-annual/${id}.json`;
  }
  return {
    async read(id: string): Promise<Snapshot> {
      const path = name(id);
      for (let attempt = 0; attempt < 4; attempt++) {
        let generation: string;
        try { generation = String((await bucket.file(path).getMetadata())[0].generation); }
        catch (error) { if (Number((error as {code?:number}).code) === 404) return {generation:'0'}; throw error; }
        try {
          const [bytes] = await bucket.file(path, {generation}).download();
          const status = JSON.parse(bytes.toString()) as AnnualStatus;
          if (!['ready','retry'].includes(status.outcome) || !Number.isFinite(status.checkedAtMs) || !Number.isFinite(status.retryAfter))
            throw Error('Invalid annual refresh status');
          return {generation, status};
        } catch (error) { if (Number((error as {code?:number}).code) !== 404) throw error; }
      }
      throw Error('Annual refresh status changed repeatedly');
    },
    async write(id: string, generation: string, status: AnnualStatus) {
      await bucket.file(name(id)).save(JSON.stringify(status), {resumable:false,
        metadata:{contentType:'application/json',cacheControl:'private, no-store'},preconditionOpts:{ifGenerationMatch:generation}});
    },
  };
}

export function configuredAnnualStatusStore() {
  const bucket = process.env.ENTITY_SNAPSHOT_BUCKET || process.env.EODHD_BULK_EOD_BUCKET;
  if (!bucket) throw Error('Missing financial worker bucket');
  return annualStatusStore(new Storage().bucket(bucket));
}
