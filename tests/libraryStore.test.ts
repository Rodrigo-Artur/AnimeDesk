import { beforeEach, describe, expect, it } from 'vitest';
import { useLibraryStore } from '../src/store/library';
import type { LibraryEntry, Media } from '../src/types/media';

function baseMedia(): Media {
  return {
    id: 52991,
    malId: 52991,
    type: 'anime',
    title: 'Sousou no Frieren',
    genres: ['Fantasy'],
    externalIds: {
      'myanimelist/anime': '52991',
    },
  };
}

function resetStore(entries: LibraryEntry[] = []) {
  localStorage.clear();
  useLibraryStore.setState({
    entries,
    initialized: true,
    storageMode: 'localStorage',
  });
}

describe('library store', () => {
  beforeEach(() => resetStore());

  it('enriquece metadados sem perder status, progresso ou nota pessoal', async () => {
    resetStore([
      {
        media: baseMedia(),
        status: 'watching',
        progress: 12,
        score: 9,
        updatedAt: '2026-10-01T00:00:00Z',
      },
    ]);

    const enriched: Media = {
      ...baseMedia(),
      titleEnglish: 'Frieren: Beyond Journey’s End',
      imageUrl: 'https://example.test/frieren.jpg',
      score: 8.9,
      episodes: 28,
      synopsis: 'Uma jornada depois da aventura.',
      genres: ['Fantasy', 'Adventure'],
      year: 2023,
      externalIds: {
        'myanimelist/anime': '52991',
        kitsu: '46474',
      },
    };

    const applied = await useLibraryStore.getState().applyEnrichment(enriched);
    expect(applied).toBe(true);

    const entry = useLibraryStore.getState().entries[0];
    expect(entry.status).toBe('watching');
    expect(entry.progress).toBe(12);
    expect(entry.score).toBe(9);
    expect(entry.media.titleEnglish).toBe('Frieren: Beyond Journey’s End');
    expect(entry.media.episodes).toBe(28);
    expect(entry.media.genres).toEqual(['Fantasy', 'Adventure']);
    expect(entry.media.externalIds).toEqual({
      'myanimelist/anime': '52991',
      kitsu: '46474',
    });
  });

  it('força o MAL canônico correto ao sincronizar externalIds', async () => {
    resetStore([
      {
        media: baseMedia(),
        status: 'planned',
        progress: 0,
        updatedAt: '2026-10-01T00:00:00Z',
      },
    ]);

    const updated = await useLibraryStore.getState().setExternalIds(
      52991,
      'anime',
      {
        kitsu: '46474',
        'myanimelist/anime': '999999',
      },
    );

    expect(updated).toBe(true);
    expect(useLibraryStore.getState().entries[0].media.externalIds).toEqual({
      kitsu: '46474',
      'myanimelist/anime': '52991',
    });
  });

  it('merge de importação atualiza dados pessoais e preserva metadados ricos', async () => {
    resetStore([
      {
        media: {
          ...baseMedia(),
          titleEnglish: 'Frieren: Beyond Journey’s End',
          imageUrl: 'asset://frieren.jpg',
          synopsis: 'Sinopse local rica',
          genres: ['Fantasy', 'Adventure'],
          externalIds: {
            'myanimelist/anime': '52991',
            kitsu: '46474',
          },
        },
        status: 'watching',
        progress: 5,
        score: 8,
        updatedAt: '2026-10-01T00:00:00Z',
      },
    ]);

    const report = await useLibraryStore.getState().importEntries([
      {
        media: {
          ...baseMedia(),
          episodes: 28,
        },
        status: 'completed',
        progress: 28,
        score: 10,
        updatedAt: '2026-10-06T00:00:00Z',
      },
    ]);

    expect(report).toEqual({
      total: 1,
      added: 0,
      updated: 1,
      unchanged: 0,
    });

    const entry = useLibraryStore.getState().entries[0];
    expect(entry.status).toBe('completed');
    expect(entry.progress).toBe(28);
    expect(entry.score).toBe(10);
    expect(entry.media.titleEnglish).toBe('Frieren: Beyond Journey’s End');
    expect(entry.media.imageUrl).toBe('asset://frieren.jpg');
    expect(entry.media.synopsis).toBe('Sinopse local rica');
    expect(entry.media.genres).toEqual(['Fantasy', 'Adventure']);
    expect(entry.media.episodes).toBe(28);
    expect(entry.media.externalIds?.kitsu).toBe('46474');
  });
});
