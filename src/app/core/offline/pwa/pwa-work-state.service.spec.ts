import { describe, expect, it } from 'vitest';

import { PwaWorkStateService } from './pwa-work-state.service';

describe('PwaWorkStateService', () => {
  it('mantém o reload bloqueado enquanto qualquer origem possui captura ativa', () => {
    const service = new PwaWorkStateService();

    service.setCaptureActive('quality-control', true);
    service.setCaptureActive('report-operation', true);
    expect(service.hasActiveCapture()).toBe(true);

    service.setCaptureActive('quality-control', false);
    expect(service.hasActiveCapture()).toBe(true);

    service.setCaptureActive('report-operation', false);
    expect(service.hasActiveCapture()).toBe(false);
  });
});
