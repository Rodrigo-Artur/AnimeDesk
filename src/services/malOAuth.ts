import { invoke } from '@tauri-apps/api/core';
import type {
  LibraryEntry,
  LibraryStatus,
  MediaType,
} from '../types/media';
import {
  getAppState,
  removeAppState,
  setAppState,
} from './appState';
import { isTauriRuntime } from './platform';

const MAL_CLIENT_ID_KEY = 'animedesk-mal-client-id';
export const MAL_REDIRECT_URI = 'http://127.0.0.1:47821/oauth/mal/callback';

export type MalAccountStatus = {
  configured: boolean;
  connected: boolean;
  userId?: number | null;
  name?: string | null;
  picture?: string | null;
  expiresAt?: number | null;
  redirectUri: string;
};

type MalListItem = {
  mediaType: MediaType;
  malId: number;
  title: string;
  imageUrl?: string | null;
  status: string;
  progress: number;
  score?: number | null;
  updatedAt?: string | null;
  totalEpisodes?: number | null;
  totalChapters?: number | null;
  publicScore?: number | null;
  airingStatus?: string | null;
  genres: string[];
  year?: number | null;
};

export type MalAccountImport = {
  entries: LibraryEntry[];
  animeCount: number;
  mangaCount: number;
};

export async function getMalClientId(): Promise<string> {
  return (await getAppState(MAL_CLIENT_ID_KEY))?.trim() ?? '';
}

export async function setMalClientId(clientId: string): Promise<void> {
  const clean = clientId.trim();
  if (!clean) {
    await removeAppState(MAL_CLIENT_ID_KEY);
    return;
  }
  await setAppState(MAL_CLIENT_ID_KEY, clean);
}

function requireDesktop() {
  if (!isTauriRuntime()) {
    throw new Error('OAuth do MyAnimeList está disponível no aplicativo desktop.');
  }
}

export async function getMalAccountStatus(
  clientId: string,
): Promise<MalAccountStatus> {
  requireDesktop();
  return invoke<MalAccountStatus>('mal_oauth_status', {
    clientId: clientId.trim(),
  });
}

export async function loginMalAccount(
  clientId: string,
): Promise<MalAccountStatus> {
  requireDesktop();
  return invoke<MalAccountStatus>('mal_oauth_login', {
    clientId: clientId.trim(),
  });
}

export async function logoutMalAccount(): Promise<void> {
  requireDesktop();
  await invoke('mal_oauth_logout');
}

function mapMalStatus(mediaType: MediaType, status: string): LibraryStatus {
  if (status === 'completed') return 'completed';
  if (status === 'on_hold') return 'paused';
  if (status === 'dropped') return 'dropped';

  if (mediaType === 'anime') {
    if (status === 'watching') return 'watching';
    return 'planned';
  }

  if (status === 'reading') return 'reading';
  return 'planned';
}

function mapAccountEntry(item: MalListItem): LibraryEntry {
  const updatedAt = item.updatedAt
    ? new Date(item.updatedAt).toISOString()
    : new Date().toISOString();

  return {
    media: {
      id: item.malId,
      malId: item.malId,
      type: item.mediaType,
      title: item.title,
      imageUrl: item.imageUrl ?? undefined,
      score: item.publicScore ?? null,
      episodes: item.totalEpisodes ?? null,
      chapters: item.totalChapters ?? null,
      status: item.airingStatus ?? undefined,
      genres: item.genres ?? [],
      year: item.year ?? null,
      externalIds: {
        ['myanimelist/' + item.mediaType]: String(item.malId),
      },
    },
    status: mapMalStatus(item.mediaType, item.status),
    progress: Math.max(0, item.progress ?? 0),
    score: item.score && item.score > 0 ? item.score : undefined,
    updatedAt,
  };
}

async function fetchList(
  clientId: string,
  mediaType: MediaType,
): Promise<MalListItem[]> {
  return invoke<MalListItem[]>('mal_fetch_user_list', {
    clientId: clientId.trim(),
    mediaType,
  });
}

export async function fetchMalAccountLibrary(
  clientId: string,
): Promise<MalAccountImport> {
  requireDesktop();

  const [anime, manga] = await Promise.all([
    fetchList(clientId, 'anime'),
    fetchList(clientId, 'manga'),
  ]);

  return {
    entries: [...anime, ...manga].map(mapAccountEntry),
    animeCount: anime.length,
    mangaCount: manga.length,
  };
}
