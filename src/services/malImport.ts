import type { LibraryEntry, LibraryStatus, Media, MediaType } from '../types/media';

export type MalImportPreview = {
  entries: LibraryEntry[];
  username?: string;
  animeCount: number;
  mangaCount: number;
  skipped: number;
};

function text(node: Element, ...names: string[]): string {
  for (const name of names) {
    const value = node.querySelector(name)?.textContent?.trim();
    if (value) return value;
  }
  return '';
}

function numberOrUndefined(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function yearFromDate(value: string): number | undefined {
  const match = value.match(/^(\d{4})-/);
  if (!match) return undefined;
  const year = Number(match[1]);
  return year > 0 ? year : undefined;
}

function mapStatus(value: string, type: MediaType): LibraryStatus {
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, ' ');

  if (normalized === '1' || normalized === 'watching' || normalized === 'reading') {
    return type === 'manga' ? 'reading' : 'watching';
  }
  if (normalized === '2' || normalized === 'completed') return 'completed';
  if (normalized === '3' || normalized === 'on hold' || normalized === 'on-hold' || normalized === 'paused') return 'paused';
  if (normalized === '4' || normalized === 'dropped') return 'dropped';
  if (
    normalized === '6' ||
    normalized === 'plan to watch' ||
    normalized === 'plan to read' ||
    normalized === 'planned'
  ) return 'planned';

  return 'planned';
}

function parseAnime(node: Element): LibraryEntry | null {
  const malId = numberOrUndefined(text(node, 'series_animedb_id'));
  const title = text(node, 'series_title');
  if (!malId || !title) return null;

  const episodes = numberOrUndefined(text(node, 'series_episodes'));
  const progress = numberOrUndefined(text(node, 'my_watched_episodes')) ?? 0;
  const score = numberOrUndefined(text(node, 'my_score'));
  const status = mapStatus(text(node, 'my_status'), 'anime');

  const media: Media = {
    id: malId,
    malId,
    type: 'anime',
    title,
    imageUrl: text(node, 'series_image') || undefined,
    episodes,
    status: text(node, 'series_status') || undefined,
    genres: [],
    year: yearFromDate(text(node, 'series_start')),
  };

  return {
    media,
    status,
    progress,
    score: score && score > 0 ? score : undefined,
    updatedAt: new Date().toISOString(),
  };
}

function parseManga(node: Element): LibraryEntry | null {
  const malId = numberOrUndefined(text(node, 'manga_mangadb_id', 'series_mangadb_id', 'series_animedb_id'));
  const title = text(node, 'manga_title', 'series_title');
  if (!malId || !title) return null;

  const chapters = numberOrUndefined(text(node, 'manga_chapters', 'series_chapters'));
  const progress = numberOrUndefined(text(node, 'my_read_chapters', 'my_watched_episodes')) ?? 0;
  const score = numberOrUndefined(text(node, 'my_score'));
  const status = mapStatus(text(node, 'my_status'), 'manga');

  const media: Media = {
    id: malId,
    malId,
    type: 'manga',
    title,
    imageUrl: text(node, 'manga_image', 'series_image') || undefined,
    chapters,
    status: text(node, 'manga_status', 'series_status') || undefined,
    genres: [],
    year: yearFromDate(text(node, 'manga_start', 'series_start')),
  };

  return {
    media,
    status,
    progress,
    score: score && score > 0 ? score : undefined,
    updatedAt: new Date().toISOString(),
  };
}

export async function readMalExportFile(file: File): Promise<string> {
  const compressed = file.name.toLowerCase().endsWith('.gz') || file.type === 'application/gzip';
  if (!compressed) return file.text();

  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Este arquivo está compactado em GZip e o WebView atual não oferece descompactação.');
  }

  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export function parseMalExportXml(xml: string): MalImportPreview {
  const documentXml = new DOMParser().parseFromString(xml, 'application/xml');
  const parseError = documentXml.querySelector('parsererror');
  if (parseError) {
    throw new Error('O arquivo XML não pôde ser lido. Verifique se ele foi exportado pelo MyAnimeList.');
  }

  const animeNodes = Array.from(documentXml.querySelectorAll('myanimelist > anime, anime'));
  const mangaNodes = Array.from(documentXml.querySelectorAll('myanimelist > manga, manga'));

  const entries: LibraryEntry[] = [];
  let skipped = 0;

  for (const node of animeNodes) {
    const parsed = parseAnime(node);
    if (parsed) entries.push(parsed);
    else skipped += 1;
  }

  for (const node of mangaNodes) {
    const parsed = parseManga(node);
    if (parsed) entries.push(parsed);
    else skipped += 1;
  }

  const deduped = new Map<string, LibraryEntry>();
  for (const entry of entries) {
    deduped.set(`${entry.media.type}:${entry.media.malId}`, entry);
  }

  const username =
    documentXml.querySelector('myinfo > user_name')?.textContent?.trim() ||
    documentXml.querySelector('user_name')?.textContent?.trim() ||
    undefined;

  const finalEntries = Array.from(deduped.values());

  if (!finalEntries.length) {
    throw new Error('Nenhum anime ou mangá compatível foi encontrado nesse XML.');
  }

  return {
    entries: finalEntries,
    username,
    animeCount: finalEntries.filter((entry) => entry.media.type === 'anime').length,
    mangaCount: finalEntries.filter((entry) => entry.media.type === 'manga').length,
    skipped,
  };
}
