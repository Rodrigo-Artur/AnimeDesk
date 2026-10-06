import { describe, expect, it } from 'vitest';
import {
  canonicalMalProvider,
  canonicalMediaKey,
  normalizeProviderName,
  withExternalId,
} from '../src/services/normalizer';
import type { Media } from '../src/types/media';

function media(type: 'anime' | 'manga', malId: number): Media {
  return {
    id: malId,
    malId,
    type,
    title: `${type} ${malId}`,
    genres: [],
  };
}

describe('normalizador de IDs externos', () => {
  it('mantém namespaces MAL separados por tipo', () => {
    expect(canonicalMalProvider('anime')).toBe('myanimelist/anime');
    expect(canonicalMalProvider('manga')).toBe('myanimelist/manga');
    expect(canonicalMediaKey(media('anime', 1))).toBe('anime:1');
    expect(canonicalMediaKey(media('manga', 1))).toBe('manga:1');
  });

  it('normaliza aliases sem destruir providers desconhecidos', () => {
    expect(normalizeProviderName('MAL', 'anime')).toBe('myanimelist/anime');
    expect(normalizeProviderName('MyAnimeList', 'manga')).toBe('myanimelist/manga');
    expect(normalizeProviderName('Prime Video')).toBe('primevideo');
    expect(normalizeProviderName('Crunchy')).toBe('crunchyroll');
    expect(normalizeProviderName('Disney+')).toBe('disneyplus');
    expect(normalizeProviderName('  Meu Provider  ')).toBe('meuprovider');
  });

  it('adiciona ID externo preservando MAL canônico e IDs existentes', () => {
    const initial: Media = {
      ...media('anime', 52991),
      externalIds: {
        tmdb: '209867',
      },
    };

    const enriched = withExternalId(initial, 'Kitsu', ' 46474 ');

    expect(enriched.externalIds).toEqual({
      'myanimelist/anime': '52991',
      tmdb: '209867',
      kitsu: '46474',
    });
    expect(initial.externalIds).toEqual({ tmdb: '209867' });
  });

  it('ignora ID vazio sem mutar a mídia', () => {
    const initial = media('anime', 52991);
    expect(withExternalId(initial, 'kitsu', '   ')).toBe(initial);
  });
});
