import type { LibraryEntry, ReleaseItem } from '../types/media';

const ANIME_SCHEDULE_BASE = 'https://animeschedule.net/api/v3';
const JIKAN_BASE = 'https://api.jikan.moe/v4';
const POSTER_BASE = 'https://img.animeschedule.net/production/assets/public/img/';
const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

const weekdays = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

type ScheduleResult = {
  source: 'AnimeSchedule' | 'Jikan';
  items: ReleaseItem[];
};

type AnimeScheduleEntry = {
  title: string;
  romaji?: string;
  english?: string;
  route: string;
  episodeDate: string;
  episodeNumber?: number;
  imageVersionRoute?: string;
  airType?: string;
  airingStatus?: string;
};

type JikanScheduleEntry = {
  mal_id: number;
  title: string;
  title_english?: string | null;
  images?: { jpg?: { small_image_url?: string; image_url?: string } };
  broadcast?: {
    day?: string | null;
    time?: string | null;
    timezone?: string | null;
  };
};

function normalizeTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findLibraryMatch(
  entry: { title: string; english?: string; romaji?: string },
  library: LibraryEntry[],
): LibraryEntry | undefined {
  const candidates = [entry.title, entry.english, entry.romaji]
    .filter((value): value is string => Boolean(value))
    .map(normalizeTitle);

  return library.find((item) => {
    const mediaTitles = [item.media.title, item.media.titleEnglish]
      .filter((value): value is string => Boolean(value))
      .map(normalizeTitle);
    return candidates.some((candidate) => mediaTitles.includes(candidate));
  });
}

function nextDateForJapanWeekday(dayIndex: number, time = '00:00'): string {
  const now = new Date();
  const currentDay = now.getDay();
  const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay;
  const localMonday = new Date(now);
  localMonday.setHours(12, 0, 0, 0);
  localMonday.setDate(now.getDate() + mondayOffset + dayIndex);

  const year = localMonday.getFullYear();
  const month = String(localMonday.getMonth() + 1).padStart(2, '0');
  const day = String(localMonday.getDate()).padStart(2, '0');
  const safeTime = /^\d{2}:\d{2}$/.test(time) ? time : '00:00';

  return new Date(`${year}-${month}-${day}T${safeTime}:00+09:00`).toISOString();
}

async function fetchAnimeSchedule(library: LibraryEntry[]): Promise<ScheduleResult | null> {
  const token = import.meta.env.VITE_ANIMESCHEDULE_TOKEN?.trim();
  if (!token) return null;

  const response = await fetch(
    `${ANIME_SCHEDULE_BASE}/timetables/sub?tz=${encodeURIComponent(DEFAULT_TIMEZONE)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!response.ok) throw new Error(`AnimeSchedule respondeu HTTP ${response.status}`);

  const data = await response.json() as AnimeScheduleEntry[];
  const items = data.map((entry) => {
    const match = findLibraryMatch(entry, library);
    return {
      id: `animeschedule:${entry.route}:${entry.episodeNumber ?? entry.episodeDate}`,
      mediaTitle: entry.english || entry.title || entry.romaji || entry.route,
      mediaMalId: match?.media.malId,
      episode: entry.episodeNumber,
      releaseAt: entry.episodeDate,
      provider: 'AnimeSchedule',
      imageUrl: entry.imageVersionRoute ? `${POSTER_BASE}${entry.imageVersionRoute}` : match?.media.imageUrl,
      airType: entry.airType ?? 'sub',
      inLibrary: Boolean(match),
    } satisfies ReleaseItem;
  });

  return { source: 'AnimeSchedule', items };
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJikanFallback(library: LibraryEntry[]): Promise<ScheduleResult> {
  const items: ReleaseItem[] = [];

  for (let dayIndex = 0; dayIndex < weekdays.length; dayIndex += 1) {
    if (dayIndex > 0) await delay(360);

    const weekday = weekdays[dayIndex];
    const response = await fetch(
      `${JIKAN_BASE}/schedules?filter=${weekday}&sfw=true&limit=25`,
    );
    if (!response.ok) continue;

    const json = await response.json() as { data: JikanScheduleEntry[] };
    for (const entry of json.data) {
      const match = library.find((item) => item.media.type === 'anime' && item.media.malId === entry.mal_id);
      const releaseAt = nextDateForJapanWeekday(dayIndex, entry.broadcast?.time ?? '00:00');

      items.push({
        id: `jikan:${entry.mal_id}:${weekday}`,
        mediaTitle: entry.title_english || entry.title,
        mediaMalId: entry.mal_id,
        episode: match ? match.progress + 1 : undefined,
        releaseAt,
        provider: 'Jikan',
        imageUrl: entry.images?.jpg?.small_image_url ?? entry.images?.jpg?.image_url ?? match?.media.imageUrl,
        airType: 'raw',
        inLibrary: Boolean(match),
      });
    }
  }

  return { source: 'Jikan', items };
}

export async function getWeeklySchedule(library: LibraryEntry[] = []): Promise<ScheduleResult> {
  try {
    const animeSchedule = await fetchAnimeSchedule(library);
    if (animeSchedule) {
      return {
        ...animeSchedule,
        items: animeSchedule.items.sort(
          (a, b) => new Date(a.releaseAt).getTime() - new Date(b.releaseAt).getTime(),
        ),
      };
    }
  } catch (error) {
    console.warn('AnimeSchedule indisponível; usando Jikan como fallback.', error);
  }

  const fallback = await fetchJikanFallback(library);
  return {
    ...fallback,
    items: fallback.items.sort(
      (a, b) => new Date(a.releaseAt).getTime() - new Date(b.releaseAt).getTime(),
    ),
  };
}
