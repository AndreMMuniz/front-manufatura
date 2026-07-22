export function formatExamFrequency(frequencyInMinutes: string | number): string {
  if (typeof frequencyInMinutes === 'string' && !/^\d+$/.test(frequencyInMinutes)) {
    return frequencyInMinutes;
  }

  const minutes = Number(frequencyInMinutes);
  if (!Number.isSafeInteger(minutes) || minutes < 0 || Object.is(minutes, -0)) {
    return String(frequencyInMinutes);
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return `${hours.toString().padStart(2, '0')}:${remainingMinutes.toString().padStart(2, '0')} h`;
}
