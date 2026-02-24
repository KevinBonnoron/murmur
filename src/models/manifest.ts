export interface ManifestFile {
  name: string;
  url: string;
  sha256?: string;
  size?: number;
}

export interface ManifestVariant {
  file: string;
  dtype: string;
  url: string;
  size?: number;
}

export interface ManifestDefaults {
  variant: string;
  voice: string;
  sample_rate: number;
  response_format: string;
}

export interface ModelManifest {
  name: string;
  description: string;
  backend: string;
  license: string;
  files: ManifestFile[];
  variants: Record<string, ManifestVariant>;
  voice_url: string;
  installed_voices: string[];
  defaults: ManifestDefaults;
}

export function parseManifest(json: unknown): ModelManifest {
  const obj = json as Record<string, unknown>;
  if (!obj || typeof obj !== 'object') {
    throw new Error('Invalid manifest: expected an object');
  }
  if (typeof obj.name !== 'string') {
    throw new Error('Invalid manifest: missing "name"');
  }
  if (typeof obj.backend !== 'string') {
    throw new Error('Invalid manifest: missing "backend"');
  }
  if (!Array.isArray(obj.files)) {
    throw new Error('Invalid manifest: missing "files" array');
  }
  if (typeof obj.variants !== 'object' || obj.variants === null || Array.isArray(obj.variants)) {
    throw new Error('Invalid manifest: missing "variants" object');
  }
  if (typeof obj.voice_url !== 'string') {
    throw new Error('Invalid manifest: missing "voice_url"');
  }
  const rawDefaults = obj.defaults && typeof obj.defaults === 'object' ? (obj.defaults as Partial<ManifestDefaults>) : {};
  const defaults: ManifestDefaults = {
    variant: typeof rawDefaults.variant === 'string' ? rawDefaults.variant : 'default',
    voice: typeof rawDefaults.voice === 'string' ? rawDefaults.voice : '',
    sample_rate: typeof rawDefaults.sample_rate === 'number' ? rawDefaults.sample_rate : 24000,
    response_format: typeof rawDefaults.response_format === 'string' ? rawDefaults.response_format : 'wav',
  };

  return {
    name: obj.name,
    description: typeof obj.description === 'string' ? obj.description : '',
    backend: obj.backend,
    license: typeof obj.license === 'string' ? obj.license : '',
    files: obj.files as ManifestFile[],
    variants: obj.variants as Record<string, ManifestVariant>,
    voice_url: obj.voice_url,
    installed_voices: Array.isArray(obj.installed_voices) ? (obj.installed_voices as string[]) : [],
    defaults,
  };
}

export function resolveVoiceUrl(manifest: ModelManifest, voiceId: string): string {
  return manifest.voice_url.replace(`\${voice_id}`, voiceId);
}

export function getFullName(manifest: ModelManifest): string {
  return manifest.name;
}

export function parseModelRef(ref: string): { name: string; variant?: string } {
  const colonIndex = ref.indexOf(':');
  if (colonIndex === -1) {
    return { name: ref };
  }
  return { name: ref.slice(0, colonIndex), variant: ref.slice(colonIndex + 1) };
}

export function getVariant(manifest: ModelManifest, variantKey?: string): ManifestVariant {
  const key = variantKey ?? manifest.defaults.variant;
  const variant = manifest.variants[key];
  if (!variant) {
    const available = Object.keys(manifest.variants).join(', ');
    throw new Error(`Variant "${key}" not found for ${manifest.name}. Available: ${available}`);
  }
  return variant;
}
