/** Lightweight spectral fingerprint for voice consistency (MVP). */

export function computeVoiceFingerprint(samples: number[]): number[] {
  if (!samples.length) return [];
  const frameSize = 512;
  const bins = 24;
  const fingerprint = new Array(bins).fill(0);
  const frames = Math.max(1, Math.floor(samples.length / frameSize));
  for (let f = 0; f < frames; f += 1) {
    const start = f * frameSize;
    let energy = 0;
    for (let i = 0; i < frameSize && start + i < samples.length; i += 1) {
      const v = samples[start + i];
      energy += v * v;
    }
    const bin = Math.min(bins - 1, Math.floor((energy / frameSize) * bins));
    fingerprint[bin] += 1;
  }
  const norm = Math.sqrt(fingerprint.reduce((s, v) => s + v * v, 0)) || 1;
  return fingerprint.map((v) => v / norm);
}

export function voiceFingerprintDistance(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 1;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export function decodeBase64Pcm16(base64: string): number[] {
  const buf = Buffer.from(base64, 'base64');
  const samples: number[] = [];
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const sample = buf.readInt16LE(i);
    samples.push(sample / 32768);
  }
  return samples;
}
