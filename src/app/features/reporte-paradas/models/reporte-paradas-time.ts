export interface StopInterval {
  readonly start: Date;
  readonly end: Date;
}

export function parseLocalDate(value: Date | string): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
    ? date
    : null;
}

export function combineLocalDateTime(
  dateValue: Date | string,
  timeValue: string,
): Date | null {
  const date = parseLocalDate(dateValue);
  const match = /^(\d{2}):(\d{2})$/.exec(timeValue.trim());
  if (!date || !match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59
    ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes)
    : null;
}

export function validateStopInterval(
  startDate: Date | string,
  startTime: string,
  endDate: Date | string,
  endTime: string,
): StopInterval | null {
  const start = combineLocalDateTime(startDate, startTime);
  const end = combineLocalDateTime(endDate, endTime);
  return start && end && end.getTime() >= start.getTime() ? { start, end } : null;
}

export function durationMinutes(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60_000));
}

export function formatDuration(minutes: number): string {
  const safeMinutes = Math.max(0, Math.floor(minutes));
  return `${Math.floor(safeMinutes / 60).toString().padStart(2, '0')}:${(safeMinutes % 60).toString().padStart(2, '0')}:00`;
}

export function formatLocalDate(date: Date): string {
  return `${date.getFullYear().toString().padStart(4, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

export function formatLocalTime(date: Date): string {
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}
