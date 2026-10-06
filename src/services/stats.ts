import type { LibraryEntry, WatchHistoryEvent } from '../types/media';

export const ESTIMATED_ANIME_EPISODE_MINUTES = 24;

export type GenreStat = {
  name: string;
  count: number;
};

export type MonthlyActivityStat = {
  key: string;
  label: string;
  count: number;
};

export type ProviderActivityStat = {
  provider: string;
  label: string;
  count: number;
};

export type AnimeDeskStats = {
  totalTitles: number;
  animeTitles: number;
  mangaTitles: number;
  completedTitles: number;
  activeTitles: number;
  plannedTitles: number;
  episodesProgress: number;
  chaptersProgress: number;
  estimatedWatchHours: number;
  averageUserScore: number | null;
  scoredTitles: number;
  topGenres: GenreStat[];
  monthlyActivity: MonthlyActivityStat[];
  providerActivity: ProviderActivityStat[];
  historyEvents: number;
};

function safeProgress(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeHistoryDate(value: string): Date | null {
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const date = new Date(sqliteUtc);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date: Date): string {
  const month = date
    .toLocaleDateString('pt-BR', { month: 'short' })
    .replace('.', '')
    .toUpperCase();
  return `${month} ${String(date.getFullYear()).slice(-2)}`;
}

function recentMonthBuckets(now: Date, count = 6): MonthlyActivityStat[] {
  const result: MonthlyActivityStat[] = [];

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1, 12, 0, 0, 0);
    result.push({
      key: monthKey(date),
      label: monthLabel(date),
      count: 0,
    });
  }

  return result;
}

function providerLabel(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  const aliases: Record<string, string> = {
    manual: 'AnimeDesk',
    crunchyroll: 'Crunchyroll',
    netflix: 'Netflix',
    primevideo: 'Prime Video',
    animeschedule: 'AnimeSchedule',
    myanimelist: 'MyAnimeList',
  };
  return aliases[normalized] ?? (provider.trim() || 'Desconhecido');
}

export function computeAnimeDeskStats(
  library: LibraryEntry[],
  history: WatchHistoryEvent[],
  now = new Date(),
): AnimeDeskStats {
  const animeEntries = library.filter((entry) => entry.media.type === 'anime');
  const mangaEntries = library.filter((entry) => entry.media.type === 'manga');

  const episodesProgress = animeEntries.reduce(
    (sum, entry) => sum + safeProgress(entry.progress),
    0,
  );
  const chaptersProgress = mangaEntries.reduce(
    (sum, entry) => sum + safeProgress(entry.progress),
    0,
  );

  const scores = library
    .map((entry) => entry.score)
    .filter((score): score is number => Number.isFinite(score) && (score ?? 0) > 0);

  const averageUserScore = scores.length
    ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) / 100
    : null;

  const genres = new Map<string, { label: string; count: number }>();
  for (const entry of library) {
    for (const genre of new Set(entry.media.genres.map((value) => value.trim()).filter(Boolean))) {
      const key = genre.toLocaleLowerCase('pt-BR');
      const current = genres.get(key);
      genres.set(key, {
        label: current?.label ?? genre,
        count: (current?.count ?? 0) + 1,
      });
    }
  }

  const topGenres = Array.from(genres.values())
    .map((genre) => ({ name: genre.label, count: genre.count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, 8);

  const monthlyActivity = recentMonthBuckets(now);
  const monthlyByKey = new Map(monthlyActivity.map((item) => [item.key, item]));

  const providerCounts = new Map<string, number>();

  for (const event of history) {
    const date = normalizeHistoryDate(event.watchedAt);
    if (date) {
      const month = monthlyByKey.get(monthKey(date));
      if (month) month.count += 1;
    }

    const provider = event.provider.trim() || 'unknown';
    providerCounts.set(provider, (providerCounts.get(provider) ?? 0) + 1);
  }

  const providerActivity = Array.from(providerCounts.entries())
    .map(([provider, count]) => ({
      provider,
      label: providerLabel(provider),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'));

  return {
    totalTitles: library.length,
    animeTitles: animeEntries.length,
    mangaTitles: mangaEntries.length,
    completedTitles: library.filter((entry) => entry.status === 'completed').length,
    activeTitles: library.filter(
      (entry) => entry.status === 'watching' || entry.status === 'reading',
    ).length,
    plannedTitles: library.filter((entry) => entry.status === 'planned').length,
    episodesProgress,
    chaptersProgress,
    estimatedWatchHours:
      Math.round((episodesProgress * ESTIMATED_ANIME_EPISODE_MINUTES / 60) * 10) / 10,
    averageUserScore,
    scoredTitles: scores.length,
    topGenres,
    monthlyActivity,
    providerActivity,
    historyEvents: history.length,
  };
}

export function formatHistoryUnit(event: WatchHistoryEvent): string {
  if (event.mediaType === 'manga') {
    return event.chapter ? `Capítulo ${event.chapter}` : 'Leitura registrada';
  }
  return event.episode ? `Episódio ${event.episode}` : 'Episódio registrado';
}

export function parseWatchHistoryDate(value: string): Date | null {
  return normalizeHistoryDate(value);
}
