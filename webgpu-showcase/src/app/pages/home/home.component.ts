import { Component, OnInit, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { WebGPUService } from '../../services/webgpu.service';
import { DEMO_CATEGORIES, DemoCategory, getAllCategories, getDemosByCategory, DemoInfo } from '../../types/webgpu.types';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit {
  readonly webgpu = inject(WebGPUService);
  readonly categories = getAllCategories();

  ngOnInit(): void {
    this.webgpu.initialize();
  }

  getCategoryInfo(category: DemoCategory) {
    return DEMO_CATEGORIES[category];
  }

  getDemos(category: DemoCategory): DemoInfo[] {
    return getDemosByCategory(category);
  }
}
