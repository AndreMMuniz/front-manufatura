import { describe, expect, it } from 'vitest';

import {
  combineLocalDateTime,
  durationMinutes,
  formatDuration,
  parseLocalDate,
} from './reporte-paradas-time';

describe('helpers temporais de Paradas', () => {
  it('valida datas locais sem normalizar datas impossíveis', () => {
    expect(parseLocalDate('2026-02-29')).toBeNull();
    expect(parseLocalDate('2026-07-28')).toEqual(new Date(2026, 6, 28));
  });

  it('combina data/hora válida e rejeita horário inválido', () => {
    expect(combineLocalDateTime('2026-07-28', '09:30'))
      .toEqual(new Date(2026, 6, 28, 9, 30));
    expect(combineLocalDateTime('2026-07-28', '24:00')).toBeNull();
  });

  it('calcula duração com floor e clamp e formata HH:mm:00', () => {
    const start = new Date(2026, 6, 28, 8);

    expect(durationMinutes(start, new Date(2026, 6, 28, 7, 59))).toBe(0);
    expect(durationMinutes(start, new Date(2026, 6, 28, 9, 2, 59))).toBe(62);
    expect(formatDuration(62)).toBe('01:02:00');
  });
});
