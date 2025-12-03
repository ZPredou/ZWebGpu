import { Component, ViewChild, AfterViewInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DemoBaseComponent } from '../../../components/shared/demo-base/demo-base.component';
import { WebGPUContext } from '../../../types/webgpu.types';

@Component({
  selector: 'app-rigid-body-physics',
  standalone: true,
  imports: [CommonModule, FormsModule, DemoBaseComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rigid-body-physics.component.html',
  styleUrl: './rigid-body-physics.component.scss'
})
export class RigidBodyPhysicsComponent implements AfterViewInit {
  @ViewChild('demoBase') demoBase!: DemoBaseComponent;

  bodyCount = 100;
  gravity = 9.8;
  restitution = 0.7;
  friction = 0.5;
  showBounds = false;

  private computePipeline: GPUComputePipeline | null = null;
  private renderPipeline: GPURenderPipeline | null = null;
  private positionBuffers: GPUBuffer[] = [];
  private velocityBuffers: GPUBuffer[] = [];
  private uniformBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private computeBindGroups: GPUBindGroup[] = [];
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

  onBodyCountChange(): void {
    if (this.context) {
      this.initializePipeline();
    }
  }

  resetSimulation(): void {
    if (this.context) {
      this.initializeBuffers();
    }
  }

  private initializeBuffers(): void {
    if (!this.context) return;

    const { device } = this.context;
    const size = this.bodyCount * 16; // vec4f per body (position + radius)

    this.positionBuffers.forEach(b => b.destroy());
    this.velocityBuffers.forEach(b => b.destroy());

    // Initialize random positions and velocities
    const positions = new Float32Array(this.bodyCount * 4);
    const velocities = new Float32Array(this.bodyCount * 4);

    for (let i = 0; i < this.bodyCount; i++) {
      const idx = i * 4;
      // Random position in a box
      positions[idx] = (Math.random() - 0.5) * 8;
      positions[idx + 1] = Math.random() * 5 + 2;
      positions[idx + 2] = (Math.random() - 0.5) * 8;
      positions[idx + 3] = 0.1 + Math.random() * 0.2; // radius

      // Random velocity
      velocities[idx] = (Math.random() - 0.5) * 2;
      velocities[idx + 1] = Math.random() * 2;
      velocities[idx + 2] = (Math.random() - 0.5) * 2;
      velocities[idx + 3] = 0; // unused
    }

    this.positionBuffers = [0, 1].map(() => {
      const buffer = device.createBuffer({
        size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, positions);
      return buffer;
    });

    this.velocityBuffers = [0, 1].map(() => {
      const buffer = device.createBuffer({
        size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, velocities);
      return buffer;
    });
  }

  private async initializePipeline(): Promise<void> {
    if (!this.context) return;

    const { device, format, canvas } = this.context;

    this.initializeBuffers();

    this.uniformBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create sphere geometry
    const segments = 16;
    const vertices: number[] = [];
    const indices: number[] = [];

    for (let lat = 0; lat <= segments; lat++) {
      const theta = lat * Math.PI / segments;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);

      for (let lon = 0; lon <= segments; lon++) {
        const phi = lon * 2 * Math.PI / segments;
        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);

        vertices.push(cosPhi * sinTheta, cosTheta, sinPhi * sinTheta);
      }
    }

    for (let lat = 0; lat < segments; lat++) {
      for (let lon = 0; lon < segments; lon++) {
        const first = lat * (segments + 1) + lon;
        const second = first + segments + 1;

        indices.push(first, second, first + 1);
        indices.push(second, second + 1, first + 1);
      }
    }

    this.indexCount = indices.length;

    const vertexBuffer = device.createBuffer({
      size: vertices.length * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, new Float32Array(vertices));

    this.indexBuffer = device.createBuffer({
      size: indices.length * 4,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.indexBuffer, 0, new Uint32Array(indices));

    // Physics compute shader
    const computeModule = device.createShaderModule({
      label: 'Rigid Body Physics',
      code: `
        struct Uniforms {
          bodyCount: u32,
          gravity: f32,
          restitution: f32,
          friction: f32,
          deltaTime: f32,
          bounds: vec4f,
        }

        @group(0) @binding(0) var<uniform> uniforms: Uniforms;
        @group(0) @binding(1) var<storage, read> posIn: array<vec4f>;
        @group(0) @binding(2) var<storage, read> velIn: array<vec4f>;
        @group(0) @binding(3) var<storage, read_write> posOut: array<vec4f>;
        @group(0) @binding(4) var<storage, read_write> velOut: array<vec4f>;

        @compute @workgroup_size(64)
        fn main(@builtin(global_invocation_id) id: vec3u) {
          let idx = id.x;
          if (idx >= uniforms.bodyCount) { return; }

          var pos = posIn[idx];
          var vel = velIn[idx];
          let radius = pos.w;

          // Apply gravity
          vel.y -= uniforms.gravity * uniforms.deltaTime;

          // Update position
          pos.xyz += vel.xyz * uniforms.deltaTime;

          // Collision with bounds
          if (pos.x - radius < uniforms.bounds.x) {
            pos.x = uniforms.bounds.x + radius;
            vel.x *= -uniforms.restitution;
            vel.x *= (1.0 - uniforms.friction);
          }
          if (pos.x + radius > uniforms.bounds.y) {
            pos.x = uniforms.bounds.y - radius;
            vel.x *= -uniforms.restitution;
            vel.x *= (1.0 - uniforms.friction);
          }

          if (pos.y - radius < uniforms.bounds.z) {
            pos.y = uniforms.bounds.z + radius;
            vel.y *= -uniforms.restitution;
            vel.x *= (1.0 - uniforms.friction);
            vel.z *= (1.0 - uniforms.friction);
          }
          if (pos.y + radius > uniforms.bounds.w) {
            pos.y = uniforms.bounds.w - radius;
            vel.y *= -uniforms.restitution;
            vel.x *= (1.0 - uniforms.friction);
            vel.z *= (1.0 - uniforms.friction);
          }

          if (pos.z - radius < uniforms.bounds.x) {
            pos.z = uniforms.bounds.x + radius;
            vel.z *= -uniforms.restitution;
            vel.z *= (1.0 - uniforms.friction);
          }
          if (pos.z + radius > uniforms.bounds.y) {
            pos.z = uniforms.bounds.y - radius;
            vel.z *= -uniforms.restitution;
            vel.z *= (1.0 - uniforms.friction);
          }

          // Collision between bodies
          for (var i = 0u; i < uniforms.bodyCount; i++) {
            if (i == idx) { continue; }
            
            let otherPos = posIn[i];
            let otherVel = velIn[i];
            let otherRadius = otherPos.w;
            
            let delta = pos.xyz - otherPos.xyz;
            let dist = length(delta);
            let minDist = radius + otherRadius;
            
            if (dist < minDist && dist > 0.001) {
              let normal = normalize(delta);
              let relVel = vel.xyz - otherVel.xyz;
              let velAlongNormal = dot(relVel, normal);
              
              if (velAlongNormal > 0.0) { continue; }
              
              let impulse = -(1.0 + uniforms.restitution) * velAlongNormal;
              impulse /= 2.0; // Assume equal mass
              
              vel.xyz += normal * impulse;
              
              // Separate bodies
              let overlap = minDist - dist;
              pos.xyz += normal * overlap * 0.5;
            }
          }

          // Damping
          vel.xyz *= 0.999;

          posOut[idx] = pos;
          velOut[idx] = vel;
        }
      `
    });

    const computeBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ]
    });

    this.computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [computeBindGroupLayout] }),
      compute: { module: computeModule, entryPoint: 'main' }
    });

    if (!this.uniformBuffer) {
      throw new Error('Uniform buffer not initialized');
    }

    this.computeBindGroups = [0, 1].map(i => {
      const posBuf1 = this.positionBuffers[i];
      const posBuf2 = this.positionBuffers[1 - i];
      const velBuf1 = this.velocityBuffers[i];
      const velBuf2 = this.velocityBuffers[1 - i];
      
      if (!posBuf1 || !posBuf2 || !velBuf1 || !velBuf2) {
        throw new Error('Buffers not initialized');
      }
      
      return device.createBindGroup({
        layout: computeBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer! } },
          { binding: 1, resource: { buffer: posBuf1 } },
          { binding: 2, resource: { buffer: velBuf1 } },
          { binding: 3, resource: { buffer: posBuf2 } },
          { binding: 4, resource: { buffer: velBuf2 } },
        ]
      });
    });

    // Render shader
    const renderModule = device.createShaderModule({
      label: 'Rigid Body Render',
      code: `
        struct Uniforms {
          viewProjection: mat4x4f,
        }

        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        struct VertexInput {
          @location(0) position: vec3f,
          @location(1) instancePos: vec4f,
        }

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) worldPos: vec3f,
        }

        @vertex
        fn vertexMain(input: VertexInput) -> VertexOutput {
          let radius = input.instancePos.w;
          let worldPos = input.instancePos.xyz + input.position * radius;
          
          var output: VertexOutput;
          output.position = uniforms.viewProjection * vec4f(worldPos, 1.0);
          output.worldPos = worldPos;
          return output;
        }

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
          let lightDir = normalize(vec3f(1.0, 1.0, 1.0));
          let normal = normalize(input.worldPos - input.worldPos); // Simplified
          let diffuse = max(0.0, dot(normal, lightDir));
          let ambient = 0.3;
          
          let color = vec3f(0.2, 0.6, 0.9) * (diffuse + ambient);
          return vec4f(color, 1.0);
        }
      `
    });

    const renderBindGroupLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform' }
      }]
    });

    this.renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] }),
      vertex: {
        module: renderModule,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: 12,
            stepMode: 'vertex',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }]
          },
          {
            arrayStride: 16,
            stepMode: 'instance',
            attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x4' }]
          }
        ]
      },
      fragment: {
        module: renderModule,
        entryPoint: 'fragmentMain',
        targets: [{ format }]
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus'
      }
    });

    const mvpBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.renderBindGroup = device.createBindGroup({
      layout: renderBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: mvpBuffer } }]
    });

    (this as any).mvpBuffer = mvpBuffer;
    (this as any).vertexBuffer = vertexBuffer;
  }

  private startRendering(): void {
    const render = (time: number, deltaTime: number) => {
      if (!this.context || !this.computePipeline || !this.renderPipeline) return;

      const { device, context, canvas } = this.context;

      const uniforms = new ArrayBuffer(64);
      const floatView = new Float32Array(uniforms);
      const uintView = new Uint32Array(uniforms);
      
      uintView[0] = this.bodyCount;
      floatView[1] = this.gravity;
      floatView[2] = this.restitution;
      floatView[3] = this.friction;
      floatView[4] = Math.min(deltaTime * 0.001, 0.02);
      floatView[5] = -5.0; // bounds x
      floatView[6] = 5.0;  // bounds y
      floatView[7] = 0.0;  // bounds z
      floatView[8] = 10.0; // bounds w

      device.queue.writeBuffer(this.uniformBuffer!, 0, uniforms);

      const commandEncoder = device.createCommandEncoder();

      // Physics compute pass
      const computePass = commandEncoder.beginComputePass();
      computePass.setPipeline(this.computePipeline);
      computePass.setBindGroup(0, this.computeBindGroups[this.step % 2]);
      computePass.dispatchWorkgroups(Math.ceil(this.bodyCount / 64));
      computePass.end();

      // Create MVP matrix
      const aspect = canvas.width / canvas.height;
      const t = time * 0.0005;
      const camPos = [Math.sin(t) * 8, 5, Math.cos(t) * 8];
      const mvp = this.createViewProjection(camPos, aspect);
      device.queue.writeBuffer((this as any).mvpBuffer, 0, new Float32Array(mvp));

      // Create depth texture
      const depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });

      // Render pass
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.05, g: 0.05, b: 0.1, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }],
        depthStencilAttachment: {
          view: depthTexture.createView(),
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store'
        }
      });

      renderPass.setPipeline(this.renderPipeline);
      renderPass.setBindGroup(0, this.renderBindGroup!);
      renderPass.setVertexBuffer(0, (this as any).vertexBuffer);
      renderPass.setVertexBuffer(1, this.positionBuffers[(this.step + 1) % 2]);
      renderPass.setIndexBuffer(this.indexBuffer!, 'uint32');
      renderPass.drawIndexed(this.indexCount, this.bodyCount);
      renderPass.end();

      device.queue.submit([commandEncoder.finish()]);
      this.step++;
    };

    this.demoBase.startRenderLoop(render);
  }

  private createViewProjection(eye: number[], aspect: number): number[] {
    const projection = this.perspective(Math.PI / 4, aspect, 0.1, 100);
    const view = this.lookAt(eye, [0, 2, 0], [0, 1, 0]);
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

