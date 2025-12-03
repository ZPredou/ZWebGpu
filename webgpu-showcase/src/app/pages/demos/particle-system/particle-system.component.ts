import { Component, ViewChild, AfterViewInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DemoBaseComponent } from '../../../components/shared/demo-base/demo-base.component';
import { WebGPUContext } from '../../../types/webgpu.types';

@Component({
  selector: 'app-particle-system',
  standalone: true,
  imports: [CommonModule, FormsModule, DemoBaseComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './particle-system.component.html',
  styleUrl: './particle-system.component.scss'
})
export class ParticleSystemComponent implements AfterViewInit {
  @ViewChild('demoBase') demoBase!: DemoBaseComponent;

  particleCount = 50000;
  gravity = 0.5;
  particleSize = 3;
  spawnRate = 0.5;

  private computePipeline: GPUComputePipeline | null = null;
  private renderPipeline: GPURenderPipeline | null = null;
  private particleBuffers: GPUBuffer[] = [];
  private uniformBuffer: GPUBuffer | null = null;
  private computeBindGroups: GPUBindGroup[] = [];
  private renderBindGroup: GPUBindGroup | null = null;
  private context: WebGPUContext | null = null;
  private step = 0;

  ngAfterViewInit(): void {}

  async onContextReady(ctx: WebGPUContext): Promise<void> {
    this.context = ctx;
    await this.initializePipeline();
    this.startRendering();
  }

  onParticleCountChange(): void {
    if (this.context) {
      this.initializePipeline();
    }
  }

  resetParticles(): void {
    if (this.context) {
      this.initializePipeline();
    }
  }

  private async initializePipeline(): Promise<void> {
    if (!this.context) return;

    const { device, format } = this.context;

    // Clean up old buffers
    this.particleBuffers.forEach(b => b.destroy());

    // Each particle: position (2), velocity (2), life (1), padding (1) = 6 floats
    const particleData = new Float32Array(this.particleCount * 6);
    for (let i = 0; i < this.particleCount; i++) {
      const idx = i * 6;
      particleData[idx] = (Math.random() - 0.5) * 2;     // x
      particleData[idx + 1] = (Math.random() - 0.5) * 2; // y
      particleData[idx + 2] = (Math.random() - 0.5) * 0.02; // vx
      particleData[idx + 3] = Math.random() * 0.02 + 0.01;  // vy
      particleData[idx + 4] = Math.random();             // life
      particleData[idx + 5] = 0;                         // padding
    }

    // Double buffer for compute
    this.particleBuffers = [0, 1].map(() => {
      const buffer = device.createBuffer({
        size: particleData.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, particleData);
      return buffer;
    });

    this.uniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Compute shader
    const computeModule = device.createShaderModule({
      label: 'Particle Compute',
      code: `
        struct Particle {
          pos: vec2f,
          vel: vec2f,
          life: f32,
          padding: f32,
        }

        struct Uniforms {
          deltaTime: f32,
          gravity: f32,
          spawnRate: f32,
          time: f32,
        }

        @group(0) @binding(0) var<storage, read> particlesIn: array<Particle>;
        @group(0) @binding(1) var<storage, read_write> particlesOut: array<Particle>;
        @group(0) @binding(2) var<uniform> uniforms: Uniforms;

        fn hash(p: vec2f) -> f32 {
          return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
        }

        @compute @workgroup_size(64)
        fn main(@builtin(global_invocation_id) id: vec3u) {
          let idx = id.x;
          if (idx >= arrayLength(&particlesIn)) {
            return;
          }

          var p = particlesIn[idx];
          
          // Update velocity with gravity
          p.vel.y -= uniforms.gravity * uniforms.deltaTime * 0.001;
          
          // Update position
          p.pos += p.vel;
          
          // Decrease life
          p.life -= uniforms.deltaTime * 0.0005;
          
          // Respawn dead particles
          if (p.life <= 0.0 && hash(p.pos + uniforms.time) < uniforms.spawnRate) {
            p.pos = vec2f(
              (hash(vec2f(f32(idx), uniforms.time)) - 0.5) * 0.5,
              -0.8
            );
            p.vel = vec2f(
              (hash(vec2f(uniforms.time, f32(idx))) - 0.5) * 0.02,
              hash(vec2f(f32(idx) * 0.1, uniforms.time * 0.5)) * 0.03 + 0.02
            );
            p.life = 1.0;
          }
          
          // Bounce off walls
          if (p.pos.x < -1.0 || p.pos.x > 1.0) {
            p.vel.x *= -0.8;
            p.pos.x = clamp(p.pos.x, -1.0, 1.0);
          }
          if (p.pos.y < -1.0) {
            p.vel.y *= -0.6;
            p.pos.y = -1.0;
          }
          
          particlesOut[idx] = p;
        }
      `
    });

    const computeBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ]
    });

    this.computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [computeBindGroupLayout] }),
      compute: { module: computeModule, entryPoint: 'main' }
    });

    this.computeBindGroups = [
      device.createBindGroup({
        layout: computeBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.particleBuffers[0] } },
          { binding: 1, resource: { buffer: this.particleBuffers[1] } },
          { binding: 2, resource: { buffer: this.uniformBuffer } },
        ]
      }),
      device.createBindGroup({
        layout: computeBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.particleBuffers[1] } },
          { binding: 1, resource: { buffer: this.particleBuffers[0] } },
          { binding: 2, resource: { buffer: this.uniformBuffer } },
        ]
      })
    ];

    // Render shader
    const renderModule = device.createShaderModule({
      label: 'Particle Render',
      code: `
        struct Uniforms {
          deltaTime: f32,
          gravity: f32,
          spawnRate: f32,
          time: f32,
          particleSize: f32,
          aspectRatio: f32,
        }

        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        struct VertexInput {
          @location(0) pos: vec2f,
          @location(1) vel: vec2f,
          @location(2) life: f32,
        }

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) life: f32,
          @location(1) vel: vec2f,
        }

        @vertex
        fn vertexMain(input: VertexInput) -> VertexOutput {
          var output: VertexOutput;
          output.position = vec4f(input.pos.x, input.pos.y, 0.0, 1.0);
          output.life = input.life;
          output.vel = input.vel;
          return output;
        }

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
          let speed = length(input.vel) * 20.0;
          let color = vec3f(
            1.0 - input.life * 0.5,
            input.life * 0.8 + speed,
            input.life
          );
          return vec4f(color * input.life, input.life);
        }
      `
    });

    const renderBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ]
    });

    this.renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] }),
      vertex: {
        module: renderModule,
        entryPoint: 'vertexMain',
        buffers: [{
          arrayStride: 24, // 6 floats
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },  // pos
            { shaderLocation: 1, offset: 8, format: 'float32x2' },  // vel
            { shaderLocation: 2, offset: 16, format: 'float32' },   // life
          ]
        }]
      },
      fragment: {
        module: renderModule,
        entryPoint: 'fragmentMain',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
          }
        }]
      },
      primitive: { topology: 'point-list' }
    });

    // Create uniform buffer for render
    this.renderBindGroup = device.createBindGroup({
      layout: renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
      ]
    });
  }

  private startRendering(): void {
    let lastTime = 0;

    const render = (time: number) => {
      if (!this.context || !this.computePipeline || !this.renderPipeline) return;

      const deltaTime = time - lastTime;
      lastTime = time;

      const { device, context, canvas } = this.context;
      const aspect = canvas.width / canvas.height;

      // Update uniforms
      const uniforms = new Float32Array([
        deltaTime,
        this.gravity,
        this.spawnRate,
        time * 0.001,
        this.particleSize,
        aspect
      ]);
      device.queue.writeBuffer(this.uniformBuffer!, 0, uniforms);

      const commandEncoder = device.createCommandEncoder();

      // Compute pass
      const computePass = commandEncoder.beginComputePass();
      computePass.setPipeline(this.computePipeline);
      computePass.setBindGroup(0, this.computeBindGroups[this.step % 2]);
      computePass.dispatchWorkgroups(Math.ceil(this.particleCount / 64));
      computePass.end();

      // Render pass
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.02, b: 0.04, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }]
      });

      renderPass.setPipeline(this.renderPipeline);
      renderPass.setBindGroup(0, this.renderBindGroup!);
      renderPass.setVertexBuffer(0, this.particleBuffers[(this.step + 1) % 2]);
      renderPass.draw(1, this.particleCount);
      renderPass.end();

      device.queue.submit([commandEncoder.finish()]);
      this.step++;
    };

    (this.demoBase as any).startRenderLoop(render);
  }
}
