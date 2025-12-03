import { Component, ViewChild, AfterViewInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DemoBaseComponent } from '../../../components/shared/demo-base/demo-base.component';
import { WebGPUContext } from '../../../types/webgpu.types';

@Component({
  selector: 'app-neural-network',
  standalone: true,
  imports: [CommonModule, FormsModule, DemoBaseComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './neural-network.component.html',
  styleUrl: './neural-network.component.scss'
})
export class NeuralNetworkComponent implements AfterViewInit {
  @ViewChild('demoBase') demoBase!: DemoBaseComponent;

  hiddenSize = 16;
  pattern = 'circle';
  learningRate = 0.01;
  isTraining = true;
  readonly epoch = signal(0);
  readonly loss = signal(1);

  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private weightsBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private context: WebGPUContext | null = null;
  
  // Network weights (CPU side for simplicity)
  private weights1: Float32Array = new Float32Array(0);
  private bias1: Float32Array = new Float32Array(0);
  private weights2: Float32Array = new Float32Array(0);
  private bias2: Float32Array = new Float32Array(0);

  ngAfterViewInit(): void {}

  async onContextReady(ctx: WebGPUContext): Promise<void> {
    this.context = ctx;
    this.initializeWeights();
    await this.initializePipeline();
    this.startRendering();
  }

  onNetworkChange(): void {
    this.initializeWeights();
    this.epoch.set(0);
    this.loss.set(1);
    if (this.context) {
      this.initializePipeline();
    }
  }

  onPatternChange(): void {
    this.initializeWeights();
    this.epoch.set(0);
    this.loss.set(1);
  }

  resetNetwork(): void {
    this.initializeWeights();
    this.epoch.set(0);
    this.loss.set(1);
  }

  private initializeWeights(): void {
    const inputSize = 2;
    const outputSize = 1;
    
    // Xavier initialization
    const scale1 = Math.sqrt(2.0 / inputSize);
    const scale2 = Math.sqrt(2.0 / this.hiddenSize);
    
    this.weights1 = new Float32Array(inputSize * this.hiddenSize);
    this.bias1 = new Float32Array(this.hiddenSize);
    this.weights2 = new Float32Array(this.hiddenSize * outputSize);
    this.bias2 = new Float32Array(outputSize);
    
    for (let i = 0; i < this.weights1.length; i++) {
      this.weights1[i] = (Math.random() - 0.5) * 2 * scale1;
    }
    for (let i = 0; i < this.weights2.length; i++) {
      this.weights2[i] = (Math.random() - 0.5) * 2 * scale2;
    }
  }

  private getPatternFunction(): string {
    const patterns: Record<string, string> = {
      circle: `
        fn getTarget(p: vec2f) -> f32 {
          return select(0.0, 1.0, length(p) < 0.5);
        }
      `,
      xor: `
        fn getTarget(p: vec2f) -> f32 {
          let a = p.x > 0.0;
          let b = p.y > 0.0;
          return select(0.0, 1.0, a != b);
        }
      `,
      spiral: `
        fn getTarget(p: vec2f) -> f32 {
          let angle = atan2(p.y, p.x);
          let dist = length(p);
          let spiral = sin(angle * 2.0 + dist * 10.0);
          return select(0.0, 1.0, spiral > 0.0);
        }
      `,
      gaussian: `
        fn getTarget(p: vec2f) -> f32 {
          let d1 = length(p - vec2f(-0.4, 0.3));
          let d2 = length(p - vec2f(0.4, -0.3));
          return select(0.0, 1.0, d1 < 0.35 || d2 < 0.35);
        }
      `,
    };
    return patterns[this.pattern] || patterns['circle'];
  }

  private async initializePipeline(): Promise<void> {
    if (!this.context) return;

    const { device, format } = this.context;

    // Create weights buffer (pack all weights together)
    const totalWeights = this.weights1.length + this.bias1.length + 
                        this.weights2.length + this.bias2.length;
    
    this.weightsBuffer = device.createBuffer({
      size: totalWeights * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.updateWeightsBuffer();

    this.uniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shaderModule = device.createShaderModule({
      label: 'Neural Network',
      code: `
        struct Uniforms {
          time: f32,
          hiddenSize: u32,
          showTarget: u32,
          padding: u32,
        }

        @group(0) @binding(0) var<uniform> uniforms: Uniforms;
        @group(0) @binding(1) var<storage, read> weights: array<f32>;

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

        fn relu(x: f32) -> f32 {
          return max(0.0, x);
        }

        fn sigmoid(x: f32) -> f32 {
          return 1.0 / (1.0 + exp(-x));
        }

        fn forward(input: vec2f) -> f32 {
          let hiddenSize = uniforms.hiddenSize;
          
          // First layer: input (2) -> hidden
          var hidden = array<f32, 32>();
          let w1Offset = 0u;
          let b1Offset = 2u * hiddenSize;
          
          for (var i = 0u; i < hiddenSize; i++) {
            var sum = weights[b1Offset + i];
            sum += input.x * weights[w1Offset + i];
            sum += input.y * weights[w1Offset + hiddenSize + i];
            hidden[i] = relu(sum);
          }
          
          // Second layer: hidden -> output (1)
          let w2Offset = b1Offset + hiddenSize;
          let b2Offset = w2Offset + hiddenSize;
          
          var output = weights[b2Offset];
          for (var i = 0u; i < hiddenSize; i++) {
            output += hidden[i] * weights[w2Offset + i];
          }
          
          return sigmoid(output);
        }

        ${this.getPatternFunction()}

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
          let p = input.uv;
          
          // Network prediction
          let prediction = forward(p);
          
          // Expected value
          let expected = getTarget(p);
          
          // Visualize prediction as color
          let predColor = vec3f(
            prediction * 0.2 + 0.1,
            prediction * 0.8 + 0.1,
            prediction * 0.5 + 0.2
          );
          
          let bgColor = vec3f(
            (1.0 - prediction) * 0.6 + 0.1,
            (1.0 - prediction) * 0.2 + 0.05,
            (1.0 - prediction) * 0.3 + 0.1
          );
          
          var color = mix(bgColor, predColor, prediction);
          
          // Add expected boundary
          let expectedGrad = fwidth(expected) * 50.0;
          if (abs(expected - 0.5) < expectedGrad) {
            color = mix(color, vec3f(1.0, 1.0, 1.0), 0.5);
          }
          
          return vec4f(color, 1.0);
        }
      `
    });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ]
    });

    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: { module: shaderModule, entryPoint: 'vertexMain' },
      fragment: { module: shaderModule, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' }
    });

    this.bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.weightsBuffer } },
      ]
    });
  }

  private updateWeightsBuffer(): void {
    if (!this.context || !this.weightsBuffer) return;
    
    const { device } = this.context;
    const allWeights = new Float32Array([
      ...this.weights1,
      ...this.bias1,
      ...this.weights2,
      ...this.bias2
    ]);
    device.queue.writeBuffer(this.weightsBuffer, 0, allWeights);
  }

  private trainStep(): void {
    if (!this.isTraining) return;

    const batchSize = 32;
    let totalLoss = 0;

    for (let b = 0; b < batchSize; b++) {
      // Random training point
      const x = Math.random() * 2 - 1;
      const y = Math.random() * 2 - 1;
      
      // Get target
      let target: number;
      switch (this.pattern) {
        case 'circle':
          target = Math.sqrt(x * x + y * y) < 0.5 ? 1 : 0;
          break;
        case 'xor':
          target = (x > 0) !== (y > 0) ? 1 : 0;
          break;
        case 'spiral':
          const angle = Math.atan2(y, x);
          const dist = Math.sqrt(x * x + y * y);
          target = Math.sin(angle * 2 + dist * 10) > 0 ? 1 : 0;
          break;
        case 'gaussian':
          const d1 = Math.sqrt((x + 0.4) ** 2 + (y - 0.3) ** 2);
          const d2 = Math.sqrt((x - 0.4) ** 2 + (y + 0.3) ** 2);
          target = d1 < 0.35 || d2 < 0.35 ? 1 : 0;
          break;
        default:
          target = 0;
      }

      // Forward pass
      const hidden = new Float32Array(this.hiddenSize);
      for (let i = 0; i < this.hiddenSize; i++) {
        let sum = this.bias1[i];
        sum += x * this.weights1[i];
        sum += y * this.weights1[this.hiddenSize + i];
        hidden[i] = Math.max(0, sum); // ReLU
      }

      let output = this.bias2[0];
      for (let i = 0; i < this.hiddenSize; i++) {
        output += hidden[i] * this.weights2[i];
      }
      const prediction = 1 / (1 + Math.exp(-output)); // Sigmoid

      // Loss
      const loss = -(target * Math.log(prediction + 1e-7) + (1 - target) * Math.log(1 - prediction + 1e-7));
      totalLoss += loss;

      // Backpropagation
      const dOutput = prediction - target;
      
      // Gradients for layer 2
      for (let i = 0; i < this.hiddenSize; i++) {
        this.weights2[i] -= this.learningRate * dOutput * hidden[i];
      }
      this.bias2[0] -= this.learningRate * dOutput;

      // Gradients for layer 1
      for (let i = 0; i < this.hiddenSize; i++) {
        if (hidden[i] > 0) { // ReLU derivative
          const dHidden = dOutput * this.weights2[i];
          this.weights1[i] -= this.learningRate * dHidden * x;
          this.weights1[this.hiddenSize + i] -= this.learningRate * dHidden * y;
          this.bias1[i] -= this.learningRate * dHidden;
        }
      }
    }

    this.loss.set(totalLoss / batchSize);
    this.epoch.update(v => v + 1);
    this.updateWeightsBuffer();
  }

  private startRendering(): void {
    const render = (time: number) => {
      if (!this.context || !this.pipeline) return;

      // Train for several steps per frame
      for (let i = 0; i < 10; i++) {
        this.trainStep();
      }

      const { device, context } = this.context;

      const uniforms = new ArrayBuffer(32);
      new Float32Array(uniforms, 0, 1).set([time * 0.001]);
      new Uint32Array(uniforms, 4, 1).set([this.hiddenSize]);
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
      renderPass.draw(6);
      renderPass.end();

      device.queue.submit([commandEncoder.finish()]);
    };

    this.demoBase.startRenderLoop(render);
  }
}

