export interface PiperAudioConfig {
  readonly sample_rate: number;
}

export interface PiperEspeakConfig {
  readonly voice: string;
}

export interface PiperInferenceConfig {
  readonly noise_scale: number;
  readonly length_scale: number;
  readonly noise_w: number;
}

export interface PiperModelConfig {
  readonly audio: PiperAudioConfig;
  readonly espeak: PiperEspeakConfig;
  readonly inference: PiperInferenceConfig;
  readonly phoneme_id_map: Record<string, number[]>;
  readonly num_speakers: number;
  readonly speaker_id_map?: Record<string, number>;
}

export function parsePiperConfig(json: unknown): PiperModelConfig {
  const obj = json as Record<string, unknown>;
  if (!obj || typeof obj !== 'object') {
    throw new Error('Invalid Piper config: expected an object');
  }

  const audio = obj.audio as PiperAudioConfig | undefined;
  if (!audio?.sample_rate) {
    throw new Error('Invalid Piper config: missing audio.sample_rate');
  }

  const espeak = obj.espeak as PiperEspeakConfig | undefined;
  if (!espeak?.voice) {
    throw new Error('Invalid Piper config: missing espeak.voice');
  }

  const inference = obj.inference as Record<string, unknown> | undefined;
  if (!inference) {
    throw new Error('Invalid Piper config: missing inference section');
  }

  const phonemeIdMap = obj.phoneme_id_map as Record<string, number[]> | undefined;
  if (!phonemeIdMap || typeof phonemeIdMap !== 'object') {
    throw new Error('Invalid Piper config: missing phoneme_id_map');
  }

  return {
    audio: { sample_rate: audio.sample_rate },
    espeak: { voice: espeak.voice },
    inference: {
      noise_scale: typeof inference.noise_scale === 'number' ? inference.noise_scale : 0.667,
      length_scale: typeof inference.length_scale === 'number' ? inference.length_scale : 1.0,
      noise_w: typeof inference.noise_w === 'number' ? inference.noise_w : 0.8,
    },
    phoneme_id_map: phonemeIdMap,
    num_speakers: typeof obj.num_speakers === 'number' ? obj.num_speakers : 1,
    speaker_id_map: obj.speaker_id_map && typeof obj.speaker_id_map === 'object' ? (obj.speaker_id_map as Record<string, number>) : undefined,
  };
}
