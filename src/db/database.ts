import Database from '@tauri-apps/plugin-sql';
import type {
  LibraryEntry,
  Media,
  ReleaseItem,
  WatchHistoryEvent,
} from '../types/media';
import { isTauriRuntime } from '../services/platform';

const DB_URL = 'sqlite:animedesk.db';
let databasePromise: Promise<Database> | null = null;

type LibraryRow = {
  media_pk: number;
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
  studios_json: string;
  airing_status: string | null;
  library_status: LibraryEntry['status'];
  progress: number;
  user_score: number | null;
  updated_at: string;
};

type ExternalIdRow = {
  media_id: number;
  provider: string;
  external_id: string;
};

export type ResolvedExternalMedia = {
  type: Media['type'];
  malId: number;
  title: string;
  provider: string;
  externalId: string;
  confidence: number | null;
  verified: boolean;
};

export type ExternalMediaMapping = {
  provider: string;
  externalId: string;
  externalTitle?: string | null;
  confidence: number | null;
  verified: boolean;
  canonical: boolean;
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

function rowToEntry(
  row: LibraryRow,
  externalIds: Record<string, string>,
): LibraryEntry {
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
    studios: safeGenres(row.studios_json),
    status: row.airing_status ?? undefined,
    externalIds: {
      [`myanimelist/${row.type}`]: String(row.mal_id),
      ...externalIds,
    },
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
      m.id AS media_pk,
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
      m.studios_json,
      m.airing_status,
      l.status AS library_status,
      l.progress,
      l.score AS user_score,
      l.updated_at
    FROM library_entries l
    INNER JOIN media m ON m.id = l.media_id
    ORDER BY l.updated_at DESC
  `);

  const externalRows = await db.select<ExternalIdRow[]>(`
    SELECT media_id, provider, external_id
    FROM external_media_ids
  `);

  const externalByMedia = new Map<number, Record<string, string>>();
  for (const row of externalRows) {
    const ids = externalByMedia.get(row.media_id) ?? {};
    ids[row.provider] = row.external_id;
    externalByMedia.set(row.media_id, ids);
  }

  return rows.map((row) =>
    rowToEntry(row, externalByMedia.get(row.media_pk) ?? {}),
  );
}

async function upsertExternalMediaId(
  db: Database,
  media: Media,
  provider: string,
  externalId: string,
  confidence = 1,
  verified = true,
): Promise<void> {
  const cleanProvider = provider.trim().toLowerCase();
  const cleanExternalId = externalId.trim();
  const safeConfidence = Math.max(0, Math.min(1, confidence));
  if (!cleanProvider || !cleanExternalId) return;

  const targetRows = await db.select<Array<{ id: number }>>(
    'SELECT id FROM media WHERE type = $1 AND mal_id = $2 LIMIT 1',
    [media.type, media.malId],
  );
  const targetMediaId = targetRows[0]?.id;
  if (!targetMediaId) return;

  const existingRows = await db.select<Array<{
    media_id: number;
    type: Media['type'];
    mal_id: number;
    title: string;
  }>>(
    `SELECT
       e.media_id,
       m.type,
       m.mal_id,
       m.title
     FROM external_media_ids e
     INNER JOIN media m ON m.id = e.media_id
     WHERE e.provider = $1 AND e.external_id = $2
     LIMIT 1`,
    [cleanProvider, cleanExternalId],
  );

  const existing = existingRows[0];
  if (existing && existing.media_id !== targetMediaId) {
    throw new Error(
      `O ID ${cleanProvider}:${cleanExternalId} já pertence a ${existing.title} (${existing.type} MAL ${existing.mal_id}).`,
    );
  }

  await db.execute(
    `INSERT INTO external_media_ids (
       media_id, provider, external_id, external_title, confidence, verified
     ) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT(provider, external_id) DO UPDATE SET
       external_title=excluded.external_title,
       confidence=excluded.confidence,
       verified=excluded.verified`,
    [
      targetMediaId,
      cleanProvider,
      cleanExternalId,
      media.titleEnglish || media.title,
      safeConfidence,
      verified ? 1 : 0,
    ],
  );
}

export async function saveNativeEntry(entry: LibraryEntry): Promise<void> {
  const db = await getDatabase();
  if (!db) return;

  const media = entry.media;
  await db.execute(
    `INSERT INTO media (
      type, title, title_english, mal_id, cover_url, synopsis,
      total_episodes, total_chapters, score, year, genres_json, studios_json, airing_status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
      studios_json=excluded.studios_json,
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
      JSON.stringify(media.studios ?? []),
      media.status ?? null,
    ],
  );

  const externalIds = {
    [`myanimelist/${media.type}`]: String(media.malId),
    ...(media.externalIds ?? {}),
  };

  for (const [provider, externalId] of Object.entries(externalIds)) {
    try {
      await upsertExternalMediaId(db, media, provider, externalId);
    } catch (error) {
      const canonicalProvider = `myanimelist/${media.type}`;
      if (provider === canonicalProvider) throw error;
      console.warn(
        `ID externo ignorado por conflito (${provider}:${externalId}):`,
        error,
      );
    }
  }

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

export async function linkExternalMediaId(
  media: Media,
  provider: string,
  externalId: string,
  confidence = 1,
  verified = false,
): Promise<void> {
  const db = await getDatabase();
  if (!db) return;
  await upsertExternalMediaId(
    db,
    media,
    provider,
    externalId,
    confidence,
    verified,
  );
}

export async function getExternalMediaMappings(
  type: Media['type'],
  malId: number,
): Promise<ExternalMediaMapping[]> {
  const db = await getDatabase();
  const canonicalProvider = `myanimelist/${type}`;

  if (!db) {
    return [{
      provider: canonicalProvider,
      externalId: String(malId),
      externalTitle: null,
      confidence: 1,
      verified: true,
      canonical: true,
    }];
  }

  const rows = await db.select<Array<{
    provider: string;
    external_id: string;
    external_title: string | null;
    confidence: number | null;
    verified: number;
  }>>(
    `SELECT
       e.provider,
       e.external_id,
       e.external_title,
       e.confidence,
       e.verified
     FROM external_media_ids e
     INNER JOIN media m ON m.id = e.media_id
     WHERE m.type = $1 AND m.mal_id = $2
     ORDER BY CASE WHEN e.provider = $3 THEN 0 ELSE 1 END, e.provider`,
    [type, malId, canonicalProvider],
  );

  const mappings = rows.map((row) => ({
    provider: row.provider,
    externalId: row.external_id,
    externalTitle: row.external_title,
    confidence: row.confidence,
    verified: Boolean(row.verified),
    canonical: row.provider === canonicalProvider,
  }));

  if (!mappings.some((mapping) => mapping.provider === canonicalProvider)) {
    mappings.unshift({
      provider: canonicalProvider,
      externalId: String(malId),
      externalTitle: null,
      confidence: 1,
      verified: true,
      canonical: true,
    });
  }

  return mappings;
}

export async function unlinkExternalMediaId(
  type: Media['type'],
  malId: number,
  provider: string,
  externalId: string,
): Promise<void> {
  const db = await getDatabase();
  if (!db) return;

  const cleanProvider = provider.trim().toLowerCase();
  const canonicalProvider = `myanimelist/${type}`;
  if (cleanProvider === canonicalProvider) {
    throw new Error('O MAL ID canônico não pode ser removido.');
  }

  await db.execute(
    `DELETE FROM external_media_ids
     WHERE provider = $1
       AND external_id = $2
       AND media_id = (
         SELECT id FROM media
         WHERE type = $3 AND mal_id = $4
         LIMIT 1
       )`,
    [cleanProvider, externalId.trim(), type, malId],
  );
}

export async function getExternalMediaIds(
  type: Media['type'],
  malId: number,
): Promise<Record<string, string>> {
  const db = await getDatabase();
  if (!db) return { [`myanimelist/${type}`]: String(malId) };

  const rows = await db.select<Array<{ provider: string; external_id: string }>>(
    `SELECT e.provider, e.external_id
     FROM external_media_ids e
     INNER JOIN media m ON m.id = e.media_id
     WHERE m.type = $1 AND m.mal_id = $2`,
    [type, malId],
  );

  const result: Record<string, string> = {
    [`myanimelist/${type}`]: String(malId),
  };
  for (const row of rows) {
    result[row.provider] = row.external_id;
  }
  return result;
}

export async function resolveExternalMediaId(
  provider: string,
  externalId: string,
): Promise<ResolvedExternalMedia | null> {
  const db = await getDatabase();
  if (!db) return null;

  const cleanProvider = provider.trim().toLowerCase();
  const cleanExternalId = externalId.trim();

  if (
    cleanProvider === 'myanimelist/anime' ||
    cleanProvider === 'myanimelist/manga'
  ) {
    const type: Media['type'] = cleanProvider.endsWith('/manga') ? 'manga' : 'anime';
    const malId = Number(cleanExternalId);
    if (!Number.isInteger(malId) || malId <= 0) return null;

    const mediaRows = await db.select<Array<{
      type: Media['type'];
      mal_id: number;
      title: string;
    }>>(
      `SELECT type, mal_id, title
       FROM media
       WHERE type = $1 AND mal_id = $2
       LIMIT 1`,
      [type, malId],
    );

    const mediaRow = mediaRows[0];
    if (!mediaRow) return null;

    return {
      type: mediaRow.type,
      malId: mediaRow.mal_id,
      title: mediaRow.title,
      provider: cleanProvider,
      externalId: cleanExternalId,
      confidence: 1,
      verified: true,
    };
  }

  const rows = await db.select<Array<{
    type: Media['type'];
    mal_id: number;
    title: string;
    provider: string;
    external_id: string;
    confidence: number | null;
    verified: number;
  }>>(
    `SELECT
       m.type,
       m.mal_id,
       m.title,
       e.provider,
       e.external_id,
       e.confidence,
       e.verified
     FROM external_media_ids e
     INNER JOIN media m ON m.id = e.media_id
     WHERE e.provider = $1 AND e.external_id = $2
     LIMIT 1`,
    [cleanProvider, cleanExternalId],
  );

  const row = rows[0];
  if (!row) return null;

  return {
    type: row.type,
    malId: row.mal_id,
    title: row.title,
    provider: row.provider,
    externalId: row.external_id,
    confidence: row.confidence,
    verified: Boolean(row.verified),
  };
}

export async function cacheNativeReleases(
  items: ReleaseItem[],
): Promise<number> {
  const db = await getDatabase();
  if (!db) return 0;

  let cached = 0;

  for (const item of items) {
    if (!item.mediaMalId) continue;

    const mediaRows = await db.select<Array<{ id: number }>>(
      `SELECT id
       FROM media
       WHERE type = 'anime' AND mal_id = $1
       LIMIT 1`,
      [item.mediaMalId],
    );
    const mediaId = mediaRows[0]?.id;
    if (!mediaId) continue;

    const existingRows = await db.select<Array<{ id: number }>>(
      `SELECT id
       FROM releases
       WHERE media_id = $1
         AND provider = $2
         AND release_at = $3
         AND COALESCE(episode, -1) = COALESCE($4, -1)
         AND COALESCE(chapter, -1) = COALESCE($5, -1)
       LIMIT 1`,
      [
        mediaId,
        item.provider,
        item.releaseAt,
        item.episode ?? null,
        item.chapter ?? null,
      ],
    );

    const existingId = existingRows[0]?.id;
    if (existingId) {
      await db.execute(
        `UPDATE releases
         SET release_type = $2
         WHERE id = $1`,
        [existingId, item.airType ?? null],
      );
    } else {
      await db.execute(
        `INSERT INTO releases (
           media_id, episode, chapter, release_at, release_type, provider
         ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          mediaId,
          item.episode ?? null,
          item.chapter ?? null,
          item.releaseAt,
          item.airType ?? null,
          item.provider,
        ],
      );
    }

    cached += 1;
  }

  await db.execute(
    `DELETE FROM releases
     WHERE datetime(release_at) < datetime('now', '-30 days')`,
  );

  return cached;
}

export async function getNativeSetting(key: string): Promise<string | null> {
  const db = await getDatabase();
  if (!db) return null;

  const rows = await db.select<Array<{ value: string }>>(
    'SELECT value FROM settings WHERE key = $1 LIMIT 1',
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setNativeSetting(
  key: string,
  value: string,
): Promise<void> {
  const db = await getDatabase();
  if (!db) return;

  await db.execute(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET
       value=excluded.value,
       updated_at=CURRENT_TIMESTAMP`,
    [key, value],
  );
}

export async function deleteNativeSetting(key: string): Promise<void> {
  const db = await getDatabase();
  if (!db) return;
  await db.execute('DELETE FROM settings WHERE key = $1', [key]);
}

export async function getNativeSettingsByPrefix(
  prefix: string,
): Promise<Record<string, string>> {
  const db = await getDatabase();
  if (!db) return {};

  const rows = await db.select<Array<{ key: string; value: string }>>(
    `SELECT key, value
     FROM settings
     WHERE key LIKE $1
     ORDER BY key`,
    [`${prefix}%`],
  );

  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export async function removeNativeEntry(malId: number, type: Media['type']): Promise<void> {
  const db = await getDatabase();
  if (!db) return;

  await db.execute(
    'DELETE FROM library_entries WHERE media_id = (SELECT id FROM media WHERE type = $1 AND mal_id = $2)',
    [type, malId],
  );
}

export async function loadWatchHistory(
  limit = 300,
): Promise<WatchHistoryEvent[]> {
  const db = await getDatabase();
  if (!db) return [];

  const safeLimit = Math.max(1, Math.min(1000, Math.trunc(limit) || 300));

  const rows = await db.select<Array<{
    id: number;
    media_type: Media['type'];
    mal_id: number;
    title: string;
    title_english: string | null;
    cover_url: string | null;
    episode: number | null;
    chapter: number | null;
    provider: string | null;
    watched_at: string;
    source_event_id: string | null;
  }>>(
    `SELECT
       h.id,
       m.type AS media_type,
       m.mal_id,
       m.title,
       m.title_english,
       m.cover_url,
       h.episode,
       h.chapter,
       h.provider,
       h.watched_at,
       h.source_event_id
     FROM watch_history h
     INNER JOIN media m ON m.id = h.media_id
     ORDER BY datetime(h.watched_at) DESC, h.id DESC
     LIMIT $1`,
    [safeLimit],
  );

  return rows.map((row) => ({
    id: row.id,
    mediaType: row.media_type,
    mediaMalId: row.mal_id,
    mediaTitle: row.title,
    mediaTitleEnglish: row.title_english,
    imageUrl: row.cover_url ?? undefined,
    episode: row.episode,
    chapter: row.chapter,
    provider: row.provider || 'manual',
    watchedAt: row.watched_at,
    sourceEventId: row.source_event_id,
  }));
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
