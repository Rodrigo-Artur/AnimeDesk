import type { LibraryEntry, LibraryStatus, MediaType } from '../types/media';
import { getJsonAppState, setJsonAppState } from './appState';

const MAL_SYNC_BASELINE_KEY = 'animedesk-mal-sync-baseline-v1';

export type MalSyncKind =
  | 'equal'
  | 'remote_only'
  | 'local_only'
  | 'remote_changed'
  | 'local_changed'
  | 'remote_removed'
  | 'local_removed'
  | 'conflict';

export type MalPersonalState = {
  status: LibraryStatus;
  progress: number;
  score: number | null;
};

export type MalSyncBaseline = {
  observedAt: string;
  items: Record<string, MalPersonalState>;
};

export type MalSyncPlanItem = {
  key: string;
  type: MediaType;
  malId: number;
  title: string;
  kind: MalSyncKind;
  local?: LibraryEntry;
  remote?: LibraryEntry;
  baseline?: MalPersonalState;
};

export type MalSyncPlan = {
  items: MalSyncPlanItem[];
  counts: Record<MalSyncKind, number>;
  safeRemoteEntries: LibraryEntry[];
  conflicts: MalSyncPlanItem[];
  observedAt: string;
  hadBaseline: boolean;
  canAdvanceBaseline: boolean;
};

function keyOf(entry: Pick<LibraryEntry, 'media'>): string {
  return `${entry.media.type}:${entry.media.malId}`;
}

export function toMalPersonalState(entry: LibraryEntry): MalPersonalState {
  return {
    status: entry.status,
    progress: Math.max(0, Math.trunc(entry.progress || 0)),
    score: entry.score && entry.score > 0 ? entry.score : null,
  };
}

export function sameMalPersonalState(
  left: MalPersonalState,
  right: MalPersonalState,
): boolean {
  return (
    left.status === right.status &&
    left.progress === right.progress &&
    left.score === right.score
  );
}

function emptyCounts(): Record<MalSyncKind, number> {
  return {
    equal: 0,
    remote_only: 0,
    local_only: 0,
    remote_changed: 0,
    local_changed: 0,
    remote_removed: 0,
    local_removed: 0,
    conflict: 0,
  };
}

export function buildMalSyncPlan(
  localEntries: LibraryEntry[],
  remoteEntries: LibraryEntry[],
  baseline: MalSyncBaseline | null,
  now = new Date(),
): MalSyncPlan {
  const localByKey = new Map(localEntries.map((entry) => [keyOf(entry), entry]));
  const remoteByKey = new Map(remoteEntries.map((entry) => [keyOf(entry), entry]));
  const allKeys = new Set([...localByKey.keys(), ...remoteByKey.keys()]);
  const counts = emptyCounts();
  const items: MalSyncPlanItem[] = [];

  for (const key of Array.from(allKeys).sort()) {
    const local = localByKey.get(key);
    const remote = remoteByKey.get(key);
    const baselineState = baseline?.items[key];

    let kind: MalSyncKind;

    if (!local && remote) {
      kind = baselineState ? 'local_removed' : 'remote_only';
    } else if (local && !remote) {
      kind = baselineState ? 'remote_removed' : 'local_only';
    } else if (!local || !remote) {
      continue;
    } else {
      const localState = toMalPersonalState(local);
      const remoteState = toMalPersonalState(remote);

      if (sameMalPersonalState(localState, remoteState)) {
        kind = 'equal';
      } else if (!baselineState) {
        // Primeira comparação: sem ancestral comum, não é seguro escolher um lado.
        kind = 'conflict';
      } else {
        const localChanged = !sameMalPersonalState(localState, baselineState);
        const remoteChanged = !sameMalPersonalState(remoteState, baselineState);

        if (localChanged && remoteChanged) {
          kind = sameMalPersonalState(localState, remoteState) ? 'equal' : 'conflict';
        } else if (remoteChanged) {
          kind = 'remote_changed';
        } else if (localChanged) {
          kind = 'local_changed';
        } else {
          // Estado impossível num baseline íntegro, mas conflito é o fallback seguro.
          kind = 'conflict';
        }
      }
    }

    const entry = remote ?? local;
    if (!entry) continue;

    counts[kind] += 1;
    items.push({
      key,
      type: entry.media.type,
      malId: entry.media.malId,
      title: entry.media.titleEnglish || entry.media.title,
      kind,
      local,
      remote,
      baseline: baselineState,
    });
  }

  return {
    items,
    counts,
    safeRemoteEntries: items
      .filter((item) => item.kind === 'remote_only' || item.kind === 'remote_changed')
      .flatMap((item) => item.remote ? [item.remote] : []),
    conflicts: items.filter((item) => item.kind === 'conflict'),
    observedAt: now.toISOString(),
    hadBaseline: Boolean(baseline),
    // Avançar o baseline para um remoto que contém conflitos ou remoções remotas
    // apagaria a evidência necessária para uma decisão explícita posterior.
    canAdvanceBaseline: counts.conflict === 0 && counts.remote_removed === 0,
  };
}

export function createMalRemoteBaseline(
  remoteEntries: LibraryEntry[],
  observedAt = new Date(),
): MalSyncBaseline {
  const items: Record<string, MalPersonalState> = {};

  for (const entry of remoteEntries) {
    items[keyOf(entry)] = toMalPersonalState(entry);
  }

  return {
    observedAt: observedAt.toISOString(),
    items,
  };
}

export async function loadMalSyncBaseline(): Promise<MalSyncBaseline | null> {
  return getJsonAppState<MalSyncBaseline>(MAL_SYNC_BASELINE_KEY);
}

export async function saveMalSyncBaseline(
  remoteEntries: LibraryEntry[],
  observedAt = new Date(),
): Promise<MalSyncBaseline> {
  const baseline = createMalRemoteBaseline(remoteEntries, observedAt);
  await setJsonAppState(MAL_SYNC_BASELINE_KEY, baseline);
  return baseline;
}
