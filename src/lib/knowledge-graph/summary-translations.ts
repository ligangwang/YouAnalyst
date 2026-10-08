export type SummaryTranslation={source:string;text:string;translatedAt?:string};
/** Never use a stored translation after its source description has changed. */
export function translatedSummary(source:string,translation:unknown):string|undefined{
  if(!translation||typeof translation!=='object')return undefined;
  const value=translation as Partial<SummaryTranslation>;
  return value.source===source&&typeof value.text==='string'&&value.text.trim()?value.text.trim():undefined;
}
