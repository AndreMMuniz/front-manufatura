import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';

import { PoMenuItem, PoMenuModule, PoPageModule, PoToolbarModule } from '@po-ui/ng-components';

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet, PoToolbarModule, PoMenuModule, PoPageModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class App {
  readonly menus: Array<PoMenuItem> = [
    { label: 'Plano Controle CQ', action: () => this.router.navigate(['/quality-control']) },
  ];

  constructor(private readonly router: Router) {}
}
