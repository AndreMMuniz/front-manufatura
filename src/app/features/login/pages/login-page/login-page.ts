import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { PoButtonModule, PoFieldModule, PoPageModule, PoWidgetModule } from '@po-ui/ng-components';

import { AuthSessionService } from '../../../../core/auth/auth-session.service';

@Component({
  selector: 'app-login-page',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoPageModule, PoWidgetModule],
  templateUrl: './login-page.html',
  styleUrls: ['./login-page.css'],
})
export class LoginPage {
  private static readonly fallbackUrl = '/quality-control';
  private static readonly emptyFieldsMessage = 'Informe usuario e senha para entrar.';

  user = '';
  password = '';
  feedback = '';
  submitted = false;
  submitting = false;
  readonly emptyFieldsMessage = LoginPage.emptyFieldsMessage;

  constructor(
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly authSession: AuthSessionService,
  ) {}

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
      this.password = '';
      this.feedback = 'Usuario ou senha invalidos.';
      this.submitting = false;
      return;
    }

    this.password = '';
    this.router.navigateByUrl(this.safeReturnUrl).finally(() => {
      this.submitting = false;
    });
  }

  logout(): void {
    this.authSession.logout();
  }

  private get safeReturnUrl(): string {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');

    if (!returnUrl) {
      return LoginPage.fallbackUrl;
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(returnUrl);
    } catch {
      return LoginPage.fallbackUrl;
    }

    if (!decoded.startsWith('/') || decoded.startsWith('//') || decoded.startsWith('/login')) {
      return LoginPage.fallbackUrl;
    }

    return returnUrl;
  }
}
