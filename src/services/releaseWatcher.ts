import type { LibraryEntry } from '../types/media';
import {
  getJsonAppState,
  setJsonAppState,
} from './appState';
import { sendNativeNotification } from './native';
import {
  getReleaseAlertLeadMinutes,
  getReleaseAlertsEnabled,
} from './preferences';
import { getWeeklySchedule } from './schedule';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const SENT_MARKERS_KEY = 'animedesk-release-alert-markers-v1';
const LEGACY_SENT_PREFIX = 'animedesk-release-alert:';
const MARKER_TTL_MS = 14 * 24 * 60 * 60 * 1000;

type SentMarkers = Record<string, number>;

function migrateLegacyMarkers(): SentMarkers {
  const migrated: SentMarkers = {};

  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const storageKey = localStorage.key(index);
      if (!storageKey?.startsWith(LEGACY_SENT_PREFIX)) continue;

      const sentAt = Number(localStorage.getItem(storageKey));
      const marker = storageKey.slice(LEGACY_SENT_PREFIX.length);
      if (marker && Number.isFinite(sentAt)) {
        migrated[marker] = sentAt;
      }
      localStorage.removeItem(storageKey);
    }
  } catch {
    // Migração legada é best-effort.
  }

  return migrated;
}

async function loadMarkers(): Promise<SentMarkers> {
  const markers = await getJsonAppState<SentMarkers>(SENT_MARKERS_KEY) ?? {};
  const legacy = migrateLegacyMarkers();
  const cutoff = Date.now() - MARKER_TTL_MS;
  let changed = Object.keys(legacy).length > 0;

  for (const [key, sentAt] of Object.entries(legacy)) {
    markers[key] ??= sentAt;
  }

  for (const [key, sentAt] of Object.entries(markers)) {
    if (!Number.isFinite(sentAt) || sentAt < cutoff) {
      delete markers[key];
      changed = true;
    }
  }

  if (changed) {
    await setJsonAppState(SENT_MARKERS_KEY, markers);
  }

  return markers;
}

async function check(entries: LibraryEntry[]) {
  if (!(await getReleaseAlertsEnabled())) return;

  const tracked = entries.filter(
    (entry) =>
      entry.media.type === 'anime' &&
      (entry.status === 'watching' || entry.status === 'planned'),
  );
  if (!tracked.length) return;

  const trackedIds = new Set(tracked.map((entry) => entry.media.malId));
  const leadMinutes = await getReleaseAlertLeadMinutes();
  const leadMs = leadMinutes * 60 * 1000;
  const now = Date.now();
  const markers = await loadMarkers();
  let markersChanged = false;

  const schedule = await getWeeklySchedule(entries);
  const candidates = schedule.items.filter(
    (item) => item.inLibrary && item.mediaMalId && trackedIds.has(item.mediaMalId),
  );

  for (const item of candidates) {
    const releaseTime = new Date(item.releaseAt).getTime();
    const untilRelease = releaseTime - now;
    if (untilRelease < 0 || untilRelease > leadMs) continue;

    const marker = `${item.id}:${leadMinutes}`;
    if (markers[marker]) continue;

    const episode = item.episode ? `Episódio ${item.episode}` : 'Novo episódio';
    const time = new Date(item.releaseAt).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const sent = await sendNativeNotification(
      item.mediaTitle,
      `${episode} previsto para ${time}. Faltam até ${leadMinutes} minutos.`,
    );

    if (sent) {
      markers[marker] = Date.now();
      markersChanged = true;
    }
  }

  if (markersChanged) {
    await setJsonAppState(SENT_MARKERS_KEY, markers);
  }
}

export function startReleaseWatcher(getEntries: () => LibraryEntry[]): () => void {
  let running = false;

  const run = () => {
    if (running) return;
    running = true;

    void check(getEntries())
      .catch((error) => {
        console.error('Falha ao verificar alertas de lançamentos:', error);
      })
      .finally(() => {
        running = false;
      });
  };

  run();
  const timer = window.setInterval(run, CHECK_INTERVAL_MS);
  return () => window.clearInterval(timer);
}
