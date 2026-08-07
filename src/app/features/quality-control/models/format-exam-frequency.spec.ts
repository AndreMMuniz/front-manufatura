import { describe, expect, it } from 'vitest';

import { formatExamFrequency } from './format-exam-frequency';

describe('formatExamFrequency', () => {
  it.each([
    ['20', '00:20 h'],
    ['59', '00:59 h'],
    ['60', '01:00 h'],
    ['61', '01:01 h'],
    ['120', '02:00 h'],
    [125, '02:05 h'],
  ])('formats %s minutes as %s', (minutes, expected) => {
    expect(formatExamFrequency(minutes)).toBe(expected);
  });

  it.each(['', '   ', '1e2', '0x3c', '-0', 'não informada', '9007199254740992'])(
    'preserves the invalid frequency %j instead of showing an incorrect time',
    frequency => {
      expect(formatExamFrequency(frequency)).toBe(frequency);
    },
  );

  it('preserves invalid numeric values', () => {
    expect(formatExamFrequency(-0)).toBe('0');
    expect(formatExamFrequency(Number.MAX_SAFE_INTEGER + 1)).toBe('9007199254740992');
  });
});
