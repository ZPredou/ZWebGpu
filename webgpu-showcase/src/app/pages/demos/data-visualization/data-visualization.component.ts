import { Component, ViewChild, AfterViewInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DemoBaseComponent } from '../../../components/shared/demo-base/demo-base.component';
import { WebGPUContext } from '../../../types/webgpu.types';

@Component({
  selector: 'app-data-visualization',
  standalone: true,
  imports: [CommonModule, FormsModule, DemoBaseComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './data-visualization.component.html',
  styleUrl: './data-visualization.component.scss'
})
export class DataVisualizationComponent implements AfterViewInit {
  @ViewChild('demoBase') demoBase!: DemoBaseComponent;

  pointCount = 100000;
  pointSize = 3;
  animationSpeed = 0.5;
  dataPattern = 'gaussian';

  private pipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private dataBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private context: WebGPUContext | null = null;
  private bufferPointCount = 0; // Track actual buffer size

  ngAfterViewInit(): void {}

  async onContextReady(ctx: WebGPUContext): Promise<void> {
    this.context = ctx;
    await this.initializePipeline();
    this.startRendering();
  }

  onPointCountChange(): void {
    this.regenerateData();
  }

  onPatternChange(): void {
    this.regenerateData();
  }

  regenerateData(): void {
    if (this.context) {
      this.generateDataPoints();
    }
  }

  private generateDataPoints(): void {
    if (!this.context) return;

    const { device } = this.context;
    
    // Generate data: position (x, y), value (for color), velocity (vx, vy)
    const data = new Float32Array(this.pointCount * 5);
    
    for (let i = 0; i < this.pointCount; i++) {
      const idx = i * 5;
      let x, y, value;
      
      switch (this.dataPattern) {
        case 'gaussian':
          // Multiple gaussian clusters
          const cluster = Math.floor(Math.random() * 5);
          const cx = (cluster % 3 - 1) * 0.5;
          const cy = (Math.floor(cluster / 3) - 0.5) * 0.5;
          x = cx + this.gaussianRandom() * 0.2;
          y = cy + this.gaussianRandom() * 0.2;
          value = cluster / 5;
          break;
          
        case 'spiral':
          const angle = Math.random() * Math.PI * 6;
          const radius = angle * 0.05 + Math.random() * 0.1;
          x = Math.cos(angle) * radius;
          y = Math.sin(angle) * radius;
          value = angle / (Math.PI * 6);
          break;
          
        case 'grid':
          const gridSize = Math.ceil(Math.sqrt(this.pointCount));
          const gx = (i % gridSize) / gridSize;
          const gy = Math.floor(i / gridSize) / gridSize;
          x = (gx - 0.5) * 1.8 + (Math.random() - 0.5) * 0.02;
          y = (gy - 0.5) * 1.8 + (Math.random() - 0.5) * 0.02;
          value = (gx + gy) / 2;
          break;
          
        default: // random
          x = (Math.random() - 0.5) * 2;
          y = (Math.random() - 0.5) * 2;
          value = Math.random();
      }
      
      data[idx] = x;
      data[idx + 1] = y;
      data[idx + 2] = value;
      data[idx + 3] = (Math.random() - 0.5) * 0.01; // vx
      data[idx + 4] = (Math.random() - 0.5) * 0.01; // vy
    }

    this.dataBuffer?.destroy();
    this.dataBuffer = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.dataBuffer, 0, data);
    this.bufferPointCount = this.pointCount; // Update actual buffer size
  }

  private gaussianRandom(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  private async initializePipeline(): Promise<void> {
    if (!this.context) return;

    const { device, format } = this.context;

    // Quad vertices for instanced rendering
    const quadVertices = new Float32Array([
      -1, -1,  1, -1,  1, 1,
      -1, -1,  1, 1,  -1, 1,
    ]);

    this.vertexBuffer = device.createBuffer({
      size: quadVertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.vertexBuffer, 0, quadVertices);

    this.generateDataPoints();

    this.uniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shaderModule = device.createShaderModule({
      label: 'Data Visualization',
      code: `
        struct Uniforms {
          time: f32,
          pointSize: f32,
          aspectRatio: f32,
          animSpeed: f32,
        }

        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        struct VertexInput {
          @location(0) quadPos: vec2f,
          @location(1) dataPos: vec2f,
          @location(2) value: f32,
          @location(3) velocity: vec2f,
        }

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) quadUV: vec2f,
          @location(1) value: f32,
        }

        @vertex
        fn vertexMain(input: VertexInput) -> VertexOutput {
          var output: VertexOutput;
          
          // Animate position
          let animatedPos = input.dataPos + input.velocity * sin(uniforms.time * uniforms.animSpeed + input.value * 10.0) * 5.0;
          
          // Scale quad by point size
          let size = uniforms.pointSize * 0.005;
          var scaledQuad = input.quadPos * size;
          scaledQuad.x /= uniforms.aspectRatio;
          
          output.position = vec4f(animatedPos + scaledQuad, 0.0, 1.0);
          output.quadUV = input.quadPos;
          output.value = input.value;
          
          return output;
        }

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
          // Circular point
          let dist = length(input.quadUV);
          if (dist > 1.0) {
            discard;
          }
          
          // Color based on value
          let hue = input.value * 0.8;
          let color = vec3f(
            sin(hue * 6.28318 + 0.0) * 0.5 + 0.5,
            sin(hue * 6.28318 + 2.094) * 0.5 + 0.5,
            sin(hue * 6.28318 + 4.188) * 0.5 + 0.5
          );
          
          // Soft edge
          let alpha = 1.0 - smoothstep(0.7, 1.0, dist);
          
          return vec4f(color * alpha, alpha);
        }
      `
    });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
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
            arrayStride: 8,
            stepMode: 'vertex',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }]
          },
          {
            arrayStride: 20,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, offset: 0, format: 'float32x2' },  // position
              { shaderLocation: 2, offset: 8, format: 'float32' },    // value
              { shaderLocation: 3, offset: 12, format: 'float32x2' }, // velocity
            ]
          }
        ]
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
          }
        }]
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
      if (!this.context || !this.pipeline || !this.dataBuffer) return;

      const { device, context, canvas } = this.context;
      const aspect = canvas.width / canvas.height;

      const uniforms = new Float32Array([
        time * 0.001,
        this.pointSize,
        aspect,
        this.animationSpeed
      ]);
      device.queue.writeBuffer(this.uniformBuffer!, 0, uniforms);

      const commandEncoder = device.createCommandEncoder();
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.02, b: 0.04, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }]
      });

      renderPass.setPipeline(this.pipeline);
      renderPass.setBindGroup(0, this.bindGroup!);
      renderPass.setVertexBuffer(0, this.vertexBuffer!);
      renderPass.setVertexBuffer(1, this.dataBuffer);
      renderPass.draw(6, this.bufferPointCount); // Use actual buffer size
      renderPass.end();

      device.queue.submit([commandEncoder.finish()]);
    };

    this.demoBase.startRenderLoop(render);
  }
}

