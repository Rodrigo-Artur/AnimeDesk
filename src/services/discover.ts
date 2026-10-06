import { invoke } from '@tauri-apps/api/core';
import {
  getJsonAppState,
  removeAppState,
  setJsonAppState,
  setLastSync,
} from './appState';
import { isTauriRuntime } from './platform';
import type { LibraryEntry, Media } from '../types/media';

export type DiscoverKind =
  | 'trending'
  | 'popular'
  | 'top'
  | 'current'
  | 'upcoming'
  | 'seasonal';

export interface DiscoverMedia extends Media {
  provider: 'Kitsu';
  kitsuId: string;
  popularityRank?: number | null;
  ratingRank?: number | null;
  userCount?: number | null;
  favoritesCount?: number | null;
  startDate?: string | null;
  nextRelease?: string | null;
  recommendationScore?: number;
  recommendationReasons?: string[];
}

export interface DiscoverProvider {
  readonly name: string;
  getTrending(): Promise<DiscoverMedia[]>;
  getPopular(): Promise<DiscoverMedia[]>;
  getTopRated(): Promise<DiscoverMedia[]>;
  getCurrent(): Promise<DiscoverMedia[]>;
  getUpcoming(): Promise<DiscoverMedia[]>;
  getSeasonal(season: SeasonName, year: number): Promise<DiscoverMedia[]>;
}

export type SeasonName = 'winter' | 'spring' | 'summer' | 'fall';

export interface DiscoverHomeData {
  trending: DiscoverMedia[];
  seasonal: DiscoverMedia[];
  popular: DiscoverMedia[];
  topRated: DiscoverMedia[];
  upcoming: DiscoverMedia[];
  recommendations: DiscoverMedia[];
  provider: string;
  partialFailures: string[];
}

type KitsuRelationshipRef = { type: string; id: string };

type KitsuAnimeResource = {
  id: string;
  type: 'anime';
  attributes: {
    canonicalTitle?: string;
    synopsis?: string | null;
    description?: string | null;
    titles?: Record<string, string | undefined>;
    averageRating?: string | null;
    userCount?: number | null;
    favoritesCount?: number | null;
    startDate?: string | null;
    nextRelease?: string | null;
    popularityRank?: number | null;
    ratingRank?: number | null;
    episodeCount?: number | null;
    status?: string | null;
    nsfw?: boolean;
    posterImage?: {
      tiny?: string | null;
      small?: string | null;
      medium?: string | null;
      large?: string | null;
      original?: string | null;
    } | null;
  };
  relationships?: {
    mappings?: { data?: KitsuRelationshipRef[] };
    categories?: { data?: KitsuRelationshipRef[] };
  };
};

type KitsuIncludedResource = {
  id: string;
  type: string;
  attributes?: {
    externalSite?: string;
    externalId?: string;
    title?: string;
  };
};

type KitsuResponse = {
  data?: KitsuAnimeResource[];
  included?: KitsuIncludedResource[];
};

const KITSU_BASE = 'https://kitsu.io/api/edge';
const DISCOVER_CACHE_KEY = 'animedesk-discover-cache-v1';
const DISCOVER_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type CachedDiscoverPayload = {
  savedAt: number;
  trending: DiscoverMedia[];
  seasonal: DiscoverMedia[];
  popular: DiscoverMedia[];
  topRated: DiscoverMedia[];
  upcoming: DiscoverMedia[];
};

async function readDiscoverCache(): Promise<CachedDiscoverPayload | null> {
  const parsed = await getJsonAppState<CachedDiscoverPayload>(DISCOVER_CACHE_KEY);
  if (!parsed) return null;

  if (!parsed.savedAt || Date.now() - parsed.savedAt > DISCOVER_CACHE_MAX_AGE_MS) {
    await removeAppState(DISCOVER_CACHE_KEY);
    return null;
  }

  return parsed;
}

async function writeDiscoverCache(
  payload: Omit<CachedDiscoverPayload, 'savedAt'>,
): Promise<void> {
  await setJsonAppState(DISCOVER_CACHE_KEY, {
    ...payload,
    savedAt: Date.now(),
  });
}

