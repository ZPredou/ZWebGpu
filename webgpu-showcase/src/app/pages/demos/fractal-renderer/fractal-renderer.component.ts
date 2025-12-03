import { Component, ViewChild, AfterViewInit, HostListener, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DemoBaseComponent } from '../../../components/shared/demo-base/demo-base.component';
import { WebGPUContext } from '../../../types/webgpu.types';

@Component({
  selector: 'app-fractal-renderer',
  standalone: true,
  imports: [CommonModule, FormsModule, DemoBaseComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './fractal-renderer.component.html',
  styleUrl: './fractal-renderer.component.scss'
})
export class FractalRendererComponent implements AfterViewInit {
  @ViewChild('demoBase') demoBase!: DemoBaseComponent;

  fractalType = 'mandelbrot';
  maxIterations = 200;
  colorScheme = '0';
  juliaC = [-0.7, 0.27015];
  
  zoom = 1;
  centerX = -0.5;
  centerY = 0;

  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private context: WebGPUContext | null = null;
  
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  ngAfterViewInit(): void {}

  async onContextReady(ctx: WebGPUContext): Promise<void> {
    this.context = ctx;
    await this.initializePipeline();
    this.startRendering();
  }

  onFractalChange(): void {
    this.resetView();
  }

  resetView(): void {
    this.zoom = 1;
    this.centerX = this.fractalType === 'mandelbrot' ? -0.5 : 0;
    this.centerY = 0;
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
    this.zoom *= zoomFactor;
  }

  onMouseDown(event: MouseEvent): void {
    this.isDragging = true;
    this.lastMouseX = event.clientX;
    this.lastMouseY = event.clientY;
  }

  @HostListener('window:mouseup')
  onMouseUp(): void {
    this.isDragging = false;
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    if (!this.isDragging || !this.context) return;

    const dx = event.clientX - this.lastMouseX;
    const dy = event.clientY - this.lastMouseY;
    
    const scale = 3.0 / this.zoom / this.context.canvas.width;
    this.centerX -= dx * scale;
    this.centerY += dy * scale;
    
    this.lastMouseX = event.clientX;
    this.lastMouseY = event.clientY;
  }

  private getFractalCode(): string {
    const fractals: Record<string, string> = {
      mandelbrot: `
        fn fractal(c: vec2f, maxIter: i32) -> f32 {
          var z = vec2f(0.0);
          var i = 0;
          for (; i < maxIter; i++) {
            if (dot(z, z) > 4.0) { break; }
            z = vec2f(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
          }
          if (i == maxIter) { return 0.0; }
          let smooth_i = f32(i) - log2(log2(dot(z, z)));
          return smooth_i / f32(maxIter);
        }
      `,
      julia: `
        fn fractal(z_in: vec2f, maxIter: i32) -> f32 {
          var z = z_in;
          let c = uniforms.juliaC;
          var i = 0;
          for (; i < maxIter; i++) {
            if (dot(z, z) > 4.0) { break; }
            z = vec2f(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
          }
          if (i == maxIter) { return 0.0; }
          let smooth_i = f32(i) - log2(log2(dot(z, z)));
          return smooth_i / f32(maxIter);
        }
      `,
      burning_ship: `
        fn fractal(c: vec2f, maxIter: i32) -> f32 {
          var z = vec2f(0.0);
          var i = 0;
          for (; i < maxIter; i++) {
            if (dot(z, z) > 4.0) { break; }
            z = abs(z);
            z = vec2f(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
          }
          if (i == maxIter) { return 0.0; }
          let smooth_i = f32(i) - log2(log2(dot(z, z)));
          return smooth_i / f32(maxIter);
        }
      `,
    };
    return fractals[this.fractalType] || fractals['mandelbrot'];
  }

  private async initializePipeline(): Promise<void> {
    if (!this.context) return;

    const { device, format } = this.context;

    this.uniformBuffer = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shaderModule = device.createShaderModule({
      label: 'Fractal Renderer',
      code: `
        struct Uniforms {
          center: vec2f,
          zoom: f32,
          aspectRatio: f32,
          maxIterations: i32,
          colorScheme: i32,
          juliaC: vec2f,
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
          output.uv = pos[idx];
          return output;
        }

        ${this.getFractalCode()}

        fn colorize(t: f32, scheme: i32) -> vec3f {
          if (t == 0.0) { return vec3f(0.0); }
          
          var color: vec3f;
          
          if (scheme == 0) {
            // Classic blue-white
            color = vec3f(t * 0.5, t * 0.8, t);
          } else if (scheme == 1) {
            // Fire
            color = vec3f(
              min(1.0, t * 3.0),
              max(0.0, t * 2.0 - 0.5),
              max(0.0, t - 0.75) * 4.0
            );
          } else if (scheme == 2) {
            // Ice
            color = vec3f(
              max(0.0, t - 0.5) * 2.0,
              t * 0.8,
              min(1.0, t * 1.5)
            );
          } else {
            // Rainbow
            color = vec3f(
              sin(t * 6.28318 + 0.0) * 0.5 + 0.5,
              sin(t * 6.28318 + 2.094) * 0.5 + 0.5,
              sin(t * 6.28318 + 4.188) * 0.5 + 0.5
            );
          }
          
          return color;
        }

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
          let c = uniforms.center + input.uv * vec2f(uniforms.aspectRatio, 1.0) * 1.5 / uniforms.zoom;
          let t = fractal(c, uniforms.maxIterations);
          let color = colorize(t, uniforms.colorScheme);
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
    const render = () => {
      if (!this.context || !this.pipeline) return;

      const { device, context, canvas } = this.context;
      const aspect = canvas.width / canvas.height;

      const uniforms = new ArrayBuffer(48);
      const floatView = new Float32Array(uniforms);
      const intView = new Int32Array(uniforms);
      
      floatView[0] = this.centerX;
      floatView[1] = this.centerY;
      floatView[2] = this.zoom;
      floatView[3] = aspect;
      intView[4] = this.maxIterations;
      intView[5] = parseInt(this.colorScheme);
      floatView[6] = this.juliaC[0];
      floatView[7] = this.juliaC[1];
      
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

