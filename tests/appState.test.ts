import { beforeEach, describe, expect, it } from 'vitest';
import {
  getAppState,
  getJsonAppState,
  getLastSync,
  removeAppState,
  setAppState,
  setJsonAppState,
  setLastSync,
} from '../src/services/appState';

describe('appState fallback web', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('salva, lê e remove valores simples no localStorage', async () => {
    await setAppState('animedesk:test:string', 'valor');
    expect(await getAppState('animedesk:test:string')).toBe('valor');
    expect(localStorage.getItem('animedesk:test:string')).toBe('valor');

    await removeAppState('animedesk:test:string');
    expect(await getAppState('animedesk:test:string')).toBeNull();
  });

  it('serializa JSON e remove payload inválido ao ler', async () => {
    await setJsonAppState('animedesk:test:json', {
      enabled: true,
      count: 3,
    });

    expect(await getJsonAppState<{ enabled: boolean; count: number }>(
      'animedesk:test:json',
    )).toEqual({
      enabled: true,
      count: 3,
    });

    localStorage.setItem('animedesk:test:broken', '{invalid-json');
    expect(await getJsonAppState('animedesk:test:broken')).toBeNull();
    expect(localStorage.getItem('animedesk:test:broken')).toBeNull();
  });

  it('persiste e interpreta last-sync por escopo', async () => {
    const date = new Date('2026-10-06T12:34:56.000Z');
    await setLastSync('discover-test', date);

    expect((await getLastSync('discover-test'))?.toISOString()).toBe(
      '2026-10-06T12:34:56.000Z',
    );

    localStorage.setItem('animedesk-last-sync:bad-test', 'not-a-date');
    expect(await getLastSync('bad-test')).toBeNull();
  });
});
