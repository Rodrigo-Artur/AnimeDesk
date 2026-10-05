import type { LibraryEntry } from '../types/media';
import { sendNativeNotification } from './native';
import { getReleaseAlertLeadMinutes, getReleaseAlertsEnabled } from './preferences';
import { getWeeklySchedule } from './schedule';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const SENT_PREFIX = 'animedesk-release-alert:';

function cleanupOldMarkers() {
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(SENT_PREFIX)) continue;
    const sentAt = Number(localStorage.getItem(key));
    if (!Number.isFinite(sentAt) || sentAt < cutoff) localStorage.removeItem(key);
  }
}

async function check(entries: LibraryEntry[]) {
  if (!getReleaseAlertsEnabled()) return;

  const tracked = entries.filter(
    (entry) =>
      entry.media.type === 'anime' &&
      (entry.status === 'watching' || entry.status === 'planned'),
  );
  if (!tracked.length) return;

  const trackedIds = new Set(tracked.map((entry) => entry.media.malId));
  const leadMinutes = getReleaseAlertLeadMinutes();
  const leadMs = leadMinutes * 60 * 1000;
  const now = Date.now();

  const schedule = await getWeeklySchedule(entries);
  const candidates = schedule.items.filter(
    (item) => item.inLibrary && item.mediaMalId && trackedIds.has(item.mediaMalId),
  );

  for (const item of candidates) {
    const releaseTime = new Date(item.releaseAt).getTime();
    const untilRelease = releaseTime - now;
    if (untilRelease < 0 || untilRelease > leadMs) continue;

    const marker = `${SENT_PREFIX}${item.id}:${leadMinutes}`;
    if (localStorage.getItem(marker)) continue;

    const episode = item.episode ? `Episódio ${item.episode}` : 'Novo episódio';
    const time = new Date(item.releaseAt).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const sent = await sendNativeNotification(
      item.mediaTitle,
      `${episode} previsto para ${time}. Faltam até ${leadMinutes} minutos.`,
    );

    if (sent) localStorage.setItem(marker, String(Date.now()));
  }
}

export function startReleaseWatcher(getEntries: () => LibraryEntry[]): () => void {
  cleanupOldMarkers();

  const run = () => {
    void check(getEntries()).catch((error) => {
      console.error('Falha ao verificar alertas de lançamentos:', error);
    });
  };

  run();
  const timer = window.setInterval(run, CHECK_INTERVAL_MS);
  return () => window.clearInterval(timer);
}
