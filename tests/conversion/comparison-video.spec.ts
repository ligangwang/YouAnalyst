import { expect, test } from '@playwright/test';
import { componentFixtureHtml } from './fixtures/component-html';

const data = { dates: ['2026-01-02', '2026-02-02', '2026-03-02'], series: [{ symbol: 'NVDA', values: [0, 35, 70] }, { symbol: 'MSFT', values: [0, -10, 20] }], frequency: 'Daily', source: 'Stored closes' };
let html: string;
test.beforeAll(async () => {
  html = await componentFixtureHtml(`
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ComparisonVideoExport} from './src/components/comparison-video-export';
    import {LocaleProvider} from './src/components/providers/locale-provider';
    import {drawComparisonVideoFrame} from './src/lib/ui/compare-video';
    const params=new URLSearchParams(location.search), data=${JSON.stringify(data)};
    if(params.get('style')==='bar')data.series=Array.from({length:10},(_,i)=>({symbol:['NVDA','MSFT','AAPL','AMZN','GOOGL','META','TSLA','AMD','AVGO','XSHG:600519'][i],values:[0,35-i*7,70-i*13]}));
    document.documentElement.dataset.theme=params.get('theme')||'dark';
    window.drawFrame=(canvas,progress)=>drawComparisonVideoFrame(canvas.getContext('2d'),data,params.get('style')==='bar'?'bar':'line',progress,params.get('theme')==='light',params.has('zh'));
    createRoot(document.getElementById('root')).render(<LocaleProvider locale={params.has('zh')?'zh-CN':'en'}><ComparisonVideoExport data={data} style={params.get('style')==='bar'?'bar':'line'} onStart={()=>{}}/></LocaleProvider>);
  `, {}, 'body{font-family:Arial;background:#07111d;color:#f8fafc;--color-line:#ffffff30;--background:#07111d;--foreground:#f8fafc;--text-secondary:#aabaca}');
});

async function open(page: import('@playwright/test').Page, query = '') {
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(`http://video.test/${query}`);
}

function musicFixture() {
  const rate = 44100, samples = rate;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / rate) * 12000), 44 + i * 2);
  return { name: 'test-music.wav', mimeType: 'audio/wav', buffer: wav };
}

test('exports audible music, loops short tracks, and fades the ending', async ({ page }, info) => {
  test.setTimeout(45_000);
  const seconds = process.env.COMPARE_TEST_MUSIC ? 30 : 10;
  await page.addInitScript(() => {
    const original = URL.createObjectURL;
    URL.createObjectURL = blob => { (window as unknown as { videoBlob: Blob }).videoBlob = blob as Blob; return original(blob); };
  });
  await open(page);
  await page.getByLabel('Music file', { exact: true }).setInputFiles(process.env.COMPARE_TEST_MUSIC || musicFixture());
  await expect(page.getByLabel('Include music')).toBeChecked();
  await page.getByLabel('Video duration').selectOption(String(seconds));
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export video', exact: true }).click();
  const file = await downloading;
  await file.saveAs(info.outputPath(file.suggestedFilename()));
  const audio = await page.evaluate(async (seconds) => {
    const context = new AudioContext();
    const blob = (window as unknown as { videoBlob: Blob }).videoBlob;
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const samples = buffer.getChannelData(0);
    const rms = (start: number, end: number) => {
      const a = Math.floor(start * buffer.sampleRate), b = Math.min(samples.length, Math.floor(end * buffer.sampleRate));
      let sum = 0; for (let i = a; i < b; i++) sum += samples[i] ** 2;
      return Math.sqrt(sum / (b - a));
    };
    const result = { duration: buffer.duration, middle: rms(5, 6), end: rms(seconds - .1, seconds) };
    await context.close(); return result;
  }, seconds);
  expect(audio.duration).toBeGreaterThan(seconds - .2);
  expect(audio.middle).toBeGreaterThan(.01);
  expect(audio.end).toBeLessThan(audio.middle * .4);
  await page.screenshot({ path: info.outputPath('music-export.png') });
});

