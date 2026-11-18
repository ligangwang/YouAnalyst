import {createHash} from 'node:crypto';
import {fieldName} from './value';
import type {MarketHead} from './files';
import type {Step} from './query';

export const DIRECTORY_INDEX_ROOT = 'company-search/v1';

export function directoryGeneration(heads: readonly Pick<MarketHead,'shard'|'revision'>[]) {
    if (heads.length !== 256) return;
    const ordered = [...heads].sort((a,b) => a.shard.localeCompare(b.shard));
    if (!ordered.every((h,i) => h.shard === i.toString(16).padStart(2,'0') && h.revision)) return;
    return createHash('sha256').update('co-located-terms-v1').update(JSON.stringify(ordered.map(h => [h.shard,h.revision]))).digest('hex');
}

export function directoryTerm(steps: readonly Step[]) {
    if (!steps.every(s => ['where','select','limit'].includes(s.method))) return;
    const limits = steps.filter(s => s.method === 'limit');
    const limit = limits[0]?.args[0];
    if (limits.length !== 1 || typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50) return;
    if (steps.filter(s => s.method === 'select').length !== 1) return;
    const where = steps.filter(s => s.method === 'where');
    if (!where.length) return;
    const [field,op,value] = where[0].args;
    if (typeof value !== 'string' || !value || value.length > 120) return;
    let prefix: string;
    if (where.length === 1 && fieldName(field) === 'searchPrefixes' && op === 'array-contains') prefix = 'n:';
    else if (where.length === 1 && fieldName(field) === 'symbolLower' && op === '==') prefix = 'e:';
    else if (where.length === 2 && fieldName(field) === 'symbolLower' && op === '>='
        && fieldName(where[1].args[0]) === 'symbolLower' && where[1].args[1] === '<=' && where[1].args[2] === value+'\uf8ff') prefix = 's:';
    else return;
    const key = prefix+value;
    return {key, value, limit, part:createHash('md5').update(value).digest('hex').slice(0,2)};
}
