import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'app-loading',
  templateUrl: './loading-indicator.html',
  styleUrl: './loading-indicator.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadingIndicator {
  @Input({ required: true }) text = '';
}
