import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, RouterOutlet } from '@angular/router';
import { DEMO_CATEGORIES, DemoCategory, getAllCategories, getDemosByCategory } from '../../types/webgpu.types';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, RouterOutlet],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.scss'
})
export class LayoutComponent {
  readonly sidebarCollapsed = signal(false);
  readonly categories = getAllCategories();

  toggleSidebar(): void {
    this.sidebarCollapsed.update(v => !v);
  }

  getCategoryInfo(category: DemoCategory) {
    return DEMO_CATEGORIES[category];
  }

  getDemos(category: DemoCategory) {
    return getDemosByCategory(category);
  }

  getDifficultyLabel(difficulty: string): string {
    const labels: Record<string, string> = {
      beginner: '★',
      easy: '★★',
      medium: '★★★',
      advanced: '★★★★'
    };
    return labels[difficulty] || '';
  }
}
