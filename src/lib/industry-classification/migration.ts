import {assignedClassificationCodes,taxonomyCatalog} from './catalog';

/** Pure, repeatable conversion. No changes to identity, assignment source or deletion state. */
export function classificationCodesPatch(data: Record<string,unknown>) {
  if(data.isDeleted===true)return null;
  if(data.taxonomy!=='SIC' && data.taxonomy!=='CNI') return null;
  if(!Array.isArray(data.classification) || !data.classification.length) return null;
  const classification=assignedClassificationCodes(data.taxonomy,data.classification);
  if(JSON.stringify(classification)===JSON.stringify(data.classification))return null;
  const metadata=data.classificationMetadata;
  return {classification,...(metadata && typeof metadata==='object' && !Array.isArray(metadata)
    ? {classificationMetadata:{...metadata,catalogVersion:taxonomyCatalog(data.taxonomy).version}}:{})};
}
