import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  PoButtonModule,
  PoFieldModule,
  PoLoadingModule,
  PoNotificationService,
  PoPageModule,
  PoWidgetModule,
} from '@po-ui/ng-components';

import { AuthSessionService } from '../../../../core/auth/auth-session.service';
import { AlterarEquipeSlide } from '../../components/alterar-equipe-slide/alterar-equipe-slide';
import { OperadoresTable } from '../../components/operadores-table/operadores-table';
import { Equipe } from '../../models/equipe.model';
import { EquipesService } from '../../services/equipes.service';

export type EquipesPageState = 'initial' | 'loading' | 'loaded' | 'empty' | 'saving' | 'error';

@Component({
  selector: 'app-equipes-page',
  imports: [
    CommonModule,
    FormsModule,
    PoButtonModule,
    PoFieldModule,
    PoLoadingModule,
    PoPageModule,
    PoWidgetModule,
    AlterarEquipeSlide,
    OperadoresTable,
  ],
  templateUrl: './equipes-page.html',
  styleUrls: ['./equipes-page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EquipesPage {
  @ViewChild(AlterarEquipeSlide) private alterarEquipeSlide?: AlterarEquipeSlide;

  private readonly equipesService = inject(EquipesService);
  private readonly notification = inject(PoNotificationService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly authSession = inject(AuthSessionService);

  readonly state = signal<EquipesPageState>('initial');
  readonly codigoEquipe = signal('');
  readonly equipe = signal<Equipe | null>(null);

  onConsultarEquipe(): void {
    const codigoEquipe = this.codigoEquipe().trim();

    if (!codigoEquipe || this.state() === 'loading') {
      this.notification.warning('Informe a equipe.');
      return;
    }

    this.state.set('loading');

    this.equipesService
      .consultarEquipe(codigoEquipe)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: equipe => {
          this.equipe.set(equipe);
          this.codigoEquipe.set(equipe.codigo);
          this.state.set(equipe.operadores.length > 0 ? 'loaded' : 'empty');
        },
        error: () => {
          this.equipe.set(null);
          this.state.set('error');
          this.notification.error('Não foi possível localizar a equipe.');
        },
      });
  }

  onAbrirAlteracao(): void {
    const equipe = this.equipe();

    if (!equipe) {
      this.notification.warning('Consulte uma equipe antes de alterar.');
      return;
    }

    this.alterarEquipeSlide?.abrir(equipe);
  }

  onEquipeAtualizada(equipe: Equipe): void {
    this.equipe.set(equipe);
    this.state.set(equipe.operadores.length > 0 ? 'loaded' : 'empty');
  }

  onVoltar(): void {
    void this.router.navigate(['/quality-control']);
  }

  onSair(): void {
    this.authSession.logout();
    void this.router.navigate(['/login']);
  }

  onCodigoEquipeChange(codigo: string): void {
    this.codigoEquipe.set(codigo);
  }

  onEquipeBlur(): void {
    if (this.codigoEquipe().trim()) {
      this.onConsultarEquipe();
    }
  }
}
