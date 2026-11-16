import {deflateRawSync,inflateRawSync} from 'node:zlib';
import type {MarketHead} from './files';
import type {MarketCollection} from './policy';

export const pointerCollection=(collection:MarketCollection)=>'market-pointer:'+collection;
export const pointerId=(collection:MarketCollection,shard:string)=>`_market_parquet_pointer_${collection}_${shard}`;
const prefix='deflate-v1:';
/** Separate live pointers preserve compatibility with transactional readers of
 * the original heads. The existing retained field carries a lossless catalog;
 * readers expand only the shards whose operational records they actually need. */
export function compactHead(head:MarketHead):MarketHead{
    return {...head,retained:head.retained.length?[prefix+deflateRawSync(Buffer.from(JSON.stringify(head.retained)),{level:1}).toString('base64')]:[]};
}
export function pointerRetained(head:MarketHead):string[]{
    if(!head.retained.length)return [];
    if(head.retained.length!==1||!head.retained[0].startsWith(prefix))throw Error('Invalid compact market catalog');
    const packed=head.retained[0].slice(prefix.length),bytes=Buffer.from(packed,'base64');
    if(bytes.toString('base64')!==packed)throw Error('Invalid compact market encoding');
    const ids:unknown=JSON.parse(inflateRawSync(bytes,{maxOutputLength:4*1024*1024}).toString());
    if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'))throw Error('Invalid compact market identities');
    return ids;
}
