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

  it('guarda somente a Área e deduplica usos com Centros diferentes', () => {
    const service = TestBed.inject(RecentProductionContextService);

    service.remember(' 4104 ');
    service.remember('4113');
    service.remember('4104');

    expect(service.list()).toEqual([
      { areaCode: '4104', lastUsedAt: '2026-08-17T12:00:00.000Z' },
      { areaCode: '4113', lastUsedAt: '2026-08-17T12:00:00.000Z' },
    ]);
  });

  it('mantém somente os cinco últimos e isola os dados por usuário', () => {
    const service = TestBed.inject(RecentProductionContextService);
    for (let index = 1; index <= 6; index += 1) {
      service.remember(`41${index.toString().padStart(2, '0')}`);
    }
    expect(service.list()).toHaveLength(5);
    expect(service.list()[0].areaCode).toBe('4106');

    currentUser = { id: 'operador-2' };
    expect(service.list()).toEqual([]);
    service.remember('4104');
    expect(service.list()).toHaveLength(1);

    currentUser = { id: 'operador-1' };
    expect(service.list()).toHaveLength(5);
  });

  it('ignora gravação sem usuário ou códigos e descarta conteúdo inválido', () => {
    const service = TestBed.inject(RecentProductionContextService);
    storage.setItem('plano-de-controle.recent-production-contexts.operador-1', '{inválido');
    expect(service.list()).toEqual([]);

    service.remember('');
    currentUser = null;
    service.remember('4104');
    expect(service.list()).toEqual([]);
  });

  it('migra o histórico anterior removendo Centros e Áreas duplicadas', () => {
    storage.setItem('plano-de-controle.recent-production-contexts.operador-1', JSON.stringify([
      {
        areaCode: '4104', workCenterCode: 'CT-01', workCenterDescription: 'Centro 1',
        lastUsedAt: '2026-08-17T12:00:00.000Z',
      },
      {
        areaCode: '4104', workCenterCode: 'CT-02', workCenterDescription: 'Centro 2',
        lastUsedAt: '2026-08-16T12:00:00.000Z',
      },
    ]));

    expect(TestBed.inject(RecentProductionContextService).list()).toEqual([
      { areaCode: '4104', lastUsedAt: '2026-08-17T12:00:00.000Z' },
    ]);
  });

  it('continua exibindo as Áreas quando a migração não pode regravar o storage', () => {
    const readOnlyStorage = {
      getItem: () => JSON.stringify([{
        areaCode: '4104', workCenterCode: 'CT-01', workCenterDescription: 'Centro 1',
        lastUsedAt: '2026-08-17T12:00:00.000Z',
      }]),
      setItem: () => { throw new Error('somente leitura'); },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 1,
    } satisfies Storage;
    const service = new RecentProductionContextService(
      { currentUser: { id: 'operador-1' } } as AuthSessionService,
      readOnlyStorage,
      () => new Date('2026-08-17T12:00:00Z'),
    );

    expect(service.list()).toEqual([
      { areaCode: '4104', lastUsedAt: '2026-08-17T12:00:00.000Z' },
    ]);
  });
});
