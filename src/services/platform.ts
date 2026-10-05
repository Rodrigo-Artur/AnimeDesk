export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const runtime = window as typeof window & {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  return Boolean(runtime.__TAURI_INTERNALS__ || runtime.__TAURI__);
}
