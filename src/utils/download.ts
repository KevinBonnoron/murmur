import { mkdir, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import consola from 'consola';

export interface DownloadProgress {
  file: string;
  downloaded: number;
  total: number;
  done: boolean;
}

export async function downloadFile(url: string, destPath: string, expectedSize: number | undefined, label: string, onProgress?: (progress: DownloadProgress) => void): Promise<void> {
  const existing = Bun.file(destPath);
  if (await existing.exists()) {
    const stat = existing.size;
    if (stat > 0 && expectedSize !== undefined && stat === expectedSize) {
      onProgress?.({ file: label, downloaded: expectedSize, total: expectedSize, done: true });
      return;
    }
  }

  const fileDir = dirname(destPath);
  await mkdir(fileDir, { recursive: true });

  consola.start(`Downloading ${label}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0);
  const total = expectedSize ?? contentLength;
  let downloaded = 0;

  if (!response.body) {
    throw new Error(`No response body for ${url}`);
  }

  const tmpPath = `${destPath}.tmp`;
  const writer = Bun.file(tmpPath).writer();
  const reader = response.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      writer.write(value);
      downloaded += value.byteLength;
      onProgress?.({ file: label, downloaded, total, done: false });
    }
    await writer.end();
  } catch (err) {
    await writer.end();
    await unlink(tmpPath).catch(() => {});
    throw err;
  }

  if (contentLength > 0 && downloaded !== contentLength) {
    await unlink(tmpPath).catch(() => {});
    throw new Error(`Incomplete download for ${label}: expected ${contentLength} bytes but got ${downloaded}`);
  }

  await rename(tmpPath, destPath);
  onProgress?.({ file: label, downloaded, total, done: true });
  consola.success(`Downloaded ${label}`);
}
