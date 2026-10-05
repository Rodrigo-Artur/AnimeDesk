import Database from '@tauri-apps/plugin-sql';
import type { LibraryEntry, Media } from '../types/media';
import { isTauriRuntime } from '../services/platform';

const DB_URL = 'sqlite:animedesk.db';
let databasePromise: Promise<Database> | null = null;

type LibraryRow = {
  mal_id: number;
  type: 'anime' | 'manga';
  title: string;
  title_english: string | null;
  cover_url: string | null;
  synopsis: string | null;
  total_episodes: number | null;
  total_chapters: number | null;
  media_score: number | null;
  year: number | null;
  genres_json: string;
  airing_status: string | null;
  library_status: LibraryEntry['status'];
  progress: number;
  user_score: number | null;
  updated_at: string;
};

async function getDatabase(): Promise<Database | null> {
  if (!isTauriRuntime()) return null;

  databasePromise ??= Database.load(DB_URL).then(async (db) => {
    await db.execute('PRAGMA foreign_keys = ON');
    return db;
  });

  return databasePromise;
}

function safeGenres(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function rowToEntry(row: LibraryRow): LibraryEntry {
  const media: Media = {
    id: row.mal_id,
    malId: row.mal_id,
    type: row.type,
    title: row.title,
    titleEnglish: row.title_english,
    imageUrl: row.cover_url ?? undefined,
    synopsis: row.synopsis ?? undefined,
    episodes: row.total_episodes,
    chapters: row.total_chapters,
    score: row.media_score,
    year: row.year,
    genres: safeGenres(row.genres_json),
    status: row.airing_status ?? undefined,
  };

  return {
    media,
    status: row.library_status,
    progress: row.progress,
    score: row.user_score ?? undefined,
    updatedAt: row.updated_at,
  };
}

export async function loadNativeLibrary(): Promise<LibraryEntry[]> {
  const db = await getDatabase();
  if (!db) return [];

  const rows = await db.select<LibraryRow[]>(`
    SELECT
      m.mal_id,
      m.type,
      m.title,
      m.title_english,
      m.cover_url,
      m.synopsis,
      m.total_episodes,
      m.total_chapters,
      m.score AS media_score,
      m.year,
      m.genres_json,
      m.airing_status,
      l.status AS library_status,
      l.progress,
      l.score AS user_score,
      l.updated_at
    FROM library_entries l
    INNER JOIN media m ON m.id = l.media_id
    ORDER BY l.updated_at DESC
  `);

  return rows.map(rowToEntry);
}

export async function saveNativeEntry(entry: LibraryEntry): Promise<void> {
  const db = await getDatabase();
  if (!db) return;

  const media = entry.media;
  await db.execute(
    `INSERT INTO media (
      type, title, title_english, mal_id, cover_url, synopsis,
      total_episodes, total_chapters, score, year, genres_json, airing_status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT(type, mal_id) DO UPDATE SET
      type=excluded.type,
      title=excluded.title,
      title_english=excluded.title_english,
      cover_url=excluded.cover_url,
      synopsis=excluded.synopsis,
      total_episodes=excluded.total_episodes,
      total_chapters=excluded.total_chapters,
      score=excluded.score,
      year=excluded.year,
      genres_json=excluded.genres_json,
      airing_status=excluded.airing_status,
      cached_at=CURRENT_TIMESTAMP`,
    [
      media.type,
      media.title,
      media.titleEnglish ?? null,
      media.malId,
      media.imageUrl ?? null,
      media.synopsis ?? null,
      media.episodes ?? null,
      media.chapters ?? null,
      media.score ?? null,
      media.year ?? null,
      JSON.stringify(media.genres),
      media.status ?? null,
    ],
  );

  await db.execute(
    `INSERT INTO library_entries (media_id, status, progress, score, updated_at)
     SELECT id, $3, $4, $5, $6 FROM media WHERE type = $1 AND mal_id = $2
     ON CONFLICT(media_id) DO UPDATE SET
       status=excluded.status,
       progress=excluded.progress,
       score=excluded.score,
       updated_at=excluded.updated_at`,
    [media.type, media.malId, entry.status, entry.progress, entry.score ?? null, entry.updatedAt],
  );
}

export async function removeNativeEntry(malId: number, type: Media['type']): Promise<void> {
  const db = await getDatabase();
  if (!db) return;

  await db.execute(
    'DELETE FROM library_entries WHERE media_id = (SELECT id FROM media WHERE type = $1 AND mal_id = $2)',
    [type, malId],
  );
}

export async function recordManualProgress(
  malId: number,
  progress: number,
  type: Media['type'],
): Promise<void> {
  const db = await getDatabase();
  if (!db) return;

  if (type === 'manga') {
    await db.execute(
      `INSERT INTO watch_history (media_id, chapter, provider, watched_at)
       SELECT id, $3, 'manual', CURRENT_TIMESTAMP FROM media WHERE type = $1 AND mal_id = $2`,
      [type, malId, progress],
    );
    return;
  }

  await db.execute(
    `INSERT INTO watch_history (media_id, episode, provider, watched_at)
     SELECT id, $3, 'manual', CURRENT_TIMESTAMP FROM media WHERE type = $1 AND mal_id = $2`,
    [type, malId, progress],
  );
}
