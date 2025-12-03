import { Component, ViewChild, AfterViewInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DemoBaseComponent } from '../../../components/shared/demo-base/demo-base.component';
import { WebGPUContext } from '../../../types/webgpu.types';

@Component({
  selector: 'app-game-of-life',
  standalone: true,
  imports: [CommonModule, FormsModule, DemoBaseComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="demo-page">
      <div class="demo-page__header">
        <h1><span class="icon">🧬</span> Conway's Game of Life</h1>
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
            The classic cellular automaton running entirely on the GPU. Each cell's 
            next state is computed in parallel using compute shaders.
          </p>
          
          <h3>Controls</h3>
          
          <div class="control-group">
            <label>Grid Size: {{ gridSize }}×{{ gridSize }}</label>
            <input 
              type="range" 
              min="64" 
              max="512" 
              step="64" 
              [(ngModel)]="gridSize"
              (change)="onGridSizeChange()"
            >
          </div>
          
          <div class="control-group">
            <label>Simulation Speed</label>
            <input 
              type="range" 
              min="1" 
              max="60" 
              step="1" 
              [(ngModel)]="simulationSpeed"
            >
          </div>

          <div class="control-group">
            <label>
              <input type="checkbox" [(ngModel)]="paused">
              Paused
            </label>
          </div>

          <div class="button-group">
            <button class="btn btn--primary" (click)="randomize()">
              Randomize
            </button>
            <button class="btn btn--secondary" (click)="clear()">
              Clear
            </button>
          </div>

          <div class="stats-panel">
            <div class="stats-panel__item">
              <span class="label">Cells</span>
              <span class="value">{{ (gridSize * gridSize).toLocaleString() }}</span>
            </div>
            <div class="stats-panel__item">
              <span class="label">Generation</span>
              <span class="value">{{ generation().toLocaleString() }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .button-group {
      display: flex;
      gap: 12px;
      margin-top: 16px;
    }
  `]
})
export class GameOfLifeComponent implements AfterViewInit {
  @ViewChild('demoBase') demoBase!: DemoBaseComponent;

  gridSize = 256;
  simulationSpeed = 15;
  paused = false;
  readonly generation = signal(0);

  private computePipeline: GPUComputePipeline | null = null;
  private renderPipeline: GPURenderPipeline | null = null;
  private cellBuffers: GPUBuffer[] = [];
  private uniformBuffer: GPUBuffer | null = null;
  private computeBindGroups: GPUBindGroup[] = [];
  private renderBindGroups: GPUBindGroup[] = [];
  private context: WebGPUContext | null = null;
  private step = 0;
  private lastUpdateTime = 0;

  ngAfterViewInit(): void {}

  async onContextReady(ctx: WebGPUContext): Promise<void> {
    this.context = ctx;
    await this.initializePipeline();
    this.startRendering();
  }

  onGridSizeChange(): void {
    this.generation.set(0);
    if (this.context) {
      this.initializePipeline();
    }
  }

  randomize(): void {
    this.generation.set(0);
    if (this.context) {
      this.initializePipeline();
    }
  }

  clear(): void {
    this.generation.set(0);
    if (this.context) {
      this.initializePipeline(true);
    }
  }

  private async initializePipeline(clear = false): Promise<void> {
    if (!this.context) return;

    const { device, format } = this.context;

    // Clean up old buffers
    this.cellBuffers.forEach(b => b.destroy());

    // Initialize cell data
    const cellData = new Uint32Array(this.gridSize * this.gridSize);
    if (!clear) {
      for (let i = 0; i < cellData.length; i++) {
        cellData[i] = Math.random() > 0.7 ? 1 : 0;
      }
    }

    // Double buffer for compute
    this.cellBuffers = [0, 1].map(() => {
      const buffer = device.createBuffer({
        size: cellData.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, cellData);
      return buffer;
    });

    this.uniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.uniformBuffer, 0, new Uint32Array([this.gridSize, this.gridSize]));

    // Compute shader
    const computeModule = device.createShaderModule({
      label: 'Game of Life Compute',
      code: `
        @group(0) @binding(0) var<storage, read> cellsIn: array<u32>;
        @group(0) @binding(1) var<storage, read_write> cellsOut: array<u32>;
        @group(0) @binding(2) var<uniform> grid: vec2u;

        fn getCell(x: i32, y: i32) -> u32 {
          let wx = (x + i32(grid.x)) % i32(grid.x);
          let wy = (y + i32(grid.y)) % i32(grid.y);
          return cellsIn[u32(wy) * grid.x + u32(wx)];
        }

        @compute @workgroup_size(8, 8)
        fn main(@builtin(global_invocation_id) id: vec3u) {
          if (id.x >= grid.x || id.y >= grid.y) {
            return;
          }

          let x = i32(id.x);
          let y = i32(id.y);
          
          // Count neighbors
          var neighbors = 0u;
          neighbors += getCell(x - 1, y - 1);
          neighbors += getCell(x, y - 1);
          neighbors += getCell(x + 1, y - 1);
          neighbors += getCell(x - 1, y);
          neighbors += getCell(x + 1, y);
          neighbors += getCell(x - 1, y + 1);
          neighbors += getCell(x, y + 1);
          neighbors += getCell(x + 1, y + 1);

          let idx = id.y * grid.x + id.x;
          let current = cellsIn[idx];

          // Conway's rules
          if (current == 1u && (neighbors < 2u || neighbors > 3u)) {
            cellsOut[idx] = 0u;
          } else if (current == 0u && neighbors == 3u) {
            cellsOut[idx] = 1u;
          } else {
            cellsOut[idx] = current;
          }
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
          { binding: 0, resource: { buffer: this.cellBuffers[0] } },
          { binding: 1, resource: { buffer: this.cellBuffers[1] } },
          { binding: 2, resource: { buffer: this.uniformBuffer } },
        ]
      }),
      device.createBindGroup({
        layout: computeBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.cellBuffers[1] } },
          { binding: 1, resource: { buffer: this.cellBuffers[0] } },
          { binding: 2, resource: { buffer: this.uniformBuffer } },
        ]
      })
    ];

    // Render shader
    const renderModule = device.createShaderModule({
      label: 'Game of Life Render',
      code: `
        @group(0) @binding(0) var<storage, read> cells: array<u32>;
        @group(0) @binding(1) var<uniform> grid: vec2u;

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
          let cellX = u32(input.uv.x * f32(grid.x));
          let cellY = u32((1.0 - input.uv.y) * f32(grid.y));
          let idx = cellY * grid.x + cellX;
          
          let alive = cells[idx];
          
          if (alive == 1u) {
            // Alive cell - gradient based on position
            let hue = (input.uv.x + input.uv.y) * 0.5;
            return vec4f(
              0.0 + hue * 0.3,
              0.8 + hue * 0.2,
              0.5 + (1.0 - hue) * 0.5,
              1.0
            );
          } else {
            // Dead cell - dark background
            return vec4f(0.03, 0.03, 0.05, 1.0);
          }
        }
      `
    });

    const renderBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ]
    });

    this.renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] }),
      vertex: { module: renderModule, entryPoint: 'vertexMain' },
      fragment: { module: renderModule, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' }
    });

    this.renderBindGroups = [
      device.createBindGroup({
        layout: renderBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.cellBuffers[0] } },
          { binding: 1, resource: { buffer: this.uniformBuffer } },
        ]
      }),
      device.createBindGroup({
        layout: renderBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.cellBuffers[1] } },
          { binding: 1, resource: { buffer: this.uniformBuffer } },
        ]
      })
    ];
  }

  private startRendering(): void {
    const render = (time: number) => {
      if (!this.context || !this.computePipeline || !this.renderPipeline) return;

      const { device, context } = this.context;
      const commandEncoder = device.createCommandEncoder();

      // Update simulation at controlled rate
      const updateInterval = 1000 / this.simulationSpeed;
      if (!this.paused && time - this.lastUpdateTime > updateInterval) {
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.computePipeline);
        computePass.setBindGroup(0, this.computeBindGroups[this.step % 2]);
        computePass.dispatchWorkgroups(
          Math.ceil(this.gridSize / 8),
          Math.ceil(this.gridSize / 8)
        );
        computePass.end();
        this.step++;
        this.generation.update(v => v + 1);
        this.lastUpdateTime = time;
      }

      // Render
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.02, b: 0.04, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }]
      });

      renderPass.setPipeline(this.renderPipeline);
      renderPass.setBindGroup(0, this.renderBindGroups[this.step % 2]);
      renderPass.draw(6);
      renderPass.end();

      device.queue.submit([commandEncoder.finish()]);
    };

    (this.demoBase as any).startRenderLoop(render);
  }
}

