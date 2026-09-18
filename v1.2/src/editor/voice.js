// Creature voice: record up to two seconds from the microphone, trim silence, store as
// a 16 kHz mono WAV data URL, and play it back pitch-shifted.

const RATE = 16000;
const MAX_SECONDS = 2;

let ctx = null;
export function audioContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export async function recordVoice(onLevel, signal) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
  const ac = audioContext();
  const src = ac.createMediaStreamSource(stream);
  const analyser = ac.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const buf = new Uint8Array(analyser.fftSize);
  const t0 = performance.now();
  let raf = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (const b of buf) peak = Math.max(peak, Math.abs(b - 128) / 128);
    const t = (performance.now() - t0) / 1000;
    if (onLevel) onLevel(peak, t / MAX_SECONDS);
    if (t >= MAX_SECONDS || (signal && signal.aborted)) { if (rec.state === 'recording') rec.stop(); return; }
    raf = requestAnimationFrame(tick);
  };
  const done = new Promise((resolve) => { rec.onstop = resolve; });
  rec.start();
  tick();
  const timer = setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, MAX_SECONDS * 1000 + 150);
  if (signal) signal.addEventListener('abort', () => { if (rec.state === 'recording') rec.stop(); });
  await done;
  clearTimeout(timer);
  cancelAnimationFrame(raf);
  stream.getTracks().forEach((t) => t.stop());
  src.disconnect();
  const blob = new Blob(chunks, { type: rec.mimeType });
  const decoded = await ac.decodeAudioData(await blob.arrayBuffer());
  return encode(await resample(decoded));
}

async function resample(buffer) {
  const frames = Math.min(Math.ceil(buffer.duration * RATE), RATE * MAX_SECONDS);
  const off = new OfflineAudioContext(1, Math.max(frames, 1), RATE);
  const s = off.createBufferSource();
  s.buffer = buffer;
  s.connect(off.destination);
  s.start();
  const out = await off.startRendering();
  return out.getChannelData(0);
}

function encode(samples) {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  if (peak < 0.01) throw new Error('silent');
  const gate = peak * 0.06;
  let a = 0;
  let b = samples.length - 1;
  while (a < b && Math.abs(samples[a]) < gate) a++;
  while (b > a && Math.abs(samples[b]) < gate) b--;
  a = Math.max(0, a - 400);
  b = Math.min(samples.length - 1, b + 1200);
  const n = b - a + 1;
  const gain = 0.92 / peak;
  const bytes = new Uint8Array(44 + n * 2);
  const dv = new DataView(bytes.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, RATE, true); dv.setUint32(28, RATE * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / 160, (n - 1 - i) / 800);
    dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[a + i] * gain * fade)) * 32767, true);
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return 'data:audio/wav;base64,' + btoa(bin);
}

const cache = new Map();
export async function decodeVoice(url) {
  if (!url) return null;
  if (cache.has(url)) return cache.get(url);
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const p = audioContext().decodeAudioData(bytes.buffer);
  cache.set(url, p);
  if (cache.size > 12) cache.delete(cache.keys().next().value);
  return p;
}

export async function playVoice(url, pitch = 1, volume = 1) {
  const buffer = await decodeVoice(url);
  if (!buffer) return 0;
  const ac = audioContext();
  const src = ac.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = pitch * (0.96 + Math.random() * 0.08);
  const gain = ac.createGain();
  gain.gain.value = volume;
  src.connect(gain).connect(ac.destination);
  src.start();
  return buffer.duration / pitch;
}
