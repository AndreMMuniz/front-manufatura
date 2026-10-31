import { describe, expect, it } from 'vitest';
import { setReportReason, validateReportReasons } from './report-reasons';

describe('report reasons v2', () => {
  it.each([[0, 0], [5, 0], [0, 2], [5, 2]])('preserves quantities independently: %s / %s', (rework, scrap) => {
    let reasons = setReportReason([], 'quantidadeRetrabalho', rework, { codigo: '01', descricao: 'Retrabalho' });
    reasons = setReportReason(reasons, 'quantidadeRefugo', scrap, { codigo: '02', descricao: 'Refugo' });
    expect(validateReportReasons(rework, scrap, reasons)).toBe('');
    expect(reasons.reduce((sum, reason) => sum + reason.quantidadeRetrabalho, 0)).toBe(rework);
    expect(reasons.reduce((sum, reason) => sum + reason.quantidadeRefugo, 0)).toBe(scrap);
  });
  it('keeps both typed quantities for the same code and clears only the zeroed type', () => {
    const reason = { codigo: '005', descricao: 'Motivo' };
    const first = setReportReason([], 'quantidadeRetrabalho', 5, reason);
    const both = setReportReason(first, 'quantidadeRefugo', 2, reason);
    expect(both).toEqual([{ ...reason, quantidadeRetrabalho: 5, quantidadeRefugo: 2 }]);
    expect(setReportReason(both, 'quantidadeRefugo', 0)).toEqual(first);
    expect(first[0].quantidadeRefugo).toBe(0);
  });
  it.each([NaN, Infinity, -1])('rejects invalid quantities: %s', quantity => {
    expect(validateReportReasons(quantity, 0, [])).not.toBe('');
  });
  it('rejects absent, duplicated and divergent motives', () => {
    expect(validateReportReasons(5, 2, [])).not.toBe('');
    const reasons = setReportReason([], 'quantidadeRetrabalho', 5, { codigo: '01', descricao: 'Motivo' });
    expect(validateReportReasons(4, 0, reasons)).not.toBe('');
    expect(validateReportReasons(5, 0, [...reasons, ...reasons])).not.toBe('');
  });
  it('uses the same three-decimal boundary for validation and construction', () => {
    const reasons = setReportReason([], 'quantidadeRefugo', 1.2344, { codigo: '01', descricao: 'Motivo' });
    expect(reasons[0].quantidadeRefugo).toBe(1.234);
    expect(validateReportReasons(0.0004, 1.2344, reasons)).toBe('');
  });
});
