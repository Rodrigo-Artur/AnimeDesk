import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  loadNativeLibrary,
  recordManualProgress,
  removeNativeEntry,
  saveNativeEntry,
} from '../db/database';
import { cacheMediaCover } from '../services/covers';
import { isTauriRuntime } from '../services/platform';
import type { LibraryEntry, LibraryStatus, Media } from '../types/media';

type StorageMode = 'localStorage' | 'sqlite';

export type LibraryImportReport = {
  total: number;
  added: number;
  updated: number;
  unchanged: number;
};

type LibraryStore = {
  entries: LibraryEntry[];
  initialized: boolean;
  storageMode: StorageMode;
  initializePersistence: () => Promise<void>;
  add: (media: Media, status?: LibraryStatus) => void;
  remove: (malId: number, type: Media['type']) => void;
  setStatus: (malId: number, type: Media['type'], status: LibraryStatus) => void;
  incrementProgress: (malId: number, type: Media['type']) => void;
  cacheCover: (malId: number, type: Media['type']) => Promise<boolean>;
  importEntries: (entries: LibraryEntry[]) => Promise<LibraryImportReport>;
};

function mediaKey(media: Pick<Media, 'type' | 'malId'>): string {
  return `${media.type}:${media.malId}`;
}

function persistEntry(entry: LibraryEntry) {
  if (!isTauriRuntime()) return;
  void saveNativeEntry(entry).catch((error) => {
    console.error('Falha ao persistir item no SQLite:', error);
  });
}

function mergeImportedEntry(existing: LibraryEntry, incoming: LibraryEntry): LibraryEntry {
  return {
    ...existing,
    media: {
      ...incoming.media,
      ...existing.media,
      title: existing.media.title || incoming.media.title,
      titleEnglish: existing.media.titleEnglish ?? incoming.media.titleEnglish,
      imageUrl: existing.media.imageUrl ?? incoming.media.imageUrl,
      synopsis: existing.media.synopsis ?? incoming.media.synopsis,
      episodes: incoming.media.episodes ?? existing.media.episodes,
      chapters: incoming.media.chapters ?? existing.media.chapters,
      status: existing.media.status ?? incoming.media.status,
      year: existing.media.year ?? incoming.media.year,
      genres: existing.media.genres.length ? existing.media.genres : incoming.media.genres,
    },
    status: incoming.status,
    progress: incoming.progress,
    score: incoming.score,
    updatedAt: new Date().toISOString(),
  };
}

function importValuesChanged(existing: LibraryEntry, incoming: LibraryEntry): boolean {
  return (
    existing.status !== incoming.status ||
    existing.progress !== incoming.progress ||
    (existing.score ?? null) !== (incoming.score ?? null) ||
    (existing.media.episodes ?? null) !== (incoming.media.episodes ?? null) ||
    (existing.media.chapters ?? null) !== (incoming.media.chapters ?? null)
  );
}

