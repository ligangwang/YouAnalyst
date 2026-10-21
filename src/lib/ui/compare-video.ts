import { COMPARE_COLORS, COMPARE_LIGHT_COLORS, returnLabel, type CompareData, type CompareStyle } from '../compare';
import { comparisonFrame } from '../compare-chart';

type VideoOptions = { data: CompareData; style: CompareStyle; colors?: string[]; seconds: number; light: boolean; chinese: boolean; signal: AbortSignal; onProgress: (progress: number) => void };

// Draw from the same frame model as the interactive chart. HTML labels and branding
// are painted here too, so the downloaded video is complete without DOM screenshots.
export function drawComparisonVideoFrame(ctx: CanvasRenderingContext2D, data: CompareData, style: CompareStyle, progress: number, light: boolean, chinese: boolean, customColors?: string[]) {
  const width = 1280, height = 720, chartWidth = 1152, chartHeight = 510;
  const foreground = light ? '#142536' : '#f8fafc', muted = light ? '#475f73' : '#9ba8b7';
  const colors = customColors ?? (light ? COMPARE_LIGHT_COLORS : COMPARE_COLORS);
  const frame = comparisonFrame(data, progress, style, chartWidth, chartHeight);
  ctx.fillStyle = light ? '#f4f7fa' : '#07111d'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = foreground; ctx.font = '600 30px sans-serif';
  ctx.fillText('PRICE RETURN', 48, 52);
  ctx.font = '600 22px sans-serif'; ctx.fillText(data.dates[frame.index], 48, 88);
  ctx.textAlign = 'right'; ctx.fillStyle = muted; ctx.font = '600 22px sans-serif'; ctx.fillText('YouAnalyst', width - 48, 52); ctx.textAlign = 'left';
  ctx.save(); ctx.translate(48, 112);
  ctx.font = '14px sans-serif'; ctx.strokeStyle = light ? '#ccd7e1' : '#ffffff26'; ctx.fillStyle = muted; ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const value = frame.low + (frame.high - frame.low) * i / 4, position = frame.scale(value);
    ctx.beginPath();
    if (style === 'bar') { ctx.moveTo(position, frame.top); ctx.lineTo(position, frame.bottom); ctx.fillText(`${value.toFixed(0)}%`, position - 14, frame.bottom + 24); }
    else { ctx.moveTo(frame.left, position); ctx.lineTo(frame.right, position); ctx.fillText(`${value.toFixed(0)}%`, 0, position + 5); }
    ctx.stroke();
  }
  ctx.strokeStyle = light ? '#526a7d' : '#94a3b8'; ctx.beginPath();
  if (style === 'bar') { ctx.moveTo(frame.scale(0), frame.top); ctx.lineTo(frame.scale(0), frame.bottom); }
  else { ctx.moveTo(frame.left, frame.scale(0)); ctx.lineTo(frame.right, frame.scale(0)); }
  ctx.stroke();
  data.series.forEach((series, i) => {
    ctx.fillStyle = colors[i]; ctx.strokeStyle = colors[i]; ctx.lineWidth = 3;
    if (style === 'bar') {
      const zero = frame.scale(0), end = frame.scale(frame.values[i]), barHeight = Math.min(28, (frame.bottom - frame.top) / data.series.length * .6);
      ctx.fillRect(Math.min(zero, end), frame.labels[i].y - barHeight / 2, Math.max(1, Math.abs(end - zero)), barHeight);
    } else {
      ctx.beginPath();
      for (let j = 0; j <= frame.index; j++) {
        const x = frame.left + j / (data.dates.length - 1) * (frame.right - frame.left), y = frame.scale(series.values[j]);
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.lineTo(frame.left + progress * (frame.right - frame.left), frame.scale(frame.values[i])); ctx.stroke();
    }
    const label = frame.labels[i], x = style === 'bar' ? 0 : label.x;
    ctx.font = '600 14px sans-serif'; ctx.fillText(series.symbol.replace(/^(XSHG|XSHE):/, ''), x, label.y - (style === 'bar' ? -5 : 3));
    ctx.font = '14px sans-serif'; ctx.fillText(returnLabel(label.value), style === 'bar' ? frame.right + 10 : x, label.y + (style === 'bar' ? 5 : 15));
  });
  ctx.restore(); ctx.fillStyle = muted; ctx.font = '16px sans-serif';
  ctx.fillText(`${data.dates[0]} → ${data.dates.at(-1)}`, 48, 654);
  ctx.textAlign = 'right'; ctx.fillText('youanalyst.com', width - 48, 686); ctx.textAlign = 'left';
}

export async function recordComparisonVideo(options: VideoOptions): Promise<Blob> {
  const { data, style, seconds, light, chinese, signal, onProgress } = options;
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) throw new Error('unsupported');
  if (data.dates.length < 2 || !data.series.length || ![10, 15, 30].includes(seconds)) throw new Error('invalid');
  const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('unsupported');
  drawComparisonVideoFrame(ctx, data, style, 0, light, chinese, options.colors);
  const stream = canvas.captureStream(30);
  let recorder: MediaRecorder | undefined;
  for (const mimeType of ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (!MediaRecorder.isTypeSupported(mimeType)) continue;
    try { recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 }); break; } catch { /* Try the next supported encoder. */ }
  }
  if (!recorder) { stream.getTracks().forEach(track => track.stop()); throw new Error('unsupported'); }
  const encoder = recorder;
  return new Promise((resolve, reject) => {
    const chunks: Blob[] = [];
    let frame = 0, settled = false, completed = false, started = 0;
    const cleanup = () => {
      cancelAnimationFrame(frame); clearTimeout(watchdog);
      signal.removeEventListener('abort', abort); document.removeEventListener('visibilitychange', visibility);
      encoder.ondataavailable = null; encoder.onstop = null; encoder.onerror = null;
      if (encoder.state !== 'inactive') encoder.stop();
      stream.getTracks().forEach(track => track.stop());
    };
    const fail = (reason: Error) => { if (settled) return; settled = true; cleanup(); reject(reason); };
    const abort = () => fail(new DOMException('Cancelled', 'AbortError'));
    const visibility = () => { if (document.hidden) fail(new Error('hidden')); };
    const watchdog = setTimeout(() => fail(new Error('timeout')), (seconds + 15) * 1000);
    signal.addEventListener('abort', abort, { once: true }); document.addEventListener('visibilitychange', visibility);
    encoder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    encoder.onerror = () => fail(new Error('encoding'));
    encoder.onstop = () => {
      if (settled) return;
      if (!completed) { fail(new Error('encoding')); return; }
      const blob = new Blob(chunks, { type: encoder.mimeType });
      if (!blob.size) { fail(new Error('empty')); return; }
      settled = true; cleanup(); onProgress(1); resolve(blob);
    };
    function advance(now: number) {
      if (settled) return;
      if (!started) started = now;
      const elapsed = now - started;
      try {
        // Hold the opening and final frames for half a second each.
        drawComparisonVideoFrame(ctx!, data, style, Math.max(0, Math.min(1, (elapsed - 500) / (seconds * 1000 - 1000))), light, chinese, options.colors);
        onProgress(Math.min(.99, elapsed / (seconds * 1000)));
        if (elapsed >= seconds * 1000) { completed = true; encoder.stop(); } else frame = requestAnimationFrame(advance);
      } catch { fail(new Error('rendering')); }
    }
    try {
      if (signal.aborted) { abort(); return; }
      if (document.hidden) { visibility(); return; }
      encoder.start(250); frame = requestAnimationFrame(advance);
    } catch { fail(new Error('encoding')); }
  });
}
