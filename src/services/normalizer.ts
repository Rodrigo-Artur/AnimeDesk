import {
  getExternalMediaIds,
  getExternalMediaMappings,
  linkExternalMediaId,
  resolveExternalMediaId,
  unlinkExternalMediaId,
} from '../db/database';
import type { ExternalMediaMapping } from '../db/database';
import { isTauriRuntime } from './platform';
import type { Media, MediaType } from '../types/media';

export type ExternalProvider = string;

const providerAliases: Record<string, string> = {
  kitsu: 'kitsu',
  crunchyroll: 'crunchyroll',
  crunchy: 'crunchyroll',
  netflix: 'netflix',
  prime: 'primevideo',
  primevideo: 'primevideo',
  'prime-video': 'primevideo',
  disney: 'disneyplus',
  disneyplus: 'disneyplus',
  'disney+': 'disneyplus',
  max: 'max',
  hbomax: 'max',
  anilist: 'anilist',
  tmdb: 'tmdb',
};

export function canonicalMalProvider(type: MediaType): string {
  return `myanimelist/${type}`;
}

export function normalizeProviderName(
  value: string,
  mediaType?: MediaType,
): ExternalProvider {
  const key = value.trim().toLowerCase().replace(/\s+/g, '');
  if (!key) return 'unknown';

  if (
    key === 'mal' ||
    key === 'myanimelist' ||
    key === 'my-anime-list'
  ) {
    return mediaType ? canonicalMalProvider(mediaType) : 'myanimelist';
  }

  if (key === 'myanimelist/anime' || key === 'myanimelist/manga') {
    return key;
  }

  return providerAliases[key] ?? key;
}

export function canonicalMediaKey(
  media: Pick<Media, 'type' | 'malId'>,
): string {
  return `${media.type}:${media.malId}`;
}

export function withExternalId(
  media: Media,
  provider: string,
  externalId: string,
): Media {
  const normalizedProvider = normalizeProviderName(provider, media.type);
  const cleanId = externalId.trim();
  if (!cleanId) return media;

  return {
    ...media,
    externalIds: {
      [canonicalMalProvider(media.type)]: String(media.malId),
      ...(media.externalIds ?? {}),
      [normalizedProvider]: cleanId,
    },
  };
}

export async function rememberExternalId(
  media: Media,
  provider: string,
  externalId: string,
  options: {
    confidence?: number;
    verified?: boolean;
  } = {},
): Promise<Media> {
  const normalizedProvider = normalizeProviderName(provider, media.type);
  const enriched = withExternalId(media, normalizedProvider, externalId);

  if (isTauriRuntime()) {
    await linkExternalMediaId(
      enriched,
      normalizedProvider,
      externalId,
      options.confidence ?? 1,
      options.verified ?? false,
    );
  }

  return enriched;
}

export async function knownExternalMappings(
  media: Pick<Media, 'type' | 'malId'>,
): Promise<ExternalMediaMapping[]> {
  if (!isTauriRuntime()) {
    return [{
      provider: canonicalMalProvider(media.type),
      externalId: String(media.malId),
      externalTitle: null,
      confidence: 1,
      verified: true,
      canonical: true,
    }];
  }

  return getExternalMediaMappings(media.type, media.malId);
}

export async function forgetExternalId(
  media: Pick<Media, 'type' | 'malId'>,
  provider: string,
  externalId: string,
): Promise<void> {
  if (!isTauriRuntime()) return;
  const normalizedProvider = normalizeProviderName(provider, media.type);
  await unlinkExternalMediaId(
    media.type,
    media.malId,
    normalizedProvider,
    externalId,
  );
}

export async function knownExternalIds(
  media: Pick<Media, 'type' | 'malId'>,
): Promise<Record<string, string>> {
  if (!isTauriRuntime()) {
    return {
      [canonicalMalProvider(media.type)]: String(media.malId),
    };
  }
  return getExternalMediaIds(media.type, media.malId);
}

export async function resolveKnownExternalId(
  provider: string,
  externalId: string,
  mediaType?: MediaType,
) {
  if (!isTauriRuntime()) return null;

  const normalizedProvider = normalizeProviderName(provider, mediaType);

  // MAL IDs live in separate anime/manga namespaces; a generic MAL lookup
  // without mediaType would be ambiguous if the same numeric ID exists in both.
  if (normalizedProvider === 'myanimelist' && !mediaType) {
    return null;
  }

  return resolveExternalMediaId(
    normalizedProvider,
    externalId.trim(),
  );
}
