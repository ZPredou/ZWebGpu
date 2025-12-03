import { Component, ViewChild, AfterViewInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DemoBaseComponent } from '../../../components/shared/demo-base/demo-base.component';
import { WebGPUContext } from '../../../types/webgpu.types';

@Component({
  selector: 'app-fluid-simulation',
  standalone: true,
  imports: [CommonModule, FormsModule, DemoBaseComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './fluid-simulation.component.html',
  styleUrl: './fluid-simulation.component.scss'
})
export class FluidSimulationComponent implements AfterViewInit {
  @ViewChild('demoBase') demoBase!: DemoBaseComponent;

  gridSize = 128;
  viscosity = 0.01;
  diffusion = 0.0001;
  force = 5.0;
  colorIntensity = 1.0;
  showVelocity = false;

  private computePipeline: GPUComputePipeline | null = null;
  private renderPipeline: GPURenderPipeline | null = null;
  private velocityBuffers: GPUBuffer[] = [];
  private densityBuffers: GPUBuffer[] = [];
  private colorBuffers: GPUBuffer[] = [];
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroups: GPUBindGroup[] = [];
  private renderBindGroup: GPUBindGroup | null = null;
  private context: WebGPUContext | null = null;
  private step = 0;

  ngAfterViewInit(): void {}

  async onContextReady(ctx: WebGPUContext): Promise<void> {
    this.context = ctx;
    await this.initializePipeline();
    this.startRendering();
  }

  onGridSizeChange(): void {
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
    const size = this.gridSize * this.gridSize * 4; // RGBA

    // Clear all buffers
    this.velocityBuffers.forEach(b => b.destroy());
    this.densityBuffers.forEach(b => b.destroy());
    this.colorBuffers.forEach(b => b.destroy());

    this.velocityBuffers = [0, 1].map(() => {
      const buffer = device.createBuffer({
        size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, new Float32Array(this.gridSize * this.gridSize * 4));
      return buffer;
    });

    this.densityBuffers = [0, 1].map(() => {
      const buffer = device.createBuffer({
        size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, new Float32Array(this.gridSize * this.gridSize * 4));
      return buffer;
    });

    this.colorBuffers = [0, 1].map(() => {
      const buffer = device.createBuffer({
        size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
      device.queue.writeBuffer(buffer, 0, new Float32Array(this.gridSize * this.gridSize * 4));
      return buffer;
    });
  }

  private async initializePipeline(): Promise<void> {
    if (!this.context) return;

    const { device, format } = this.context;

    this.initializeBuffers();

    this.uniformBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Fluid simulation compute shader
    const computeModule = device.createShaderModule({
      label: 'Fluid Simulation',
      code: `
        struct Uniforms {
          gridSize: u32,
          viscosity: f32,
          diffusion: f32,
          force: f32,
          time: f32,
          deltaTime: f32,
        }

        @group(0) @binding(0) var<uniform> uniforms: Uniforms;
        @group(0) @binding(1) var<storage, read_write> velocityIn: array<vec4f>;
        @group(0) @binding(2) var<storage, read_write> velocityOut: array<vec4f>;
        @group(0) @binding(3) var<storage, read_write> densityIn: array<vec4f>;
        @group(0) @binding(4) var<storage, read_write> densityOut: array<vec4f>;
        @group(0) @binding(5) var<storage, read_write> colorIn: array<vec4f>;
        @group(0) @binding(6) var<storage, read_write> colorOut: array<vec4f>;

        fn getIndex(x: u32, y: u32) -> u32 {
          return y * uniforms.gridSize + x;
        }

        fn getValue(buffer: array<vec4f>, x: u32, y: u32) -> vec4f {
          let idx = getIndex(x, y);
          return buffer[idx];
        }

        fn setValue(buffer: array<vec4f>, x: u32, y: u32, value: vec4f) {
          let idx = getIndex(x, y);
          buffer[idx] = value;
        }

        @compute @workgroup_size(8, 8)
        fn main(@builtin(global_invocation_id) id: vec3u) {
          let x = id.x;
          let y = id.y;
          let gridSize = uniforms.gridSize;
          
          if (x >= gridSize || y >= gridSize) { return; }
          
          // Add force at mouse position (center for demo)
          let centerX = f32(gridSize) * 0.5;
          let centerY = f32(gridSize) * 0.5;
          let dx = f32(x) - centerX;
          let dy = f32(y) - centerY;
          let dist = sqrt(dx * dx + dy * dy);
          
          if (dist < 10.0) {
            let force = uniforms.force * (1.0 - dist / 10.0);
            let angle = uniforms.time * 2.0;
            let fx = cos(angle) * force;
            let fy = sin(angle) * force;
            
            let vel = getValue(velocityIn, x, y);
            vel.xy += vec2f(fx, fy) * uniforms.deltaTime;
            setValue(velocityOut, x, y, vel);
            
            // Add colored density
            let dens = getValue(densityIn, x, y);
            dens.w += 0.1 * uniforms.deltaTime;
            setValue(densityOut, x, y, dens);
            
            let col = getValue(colorIn, x, y);
            col.rgb = vec3f(0.2 + sin(uniforms.time) * 0.3, 0.4 + cos(uniforms.time * 0.7) * 0.3, 0.8);
            col.w = 1.0;
            setValue(colorOut, x, y, col);
          } else {
            // Advect velocity
            let vel = getValue(velocityIn, x, y);
            let prevX = f32(x) - vel.x * uniforms.deltaTime * f32(gridSize);
            let prevY = f32(y) - vel.y * uniforms.deltaTime * f32(gridSize);
            
            let px = u32(clamp(prevX, 0.0, f32(gridSize - 1)));
            let py = u32(clamp(prevY, 0.0, f32(gridSize - 1)));
            
            let advectedVel = getValue(velocityIn, px, py);
            vel = mix(vel, advectedVel, 0.9);
            
            // Viscosity
            let neighbors = (
              getValue(velocityIn, x, y) +
              getValue(velocityIn, max(0u, x - 1u), y) +
              getValue(velocityIn, min(gridSize - 1u, x + 1u), y) +
              getValue(velocityIn, x, max(0u, y - 1u)) +
              getValue(velocityIn, x, min(gridSize - 1u, y + 1u))
            ) / 5.0;
            
            vel = mix(vel, neighbors, uniforms.viscosity);
            setValue(velocityOut, x, y, vel);
            
            // Advect density
            let dens = getValue(densityIn, x, y);
            let advectedDens = getValue(densityIn, px, py);
            dens = mix(dens, advectedDens, 0.95);
            dens.w *= 0.99; // Decay
            setValue(densityOut, x, y, dens);
            
            // Advect color
            let col = getValue(colorIn, x, y);
            let advectedCol = getValue(colorIn, px, py);
            col = mix(col, advectedCol, 0.95);
            col.w *= 0.99;
            setValue(colorOut, x, y, col);
          }
        }
      `
    });

    const computeBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ]
    });

    this.computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [computeBindGroupLayout] }),
      compute: { module: computeModule, entryPoint: 'main' }
    });

    if (!this.uniformBuffer) {
      throw new Error('Uniform buffer not initialized');
    }

    this.bindGroups = [0, 1].map(i => {
      const velBuf1 = this.velocityBuffers[i];
      const velBuf2 = this.velocityBuffers[1 - i];
      const densBuf1 = this.densityBuffers[i];
      const densBuf2 = this.densityBuffers[1 - i];
      const colBuf1 = this.colorBuffers[i];
      const colBuf2 = this.colorBuffers[1 - i];
      
      if (!velBuf1 || !velBuf2 || !densBuf1 || !densBuf2 || !colBuf1 || !colBuf2) {
        throw new Error('Buffers not initialized');
      }
      
      return device.createBindGroup({
        layout: computeBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer! } },
          { binding: 1, resource: { buffer: velBuf1 } },
          { binding: 2, resource: { buffer: velBuf2 } },
          { binding: 3, resource: { buffer: densBuf1 } },
          { binding: 4, resource: { buffer: densBuf2 } },
          { binding: 5, resource: { buffer: colBuf1 } },
          { binding: 6, resource: { buffer: colBuf2 } },
        ]
      });
    });

    // Render shader
    const renderModule = device.createShaderModule({
      label: 'Fluid Render',
      code: `
        struct Uniforms {
          gridSize: u32,
          colorIntensity: f32,
          showVelocity: u32,
        }

        @group(0) @binding(0) var<uniform> uniforms: Uniforms;
        @group(0) @binding(1) var<storage, read> density: array<vec4f>;
        @group(0) @binding(2) var<storage, read> velocity: array<vec4f>;
        @group(0) @binding(3) var<storage, read> color: array<vec4f>;

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
          let uv = input.uv;
          let x = u32(uv.x * f32(uniforms.gridSize));
          let y = u32(uv.y * f32(uniforms.gridSize));
          let idx = y * uniforms.gridSize + x;
          
          if (uniforms.showVelocity == 1u) {
            let vel = velocity[idx];
            let speed = length(vel.xy);
            let angle = atan2(vel.y, vel.x);
            let hue = (angle + 3.14159) / (2.0 * 3.14159);
            let color = vec3f(
              sin(hue * 6.28318 + 0.0) * 0.5 + 0.5,
              sin(hue * 6.28318 + 2.094) * 0.5 + 0.5,
              sin(hue * 6.28318 + 4.188) * 0.5 + 0.5
            );
            return vec4f(color * speed * 2.0, 1.0);
          } else {
            let dens = density[idx];
            let col = color[idx];
            let finalColor = col.rgb * dens.w * uniforms.colorIntensity;
            return vec4f(finalColor, 1.0);
          }
        }
      `
    });

    const renderBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ]
    });

    this.renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] }),
      vertex: { module: renderModule, entryPoint: 'vertexMain' },
      fragment: { module: renderModule, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' }
    });

    const densBuf = this.densityBuffers[this.step % 2];
    const velBuf = this.velocityBuffers[this.step % 2];
    const colBuf = this.colorBuffers[this.step % 2];
    
    if (!densBuf || !velBuf || !colBuf) {
      throw new Error('Buffers not initialized for render');
    }
    
    this.renderBindGroup = device.createBindGroup({
      layout: renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer! } },
        { binding: 1, resource: { buffer: densBuf } },
        { binding: 2, resource: { buffer: velBuf } },
        { binding: 3, resource: { buffer: colBuf } },
      ]
    });
  }

  private startRendering(): void {
    const render = (time: number, deltaTime: number) => {
      if (!this.context || !this.computePipeline || !this.renderPipeline) return;

      const { device, context } = this.context;

      const uniforms = new ArrayBuffer(64);
      const floatView = new Float32Array(uniforms);
      const uintView = new Uint32Array(uniforms);
      
      floatView[0] = this.gridSize;
      floatView[1] = this.viscosity;
      floatView[2] = this.diffusion;
      floatView[3] = this.force;
      floatView[4] = time * 0.001;
      floatView[5] = Math.min(deltaTime * 0.001, 0.02);
      device.queue.writeBuffer(this.uniformBuffer!, 0, uniforms);

      const commandEncoder = device.createCommandEncoder();

      // Compute pass
      const computePass = commandEncoder.beginComputePass();
      computePass.setPipeline(this.computePipeline);
      computePass.setBindGroup(0, this.bindGroups[this.step % 2]);
      computePass.dispatchWorkgroups(
        Math.ceil(this.gridSize / 8),
        Math.ceil(this.gridSize / 8)
      );
      computePass.end();

      // Render pass
      const renderUniforms = new ArrayBuffer(32);
      const renderFloatView = new Float32Array(renderUniforms);
      const renderUintView = new Uint32Array(renderUniforms);
      renderUintView[0] = this.gridSize;
      renderFloatView[1] = this.colorIntensity;
      renderUintView[2] = this.showVelocity ? 1 : 0;

      const renderUniformBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(renderUniformBuffer, 0, renderUniforms);

      const densBuf = this.densityBuffers[(this.step + 1) % 2];
      const velBuf = this.velocityBuffers[(this.step + 1) % 2];
      const colBuf = this.colorBuffers[(this.step + 1) % 2];
      
      if (!densBuf || !velBuf || !colBuf) {
        return; // Skip frame if buffers not ready
      }
      
      const renderBindGroup = device.createBindGroup({
        layout: this.renderPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: renderUniformBuffer } },
          { binding: 1, resource: { buffer: densBuf } },
          { binding: 2, resource: { buffer: velBuf } },
          { binding: 3, resource: { buffer: colBuf } },
        ]
      });

      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.05, g: 0.05, b: 0.1, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }]
      });

      renderPass.setPipeline(this.renderPipeline);
      renderPass.setBindGroup(0, renderBindGroup);
      renderPass.draw(6);
      renderPass.end();

      device.queue.submit([commandEncoder.finish()]);
      this.step++;
    };

    this.demoBase.startRenderLoop(render);
  }
}

