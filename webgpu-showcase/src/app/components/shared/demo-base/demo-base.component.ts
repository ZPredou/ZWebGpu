import { Component, Input, ElementRef, ViewChild, AfterViewInit, OnDestroy, inject, signal, output, NgZone, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WebGPUService } from '../../../services/webgpu.service';
import { WebGPUContext } from '../../../types/webgpu.types';

@Component({
  selector: 'app-demo-base',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './demo-base.component.html',
  styleUrl: './demo-base.component.scss'
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

  startRenderLoop(renderFn: (time: number, deltaTime: number) => void): void {
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

  stopRenderLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  setCustomStats(label: string, value: string): void {
    this.customStats.set({ label, value });
  }
}
