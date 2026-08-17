import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EventEmitter,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  PoButtonModule,
  PoDialogService,
  PoFieldModule,
  PoNotificationService,
  PoPageModule,
  PoPageSlideComponent,
  PoPageSlideModule,
} from '@po-ui/ng-components';

import { LoadingIndicator } from '../../../../shared/components/loading-indicator/loading-indicator';
import { Equipe } from '../../models/equipe.model';
import { Operador } from '../../models/operador.model';
import { EquipesService } from '../../services/equipes.service';

export type AlterarEquipeSlideState = 'closed' | 'loading' | 'ready' | 'saving' | 'error';

@Component({
  selector: 'app-alterar-equipe-slide',
  imports: [CommonModule, FormsModule, PoButtonModule, PoFieldModule, PoPageModule, PoPageSlideModule, LoadingIndicator],
  templateUrl: './alterar-equipe-slide.html',
  styleUrls: ['./alterar-equipe-slide.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlterarEquipeSlide {
  @Output() equipeAtualizada = new EventEmitter<Equipe>();

  @ViewChild('pageSlide', { static: true }) private pageSlide!: PoPageSlideComponent;

  private readonly equipesService = inject(EquipesService);
  private readonly notification = inject(PoNotificationService);
  private readonly dialog = inject(PoDialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly state = signal<AlterarEquipeSlideState>('closed');
  readonly equipe = signal<Equipe | null>(null);
  readonly termoPesquisa = signal('');
  readonly operadores = signal<ReadonlyArray<Operador>>([]);
  readonly codigosSelecionados = signal<ReadonlySet<string>>(new Set<string>());

  readonly operadoresFiltrados = computed(() =>
    this.equipesService.filtrarOperadores(this.operadores(), this.termoPesquisa()),
  );

  readonly todosVisiveisSelecionados = computed(() => {
    const operadoresFiltrados = this.operadoresFiltrados();

    return (
      operadoresFiltrados.length > 0 &&
      operadoresFiltrados.every(operador => this.codigosSelecionados().has(operador.codigo))
    );
  });

  readonly possuiAlteracoes = computed(() => {
    const equipe = this.equipe();

    if (!equipe) {
      return false;
    }

    return this.selectionKey(equipe.operadores) !== this.selectionKey([...this.codigosSelecionados()].map(codigo => ({ codigo, nome: '' })));
  });

  abrir(equipe: Equipe): void {
    this.equipe.set(equipe);
    this.termoPesquisa.set('');
    this.codigosSelecionados.set(new Set(equipe.operadores.map(operador => operador.codigo)));
    this.operadores.set([]);
    this.state.set('loading');
    this.pageSlide.open();

    this.equipesService
      .listarOperadores()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: operadores => {
          this.operadores.set(operadores);
          this.state.set('ready');
        },
        error: () => {
          this.state.set('error');
          this.notification.error('Erro ao comunicar com o servidor.');
        },
      });
  }

  onPesquisarOperador(termo: string): void {
    this.termoPesquisa.set(termo);
  }

  onSelecionarOperador(operador: Operador, selecionado: boolean): void {
    const selecionados = new Set(this.codigosSelecionados());

    if (selecionado) {
      selecionados.add(operador.codigo);
    } else {
      selecionados.delete(operador.codigo);
    }

    this.codigosSelecionados.set(selecionados);
  }

  onSelecionarTodos(selecionado: boolean): void {
    const selecionados = new Set(this.codigosSelecionados());

    for (const operador of this.operadoresFiltrados()) {
      if (selecionado) {
        selecionados.add(operador.codigo);
      } else {
        selecionados.delete(operador.codigo);
      }
    }

    this.codigosSelecionados.set(selecionados);
  }

  onSalvar(): void {
    const equipe = this.equipe();

    if (!equipe || this.state() === 'saving') {
      return;
    }

    this.state.set('saving');

    this.equipesService
      .salvarEquipe({
        codigoEquipe: equipe.codigo,
        operadores: [...this.codigosSelecionados()],
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          const operadoresSelecionados = this.operadores().filter(operador =>
            this.codigosSelecionados().has(operador.codigo),
          );
          const equipeAtualizada = this.equipesService.montarEquipeAtualizada(equipe, operadoresSelecionados);

          this.equipeAtualizada.emit(equipeAtualizada);
          this.notification.success('Equipe salva com sucesso.');
          this.fechar();
        },
        error: () => {
          this.state.set('error');
          this.notification.error('Não foi possível salvar as alterações.');
        },
      });
  }

  onVoltar(): void {
    if (!this.possuiAlteracoes()) {
      this.fechar();
      return;
    }

    this.dialog.confirm({
      title: 'Descartar alterações?',
      message: 'Deseja descartar as alterações?',
      confirm: () => this.fechar(),
      literals: { cancel: 'Cancelar', confirm: 'Descartar' },
    });
  }

  isSelecionado(operador: Operador): boolean {
    return this.codigosSelecionados().has(operador.codigo);
  }

  trackOperador(_index: number, operador: Operador): string {
    return operador.codigo;
  }

  private fechar(): void {
    this.state.set('closed');
    this.pageSlide.close();
  }

  private selectionKey(operadores: ReadonlyArray<Pick<Operador, 'codigo'>>): string {
    return operadores
      .map(operador => operador.codigo)
      .sort((a, b) => a.localeCompare(b))
      .join('|');
  }
}
