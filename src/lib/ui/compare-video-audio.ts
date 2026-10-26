export type ComparisonAudio = { stream: MediaStream; start: () => void; dispose: () => void };

// Call directly from the export click so resume retains browser user activation.
export async function prepareComparisonAudio(file: File, volume: number, seconds: number, signal: AbortSignal): Promise<ComparisonAudio> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('audio');
  if (typeof AudioContext === 'undefined') throw new Error('unsupported');
  const context = new AudioContext();
  let source: AudioBufferSourceNode | undefined;
  let destination: MediaStreamAudioDestinationNode | undefined;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener('abort', dispose);
    try { source?.stop(); } catch { /* Source may not have started. */ }
    source?.disconnect();
    destination?.stream.getTracks().forEach(track => track.stop());
    void context.close().catch(() => {});
  };
  signal.addEventListener('abort', dispose, { once: true });
  try {
    await context.resume();
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (buffer.duration <= 0 || buffer.duration > 300) throw new Error('audio');
    source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
    const gain = context.createGain(); gain.gain.value = 0;
    destination = context.createMediaStreamDestination();
    source.connect(gain); gain.connect(destination);
    // No connection to speakers: only the exported video receives the music.
    return { stream: destination.stream, dispose, start: () => {
      if (disposed) throw new DOMException('Cancelled', 'AbortError');
      const now = context.currentTime;
      const level = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : .65;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(level, now + .1);
      gain.gain.setValueAtTime(level, now + seconds - .8);
      gain.gain.linearRampToValueAtTime(0, now + seconds);
      source!.start(now); source!.stop(now + seconds);
    } };
  } catch (error) {
    dispose();
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    throw new Error('audio', { cause: error });
  }
}
