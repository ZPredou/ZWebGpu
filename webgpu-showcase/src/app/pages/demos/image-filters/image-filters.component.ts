import { Component, ViewChild, AfterViewInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DemoBaseComponent } from '../../../components/shared/demo-base/demo-base.component';
import { WebGPUContext } from '../../../types/webgpu.types';

@Component({
  selector: 'app-image-filters',
  standalone: true,
  imports: [CommonModule, FormsModule, DemoBaseComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="demo-page">
      <div class="demo-page__header">
        <h1><span class="icon">🖼️</span> Image Filters</h1>
      </div>
      
      <div class="demo-page__content">
        <div class="demo-page__canvas-area">
          <app-demo-base 
            #demoBase
            (contextReady)="onContextReady($event)"
          ></app-demo-base>
        </div>
        
        <div class="demo-page__controls">
          <p class="demo-page__description">
            Real-time GPU-accelerated image processing. Apply various filter effects 
            to a procedurally generated test image.
          </p>
          
          <h3>Filter Type</h3>
          
          <div class="control-group">
            <select [(ngModel)]="selectedFilter" (change)="onFilterChange()">
              <option *ngFor="let filter of filters" [value]="filter.id">
                {{ filter.name }}
              </option>
            </select>
          </div>

          <h3>Parameters</h3>
          
          <div class="control-group">
            <label>Intensity: {{ intensity.toFixed(2) }}</label>
            <input 
              type="range" 
              min="0" 
              max="2" 
              step="0.05" 
              [(ngModel)]="intensity"
            >
          </div>

          <div class="control-group">
            <label>Radius: {{ radius }}</label>
            <input 
              type="range" 
              min="1" 
              max="10" 
              step="1" 
              [(ngModel)]="radius"
            >
          </div>

          <div class="filter-info">
            <h4>{{ getCurrentFilter()?.name }}</h4>
            <p>{{ getCurrentFilter()?.description }}</p>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .filter-info {
      margin-top: 24px;
      padding: 16px;
      background: var(--bg-tertiary);
      border-radius: 8px;
      border-left: 3px solid var(--accent-secondary);

      h4 {
        font-size: 0.9rem;
        margin-bottom: 8px;
        color: var(--accent-secondary);
      }

      p {
        font-size: 0.85rem;
        color: var(--text-secondary);
        line-height: 1.5;
      }
    }
  `]
})
export class ImageFiltersComponent implements AfterViewInit {
  @ViewChild('demoBase') demoBase!: DemoBaseComponent;

  filters = [
    { id: 'none', name: 'Original', description: 'No filter applied - shows the original image.' },
    { id: 'grayscale', name: 'Grayscale', description: 'Converts the image to grayscale using luminance.' },
    { id: 'invert', name: 'Invert', description: 'Inverts all colors in the image.' },
    { id: 'blur', name: 'Box Blur', description: 'Applies a simple box blur filter.' },
    { id: 'sharpen', name: 'Sharpen', description: 'Enhances edges and details in the image.' },
    { id: 'edge', name: 'Edge Detection', description: 'Sobel edge detection algorithm.' },
    { id: 'emboss', name: 'Emboss', description: 'Creates an embossed 3D effect.' },
    { id: 'vignette', name: 'Vignette', description: 'Darkens the corners of the image.' },
    { id: 'sepia', name: 'Sepia', description: 'Applies a warm, vintage sepia tone.' },
    { id: 'pixelate', name: 'Pixelate', description: 'Creates a pixelated mosaic effect.' },
  ];

  selectedFilter = 'none';
  intensity = 1;
  radius = 3;

  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private context: WebGPUContext | null = null;

  ngAfterViewInit(): void {}

  getCurrentFilter() {
    return this.filters.find(f => f.id === this.selectedFilter);
  }

  async onContextReady(ctx: WebGPUContext): Promise<void> {
    this.context = ctx;
    await this.initializePipeline();
    this.startRendering();
  }

  onFilterChange(): void {
    if (this.context) {
      this.initializePipeline();
    }
  }

  private getFilterCode(): string {
    const filters: Record<string, string> = {
      none: `
        fn applyFilter(uv: vec2f, time: f32) -> vec3f {
          return getImage(uv, time);
        }
      `,
      grayscale: `
        fn applyFilter(uv: vec2f, time: f32) -> vec3f {
          let color = getImage(uv, time);
          let gray = dot(color, vec3f(0.299, 0.587, 0.114));
          return mix(color, vec3f(gray), uniforms.intensity);
        }
      `,
      invert: `
        fn applyFilter(uv: vec2f, time: f32) -> vec3f {
          let color = getImage(uv, time);
          return mix(color, 1.0 - color, uniforms.intensity);
        }
      `,
      blur: `
        fn applyFilter(uv: vec2f, time: f32) -> vec3f {
          var color = vec3f(0.0);
          let r = i32(uniforms.radius);
          var count = 0.0;
          for (var x = -r; x <= r; x++) {
            for (var y = -r; y <= r; y++) {
              let offset = vec2f(f32(x), f32(y)) * 0.002;
              color += getImage(uv + offset, time);
              count += 1.0;
            }
          }
          let blurred = color / count;
          return mix(getImage(uv, time), blurred, uniforms.intensity);
        }
      `,
      sharpen: `
        fn applyFilter(uv: vec2f, time: f32) -> vec3f {
          let offset = 0.002;
          let center = getImage(uv, time) * 5.0;
          let neighbors = 
            getImage(uv + vec2f(-offset, 0.0), time) +
            getImage(uv + vec2f(offset, 0.0), time) +
            getImage(uv + vec2f(0.0, -offset), time) +
            getImage(uv + vec2f(0.0, offset), time);
          let sharpened = center - neighbors;
          return mix(getImage(uv, time), sharpened, uniforms.intensity * 0.5);
        }
      `,
      edge: `
        fn applyFilter(uv: vec2f, time: f32) -> vec3f {
          let offset = 0.003;
          let tl = dot(getImage(uv + vec2f(-offset, offset), time), vec3f(0.33));
          let t  = dot(getImage(uv + vec2f(0.0, offset), time), vec3f(0.33));
          let tr = dot(getImage(uv + vec2f(offset, offset), time), vec3f(0.33));
          let l  = dot(getImage(uv + vec2f(-offset, 0.0), time), vec3f(0.33));
          let r  = dot(getImage(uv + vec2f(offset, 0.0), time), vec3f(0.33));
          let bl = dot(getImage(uv + vec2f(-offset, -offset), time), vec3f(0.33));
          let b  = dot(getImage(uv + vec2f(0.0, -offset), time), vec3f(0.33));
          let br = dot(getImage(uv + vec2f(offset, -offset), time), vec3f(0.33));
          let gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
          let gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
          let edge = sqrt(gx*gx + gy*gy) * uniforms.intensity;
          return vec3f(edge);
        }
      `,
      emboss: `
        fn applyFilter(uv: vec2f, time: f32) -> vec3f {
          let offset = 0.003;
          let tl = getImage(uv + vec2f(-offset, offset), time);
          let br = getImage(uv + vec2f(offset, -offset), time);
          let embossed = (br - tl) * uniforms.intensity + 0.5;
          return embossed;
        }
      `,
      vignette: `
        fn applyFilter(uv: vec2f, time: f32) -> vec3f {
          let color = getImage(uv, time);
          let dist = distance(uv, vec2f(0.5));
          let vignette = 1.0 - smoothstep(0.2, 0.8, dist * uniforms.intensity);
          return color * vignette;
        }
      `,
      sepia: `
        fn applyFilter(uv: vec2f, time: f32) -> vec3f {
          let color = getImage(uv, time);
          let sepia = vec3f(
            dot(color, vec3f(0.393, 0.769, 0.189)),
            dot(color, vec3f(0.349, 0.686, 0.168)),
            dot(color, vec3f(0.272, 0.534, 0.131))
          );
          return mix(color, sepia, uniforms.intensity);
        }
      `,
      pixelate: `
        fn applyFilter(uv: vec2f, time: f32) -> vec3f {
          let pixels = 10.0 + (1.0 - uniforms.intensity) * 200.0;
          let pixelUV = floor(uv * pixels) / pixels;
          return getImage(pixelUV, time);
        }
      `,
    };
    return filters[this.selectedFilter] || filters['none'];
  }

  private async initializePipeline(): Promise<void> {
    if (!this.context) return;

    const { device, format } = this.context;

    this.uniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shaderModule = device.createShaderModule({
      label: 'Image Filter',
      code: `
        struct Uniforms {
          time: f32,
          intensity: f32,
          radius: f32,
          aspectRatio: f32,
        }

        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) uv: vec2f,
        }

        @vertex
        fn vertexMain(@builtin(vertex_index) idx: u32) -> VertexOutput {
          var pos = array<vec2f, 6>(
            vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
            vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0),
          );
          var output: VertexOutput;
          output.position = vec4f(pos[idx], 0.0, 1.0);
          output.uv = pos[idx] * 0.5 + 0.5;
          return output;
        }

        // Procedural test image
        fn getImage(uv: vec2f, time: f32) -> vec3f {
          // Create a colorful test pattern
          var color = vec3f(0.0);
          
          // Gradient background
          color = mix(
            vec3f(0.1, 0.2, 0.4),
            vec3f(0.4, 0.2, 0.3),
            uv.y
          );
          
          // Add some circles
          for (var i = 0; i < 5; i++) {
            let fi = f32(i);
            let center = vec2f(
              0.2 + fi * 0.15 + sin(time + fi) * 0.05,
              0.3 + cos(time * 0.7 + fi * 1.5) * 0.2
            );
            let dist = distance(uv, center);
            let radius = 0.08 + sin(time + fi * 2.0) * 0.02;
            if (dist < radius) {
              let hue = fi * 0.2 + time * 0.1;
              color = vec3f(
                sin(hue) * 0.5 + 0.5,
                sin(hue + 2.094) * 0.5 + 0.5,
                sin(hue + 4.188) * 0.5 + 0.5
              );
            }
          }
          
          // Add grid lines
          let gridX = fract(uv.x * 10.0);
          let gridY = fract(uv.y * 10.0);
          if (gridX < 0.05 || gridY < 0.05) {
            color = mix(color, vec3f(1.0), 0.1);
          }
          
          return color;
        }

        ${this.getFilterCode()}

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
          let color = applyFilter(input.uv, uniforms.time);
          return vec4f(color, 1.0);
        }
      `
    });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' }
      }]
    });

    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: { module: shaderModule, entryPoint: 'vertexMain' },
      fragment: { module: shaderModule, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' }
    });

    this.bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }]
    });
  }

  private startRendering(): void {
    const render = (time: number) => {
      if (!this.context || !this.pipeline) return;

      const { device, context, canvas } = this.context;
      const aspect = canvas.width / canvas.height;

      const uniforms = new Float32Array([
        time * 0.001,
        this.intensity,
        this.radius,
        aspect
      ]);
      device.queue.writeBuffer(this.uniformBuffer!, 0, uniforms);

      const commandEncoder = device.createCommandEncoder();
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }]
      });

      renderPass.setPipeline(this.pipeline);
      renderPass.setBindGroup(0, this.bindGroup!);
      renderPass.draw(6);
      renderPass.end();

      device.queue.submit([commandEncoder.finish()]);
    };

    (this.demoBase as any).startRenderLoop(render);
  }
}

