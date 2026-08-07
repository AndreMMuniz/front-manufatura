import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { PoDialogService, PoNotificationService, PoPageSlideComponent } from '@po-ui/ng-components';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { Equipe } from '../../models/equipe.model';
import { Operador } from '../../models/operador.model';
import { EquipesService } from '../../services/equipes.service';
import { GerenciarEquipeResultado, GerenciarEquipeSlide } from './gerenciar-equipe-slide';

describe('GerenciarEquipeSlide', () => {
  it('não abre nem consulta catálogos sem Área e CT válidos', () => {
    const { component, service, pageSlide, notification } = createComponent();

    component.abrir({ areaCode: ' ', workCenterCode: 'CT-EXT-01' });

    expect(pageSlide.open).not.toHaveBeenCalled();
    expect(service.listarOperadores).not.toHaveBeenCalled();
    expect(service.listarEquipesElegiveis).not.toHaveBeenCalled();
    expect(notification.warning).toHaveBeenCalledWith(
      'Informe a Área de Produção e o Centro de Trabalho.',
    );
  });

  it('abre em Nova equipe, exibe o contexto e carrega os dois catálogos', () => {
    const { component, service, pageSlide } = createComponent();

    component.abrir(contexto());

    expect(pageSlide.open).toHaveBeenCalledOnce();
    expect(service.listarOperadores).toHaveBeenCalledOnce();
    expect(service.listarEquipesElegiveis).toHaveBeenCalledWith('4001', 'CT-EXT-01');
    expect(component.state()).toBe('ready');
    expect(component.modo()).toBe('nova');
    expect(component.contexto()?.areaLabel).toBe('Extrusão');
  });

  it('carrega uma equipe elegível no modo Existente e mantém seus dados imutáveis', () => {
    const { component } = createComponent();
    component.abrir(contexto(), 'existente');

    component.onSelecionarEquipe('MONT03');

    expect(component.codigo()).toBe('MONT03');
    expect(component.descricao()).toBe('Montagem Zap');
    expect(component.turno()).toBe('Turno 3');
    expect([...component.codigosSelecionados()]).toEqual(['001', '002']);
    expect(component.possuiAlteracoes()).toBe(false);
  });

  it('confirma antes de trocar modo, equipe ou contexto com alterações não salvas', () => {
    const { component, dialog } = createComponent();
    component.abrir(contexto());
    component.onCodigoChange('RASCUNHO');

    component.onModoChange('existente');
    expect(component.modo()).toBe('nova');
    expect(component.codigo()).toBe('RASCUNHO');
    const confirmMode = dialog.confirm.mock.calls[0][0].confirm as () => void;
    confirmMode();
    expect(component.modo()).toBe('existente');
    expect(component.codigo()).toBe('');

    component.onSelecionarEquipe('MONT03');
    component.onSelecionarOperador({ codigo: '001', nome: 'Operador 1' }, false);
    component.onSelecionarEquipe(undefined);
    expect(component.equipeSelecionadaCodigo()).toBe('MONT03');
    const confirmTeam = dialog.confirm.mock.calls[1][0].confirm as () => void;
    confirmTeam();
    expect(component.equipeSelecionadaCodigo()).toBe('');

    component.onModoChange('nova');
    component.onCodigoChange('OUTRO-RASCUNHO');
    component.abrir({ areaCode: '4002', workCenterCode: 'CT-CQ-01' });
    expect(component.contexto()).toEqual(contexto());
    const confirmContext = dialog.confirm.mock.calls[2][0].confirm as () => void;
    confirmContext();
    expect(component.contexto()).toEqual({ areaCode: '4002', workCenterCode: 'CT-CQ-01' });
    expect(component.codigo()).toBe('');
  });

  it('aceita seleção limpa e normaliza labels contextuais vazios', () => {
    const { component } = createComponent();
    component.abrir(
      {
        areaCode: '4001',
        workCenterCode: 'CT-EXT-01',
        areaLabel: '   ',
        workCenterLabel: ' Extrusora 01 ',
      },
      'existente',
    );

    component.onSelecionarEquipe(undefined);

    expect(component.equipeSelecionadaCodigo()).toBe('');
    expect(component.contexto()).toEqual({
      areaCode: '4001',
      workCenterCode: 'CT-EXT-01',
      workCenterLabel: 'Extrusora 01',
    });
  });

  it('filtra 500 operadores sem caixa ou acento e Todos altera somente os visíveis', () => {
    const operadores = catalogoGrande();
    const { component } = createComponent({ operadores });
    component.abrir(contexto());
    component.onSelecionarOperador(operadores[10], true);

    component.onPesquisarOperador('JOSE 049');
    expect(component.operadoresFiltrados().map((item) => item.codigo)).toEqual(['049']);
    component.onSelecionarTodos(true);
    expect(component.codigosSelecionados().has('049')).toBe(true);
    expect(component.codigosSelecionados().has('011')).toBe(true);

    component.onPesquisarOperador('Operador 050');
    component.onSelecionarTodos(true);
    expect(component.codigosSelecionados()).toEqual(new Set(['011', '049', '050']));
    component.onSelecionarTodos(false);
    expect(component.codigosSelecionados()).toEqual(new Set(['011', '049']));
  });

  it('valida os campos de criação e anuncia feedback acessível', () => {
    const { component, service, fixture } = createComponent();
    const realPageSlide = fixture.debugElement.query(By.directive(PoPageSlideComponent))
      .componentInstance as PoPageSlideComponent;
    (component as unknown as { pageSlide: PoPageSlideComponent }).pageSlide = realPageSlide;
    component.abrir(contexto());

    component.onSalvar();
    fixture.detectChanges();

    expect(service.criarEquipe).not.toHaveBeenCalled();
    expect(component.feedback()).toBe('Informe o código da equipe.');
    const feedback = fixture.nativeElement.querySelector('.gerenciar-equipe__feedback');
    expect(feedback).not.toBeNull();
    expect(feedback.textContent).toContain('Informe o código da equipe.');
    expect(feedback.getAttribute('aria-live')).toBe('assertive');
    expect(feedback.getAttribute('aria-atomic')).toBe('true');
    expect(feedback.getAttribute('role')).toBe('alert');
    expect(
      fixture.nativeElement.querySelector('[role="group"][aria-label="Modo de gerenciamento"]'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('.gerenciar-equipe__operator po-checkbox').textContent,
    ).toContain('001 Operador 1');
  });

  it('cria uma equipe, emite um único resultado e fecha', () => {
    const criada = equipe('NOVA01', ['003']);
    const { component, service, pageSlide, notification } = createComponent({ criada });
    const emitted = vi.fn();
    component.equipeSalva.subscribe(emitted);
    component.abrir(contexto());
    preencherCriacao(component);

    component.onSalvar();
    component.onSalvar();

    expect(service.criarEquipe).toHaveBeenCalledOnce();
    expect(service.criarEquipe).toHaveBeenCalledWith({
      areaCode: '4001',
      workCenterCode: 'CT-EXT-01',
      codigo: 'NOVA01',
      descricao: 'Equipe Nova',
      turno: 'Turno 1',
      operadores: ['003'],
    });
    expect(emitted).toHaveBeenCalledOnce();
    expect(emitted).toHaveBeenCalledWith({
      equipe: criada,
      modo: 'nova',
      contexto: contexto(),
    });
    expect(notification.success).toHaveBeenCalledWith('Equipe salva com sucesso.');
    expect(pageSlide.close).toHaveBeenCalledOnce();
  });

  it('atualiza a equipe existente pelos novos contratos', () => {
    const atualizada = equipe('MONT03', ['003']);
    const { component, service } = createComponent({ atualizada });
    const emitted = vi.fn();
    component.equipeSalva.subscribe(emitted);
    component.abrir(contexto(), 'existente');
    component.onSelecionarEquipe('MONT03');
    component.onSelecionarOperador({ codigo: '001', nome: 'Operador 1' }, false);
    component.onSelecionarOperador({ codigo: '002', nome: 'Operador 2' }, false);
    component.onSelecionarOperador({ codigo: '003', nome: 'Operador 3' }, true);

    component.onSalvar();

    expect(service.atualizarEquipe).toHaveBeenCalledWith({
      areaCode: '4001',
      workCenterCode: 'CT-EXT-01',
      codigo: 'MONT03',
      operadores: ['003'],
    });
    expect(emitted).toHaveBeenCalledWith({
      equipe: atualizada,
      modo: 'existente',
      contexto: contexto(),
    });
  });

  it('emite cópias defensivas do modo e contexto capturados no início do save', () => {
    const save$ = new Subject<Equipe>();
    const { component, service } = createComponent();
    service.criarEquipe.mockReturnValue(save$);
    const emitted: GerenciarEquipeResultado[] = [];
    component.equipeSalva.subscribe((resultado) => emitted.push(resultado));
    component.abrir(contexto());
    preencherCriacao(component);

    component.onSalvar();
    component.contexto.set({
      areaCode: '4002',
      workCenterCode: 'CT-CQ-01',
      areaLabel: 'Qualidade',
    });
    component.modo.set('existente');
    const criada = equipe('NOVA01', ['003']);
    save$.next(criada);
    save$.complete();

    expect(emitted).toEqual([
      {
        equipe: criada,
        modo: 'nova',
        contexto: contexto(),
      },
    ]);
    expect(emitted[0].equipe).not.toBe(criada);
    expect(emitted[0].equipe.operadores).not.toBe(criada.operadores);
    expect(emitted[0].contexto).not.toBe(component.contexto());
  });

  it('não permite nova abertura enquanto um salvamento está em andamento', () => {
    const save$ = new Subject<Equipe>();
    const { component, service, pageSlide, notification } = createComponent();
    service.criarEquipe.mockReturnValue(save$);
    component.abrir(contexto());
    preencherCriacao(component);
    component.onSalvar();

    component.abrir({ areaCode: '4002', workCenterCode: 'CT-CQ-01' });

    expect(component.contexto()).toEqual(contexto());
    expect(pageSlide.open).toHaveBeenCalledOnce();
    expect(notification.warning).toHaveBeenCalledWith(
      'Aguarde o salvamento da equipe em andamento.',
    );
  });

  it('preserva uma nova abertura iniciada por listener síncrono de equipeSalva', () => {
    const { component, pageSlide } = createComponent();
    component.equipeSalva.subscribe(() => {
      component.abrir({ areaCode: '4002', workCenterCode: 'CT-CQ-01' });
    });
    component.abrir(contexto());
    preencherCriacao(component);

    component.onSalvar();

    expect(component.contexto()).toEqual({ areaCode: '4002', workCenterCode: 'CT-CQ-01' });
    expect(component.state()).toBe('ready');
    expect(pageSlide.open).toHaveBeenCalledTimes(2);
    expect(pageSlide.close).toHaveBeenCalledOnce();
  });

  it('preserva modo, campos, filtro e seleção após erro de save e permite retry', () => {
    const save$ = new Subject<Equipe>();
    const { component, service } = createComponent();
    service.criarEquipe
      .mockReturnValueOnce(save$)
      .mockReturnValueOnce(of(equipe('NOVA01', ['003'])));
    component.abrir(contexto());
    preencherCriacao(component);
    component.onPesquisarOperador('003');

    component.onSalvar();
    save$.error(new Error('Falha temporária'));

    expect(component.state()).toBe('error');
    expect(component.errorKind()).toBe('save');
    expect(component.codigo()).toBe('NOVA01');
    expect(component.termoPesquisa()).toBe('003');
    expect(component.codigosSelecionados()).toEqual(new Set(['003']));

    component.onTentarNovamente();
    expect(service.criarEquipe).toHaveBeenCalledTimes(2);
  });

  it('mostra erro de carga, não habilita save e repete apenas a carga', () => {
    const { component, service } = createComponent();
    service.listarOperadores
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(of(operadores()));

    component.abrir(contexto());
    expect(component.state()).toBe('error');
    expect(component.errorKind()).toBe('load');

    component.onSalvar();
    expect(service.criarEquipe).not.toHaveBeenCalled();
    component.onTentarNovamente();

    expect(service.listarOperadores).toHaveBeenCalledTimes(2);
    expect(component.state()).toBe('ready');
  });

  it('ignora respostas de carga obsoletas depois de uma nova abertura', () => {
    const oldOperators = new Subject<ReadonlyArray<Operador>>();
    const oldTeams = new Subject<ReadonlyArray<Equipe>>();
    const { component, service } = createComponent();
    service.listarOperadores
      .mockReturnValueOnce(oldOperators)
      .mockReturnValueOnce(of([{ codigo: '010', nome: 'Contexto novo' }]));
    service.listarEquipesElegiveis.mockReturnValueOnce(oldTeams).mockReturnValueOnce(of([]));

    component.abrir(contexto());
    component.abrir({ areaCode: '4002', workCenterCode: 'CT-CQ-01' });
    oldOperators.next([{ codigo: '001', nome: 'Contexto antigo' }]);
    oldOperators.complete();
    oldTeams.next([equipe('MONT03', ['001'])]);
    oldTeams.complete();

    expect(component.operadores()).toEqual([{ codigo: '010', nome: 'Contexto novo' }]);
    expect(component.equipesElegiveis()).toEqual([]);
    expect(component.contexto()).toEqual({ areaCode: '4002', workCenterCode: 'CT-CQ-01' });
  });

  it('confirma descarte apenas quando há alterações e cancelamento não emite equipe', () => {
    const { component, dialog, pageSlide } = createComponent();
    const saved = vi.fn();
    const cancelled = vi.fn();
    component.equipeSalva.subscribe(saved);
    component.cancelado.subscribe(cancelled);
    component.abrir(contexto());
    component.onVoltar();

    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(pageSlide.close).toHaveBeenCalledOnce();
    expect(cancelled).toHaveBeenCalledOnce();

    component.abrir(contexto());
    component.onCodigoChange('NOVA01');
    expect(component.possuiAlteracoes()).toBe(true);
    component.onVoltar();
    expect(dialog.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Descartar alterações?',
        confirm: expect.any(Function),
      }),
    );
    expect(saved).not.toHaveBeenCalled();
  });

  it('reabre e confirma descarte quando ESC ou botão nativo tenta fechar um draft', () => {
    const { component, dialog, pageSlide } = createComponent();
    component.abrir(contexto());
    component.onCodigoChange('NOVA01');
    expect(component.possuiAlteracoes()).toBe(true);
    pageSlide.open.mockClear();

    component.onPageSlideClose();

    expect(pageSlide.open).toHaveBeenCalledOnce();
    expect(dialog.confirm).toHaveBeenCalledOnce();
  });

  it('processa ESC real do po-page-slide pela confirmação de descarte', () => {
    const { component, dialog, fixture } = createComponent();
    const realPageSlide = fixture.debugElement.query(By.directive(PoPageSlideComponent))
      .componentInstance as PoPageSlideComponent;
    (component as unknown as { pageSlide: PoPageSlideComponent }).pageSlide = realPageSlide;
    component.abrir(contexto());
    component.onCodigoChange('NOVA01');
    fixture.detectChanges();

    const slide = fixture.nativeElement.querySelector('.po-page-slide');
    slide.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(dialog.confirm).toHaveBeenCalledOnce();
    expect(component.state()).not.toBe('closed');
  });

  it('mantém uma única confirmação e ignora callback obsoleto após nova abertura', () => {
    const { component, dialog } = createComponent();
    component.abrir(contexto());
    component.onCodigoChange('NOVA01');

    component.onVoltar();
    component.onVoltar();
    expect(dialog.confirm).toHaveBeenCalledOnce();

    const firstConfirm = dialog.confirm.mock.calls[0][0].confirm as () => void;
    component.onCodigoChange('');
    component.onVoltar();
    component.abrir({ areaCode: '4002', workCenterCode: 'CT-CQ-01' });
    firstConfirm();

    expect(component.state()).toBe('ready');
    expect(component.contexto()).toEqual({ areaCode: '4002', workCenterCode: 'CT-CQ-01' });
  });

  it('foca o primeiro controle e devolve o foco ao acionador ao fechar', () => {
    vi.useFakeTimers();
    const { component } = createComponent();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    const triggerFocus = vi.spyOn(trigger, 'focus');
    const firstControl = (
      component as unknown as { firstControl: { nativeElement: HTMLButtonElement } }
    ).firstControl.nativeElement;
    const firstControlFocus = vi.spyOn(firstControl, 'focus');

    component.abrir(contexto(), 'nova', trigger);
    vi.runAllTimers();
    expect(firstControlFocus).toHaveBeenCalled();

    component.onVoltar();
    vi.runAllTimers();
    expect(triggerFocus).toHaveBeenCalled();
    trigger.remove();
    vi.useRealTimers();
  });

  it('não deixa timer pendente roubar foco depois de fechamento imediato', () => {
    vi.useFakeTimers();
    const { component } = createComponent();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    const triggerFocus = vi.spyOn(trigger, 'focus');
    const firstControl = (
      component as unknown as { firstControl: { nativeElement: HTMLButtonElement } }
    ).firstControl.nativeElement;
    const firstControlFocus = vi.spyOn(firstControl, 'focus');

    component.abrir(contexto(), 'nova', trigger);
    component.onVoltar();
    vi.runAllTimers();

    expect(triggerFocus).toHaveBeenCalledOnce();
    expect(firstControlFocus).not.toHaveBeenCalled();
    trigger.remove();
    vi.useRealTimers();
  });
});

