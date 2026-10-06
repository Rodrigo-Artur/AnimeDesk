import { describe, expect, it, vi } from 'vitest';
import { enrichMalBatch } from '../src/services/enrichment';

describe('enriquecimento MAL → Kitsu', () => {
  it('resolve mapping, metadados, categorias e IDs externos', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              attributes: { externalId: '52991' },
              relationships: {
                item: {
                  data: { id: '46474', type: 'anime' },
                },
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: '46474',
              type: 'anime',
              attributes: {
                canonicalTitle: 'Sousou no Frieren',
                titles: { en: 'Frieren: Beyond Journey’s End' },
                synopsis: 'Uma jornada após a aventura.',
                averageRating: '93.5',
                startDate: '2023-09-29',
                status: 'finished',
                episodeCount: 28,
                posterImage: {
                  large: 'https://example.test/frieren.jpg',
                },
              },
              relationships: {
                categories: {
                  data: [
                    { id: 'fantasy', type: 'categories' },
                    { id: 'adventure', type: 'categories' },
                  ],
                },
              },
            },
          ],
          included: [
            { id: 'fantasy', type: 'categories', attributes: { title: 'Fantasy' } },
            { id: 'adventure', type: 'categories', attributes: { title: 'Adventure' } },
          ],
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const result = await enrichMalBatch([
      { malId: 52991, type: 'anime', title: 'Frieren' },
    ]);

    const media = result.get(52991);
    expect(media).toBeDefined();
    expect(media?.title).toBe('Sousou no Frieren');
    expect(media?.titleEnglish).toBe('Frieren: Beyond Journey’s End');
    expect(media?.score).toBe(9.35);
    expect(media?.episodes).toBe(28);
    expect(media?.year).toBe(2023);
    expect(media?.genres).toEqual(['Fantasy', 'Adventure']);
    expect(media?.externalIds).toEqual({
      'myanimelist/anime': '52991',
      kitsu: '46474',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('myanimelist%2Fanime');
    expect(String(fetchMock.mock.calls[1][0])).toContain('filter%5Bid%5D=46474');
  });

  it('retorna mapa vazio quando não existe mapping confiável', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    }));

    const result = await enrichMalBatch([
      { malId: 999999, type: 'anime', title: 'Desconhecido' },
    ]);

    expect(result.size).toBe(0);
  });

  it('rejeita lote misto e lote acima do limite do Kitsu', async () => {
    await expect(
      enrichMalBatch([
        { malId: 1, type: 'anime', title: 'A' },
        { malId: 1, type: 'manga', title: 'B' },
      ]),
    ).rejects.toThrow('apenas um tipo');

    await expect(
      enrichMalBatch(
        Array.from({ length: 21 }, (_, index) => ({
          malId: index + 1,
          type: 'anime' as const,
          title: `Anime ${index + 1}`,
        })),
      ),
    ).rejects.toThrow('20 itens');
  });
});
