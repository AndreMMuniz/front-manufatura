import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { PoButtonModule, PoFieldModule, PoLoadingModule } from '@po-ui/ng-components';

import { buildSafeReturnUrl } from '../../../../core/auth/safe-return-url';
import { LoginError, LoginService } from '../../services/login.service';

@Component({
  selector: 'app-login-page',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoLoadingModule],
  templateUrl: './login-page.html',
  styleUrls: ['./login-page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {
  private static readonly fallbackUrl = '/menu';
  private static readonly emptyFieldsMessage = 'Informe login e senha.';

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly loginService = inject(LoginService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly changeDetector = inject(ChangeDetectorRef);

  login = '';
  senha = '';
  feedback = '';
  submitted = false;
  submitting = false;
  readonly emptyFieldsMessage = LoginPage.emptyFieldsMessage;

  get canSubmit(): boolean {
    return Boolean(this.login.trim() && this.senha.trim());
  }

  get isAuthenticated(): boolean {
    return this.loginService.usuarioLogado() !== null;
  }

  get usuarioLogado() {
    return this.loginService.usuarioLogado();
  }

  entrar(): void {
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

    this.loginService
      .login(this.login, this.senha)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.limparSenha();
          this.redirecionar();
          this.changeDetector.markForCheck();
        },
        error: error => {
          this.limparSenha();
          this.feedback = this.messageForError(error);
          this.submitting = false;
          this.changeDetector.markForCheck();
        },
      });
  }

  submit(): void {
    this.entrar();
  }

  validarFormulario(): boolean {
    return this.canSubmit;
  }

  redirecionar(): void {
    const target = this.safeReturnUrl;
    this.router.navigateByUrl(target).then(
      navigated => {
        if (!navigated) {
          this.submitting = false;
          this.changeDetector.markForCheck();
        }
      },
      () => {
        this.submitting = false;
        this.changeDetector.markForCheck();
      },
    );
  }

  limparSenha(): void {
    this.senha = '';
  }

  logout(): void {
    this.loginService.logout();
  }

  private get safeReturnUrl(): string {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    return buildSafeReturnUrl(returnUrl) ?? LoginPage.fallbackUrl;
  }

  private messageForError(error: unknown): string {
    if (error instanceof LoginError && error.code === 'communication') {
      return 'Não foi possível conectar ao servidor.';
    }

    if (error instanceof LoginError && error.code === 'invalid-credentials') {
      return 'Usuário ou senha inválidos.';
    }

    return 'Ocorreu um erro inesperado.';
  }
}
