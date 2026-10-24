import {withPageEntityReads} from './company-directory';
import {withSourceCache} from './read-scope';

/** Share bounded, push-updated source subscriptions across company visitors.
 * Bulk map/search readers retain their file-backed snapshot policy. */
export const withCompanyPageReads=<T>(work:()=>Promise<T>):Promise<T>=>
  withPageEntityReads(()=>withSourceCache(work));
