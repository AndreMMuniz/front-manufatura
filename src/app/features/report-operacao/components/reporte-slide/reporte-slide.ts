import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Output,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  PoButtonModule,
  PoDialogService,
  PoFieldModule,
  PoPageSlideComponent,
  PoPageSlideModule,
} from '@po-ui/ng-components';

import { ReporteParcialOperacao } from '../../models/report-operacao.model';

export interface ReporteParcialDraft {
  readonly quantidadeAprovada: number;
  readonly quantidadeRetrabalho: number;
  readonly quantidadeRefugo: number;
}

@Component({
  selector: 'app-reporte-slide',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoPageSlideModule],
  templateUrl: './reporte-slide.html',
  styleUrls: ['./reporte-slide.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReporteSlide {
  @Output() reporteSolicitado = new EventEmitter<ReporteParcialDraft>();

  @ViewChild('pageSlide', { static: true }) private pageSlide!: PoPageSlideComponent;

  quantidadeAprovada = 0;
  quantidadeRetrabalho = 0;
  quantidadeRefugo = 0;
  historico: ReadonlyArray<ReporteParcialOperacao> = [];
  salvando = false;
  validationMessage = '';

  constructor(
    private readonly changeDetector: ChangeDetectorRef,
    private readonly dialog: PoDialogService,
  ) {}

  get totalInformado(): number {
    return this.quantidadeAprovada + this.quantidadeRetrabalho + this.quantidadeRefugo;
  }

  get canSave(): boolean {
    return !this.salvando
      && [this.quantidadeAprovada, this.quantidadeRetrabalho, this.quantidadeRefugo]
        .every(quantidade => Number.isFinite(quantidade) && quantidade >= 0)
      && this.totalInformado > 0;
  }

  atualizarQuantidade(
    campo: 'quantidadeAprovada' | 'quantidadeRetrabalho' | 'quantidadeRefugo',
    valor: number | null | undefined,
  ): void {
    this[campo] = typeof valor === 'number' && Number.isFinite(valor) ? valor : 0;
    this.validationMessage = '';
  }

  abrir(reportes: ReadonlyArray<ReporteParcialOperacao>): void {
    this.historico = reportes.map(reporte => ({
      ...reporte,
      registradoEm: new Date(reporte.registradoEm),
    }));
    this.resetDraft();
    this.pageSlide.open();
    this.changeDetector.markForCheck();
  }

  salvar(): void {
    if (this.salvando) {
      return;
    }

    if (!this.canSave) {
      this.validationMessage = [this.quantidadeAprovada, this.quantidadeRetrabalho, this.quantidadeRefugo]
        .some(quantidade => !Number.isFinite(quantidade) || quantidade < 0)
        ? 'As quantidades não podem ser negativas.'
        : 'Informe ao menos uma quantidade produzida.';
      return;
    }

    this.salvando = true;
    this.validationMessage = '';
    this.reporteSolicitado.emit({
      quantidadeAprovada: this.quantidadeAprovada,
      quantidadeRetrabalho: this.quantidadeRetrabalho,
      quantidadeRefugo: this.quantidadeRefugo,
    });
  }

  confirmarReporte(reporte: ReporteParcialOperacao): void {
    this.historico = [...this.historico, {
      ...reporte,
      registradoEm: new Date(reporte.registradoEm),
    }];
    this.salvando = false;
    this.resetDraft();
    this.changeDetector.markForCheck();
  }

  informarErro(message: string): void {
    this.salvando = false;
    this.validationMessage = message;
    this.changeDetector.markForCheck();
  }

  voltar(): void {
    if (this.totalInformado <= 0) {
      this.pageSlide.close();
      return;
    }

    this.dialog.confirm({
      title: 'Descartar reporte?',
      message: 'Existem quantidades ainda não salvas. Deseja descartá-las?',
      confirm: () => {
        this.resetDraft();
        this.pageSlide.close();
      },
      literals: { cancel: 'Cancelar', confirm: 'Descartar' },
    });
  }

  formatQuantidade(quantidade: number): string {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(quantidade);
  }

  formatDataHora(data: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(data);
  }

  private resetDraft(): void {
    this.quantidadeAprovada = 0;
    this.quantidadeRetrabalho = 0;
    this.quantidadeRefugo = 0;
    this.validationMessage = '';
  }
}
