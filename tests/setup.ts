import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  delete (window as typeof window & { __TAURI__?: unknown }).__TAURI__;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