test('rejects unreadable music and can export after removing it', async ({ page }) => {
  await open(page);
  await page.getByLabel('Music file', { exact: true }).setInputFiles({ name: 'bad.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('not audio') });
  await page.getByRole('button', { name: 'Export video', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Unable to read this music file');
  await page.getByRole('button', { name: 'Remove music' }).click();
  await page.getByRole('button', { name: 'Export video', exact: true }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel export' }).click();
  await expect(page.getByRole('status')).toHaveText('Video export cancelled.');
});

for (const style of ['line', 'bar']) test(`exports a playable 720p ${style} video with the final chart frame`, async ({ page }, info) => {
  test.setTimeout(45_000);
  await page.addInitScript(() => {
    const original = URL.createObjectURL;
    URL.createObjectURL = blob => { (window as unknown as { videoBlob: Blob }).videoBlob = blob as Blob; return original(blob); };
  });
  const chinese = style === 'bar';
  if (chinese) await page.addInitScript(() => {
    const supported = MediaRecorder.isTypeSupported.bind(MediaRecorder);
    MediaRecorder.isTypeSupported = mime => mime.startsWith('video/webm') && supported(mime);
  });
  await open(page, `?style=${style}${chinese ? '&theme=light&zh=1' : ''}`);
  await page.getByLabel(chinese ? '视频时长' : 'Video duration').selectOption('10');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: chinese ? '导出视频' : 'Export video', exact: true }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(new RegExp(`^YouAnalyst-${style}.*\\.(mp4|webm)$`));
  if (chinese) expect(file.suggestedFilename()).toMatch(/\.webm$/);
  await file.saveAs(info.outputPath(file.suggestedFilename()));
  await expect(page.getByRole('status')).toHaveText(chinese ? '视频已就绪，下载已开始。' : 'Video ready. Your download has started.');
  await expect(page.getByRole('link', { name: chinese ? '下载视频' : 'Download video', exact: true })).toHaveAttribute('download', file.suggestedFilename());
  const decoded = await page.evaluate(async () => {
    const blob = (window as unknown as { videoBlob: Blob }).videoBlob;
    const video = document.createElement('video'); video.muted = true; video.controls = true; video.style.width = '100%';
    document.body.replaceChildren(video);
    video.src = URL.createObjectURL(blob);
    await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error('Video cannot decode')); });
    // WebM may initially report Infinity; seeking to the end determines duration.
    await new Promise<void>(resolve => { video.onseeked = () => resolve(); video.currentTime = Number.isFinite(video.duration) ? video.duration - .1 : 1e6; });
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(video, 0, 0);
    const actual = ctx.getImageData(0, 0, 1280, 720).data;
    (window as unknown as { drawFrame: (canvas: HTMLCanvasElement, progress: number) => void }).drawFrame(canvas, 1);
    const expected = ctx.getImageData(0, 0, 1280, 720).data;
    let difference = 0, chartPixels = 0;
    for (let i = 0; i < actual.length; i += 4) {
      if (Math.abs(expected[i] - expected[0]) + Math.abs(expected[i + 1] - expected[1]) + Math.abs(expected[i + 2] - expected[2]) < 60) continue;
      chartPixels++;
      difference += Math.abs(actual[i] - expected[i]) + Math.abs(actual[i + 1] - expected[i + 1]) + Math.abs(actual[i + 2] - expected[i + 2]);
    }
    return { width: video.videoWidth, height: video.videoHeight, duration: video.currentTime, size: blob.size, chartPixels, pixelError: difference / (chartPixels * 3) };
  });
  expect(decoded.width).toBe(1280); expect(decoded.height).toBe(720); expect(decoded.size).toBeGreaterThan(10_000);
  expect(decoded.duration).toBeGreaterThan(9); expect(decoded.duration).toBeLessThan(12);
  // Compression can change colors slightly; a blank, incomplete, or wrong final frame fails.
  expect(decoded.chartPixels).toBeGreaterThan(1000);
  expect(decoded.pixelError).toBeLessThan(15);
  await page.screenshot({ path: info.outputPath(`${style}-video-final-frame.png`) });
});

test('cancels recording and can retry without downloading a partial video', async ({ page }) => {
  await open(page);
  await page.getByLabel('Music file', { exact: true }).setInputFiles(musicFixture());
  let downloads = 0; page.on('download', () => downloads++);
  await page.getByRole('button', { name: 'Export video', exact: true }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel export' }).click();
  await expect(page.getByRole('status')).toHaveText('Video export cancelled.');
  await expect(page.getByRole('button', { name: 'Export video', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Export video', exact: true }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel export' }).click();
  await expect(page.getByRole('status')).toHaveText('Video export cancelled.');
  expect(downloads).toBe(0);
});

test('explains unavailable browser encoding in Chinese', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'MediaRecorder', { value: undefined }); });
  await open(page, '?zh=1');
  await page.getByRole('button', { name: '导出视频', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('此浏览器不支持视频导出，请尝试使用最新版桌面浏览器。');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});

test('stops export when the tab is hidden and restores the controls', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Export video', exact: true }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.getByRole('status')).toHaveText('Export stopped because the tab was hidden. Keep this tab visible and try again.');
  await expect(page.getByRole('button', { name: 'Export video', exact: true })).toBeEnabled();
});
