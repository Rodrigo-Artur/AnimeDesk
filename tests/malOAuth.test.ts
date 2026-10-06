import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getAppState: vi.fn(),
  setAppState: vi.fn(),
  removeAppState: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}));

vi.mock('../src/services/platform', () => ({
  isTauriRuntime: () => true,
}));

vi.mock('../src/services/appState', () => ({
  getAppState: mocks.getAppState,
  setAppState: mocks.setAppState,
  removeAppState: mocks.removeAppState,
}));

import {
  fetchMalAccountLibrary,
  getMalAccountStatus,
  getMalClientId,
  MAL_REDIRECT_URI,
  setMalClientId,
} from '../src/services/malOAuth';

describe('MyAnimeList OAuth frontend bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mantém redirect fixo e Client ID fora do código-fonte', async () => {
    mocks.getAppState.mockResolvedValue('  client-123  ');

    expect(MAL_REDIRECT_URI).toBe('http://127.0.0.1:47821/oauth/mal/callback');
    expect(await getMalClientId()).toBe('client-123');

    await setMalClientId(' new-client ');
    expect(mocks.setAppState).toHaveBeenCalledWith(
      'animedesk-mal-client-id',
      'new-client',
    );
  });

  it('consulta status da conta sem expor tokens no frontend', async () => {
    mocks.invoke.mockResolvedValue({
      configured: true,
      connected: true,
      userId: 42,
      name: 'Moonii',
      picture: null,
      expiresAt: 123,
      redirectUri: MAL_REDIRECT_URI,
    });

    const status = await getMalAccountStatus('client-id');

    expect(mocks.invoke).toHaveBeenCalledWith('mal_oauth_status', {
      clientId: 'client-id',
    });
    expect(status.connected).toBe(true);
    expect(status.name).toBe('Moonii');
    expect(status).not.toHaveProperty('accessToken');
    expect(status).not.toHaveProperty('refreshToken');
  });

  it('converte anime e manga autenticados para a biblioteca local', async () => {
    mocks.invoke.mockImplementation(async (command, args: { mediaType?: string }) => {
      expect(command).toBe('mal_fetch_user_list');

      if (args.mediaType === 'anime') {
        return [{
          mediaType: 'anime',
          malId: 52991,
          title: 'Sousou no Frieren',
          imageUrl: 'https://example.test/frieren.jpg',
          status: 'completed',
          progress: 28,
          score: 10,
          updatedAt: '2026-10-06T00:00:00Z',
          totalEpisodes: 28,
          totalChapters: null,
          publicScore: 9.1,
          airingStatus: 'finished_airing',
          genres: ['Adventure', 'Fantasy'],
          year: 2023,
        }];
      }

      return [{
        mediaType: 'manga',
        malId: 2,
        title: 'Berserk',
        imageUrl: null,
        status: 'reading',
        progress: 120,
        score: 9,
        updatedAt: '2026-10-05T00:00:00Z',
        totalEpisodes: null,
        totalChapters: 380,
        publicScore: 9.4,
        airingStatus: 'currently_publishing',
        genres: ['Drama'],
        year: 1989,
      }];
    });

    const result = await fetchMalAccountLibrary('client-id');

    expect(result.animeCount).toBe(1);
    expect(result.mangaCount).toBe(1);
    expect(result.entries).toHaveLength(2);

    const anime = result.entries[0];
    expect(anime.status).toBe('completed');
    expect(anime.progress).toBe(28);
    expect(anime.score).toBe(10);
    expect(anime.media.externalIds?.['myanimelist/anime']).toBe('52991');

    const manga = result.entries[1];
    expect(manga.status).toBe('reading');
    expect(manga.progress).toBe(120);
    expect(manga.media.chapters).toBe(380);
    expect(manga.media.externalIds?.['myanimelist/manga']).toBe('2');
  });
});
