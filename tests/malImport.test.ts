import { describe, expect, it } from 'vitest';
import { parseMalExportXml } from '../src/services/malImport';

describe('importação MAL XML', () => {
  it('importa anime e mangá com o mesmo ID sem colisão', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <myanimelist>
        <myinfo><user_name>moonii</user_name></myinfo>
        <anime>
          <series_animedb_id>1</series_animedb_id>
          <series_title>Anime One</series_title>
          <series_episodes>12</series_episodes>
          <series_status>Currently Airing</series_status>
          <series_start>2026-01-02</series_start>
          <my_watched_episodes>4</my_watched_episodes>
          <my_score>9</my_score>
          <my_status>Watching</my_status>
        </anime>
        <manga>
          <manga_mangadb_id>1</manga_mangadb_id>
          <manga_title>Manga One</manga_title>
          <manga_chapters>30</manga_chapters>
          <manga_status>Publishing</manga_status>
          <manga_start>2025-05-01</manga_start>
          <my_read_chapters>30</my_read_chapters>
          <my_score>8</my_score>
          <my_status>Completed</my_status>
        </manga>
      </myanimelist>`;

    const preview = parseMalExportXml(xml);

    expect(preview.username).toBe('moonii');
    expect(preview.animeCount).toBe(1);
    expect(preview.mangaCount).toBe(1);
    expect(preview.entries).toHaveLength(2);

    const anime = preview.entries.find((entry) => entry.media.type === 'anime')!;
    const manga = preview.entries.find((entry) => entry.media.type === 'manga')!;

    expect(anime.media.malId).toBe(1);
    expect(anime.media.externalIds).toEqual({ 'myanimelist/anime': '1' });
    expect(anime.status).toBe('watching');
    expect(anime.progress).toBe(4);
    expect(anime.score).toBe(9);
    expect(anime.media.episodes).toBe(12);
    expect(anime.media.year).toBe(2026);

    expect(manga.media.malId).toBe(1);
    expect(manga.media.externalIds).toEqual({ 'myanimelist/manga': '1' });
    expect(manga.status).toBe('completed');
    expect(manga.progress).toBe(30);
    expect(manga.score).toBe(8);
    expect(manga.media.chapters).toBe(30);
  });

  it('deduplica repetição da mesma mídia por tipo + MAL ID', () => {
    const xml = `<myanimelist>
      <anime>
        <series_animedb_id>21</series_animedb_id>
        <series_title>One Piece</series_title>
        <my_watched_episodes>100</my_watched_episodes>
        <my_status>Watching</my_status>
      </anime>
      <anime>
        <series_animedb_id>21</series_animedb_id>
        <series_title>One Piece</series_title>
        <my_watched_episodes>101</my_watched_episodes>
        <my_status>Watching</my_status>
      </anime>
    </myanimelist>`;

    const preview = parseMalExportXml(xml);
    expect(preview.entries).toHaveLength(1);
    expect(preview.entries[0].progress).toBe(101);
  });

  it('rejeita XML inválido ou sem mídia compatível', () => {
    expect(() => parseMalExportXml('<myanimelist><anime>')).toThrow();
    expect(() => parseMalExportXml('<myanimelist><myinfo /></myanimelist>')).toThrow(
      'Nenhum anime ou mangá compatível',
    );
  });
});
