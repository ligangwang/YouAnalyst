import { type Period, type MetricPeriod, validDate } from "./model";

const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
export function datesInEvidence(text: string) {
  const dates = new Set<string>();
  for (const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) if (validDate(match[0])) dates.add(match[0]);
  for (const match of text.matchAll(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)) {
    const value = `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`; if (validDate(value)) dates.add(value);
  }
  for (const match of text.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sep\.?|Sept\.?|Oct\.?|Nov\.?|Dec\.?)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/gi)) {
    const month = months.findIndex(value => value.startsWith(match[1].replace('.', '').toLowerCase()));
    const value = `${match[3]}-${String(month+1).padStart(2,'0')}-${match[2].padStart(2,'0')}`;
    if (month >= 0 && validDate(value)) dates.add(value);
  }
  return dates;
}
export function assertEnglishFiscalLabel(companyId: string, period: Period, heading: string, periodEvidence: string) {
  if (period.type !== 'quarter') throw new Error('US pilot results require a quarter-specific adapter; YTD/annual relabelling is unsupported');
  const candidates: { index: number; year: number; quarter: number }[] = [];
  for (const match of heading.matchAll(/\b(first|second|third|fourth)\s+quarter(?:\s+of)?(?:\s+fiscal)?\s+(20\d{2})/gi)) candidates.push({index:match.index!,year:Number(match[2]),quarter:['first','second','third','fourth'].indexOf(match[1].toLowerCase())+1});
  for (const match of heading.matchAll(/\bQ([1-4])\s*(?:FY|fiscal)\s*(\d{2}|20\d{2})\b/gi)) candidates.push({index:match.index!,year:match[2].length===2?2000+Number(match[2]):Number(match[2]),quarter:Number(match[1])});
  for (const match of heading.matchAll(/Fiscal year\s*\|?\s*(20\d{2})[^]*?Quarter\s*\|?\s*([1-4])\b/gi)) candidates.push({index:match.index!,year:Number(match[1]),quarter:Number(match[2])});
  const label = candidates.sort((a,b)=>a.index-b.index)[0];
  if (label) {
    if (label.year!==period.fiscalYear || label.quarter!==period.fiscalQuarter) throw new Error('Fiscal year/quarter conflicts with English report heading');
  } else if (companyId==='US:BABA') {
    // Alibaba's reviewed reporting calendar ends March 31; its releases name
    // the calendar ending month instead of an explicit fiscal-quarter number.
    const year=Number(period.end.slice(0,4)),month=Number(period.end.slice(5,7));
    const fiscalYear=month<=3?year:year+1, quarter=((Math.ceil(month/3)+2)%4)+1;
    if(fiscalYear!==period.fiscalYear||quarter!==period.fiscalQuarter)throw new Error('Period conflicts with reviewed Alibaba fiscal calendar');
  } else throw new Error('English fiscal label is not established');
  if (!datesInEvidence(periodEvidence).has(period.end)) throw new Error('Period end is not established by dated source evidence');
}

export function assertChineseReportPeriod(period: Period, title: string, periodEvidence: string) {
  const labels = (text: string) => [...text.matchAll(/(20\d{2})\s*年\s*(半年度|第?一季度|第?三季度|年度)/g)];
  const titleLabels = labels(title), evidenceLabels = labels(periodEvidence);
  if (!titleLabels.length || !evidenceLabels.length) throw new Error('Chinese period needs a recognized report title and literal period evidence');
  for (const label of [...titleLabels, ...evidenceLabels]) {
    const year = Number(label[1]), name = label[2];
    const type = name === '半年度' ? 'half_year' : name === '年度' ? 'annual' : name.includes('一') ? 'quarter' : 'nine_month_ytd';
    const end = `${year}-${name === '半年度' ? '06-30' : name === '年度' ? '12-31' : name.includes('一') ? '03-31' : '09-30'}`;
    if (period.fiscalYear !== year || period.type !== type || period.start !== `${year}-01-01` || period.end !== end || (type === 'quarter' && period.fiscalQuarter !== 1)) throw new Error('Period conflicts with Chinese report title or evidence');
  }
}

export function assertGuidancePeriod(period: MetricPeriod, text: string) {
  if (period.type !== "quarter") throw new Error("Separate guidance target type needs a supported pilot adapter");
  const labels: {year:number;quarter:number}[]=[];
  for (const match of text.matchAll(/\b(first|second|third|fourth)\s+quarter(?:\s+of)?(?:\s+fiscal)?\s+(20\d{2})/gi)) labels.push({year:Number(match[2]),quarter:["first","second","third","fourth"].indexOf(match[1].toLowerCase())+1});
  for (const match of text.matchAll(/\bQ([1-4])\s*(?:FY|fiscal)\s*(\d{2}|20\d{2})\b/gi)) labels.push({year:match[2].length===2?2000+Number(match[2]):Number(match[2]),quarter:Number(match[1])});
  for (const match of text.matchAll(/\|\s*(20\d{2})\s*\|\s*([1-4])\b/g)) labels.push({year:Number(match[1]),quarter:Number(match[2])});
  for (const match of text.matchAll(/(20\d{2})\s*年\s*第?([一二三四1234])\s*季度/g)) labels.push({year:Number(match[1]),quarter:/[1-4]/.test(match[2])?Number(match[2]):"一二三四".indexOf(match[2])+1});
  if (!labels.length || labels.some(label=>label.year!==period.fiscalYear||label.quarter!==period.fiscalQuarter)) throw new Error("Guidance fiscal target conflicts with or is absent from its evidence");
  const dates=datesInEvidence(text);
  if (period.start!==null && (!dates.has(period.start)||!dates.has(period.end!))) throw new Error("Guidance dates require explicit date evidence; use null when only fiscal labels are known");
}
