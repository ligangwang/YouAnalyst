import {htmlToEarningsText} from '../earnings/document';
import type {IndexedAnnual} from './disclosure-index';

/** Resolve an annual report only from a complete SEC submission for the exact
 * issuer and accession. Ambiguous/missing EX-13 documents fail closed. */
export function secIncorporatedAnnual(submission:string,cik:string,annual:IndexedAnnual):{url:string;text:string}|null {
  if(!/^\d{1,10}$/.test(cik)||Number(cik)<1||!/^\d{10}-\d{2}-\d{6}$/.test(annual.documentId)||typeof submission!=='string'||submission.length>20*1024*1024||!/<\/SEC-DOCUMENT>\s*$/i.test(submission))return null;
  const header=submission.split(/<DOCUMENT>/i,1)[0];
  const accession=header.match(/ACCESSION NUMBER:\s*([^\s]+)/i)?.[1];
  const ids=[...header.matchAll(/CENTRAL INDEX KEY:\s*(\d+)/gi)].map(match=>Number(match[1]));
  if(accession!==annual.documentId||!ids.length||ids[0]!==Number(cik))return null;
  const docs=[...submission.matchAll(/<DOCUMENT>\s*([\s\S]*?)<\/DOCUMENT>/gi)].map(match=>match[1]);
  const reports=docs.filter(doc=>/^\s*<TYPE>\s*EX-13(?:\.\d+)?\s*$/im.test(doc));
  if(reports.length!==1)return null;
  const filename=reports[0].match(/^\s*<FILENAME>\s*([^\s]+)\s*$/im)?.[1];
  const raw=reports[0].match(/<TEXT>([\s\S]*?)<\/TEXT>/i)?.[1];
  if(!filename||!/^[-\w.]+\.html?$/i.test(filename)||!raw)return null;
  const text=htmlToEarningsText(raw);
  if(text.length<1000||text.length>1_000_000)return null;
  return {url:`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${annual.documentId.replaceAll('-','')}/${filename}`,text};
}