export const useLibraryStore = create<LibraryStore>()(
  persist(
    (set, get) => ({
      entries: [],
      initialized: false,
      storageMode: 'localStorage',

      initializePersistence: async () => {
        if (!isTauriRuntime()) {
          set({ initialized: true, storageMode: 'localStorage' });
          return;
        }

        try {
          const nativeEntries = await loadNativeLibrary();
          const localEntries = get().entries;

          if (nativeEntries.length > 0) {
            set({
              entries: nativeEntries,
              initialized: true,
              storageMode: 'sqlite',
            });
            return;
          }

          if (localEntries.length > 0) {
            for (const entry of localEntries) {
              await saveNativeEntry(entry);
            }
          }

          set({ initialized: true, storageMode: 'sqlite' });
        } catch (error) {
          console.error('Falha ao inicializar SQLite; usando fallback local:', error);
          set({ initialized: true, storageMode: 'localStorage' });
        }
      },

      add: (media, status = 'planned') => {
        if (get().entries.some((entry) => mediaKey(entry.media) === mediaKey(media))) return;

        const entry: LibraryEntry = {
          media,
          status,
          progress: 0,
          updatedAt: new Date().toISOString(),
        };

        set((state) => ({ entries: [...state.entries, entry] }));
        persistEntry(entry);

        if (isTauriRuntime() && media.imageUrl) {
          void get().cacheCover(media.malId, media.type);
        }
      },

      remove: (malId, type) => {
        set((state) => ({
          entries: state.entries.filter(
            (entry) => !(entry.media.malId === malId && entry.media.type === type),
          ),
        }));

        if (isTauriRuntime()) {
          void removeNativeEntry(malId, type).catch((error) => {
            console.error('Falha ao remover item do SQLite:', error);
          });
        }
      },

      setStatus: (malId, type, status) => {
        const current = get().entries.find(
          (entry) => entry.media.malId === malId && entry.media.type === type,
        );
        if (!current) return;

        const updated: LibraryEntry = {
          ...current,
          status,
          updatedAt: new Date().toISOString(),
        };

        set((state) => ({
          entries: state.entries.map((entry) =>
            entry.media.malId === malId && entry.media.type === type ? updated : entry,
          ),
        }));
        persistEntry(updated);
      },

      incrementProgress: (malId, type) => {
        const current = get().entries.find(
          (entry) => entry.media.malId === malId && entry.media.type === type,
        );
        if (!current) return;

        const total = current.media.type === 'manga'
          ? current.media.chapters
          : current.media.episodes;
        const nextProgress = Math.min(
          current.progress + 1,
          total ?? Number.MAX_SAFE_INTEGER,
        );
        if (nextProgress === current.progress) return;

        const updated: LibraryEntry = {
          ...current,
          progress: nextProgress,
          updatedAt: new Date().toISOString(),
        };

        set((state) => ({
          entries: state.entries.map((entry) =>
            entry.media.malId === malId && entry.media.type === type ? updated : entry,
          ),
        }));

        persistEntry(updated);
        if (isTauriRuntime()) {
          void recordManualProgress(malId, nextProgress, current.media.type).catch((error) => {
            console.error('Falha ao registrar histórico:', error);
          });
        }
      },

      cacheCover: async (malId, type) => {
        const current = get().entries.find(
          (entry) => entry.media.malId === malId && entry.media.type === type,
        );
        if (!current?.media.imageUrl) return false;

        try {
          const localUrl = await cacheMediaCover(current.media);
          if (!localUrl) return false;

          const updated: LibraryEntry = {
            ...current,
            media: {
              ...current.media,
              imageUrl: localUrl,
            },
            updatedAt: new Date().toISOString(),
          };

          set((state) => ({
            entries: state.entries.map((entry) =>
              entry.media.malId === malId && entry.media.type === type ? updated : entry,
            ),
          }));
          persistEntry(updated);
          return true;
        } catch (error) {
          console.error('Falha ao cachear capa localmente:', error);
          return false;
        }
      },

      importEntries: async (incomingEntries) => {
        const existingEntries = get().entries;
        const byKey = new Map(existingEntries.map((entry) => [mediaKey(entry.media), entry]));
        const nextByKey = new Map(existingEntries.map((entry) => [mediaKey(entry.media), entry]));
        const changed: LibraryEntry[] = [];

        let added = 0;
        let updated = 0;
        let unchanged = 0;

        for (const incoming of incomingEntries) {
          const key = mediaKey(incoming.media);
          const existing = byKey.get(key);

          if (!existing) {
            const next = { ...incoming, updatedAt: new Date().toISOString() };
            nextByKey.set(key, next);
            changed.push(next);
            added += 1;
            continue;
          }

          if (!importValuesChanged(existing, incoming)) {
            unchanged += 1;
            continue;
          }

          const merged = mergeImportedEntry(existing, incoming);
          nextByKey.set(key, merged);
          changed.push(merged);
          updated += 1;
        }

        if (isTauriRuntime()) {
          for (const entry of changed) {
            await saveNativeEntry(entry);
          }
        }

        set({ entries: Array.from(nextByKey.values()) });

        return {
          total: incomingEntries.length,
          added,
          updated,
          unchanged,
        };
      },
    }),
    {
      name: 'animedesk-library-v1',
      partialize: (state) => ({ entries: state.entries }),
    },
  ),
);
