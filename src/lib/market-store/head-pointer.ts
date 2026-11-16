import type {MarketHead} from './files';
import type {MarketCollection} from './policy';

export const pointerCollection=(collection:MarketCollection)=>'market-pointer:'+collection;
export const pointerId=(collection:MarketCollection,shard:string)=>`_market_parquet_pointer_${collection}_${shard}`;
/** Separate live pointers preserve compatibility with transactional readers of
 * the original heads. A nonempty catalog is represented conservatively: reads
 * check the native overlay for requested IDs in that shard. External-only
 * projections still skip those reads. No operational identity can be omitted. */
export function compactHead(head:MarketHead):MarketHead{
    return {...head,retained:head.retained.length?['live-v1']:[]};
}
export function pointerHasRetained(head:MarketHead):boolean{
    if(!head.retained.length)return false;
    if(head.retained.length!==1||head.retained[0]!=='live-v1')throw Error('Invalid compact market catalog');
    return true;
}
