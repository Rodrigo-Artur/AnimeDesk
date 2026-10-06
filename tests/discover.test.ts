import { describe, expect, it, vi } from 'vitest';
import {
  getDiscoverHome,
  type DiscoverMedia,
  type DiscoverProvider,
  type SeasonName,
} from '../src/services/discover';
import type { LibraryEntry } from '../src/types/media';

function candidate(
  malId: number,
  title: string,
  genres: string[],
  score: number,
  userCount = 20_000,
  studios: string[] = [],
): DiscoverMedia {
  return {
    id: malId,
    malId,
    type: 'anime',
    title,
    genres,
    studios,
    score,
    provider: 'Kitsu',
    kitsuId: String(10_000 + malId),
    userCount,
    startDate: '2026-09-01',
    externalIds: {
      'myanimelist/anime': String(malId),
      kitsu: String(10_000 + malId),
    },
  };
}

class FakeDiscoverProvider implements DiscoverProvider {
  readonly name = 'Fake';

  constructor(private readonly items: DiscoverMedia[]) {}

  getTrending() {
    return Promise.resolve(this.items);
  }

  getPopular() {
    return Promise.resolve(this.items);
  }

  getTopRated() {
    return Promise.resolve(this.items);
  }

  getCurrent() {
    return Promise.resolve(this.items);
  }

  getUpcoming() {
    return Promise.resolve(this.items);
  }

  getSeasonal(_season: SeasonName, _year: number) {
    return Promise.resolve(this.items);
  }
}

describe('recomendação local', () => {
  it('prioriza afinidade com gêneros reais da biblioteca', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T12:00:00Z'));

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
    ];

    const fantasy = candidate(100, 'Fantasy Candidate', ['Fantasy', 'Adventure'], 8.2, 10_000);
    const sports = candidate(101, 'Sports Candidate', ['Sports'], 9.7, 100_000);

    const result = await getDiscoverHome(
      library,
      new FakeDiscoverProvider([sports, fantasy]),
    );

    expect(result.recommendations[0].malId).toBe(100);
    expect(result.recommendations[0].recommendationReasons?.join(' ')).toContain('Fantasy');
    expect(result.recommendations[0].recommendationReasons?.join(' ')).toContain('Frieren');
  });

  it('usa afinidade por estúdio quando o metadado existe dos dois lados', async () => {
    const library: LibraryEntry[] = [
      {
        media: {
          id: 999,
          malId: 999,
          type: 'anime',
          title: 'Favorito Madhouse',
          genres: ['Drama'],
          studios: ['MADHOUSE'],
        },
        status: 'completed',
        progress: 12,
        score: 10,
        updatedAt: '2026-10-01T00:00:00Z',
      },
    ];

    const otherStudio = candidate(
      400,
      'Outro Estúdio',
      ['Drama'],
      8.2,
      10_000,
      ['Bones'],
    );
    const matchingStudio = candidate(
      401,
      'Mesmo Estúdio',
      ['Drama'],
      8.2,
      10_000,
      ['Madhouse'],
    );

    const result = await getDiscoverHome(
      library,
      new FakeDiscoverProvider([otherStudio, matchingStudio]),
    );

    expect(result.recommendations[0].malId).toBe(401);
    expect(result.recommendations[0].recommendationReasons?.join(' ')).toContain('Madhouse');
  });

  it('não recomenda item que já está sendo gerenciado na biblioteca', async () => {
    const existing = candidate(200, 'Already Watched', ['Fantasy'], 10, 1_000_000);
    const fresh = candidate(201, 'Fresh Candidate', ['Fantasy'], 8.5, 5_000);

    const library: LibraryEntry[] = [
      {
        media: {
          id: 200,
          malId: 200,
          type: 'anime',
          title: 'Already Watched',
          genres: ['Fantasy'],
        },
        status: 'completed',
        progress: 12,
        score: 9,
        updatedAt: '2026-10-01T00:00:00Z',
      },
    ];

    const result = await getDiscoverHome(
      library,
      new FakeDiscoverProvider([existing, fresh]),
    );

    expect(result.recommendations.map((item) => item.malId)).not.toContain(200);
    expect(result.recommendations.map((item) => item.malId)).toContain(201);
  });

  it('funciona com biblioteca vazia sem inventar preferência', async () => {
    const highQuality = candidate(300, 'High Quality', ['Drama'], 9.5, 100_000);
    const lowQuality = candidate(301, 'Low Quality', ['Fantasy'], 6.0, 200);

    const result = await getDiscoverHome(
      [],
      new FakeDiscoverProvider([lowQuality, highQuality]),
    );

    expect(result.recommendations[0].malId).toBe(300);
    expect(
      result.recommendations.flatMap((item) => item.recommendationReasons ?? []),
    ).not.toContain(expect.stringContaining('seu interesse'));
  });
});
