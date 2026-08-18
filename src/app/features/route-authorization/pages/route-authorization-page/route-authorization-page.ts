import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';

import {
  PoButtonModule,
  PoDialogService,
  PoFieldModule,
  PoNotificationService,
  PoPageModule,
  PoWidgetModule,
} from '@po-ui/ng-components';

import { PendingAuthorizedRoute } from '../../models/route-authorization.model';
import { RouteAuthorizationService } from '../../services/route-authorization.service';

type PageState = 'initial' | 'loading' | 'ready' | 'empty' | 'validation-error' | 'error';

@Component({
  selector: 'app-route-authorization-page',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoPageModule, PoWidgetModule],
  templateUrl: './route-authorization-page.html',
  styleUrls: ['./route-authorization-page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RouteAuthorizationPage {
  private readonly service = inject(RouteAuthorizationService);
  private readonly dialog = inject(PoDialogService);
  private readonly notification = inject(PoNotificationService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private searchSequence = 0;

  readonly orderNumber = signal('');
  readonly operationCode = signal('');
  readonly routes = signal<PendingAuthorizedRoute[]>([]);
  readonly state = signal<PageState>('initial');
  readonly feedback = signal('Informe a ordem de produção e a operação para consultar.');
  readonly finalizingSheet = signal<number | null>(null);

  search(): void {
    if (this.state() === 'loading' || this.finalizingSheet() !== null) return;
    const order = positiveInteger(this.orderNumber());
    const operation = positiveInteger(this.operationCode());
    if (order === null || operation === null) {
      this.state.set('validation-error');
      this.feedback.set('Informe números inteiros positivos para a ordem e a operação.');
      return;
    }
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

  requestFinalization(route: PendingAuthorizedRoute): void {
    if (this.finalizingSheet() !== null) return;
    this.dialog.confirm({
      title: `Finalizar ficha ${route.sheetNumber} com autorização?`,
      message: `Esta ação aceitará ${route.outOfRangeComponents} componente(s) fora da faixa e não poderá ser desfeita.`,
      literals: { cancel: 'Cancelar', confirm: 'Finalizar com autorização' },
      confirm: () => this.finalizeRoute(route.sheetNumber),
    });
  }

  goBack(): void {
    if (this.finalizingSheet() !== null) return;
    void this.router.navigate(['/menu']);
  }

  private finalizeRoute(sheetNumber: number): void {
    if (this.finalizingSheet() !== null) return;
    this.finalizingSheet.set(sheetNumber);
    this.feedback.set(`Finalizando ficha ${sheetNumber}...`);
    this.service.finalize(sheetNumber).pipe(
      finalize(() => this.finalizingSheet.set(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: result => {
        this.notification.success(result.message);
        const remainingRoutes = this.routes().filter(route => route.sheetNumber !== sheetNumber);
        this.routes.set(remainingRoutes);
        this.state.set(remainingRoutes.length ? 'ready' : 'empty');
        this.feedback.set(result.message);
      },
      error: () => {
        this.feedback.set(`Não foi possível finalizar a ficha ${sheetNumber}. Tente novamente.`);
        this.notification.error(this.feedback());
      },
    });
  }
}

function positiveInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const numeric = Number(trimmed);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}
