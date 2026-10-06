import {
  deleteNativeSetting,
  getNativeSetting,
  setNativeSetting,
} from '../db/database';
import { isTauriRuntime } from './platform';

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Fallback best-effort.
  }
}

function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Fallback best-effort.
  }
}

export async function getAppState(key: string): Promise<string | null> {
  if (!isTauriRuntime()) return readLocal(key);

  try {
    const nativeValue = await getNativeSetting(key);
    if (nativeValue !== null) return nativeValue;

    const legacyValue = readLocal(key);
    if (legacyValue !== null) {
      await setNativeSetting(key, legacyValue);
      removeLocal(key);
      return legacyValue;
    }

    return null;
  } catch (error) {
    console.warn(`Falha ao ler estado SQLite (${key}); usando localStorage.`, error);
    return readLocal(key);
  }
}

export async function setAppState(key: string, value: string): Promise<void> {
  if (!isTauriRuntime()) {
    writeLocal(key, value);
    return;
  }

  try {
    await setNativeSetting(key, value);
    removeLocal(key);
  } catch (error) {
    console.warn(`Falha ao persistir estado SQLite (${key}); usando localStorage.`, error);
    writeLocal(key, value);
  }
}

export async function removeAppState(key: string): Promise<void> {
  removeLocal(key);
  if (!isTauriRuntime()) return;

  try {
    await deleteNativeSetting(key);
  } catch (error) {
    console.warn(`Falha ao remover estado SQLite (${key}).`, error);
  }
}

export async function getJsonAppState<T>(key: string): Promise<T | null> {
  const value = await getAppState(key);
  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    await removeAppState(key);
    return null;
  }
}

export async function setJsonAppState<T>(key: string, value: T): Promise<void> {
  await setAppState(key, JSON.stringify(value));
}

export async function setLastSync(scope: string, date = new Date()): Promise<void> {
  await setAppState(`animedesk-last-sync:${scope}`, date.toISOString());
}

export async function getLastSync(scope: string): Promise<Date | null> {
  const raw = await getAppState(`animedesk-last-sync:${scope}`);
  if (!raw) return null;

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}
