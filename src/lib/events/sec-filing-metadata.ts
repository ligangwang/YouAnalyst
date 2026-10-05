/** Link collection accepts every SEC form; this taxonomy does not gate ingestion. */
export type SecFilingCategory = 'periodic_report'|'current_report'|'insider_ownership'|'major_ownership'|'proxy'|'offering'|'merger_tender'|'late_filing'|'other';

export function secFilingCategory(form:string):SecFilingCategory {
  const base=form.replace(/\/A$/,'');
  if (/^(?:10-K|10-Q|20-F|40-F)$/.test(base)) return 'periodic_report';
  if (/^(?:8-K|6-K)$/.test(base)) return 'current_report';
  if (/^(?:3|4|5|144)$/.test(base)) return 'insider_ownership';
  if (/^(?:SC|SCHEDULE) 13[DG]$/.test(base)) return 'major_ownership';
  if (/^(?:S-4|F-4|425|SC TO-[ITC]|SC 14D9|(?:PRE|DEF)[MC]14A)$/.test(base)) return 'merger_tender';
  if (/^(?:(?:PRE|DEF).*14[AC]|PX14A.*)$/.test(base)) return 'proxy';
  if (/^(?:[SF]-\d.*|424[A-Z]\d*|FWP|EFFECT)$/.test(base)) return 'offering';
  if (/^NT (?:10-K|10-Q|20-F|40-F)$/.test(base)) return 'late_filing';
  return 'other';
}

export const SEC_FILING_DESCRIPTIONS:Record<SecFilingCategory,string> = {
  periodic_report:'Periodic financial report.', current_report:'Current company disclosure.',
  insider_ownership:'Insider ownership, transaction or proposed sale disclosure.',
  major_ownership:'Major shareholder beneficial ownership disclosure.',
  proxy:'Shareholder voting and proxy disclosure.', offering:'Securities registration or offering disclosure.',
  merger_tender:'Merger, acquisition or tender offer disclosure.', late_filing:'Notice of a delayed periodic report.',
  other:'Official SEC filing.',
};

/** SEC supplies XSL subdirectories for ownership forms. Reject traversal and URL syntax. */
export function safeSecDocumentPath(value:unknown):value is string {
  return typeof value==='string'&&value.length>0&&value.length<=500&&value.split('/').every(segment=>
    segment!=='.'&&segment!=='..'&&/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(segment));
}

/** Some SEC notices have no primary document; the accession index still exposes the filing. */
export function secFilingLink(cik:string,accession:string,document:string) {
  if(!/^\d{10}$/.test(cik)||Number(cik)===0||!/^\d{10}-\d{2}-\d{6}$/.test(accession)
    ||document!==''&&!safeSecDocumentPath(document))throw new Error('Invalid SEC filing link');
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-','')}/${document||`${accession}-index.html`}`;
}
