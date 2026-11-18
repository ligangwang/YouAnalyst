import {AsyncLocalStorage} from 'node:async_hooks';

declare global { var __companySearchReadsV1: AsyncLocalStorage<boolean> | undefined; }
export const searchEntityReads = globalThis.__companySearchReadsV1 ??= new AsyncLocalStorage<boolean>();
