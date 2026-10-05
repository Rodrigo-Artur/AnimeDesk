import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from '@tauri-apps/plugin-autostart';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { isTauriRuntime } from './platform';

export async function getAutostartEnabled(): Promise<boolean | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await isAutostartEnabled();
  } catch (error) {
    console.error('Falha ao consultar autostart:', error);
    return false;
  }
}

export async function setAutostartEnabled(enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  if (enabled) {
    await enableAutostart();
  } else {
    await disableAutostart();
  }
}

async function ensureNotificationPermission(): Promise<boolean> {
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === 'granted';
  }
  return granted;
}

export async function sendNativeNotification(title: string, body: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;

  try {
    if (!(await ensureNotificationPermission())) return false;
    sendNotification({ title, body });
    return true;
  } catch (error) {
    console.error('Falha ao enviar notificação:', error);
    return false;
  }
}

export async function sendNativeTestNotification(): Promise<boolean> {
  return sendNativeNotification('AnimeDesk', 'Notificações nativas estão funcionando.');
}
