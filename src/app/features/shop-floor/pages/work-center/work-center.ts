import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { PoButtonModule, PoFieldModule, PoPageModule, PoWidgetModule } from '@po-ui/ng-components';

import { WorkCenter } from '../../models/work-center';
import { WorkCenterService } from '../../services/work-center';

@Component({
  selector: 'app-work-center',
  imports: [CommonModule, FormsModule, PoButtonModule, PoFieldModule, PoPageModule, PoWidgetModule],
  templateUrl: './work-center.html',
  styleUrls: ['./work-center.css'],
})
export class WorkCenterPage implements OnInit {
  private readonly router = inject(Router);
  private readonly workCenterService = inject(WorkCenterService);

  searchTerm = '';
  workCenters: ReadonlyArray<WorkCenter> = [];
  selectedWorkCenter: WorkCenter | null = null;

  ngOnInit(): void {
    this.selectedWorkCenter = this.workCenterService.selectedWorkCenter;
    this.loadWorkCenters();
  }

  search(): void {
    this.workCenterService.searchWorkCenters(this.searchTerm).subscribe(centers => {
      this.workCenters = centers;
    });
  }

  selectWorkCenter(workCenter: WorkCenter): void {
    this.workCenterService.selectWorkCenter(workCenter.code).subscribe(selected => {
      this.selectedWorkCenter = selected;
    });
  }

  clearSelection(): void {
    this.workCenterService.clearSelection();
    this.selectedWorkCenter = null;
  }

  backToMenu(): void {
    void this.router.navigate(['/menu']);
  }

  statusLabel(workCenter: WorkCenter): string {
    return workCenter.active ? 'Ativo' : 'Inativo';
  }

  private loadWorkCenters(): void {
    this.workCenterService.listWorkCenters().subscribe(centers => {
      this.workCenters = centers;
    });
  }
}
