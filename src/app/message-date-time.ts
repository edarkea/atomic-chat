const INVALID_DATE = 'Fecha no disponible';

function dateFrom(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : undefined;
}

export function formatMessageTime(value: string | undefined): string {
  const date = dateFrom(value);
  return date
    ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date)
    : '—:—';
}

export function formatMessageDate(value: string | undefined): string {
  const date = dateFrom(value);
  if (!date) return '--/--/----';
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export function formatMessageDateTime(value: string | undefined): string {
  const date = dateFrom(value);
  return date
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'full',
        timeStyle: 'medium',
      }).format(date)
    : INVALID_DATE;
}

export function formatMessageDay(value: string | undefined): string {
  const date = dateFrom(value);
  return date
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(date)
    : INVALID_DATE;
}

export function messageDayKey(value: string | undefined): string {
  const date = dateFrom(value);
  return date
    ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    : 'invalid';
}
