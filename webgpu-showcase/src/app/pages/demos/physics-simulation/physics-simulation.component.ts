import { Component, ViewChild, AfterViewInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DemoBaseComponent } from '../../../components/shared/demo-base/demo-base.component';
import { WebGPUContext } from '../../../types/webgpu.types';

@Component({
  selector: 'app-physics-simulation',
  standalone: true,
  imports: [CommonModule, FormsModule, DemoBaseComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="demo-page">
      <div class="demo-page__header">
        <h1><span class="icon">🌊</span> Physics Simulation</h1>
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
            GPU-accelerated cloth simulation using Verlet integration. Each vertex 
            position is computed in parallel using compute shaders.
          </p>
          
          <h3>Controls</h3>
          
          <div class="control-group">
            <label>Grid Size: {{ gridSize }}×{{ gridSize }}</label>
            <input type="range" min="16" max="64" step="8" [(ngModel)]="gridSize" (change)="onGridSizeChange()">
          </div>

          <div class="control-group">
            <label>Gravity: {{ gravity.toFixed(2) }}</label>
            <input type="range" min="0" max="2" step="0.1" [(ngModel)]="gravity">
          </div>

          <div class="control-group">
            <label>Stiffness: {{ stiffness.toFixed(2) }}</label>
            <input type="range" min="0.1" max="1" step="0.05" [(ngModel)]="stiffness">
          </div>

          <div class="control-group">
            <label>Damping: {{ damping.toFixed(2) }}</label>
            <input type="range" min="0.9" max="0.999" step="0.001" [(ngModel)]="damping">
          </div>

          <div class="control-group">
            <label>Wind: {{ wind.toFixed(2) }}</label>
            <input type="range" min="0" max="1" step="0.05" [(ngModel)]="wind">
          </div>

          <button class="btn btn--primary" (click)="resetSimulation()">
            Reset Simulation
          </button>

          <div class="stats-panel">
            <div class="stats-panel__item">
              <span class="label">Vertices</span>
              <span class="value">{{ (gridSize * gridSize).toLocaleString() }}</span>
            </div>
            <div class="stats-panel__item">
              <span class="label">Constraints</span>
              <span class="value">{{ constraintCount.toLocaleString() }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class PhysicsSimulationComponent implements AfterViewInit {
  @ViewChild('demoBase') demoBase!: DemoBaseComponent;

  gridSize = 32;
  gravity = 0.5;
  stiffness = 0.8;
  damping = 0.98;
  wind = 0.2;

  get constraintCount(): number {
    return (this.gridSize - 1) * this.gridSize * 2 + (this.gridSize - 1) * (this.gridSize - 1) * 2;
  }

  private computePipeline: GPUComputePipeline | null = null;
  private constraintPipeline: GPUComputePipeline | null = null;
  private renderPipeline: GPURenderPipeline | null = null;
  private positionBuffers: GPUBuffer[] = [];
  private prevPositionBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private computeBindGroups: GPUBindGroup[] = [];
  private constraintBindGroups: GPUBindGroup[] = [];
  private renderBindGroup: GPUBindGroup | null = null;
  private context: WebGPUContext | null = null;
  private step = 0;
  private indexCount = 0;

  ngAfterViewInit(): void {}

  async onContextReady(ctx: WebGPUContext): Promise<void> {
    this.context = ctx;
    await this.initializePipeline();
    this.startRendering();
  }

  onGridSizeChange(): void {
    this.resetSimulation();
  }

  resetSimulation(): void {
    if (this.context) {
      this.initializePipeline();
    }
  }

  private async initializePipeline(): Promise<void> {
    if (!this.context) return;

    const { device, format } = this.context;

    // Clean up old buffers
    this.positionBuffers.forEach(b => b.destroy());

    // Initialize positions
    const positions = new Float32Array(this.gridSize * this.gridSize * 4);
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        const idx = (y * this.gridSize + x) * 4;
        positions[idx] = (x / (this.gridSize - 1) - 0.5) * 1.5;
        positions[idx + 1] = (y / (this.gridSize - 1) - 0.5) * 1.5 + 0.5;
        positions[idx + 2] = 0;
        positions[idx + 3] = y === this.gridSize - 1 ? 0 : 1; // Fixed top row
      }
    }

    // Double buffer positions
    this.positionBuffers = [0, 1].map(() => {
      const buffer = device.createBuffer({
        size: positions.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, positions);
      return buffer;
    });

    this.prevPositionBuffer = device.createBuffer({
      size: positions.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.prevPositionBuffer, 0, positions);

    this.uniformBuffer = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create index buffer for rendering
    const indices: number[] = [];
    for (let y = 0; y < this.gridSize - 1; y++) {
      for (let x = 0; x < this.gridSize - 1; x++) {
        const i = y * this.gridSize + x;
        indices.push(i, i + 1, i + this.gridSize);
        indices.push(i + 1, i + this.gridSize + 1, i + this.gridSize);
      }
    }
    this.indexCount = indices.length;
    
    this.indexBuffer = device.createBuffer({
      size: indices.length * 4,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.indexBuffer, 0, new Uint32Array(indices));

    // Compute shader for physics
    const computeModule = device.createShaderModule({
      label: 'Cloth Physics',
      code: `
        struct Uniforms {
          gravity: f32,
          damping: f32,
          wind: f32,
          time: f32,
          gridSize: u32,
          deltaTime: f32,
        }

        @group(0) @binding(0) var<storage, read> posIn: array<vec4f>;
        @group(0) @binding(1) var<storage, read_write> posOut: array<vec4f>;
        @group(0) @binding(2) var<storage, read_write> prevPos: array<vec4f>;
        @group(0) @binding(3) var<uniform> uniforms: Uniforms;

        @compute @workgroup_size(8, 8)
        fn main(@builtin(global_invocation_id) id: vec3u) {
          let x = id.x;
          let y = id.y;
          let gridSize = uniforms.gridSize;
          
          if (x >= gridSize || y >= gridSize) { return; }
          
          let idx = y * gridSize + x;
          var pos = posIn[idx];
          var prev = prevPos[idx];
          
          // Skip fixed vertices (top row)
          if (pos.w == 0.0) {
            posOut[idx] = pos;
            return;
          }
          
          // Verlet integration
          var velocity = (pos.xyz - prev.xyz) * uniforms.damping;
          prev = pos;
          
          // Apply gravity
          velocity.y -= uniforms.gravity * 0.01;
          
          // Apply wind
          let windForce = sin(uniforms.time * 2.0 + pos.x * 3.0) * uniforms.wind * 0.01;
          velocity.z += windForce;
          velocity.x += windForce * 0.3;
          
          pos = vec4f(pos.xyz + velocity, pos.w);
          
          posOut[idx] = pos;
          prevPos[idx] = prev;
        }
      `
    });

    // Constraint shader
    const constraintModule = device.createShaderModule({
      label: 'Cloth Constraints',
      code: `
        struct Uniforms {
          gravity: f32,
          damping: f32,
          wind: f32,
          time: f32,
          gridSize: u32,
          stiffness: f32,
        }

        @group(0) @binding(0) var<storage, read_write> positions: array<vec4f>;
        @group(0) @binding(1) var<uniform> uniforms: Uniforms;

        fn solveConstraint(idx1: u32, idx2: u32, restLength: f32) {
          var p1 = positions[idx1];
          var p2 = positions[idx2];
          
          let delta = p2.xyz - p1.xyz;
          let dist = length(delta);
          if (dist < 0.0001) { return; }
          
          let diff = (dist - restLength) / dist;
          let correction = delta * diff * 0.5 * uniforms.stiffness;
          
          if (p1.w > 0.0) {
            positions[idx1] = vec4f(p1.xyz + correction, p1.w);
          }
          if (p2.w > 0.0) {
            positions[idx2] = vec4f(p2.xyz - correction, p2.w);
          }
        }

        @compute @workgroup_size(8, 8)
        fn main(@builtin(global_invocation_id) id: vec3u) {
          let x = id.x;
          let y = id.y;
          let gridSize = uniforms.gridSize;
          
          if (x >= gridSize || y >= gridSize) { return; }
          
          let idx = y * gridSize + x;
          let restLength = 1.5 / f32(gridSize - 1);
          
          // Horizontal constraint
          if (x < gridSize - 1) {
            solveConstraint(idx, idx + 1, restLength);
          }
          
          // Vertical constraint
          if (y < gridSize - 1) {
            solveConstraint(idx, idx + gridSize, restLength);
          }
        }
      `
    });

    const computeBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
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
          { binding: 0, resource: { buffer: this.positionBuffers[0] } },
          { binding: 1, resource: { buffer: this.positionBuffers[1] } },
          { binding: 2, resource: { buffer: this.prevPositionBuffer } },
          { binding: 3, resource: { buffer: this.uniformBuffer } },
        ]
      }),
      device.createBindGroup({
        layout: computeBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.positionBuffers[1] } },
          { binding: 1, resource: { buffer: this.positionBuffers[0] } },
          { binding: 2, resource: { buffer: this.prevPositionBuffer } },
          { binding: 3, resource: { buffer: this.uniformBuffer } },
        ]
      })
    ];

    const constraintBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ]
    });

    this.constraintPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [constraintBindGroupLayout] }),
      compute: { module: constraintModule, entryPoint: 'main' }
    });

    this.constraintBindGroups = [0, 1].map(i => device.createBindGroup({
      layout: constraintBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.positionBuffers[i] } },
        { binding: 1, resource: { buffer: this.uniformBuffer! } },
      ]
    }));

    // Render shader
    const renderModule = device.createShaderModule({
      label: 'Cloth Render',
      code: `
        struct Uniforms {
          mvp: mat4x4f,
        }

        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        struct VertexInput {
          @location(0) position: vec4f,
        }

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) worldPos: vec3f,
        }

        @vertex
        fn vertexMain(input: VertexInput) -> VertexOutput {
          var output: VertexOutput;
          output.position = uniforms.mvp * vec4f(input.position.xyz, 1.0);
          output.worldPos = input.position.xyz;
          return output;
        }

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
          let nx = dpdx(input.worldPos);
          let ny = dpdy(input.worldPos);
          let normal = normalize(cross(nx, ny));
          
          let light = normalize(vec3f(1.0, 1.0, 1.0));
          let diffuse = max(dot(normal, light), 0.0);
          let ambient = 0.3;
          
          let color = vec3f(0.2, 0.6, 0.9) * (diffuse + ambient);
          return vec4f(color, 1.0);
        }
      `
    });

    const renderBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      ]
    });

    this.renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] }),
      vertex: {
        module: renderModule,
        entryPoint: 'vertexMain',
        buffers: [{
          arrayStride: 16,
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }]
        }]
      },
      fragment: {
        module: renderModule,
        entryPoint: 'fragmentMain',
        targets: [{ format }]
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' }
    });

    const mvpBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.renderBindGroup = device.createBindGroup({
      layout: renderBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: mvpBuffer } }]
    });

    // Store reference for rendering
    (this as any).mvpBuffer = mvpBuffer;
  }

  private startRendering(): void {
    const render = (time: number) => {
      if (!this.context || !this.computePipeline || !this.renderPipeline) return;

      const { device, context, canvas } = this.context;

      // Update uniforms
      const uniforms = new ArrayBuffer(48);
      const floatView = new Float32Array(uniforms);
      const uintView = new Uint32Array(uniforms);
      floatView[0] = this.gravity;
      floatView[1] = this.damping;
      floatView[2] = this.wind;
      floatView[3] = time * 0.001;
      uintView[4] = this.gridSize;
      floatView[5] = this.stiffness;
      device.queue.writeBuffer(this.uniformBuffer!, 0, uniforms);

      // Create MVP matrix
      const aspect = canvas.width / canvas.height;
      const mvp = this.createMVP(time * 0.0005, aspect);
      device.queue.writeBuffer((this as any).mvpBuffer, 0, new Float32Array(mvp));

      const commandEncoder = device.createCommandEncoder();

      // Physics compute pass
      const computePass = commandEncoder.beginComputePass();
      computePass.setPipeline(this.computePipeline);
      computePass.setBindGroup(0, this.computeBindGroups[this.step % 2]);
      computePass.dispatchWorkgroups(
        Math.ceil(this.gridSize / 8),
        Math.ceil(this.gridSize / 8)
      );
      computePass.end();

      // Constraint passes (multiple iterations for stability)
      for (let i = 0; i < 5; i++) {
        const constraintPass = commandEncoder.beginComputePass();
        constraintPass.setPipeline(this.constraintPipeline!);
        constraintPass.setBindGroup(0, this.constraintBindGroups[(this.step + 1) % 2]);
        constraintPass.dispatchWorkgroups(
          Math.ceil(this.gridSize / 8),
          Math.ceil(this.gridSize / 8)
        );
        constraintPass.end();
      }

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
      renderPass.setVertexBuffer(0, this.positionBuffers[(this.step + 1) % 2]);
      renderPass.setIndexBuffer(this.indexBuffer!, 'uint32');
      renderPass.drawIndexed(this.indexCount);
      renderPass.end();

      device.queue.submit([commandEncoder.finish()]);
      this.step++;
    };

    (this.demoBase as any).startRenderLoop(render);
  }

  private createMVP(angle: number, aspect: number): number[] {
    const projection = this.perspective(Math.PI / 4, aspect, 0.1, 100);
    const view = this.lookAt([Math.sin(angle) * 3, 0.5, Math.cos(angle) * 3], [0, 0, 0], [0, 1, 0]);
    return this.multiply(projection, view);
  }

  private perspective(fov: number, aspect: number, near: number, far: number): number[] {
    const f = 1.0 / Math.tan(fov / 2);
    const nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }

  private lookAt(eye: number[], center: number[], up: number[]): number[] {
    const z = this.normalize(this.subtract(eye, center));
    const x = this.normalize(this.cross(up, z));
    const y = this.cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -this.dot(x, eye), -this.dot(y, eye), -this.dot(z, eye), 1];
  }

  private multiply(a: number[], b: number[]): number[] {
    const r = new Array(16).fill(0);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++)
        for (let k = 0; k < 4; k++)
          r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
    return r;
  }

  private normalize(v: number[]): number[] {
    const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  private subtract(a: number[], b: number[]): number[] {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }

  private cross(a: number[], b: number[]): number[] {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  private dot(a: number[], b: number[]): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }
}

