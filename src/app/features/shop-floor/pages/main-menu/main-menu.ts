import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { PoButtonModule, PoPageModule, PoWidgetModule } from '@po-ui/ng-components';

import { MenuGroup, MenuOption, SFC_MENU } from '../../../../core/navigation/app-menu';

@Component({
  selector: 'app-main-menu',
  imports: [PoButtonModule, PoPageModule, PoWidgetModule],
  templateUrl: './main-menu.html',
  styleUrls: ['./main-menu.css'],
})
export class MainMenuPage {
  private readonly router = inject(Router);

  get groups(): ReadonlyArray<MenuGroup> {
    return SFC_MENU;
  }

  selectOption(option: MenuOption): void {
    if (!option.implemented || !option.target) {
      return;
    }
    void this.router.navigate([option.target]).catch(() => {
      // Navigation may be cancelled by a concurrent navigation; the menu
      // remains usable for the next click.
    });
  }
}
