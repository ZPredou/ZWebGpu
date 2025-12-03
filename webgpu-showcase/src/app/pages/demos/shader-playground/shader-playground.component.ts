import { Component, ViewChild, AfterViewInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DemoBaseComponent } from '../../../components/shared/demo-base/demo-base.component';
import { WebGPUContext } from '../../../types/webgpu.types';

@Component({
  selector: 'app-shader-playground',
  standalone: true,
  imports: [CommonModule, FormsModule, DemoBaseComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="demo-page">
      <div class="demo-page__header">
        <h1><span class="icon">✨</span> Shader Playground</h1>
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
            Interactive fragment shader playground. Select from preset effects or 
            modify parameters in real-time.
          </p>
          
          <h3>Shader Preset</h3>
          
          <div class="control-group">
            <select [(ngModel)]="selectedPreset" (change)="onPresetChange()">
              <option *ngFor="let preset of presets" [value]="preset.id">
                {{ preset.name }}
              </option>
            </select>
          </div>

          <h3>Parameters</h3>
          
          <div class="control-group">
            <label>Speed</label>
            <input 
              type="range" 
              min="0" 
              max="5" 
              step="0.1" 
              [(ngModel)]="speed"
            >
          </div>
          
          <div class="control-group">
            <label>Intensity</label>
            <input 
              type="range" 
              min="0" 
              max="2" 
              step="0.1" 
              [(ngModel)]="intensity"
            >
          </div>

          <div class="control-group">
            <label>Color Shift</label>
            <input 
              type="range" 
              min="0" 
              max="1" 
              step="0.05" 
              [(ngModel)]="colorShift"
            >
          </div>

          <div class="shader-info">
            <h4>{{ getCurrentPreset()?.name }}</h4>
            <p>{{ getCurrentPreset()?.description }}</p>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .shader-info {
      margin-top: 24px;
      padding: 16px;
      background: var(--bg-tertiary);
      border-radius: 8px;
      border-left: 3px solid var(--accent-primary);

      h4 {
        font-size: 0.9rem;
        margin-bottom: 8px;
        color: var(--accent-primary);
      }

      p {
        font-size: 0.85rem;
        color: var(--text-secondary);
        line-height: 1.5;
      }
    }
  `]
})
export class ShaderPlaygroundComponent implements AfterViewInit {
  @ViewChild('demoBase') demoBase!: DemoBaseComponent;

  presets = [
    { id: 'plasma', name: 'Plasma', description: 'Classic plasma effect with flowing colors.' },
    { id: 'waves', name: 'Wave Interference', description: 'Overlapping sine waves creating interference patterns.' },
    { id: 'tunnel', name: 'Tunnel', description: 'Infinite tunnel effect with perspective distortion.' },
    { id: 'noise', name: 'Fractal Noise', description: 'Animated fractal brownian motion noise.' },
    { id: 'circles', name: 'Concentric Circles', description: 'Pulsating concentric circles from the center.' },
  ];

  selectedPreset = 'plasma';
  speed = 1;
  intensity = 1;
  colorShift = 0.5;

  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private context: WebGPUContext | null = null;

  ngAfterViewInit(): void {}

  getCurrentPreset() {
    return this.presets.find(p => p.id === this.selectedPreset);
  }

  async onContextReady(ctx: WebGPUContext): Promise<void> {
    this.context = ctx;
    await this.initializePipeline();
    this.startRendering();
  }

  onPresetChange(): void {
    if (this.context) {
      this.initializePipeline();
    }
  }

  private getShaderCode(): string {
    const shaders: Record<string, string> = {
      plasma: `
        fn effect(uv: vec2f, time: f32, intensity: f32) -> vec3f {
          var v = 0.0;
          v += sin((uv.x * 10.0 + time));
          v += sin((uv.y * 10.0 + time) * 0.5);
          v += sin((uv.x * 10.0 + uv.y * 10.0 + time) * 0.5);
          let cx = uv.x + 0.5 * sin(time * 0.5);
          let cy = uv.y + 0.5 * cos(time * 0.33);
          v += sin(sqrt(100.0 * (cx * cx + cy * cy) + 1.0) + time);
          v = v * 0.5 * intensity;
          return vec3f(
            sin(v * 3.14159) * 0.5 + 0.5,
            sin(v * 3.14159 + 2.094) * 0.5 + 0.5,
            sin(v * 3.14159 + 4.188) * 0.5 + 0.5
          );
        }
      `,
      waves: `
        fn effect(uv: vec2f, time: f32, intensity: f32) -> vec3f {
          var color = vec3f(0.0);
          for (var i = 0; i < 5; i++) {
            let fi = f32(i);
            let wave = sin(uv.x * (5.0 + fi * 2.0) + time * (1.0 + fi * 0.2)) * 0.5;
            let wave2 = sin(uv.y * (5.0 + fi * 2.0) + time * (1.0 + fi * 0.3)) * 0.5;
            let d = abs(uv.y - wave - wave2 * 0.3);
            color += vec3f(0.0, 0.5, 1.0) * (1.0 / (d * 50.0 + 1.0)) * intensity * 0.3;
          }
          return color;
        }
      `,
      tunnel: `
        fn effect(uv: vec2f, time: f32, intensity: f32) -> vec3f {
          let centered = uv * 2.0 - 1.0;
          let angle = atan2(centered.y, centered.x);
          let radius = length(centered);
          let u = angle / 3.14159;
          let v = 1.0 / radius + time;
          let pattern = sin(u * 10.0) * sin(v * 10.0);
          let color = vec3f(
            sin(pattern + time) * 0.5 + 0.5,
            sin(pattern + time + 2.094) * 0.5 + 0.5,
            sin(pattern + time + 4.188) * 0.5 + 0.5
          );
          return color * intensity * (1.0 - radius * 0.5);
        }
      `,
      noise: `
        fn hash(p: vec2f) -> f32 {
          return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
        }
        fn noise(p: vec2f) -> f32 {
          let i = floor(p);
          let f = fract(p);
          let u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i), hash(i + vec2f(1.0, 0.0)), u.x),
            mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x),
            u.y
          );
        }
        fn effect(uv: vec2f, time: f32, intensity: f32) -> vec3f {
          var n = 0.0;
          var amplitude = 1.0;
          var p = uv * 4.0;
          for (var i = 0; i < 5; i++) {
            n += amplitude * noise(p + time * 0.5);
            p *= 2.0;
            amplitude *= 0.5;
          }
          n = n * intensity;
          return vec3f(n * 0.8, n * 0.9, n);
        }
      `,
      circles: `
        fn effect(uv: vec2f, time: f32, intensity: f32) -> vec3f {
          let centered = uv * 2.0 - 1.0;
          let dist = length(centered);
          let rings = sin(dist * 20.0 - time * 4.0) * 0.5 + 0.5;
          let pulse = sin(time * 2.0) * 0.5 + 0.5;
          let color = vec3f(
            rings * (1.0 - dist) * intensity,
            rings * pulse * intensity * 0.5,
            (1.0 - rings) * (1.0 - dist) * intensity
          );
          return color;
        }
      `,
    };
    return shaders[this.selectedPreset] || shaders['plasma'];
  }

  private async initializePipeline(): Promise<void> {
    if (!this.context) return;

    const { device, format } = this.context;

    this.uniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shaderModule = device.createShaderModule({
      label: 'Shader Playground',
      code: `
        struct Uniforms {
          time: f32,
          intensity: f32,
          colorShift: f32,
          aspectRatio: f32,
        }

        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) uv: vec2f,
        }

        @vertex
        fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
          var pos = array<vec2f, 6>(
            vec2f(-1.0, -1.0),
            vec2f( 1.0, -1.0),
            vec2f( 1.0,  1.0),
            vec2f(-1.0, -1.0),
            vec2f( 1.0,  1.0),
            vec2f(-1.0,  1.0),
          );
          
          var output: VertexOutput;
          output.position = vec4f(pos[vertexIndex], 0.0, 1.0);
          output.uv = pos[vertexIndex] * 0.5 + 0.5;
          return output;
        }

        ${this.getShaderCode()}

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
          var uv = input.uv;
          uv.x *= uniforms.aspectRatio;
          
          var color = effect(uv, uniforms.time, uniforms.intensity);
          
          // Apply color shift
          let shift = uniforms.colorShift * 6.28318;
          color = vec3f(
            color.r * cos(shift) + color.g * sin(shift),
            color.g * cos(shift) - color.r * sin(shift) * 0.5,
            color.b
          );
          
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
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{ format }]
      },
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
        time * 0.001 * this.speed,
        this.intensity,
        this.colorShift,
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

