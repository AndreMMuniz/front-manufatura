import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  QueryList,
  ViewChild,
  ViewChildren,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  PoButtonModule,
  PoButtonComponent,
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
  @ViewChildren('analysisTrigger') private analysisTriggers!: QueryList<PoButtonComponent>;

  private readonly service = inject(RouteAuthorizationService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private searchSequence = 0;
  private queriedOperation: number | null = null;
  private analysisTriggerSheet: number | null = null;
  private focusRestoreSequence = 0;

  readonly orderNumber = signal('');
  readonly operationCode = signal('');
  readonly routes = signal<PendingAuthorizedRoute[]>([]);
  readonly state = signal<PageState>('initial');
  readonly feedback = signal('Informe a ordem de produção e a operação ou consulte sem filtros.');
  readonly analyzing = signal(false);
  readonly canAnalyze = signal(false);

  search(): void {
    if (this.state() === 'loading') return;
    const hasOrder = this.orderNumber().trim().length > 0;
    const hasOperation = this.operationCode().trim().length > 0;
    const order = hasOrder ? positiveInteger(this.orderNumber()) : null;
    const operation = hasOperation ? positiveInteger(this.operationCode()) : null;
    const isUnfilteredSearch = !hasOrder && !hasOperation;
    if (!isUnfilteredSearch && (order === null || operation === null)) {
      this.state.set('validation-error');
      this.feedback.set('Informe ordem e operação como números inteiros positivos ou deixe ambos vazios.');
      return;
    }
    this.queriedOperation = operation;
    this.canAnalyze.set(operation !== null);
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
            ? `${routes.length} ficha(s) pendente(s) encontrada(s).${isUnfilteredSearch
              ? ' Para analisar, informe a ordem e a operação.'
              : ''}`
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

  requestAnalysis(route: PendingAuthorizedRoute): void {
    if (this.analyzing()) return;
    const operation = this.queriedOperation ?? positiveInteger(this.operationCode());
    if (operation === null) return;

    ++this.focusRestoreSequence;
    this.analysisTriggerSheet = route.sheetNumber;
    this.analyzing.set(true);
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
    const sheetNumber = this.analysisTriggerSheet;
    const focusRestoreSequence = ++this.focusRestoreSequence;
    this.analysisTriggerSheet = null;
    this.analyzing.set(false);
    if (sheetNumber === null) return;

    afterNextRender(() => {
      if (focusRestoreSequence !== this.focusRestoreSequence || this.analyzing()) return;
      const trigger = this.analysisTriggers.find(button =>
        button.elementRef.nativeElement.dataset.routeSheet === String(sheetNumber));
      if (trigger?.elementRef.nativeElement.isConnected) trigger.focus();
    }, { injector: this.injector });
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