function createComponent(
  options: {
    readonly operadores?: ReadonlyArray<Operador>;
    readonly criada?: Equipe;
    readonly atualizada?: Equipe;
  } = {},
) {
  const operadoresMock = options.operadores ?? operadores();
  const elegiveis: ReadonlyArray<Equipe> = [
    {
      codigo: 'MONT03',
      descricao: 'Montagem Zap',
      turno: 'Turno 3',
      operadores: operadoresMock.slice(0, 2),
    },
  ];
  const service = {
    listarOperadores: vi.fn(() => of(operadoresMock)),
    listarEquipesElegiveis: vi.fn(() => of(elegiveis)),
    filtrarOperadores: vi.fn((items: ReadonlyArray<Operador>, termo: string) => {
      const normalized = normalize(termo);
      return normalized
        ? items.filter((item) => normalize(`${item.codigo} ${item.nome}`).includes(normalized))
        : items;
    }),
    criarEquipe: vi.fn(() => of(options.criada ?? equipe('NOVA01', ['003']))),
    atualizarEquipe: vi.fn(() => of(options.atualizada ?? equipe('MONT03', ['003']))),
  };
  const notification = { warning: vi.fn(), error: vi.fn(), success: vi.fn() };
  const dialog = { confirm: vi.fn() };
  TestBed.configureTestingModule({
    imports: [GerenciarEquipeSlide],
    providers: [
      provideNoopAnimations(),
      { provide: EquipesService, useValue: service },
      { provide: PoNotificationService, useValue: notification },
      { provide: PoDialogService, useValue: dialog },
    ],
  });
  TestBed.overrideProvider(PoDialogService, { useValue: dialog });
  TestBed.overrideProvider(PoNotificationService, { useValue: notification });
  const fixture = TestBed.createComponent(GerenciarEquipeSlide);
  fixture.detectChanges();
  const component = fixture.componentInstance;
  const pageSlide = { open: vi.fn(), close: vi.fn() };
  (component as unknown as { pageSlide: typeof pageSlide }).pageSlide = pageSlide;
  const injectedDialog = (component as unknown as { dialog: typeof dialog }).dialog;
  const injectedNotification = (component as unknown as { notification: typeof notification })
    .notification;
  return {
    fixture,
    component,
    service,
    notification: injectedNotification,
    dialog: injectedDialog,
    pageSlide,
  };
}

