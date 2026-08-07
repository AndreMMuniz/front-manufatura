import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';

import { AuthSessionService } from '../../../auth/auth-session.service';
import {
  OperationalCorrectionContextService,
} from '../../services/operational-correction-context.service';

@Component({
  selector: 'app-operational-correction-notice',
  standalone: true,
  template: `
    @if (correction(); as current) {
      <section class="correction-notice" role="status" aria-live="polite">
        <div>
          <strong>Correção de registro preservado</strong>
          <p>
            Revise os campos carregados e confirme no fluxo do módulo. A confirmação criará
            um novo comando auditável; o original não será alterado.
          </p>
        </div>
        <button type="button" (click)="cancel(current.sourceLocalId)">
          Cancelar correção
        </button>
      </section>
    }
  `,
  styles: [`
    .correction-notice {
      align-items: center;
      background: var(--color-feedback-info-lightest, #eaf4ff);
      border: 1px solid var(--color-feedback-info-base, #0c7);
      border-radius: 8px;
      display: flex;
      gap: 1rem;
      justify-content: space-between;
      margin-block-end: 1rem;
      padding: 1rem;
    }

    .correction-notice p {
      margin: .25rem 0 0;
    }

    .correction-notice button {
      min-height: 48px;
      white-space: nowrap;
    }

    @media (max-width: 700px) {
      .correction-notice {
        align-items: stretch;
        flex-direction: column;
      }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OperationalCorrectionNotice {
  private readonly auth = inject(AuthSessionService);
  private readonly context = inject(OperationalCorrectionContextService);
  private readonly router = inject(Router);

  readonly correction = computed(() => {
    const ownerId = this.auth.currentUser?.id.trim();
    return ownerId ? this.context.current(ownerId) : null;
  });

  cancel(sourceLocalId: string): void {
    this.context.clear(sourceLocalId);
    void this.router.navigateByUrl('/synchronization');
  }
}