function currentSeason(): { season: SeasonName; year: number } {
  const now = new Date();
  const month = now.getMonth() + 1;
  const season: SeasonName =
    month <= 3 ? 'winter' :
    month <= 6 ? 'spring' :
    month <= 9 ? 'summer' :
    'fall';
  return { season, year: now.getFullYear() };
}

function parseKitsuScore(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round((parsed / 10) * 100) / 100 : null;
}

function yearFromDate(value?: string | null): number | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-/);
  return match ? Number(match[1]) : null;
}

function normalizeGenreName(value: string): string {
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, string> = {
    'science fiction': 'sci-fi',
    'sci fi': 'sci-fi',
    'slice of life': 'slice of life',
    'psychological': 'psychological',
    'supernatural': 'supernatural',
  };
  return aliases[normalized] ?? normalized;
}

function mapKitsuResponse(response: KitsuResponse): DiscoverMedia[] {
  const included = response.included ?? [];
  const mappingById = new Map<string, number>();
  const categoryById = new Map<string, string>();

  for (const resource of included) {
    if (
      resource.type === 'mappings' &&
      resource.attributes?.externalSite === 'myanimelist/anime'
    ) {
      const malId = Number(resource.attributes.externalId);
      if (Number.isFinite(malId) && malId > 0) {
        mappingById.set(resource.id, malId);
      }
    }

    if (resource.type === 'categories' && resource.attributes?.title) {
      categoryById.set(resource.id, resource.attributes.title);
    }
  }

  const result: DiscoverMedia[] = [];

  for (const item of response.data ?? []) {
    if (item.attributes.nsfw) continue;

    const mappingIds = item.relationships?.mappings?.data?.map((ref) => ref.id) ?? [];
    const malId = mappingIds
      .map((id) => mappingById.get(id))
      .find((value): value is number => Boolean(value));

    if (!malId) continue;

    const genres = (item.relationships?.categories?.data ?? [])
      .map((ref) => categoryById.get(ref.id))
      .filter((value): value is string => Boolean(value))
      .filter((value, index, all) => all.indexOf(value) === index);

    const englishTitle =
      item.attributes.titles?.en ||
      item.attributes.titles?.en_us ||
      item.attributes.titles?.en_jp ||
      null;

    result.push({
      id: malId,
      malId,
      type: 'anime',
      title: item.attributes.canonicalTitle || englishTitle || `Kitsu #${item.id}`,
      titleEnglish: englishTitle,
      imageUrl:
        item.attributes.posterImage?.large ||
        item.attributes.posterImage?.medium ||
        item.attributes.posterImage?.small ||
        undefined,
      score: parseKitsuScore(item.attributes.averageRating),
      episodes: item.attributes.episodeCount ?? null,
      status: item.attributes.status ?? undefined,
      synopsis: item.attributes.synopsis || item.attributes.description || undefined,
      genres,
      year: yearFromDate(item.attributes.startDate),
      provider: 'Kitsu',
      kitsuId: item.id,
      popularityRank: item.attributes.popularityRank,
      ratingRank: item.attributes.ratingRank,
      userCount: item.attributes.userCount,
      favoritesCount: item.attributes.favoritesCount,
      startDate: item.attributes.startDate,
      nextRelease: item.attributes.nextRelease,
      externalIds: {
        'myanimelist/anime': String(malId),
        kitsu: item.id,
      },
    });
  }

  return result;
}

