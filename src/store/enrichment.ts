import { create } from 'zustand';
import { setLastSync } from '../services/appState';
import { enrichMalBatch } from '../services/enrichment';
import type {
  EnrichmentFailure,
  EnrichmentTarget,
} from '../services/enrichment';
import { useLibraryStore } from './library';
import type { LibraryEntry, MediaType } from '../types/media';

export type EnrichmentStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'cancelled';

type EnrichmentStore = {
  status: EnrichmentStatus;
  total: number;
  processed: number;
  enriched: number;
  coversCached: number;
  failures: EnrichmentFailure[];
  currentTitle: string;
  startedAt?: string;
  finishedAt?: string;
  start: (entries: LibraryEntry[]) => Promise<void>;
  cancel: () => void;
  retryFailed: () => Promise<void>;
  reset: () => void;
};

let activeRunToken = 0;

function key(target: EnrichmentTarget): string {
  return `${target.type}:${target.malId}`;
}

function toTargets(entries: LibraryEntry[]): EnrichmentTarget[] {
  const deduped = new Map<string, EnrichmentTarget>();
  for (const entry of entries) {
    const target: EnrichmentTarget = {
      malId: entry.media.malId,
      type: entry.media.type,
      title: entry.media.titleEnglish || entry.media.title,
    };
    deduped.set(key(target), target);
  }
  return Array.from(deduped.values());
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function isLocalCover(url?: string): boolean {
  return Boolean(url && (url.startsWith('asset:') || url.includes('asset.localhost')));
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTargets(targets: EnrichmentTarget[]) {
  if (!targets.length) return;
  if (useEnrichmentStore.getState().status === 'running') return;

  const token = ++activeRunToken;
  useEnrichmentStore.setState({
    status: 'running',
    total: targets.length,
    processed: 0,
    enriched: 0,
    coversCached: 0,
    failures: [],
    currentTitle: '',
    startedAt: new Date().toISOString(),
    finishedAt: undefined,
  });

  const grouped = new Map<MediaType, EnrichmentTarget[]>([
    ['anime', []],
    ['manga', []],
  ]);
  for (const target of targets) {
    grouped.get(target.type)?.push(target);
  }

  let processed = 0;
  let enriched = 0;
  let coversCached = 0;
  const failures: EnrichmentFailure[] = [];

  for (const mediaType of ['anime', 'manga'] as const) {
    for (const batch of chunk(grouped.get(mediaType) ?? [], 20)) {
      if (token !== activeRunToken) {
        useEnrichmentStore.setState({
          status: 'cancelled',
          currentTitle: '',
          finishedAt: new Date().toISOString(),
        });
        return;
      }

      useEnrichmentStore.setState({
        currentTitle:
          batch.length === 1
            ? batch[0].title
            : `${batch[0].title} + ${batch.length - 1} item(ns)`,
      });

      let enrichedByMal = new Map<number, import('../types/media').Media>();

      try {
        enrichedByMal = await enrichMalBatch(batch);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        for (const target of batch) {
          failures.push({ ...target, reason });
        }
        processed += batch.length;
        useEnrichmentStore.setState({
          processed,
          failures: [...failures],
        });
        await delay(350);
        continue;
      }

      for (const target of batch) {
        if (token !== activeRunToken) {
          useEnrichmentStore.setState({
            status: 'cancelled',
            currentTitle: '',
            finishedAt: new Date().toISOString(),
          });
          return;
        }

        useEnrichmentStore.setState({ currentTitle: target.title });

        const media = enrichedByMal.get(target.malId);
        if (!media) {
          failures.push({
            ...target,
            reason: 'Nenhum mapping Kitsu/MAL confiável foi encontrado.',
          });
          processed += 1;
          useEnrichmentStore.setState({
            processed,
            failures: [...failures],
          });
          continue;
        }

        const applied = await useLibraryStore.getState().applyEnrichment(media);
        if (!applied) {
          failures.push({
            ...target,
            reason: 'Os metadados foram encontrados, mas não puderam ser persistidos.',
          });
          processed += 1;
          useEnrichmentStore.setState({
            processed,
            failures: [...failures],
          });
          continue;
        }

        enriched += 1;

        const updatedEntry = useLibraryStore.getState().entries.find(
          (entry) =>
            entry.media.malId === target.malId &&
            entry.media.type === target.type,
        );

        if (updatedEntry?.media.imageUrl && !isLocalCover(updatedEntry.media.imageUrl)) {
          const cached = await useLibraryStore
            .getState()
            .cacheCover(target.malId, target.type);

          if (cached) {
            coversCached += 1;
          } else {
            failures.push({
              ...target,
              reason: 'Metadados atualizados, mas a capa offline não pôde ser salva.',
            });
          }
        }

        processed += 1;
        useEnrichmentStore.setState({
          processed,
          enriched,
          coversCached,
          failures: [...failures],
        });
      }

      await delay(300);
    }
  }

  if (token !== activeRunToken) {
    useEnrichmentStore.setState({
      status: 'cancelled',
      currentTitle: '',
      finishedAt: new Date().toISOString(),
    });
    return;
  }

  useEnrichmentStore.setState({
    status: 'completed',
    processed,
    enriched,
    coversCached,
    failures: [...failures],
    currentTitle: '',
    finishedAt: new Date().toISOString(),
  });

  await setLastSync('enrichment');
}

export const useEnrichmentStore = create<EnrichmentStore>((set, get) => ({
  status: 'idle',
  total: 0,
  processed: 0,
  enriched: 0,
  coversCached: 0,
  failures: [],
  currentTitle: '',

  start: async (entries) => {
    await runTargets(toTargets(entries));
  },

  cancel: () => {
    if (get().status !== 'running') return;
    activeRunToken += 1;
    set({
      status: 'cancelled',
      currentTitle: '',
      finishedAt: new Date().toISOString(),
    });
  },

  retryFailed: async () => {
    if (get().status === 'running') return;
    const targets = Array.from(
      new Map(
        get().failures.map((failure) => [
          key(failure),
          {
            malId: failure.malId,
            type: failure.type,
            title: failure.title,
          } satisfies EnrichmentTarget,
        ]),
      ).values(),
    );
    await runTargets(targets);
  },

  reset: () => {
    if (get().status === 'running') return;
    set({
      status: 'idle',
      total: 0,
      processed: 0,
      enriched: 0,
      coversCached: 0,
      failures: [],
      currentTitle: '',
      startedAt: undefined,
      finishedAt: undefined,
    });
  },
}));
