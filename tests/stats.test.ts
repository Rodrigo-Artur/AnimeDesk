import { describe, expect, it } from 'vitest';
import {
  computeAnimeDeskStats,
  ESTIMATED_ANIME_EPISODE_MINUTES,
  formatHistoryUnit,
  parseWatchHistoryDate,
} from '../src/services/stats';
import type { LibraryEntry, WatchHistoryEvent } from '../src/types/media';

const library: LibraryEntry[] = [
  {
    media: {
      id: 52991,
      malId: 52991,
      type: 'anime',
      title: 'Frieren',
      genres: ['Fantasy', 'Adventure'],
    },
    status: 'completed',
    progress: 28,
    score: 10,
    updatedAt: '2026-10-01T00:00:00Z',
  },
  {
    media: {
      id: 20,
      malId: 20,
      type: 'anime',
      title: 'Naruto',
      genres: ['Action', 'Adventure'],
    },
    status: 'watching',
    progress: 10,
    score: 8,
    updatedAt: '2026-10-01T00:00:00Z',
  },
  {
    media: {
      id: 2,
      malId: 2,
      type: 'manga',
      title: 'Berserk',
      genres: ['Drama', 'Fantasy'],
    },
    status: 'reading',
    progress: 100,
    score: 9,
    updatedAt: '2026-10-01T00:00:00Z',
  },
  {
    media: {
      id: 13,
      malId: 13,
      type: 'manga',
      title: 'One Piece',
      genres: ['Adventure'],
    },
    status: 'planned',
    progress: 0,
    updatedAt: '2026-10-01T00:00:00Z',
  },
];

const history: WatchHistoryEvent[] = [
  {
    id: 1,
    mediaType: 'anime',
    mediaMalId: 52991,
    mediaTitle: 'Frieren',
    episode: 28,
    provider: 'manual',
    watchedAt: '2026-10-05T12:00:00Z',
  },
  {
    id: 2,
    mediaType: 'anime',
    mediaMalId: 20,
    mediaTitle: 'Naruto',
    episode: 10,
    provider: 'crunchyroll',
    watchedAt: '2026-10-01T12:00:00Z',
  },
  {
    id: 3,
    mediaType: 'manga',
    mediaMalId: 2,
    mediaTitle: 'Berserk',
    chapter: 100,
    provider: 'manual',
    watchedAt: '2026-09-15T12:00:00Z',
  },
];

describe('estatísticas locais', () => {
  it('calcula totais e progresso sem inventar histórico retroativo', () => {
    const stats = computeAnimeDeskStats(
      library,
      history,
      new Date('2026-10-06T12:00:00Z'),
    );

    expect(stats.totalTitles).toBe(4);
    expect(stats.animeTitles).toBe(2);
    expect(stats.mangaTitles).toBe(2);
    expect(stats.completedTitles).toBe(1);
    expect(stats.activeTitles).toBe(2);
    expect(stats.plannedTitles).toBe(1);
    expect(stats.episodesProgress).toBe(38);
    expect(stats.chaptersProgress).toBe(100);
    expect(ESTIMATED_ANIME_EPISODE_MINUTES).toBe(24);
    expect(stats.estimatedWatchHours).toBe(15.2);
    expect(stats.averageUserScore).toBe(9);
    expect(stats.scoredTitles).toBe(3);
    expect(stats.historyEvents).toBe(3);
  });

  it('ordena gêneros e conta atividade mensal/provider', () => {
    const stats = computeAnimeDeskStats(
      library,
      history,
      new Date('2026-10-06T12:00:00Z'),
    );

    expect(stats.topGenres.slice(0, 2)).toEqual([
      { name: 'Adventure', count: 3 },
      { name: 'Fantasy', count: 2 },
    ]);

    expect(stats.monthlyActivity.find((item) => item.key === '2026-10')?.count).toBe(2);
    expect(stats.monthlyActivity.find((item) => item.key === '2026-09')?.count).toBe(1);

    expect(stats.providerActivity).toEqual([
      { provider: 'manual', label: 'AnimeDesk', count: 2 },
      { provider: 'crunchyroll', label: 'Crunchyroll', count: 1 },
    ]);
  });

  it('formata unidades e timestamps SQLite UTC', () => {
    expect(formatHistoryUnit(history[0])).toBe('Episódio 28');
    expect(formatHistoryUnit(history[2])).toBe('Capítulo 100');

    const parsed = parseWatchHistoryDate('2026-10-06 12:34:56');
    expect(parsed?.toISOString()).toBe('2026-10-06T12:34:56.000Z');
  });
});
