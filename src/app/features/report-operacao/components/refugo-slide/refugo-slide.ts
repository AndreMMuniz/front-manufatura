import { ChangeDetectionStrategy, Component, EventEmitter, Output, ViewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { PoButtonModule, PoFieldModule, PoPageSlideComponent, PoPageSlideModule } from '@po-ui/ng-components';

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
  imports: [DecimalPipe, FormsModule, PoButtonModule, PoFieldModule, PoPageSlideModule],
  templateUrl: './refugo-slide.html',
  styleUrls: ['./refugo-slide.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RefugoSlide {
  @Output() refugoRegistrado = new EventEmitter<RefugoRegistrado>();

  @ViewChild('pageSlide', { static: true }) private pageSlide!: PoPageSlideComponent;

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

  abrir(_quantidadeAtual: number, itensAtuais: ReadonlyArray<RefugoRegistradoItem> = []): void {
    this.itens = itensAtuais.map(item => ({ ...item }));
    this.quantidade = 0;
    this.motivoCodigo = '';
    this.pageSlide.open();
  }

  adicionarRefugo(): void {
    if (!this.canAdicionar || !this.motivoSelecionado) {
      return;
    }

    this.itens = [
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

  fechar(): void {
    this.pageSlide.close();
  }

  private get motivoSelecionado(): MotivoRefugo | undefined {
    return this.motivos.find(motivo => motivo.codigo === this.motivoCodigo);
  }
}
