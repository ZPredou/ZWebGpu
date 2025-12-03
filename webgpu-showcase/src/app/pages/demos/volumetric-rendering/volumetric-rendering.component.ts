import { Component, ViewChild, AfterViewInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DemoBaseComponent } from '../../../components/shared/demo-base/demo-base.component';
import { WebGPUContext } from '../../../types/webgpu.types';

@Component({
  selector: 'app-volumetric-rendering',
  standalone: true,
  imports: [CommonModule, FormsModule, DemoBaseComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './volumetric-rendering.component.html',
  styleUrl: './volumetric-rendering.component.scss'
})
export class VolumetricRenderingComponent implements AfterViewInit {
  @ViewChild('demoBase') demoBase!: DemoBaseComponent;

  density = 0.5;
  lightIntensity = 2.0;
  windSpeed = 0.5;
  cloudType = 'cumulus';
  animationSpeed = 1.0;

  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private context: WebGPUContext | null = null;

  ngAfterViewInit(): void {}

  async onContextReady(ctx: WebGPUContext): Promise<void> {
    this.context = ctx;
    await this.initializePipeline();
    this.startRendering();
  }

  private async initializePipeline(): Promise<void> {
    if (!this.context) return;

    const { device, format } = this.context;

    this.uniformBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shaderModule = device.createShaderModule({
      label: 'Volumetric Rendering',
      code: `
        struct Uniforms {
          time: f32,
          density: f32,
          lightIntensity: f32,
          windSpeed: f32,
          cloudType: u32,
          animationSpeed: f32,
          aspectRatio: f32,
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

        fn hash(p: vec3f) -> f32 {
          var p3 = fract(p * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        fn noise(p: vec3f) -> f32 {
          let i = floor(p);
          let f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          
          let n = i.x + i.y * 57.0 + 113.0 * i.z;
          return mix(
            mix(mix(hash(vec3f(n + 0.0)), hash(vec3f(n + 1.0)), f.x),
                mix(hash(vec3f(n + 57.0)), hash(vec3f(n + 58.0)), f.x), f.y),
            mix(mix(hash(vec3f(n + 113.0)), hash(vec3f(n + 114.0)), f.x),
                mix(hash(vec3f(n + 170.0)), hash(vec3f(n + 171.0)), f.x), f.y), f.z);
        }

        fn fbm(p: vec3f, octaves: u32) -> f32 {
          var value = 0.0;
          var amplitude = 0.5;
          var frequency = 1.0;
          
          for (var i = 0u; i < octaves; i++) {
            value += amplitude * noise(p * frequency);
            frequency *= 2.0;
            amplitude *= 0.5;
          }
          
          return value;
        }

        fn cloudDensity(p: vec3f, cloudType: u32) -> f32 {
          var density = 0.0;
          
          if (cloudType == 0u) {
            // Cumulus - fluffy clouds
            let p1 = p * vec3f(0.8, 0.4, 0.8) + vec3f(0.0, uniforms.time * uniforms.windSpeed * 0.1, 0.0);
            density = fbm(p1, 4u);
            density = smoothstep(0.3, 0.7, density);
            density *= smoothstep(2.0, 0.5, length(p.xz));
          } else if (cloudType == 1u) {
            // Stratus - layered clouds
            let p1 = p * vec3f(1.0, 0.3, 1.0) + vec3f(0.0, uniforms.time * uniforms.windSpeed * 0.05, 0.0);
            density = fbm(p1, 3u);
            density = smoothstep(0.2, 0.6, density);
            density *= smoothstep(3.0, 1.0, abs(p.y));
          } else {
            // Cirrus - wispy clouds
            let p1 = p * vec3f(0.5, 1.5, 0.5) + vec3f(0.0, uniforms.time * uniforms.windSpeed * 0.2, 0.0);
            density = fbm(p1, 5u);
            density = smoothstep(0.5, 0.9, density);
            density *= 0.3;
          }
          
          return density * uniforms.density;
        }

        fn raymarch(start: vec3f, dir: vec3f, steps: u32) -> vec4f {
          var color = vec3f(0.0);
          var transmittance = 1.0;
          
          let lightDir = normalize(vec3f(1.0, 1.0, 0.5));
          let stepSize = 0.05;
          
          for (var i = 0u; i < steps; i++) {
            let pos = start + dir * (f32(i) * stepSize);
            
            if (length(pos) > 5.0) { break; }
            
            let density = cloudDensity(pos, uniforms.cloudType);
            
            if (density > 0.01) {
              // Light scattering
              let lightSample = pos + lightDir * 0.5;
              let lightDensity = cloudDensity(lightSample, uniforms.cloudType);
              
              let scattering = exp(-lightDensity * 2.0);
              let light = uniforms.lightIntensity * scattering;
              
              // Color based on density and lighting
              let cloudColor = mix(
                vec3f(0.4, 0.5, 0.6),
                vec3f(1.0, 1.0, 1.0),
                light
              );
              
              let absorption = density * stepSize;
              color += cloudColor * absorption * transmittance * light;
              transmittance *= exp(-absorption);
              
              if (transmittance < 0.01) { break; }
            }
          }
          
          return vec4f(color, 1.0 - transmittance);
        }

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
          let uv = input.uv;
          let aspect = uniforms.aspectRatio;
          
          // Camera setup
          let cameraPos = vec3f(0.0, 0.0, 4.0);
          let target = vec3f(0.0, 0.0, 0.0);
          let forward = normalize(target - cameraPos);
          let right = normalize(cross(forward, vec3f(0.0, 1.0, 0.0)));
          let up = cross(right, forward);
          
          let screenPos = vec2f(uv.x * aspect, uv.y);
          let rayDir = normalize(forward * 2.0 + right * screenPos.x + up * screenPos.y);
          
          // Raymarch through volume
          let result = raymarch(cameraPos, rayDir, 100u);
          
          // Sky gradient
          let skyColor = mix(
            vec3f(0.3, 0.5, 0.8),
            vec3f(0.8, 0.9, 1.0),
            max(0.0, rayDir.y)
          );
          
          // Composite
          let finalColor = mix(skyColor, result.rgb, result.a);
          
          return vec4f(finalColor, 1.0);
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
    const render = (time: number) => {
      if (!this.context || !this.pipeline) return;

      const { device, context, canvas } = this.context;
      const aspect = canvas.width / canvas.height;

      const cloudTypeMap: Record<string, number> = {
        'cumulus': 0,
        'stratus': 1,
        'cirrus': 2
      };

      const uniforms = new ArrayBuffer(64);
      const floatView = new Float32Array(uniforms);
      const uintView = new Uint32Array(uniforms);
      
      floatView[0] = time * 0.001 * this.animationSpeed;
      floatView[1] = this.density;
      floatView[2] = this.lightIntensity;
      floatView[3] = this.windSpeed;
      uintView[4] = cloudTypeMap[this.cloudType] || 0;
      floatView[5] = this.animationSpeed;
      floatView[6] = aspect;

      device.queue.writeBuffer(this.uniformBuffer!, 0, uniforms);

      const commandEncoder = device.createCommandEncoder();
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.3, g: 0.5, b: 0.8, a: 1 },
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

