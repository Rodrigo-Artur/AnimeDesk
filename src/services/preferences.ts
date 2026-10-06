import { getAppState, setAppState } from './appState';

const ALERTS_ENABLED_KEY = 'animedesk-release-alerts-enabled';
const ALERT_LEAD_KEY = 'animedesk-release-alert-lead-minutes';
const VALID_LEAD_MINUTES = [10, 30, 60] as const;

export async function getReleaseAlertsEnabled(): Promise<boolean> {
  const value = await getAppState(ALERTS_ENABLED_KEY);
  return value === null ? true : value === 'true';
}

export async function setReleaseAlertsEnabled(enabled: boolean): Promise<void> {
  await setAppState(ALERTS_ENABLED_KEY, String(enabled));
}

export async function getReleaseAlertLeadMinutes(): Promise<number> {
  const value = Number(await getAppState(ALERT_LEAD_KEY) ?? '10');
  return VALID_LEAD_MINUTES.includes(value as 10 | 30 | 60) ? value : 10;
}

export async function setReleaseAlertLeadMinutes(minutes: number): Promise<void> {
  const safe = VALID_LEAD_MINUTES.includes(minutes as 10 | 30 | 60)
    ? minutes
    : 10;
  await setAppState(ALERT_LEAD_KEY, String(safe));
}
