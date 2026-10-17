import type {TimelinePrices} from './company-timeline';
import type {Firestore} from 'firebase-admin/firestore';
import {changeCached} from '../change-cache';
/** Historical corrections and split changes invalidate the entire requested range. */
export function cachedTimelinePrices(db:Firestore,key:string,load:()=>Promise<TimelinePrices>):Promise<TimelinePrices>{
 return changeCached(db,`timeline:${key}`,['eod_prices','corporate_actions'],load);
}
