import { ChangeDetectionStrategy, Component, DestroyRef, ViewChild, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  PoButtonModule,
  PoFieldModule,
  PoPageModule,
  PoWidgetModule,
} from '@po-ui/ng-components';

import { RouteAnalysisSlide } from '../../components/route-analysis-slide/route-analysis-slide';
import { AuthorizedRouteFinalizationOutcome, PendingAuthorizedRoute } from '../../models/route-authorization.model';
import { RouteAuthorizationService } from '../../services/route-authorization.service';

type PageState = 'initial' | 'loading' | 'ready' | 'empty' | 'validation-error' | 'error';

@Component({
  selector: 'app-route-authorization-page',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoPageModule, PoWidgetModule, RouteAnalysisSlide],
  templateUrl: './route-authorization-page.html',
  styleUrls: ['./route-authorization-page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RouteAuthorizationPage {
  @ViewChild(RouteAnalysisSlide) private analysisSlide!: RouteAnalysisSlide;

  private readonly service = inject(RouteAuthorizationService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private searchSequence = 0;
  private queriedOperation: number | null = null;
  private analysisTrigger: HTMLElement | null = null;

  readonly orderNumber = signal('');
  readonly operationCode = signal('');
  readonly routes = signal<PendingAuthorizedRoute[]>([]);
  readonly state = signal<PageState>('initial');
  readonly feedback = signal('Informe a ordem de produção e a operação para consultar.');

  search(): void {
    if (this.state() === 'loading') return;
    const order = positiveInteger(this.orderNumber());
    const operation = positiveInteger(this.operationCode());
    if (order === null || operation === null) {
      this.state.set('validation-error');
      this.feedback.set('Informe números inteiros positivos para a ordem e a operação.');
      return;
    }
    this.queriedOperation = operation;
    const sequence = ++this.searchSequence;
    this.routes.set([]);
    this.state.set('loading');
    this.feedback.set('Consultando roteiros pendentes...');
    this.service.search(order, operation)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: routes => {
          if (sequence !== this.searchSequence) return;
          this.routes.set(routes);
          this.state.set(routes.length ? 'ready' : 'empty');
          this.feedback.set(routes.length
            ? `${routes.length} ficha(s) pendente(s) encontrada(s).`
            : 'Nenhum roteiro pendente foi encontrado para os filtros informados.');
        },
        error: () => {
          if (sequence !== this.searchSequence) return;
          this.state.set('error');
          this.feedback.set('Não foi possível consultar os roteiros. Tente novamente.');
        },
      });
  }

  retry(): void {
    this.search();
  }

  requestAnalysis(route: PendingAuthorizedRoute, trigger: HTMLElement): void {
    const operation = this.queriedOperation ?? positiveInteger(this.operationCode());
    if (operation === null) return;

    this.analysisTrigger = trigger;
    this.analysisSlide.open(route, operation);
  }

  onRouteFinalized(outcome: AuthorizedRouteFinalizationOutcome): void {
    this.feedback.set(outcome.message);
    if (!outcome.finalized) return;

    const remainingRoutes = this.routes().filter(route => route.sheetNumber !== outcome.sheetNumber);
    this.routes.set(remainingRoutes);
    this.state.set(remainingRoutes.length ? 'ready' : 'empty');
  }

  onAnalysisClosed(): void {
    const trigger = this.analysisTrigger;
    this.analysisTrigger = null;
    if (trigger?.isConnected) trigger.focus();
  }

  goBack(): void {
    void this.router.navigate(['/menu']);
  }
}

function positiveInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const numeric = Number(trimmed);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}
