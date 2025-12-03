import { Component, ViewChild, AfterViewInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DemoBaseComponent } from '../../../components/shared/demo-base/demo-base.component';
import { WebGPUContext } from '../../../types/webgpu.types';

@Component({
  selector: 'app-matrix-multiplication',
  standalone: true,
  imports: [CommonModule, FormsModule, DemoBaseComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './matrix-multiplication.component.html',
  styleUrl: './matrix-multiplication.component.scss'
})
export class MatrixMultiplicationComponent implements AfterViewInit {
  @ViewChild('demoBase') demoBase!: DemoBaseComponent;

  matrixSize = 512;
  benchmarkResult: { gpuTime: number; operations: number; gflops: number } | null = null;

  private computePipeline: GPUComputePipeline | null = null;
  private renderPipeline: GPURenderPipeline | null = null;
  private matrixABuffer: GPUBuffer | null = null;
  private matrixBBuffer: GPUBuffer | null = null;
  private matrixCBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private computeBindGroup: GPUBindGroup | null = null;
  private renderBindGroup: GPUBindGroup | null = null;
  private context: WebGPUContext | null = null;

  ngAfterViewInit(): void {}

  formatOps(ops: number): string {
    if (ops >= 1e9) return (ops / 1e9).toFixed(2) + 'B';
    if (ops >= 1e6) return (ops / 1e6).toFixed(2) + 'M';
    return ops.toLocaleString();
  }

  async onContextReady(ctx: WebGPUContext): Promise<void> {
    this.context = ctx;
    await this.initializePipeline();
    this.startRendering();
  }

  async runBenchmark(): Promise<void> {
    if (!this.context || !this.computePipeline) return;

    const { device } = this.context;
    const n = this.matrixSize;

    // Create matrices with random data
    const matrixA = new Float32Array(n * n);
    const matrixB = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) {
      matrixA[i] = Math.random();
      matrixB[i] = Math.random();
    }

    // Create buffers
    this.matrixABuffer?.destroy();
    this.matrixBBuffer?.destroy();
    this.matrixCBuffer?.destroy();

    this.matrixABuffer = device.createBuffer({
      size: matrixA.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.matrixABuffer, 0, matrixA);

    this.matrixBBuffer = device.createBuffer({
      size: matrixB.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.matrixBBuffer, 0, matrixB);

    this.matrixCBuffer = device.createBuffer({
      size: n * n * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    this.uniformBuffer?.destroy();
    this.uniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.uniformBuffer, 0, new Uint32Array([n, n, n, 0]));

    // Create bind group
    const bindGroupLayout = this.computePipeline.getBindGroupLayout(0);
    this.computeBindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.matrixABuffer } },
        { binding: 1, resource: { buffer: this.matrixBBuffer } },
        { binding: 2, resource: { buffer: this.matrixCBuffer } },
        { binding: 3, resource: { buffer: this.uniformBuffer } },
      ]
    });

    // Run benchmark
    const iterations = 10;
    const startTime = performance.now();

    for (let i = 0; i < iterations; i++) {
      const commandEncoder = device.createCommandEncoder();
      const computePass = commandEncoder.beginComputePass();
      computePass.setPipeline(this.computePipeline);
      computePass.setBindGroup(0, this.computeBindGroup);
      computePass.dispatchWorkgroups(Math.ceil(n / 16), Math.ceil(n / 16));
      computePass.end();
      device.queue.submit([commandEncoder.finish()]);
    }

    await device.queue.onSubmittedWorkDone();
    const endTime = performance.now();

    const gpuTime = (endTime - startTime) / iterations;
    const operations = 2 * n * n * n; // 2n³ operations for matrix multiply
    const gflops = (operations / gpuTime / 1e6);

    this.benchmarkResult = { gpuTime, operations, gflops };

    // Update render with result matrix
    this.updateRenderBindGroup();
  }

  private async initializePipeline(): Promise<void> {
    if (!this.context) return;

    const { device, format } = this.context;

    // Compute shader
    const computeModule = device.createShaderModule({
      label: 'Matrix Multiply',
      code: `
        struct Uniforms {
          M: u32,
          N: u32,
          K: u32,
          padding: u32,
        }

        @group(0) @binding(0) var<storage, read> matrixA: array<f32>;
        @group(0) @binding(1) var<storage, read> matrixB: array<f32>;
        @group(0) @binding(2) var<storage, read_write> matrixC: array<f32>;
        @group(0) @binding(3) var<uniform> uniforms: Uniforms;

        @compute @workgroup_size(16, 16)
        fn main(@builtin(global_invocation_id) id: vec3u) {
          let row = id.y;
          let col = id.x;
          
          if (row >= uniforms.M || col >= uniforms.N) { return; }
          
          var sum = 0.0;
          for (var k = 0u; k < uniforms.K; k++) {
            sum += matrixA[row * uniforms.K + k] * matrixB[k * uniforms.N + col];
          }
          
          matrixC[row * uniforms.N + col] = sum;
        }
      `
    });

    this.computePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: computeModule, entryPoint: 'main' }
    });

    // Render shader to visualize result
    const renderModule = device.createShaderModule({
      label: 'Matrix Visualize',
      code: `
        @group(0) @binding(0) var<storage, read> matrix: array<f32>;
        @group(0) @binding(1) var<uniform> size: vec2u;

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

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
          let x = u32(input.uv.x * f32(size.x));
          let y = u32((1.0 - input.uv.y) * f32(size.y));
          let idx = y * size.x + x;
          
          if (idx >= arrayLength(&matrix)) {
            return vec4f(0.1, 0.1, 0.15, 1.0);
          }
          
          let value = matrix[idx];
          let normalized = clamp(value / f32(size.x), 0.0, 1.0);
          
          // Heat map coloring
          let color = vec3f(
            smoothstep(0.5, 1.0, normalized),
            smoothstep(0.0, 0.5, normalized) * (1.0 - smoothstep(0.5, 1.0, normalized)),
            1.0 - smoothstep(0.0, 0.5, normalized)
          );
          
          return vec4f(color, 1.0);
        }
      `
    });

    this.renderPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'vertexMain' },
      fragment: { module: renderModule, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' }
    });

    // Initialize with a small default matrix
    await this.runBenchmark();
  }

  private updateRenderBindGroup(): void {
    if (!this.context || !this.renderPipeline || !this.matrixCBuffer) return;

    const { device } = this.context;

    const sizeBuffer = device.createBuffer({
      size: 8,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(sizeBuffer, 0, new Uint32Array([this.matrixSize, this.matrixSize]));

    this.renderBindGroup = device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.matrixCBuffer } },
        { binding: 1, resource: { buffer: sizeBuffer } },
      ]
    });
  }

  private startRendering(): void {
    const render = () => {
      if (!this.context || !this.renderPipeline || !this.renderBindGroup) return;

      const { device, context } = this.context;

      const commandEncoder = device.createCommandEncoder();
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.02, b: 0.04, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }]
      });

      renderPass.setPipeline(this.renderPipeline);
      renderPass.setBindGroup(0, this.renderBindGroup);
      renderPass.draw(6);
      renderPass.end();

      device.queue.submit([commandEncoder.finish()]);
    };

    (this.demoBase as any).startRenderLoop(render);
  }
}

