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
  PoComboComponent,
  PoDialogService,
  PoFieldModule,
  PoPageSlideComponent,
  PoPageSlideModule,
} from '@po-ui/ng-components';

import { MotivoRefugo, MotivoRefugoService } from '../../services/motivo-refugo.service';
import { RefugoService } from '../../services/refugo.service';

export interface RefugoRegistradoItem {
  readonly codigo: string;
  readonly descricao: string;
  readonly quantidade: number;
}

export interface RefugoRegistrado {
  readonly quantidade: number;
  readonly motivo: string;
  readonly itens: ReadonlyArray<RefugoRegistradoItem>;
}

export type RefugoSlideState =
  | 'inicial'
  | 'pesquisando'
  | 'motivo-selecionado'
  | 'item-adicionado'
  | 'salvando'
  | 'finalizado'
  | 'erro';

@Component({
  selector: 'app-refugo-slide',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoPageSlideModule],
  templateUrl: './refugo-slide.html',
  styleUrls: ['./refugo-slide.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RefugoSlide {
  @Output() refugoRegistrado = new EventEmitter<RefugoRegistrado>();
  @Output() refugoCancelado = new EventEmitter<void>();
  @Output() sairSolicitado = new EventEmitter<void>();

  @ViewChild('pageSlide', { static: true }) private pageSlide!: PoPageSlideComponent;
  @ViewChild('motivoCombo') private motivoCombo?: PoComboComponent;

  constructor(
    private readonly changeDetector: ChangeDetectorRef,
    private readonly dialog: PoDialogService,
    private readonly motivoRefugoService: MotivoRefugoService,
    private readonly refugoService: RefugoService,
  ) {}

  motivos: ReadonlyArray<MotivoRefugo> = [];
  motivoOptions: ReadonlyArray<{ label: string; value: string }> = [];
  estado: RefugoSlideState = 'inicial';
  validationMessage = '';
  motivoErrorMessage = '';
  adicionarFeedback = '';
  quantidade = 0;
  motivoCodigo = '';
  itens: ReadonlyArray<RefugoRegistradoItem> = [];
  private itensOriginaisKey = '';

  get canAdicionar(): boolean {
    return this.estado !== 'pesquisando' && Boolean(this.motivoDescricao) && this.quantidade > 0;
  }

  get canSalvar(): boolean {
    return !this.hasPartialInput() && (this.itens.length > 0 || this.totalRefugo === 0);
  }

  get totalRefugo(): number {
    return this.refugoService.calcularTotal(this.itens);
  }

  get motivoDescricao(): string {
    return this.motivoSelecionado?.descricao ?? '';
  }

  abrir(quantidadeAtual: number, itensAtuais: ReadonlyArray<RefugoRegistradoItem> = []): void {
    this.itens =
      itensAtuais.length > 0
        ? itensAtuais.map(item => ({ ...item }))
        : this.legacyItemFromQuantity(quantidadeAtual);
    this.quantidade = 0;
    this.motivoCodigo = '';
    this.validationMessage = '';
    this.adicionarFeedback = '';
    this.estado = 'inicial';
    this.itensOriginaisKey = this.itemsKey(this.itens);
    this.pageSlide.open();
    this.buscarMotivos('');
    setTimeout(() => this.motivoCombo?.focus());
    this.changeDetector.markForCheck();
  }

  buscarMotivos(termo: string): void {
    this.estado = 'pesquisando';
    this.motivoErrorMessage = '';
    this.motivoRefugoService.buscarMotivos(termo).subscribe({
      next: motivos => {
        this.motivos = motivos;
        this.motivoOptions = this.toMotivoOptions(motivos);
        this.estado = this.motivoCodigo ? 'motivo-selecionado' : 'inicial';
        this.changeDetector.markForCheck();
      },
      error: () => {
        this.estado = 'erro';
        this.motivoErrorMessage = 'Não foi possível carregar os motivos de refugo. Tente novamente.';
        this.changeDetector.markForCheck();
      },
    });
  }

  atualizarMotivo(codigo: string): void {
    this.motivoCodigo = codigo ?? '';
    this.validationMessage = '';
    this.estado = this.motivoCodigo ? 'motivo-selecionado' : 'inicial';
  }

  atualizarQuantidade(quantidade: number): void {
    this.quantidade = quantidade ?? 0;
    this.validationMessage = '';
  }

  adicionarRefugo(): void {
    if (!this.canAdicionar || !this.motivoSelecionado) {
      this.validationMessage = this.getValidationMessage();
      return;
    }

    this.itens = this.refugoService.consolidarItens([
      ...this.itens,
      {
        codigo: this.motivoSelecionado.codigo,
        descricao: this.motivoSelecionado.descricao,
        quantidade: this.quantidade,
      },
    ]);
    this.quantidade = 0;
    this.motivoCodigo = '';
    this.validationMessage = '';
    this.adicionarFeedback = 'Refugo adicionado.';
    this.estado = 'item-adicionado';
  }

  removerRefugo(index: number): void {
    this.itens = this.itens.filter((_item, itemIndex) => itemIndex !== index);
  }

  salvar(): void {
    if (!this.canSalvar) {
      this.validationMessage = this.getValidationMessage();
      return;
    }

    this.estado = 'salvando';
    this.refugoRegistrado.emit({
      quantidade: this.totalRefugo,
      motivo: this.itens.map(item => `${item.codigo} - ${item.descricao}`).join(', '),
      itens: this.itens.map(item => ({ ...item })),
    });
    this.fechar();
  }

  voltar(): void {
    const closeAsCancelled = () => {
      this.refugoCancelado.emit();
      this.fechar();
    };

    if (!this.hasUnsavedChanges()) {
      closeAsCancelled();
      return;
    }

    this.confirmDiscard(closeAsCancelled);
  }

  sair(): void {
    const closeAndExit = () => {
      this.fechar();
      this.sairSolicitado.emit();
    };

    if (!this.hasUnsavedChanges()) {
      closeAndExit();
      return;
    }

    this.confirmDiscard(closeAndExit);
  }

  formatQuantidade(quantidade: number): string {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(quantidade);
  }

  private fechar(): void {
    this.pageSlide.close();
    this.estado = 'finalizado';
  }

  private get motivoSelecionado(): MotivoRefugo | undefined {
    return this.motivos.find(motivo => motivo.codigo === this.motivoCodigo);
  }

  private getValidationMessage(): string {
    if (this.motivoCodigo && this.quantidade <= 0) {
      return 'Informe uma quantidade maior que zero.';
    }

    if (!this.motivoCodigo && this.quantidade > 0) {
      return 'Selecione um motivo de refugo.';
    }

    if (!this.motivoDescricao) {
      return 'Selecione um motivo de refugo.';
    }

    return '';
  }

  private hasPartialInput(): boolean {
    const hasMotivo = Boolean(this.motivoCodigo);
    const hasQuantidade = this.quantidade > 0;

    return hasMotivo !== hasQuantidade;
  }

  private hasUnsavedChanges(): boolean {
    return this.itemsKey(this.itens) !== this.itensOriginaisKey || this.quantidade > 0 || Boolean(this.motivoCodigo);
  }

  private confirmDiscard(confirm: () => void): void {
    this.dialog.confirm({
      title: 'Descartar alterações?',
      message: 'Existem alterações de refugo não salvas. Deseja descartá-las?',
      confirm,
      literals: { cancel: 'Cancelar', confirm: 'Descartar' },
    });
  }

  private legacyItemFromQuantity(quantidadeAtual: number): ReadonlyArray<RefugoRegistradoItem> {
    if (quantidadeAtual <= 0) {
      return [];
    }

    return [{ codigo: '00', descricao: 'Refugo informado anteriormente', quantidade: quantidadeAtual }];
  }

  private itemsKey(items: ReadonlyArray<RefugoRegistradoItem>): string {
    return JSON.stringify(items);
  }

  private toMotivoOptions(motivos: ReadonlyArray<MotivoRefugo>): ReadonlyArray<{ label: string; value: string }> {
    return motivos.map(motivo => ({
      label: `${motivo.codigo} - ${motivo.descricao}`,
      value: motivo.codigo,
    }));
  }
}
