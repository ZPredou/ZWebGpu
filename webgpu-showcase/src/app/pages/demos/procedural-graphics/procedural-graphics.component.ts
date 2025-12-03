import { Component, ViewChild, AfterViewInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DemoBaseComponent } from '../../../components/shared/demo-base/demo-base.component';
import { WebGPUContext } from '../../../types/webgpu.types';

@Component({
  selector: 'app-procedural-graphics',
  standalone: true,
  imports: [CommonModule, FormsModule, DemoBaseComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './procedural-graphics.component.html',
  styleUrl: './procedural-graphics.component.scss'
})
export class ProceduralGraphicsComponent implements AfterViewInit {
  @ViewChild('demoBase') demoBase!: DemoBaseComponent;

  patterns = [
    { id: 'perlin', name: 'Perlin Noise', description: 'Classic gradient noise for natural-looking textures.' },
    { id: 'worley', name: 'Worley Noise', description: 'Cell-based noise creating organic patterns like cells or stone.' },
    { id: 'fbm', name: 'Fractal Brownian Motion', description: 'Layered noise for cloud-like and terrain textures.' },
    { id: 'voronoi', name: 'Voronoi Diagram', description: 'Partition space into regions based on distance to points.' },
    { id: 'marble', name: 'Marble', description: 'Simulated marble texture using distorted sine waves.' },
    { id: 'wood', name: 'Wood Grain', description: 'Procedural wood texture with rings and grain.' },
  ];

  patternType = 'perlin';
  scale = 5;
  speed = 0.5;
  complexity = 4;

  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private context: WebGPUContext | null = null;

  ngAfterViewInit(): void {}

  getCurrentPattern() {
    return this.patterns.find(p => p.id === this.patternType);
  }

  async onContextReady(ctx: WebGPUContext): Promise<void> {
    this.context = ctx;
    await this.initializePipeline();
    this.startRendering();
  }

  onPatternChange(): void {
    if (this.context) {
      this.initializePipeline();
    }
  }

  private getPatternCode(): string {
    const code: Record<string, string> = {
      perlin: `
        fn pattern(uv: vec2f, time: f32, scale: f32, complexity: i32) -> vec3f {
          var value = 0.0;
          var amplitude = 1.0;
          var p = uv * scale;
          
          for (var i = 0; i < complexity; i++) {
            value += amplitude * noise(p + time * 0.5);
            p *= 2.0;
            amplitude *= 0.5;
          }
          
          value = value * 0.5 + 0.5;
          return vec3f(value * 0.8, value * 0.9, value);
        }
      `,
      worley: `
        fn worleyNoise(p: vec2f) -> f32 {
          let cell = floor(p);
          var minDist = 1.0;
          
          for (var x = -1; x <= 1; x++) {
            for (var y = -1; y <= 1; y++) {
              let neighbor = cell + vec2f(f32(x), f32(y));
              let point = neighbor + hash2(neighbor);
              let dist = distance(p, point);
              minDist = min(minDist, dist);
            }
          }
          
          return minDist;
        }
        
        fn pattern(uv: vec2f, time: f32, scale: f32, complexity: i32) -> vec3f {
          let p = uv * scale + time * 0.2;
          let w = worleyNoise(p);
          
          return vec3f(
            w * 0.3 + 0.2,
            w * 0.8 + 0.1,
            w * 0.6 + 0.3
          );
        }
      `,
      fbm: `
        fn pattern(uv: vec2f, time: f32, scale: f32, complexity: i32) -> vec3f {
          var value = 0.0;
          var amplitude = 0.5;
          var p = uv * scale;
          
          for (var i = 0; i < complexity; i++) {
            value += amplitude * noise(p + time * 0.3);
            p *= 2.0;
            amplitude *= 0.5;
          }
          
          let r = value * 0.5 + 0.5;
          let g = value * 0.4 + 0.3;
          let b = value * 0.3 + 0.2;
          
          return vec3f(r * 0.6, g * 0.8, b * 1.2);
        }
      `,
      voronoi: `
        fn pattern(uv: vec2f, time: f32, scale: f32, complexity: i32) -> vec3f {
          let p = uv * scale;
          let cell = floor(p);
          var minDist = 10.0;
          var closestCell = vec2f(0.0);
          
          for (var x = -1; x <= 1; x++) {
            for (var y = -1; y <= 1; y++) {
              let neighbor = cell + vec2f(f32(x), f32(y));
              let point = neighbor + hash2(neighbor + sin(time) * 0.1);
              let dist = distance(p, point);
              if (dist < minDist) {
                minDist = dist;
                closestCell = neighbor;
              }
            }
          }
          
          let h = hash2(closestCell);
          return vec3f(
            sin(h.x * 6.28 + time) * 0.5 + 0.5,
            sin(h.y * 6.28 + time + 2.0) * 0.5 + 0.5,
            sin((h.x + h.y) * 3.14 + time) * 0.5 + 0.5
          );
        }
      `,
      marble: `
        fn pattern(uv: vec2f, time: f32, scale: f32, complexity: i32) -> vec3f {
          var p = uv * scale;
          var n = 0.0;
          var amp = 1.0;
          
          for (var i = 0; i < complexity; i++) {
            n += amp * noise(p);
            p *= 2.0;
            amp *= 0.5;
          }
          
          let marble = sin(uv.x * scale * 2.0 + n * 5.0 + time);
          let value = marble * 0.5 + 0.5;
          
          return vec3f(
            0.9 + value * 0.1,
            0.85 + value * 0.1,
            0.8 + value * 0.15
          ) * (0.7 + value * 0.3);
        }
      `,
      wood: `
        fn pattern(uv: vec2f, time: f32, scale: f32, complexity: i32) -> vec3f {
          let p = uv * scale;
          let dist = length(p - vec2f(scale * 0.5));
          
          var n = 0.0;
          var amp = 1.0;
          var np = p;
          for (var i = 0; i < complexity; i++) {
            n += amp * noise(np);
            np *= 2.0;
            amp *= 0.5;
          }
          
          let ring = sin(dist * 10.0 + n * 5.0 + time * 0.5);
          let grain = noise(p * vec2f(1.0, 20.0) + time * 0.1);
          let value = ring * 0.3 + grain * 0.2 + 0.5;
          
          return vec3f(
            0.4 + value * 0.3,
            0.25 + value * 0.2,
            0.1 + value * 0.1
          );
        }
      `,
    };
    return code[this.patternType] || code['perlin'];
  }

  private async initializePipeline(): Promise<void> {
    if (!this.context) return;

    const { device, format } = this.context;

    this.uniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shaderModule = device.createShaderModule({
      label: 'Procedural Graphics',
      code: `
        struct Uniforms {
          time: f32,
          scale: f32,
          speed: f32,
          complexity: i32,
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

        fn hash(p: vec2f) -> f32 {
          return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
        }

        fn hash2(p: vec2f) -> vec2f {
          return vec2f(hash(p), hash(p + vec2f(1.0, 0.0)));
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

        ${this.getPatternCode()}

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
          let color = pattern(input.uv, uniforms.time * uniforms.speed, uniforms.scale, uniforms.complexity);
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

      const { device, context } = this.context;

      const uniforms = new ArrayBuffer(32);
      new Float32Array(uniforms, 0, 3).set([time * 0.001, this.scale, this.speed]);
      new Int32Array(uniforms, 12, 1).set([this.complexity]);
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

    this.demoBase.startRenderLoop(render);
  }
}

