import { TestBed } from '@angular/core/testing';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import {
  RECENT_PRODUCTION_CONTEXT_CLOCK,
  RECENT_PRODUCTION_CONTEXT_STORAGE,
  RecentProductionContextService,
} from './recent-production-context.service';

describe('RecentProductionContextService', () => {
  let storage: Storage;
  let currentUser: { id: string } | null;

  beforeEach(() => {
    localStorage.clear();
    storage = localStorage;
    currentUser = { id: 'operador-1' };
    TestBed.configureTestingModule({ providers: [
      RecentProductionContextService,
      { provide: AuthSessionService, useValue: { get currentUser() { return currentUser; } } },
      { provide: RECENT_PRODUCTION_CONTEXT_STORAGE, useValue: storage },
      { provide: RECENT_PRODUCTION_CONTEXT_CLOCK, useValue: () => new Date('2026-08-17T12:00:00Z') },
    ] });
  });

  it('guarda, normaliza e move o contexto repetido para o início', () => {
    const service = TestBed.inject(RecentProductionContextService);

    service.remember(' 4104 ', ' ban-012-01 ', 'Bancada');
    service.remember('4113', 'CT-02', 'Linha 2');
    service.remember('4104', 'BAN-012-01', 'Bancada atualizada');

    expect(service.list()).toEqual([
      expect.objectContaining({ areaCode: '4104', workCenterCode: 'BAN-012-01', workCenterDescription: 'Bancada atualizada' }),
      expect.objectContaining({ areaCode: '4113', workCenterCode: 'CT-02' }),
    ]);
  });

  it('mantém somente os cinco últimos e isola os dados por usuário', () => {
    const service = TestBed.inject(RecentProductionContextService);
    for (let index = 1; index <= 6; index += 1) {
      service.remember(`41${index.toString().padStart(2, '0')}`, `CT-${index}`, `Centro ${index}`);
    }
    expect(service.list()).toHaveLength(5);
    expect(service.list()[0].workCenterCode).toBe('CT-6');

    currentUser = { id: 'operador-2' };
    expect(service.list()).toEqual([]);
    service.remember('4104', 'CT-OUTRO', 'Outro');
    expect(service.list()).toHaveLength(1);

    currentUser = { id: 'operador-1' };
    expect(service.list()).toHaveLength(5);
  });

  it('ignora gravação sem usuário ou códigos e descarta conteúdo inválido', () => {
    const service = TestBed.inject(RecentProductionContextService);
    storage.setItem('plano-de-controle.recent-production-contexts.operador-1', '{inválido');
    expect(service.list()).toEqual([]);

    service.remember('', 'CT-01', 'Centro');
    currentUser = null;
    service.remember('4104', 'CT-01', 'Centro');
    expect(service.list()).toEqual([]);
  });
});
