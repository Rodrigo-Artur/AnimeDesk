import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './platform';
import type { Media, MediaDetails, MediaRelation } from '../types/media';

const JIKAN_BASE = 'https://api.jikan.moe/v4';

type JikanImages = {
  jpg?: { large_image_url?: string; image_url?: string };
};

type JikanGenre = { name: string };

type MalDirectSearchItem = {
  id: number;
  type: 'anime' | 'manga';
  name: string;
  url?: string;
  image_url?: string;
  thumbnail_url?: string;
  payload?: {
    media_type?: string;
    start_year?: number | null;
    aired?: string;
    score?: string | number | null;
    status?: string;
  };
};

type MalDirectSearchResponse = {
  categories?: Array<{
    type?: string;
    items?: MalDirectSearchItem[];
  }>;
};

function parseMalScore(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function searchMyAnimeListDirect(
  query: string,
  type: 'anime' | 'manga',
): Promise<Media[]> {
  const response = await invoke<MalDirectSearchResponse>('search_myanimelist', {
    mediaType: type,
    keyword: query.trim(),
  });

  const category = response.categories?.find((item) => item.type === type);
  return (category?.items ?? []).map((item) => ({
    id: item.id,
    malId: item.id,
    type,
    title: item.name,
    imageUrl: item.image_url ?? item.thumbnail_url,
    score: parseMalScore(item.payload?.score),
    status: item.payload?.status,
    genres: [],
    year: item.payload?.start_year ?? null,
    externalIds: {
      [`myanimelist/${type}`]: String(item.id),
    },
  }));
}

type JikanAnime = {
  mal_id: number;
  title: string;
  title_english?: string | null;
  images?: JikanImages;
  score?: number | null;
  episodes?: number | null;
  status?: string;
  synopsis?: string;
  genres?: JikanGenre[];
  year?: number | null;
};

type JikanManga = {
  mal_id: number;
  title: string;
  title_english?: string | null;
  images?: JikanImages;
  score?: number | null;
  chapters?: number | null;
  status?: string;
  synopsis?: string;
  genres?: JikanGenre[];
  published?: {
    prop?: {
      from?: {
        year?: number | null;
      };
    };
  };
};

function animeToMedia(item: JikanAnime): Media {
  return {
    id: item.mal_id,
    malId: item.mal_id,
    type: 'anime',
    title: item.title,
    titleEnglish: item.title_english,
    imageUrl: item.images?.jpg?.large_image_url ?? item.images?.jpg?.image_url,
    score: item.score,
    episodes: item.episodes,
    status: item.status,
    synopsis: item.synopsis,
    genres: item.genres?.map((genre) => genre.name) ?? [],
    year: item.year,
    externalIds: {
      'myanimelist/anime': String(item.mal_id),
    },
  };
}

function mangaToMedia(item: JikanManga): Media {
  return {
    id: item.mal_id,
    malId: item.mal_id,
    type: 'manga',
    title: item.title,
    titleEnglish: item.title_english,
    imageUrl: item.images?.jpg?.large_image_url ?? item.images?.jpg?.image_url,
    score: item.score,
    chapters: item.chapters,
    status: item.status,
    synopsis: item.synopsis,
    genres: item.genres?.map((genre) => genre.name) ?? [],
    year: item.published?.prop?.from?.year,
    externalIds: {
      'myanimelist/manga': String(item.mal_id),
    },
  };
}

export async function searchAnime(query: string): Promise<Media[]> {
  if (!query.trim()) return [];

  if (isTauriRuntime()) {
    return searchMyAnimeListDirect(query, 'anime');
  }

  const url = new URL(`${JIKAN_BASE}/anime`);
  url.searchParams.set('q', query.trim());
  url.searchParams.set('limit', '18');
  url.searchParams.set('sfw', 'true');

  const response = await fetch(url);
  if (!response.ok) throw new Error('Falha ao consultar o catálogo de animes.');

  const json = await response.json() as { data: JikanAnime[] };
  return json.data.map(animeToMedia);
}

export async function searchManga(query: string): Promise<Media[]> {
  if (!query.trim()) return [];

  if (isTauriRuntime()) {
    return searchMyAnimeListDirect(query, 'manga');
  }

  const url = new URL(`${JIKAN_BASE}/manga`);
  url.searchParams.set('q', query.trim());
  url.searchParams.set('limit', '18');
  url.searchParams.set('sfw', 'true');

  const response = await fetch(url);
  if (!response.ok) throw new Error('Falha ao consultar o catálogo de mangás.');

  const json = await response.json() as { data: JikanManga[] };
  return json.data.map(mangaToMedia);
}

export async function getCurrentSeason(): Promise<Media[]> {
  const response = await fetch(`${JIKAN_BASE}/seasons/now?limit=12&sfw=true`);
  if (!response.ok) throw new Error('Falha ao carregar a temporada atual.');

  const json = await response.json() as { data: JikanAnime[] };
  return json.data.map(animeToMedia);
}

type JikanFullMedia = (JikanAnime | JikanManga) & {
  url?: string | null;
  rank?: number | null;
  popularity?: number | null;
  members?: number | null;
  favorites?: number | null;
  background?: string | null;
  studios?: Array<{ name: string }>;
  authors?: Array<{ name: string }>;
  trailer?: { url?: string | null };
  relations?: Array<{
    relation: string;
    entry: Array<{ mal_id: number; type: 'anime' | 'manga'; name: string }>;
  }>;
};

function mapRelations(relations?: JikanFullMedia['relations']): MediaRelation[] {
  return (relations ?? []).map((relation) => ({
    relation: relation.relation,
    entries: relation.entry
      .filter((entry) => entry.type === 'anime' || entry.type === 'manga')
      .map((entry) => ({
        malId: entry.mal_id,
        type: entry.type,
        name: entry.name,
      })),
  }));
}

export async function getMediaDetails(media: Media): Promise<MediaDetails> {
  const response = await fetch(`${JIKAN_BASE}/${media.type}/${media.malId}/full`);
  if (!response.ok) throw new Error('Falha ao carregar os detalhes da obra.');

  const json = await response.json() as { data: JikanFullMedia };
  const item = json.data;
  const base = media.type === 'anime'
    ? animeToMedia(item as JikanAnime)
    : mangaToMedia(item as JikanManga);

  return {
    ...base,
    externalIds: {
      ...(base.externalIds ?? {}),
      ...(media.externalIds ?? {}),
      [`myanimelist/${media.type}`]: String(media.malId),
    },
    url: item.url,
    rank: item.rank,
    popularity: item.popularity,
    members: item.members,
    favorites: item.favorites,
    background: item.background,
    studios: item.studios?.map((studio) => studio.name) ?? [],
    authors: item.authors?.map((author) => author.name) ?? [],
    trailerUrl: item.trailer?.url,
    relations: mapRelations(item.relations),
  };
}