async function fetchKitsuWeb(
  kind: DiscoverKind,
  season?: SeasonName,
  year?: number,
): Promise<KitsuResponse> {
  if (kind === 'trending') {
    const trendingResponse = await fetch(`${KITSU_BASE}/trending/anime`);
    if (!trendingResponse.ok) throw new Error(`Kitsu trending HTTP ${trendingResponse.status}`);
    const trending = await trendingResponse.json() as { data?: Array<{ id: string }> };
    const ids = (trending.data ?? []).map((item) => item.id);
    if (!ids.length) return { data: [], included: [] };

    const url = new URL(`${KITSU_BASE}/anime`);
    url.searchParams.set('filter[id]', ids.join(','));
    url.searchParams.set('page[limit]', '20');
    url.searchParams.set('include', 'mappings,categories');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Kitsu HTTP ${response.status}`);
    const payload = await response.json() as KitsuResponse;

    const order = new Map(ids.map((id, index) => [id, index]));
    payload.data?.sort(
      (a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
    return payload;
  }

  const url = new URL(`${KITSU_BASE}/anime`);
  url.searchParams.set('page[limit]', '18');
  url.searchParams.set('include', 'mappings,categories');

  if (kind === 'popular') url.searchParams.set('sort', '-userCount');
  if (kind === 'top') url.searchParams.set('sort', '-averageRating');
  if (kind === 'current') {
    url.searchParams.set('filter[status]', 'current');
    url.searchParams.set('sort', '-userCount');
  }
  if (kind === 'upcoming') {
    url.searchParams.set('filter[status]', 'upcoming');
    url.searchParams.set('sort', 'startDate');
  }
  if (kind === 'seasonal') {
    if (!season || !year) throw new Error('Temporada incompleta.');
    url.searchParams.set('filter[season]', season);
    url.searchParams.set('filter[seasonYear]', String(year));
    url.searchParams.set('sort', '-userCount');
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Kitsu HTTP ${response.status}`);
  return response.json() as Promise<KitsuResponse>;
}

async function fetchKitsu(
  kind: DiscoverKind,
  season?: SeasonName,
  year?: number,
): Promise<DiscoverMedia[]> {
  const payload = isTauriRuntime()
    ? await invoke<KitsuResponse>('fetch_kitsu_discover', { kind, season, year })
    : await fetchKitsuWeb(kind, season, year);

  return mapKitsuResponse(payload);
}

class KitsuDiscoverProvider implements DiscoverProvider {
  readonly name = 'Kitsu';

  getTrending() {
    return fetchKitsu('trending');
  }

  getPopular() {
    return fetchKitsu('popular');
  }

  getTopRated() {
    return fetchKitsu('top');
  }

  getCurrent() {
    return fetchKitsu('current');
  }

  getUpcoming() {
    return fetchKitsu('upcoming');
  }

  getSeasonal(season: SeasonName, year: number) {
    return fetchKitsu('seasonal', season, year);
  }
}

const kitsuProvider = new KitsuDiscoverProvider();

function uniqueByMalId(items: DiscoverMedia[]): DiscoverMedia[] {
  const map = new Map<number, DiscoverMedia>();
  for (const item of items) {
    if (!map.has(item.malId)) map.set(item.malId, item);
  }
  return Array.from(map.values());
}

function libraryStatusWeight(entry: LibraryEntry): number {
  switch (entry.status) {
    case 'completed': return 1.25;
    case 'watching':
    case 'reading': return 1.05;
    case 'planned': return 0.2;
    case 'paused': return 0.05;
    case 'dropped': return -1.5;
    default: return 0;
  }
}

function buildGenreProfile(library: LibraryEntry[]): Map<string, number> {
  const profile = new Map<string, number>();

  for (const entry of library) {
    if (!entry.media.genres.length) continue;

    const scoreSignal = entry.score
      ? (entry.score - 5) / 5
      : entry.status === 'completed'
        ? 0.35
        : 0;

    const weight = libraryStatusWeight(entry) + scoreSignal;

    for (const genre of entry.media.genres) {
      const key = normalizeGenreName(genre);
      profile.set(key, (profile.get(key) ?? 0) + weight);
    }
  }

  return profile;
}

