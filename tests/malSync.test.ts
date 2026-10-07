import { describe, expect, it } from 'vitest';
import {
  buildMalSyncPlan,
  createMalRemoteBaseline,
} from '../src/services/malSync';
import type { LibraryEntry } from '../src/types/media';

function entry(
  malId: number,
  status: LibraryEntry['status'],
  progress: number,
  score?: number,
  type: 'anime' | 'manga' = 'anime',
): LibraryEntry {
  return {
    media: {
      id: malId,
      malId,
      type,
      title: `Title ${malId}`,
      genres: [],
    },
    status,
    progress,
    score,
    updatedAt: '2026-10-06T00:00:00Z',
  };
}

describe('MAL sync planner', () => {
  it('marca diferenças da primeira comparação como conflito e itens exclusivos por lado', () => {
    const local = [
      entry(1, 'watching', 3),
      entry(2, 'completed', 12, 9),
    ];
    const remote = [
      entry(1, 'watching', 4),
      entry(3, 'planned', 0),
    ];

    const plan = buildMalSyncPlan(local, remote, null, new Date('2026-10-06T12:00:00Z'));

    expect(plan.counts.conflict).toBe(1);
    expect(plan.counts.local_only).toBe(1);
    expect(plan.counts.remote_only).toBe(1);
    expect(plan.safeRemoteEntries.map((item) => item.media.malId)).toEqual([3]);
    expect(plan.hadBaseline).toBe(false);
  });

  it('distingue mudança só local, só remota e conflito de duas pontas', () => {
    const baselineRemote = [
      entry(1, 'watching', 3),
      entry(2, 'watching', 5),
      entry(3, 'watching', 7),
      entry(4, 'completed', 12, 9),
    ];
    const baseline = createMalRemoteBaseline(
      baselineRemote,
      new Date('2026-10-05T12:00:00Z'),
    );

    const local = [
      entry(1, 'watching', 4), // só local
      entry(2, 'watching', 5), // só remoto muda
      entry(3, 'watching', 8), // ambos mudam diferente
      entry(4, 'completed', 12, 9), // igual
    ];
    const remote = [
      entry(1, 'watching', 3),
      entry(2, 'watching', 6),
      entry(3, 'completed', 12),
      entry(4, 'completed', 12, 9),
    ];

    const plan = buildMalSyncPlan(local, remote, baseline);

    expect(plan.counts.local_changed).toBe(1);
    expect(plan.counts.remote_changed).toBe(1);
    expect(plan.counts.conflict).toBe(1);
    expect(plan.counts.equal).toBe(1);
    expect(plan.safeRemoteEntries.map((item) => item.media.malId)).toEqual([2]);
  });

  it('considera score zero/undefined equivalentes a ausência de nota', () => {
    const local = entry(10, 'completed', 24);
    const remote = entry(10, 'completed', 24, undefined);

    const plan = buildMalSyncPlan([local], [remote], null);
    expect(plan.counts.equal).toBe(1);
  });

  it('mantém namespaces anime/manga separados mesmo com o mesmo MAL ID', () => {
    const local = [
      entry(1, 'completed', 12, 8, 'anime'),
      entry(1, 'reading', 20, 9, 'manga'),
    ];
    const remote = [
      entry(1, 'completed', 12, 8, 'anime'),
      entry(1, 'reading', 21, 9, 'manga'),
    ];

    const plan = buildMalSyncPlan(local, remote, null);

    expect(plan.counts.equal).toBe(1);
    expect(plan.counts.conflict).toBe(1);
    expect(plan.items.map((item) => item.key).sort()).toEqual(['anime:1', 'manga:1']);
  });

  it('distingue remoção local de remoção remota quando existe baseline', () => {
    const baseline = createMalRemoteBaseline([
      entry(20, 'watching', 3),
      entry(21, 'watching', 5),
    ]);

    const local = [entry(20, 'watching', 3)];
    const remote = [entry(21, 'watching', 5)];
    const plan = buildMalSyncPlan(local, remote, baseline);

    expect(plan.counts.remote_removed).toBe(1);
    expect(plan.counts.local_removed).toBe(1);
    expect(plan.safeRemoteEntries).toHaveLength(0);
    expect(plan.canAdvanceBaseline).toBe(false);
  });

  it('permite avançar baseline quando só existem mudanças remotas seguras', () => {
    const baseline = createMalRemoteBaseline([entry(30, 'watching', 2)]);
    const local = [entry(30, 'watching', 2)];
    const remote = [entry(30, 'watching', 3), entry(31, 'planned', 0)];

    const plan = buildMalSyncPlan(local, remote, baseline);

    expect(plan.counts.remote_changed).toBe(1);
    expect(plan.counts.remote_only).toBe(1);
    expect(plan.safeRemoteEntries.map((item) => item.media.malId)).toEqual([30, 31]);
    expect(plan.canAdvanceBaseline).toBe(true);
  });
});
