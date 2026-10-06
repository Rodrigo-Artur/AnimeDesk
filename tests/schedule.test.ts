import { describe, expect, it, vi } from 'vitest';
import { getWeeklySchedule } from '../src/services/schedule';
import type { LibraryEntry } from '../src/types/media';

describe('agenda AnimeSchedule', () => {
  it('faz matching da biblioteca, ordena horários e persiste cache/last-sync', async () => {
    vi.stubEnv('VITE_ANIMESCHEDULE_TOKEN', 'test-token');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          title: 'Sousou no Frieren',
          english: 'Frieren: Beyond Journey’s End',
          route: 'frieren',
          episodeDate: '2026-10-08T15:00:00Z',
          episodeNumber: 30,
          imageVersionRoute: 'frieren.webp',
          airType: 'sub',
        },
        {
          title: 'Another Show',
          route: 'another-show',
          episodeDate: '2026-10-07T12:00:00Z',
          episodeNumber: 2,
          airType: 'sub',
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const library: LibraryEntry[] = [
      {
        media: {
          id: 52991,
          malId: 52991,
          type: 'anime',
          title: 'Sousou no Frieren',
          titleEnglish: 'Frieren: Beyond Journey’s End',
          genres: ['Fantasy'],
        },
        status: 'watching',
        progress: 28,
        updatedAt: '2026-10-01T00:00:00Z',
      },
    ];

    const result = await getWeeklySchedule(library);

    expect(result.source).toBe('AnimeSchedule');
    expect(result.cached).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].mediaTitle).toBe('Another Show');
    expect(result.items[1].mediaMalId).toBe(52991);
    expect(result.items[1].inLibrary).toBe(true);
    expect(result.items[1].episode).toBe(30);
    expect(result.items[1].imageUrl).toContain('frieren.webp');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/timetables/sub');
    expect(options.headers.Authorization).toBe('Bearer test-token');

    const cached = JSON.parse(
      localStorage.getItem('animedesk-weekly-schedule-cache-v1') || '{}',
    );
    expect(cached.result.source).toBe('AnimeSchedule');
    expect(cached.result.items).toHaveLength(2);
    expect(localStorage.getItem('animedesk-last-sync:schedule')).toMatch(/^\d{4}-/);
  });
});
