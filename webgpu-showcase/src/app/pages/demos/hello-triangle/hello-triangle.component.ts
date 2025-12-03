import { Component, ViewChild, AfterViewInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DemoBaseComponent } from '../../../components/shared/demo-base/demo-base.component';
import { WebGPUContext } from '../../../types/webgpu.types';

@Component({
  selector: 'app-hello-triangle',
  standalone: true,
  imports: [CommonModule, DemoBaseComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hello-triangle.component.html',
  styleUrl: './hello-triangle.component.scss'
})
export class HelloTriangleComponent implements AfterViewInit {
  @ViewChild('demoBase') demoBase!: DemoBaseComponent;

  rotationSpeed = 1;
  scale = 1;

  private pipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private context: WebGPUContext | null = null;

  ngAfterViewInit(): void {
    // Initialization happens in onContextReady
  }

  async onContextReady(ctx: WebGPUContext): Promise<void> {
    this.context = ctx;
    await this.initializePipeline();
    this.startRendering();
  }

  private async initializePipeline(): Promise<void> {
    if (!this.context) return;

    const { device, format } = this.context;

    // Vertex data: position (x, y) and color (r, g, b)
    const vertices = new Float32Array([
      // Position     // Color
       0.0,  0.5,     1.0, 0.0, 0.5,  // Top (pink)
      -0.5, -0.5,     0.0, 1.0, 0.5,  // Bottom left (green)
       0.5, -0.5,     0.0, 0.5, 1.0,  // Bottom right (blue)
    ]);

    this.vertexBuffer = device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.vertexBuffer, 0, vertices);

    // Uniform buffer for time and scale
    this.uniformBuffer = device.createBuffer({
      size: 16, // time (f32) + scale (f32) + padding
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shaderModule = device.createShaderModule({
      label: 'Triangle Shader',
      code: `
        struct Uniforms {
          time: f32,
          scale: f32,
        }

        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        struct VertexInput {
          @location(0) position: vec2f,
          @location(1) color: vec3f,
        }

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) color: vec3f,
        }

        @vertex
        fn vertexMain(input: VertexInput) -> VertexOutput {
          var output: VertexOutput;
          
          let angle = uniforms.time;
          let c = cos(angle);
          let s = sin(angle);
          
          let rotated = vec2f(
            input.position.x * c - input.position.y * s,
            input.position.x * s + input.position.y * c
          );
          
          output.position = vec4f(rotated * uniforms.scale, 0.0, 1.0);
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

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout]
    });

    this.pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
        buffers: [{
          arrayStride: 20, // 2 floats position + 3 floats color = 5 floats * 4 bytes
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },  // position
            { shaderLocation: 1, offset: 8, format: 'float32x3' },  // color
          ]
        }]
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{ format }]
      },
      primitive: {
        topology: 'triangle-list'
      }
    });

    this.bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer: this.uniformBuffer }
      }]
    });
  }

  private startRendering(): void {
    if (!this.context || !this.pipeline || !this.bindGroup) return;

    const render = (time: number) => {
      if (!this.context || !this.pipeline || !this.vertexBuffer || !this.uniformBuffer || !this.bindGroup) return;

      const { device, context } = this.context;

      // Update uniforms
      const uniforms = new Float32Array([
        time * 0.001 * this.rotationSpeed,
        this.scale
      ]);
      device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

      const commandEncoder = device.createCommandEncoder();
      const textureView = context.getCurrentTexture().createView();

      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: textureView,
          clearValue: { r: 0.04, g: 0.04, b: 0.06, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store'
        }]
      });

      renderPass.setPipeline(this.pipeline);
      renderPass.setBindGroup(0, this.bindGroup);
      renderPass.setVertexBuffer(0, this.vertexBuffer);
      renderPass.draw(3);
      renderPass.end();

      device.queue.submit([commandEncoder.finish()]);
    };

    (this.demoBase as any).startRenderLoop(render);
  }

  onRotationSpeedChange(event: Event): void {
    this.rotationSpeed = parseFloat((event.target as HTMLInputElement).value);
  }

  onScaleChange(event: Event): void {
    this.scale = parseFloat((event.target as HTMLInputElement).value);
  }
}
