const ALERTS_ENABLED_KEY = 'animedesk-release-alerts-enabled';
const ALERT_LEAD_KEY = 'animedesk-release-alert-lead-minutes';

export function getReleaseAlertsEnabled(): boolean {
  const value = localStorage.getItem(ALERTS_ENABLED_KEY);
  return value === null ? true : value === 'true';
}

export function setReleaseAlertsEnabled(enabled: boolean): void {
  localStorage.setItem(ALERTS_ENABLED_KEY, String(enabled));
}

export function getReleaseAlertLeadMinutes(): number {
  const value = Number(localStorage.getItem(ALERT_LEAD_KEY) ?? '10');
  return [10, 30, 60].includes(value) ? value : 10;
}

export function setReleaseAlertLeadMinutes(minutes: number): void {
  localStorage.setItem(ALERT_LEAD_KEY, String(minutes));
}