function recommendationScore(
  item: DiscoverMedia,
  genreProfile: Map<string, number>,
  libraryById: Map<number, LibraryEntry>,
): number {
  const existing = libraryById.get(item.malId);
  if (existing) {
    if (existing.status === 'completed') return -100;
    if (existing.status === 'dropped') return -100;
    if (existing.status === 'watching' || existing.status === 'reading') return -90;
    if (existing.status === 'planned' || existing.status === 'paused') return -70;
  }

  const publicScore = Math.max(0, Math.min(10, item.score ?? 0)) / 10;
  const popularitySignal = item.userCount
    ? Math.min(1, Math.log10(Math.max(10, item.userCount)) / 6)
    : item.popularityRank
      ? Math.max(0, 1 - Math.min(item.popularityRank, 5000) / 5000)
      : 0;

  const normalizedGenres = item.genres.map(normalizeGenreName);
  const genreValues = normalizedGenres
    .map((genre) => genreProfile.get(genre) ?? 0)
    .filter((value) => value !== 0);

  const genreAffinity = genreValues.length
    ? Math.max(-1, Math.min(1.5, genreValues.reduce((sum, value) => sum + value, 0) / genreValues.length))
    : 0;

  let recency = 0;
  if (item.startDate) {
    const start = new Date(item.startDate).getTime();
    const ageDays = (Date.now() - start) / 86_400_000;
    if (ageDays >= -120 && ageDays <= 550) recency = 1;
    else if (ageDays <= 1200) recency = 0.4;
  }

  const personalized =
    genreAffinity * 0.42 +
    publicScore * 0.28 +
    popularitySignal * 0.2 +
    recency * 0.1;

  return personalized;
}

function bestReferenceTitle(
  item: DiscoverMedia,
  library: LibraryEntry[],
): string | null {
  const itemGenres = new Set(item.genres.map(normalizeGenreName));
  if (!itemGenres.size) return null;

  let best: { title: string; score: number } | null = null;

  for (const entry of library) {
    if (entry.media.type !== 'anime') continue;
    if (entry.status === 'planned' || entry.status === 'dropped') continue;
    if (entry.media.malId === item.malId) continue;

    const overlap = entry.media.genres
      .map(normalizeGenreName)
      .filter((genre) => itemGenres.has(genre)).length;

    if (!overlap) continue;

    const score =
      overlap * 10 +
      (entry.score ?? 0) +
      Math.max(0, libraryStatusWeight(entry)) * 2;

    if (!best || score > best.score) {
      best = {
        title: entry.media.titleEnglish || entry.media.title,
        score,
      };
    }
  }

  return best?.title ?? null;
}

function buildRecommendationReasons(
  item: DiscoverMedia,
  genreProfile: Map<string, number>,
  library: LibraryEntry[],
): string[] {
  const reasons: string[] = [];

  const matchingGenres = item.genres
    .map((genre) => ({
      label: genre,
      weight: genreProfile.get(normalizeGenreName(genre)) ?? 0,
    }))
    .filter((genre) => genre.weight > 0.2)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 2)
    .map((genre) => genre.label);

  if (matchingGenres.length === 1) {
    reasons.push(`Combina com seu interesse em ${matchingGenres[0]}`);
  } else if (matchingGenres.length >= 2) {
    reasons.push(`Combina com ${matchingGenres[0]} + ${matchingGenres[1]}`);
  }

  const referenceTitle = bestReferenceTitle(item, library);
  if (referenceTitle) {
    reasons.push(`Tem afinidade com ${referenceTitle}`);
  }

  if (item.score && item.score >= 8.5) {
    reasons.push(`Nota pública alta: ${item.score.toFixed(1)}/10`);
  }

  if (
    (item.popularityRank && item.popularityRank <= 500) ||
    (item.userCount && item.userCount >= 15_000)
  ) {
    reasons.push('Muito popular na comunidade');
  }

  if (item.startDate) {
    const start = new Date(item.startDate).getTime();
    const daysFromNow = (start - Date.now()) / 86_400_000;
    if (daysFromNow > 0 && daysFromNow <= 180) {
      reasons.push('Estreia próxima');
    } else if (daysFromNow <= 0 && daysFromNow >= -550) {
      reasons.push('Lançamento recente');
    }
  }

  if (!reasons.length) {
    reasons.push('Boa combinação de qualidade e relevância atual');
  }

  return reasons.slice(0, 3);
}

