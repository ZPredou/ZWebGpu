import { Component, Input, ElementRef, ViewChild, AfterViewInit, OnDestroy, inject, signal, output, NgZone, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WebGPUService } from '../../../services/webgpu.service';
import { WebGPUContext } from '../../../types/webgpu.types';

@Component({
  selector: 'app-demo-base',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="demo-base">
      <!-- Loading State -->
      <div class="webgpu-loading" *ngIf="loading()">
        <div class="webgpu-loading__spinner"></div>
        <div class="webgpu-loading__text">Initializing WebGPU...</div>
      </div>

      <!-- Error State -->
      <div class="webgpu-error" *ngIf="error()">
        <div class="webgpu-error__icon">⚠️</div>
        <h3 class="webgpu-error__title">WebGPU Error</h3>
        <p class="webgpu-error__message">{{ error() }}</p>
      </div>

      <!-- Canvas -->
      <div class="webgpu-canvas-container" [class.hidden]="loading() || error()">
        <canvas #canvas></canvas>
      </div>

      <!-- Stats Overlay -->
      <div class="stats-overlay" *ngIf="showStats && !loading() && !error()">
        <div class="stats-overlay__item">
          <span class="label">FPS</span>
          <span class="value">{{ fps() }}</span>
        </div>
        <div class="stats-overlay__item" *ngIf="customStats()">
          <span class="label">{{ customStats()!.label }}</span>
          <span class="value">{{ customStats()!.value }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .demo-base {
      position: relative;
      width: 100%;
      height: 100%;
    }

    .hidden {
      visibility: hidden;
    }

    .stats-overlay {
      position: absolute;
      top: 12px;
      left: 12px;
      display: flex;
      gap: 12px;
      z-index: 10;

      &__item {
        display: flex;
        flex-direction: column;
        padding: 8px 12px;
        background: rgba(10, 10, 15, 0.85);
        backdrop-filter: blur(8px);
        border: 1px solid var(--border-color);
        border-radius: 8px;

        .label {
          font-size: 0.65rem;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--text-muted);
        }

        .value {
          font-family: 'JetBrains Mono', monospace;
          font-size: 1rem;
          color: var(--accent-primary);
        }
      }
    }
  `]
})
export class DemoBaseComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  @Input() showStats = true;

  readonly contextReady = output<WebGPUContext>();

  protected readonly webgpu = inject(WebGPUService);
  private readonly ngZone = inject(NgZone);
  
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly fps = signal(0);
  readonly customStats = signal<{ label: string; value: string } | null>(null);

  private animationFrameId: number | null = null;
  private lastTime = 0;
  private frameCount = 0;
  private fpsUpdateTime = 0;
  private resizeObserver: ResizeObserver | null = null;

  protected context: WebGPUContext | null = null;

  async ngAfterViewInit(): Promise<void> {
    await this.initializeWebGPU();
  }

  ngOnDestroy(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }

  private async initializeWebGPU(): Promise<void> {
    const canvas = this.canvasRef.nativeElement;
    
    // Set up resize observer
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(canvas.parentElement!);
    
    // Initial size
    this.handleResize();

    const ctx = await this.webgpu.createContext(canvas);
    
    if (!ctx) {
      this.error.set(this.webgpu.error() || 'Failed to initialize WebGPU');
      this.loading.set(false);
      return;
    }

    this.context = ctx;
    this.loading.set(false);
    this.contextReady.emit(ctx);
  }

  private handleResize(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = parent.getBoundingClientRect();
    
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  }

  protected startRenderLoop(renderFn: (time: number, deltaTime: number) => void): void {
    // Run the render loop outside Angular's zone to prevent unnecessary change detection
    this.ngZone.runOutsideAngular(() => {
      const loop = (time: number) => {
        const deltaTime = time - this.lastTime;
        this.lastTime = time;

        // Update FPS counter
        this.frameCount++;
        if (time - this.fpsUpdateTime >= 1000) {
          this.fps.set(this.frameCount);
          this.frameCount = 0;
          this.fpsUpdateTime = time;
        }

        renderFn(time, deltaTime);
        this.animationFrameId = requestAnimationFrame(loop);
      };

      this.animationFrameId = requestAnimationFrame(loop);
    });
  }

  protected stopRenderLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  setCustomStats(label: string, value: string): void {
    this.customStats.set({ label, value });
  }
}

