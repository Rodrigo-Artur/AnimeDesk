import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './platform';
import type { Media } from '../types/media';

function isRemoteCover(url?: string): url is string {
  if (!url) return false;
  if (url.startsWith('asset:') || url.includes('asset.localhost')) return false;
  return url.startsWith('https://') || url.startsWith('http://');
}

export async function cacheMediaCover(media: Media): Promise<string | null> {
  if (!isTauriRuntime() || !isRemoteCover(media.imageUrl)) return null;

  const path = await invoke<string>('cache_cover', {
    url: media.imageUrl,
    mediaType: media.type,
    malId: media.malId,
  });

  return convertFileSrc(path);
}
