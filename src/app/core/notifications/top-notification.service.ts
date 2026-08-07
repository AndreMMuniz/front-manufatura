import { Injectable } from '@angular/core';
import {
  PoComponentInjectorService,
  PoNotification,
  PoNotificationService,
  PoToasterOrientation,
} from '@po-ui/ng-components';

@Injectable()
export class TopNotificationService extends PoNotificationService {
  constructor(poComponentInjector: PoComponentInjectorService) {
    super(poComponentInjector);
  }

  override success(notification: PoNotification | string): void {
    super.success(this.atTop(notification));
  }

  override warning(notification: PoNotification | string): void {
    super.warning(this.atTop(notification));
  }

  override error(notification: PoNotification | string): void {
    super.error(this.atTop(notification));
  }

  override information(notification: PoNotification | string): void {
    super.information(this.atTop(notification));
  }

  private atTop(notification: PoNotification | string): PoNotification {
    const options = typeof notification === 'string' ? { message: notification } : notification;

    return {
      ...options,
      orientation: PoToasterOrientation.Top,
    };
  }
}
