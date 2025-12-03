import { Component, OnInit, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { WebGPUService } from '../../services/webgpu.service';
import { DEMOS, DEMO_CATEGORIES, DemoCategory, getAllCategories, getDemosByCategory, DemoInfo } from '../../types/webgpu.types';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="home">
      <!-- Hero Section -->
      <section class="hero">
        <div class="hero__background">
          <div class="hero__grid"></div>
          <div class="hero__glow"></div>
        </div>
        
        <div class="hero__content">
          <h1 class="hero__title">
            <span class="hero__icon">⚡</span>
            WebGPU <span class="text-gradient">Laboratory</span>
          </h1>
          <p class="hero__subtitle">
            Explore the next generation of web graphics and compute capabilities.
            <br>14 interactive demos showcasing the power of WebGPU API.
          </p>
          
          <div class="hero__status" [class.hero__status--supported]="webgpu.isSupported()" [class.hero__status--unsupported]="webgpu.isSupported() === false">
            <div class="status-indicator"></div>
            <span *ngIf="webgpu.isSupported() === null">Checking WebGPU support...</span>
            <span *ngIf="webgpu.isSupported() === true">✓ WebGPU is supported</span>
            <span *ngIf="webgpu.isSupported() === false">✗ WebGPU is not supported</span>
          </div>

          <div class="hero__gpu-info" *ngIf="webgpu.adapterInfo() as info">
            <div class="gpu-chip">
              <span class="gpu-chip__icon">🎮</span>
              <span class="gpu-chip__text">{{ info.vendor || 'GPU' }} {{ info.architecture || '' }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Demo Categories -->
      <section class="demos">
        <div class="category" *ngFor="let category of categories">
          <div class="category__header">
            <span class="category__icon">{{ getCategoryInfo(category).icon }}</span>
            <h2 class="category__title">{{ getCategoryInfo(category).label }}</h2>
            <span class="category__count">{{ getDemos(category).length }} demos</span>
          </div>
          
          <div class="category__grid">
            <a 
              *ngFor="let demo of getDemos(category)"
              class="demo-card"
              [routerLink]="demo.route"
              [attr.data-difficulty]="demo.difficulty"
            >
              <div class="demo-card__icon">{{ demo.icon }}</div>
              <div class="demo-card__content">
                <h3 class="demo-card__title">{{ demo.title }}</h3>
                <p class="demo-card__description">{{ demo.description }}</p>
              </div>
              <div class="demo-card__footer">
                <span class="demo-card__difficulty" [attr.data-level]="demo.difficulty">
                  {{ demo.difficulty }}
                </span>
                <span class="demo-card__arrow">→</span>
              </div>
            </a>
          </div>
        </div>
      </section>

      <!-- Features Section -->
      <section class="features">
        <h2 class="features__title">Why WebGPU?</h2>
        <div class="features__grid">
          <div class="feature">
            <div class="feature__icon">🚀</div>
            <h3 class="feature__title">High Performance</h3>
            <p class="feature__description">Direct GPU access with minimal overhead, enabling console-quality graphics in the browser.</p>
          </div>
          <div class="feature">
            <div class="feature__icon">🔬</div>
            <h3 class="feature__title">Compute Shaders</h3>
            <p class="feature__description">General-purpose GPU computing for simulations, ML inference, and data processing.</p>
          </div>
          <div class="feature">
            <div class="feature__icon">🎨</div>
            <h3 class="feature__title">Modern API</h3>
            <p class="feature__description">Designed after Vulkan, Metal, and D3D12 for efficient multi-threaded rendering.</p>
          </div>
          <div class="feature">
            <div class="feature__icon">🌐</div>
            <h3 class="feature__title">Cross-Platform</h3>
            <p class="feature__description">Works across Chrome, Edge, Firefox, and Safari with consistent behavior.</p>
          </div>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .home {
      min-height: 100%;
      padding-bottom: 60px;
    }

    // Hero Section
    .hero {
      position: relative;
      padding: 80px 40px;
      overflow: hidden;
      
      &__background {
        position: absolute;
        inset: 0;
        z-index: 0;
      }
      
      &__grid {
        position: absolute;
        inset: 0;
        background-image: 
          linear-gradient(rgba(0, 255, 136, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0, 255, 136, 0.03) 1px, transparent 1px);
        background-size: 50px 50px;
      }
      
      &__glow {
        position: absolute;
        top: -50%;
        left: 50%;
        transform: translateX(-50%);
        width: 800px;
        height: 800px;
        background: radial-gradient(circle, rgba(0, 255, 136, 0.1) 0%, transparent 70%);
        pointer-events: none;
      }
      
      &__content {
        position: relative;
        z-index: 1;
        max-width: 800px;
        margin: 0 auto;
        text-align: center;
      }
      
      &__icon {
        font-size: 3rem;
        display: inline-block;
        animation: float 3s ease-in-out infinite;
      }
      
      &__title {
        font-size: 3.5rem;
        font-weight: 800;
        margin-bottom: 20px;
        line-height: 1.1;
      }
      
      &__subtitle {
        font-size: 1.2rem;
        color: var(--text-secondary);
        line-height: 1.8;
        margin-bottom: 30px;
      }
      
      &__status {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 12px 24px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 30px;
        font-size: 0.9rem;
        
        .status-indicator {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--text-muted);
          animation: pulse 2s infinite;
        }
        
        &--supported {
          border-color: rgba(0, 255, 136, 0.3);
          
          .status-indicator {
            background: var(--accent-primary);
            box-shadow: 0 0 10px var(--accent-primary);
          }
        }
        
        &--unsupported {
          border-color: rgba(255, 100, 100, 0.3);
          
          .status-indicator {
            background: #ff6464;
            box-shadow: 0 0 10px #ff6464;
          }
        }
      }

      &__gpu-info {
        margin-top: 20px;
      }
    }

    .gpu-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 20px;
      font-size: 0.85rem;
      color: var(--text-secondary);

      &__icon {
        font-size: 1rem;
      }
    }

    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-10px); }
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    // Demos Section
    .demos {
      padding: 0 40px;
    }

    .category {
      margin-bottom: 50px;
      
      &__header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 24px;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--border-color);
      }
      
      &__icon {
        font-size: 1.5rem;
      }
      
      &__title {
        font-size: 1.5rem;
        font-weight: 600;
      }
      
      &__count {
        margin-left: auto;
        font-size: 0.85rem;
        color: var(--text-muted);
        padding: 4px 12px;
        background: var(--bg-tertiary);
        border-radius: 12px;
      }
      
      &__grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 20px;
      }
    }

    .demo-card {
      display: flex;
      flex-direction: column;
      padding: 24px;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      text-decoration: none;
      color: inherit;
      transition: all var(--transition-normal);
      
      &:hover {
        background: var(--bg-card-hover);
        border-color: var(--accent-primary);
        transform: translateY(-4px);
        box-shadow: var(--shadow-glow);
        
        .demo-card__arrow {
          transform: translateX(4px);
          color: var(--accent-primary);
        }
      }
      
      &__icon {
        font-size: 2.5rem;
        margin-bottom: 16px;
      }
      
      &__content {
        flex: 1;
      }
      
      &__title {
        font-size: 1.2rem;
        font-weight: 600;
        margin-bottom: 8px;
      }
      
      &__description {
        font-size: 0.9rem;
        color: var(--text-secondary);
        line-height: 1.6;
      }
      
      &__footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid var(--border-color);
      }
      
      &__difficulty {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 4px 10px;
        border-radius: 6px;
        
        &[data-level="beginner"] {
          background: rgba(0, 255, 136, 0.1);
          color: var(--accent-primary);
        }
        
        &[data-level="easy"] {
          background: rgba(0, 212, 255, 0.1);
          color: var(--accent-secondary);
        }
        
        &[data-level="medium"] {
          background: rgba(255, 170, 0, 0.1);
          color: var(--accent-warning);
        }
        
        &[data-level="advanced"] {
          background: rgba(255, 0, 170, 0.1);
          color: var(--accent-tertiary);
        }
      }
      
      &__arrow {
        font-size: 1.2rem;
        color: var(--text-muted);
        transition: all var(--transition-fast);
      }
    }

    // Features Section
    .features {
      padding: 60px 40px;
      margin-top: 40px;
      background: var(--bg-secondary);
      border-top: 1px solid var(--border-color);
      
      &__title {
        text-align: center;
        font-size: 2rem;
        margin-bottom: 40px;
      }
      
      &__grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 30px;
        max-width: 1200px;
        margin: 0 auto;
      }
    }

    .feature {
      text-align: center;
      padding: 30px;
      background: var(--bg-tertiary);
      border-radius: 16px;
      border: 1px solid var(--border-color);
      
      &__icon {
        font-size: 2.5rem;
        margin-bottom: 16px;
      }
      
      &__title {
        font-size: 1.2rem;
        margin-bottom: 12px;
      }
      
      &__description {
        font-size: 0.9rem;
        color: var(--text-secondary);
        line-height: 1.6;
      }
    }
  `]
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