function contexto() {
  return {
    areaCode: '4001',
    workCenterCode: 'CT-EXT-01',
    areaLabel: 'Extrusão',
    workCenterLabel: 'Extrusora 01',
  };
}

function operadores(): ReadonlyArray<Operador> {
  return [
    { codigo: '001', nome: 'Operador 1' },
    { codigo: '002', nome: 'Operador 2' },
    { codigo: '003', nome: 'Operador 3' },
  ];
}

function catalogoGrande(): ReadonlyArray<Operador> {
  return Array.from({ length: 500 }, (_, index) => {
    const codigo = String(index + 1).padStart(3, '0');
    return { codigo, nome: index === 48 ? 'José 049' : `Operador ${codigo}` };
  });
}

function equipe(codigo: string, codigos: ReadonlyArray<string>): Equipe {
  return {
    codigo,
    descricao: codigo === 'MONT03' ? 'Montagem Zap' : 'Equipe Nova',
    turno: codigo === 'MONT03' ? 'Turno 3' : 'Turno 1',
    operadores: operadores().filter((item) => codigos.includes(item.codigo)),
  };
}

function preencherCriacao(component: GerenciarEquipeSlide): void {
  component.onCodigoChange('NOVA01');
  component.onDescricaoChange('Equipe Nova');
  component.onTurnoChange('Turno 1');
  component.onSelecionarOperador({ codigo: '003', nome: 'Operador 3' }, true);
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}
