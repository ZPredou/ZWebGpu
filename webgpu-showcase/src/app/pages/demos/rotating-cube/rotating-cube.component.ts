import { Component, ViewChild, AfterViewInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DemoBaseComponent } from '../../../components/shared/demo-base/demo-base.component';
import { WebGPUContext } from '../../../types/webgpu.types';

@Component({
  selector: 'app-rotating-cube',
  standalone: true,
  imports: [CommonModule, DemoBaseComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rotating-cube.component.html',
  styleUrl: './rotating-cube.component.scss'
})
export class RotatingCubeComponent implements AfterViewInit {
  @ViewChild('demoBase') demoBase!: DemoBaseComponent;

  rotationX = 0.5;
  rotationY = 1;
  cameraDistance = 4;

  private pipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private depthTexture: GPUTexture | null = null;
  private context: WebGPUContext | null = null;

  ngAfterViewInit(): void {}

  toNumber(event: Event): number {
    return parseFloat((event.target as HTMLInputElement).value);
  }

  async onContextReady(ctx: WebGPUContext): Promise<void> {
    this.context = ctx;
    await this.initializePipeline();
    this.startRendering();
  }

  private async initializePipeline(): Promise<void> {
    if (!this.context) return;

    const { device, format, canvas } = this.context;

    // Cube vertices with positions and colors
    const vertices = new Float32Array([
      // Front face (red)
      -1, -1,  1,   1, 0.3, 0.3,
       1, -1,  1,   1, 0.3, 0.3,
       1,  1,  1,   1, 0.3, 0.3,
      -1,  1,  1,   1, 0.3, 0.3,
      // Back face (green)
      -1, -1, -1,   0.3, 1, 0.5,
      -1,  1, -1,   0.3, 1, 0.5,
       1,  1, -1,   0.3, 1, 0.5,
       1, -1, -1,   0.3, 1, 0.5,
      // Top face (blue)
      -1,  1, -1,   0.3, 0.5, 1,
      -1,  1,  1,   0.3, 0.5, 1,
       1,  1,  1,   0.3, 0.5, 1,
       1,  1, -1,   0.3, 0.5, 1,
      // Bottom face (yellow)
      -1, -1, -1,   1, 1, 0.3,
       1, -1, -1,   1, 1, 0.3,
       1, -1,  1,   1, 1, 0.3,
      -1, -1,  1,   1, 1, 0.3,
      // Right face (magenta)
       1, -1, -1,   1, 0.3, 1,
       1,  1, -1,   1, 0.3, 1,
       1,  1,  1,   1, 0.3, 1,
       1, -1,  1,   1, 0.3, 1,
      // Left face (cyan)
      -1, -1, -1,   0.3, 1, 1,
      -1, -1,  1,   0.3, 1, 1,
      -1,  1,  1,   0.3, 1, 1,
      -1,  1, -1,   0.3, 1, 1,
    ]);

    const indices = new Uint16Array([
      0,  1,  2,   0,  2,  3,   // front
      4,  5,  6,   4,  6,  7,   // back
      8,  9,  10,  8,  10, 11,  // top
      12, 13, 14,  12, 14, 15,  // bottom
      16, 17, 18,  16, 18, 19,  // right
      20, 21, 22,  20, 22, 23,  // left
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

    this.uniformBuffer = device.createBuffer({
      size: 64 * 2, // Two 4x4 matrices
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.depthTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const shaderModule = device.createShaderModule({
      label: 'Cube Shader',
      code: `
        struct Uniforms {
          modelViewProjection: mat4x4f,
          model: mat4x4f,
        }

        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        struct VertexInput {
          @location(0) position: vec3f,
          @location(1) color: vec3f,
        }

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) color: vec3f,
        }

        @vertex
        fn vertexMain(input: VertexInput) -> VertexOutput {
          var output: VertexOutput;
          output.position = uniforms.modelViewProjection * vec4f(input.position, 1.0);
          output.color = input.color;
          return output;
        }

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
          return vec4f(input.color, 1.0);
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
        buffers: [{
          arrayStride: 24,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
          ]
        }]
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{ format }]
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back'
      },
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
      if (!this.context || !this.pipeline) return;

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

      // Create matrices
      const projection = this.perspective(Math.PI / 4, aspect, 0.1, 100);
      const view = this.lookAt(
        [0, 0, this.cameraDistance],
        [0, 0, 0],
        [0, 1, 0]
      );
      const model = this.multiply(
        this.rotateY(t * this.rotationY),
        this.rotateX(t * this.rotationX)
      );
      const mvp = this.multiply(projection, this.multiply(view, model));

      device.queue.writeBuffer(this.uniformBuffer!, 0, new Float32Array([...mvp, ...model]));

      const commandEncoder = device.createCommandEncoder();
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.04, g: 0.04, b: 0.06, a: 1.0 },
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
      renderPass.setIndexBuffer(this.indexBuffer!, 'uint16');
      renderPass.drawIndexed(36);
      renderPass.end();

      device.queue.submit([commandEncoder.finish()]);
    };

    (this.demoBase as any).startRenderLoop(render);
  }

  // Matrix helper functions
  private perspective(fov: number, aspect: number, near: number, far: number): number[] {
    const f = 1.0 / Math.tan(fov / 2);
    const nf = 1 / (near - far);
    return [
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ];
  }

  private lookAt(eye: number[], center: number[], up: number[]): number[] {
    const z = this.normalize(this.subtract(eye, center));
    const x = this.normalize(this.cross(up, z));
    const y = this.cross(z, x);
    return [
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -this.dot(x, eye), -this.dot(y, eye), -this.dot(z, eye), 1
    ];
  }

  private rotateX(angle: number): number[] {
    const c = Math.cos(angle), s = Math.sin(angle);
    return [1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1];
  }

  private rotateY(angle: number): number[] {
    const c = Math.cos(angle), s = Math.sin(angle);
    return [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1];
  }

  private multiply(a: number[], b: number[]): number[] {
    const result = new Array(16).fill(0);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        for (let k = 0; k < 4; k++) {
          result[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
        }
      }
    }
    return result;
  }

  private normalize(v: number[]): number[] {
    const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
    return [v[0]/len, v[1]/len, v[2]/len];
  }

  private subtract(a: number[], b: number[]): number[] {
    return [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
  }

  private cross(a: number[], b: number[]): number[] {
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  }

  private dot(a: number[], b: number[]): number {
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  }
}