function rankRecommendations(
  candidates: DiscoverMedia[],
  library: LibraryEntry[],
): DiscoverMedia[] {
  const libraryById = new Map(
    library
      .filter((entry) => entry.media.type === 'anime')
      .map((entry) => [entry.media.malId, entry]),
  );
  const genreProfile = buildGenreProfile(library);

  return uniqueByMalId(candidates)
    .map((item) => ({
      ...item,
      recommendationScore: recommendationScore(item, genreProfile, libraryById),
      recommendationReasons: buildRecommendationReasons(item, genreProfile, library),
    }))
    .filter((item) => (item.recommendationScore ?? -100) > -50)
    .sort((a, b) => (b.recommendationScore ?? 0) - (a.recommendationScore ?? 0))
    .slice(0, 12);
}

type SettledSection = {
  name: string;
  items: DiscoverMedia[];
  error?: string;
};

async function settle(
  name: string,
  request: Promise<DiscoverMedia[]>,
): Promise<SettledSection> {
  try {
    return { name, items: await request };
  } catch (error) {
    return {
      name,
      items: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function pick(primary: DiscoverMedia[], fallback: DiscoverMedia[]): DiscoverMedia[] {
  return primary.length ? primary : fallback;
}

export async function getDiscoverHome(
  library: LibraryEntry[],
  provider: DiscoverProvider = kitsuProvider,
): Promise<DiscoverHomeData> {
  const { season, year } = currentSeason();

  const results = await Promise.all([
    settle('trending', provider.getTrending()),
    settle('seasonal', provider.getSeasonal(season, year)),
    settle('popular', provider.getPopular()),
    settle('topRated', provider.getTopRated()),
    settle('current', provider.getCurrent()),
    settle('upcoming', provider.getUpcoming()),
  ]);

  const byName = new Map(results.map((result) => [result.name, result]));
  const trendingRaw = byName.get('trending')?.items ?? [];
  const seasonalRaw = byName.get('seasonal')?.items ?? [];
  const popularRaw = byName.get('popular')?.items ?? [];
  const topRaw = byName.get('topRated')?.items ?? [];
  const currentRaw = byName.get('current')?.items ?? [];
  const upcomingRaw = byName.get('upcoming')?.items ?? [];

  const cache = await readDiscoverCache();
  let usedCache = false;

  const cachedOr = (items: DiscoverMedia[], cached: DiscoverMedia[] | undefined) => {
    if (items.length) return items;
    if (cached?.length) {
      usedCache = true;
      return cached;
    }
    return items;
  };

  const trendingSource = cachedOr(trendingRaw, cache?.trending);
  const seasonalSource = cachedOr(seasonalRaw, cache?.seasonal);
  const popularSource = cachedOr(popularRaw, cache?.popular);
  const topSource = cachedOr(topRaw, cache?.topRated);
  const upcomingSource = cachedOr(upcomingRaw, cache?.upcoming);

  const trending = pick(trendingSource, popularSource);
  const seasonal = pick(seasonalSource, currentRaw);
  const popular = pick(popularSource, trendingSource);
  const topRated = pick(topSource, popularSource);
  const upcoming = pick(upcomingSource, seasonalSource);

  const recommendationPool = uniqueByMalId([
    ...trending,
    ...seasonal,
    ...popular,
    ...topRated,
    ...upcoming,
  ]);

  const hasFreshData =
    trendingRaw.length ||
    seasonalRaw.length ||
    popularRaw.length ||
    topRaw.length ||
    upcomingRaw.length;

  if (hasFreshData) {
    await Promise.all([
      writeDiscoverCache({
        trending,
        seasonal,
        popular,
        topRated,
        upcoming,
      }),
      setLastSync('discover'),
    ]);
  }

  return {
    trending,
    seasonal,
    popular,
    topRated,
    upcoming,
    recommendations: rankRecommendations(recommendationPool, library),
    provider: usedCache
      ? hasFreshData
        ? `${provider.name} + cache local`
        : 'Cache local'
      : provider.name,
    partialFailures: results
      .filter((result) => result.error)
      .map((result) => `${result.name}: ${result.error}`),
  };
}
