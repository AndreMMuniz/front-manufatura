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

export interface MotivoRefugo {
  readonly codigo: string;
  readonly descricao: string;
}

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

@Component({
  selector: 'app-refugo-slide',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoPageSlideModule],
  templateUrl: './refugo-slide.html',
  styleUrls: ['./refugo-slide.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RefugoSlide {
  @Output() refugoRegistrado = new EventEmitter<RefugoRegistrado>();
  @Output() sairSolicitado = new EventEmitter<void>();

  @ViewChild('pageSlide', { static: true }) private pageSlide!: PoPageSlideComponent;

  constructor(
    private readonly changeDetector: ChangeDetectorRef,
    private readonly dialog: PoDialogService,
  ) {}

  readonly motivos: ReadonlyArray<MotivoRefugo> = [
    { codigo: '05', descricao: 'Borra' },
    { codigo: '32', descricao: 'Varredura' },
    { codigo: '35', descricao: 'Setup' },
  ];

  readonly motivoOptions = this.motivos.map(motivo => ({
    label: `${motivo.codigo} - ${motivo.descricao}`,
    value: motivo.codigo,
  }));

  quantidade = 0;
  motivoCodigo = '';
  itens: ReadonlyArray<RefugoRegistradoItem> = [];
  private itensOriginaisKey = '';

  get canAdicionar(): boolean {
    return Boolean(this.motivoDescricao) && this.quantidade > 0;
  }

  get canSalvar(): boolean {
    return this.itens.length > 0;
  }

  get totalRefugo(): number {
    return this.itens.reduce((total, item) => total + item.quantidade, 0);
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
    this.itensOriginaisKey = this.itemsKey(this.itens);
    this.pageSlide.open();
    this.changeDetector.markForCheck();
  }

  adicionarRefugo(): void {
    if (!this.canAdicionar || !this.motivoSelecionado) {
      return;
    }

    this.itens = this.itens.some(item => item.codigo === this.motivoSelecionado?.codigo)
      ? this.itens.map(item =>
          item.codigo === this.motivoSelecionado?.codigo
            ? { ...item, quantidade: item.quantidade + this.quantidade }
            : item,
        )
      : [
          ...this.itens,
          {
            codigo: this.motivoSelecionado.codigo,
            descricao: this.motivoSelecionado.descricao,
            quantidade: this.quantidade,
          },
        ];
    this.quantidade = 0;
    this.motivoCodigo = '';
  }

  removerRefugo(index: number): void {
    this.itens = this.itens.filter((_item, itemIndex) => itemIndex !== index);
  }

  salvar(): void {
    if (!this.canSalvar) {
      return;
    }

    this.refugoRegistrado.emit({
      quantidade: this.totalRefugo,
      motivo: this.itens.map(item => `${item.codigo} - ${item.descricao}`).join(', '),
      itens: this.itens.map(item => ({ ...item })),
    });
    this.fechar();
  }

  voltar(): void {
    if (!this.hasUnsavedChanges()) {
      this.fechar();
      return;
    }

    this.confirmDiscard(() => this.fechar());
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
  }

  private get motivoSelecionado(): MotivoRefugo | undefined {
    return this.motivos.find(motivo => motivo.codigo === this.motivoCodigo);
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
}
