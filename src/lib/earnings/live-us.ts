import { datesInEvidence } from "./dates";
import { validateSource } from "./document";
import { classifyEarningsTitle } from "./discovery";
import { extractEarnings, type ExtractionPlan, type MetricRule } from "./extract";
import { sha256, validDate, validatePeriod, type Period, type RawEarningsDocument } from "./model";

// Reviewed release formats, not a general document/LLM extractor. A changed
// heading, column order, currency, or fiscal calendar requires adapter review.
// The three domestic issuers present $ amounts in USD; Alibaba's native RMB
// column is selected explicitly, never its convenience US$ translation.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH = `(?:${MONTHS.join("|")})`;
const DATE = `${MONTH}\\s+\\d{1,2},?\\s+20\\d{2}`;
const QUARTERS = ["first", "second", "third", "fourth"];
const DAY = 86_400_000;
const clean = (value: string) => value.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
const cells = (line: string) => line.replace(/\s*\|\s*(%)/g, "$1").split("|").map(value => value.trim()).filter(Boolean);
function requireMatch(value: unknown): asserts value { if (!value) throw new Error("Unsupported US earnings release shape"); }
function one(text: string, expression: RegExp) {
  const matches = [...text.matchAll(expression)];
  requireMatch(matches.length === 1);
  return matches[0];
}
function literalDate(text: string) {
  const dates = [...datesInEvidence(text)];
  requireMatch(dates.length === 1);
  return dates[0];
}
function announcementByline(document: RawEarningsDocument, period: Period): Pick<ExtractionPlan, "announcementDate" | "announcementDateEvidence"> {
  const date = `(?:${MONTH}|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sep\\.?|Sept\\.?|Oct\\.?|Nov\\.?|Dec\\.?)\\s+\\d{1,2},?\\s+20\\d{2}\\b`;
  const dash = "[,—–―-]";
  const patterns: Record<string, string[]> = {
    "US:NVDA": [
      `SANTA\\s+CLARA,\\s*Calif\\.\\s*${dash}\\s*${date}(?=\\s*${dash}\\s*NVIDIA\\b)`,
      // Issuer Newsroom prints the release date on its own line directly above
      // the actual-results opening. Nearby calendar/table dates do not qualify.
      `(?:^|\\n)${date}\\s*\\n\\s*NVIDIA\\s*\\(NASDAQ:\\s*NVDA\\)\\s+today\\s+reported\\b`,
    ],
    "US:AMD": [`SANTA\\s+CLARA,\\s*Calif\\.\\s*${dash}\\s*${date}(?=\\s*(?:\\(GLOBE NEWSWIRE\\)\\s*)?${dash}{1,2}\\s*AMD\\b)`],
    "US:MSFT": [`REDMOND,\\s*Wash\\.\\s*${dash}\\s*${date}(?=\\s*${dash}\\s*Microsoft\\s+Corp\\.)`],
    "US:BABA": [`Hong\\s+Kong,\\s*China,\\s*${date}(?=\\s*${dash}\\s*Alibaba\\s+Group\\s+Holding\\s+Limited\\b)`],
  };
  const candidates = (patterns[document.source.companyId] ?? []).flatMap(pattern =>
    [...document.text.slice(0, 6000).matchAll(new RegExp(pattern, "gim"))]);
  if (candidates.length !== 1) return {};
  const evidence = candidates[0][0].trim(), dates = [...datesInEvidence(evidence)];
  if (dates.length !== 1 || dates[0] < period.end || dates[0] > document.retrievedAt.slice(0, 10)) return {};
  // A source date is not an instant. Do not derive it from SEC metadata or alter
  // the separately preserved publication and filing-acceptance fields.
  return { announcementDate: dates[0], announcementDateEvidence: evidence };
}
function fiscalLabel(text: string) {
  const matches = [...text.slice(0, 10_000).matchAll(/\b(first|second|third|fourth)\s+quarter(?:\s+of)?(?:\s+fiscal(?:\s+year)?)?\s+(20\d{2})\b/gi)];
  requireMatch(matches.length);
  const match = matches[0];
  return { fiscalYear: Number(match[2]), fiscalQuarter: QUARTERS.indexOf(match[1].toLowerCase()) + 1, evidence: match[0] };
}
function calendarPeriod(end: string, companyId: "US:MSFT" | "US:BABA"): Period {
  const [year, month, day] = end.split("-").map(Number);
  requireMatch([3, 6, 9, 12].includes(month) && new Date(Date.UTC(year, month, 0)).getUTCDate() === day);
  const offset = companyId === "US:MSFT" ? 6 : 3;
  return { start: `${year}-${String(month - 2).padStart(2, "0")}-01`, end, type: "quarter",
    fiscalYear: month > offset ? year + 1 : year,
    fiscalQuarter: ((month / 3 + (companyId === "US:MSFT" ? 1 : 2)) % 4) + 1 };
}
function fiscalWindow(end: string, fiscalYear: number, fiscalQuarter: number, companyId: "US:NVDA" | "US:AMD") {
  const month = companyId === "US:AMD" ? fiscalQuarter * 3 : fiscalQuarter === 4 ? 1 : fiscalQuarter * 3 + 1;
  const year = companyId === "US:NVDA" && fiscalQuarter < 4 ? fiscalYear - 1 : fiscalYear;
  const nominal = Date.UTC(year, month, 0);
  requireMatch(Math.abs(Date.parse(end) - nominal) <= 10 * DAY);
}
function ended(text: string) {
  // Dated actual-results prose, before the outlook and before historical tables.
  const match = new RegExp(`\\b(?:first |second |third |fourth )?quarter ended\\s+(${DATE})`, "i").exec(text.slice(0, 12_000));
  requireMatch(match);
  return { end: literalDate(match[1]), evidence: match[0] };
}
function currentAndPrior(text: string, anchor: RegExp) {
  const start = one(text, anchor);
  const block = text.slice(start.index!, start.index! + 1800);
  const header = /Three Months Ended[^\n]*\n\s*\n?([^\n]+)(?:\n\s*\n?([^\n]+))?/i.exec(block);
  requireMatch(header);
  let dates = [...header[1].matchAll(new RegExp(DATE, "gi"))].map(match => literalDate(match[0]));
  if (!dates.length) {
    // EDGAR splits NVIDIA's month/day and year across consecutive table rows.
    const monthDays = [...header[1].matchAll(new RegExp(`${MONTH}\\s+\\d{1,2},?`, "gi"))];
    const years = [...(header[2] ?? "").matchAll(/\b20\d{2}\b/g)];
    requireMatch(monthDays.length >= 2 && monthDays.length === years.length);
    dates = monthDays.map((match, index) => literalDate(`${match[0]} ${years[index][0]}`));
  }
  requireMatch(dates.length >= 2);
  const days = (Date.parse(dates[0]) - Date.parse(dates[1])) / DAY;
  requireMatch(days >= 70 && days <= 110);
  return { end: dates[0], start: new Date(Date.parse(dates[1]) + DAY).toISOString().slice(0, 10), evidence: header[0], unitContext: block.slice(0, header.index) };
}
type Row = { line: string; prefix: string; header: string; sectionStart: string; sectionEnd: string };
function rowInSection(text: string, start: RegExp, end: RegExp, row: RegExp): Row {
  const marker = one(text, start), from = marker.index!;
  const last = end.exec(text.slice(from + marker[0].length));
  requireMatch(last);
  const to = from + marker[0].length + last.index;
  requireMatch(to - from <= 15_000);
  const block = text.slice(from, to), found = one(block, row);
  const rowAt = from + found.index!, line = found[0].trim();
  const prefix = /^.*?(?=\$?\(?[-+−]?\d)/.exec(line)?.[0];
  requireMatch(prefix && prefix.trim() && !/\d/.test(prefix));
  // Include preceding context so "GAAP" cannot resolve inside "Non-GAAP".
  // All strings remain literal slices; extractEarnings records their offsets.
  const sectionStart = text.slice(Math.max(0, from - 100), from + marker[0].length).trim();
  const header = text.slice(from + marker[0].length, rowAt).trim();
  requireMatch(header.length > 0 && header.length < 1900);
  return { line, prefix: prefix.trimEnd(), header, sectionStart, sectionEnd: text.slice(to, to + last[0].length).trim() };
}
function rules(row: Row, revenueIndex: number, growthIndex: number, currency: string, unitEvidence: string): MetricRule[] {
  const common = { rowLabel: row.prefix, sectionStart: row.sectionStart, sectionEnd: row.sectionEnd, header: row.header,
    kind: "actual" as const, basis: "US_GAAP" as const, scope: "consolidated" as const };
  return [
    { ...common, name: "revenue", label: "Revenue", valueIndex: revenueIndex, currency, scale: 1e6, unit: "currency", unitEvidence },
    { ...common, name: "revenue_yoy", label: "Revenue YoY", valueIndex: growthIndex, currency: null, scale: 1, unit: "percent" },
  ];
}
function money(value: string) {
  requireMatch(/^\$?\d[\d,]*(?:\.\d+)?$/.test(value));
  const amount = Number(value.replace(/[$,]/g, ""));
  requireMatch(Number.isFinite(amount) && amount > 0);
  return amount;
}
function percent(value: string) {
  requireMatch(/^(?:(?:Up|Down)\s+)?[-+]?\(?\d+(?:\.\d+)?\)?\s*%$/i.test(value));
}
function nvidia(document: RawEarningsDocument): ExtractionPlan {
  const { text } = document, label = fiscalLabel(text), dated = ended(text);
  const prior = currentAndPrior(text, /^[| ]*RECONCILIATION OF GAAP TO NON-GAAP FINANCIAL MEASURES\s*\|?\s*$/gim);
  requireMatch(dated.end === prior.end);
  const row = rowInSection(text, /^GAAP\s*\|\s*$/gm, /^Non-GAAP\s*\|\s*$/m, /^Revenue\s*\|[^\n]+/gim);
  const columns = cells(row.header), amounts = cells(row.line).slice(1);
  const q = label.fiscalQuarter, fy = label.fiscalYear, previousQ = q === 1 ? 4 : q - 1, previousFY = q === 1 ? fy - 1 : fy;
  const quarter = (value: string, expectedQ: number, expectedFY: number) => {
    const match = /^Q([1-4])\s+FY(\d{2}|20\d{2})$/i.exec(value);
    return match && Number(match[1]) === expectedQ && Number(match[2]) + (match[2].length === 2 ? 2000 : 0) === expectedFY;
  };
  requireMatch(columns.length === 6 && /^\(\$ in millions, except earnings per share\)$/i.test(columns[0])
    && quarter(columns[1], q, fy) && quarter(columns[2], previousQ, previousFY) && quarter(columns[3], q, fy - 1)
    && columns[4] === "Q/Q" && columns[5] === "Y/Y" && amounts.length === 5);
  amounts.slice(0, 3).forEach(money); amounts.slice(3).forEach(percent);
  return { kind: "actual", period: { start: prior.start, end: prior.end, type: "quarter", fiscalYear: fy, fiscalQuarter: q },
    periodEvidence: [label.evidence, dated.evidence, prior.evidence],
    periodStartDerivation: "Day following the preceding quarter end in the source's comparative three-month table",
    metrics: [...rules(row, 0, 4, "USD", columns[0]),
      { ...rules(row, 0, 4, "USD", columns[0])[1], name: "revenue_qoq", label: "Revenue QoQ", valueIndex: 3 }] };
}
function amd(document: RawEarningsDocument): ExtractionPlan {
  const { text } = document, label = fiscalLabel(text);
  const prior = currentAndPrior(text, /^CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS\s*\|?\s*$/gim);
  const row = rowInSection(text, /^GAAP Quarterly Financial Results\s*\|?\s*$/gim,
    /^Non-GAAP\s*\(\s*\*\s*\)\s*Quarterly Financial Results\s*\|?\s*$/mi, /^Revenue\s*\(\$M\)\s*\|[^\n]+/gim);
  const columns = cells(row.header).map(value => value.replace(/\s*\(\s*\d\s*\)\s*/g, "").trim()), amounts = cells(row.line).slice(1);
  const q = label.fiscalQuarter, fy = label.fiscalYear;
  const quarter = (value: string, expectedQ: number, expectedFY: number) => {
    const match = /^Q([1-4])['’](\d{2})$/.exec(value);
    return match && Number(match[1]) === expectedQ && 2000 + Number(match[2]) === expectedFY;
  };
  requireMatch(columns.length === 5 && quarter(columns[0], q, fy) && quarter(columns[1], q, fy - 1)
    && columns[2] === "Y/Y" && quarter(columns[3], q === 1 ? 4 : q - 1, q === 1 ? fy - 1 : fy) && columns[4] === "Q/Q"
    && amounts.length === 5 && Number(prior.end.slice(0, 4)) === fy);
  [amounts[0], amounts[1], amounts[3]].forEach(money); percent(amounts[2]);
  requireMatch(amounts[4] === "Flat" || /%$/.test(amounts[4]));
  if (amounts[4] !== "Flat") percent(amounts[4]);
  // $M in the summary row and the detailed statement's millions agree.
  const units = /\((?:in )?millions[,]? except (?:per share (?:data|amounts)(?: and percentages)?)\)/i.exec(prior.unitContext);
  requireMatch(units);
  return { kind: "actual", period: { start: prior.start, end: prior.end, type: "quarter", fiscalYear: fy, fiscalQuarter: q },
    periodEvidence: [label.evidence, prior.evidence],
    periodStartDerivation: "Day following the preceding quarter end in the source's comparative three-month table",
    metrics: [...rules(row, 0, 2, "USD", units[0]),
      ...(amounts[4] === "Flat" ? [] : [{ ...rules(row, 0, 2, "USD", units[0])[1], name: "revenue_qoq" as const, label: "Revenue QoQ", valueIndex: 4 }])] };
}
function microsoft(document: RawEarningsDocument): ExtractionPlan {
  const { text } = document, label = fiscalLabel(text), dated = ended(text), period = calendarPeriod(dated.end, "US:MSFT");
  requireMatch(period.fiscalYear === label.fiscalYear && period.fiscalQuarter === label.fiscalQuarter);
  const row = rowInSection(text, /^INCOME STATEMENTS\s*\|?\s*$/gim, /^COMPREHENSIVE INCOME STATEMENTS\s*\|?\s*$/mi,
    /^Total revenue\s*\|[^\n]+/gim);
  const header = clean(row.header), year = Number(period.end.slice(0, 4)), month = MONTHS[Number(period.end.slice(5, 7)) - 1], day = Number(period.end.slice(8));
  requireMatch(header.includes(`Three Months Ended ${month} ${day},`) && /\(In millions, except per share amounts\)/i.test(header)
    && !/(?:Six|Nine|Twelve) Months Ended[^]*Three Months Ended/i.test(header));
  const years = [...header.matchAll(/\b20\d{2}\b/g)].map(match => Number(match[0]));
  requireMatch((years.length === 2 || years.length === 4) && years[0] === year && years[1] === year - 1);
  const amounts = cells(row.line).slice(1); requireMatch(amounts.length === years.length); amounts.forEach(money);
  // Precise GAAP statement revenue; reported growth from the opening quarterly
  // sentence, before annual results, segment highlights, or constant currency.
  const opening = text.slice(0, Math.min(text.indexOf("Business Highlights"), 12_000));
  requireMatch(/as compared to the corresponding period of last fiscal year/i.test(opening));
  const growth = one(opening, /(?:^|\n)[^\n]*?\bRevenue was\s+\$([\d,.]+)\s+billion\s+and\s+(increased|decreased)\s+(\d+(?:\.\d+)?)\s*%[^\n]*/gim);
  const stated = Number(growth[1].replaceAll(",", "")) * 1e9, precision = growth[1].split(".")[1]?.length ?? 0;
  requireMatch(Math.abs(money(amounts[0]) * 1e6 - stated) <= 0.5 * 10 ** (9 - precision));
  const unit = /\(In millions, except per share amounts\)/i.exec(row.header)!;
  const actual = rules(row, 0, 0, "USD", unit[0])[0];
  const prefix = /Revenue was/i.exec(growth[0])!;
  const sectionStart = text.slice(Math.max(0, growth.index! - 120), growth.index!).trim();
  requireMatch(sectionStart);
  return { kind: "actual", period, periodEvidence: [label.evidence, dated.evidence],
    periodStartDerivation: "Calendar-quarter start from the explicitly dated three-month reporting period",
    metrics: [actual, { name: "revenue_yoy", label: "Revenue YoY", rowLabel: prefix[0], sectionStart,
      sectionEnd: "Business Highlights", valueIndex: 1, currency: null, scale: 1, unit: "percent", kind: "actual", basis: "US_GAAP", scope: "consolidated" }] };
}
function alibaba(document: RawEarningsDocument): ExtractionPlan {
  const { text } = document, dated = ended(text), period = calendarPeriod(dated.end, "US:BABA");
  const month = MONTHS[Number(period.end.slice(5, 7)) - 1], year = Number(period.end.slice(0, 4));
  const opening = text.slice(0, 2500);
  const titles = [
    ...opening.matchAll(/^\s*Alibaba\s+Group\s+Announces\s+(March|June|September|December)\s+Quarter\s+(20\d{2})(?:\s+and\s+Fiscal\s+Year\s+(20\d{2}))?\s+Results[ \t]*$/gim),
    // This reviewed SEC exhibit is a dual quarterly/annual announcement. Its
    // headline is not permission to substitute the annual financial table.
    ...opening.matchAll(/^\s*ANNOUNCEMENT\s+OF\s+THE\s+(March|June|September|December)\s+QUARTER\s+(20\d{2})\s+RESULTS\s+AND\s+FISCAL\s+YEAR\s+(20\d{2})\s+ANNUAL\s+RESULTS[ \t]*$/gim),
  ];
  requireMatch(titles.length === 1);
  const title = titles[0];
  requireMatch(title[1].toLowerCase() === month.toLowerCase() && Number(title[2]) === year
    && (!title[3] || (month === "March" && Number(title[3]) === year)));
  if (/^\s*ANNOUNCEMENT/i.test(title[0])) requireMatch(document.source.provider === "sec" && month === "March");
  const row = rowInSection(text, new RegExp(`^\\s*${month}\\s+QUARTER\\s+SUMMARY\\s+FINANCIAL\\s+RESULTS\\s*\\|?\\s*$`, "gim"),
    /^\s*Income(?: \(Loss\))? from operations\b[^\n]*/mi, /^\s*Revenue\s+(?:\|[^\n]+|[\d,]+[^\n]*)/gim);
  const header = clean(row.header), years = [...header.matchAll(/\b20\d{2}\b/g)].map(match => Number(match[0]));
  requireMatch(header.includes(`Three months ended ${month} ${Number(period.end.slice(8))},`)
    && years.length === 2 && years[0] === year - 1 && years[1] === year && /RMB\s+RMB\s+US\$/i.test(header)
    && /YoY\s*%\s*(?:RMB RMB US\$\s*)?Change/i.test(header)
    && /\(in millions, except percentages and per share amounts\)/i.test(header));
  const values = clean(row.line).replace(/^Revenue\s+/i, "").match(/\(?[-+]?\d[\d,]*(?:\.\d+)?\)?\s*%?/g) ?? [];
  requireMatch(values.length === 4); values.slice(0, 3).forEach(value => money(value.trim())); percent(values[3].trim());
  return { kind: "actual", period, periodEvidence: [title[0], dated.evidence],
    periodStartDerivation: "Calendar-quarter start; fiscal quarter follows Alibaba's reviewed March year end",
    metrics: rules(row, 1, 3, "CNY", row.header.slice(row.header.indexOf("RMB"))) };
}

/** Micron's 52/53-week calendar is established by adjacent quarter-end dates,
 * never a calendar-month assumption. Annual columns remain separate. */
function micron(document: RawEarningsDocument): ExtractionPlan {
  const {text}=document;
  const label=one(text.slice(0,2500), /Fiscal\s+Q([1-4])\s+(20\d{2})\s+Highlights/g);
  const row=rowInSection(text,/^CONSOLIDATED STATEMENTS OF OPERATIONS\s*$/gim,/^Cost of goods sold\s*\|/mi,/^Revenue\s*\|[^\n]+/gim);
  const q=Number(label[1]),fy=Number(label[2]),prev=q===1?4:q-1;
  const expected=new RegExp(`\\|\\s*${q}(?:st|nd|rd|th) Qtr\\.\\s*\\|\\s*${prev}(?:st|nd|rd|th) Qtr\\.\\s*\\|\\s*${q}(?:st|nd|rd|th) Qtr\\.`,'i');
  requireMatch(expected.test(row.header));
  const dated=[...row.header.matchAll(new RegExp(DATE,'gi'))].map(match=>literalDate(match[0]));
  requireMatch(dated.length===3 || dated.length===5);
  requireMatch(Date.parse(dated[0])>Date.parse(dated[1]) && Date.parse(dated[1])>Date.parse(dated[2]));
  if(dated.length===5)requireMatch(dated[3]===dated[0]&&dated[4]===dated[2]&&/Year Ended/.test(row.header));
  const start=new Date(Date.parse(dated[1])+DAY).toISOString().slice(0,10);
  const period:Period={start,end:dated[0],type:'quarter',fiscalYear:fy,fiscalQuarter:q};validatePeriod(period);
  const unit=/\(In millions, except per share amounts\)/i.exec(row.header);requireMatch(unit);
  const values=cells(row.line).slice(1).filter(value=>value!=='$');
  requireMatch(values.length===dated.length && /\$/.test(row.line)); values.forEach(money);
  const summary=rowInSection(text,/^Quarterly Financial Results\s*\|?\s*$/gim,/^Gross margin\s*\|/mi,/^Revenue\s*\|[^\n]+/gim);
  requireMatch(clean(summary.header).includes(`FQ${q}-${String(fy).slice(-2)}`)&&/GAAP \(1\).*Non-GAAP \(2\)/.test(clean(summary.header)));
  const amounts=cells(summary.line).slice(1).filter(value=>value!=='$');
  requireMatch(amounts.length===6&&amounts.slice(0,3).every((value,index)=>money(value)===money(values[index])));
  return {kind:'actual',period,periodEvidence:[label[0],row.header],periodStartDerivation:'Day after the explicitly dated preceding fiscal quarter; quarterly statement column only',
    metrics:[{name:'revenue',label:'Revenue',rowLabel:row.prefix,sectionStart:row.sectionStart,sectionEnd:row.sectionEnd,header:row.header,
      currency:'USD',scale:1e6,unit:'currency',unitEvidence:unit[0],kind:'actual',basis:'US_GAAP',scope:'consolidated'}]};
}

/** Returns null for unsupported, ambiguous, non-results, or changed formats.
 * No network calls, discovery loop, model API, guessed values, or YTD subtraction.
 * Segments and guidance remain explicitly not_extracted in this bounded pilot.
 */
export function makeUsEarningsPlan(document: RawEarningsDocument): ExtractionPlan | null {
  try {
    validateSource(document.source);
    requireMatch(document.source.language === "en" && document.source.provider !== "cninfo" && document.text.length <= 5_000_000
      && document.textSha256 === sha256(document.text));
    const kind = classifyEarningsTitle(document.source.title);
    requireMatch(kind === "actual" || kind === "unknown");
    requireMatch(!/preliminary (?:financial |earnings )?results|(?:raises?|lowers?|updates?) (?:revenue )?(?:outlook|guidance)/i.test(document.text.slice(0, 10_000)));
    const adapters: Record<string, (document: RawEarningsDocument) => ExtractionPlan> = {
      "US:NVDA": nvidia, "US:AMD": amd, "US:MSFT": microsoft, "US:BABA": alibaba, "US:MU": micron,
    };
    const adapter = adapters[document.source.companyId]; requireMatch(adapter);
    const base = adapter(document);
    const plan = { ...base, ...announcementByline(document, base.period), adapterVersion: document.source.companyId === "US:BABA" ? "us-live-2" : "us-live-1" }; validatePeriod(plan.period);
    if (document.source.companyId === "US:NVDA" || document.source.companyId === "US:AMD") {
      fiscalWindow(plan.period.end, plan.period.fiscalYear, plan.period.fiscalQuarter!, document.source.companyId);
    }
    requireMatch(validDate(plan.period.end));
    // Run the shared evidence validator before returning an executable plan.
    requireMatch(extractEarnings(document, plan, document.retrievedAt).status === "extracted");
    return plan;
  } catch { return null; }
}
