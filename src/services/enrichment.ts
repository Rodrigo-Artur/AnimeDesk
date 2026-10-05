import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './platform';
import type { Media, MediaType } from '../types/media';

export type EnrichmentTarget = {
  malId: number;
  type: MediaType;
  title: string;
};

export type EnrichmentFailure = EnrichmentTarget & {
  reason: string;
};

type KitsuMapping = {
  attributes?: {
    externalId?: string;
  };
  relationships?: {
    item?: {
      data?: {
        id?: string;
        type?: string;
      };
    };
  };
};

type KitsuCategory = {
  id: string;
  type: 'categories';
  attributes?: {
    title?: string;
  };
};

type KitsuMediaResource = {
  id: string;
  type: 'anime' | 'manga';
  attributes?: {
    canonicalTitle?: string;
    titles?: Record<string, string | undefined>;
    synopsis?: string | null;
    description?: string | null;
    averageRating?: string | null;
    startDate?: string | null;
    status?: string | null;
    posterImage?: {
      small?: string | null;
      medium?: string | null;
      large?: string | null;
      original?: string | null;
    } | null;
    episodeCount?: number | null;
    chapterCount?: number | null;
  };
  relationships?: {
    categories?: {
      data?: Array<{ id: string; type: string }>;
    };
  };
};

type EnrichmentPayload = {
  mappings?: KitsuMapping[];
  media?: {
    data?: KitsuMediaResource[];
    included?: KitsuCategory[];
  };
};

function parsePublicScore(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round((parsed / 10) * 100) / 100;
}

function yearFromDate(value?: string | null): number | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-/);
  return match ? Number(match[1]) : null;
}

function mapPayload(
  payload: EnrichmentPayload,
  mediaType: MediaType,
): Map<number, Media> {
  const malByKitsuId = new Map<string, number>();

  for (const mapping of payload.mappings ?? []) {
    const malId = Number(mapping.attributes?.externalId);
    const kitsuId = mapping.relationships?.item?.data?.id;
    if (Number.isFinite(malId) && malId > 0 && kitsuId) {
      malByKitsuId.set(kitsuId, malId);
    }
  }

  const categoryById = new Map<string, string>();
  for (const included of payload.media?.included ?? []) {
    if (included.type === 'categories' && included.attributes?.title) {
      categoryById.set(included.id, included.attributes.title);
    }
  }

  const result = new Map<number, Media>();

  for (const resource of payload.media?.data ?? []) {
    const malId = malByKitsuId.get(resource.id);
    if (!malId) continue;

    const attributes = resource.attributes ?? {};
    const genres = (resource.relationships?.categories?.data ?? [])
      .map((ref) => categoryById.get(ref.id))
      .filter((value): value is string => Boolean(value))
      .filter((value, index, all) => all.indexOf(value) === index);

    const titleEnglish =
      attributes.titles?.en ||
      attributes.titles?.en_us ||
      attributes.titles?.en_jp ||
      null;

    result.set(malId, {
      id: malId,
      malId,
      type: mediaType,
      title: attributes.canonicalTitle || titleEnglish || `MAL #${malId}`,
      titleEnglish,
      imageUrl:
        attributes.posterImage?.large ||
        attributes.posterImage?.medium ||
        attributes.posterImage?.small ||
        attributes.posterImage?.original ||
        undefined,
      score: parsePublicScore(attributes.averageRating),
      episodes: mediaType === 'anime' ? attributes.episodeCount ?? null : undefined,
      chapters: mediaType === 'manga' ? attributes.chapterCount ?? null : undefined,
      status: attributes.status ?? undefined,
      synopsis: attributes.synopsis || attributes.description || undefined,
      genres,
      year: yearFromDate(attributes.startDate),
    });
  }

  return result;
}

async function fetchWeb(
  mediaType: MediaType,
  malIds: number[],
): Promise<EnrichmentPayload> {
  const externalSite = mediaType === 'anime' ? 'myanimelist/anime' : 'myanimelist/manga';
  const mappingUrl = new URL('https://kitsu.io/api/edge/mappings');
  mappingUrl.searchParams.set('filter[externalSite]', externalSite);
  mappingUrl.searchParams.set('filter[externalId]', malIds.join(','));
  mappingUrl.searchParams.set('page[limit]', '20');
  mappingUrl.searchParams.set('include', 'item');

  const mappingResponse = await fetch(mappingUrl);
  if (!mappingResponse.ok) {
    throw new Error(`Kitsu mappings HTTP ${mappingResponse.status}`);
  }

  const mappingJson = await mappingResponse.json() as { data?: KitsuMapping[] };
  const kitsuIds = (mappingJson.data ?? [])
    .map((mapping) => mapping.relationships?.item?.data?.id)
    .filter((value): value is string => Boolean(value));

  if (!kitsuIds.length) {
    return { mappings: mappingJson.data ?? [], media: { data: [], included: [] } };
  }

  const mediaUrl = new URL(`https://kitsu.io/api/edge/${mediaType}`);
  mediaUrl.searchParams.set('filter[id]', kitsuIds.join(','));
  mediaUrl.searchParams.set('page[limit]', '20');
  mediaUrl.searchParams.set('include', 'categories');

  const mediaResponse = await fetch(mediaUrl);
  if (!mediaResponse.ok) {
    throw new Error(`Kitsu metadata HTTP ${mediaResponse.status}`);
  }

  return {
    mappings: mappingJson.data ?? [],
    media: await mediaResponse.json() as EnrichmentPayload['media'],
  };
}

export async function enrichMalBatch(
  targets: EnrichmentTarget[],
): Promise<Map<number, Media>> {
  if (!targets.length) return new Map();

  const type = targets[0].type;
  if (targets.some((target) => target.type !== type)) {
    throw new Error('O lote de enriquecimento deve conter apenas um tipo de mídia.');
  }
  if (targets.length > 20) {
    throw new Error('O lote de enriquecimento excedeu 20 itens.');
  }

  const malIds = targets.map((target) => target.malId);
  const payload = isTauriRuntime()
    ? await invoke<EnrichmentPayload>('enrich_kitsu_by_mal_ids', {
        mediaType: type,
        malIds,
      })
    : await fetchWeb(type, malIds);

  return mapPayload(payload, type);
}
