const financial = /\b(?:earnings|financial\s+results|quarterly\s+results|fiscal|quarter|full[\s-]year|annual\s+results)\b/i;
const call = /\b(?:earnings\s+call|conference\s+call|webcast)\b/i;
const action = /\b(?:announc(?:e|es|ed)|sets?|schedul(?:e|es|ed)|will\s+(?:host|hold|conduct)|to\s+(?:host|hold|conduct))\b/i;
const reporting = /\b(?:to|will)\s+(?:report|announce|release|publish)\b.{0,180}\b(?:results|earnings)\b/i;
const date = /\b(?:reporting\s+date|earnings\s+release\s+date|date\s+for\b.{0,100}\bresults)\b/i;

/** High-recall routing only. The original document establishes the schedule. */
export function isCalendarCandidate(title: string, summary = '') {
  const text = `${title} ${summary}`.normalize('NFKC').replace(/[–—−]/g,'-').replace(/\s+/g,' ');
  if (/(?:召开|举行|举办|延期|变更|取消).{0,80}业绩(?:说明会|交流会|电话会)|业绩(?:说明会|交流会|电话会).{0,40}(?:延期|变更|取消)/.test(text)) return true;
  if (!financial.test(text)) return false;
  if (reporting.test(text) || date.test(text) || call.test(text) && action.test(text)) return true;
  // A results release can announce a call later that same day. Fetch its body.
  return /\b(?:reports?|announces?)\b.{0,120}\b(?:results|earnings)\b/i.test(title);
}
