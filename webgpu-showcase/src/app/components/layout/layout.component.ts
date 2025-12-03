import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, RouterOutlet } from '@angular/router';
import { DEMOS, DEMO_CATEGORIES, DemoCategory, getAllCategories, getDemosByCategory } from '../../types/webgpu.types';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, RouterOutlet],
  template: `
    <div class="layout">
      <!-- Sidebar -->
      <aside class="sidebar" [class.sidebar--collapsed]="sidebarCollapsed()">
        <div class="sidebar__header">
          <div class="logo">
            <span class="logo__icon">⚡</span>
            <span class="logo__text" *ngIf="!sidebarCollapsed()">WebGPU Lab</span>
          </div>
          <button class="sidebar__toggle" (click)="toggleSidebar()">
            {{ sidebarCollapsed() ? '→' : '←' }}
          </button>
        </div>

        <nav class="sidebar__nav">
          <a class="nav-item nav-item--home" routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{exact: true}">
            <span class="nav-item__icon">🏠</span>
            <span class="nav-item__text" *ngIf="!sidebarCollapsed()">Home</span>
          </a>

          <div class="nav-category" *ngFor="let category of categories">
            <div class="nav-category__header" *ngIf="!sidebarCollapsed()">
              <span class="nav-category__icon">{{ getCategoryInfo(category).icon }}</span>
              <span class="nav-category__label">{{ getCategoryInfo(category).label }}</span>
            </div>
            
            <a 
              *ngFor="let demo of getDemos(category)"
              class="nav-item"
              [routerLink]="demo.route"
              routerLinkActive="active"
              [title]="demo.title"
            >
              <span class="nav-item__icon">{{ demo.icon }}</span>
              <span class="nav-item__text" *ngIf="!sidebarCollapsed()">{{ demo.title }}</span>
              <span class="nav-item__badge" *ngIf="!sidebarCollapsed()" [attr.data-difficulty]="demo.difficulty">
                {{ getDifficultyLabel(demo.difficulty) }}
              </span>
            </a>
          </div>
        </nav>

        <div class="sidebar__footer" *ngIf="!sidebarCollapsed()">
          <div class="gpu-info">
            <span class="gpu-info__label">Powered by</span>
            <span class="gpu-info__value">WebGPU API</span>
          </div>
        </div>
      </aside>

      <!-- Main content -->
      <main class="main">
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
  styles: [`
    .layout {
      display: flex;
      height: 100vh;
      overflow: hidden;
    }

    .sidebar {
      width: var(--sidebar-width);
      background: var(--bg-secondary);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      transition: width var(--transition-normal);
      overflow: hidden;

      &--collapsed {
        width: 70px;
      }
    }

    .sidebar__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px;
      border-bottom: 1px solid var(--border-color);
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 12px;

      &__icon {
        font-size: 1.5rem;
        animation: pulse-glow 2s ease-in-out infinite;
      }

      &__text {
        font-family: 'Syne', sans-serif;
        font-size: 1.25rem;
        font-weight: 700;
        background: var(--gradient-primary);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        white-space: nowrap;
      }
    }

    .sidebar__toggle {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all var(--transition-fast);

      &:hover {
        background: var(--bg-card-hover);
        color: var(--accent-primary);
        border-color: var(--accent-primary);
      }
    }

    .sidebar__nav {
      flex: 1;
      overflow-y: auto;
      padding: 16px 12px;
    }

    .nav-category {
      margin-bottom: 8px;

      &__header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 8px 8px;
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--text-muted);
      }

      &__icon {
        font-size: 0.8rem;
      }
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 8px;
      text-decoration: none;
      color: var(--text-secondary);
      transition: all var(--transition-fast);
      margin-bottom: 4px;

      &:hover {
        background: var(--bg-tertiary);
        color: var(--text-primary);
      }

      &.active {
        background: linear-gradient(135deg, rgba(0, 255, 136, 0.1) 0%, rgba(0, 212, 255, 0.1) 100%);
        color: var(--accent-primary);
        border: 1px solid rgba(0, 255, 136, 0.2);
      }

      &--home {
        margin-bottom: 16px;
        padding: 12px;
        background: var(--bg-tertiary);
      }

      &__icon {
        font-size: 1.1rem;
        flex-shrink: 0;
      }

      &__text {
        flex: 1;
        font-size: 0.9rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      &__badge {
        font-size: 0.65rem;
        padding: 2px 6px;
        border-radius: 4px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        flex-shrink: 0;

        &[data-difficulty="beginner"] {
          background: rgba(0, 255, 136, 0.15);
          color: var(--accent-primary);
        }

        &[data-difficulty="easy"] {
          background: rgba(0, 212, 255, 0.15);
          color: var(--accent-secondary);
        }

        &[data-difficulty="medium"] {
          background: rgba(255, 170, 0, 0.15);
          color: var(--accent-warning);
        }

        &[data-difficulty="advanced"] {
          background: rgba(255, 0, 170, 0.15);
          color: var(--accent-tertiary);
        }
      }
    }

    .sidebar__footer {
      padding: 16px 20px;
      border-top: 1px solid var(--border-color);
    }

    .gpu-info {
      display: flex;
      flex-direction: column;
      gap: 4px;

      &__label {
        font-size: 0.7rem;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }

      &__value {
        font-size: 0.85rem;
        color: var(--accent-secondary);
        font-weight: 500;
      }
    }

    .main {
      flex: 1;
      overflow: auto;
      background: var(--bg-primary);
    }

    @keyframes pulse-glow {
      0%, 100% {
        text-shadow: 0 0 10px rgba(0, 255, 136, 0.5);
      }
      50% {
        text-shadow: 0 0 20px rgba(0, 255, 136, 0.8), 0 0 30px rgba(0, 212, 255, 0.5);
      }
    }
  `]
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

