/** Shared storage envelope for collected events; type identifies the payload. */
export const EVENTS_COLLECTION='events';

export type StoredEvent = {
  version:1;
  id:string;
  type:string;
  sourceType:string;
  sourceId:string;
  companyIds:string[];
  title:string;
  summary:string;
  url:string;
  publishedAt:string|null;
  publishedDate:string|null;
  firstObservedAt:string;
  baseline:boolean;
};

/** Keep distinct event kinds from colliding when they share a source URL. */
export function eventDocumentId(kind:string,sourceKey:string){
  if(!/^[a-z][a-z0-9_]*$/.test(kind)||!/^[a-f0-9]{64}$/.test(sourceKey))throw new Error('Invalid event identity');
  return `${kind}_${sourceKey}`;
}
