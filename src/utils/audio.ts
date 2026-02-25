const TARGET_SAMPLE_RATE = 24_000;
const TARGET_RMS = 0.1;

interface WavData {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
}

export function decodeWav(buffer: Buffer): WavData {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  if (view.byteLength < 12) {
    throw new Error('Invalid WAV: file too small');
  }

  // RIFF header
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== 'RIFF') {
    throw new Error('Invalid WAV: missing RIFF header');
  }

  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (wave !== 'WAVE') {
    throw new Error('Invalid WAV: missing WAVE format');
  }

  // Find fmt and data chunks
  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const chunkId = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      if (chunkSize < 16 || offset + 8 + chunkSize > view.byteLength) {
        throw new Error('Invalid WAV: fmt chunk truncated');
      }
      audioFormat = view.getUint16(offset + 8, true);
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
    // Chunks are word-aligned
    if (chunkSize % 2 !== 0) {
      offset += 1;
    }
  }

  if (dataOffset === 0) {
    throw new Error('Invalid WAV: missing data chunk');
  }

  // Clamp dataSize to available bytes
  const availableBytes = view.byteLength - dataOffset;
  if (dataSize > availableBytes) {
    dataSize = availableBytes;
  }

  // PCM = 1, IEEE float = 3
  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error(`Unsupported WAV format: ${audioFormat} (expected PCM=1 or Float=3)`);
  }

  const totalSamples = dataSize / (bitsPerSample / 8);
  const samples = new Float32Array(totalSamples);

  if (audioFormat === 3 && bitsPerSample === 32) {
    for (let i = 0; i < totalSamples; i++) {
      samples[i] = view.getFloat32(dataOffset + i * 4, true);
    }
  } else if (audioFormat === 1 && bitsPerSample === 16) {
    for (let i = 0; i < totalSamples; i++) {
      samples[i] = view.getInt16(dataOffset + i * 2, true) / 32768.0;
    }
  } else if (audioFormat === 1 && bitsPerSample === 32) {
    for (let i = 0; i < totalSamples; i++) {
      samples[i] = view.getInt32(dataOffset + i * 4, true) / 2147483648.0;
    }
  } else {
    throw new Error(`Unsupported WAV bit depth: ${bitsPerSample}`);
  }

  return { samples, sampleRate, channels };
}

export function toMono(samples: Float32Array, channels: number): Float32Array {
  if (channels === 1) {
    return samples;
  }

  const monoLength = Math.floor(samples.length / channels);
  const mono = new Float32Array(monoLength);

  for (let i = 0; i < monoLength; i++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded loop
      sum += samples[i * channels + ch]!;
    }
    mono[i] = sum / channels;
  }

  return mono;
}

export function resample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) {
    return samples;
  }

  const ratio = fromRate / toRate;

  // For downsampling, apply simple anti-aliasing (moving average) before interpolation
  let src = samples;
  if (ratio > 1.0) {
    const kernelSize = Math.round(ratio);
    src = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      let sum = 0;
      let count = 0;
      for (let k = 0; k < kernelSize; k++) {
        const idx = i - Math.floor(kernelSize / 2) + k;
        if (idx >= 0 && idx < samples.length) {
          // biome-ignore lint/style/noNonNullAssertion: bounded loop
          sum += samples[idx]!;
          count++;
        }
      }
      src[i] = sum / count;
    }
  }

  const outputLength = Math.floor(samples.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIdx = i * ratio;
    const idx0 = Math.floor(srcIdx);
    const idx1 = Math.min(idx0 + 1, src.length - 1);
    const frac = srcIdx - idx0;
    // biome-ignore lint/style/noNonNullAssertion: bounded loop
    output[i] = src[idx0]! * (1 - frac) + src[idx1]! * frac;
  }

  return output;
}

export function calculateRMS(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: bounded loop
    const s = samples[i]!;
    sumSq += s * s;
  }
  return Math.sqrt(sumSq / samples.length);
}

export function normalizeToInt16(samples: Float32Array, quantile = 0.999): Int16Array {
  // Find the quantile value for normalization (avoids clipping from outliers)
  const sorted = Float32Array.from(samples).map(Math.abs);
  sorted.sort();
  const qIdx = Math.min(Math.floor(sorted.length * quantile), sorted.length - 1);
  const qVal = sorted[qIdx] ?? 0;

  const scale = qVal > 0 ? 32767.0 / qVal : 1.0;
  const output = new Int16Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: bounded loop
    const val = Math.round(samples[i]! * scale);
    output[i] = Math.max(-32768, Math.min(32767, val));
  }

  return output;
}

/** Encode pre-converted Int16 PCM samples to a WAV buffer. */
export function encodeWav(samples: Int16Array, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = samples.length * bytesPerSample;
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32); // block align
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Write samples
  for (let i = 0; i < samples.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: bounded loop
    buffer.writeInt16LE(samples[i]!, headerSize + i * 2);
  }

  return buffer;
}

/** Encode Float32 PCM samples to a 16-bit PCM WAV buffer. */
export function encodeWavFromFloat32(samples: Float32Array, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = samples.length * bytesPerSample;
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: bounded loop
    const val = Math.round(samples[i]! * 32767.0);
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, val)), headerSize + i * 2);
  }

  return buffer;
}

/**
 * Prepares reference audio for F5-TTS: decode WAV, convert to mono, resample to 24kHz,
 * normalize RMS, and convert to Int16.
 */
export function prepareReferenceAudio(wavBuffer: Buffer): { samples: Float32Array; int16: Int16Array; rms: number } {
  const { samples: raw, sampleRate, channels } = decodeWav(wavBuffer);

  let samples = toMono(raw, channels);
  samples = resample(samples, sampleRate, TARGET_SAMPLE_RATE);

  // Trim to max 10 seconds
  const maxSamples = TARGET_SAMPLE_RATE * 10;
  if (samples.length > maxSamples) {
    samples = samples.slice(0, maxSamples);
  }

  const rms = calculateRMS(samples);
  if (!Number.isFinite(rms) || rms <= 0) {
    const int16 = normalizeToInt16(samples);
    return { samples, int16, rms: 0 };
  }

  // Normalize RMS (matching nsarang: refAudio.div(refRMS * targetRMS))
  // The aggressive amplification is compensated by normalizeToInt16's quantile scaling
  if (rms < TARGET_RMS) {
    const divisor = rms * TARGET_RMS;
    const scaled = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded loop
      scaled[i] = samples[i]! / divisor;
    }
    samples = scaled;
  }

  const int16 = normalizeToInt16(samples);
  return { samples, int16, rms };
}

export { TARGET_RMS, TARGET_SAMPLE_RATE };
