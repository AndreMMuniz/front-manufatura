import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { PoButtonModule, PoFieldModule, PoPageModule, PoWidgetModule } from '@po-ui/ng-components';

import { AuthSessionService } from '../../../../core/auth/auth-session.service';
import { buildSafeReturnUrl } from '../../../../core/auth/safe-return-url';

@Component({
  selector: 'app-login-page',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoPageModule, PoWidgetModule],
  templateUrl: './login-page.html',
  styleUrls: ['./login-page.css'],
})
export class LoginPage {
  private static readonly fallbackUrl = '/menu';
  private static readonly emptyFieldsMessage = 'Informe usuário e senha para entrar.';

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly authSession = inject(AuthSessionService);

  user = '';
  password = '';
  feedback = '';
  submitted = false;
  submitting = false;
  readonly emptyFieldsMessage = LoginPage.emptyFieldsMessage;

  get canSubmit(): boolean {
    return Boolean(this.user.trim() && this.password.trim());
  }

  get isAuthenticated(): boolean {
    return this.authSession.isAuthenticated();
  }

  submit(): void {
    if (this.submitting) {
      return;
    }

    this.submitting = true;
    this.submitted = true;
    this.feedback = '';

    if (!this.canSubmit) {
      this.feedback = LoginPage.emptyFieldsMessage;
      this.submitting = false;
      return;
    }

    const success = this.authSession.login(this.user, this.password);

    if (!success) {
      // Cleared password intentionally kept; per spec DEV NOTES: "Preservar a
      // validação de campos obrigatórios, feedback de erro genérico e limpeza
      // de senha." — username is preserved so the user can retry.
      this.password = '';
      this.feedback = 'Usuário ou senha inválidos.';
      this.submitting = false;
      return;
    }

    this.password = '';
    const target = this.safeReturnUrl;
    this.router.navigateByUrl(target).then(
      navigated => {
        // Success: component is being navigated away. Leave `submitting=true`
        // as a terminal state so a re-entrant submit does not race with the
        // outgoing navigation. If navigation was cancelled (false), reset.
        if (!navigated) {
          this.submitting = false;
        }
      },
      () => {
        // Navigation rejected/cancelled: ensure the form is usable again.
        this.submitting = false;
      },
    );
  }

  logout(): void {
    this.authSession.logout();
    // Reactive session$ subscribers (App) drive the redirect to /login.
  }

  private get safeReturnUrl(): string {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    return buildSafeReturnUrl(returnUrl) ?? LoginPage.fallbackUrl;
  }
}
