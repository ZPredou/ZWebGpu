import { Component, ViewChild, AfterViewInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DemoBaseComponent } from '../../../components/shared/demo-base/demo-base.component';
import { WebGPUContext } from '../../../types/webgpu.types';

@Component({
  selector: 'app-instanced-rendering',
  standalone: true,
  imports: [CommonModule, FormsModule, DemoBaseComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './instanced-rendering.component.html',
  styleUrl: './instanced-rendering.component.scss'
})
export class InstancedRenderingComponent implements AfterViewInit {
  @ViewChild('demoBase') demoBase!: DemoBaseComponent;

  instanceCount = 10000;
  cubeSize = 0.05;
  rotationSpeed = 1;
  spread = 5;
  pattern = 'cube';

  private pipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private instanceBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private depthTexture: GPUTexture | null = null;
  private context: WebGPUContext | null = null;

  ngAfterViewInit(): void {}

  async onContextReady(ctx: WebGPUContext): Promise<void> {
    this.context = ctx;
    await this.initializePipeline();
    this.startRendering();
  }

  onInstanceCountChange(): void {
    this.generateInstances();
  }

  private generateInstances(): void {
    if (!this.context) return;

    const { device } = this.context;
    
    // Instance data: position (3), rotation offset (1), color (3), scale (1) = 8 floats
    const instanceData = new Float32Array(this.instanceCount * 8);
    
    for (let i = 0; i < this.instanceCount; i++) {
      const idx = i * 8;
      let x, y, z;
      
      switch (this.pattern) {
        case 'cube':
          const side = Math.ceil(Math.cbrt(this.instanceCount));
          const ix = i % side;
          const iy = Math.floor(i / side) % side;
          const iz = Math.floor(i / (side * side));
          x = (ix / side - 0.5) * this.spread;
          y = (iy / side - 0.5) * this.spread;
          z = (iz / side - 0.5) * this.spread;
          break;
          
        case 'sphere':
          const phi = Math.acos(1 - 2 * (i + 0.5) / this.instanceCount);
          const theta = Math.PI * (1 + Math.sqrt(5)) * i;
          const r = this.spread * 0.5;
          x = r * Math.sin(phi) * Math.cos(theta);
          y = r * Math.sin(phi) * Math.sin(theta);
          z = r * Math.cos(phi);
          break;
          
        case 'spiral':
          const t = i / this.instanceCount * Math.PI * 20;
          const radius = (i / this.instanceCount) * this.spread * 0.5;
          x = Math.cos(t) * radius;
          y = (i / this.instanceCount - 0.5) * this.spread;
          z = Math.sin(t) * radius;
          break;
          
        default: // random
          x = (Math.random() - 0.5) * this.spread;
          y = (Math.random() - 0.5) * this.spread;
          z = (Math.random() - 0.5) * this.spread;
      }
      
      instanceData[idx] = x;
      instanceData[idx + 1] = y;
      instanceData[idx + 2] = z;
      instanceData[idx + 3] = Math.random() * Math.PI * 2; // rotation offset
      
      // Color based on position
      const hue = (x + y + z) / this.spread + 0.5;
      instanceData[idx + 4] = Math.sin(hue * 6.28) * 0.5 + 0.5;
      instanceData[idx + 5] = Math.sin(hue * 6.28 + 2.09) * 0.5 + 0.5;
      instanceData[idx + 6] = Math.sin(hue * 6.28 + 4.18) * 0.5 + 0.5;
      instanceData[idx + 7] = 0.8 + Math.random() * 0.4; // scale variation
    }

    this.instanceBuffer?.destroy();
    this.instanceBuffer = device.createBuffer({
      size: instanceData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.instanceBuffer, 0, instanceData);
  }

  private async initializePipeline(): Promise<void> {
    if (!this.context) return;

    const { device, format, canvas } = this.context;

    // Cube vertices
    const vertices = new Float32Array([
      // Front
      -1, -1,  1,  0, 0, 1,
       1, -1,  1,  0, 0, 1,
       1,  1,  1,  0, 0, 1,
      -1,  1,  1,  0, 0, 1,
      // Back
       1, -1, -1,  0, 0,-1,
      -1, -1, -1,  0, 0,-1,
      -1,  1, -1,  0, 0,-1,
       1,  1, -1,  0, 0,-1,
      // Top
      -1,  1,  1,  0, 1, 0,
       1,  1,  1,  0, 1, 0,
       1,  1, -1,  0, 1, 0,
      -1,  1, -1,  0, 1, 0,
      // Bottom
      -1, -1, -1,  0,-1, 0,
       1, -1, -1,  0,-1, 0,
       1, -1,  1,  0,-1, 0,
      -1, -1,  1,  0,-1, 0,
      // Right
       1, -1,  1,  1, 0, 0,
       1, -1, -1,  1, 0, 0,
       1,  1, -1,  1, 0, 0,
       1,  1,  1,  1, 0, 0,
      // Left
      -1, -1, -1, -1, 0, 0,
      -1, -1,  1, -1, 0, 0,
      -1,  1,  1, -1, 0, 0,
      -1,  1, -1, -1, 0, 0,
    ]);

    const indices = new Uint16Array([
      0,  1,  2,   0,  2,  3,
      4,  5,  6,   4,  6,  7,
      8,  9,  10,  8,  10, 11,
      12, 13, 14,  12, 14, 15,
      16, 17, 18,  16, 18, 19,
      20, 21, 22,  20, 22, 23,
    ]);

    this.vertexBuffer = device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.vertexBuffer, 0, vertices);

    this.indexBuffer = device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.indexBuffer, 0, indices);

    this.generateInstances();

    this.uniformBuffer = device.createBuffer({
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.depthTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const shaderModule = device.createShaderModule({
      label: 'Instanced Rendering',
      code: `
        struct Uniforms {
          viewProjection: mat4x4f,
          time: f32,
          cubeSize: f32,
          rotationSpeed: f32,
          padding: f32,
        }

        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        struct VertexInput {
          @location(0) position: vec3f,
          @location(1) normal: vec3f,
          @location(2) instancePos: vec3f,
          @location(3) rotationOffset: f32,
          @location(4) color: vec3f,
          @location(5) scale: f32,
        }

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) normal: vec3f,
          @location(1) color: vec3f,
          @location(2) worldPos: vec3f,
        }

        fn rotateY(p: vec3f, angle: f32) -> vec3f {
          let c = cos(angle);
          let s = sin(angle);
          return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
        }

        fn rotateX(p: vec3f, angle: f32) -> vec3f {
          let c = cos(angle);
          let s = sin(angle);
          return vec3f(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
        }

        @vertex
        fn vertexMain(input: VertexInput) -> VertexOutput {
          let angle = uniforms.time * uniforms.rotationSpeed + input.rotationOffset;
          
          // Scale and rotate vertex
          var localPos = input.position * uniforms.cubeSize * input.scale;
          localPos = rotateY(localPos, angle);
          localPos = rotateX(localPos, angle * 0.7);
          
          // Rotate normal
          var rotNormal = rotateY(input.normal, angle);
          rotNormal = rotateX(rotNormal, angle * 0.7);
          
          let worldPos = localPos + input.instancePos;
          
          var output: VertexOutput;
          output.position = uniforms.viewProjection * vec4f(worldPos, 1.0);
          output.normal = rotNormal;
          output.color = input.color;
          output.worldPos = worldPos;
          return output;
        }

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
          let lightDir = normalize(vec3f(1.0, 1.0, 0.5));
          let diffuse = max(dot(input.normal, lightDir), 0.0);
          let ambient = 0.3;
          
          let color = input.color * (diffuse * 0.7 + ambient);
          
          return vec4f(color, 1.0);
        }
      `
    });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform' }
      }]
    });

    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: 24,
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
            ]
          },
          {
            arrayStride: 32,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 2, offset: 0, format: 'float32x3' },  // position
              { shaderLocation: 3, offset: 12, format: 'float32' },   // rotation
              { shaderLocation: 4, offset: 16, format: 'float32x3' }, // color
              { shaderLocation: 5, offset: 28, format: 'float32' },   // scale
            ]
          }
        ]
      },
      fragment: {
        module: shaderModule,
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

    this.bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }]
    });
  }

  private startRendering(): void {
    const render = (time: number) => {
      if (!this.context || !this.pipeline || !this.instanceBuffer) return;

      const { device, context, canvas } = this.context;

      // Recreate depth texture if size changed
      if (!this.depthTexture || 
          this.depthTexture.width !== canvas.width || 
          this.depthTexture.height !== canvas.height) {
        this.depthTexture?.destroy();
        this.depthTexture = device.createTexture({
          size: [canvas.width, canvas.height],
          format: 'depth24plus',
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
      }

      const t = time * 0.001;
      const aspect = canvas.width / canvas.height;

      // Camera orbiting
      const camDist = this.spread * 2.0;
      const camPos = [
        Math.sin(t * 0.2) * camDist,
        Math.sin(t * 0.1) * camDist * 0.5 + 3,
        Math.cos(t * 0.2) * camDist
      ];

      const viewProjection = this.createViewProjection(camPos, aspect);

      const uniforms = new Float32Array([
        ...viewProjection,
        t,
        this.cubeSize,
        this.rotationSpeed,
        0
      ]);
      device.queue.writeBuffer(this.uniformBuffer!, 0, uniforms);

      const commandEncoder = device.createCommandEncoder();
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.02, b: 0.04, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }],
        depthStencilAttachment: {
          view: this.depthTexture!.createView(),
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store'
        }
      });

      renderPass.setPipeline(this.pipeline);
      renderPass.setBindGroup(0, this.bindGroup!);
      renderPass.setVertexBuffer(0, this.vertexBuffer!);
      renderPass.setVertexBuffer(1, this.instanceBuffer);
      renderPass.setIndexBuffer(this.indexBuffer!, 'uint16');
      renderPass.drawIndexed(36, this.instanceCount);
      renderPass.end();

      device.queue.submit([commandEncoder.finish()]);
    };

    this.demoBase.startRenderLoop(render);
  }

  private createViewProjection(eye: number[], aspect: number): number[] {
    const projection = this.perspective(Math.PI / 4, aspect, 0.1, 100);
    const view = this.lookAt(eye, [0, 0, 0], [0, 1, 0]);
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

