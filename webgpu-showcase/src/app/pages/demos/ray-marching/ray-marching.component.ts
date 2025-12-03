import { Component, ViewChild, AfterViewInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DemoBaseComponent } from '../../../components/shared/demo-base/demo-base.component';
import { WebGPUContext } from '../../../types/webgpu.types';

@Component({
  selector: 'app-ray-marching',
  standalone: true,
  imports: [CommonModule, FormsModule, DemoBaseComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ray-marching.component.html',
  styleUrl: './ray-marching.component.scss'
})
export class RayMarchingComponent implements AfterViewInit {
  @ViewChild('demoBase') demoBase!: DemoBaseComponent;

  scene = 'spheres';
  maxSteps = 128;
  shadowSoftness = 16;
  enableAO = true;
  enableShadows = true;
  animSpeed = 1;

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

  onSceneChange(): void {
    if (this.context) {
      this.initializePipeline();
    }
  }

  private getSceneSDF(): string {
    const scenes: Record<string, string> = {
      spheres: `
        fn sceneSDF(p: vec3f, time: f32) -> f32 {
          var d = sdPlane(p, vec3f(0.0, 1.0, 0.0), 1.0);
          
          // Floating spheres
          for (var i = 0; i < 5; i++) {
            let fi = f32(i);
            let offset = vec3f(
              sin(time + fi * 1.2) * 1.5,
              cos(time * 0.7 + fi) * 0.5 + 0.5,
              cos(time + fi * 0.8) * 1.5
            );
            d = opSmoothUnion(d, sdSphere(p - offset, 0.4), 0.3);
          }
          
          return d;
        }
      `,
      mandelbulb: `
        fn mandelbulb(p: vec3f, power: f32) -> f32 {
          var z = p;
          var dr = 1.0;
          var r = 0.0;
          
          for (var i = 0; i < 8; i++) {
            r = length(z);
            if (r > 2.0) { break; }
            
            let theta = acos(z.z / r);
            let phi = atan2(z.y, z.x);
            dr = pow(r, power - 1.0) * power * dr + 1.0;
            
            let zr = pow(r, power);
            let newTheta = theta * power;
            let newPhi = phi * power;
            
            z = zr * vec3f(
              sin(newTheta) * cos(newPhi),
              sin(newPhi) * sin(newTheta),
              cos(newTheta)
            ) + p;
          }
          
          return 0.5 * log(r) * r / dr;
        }
        
        fn sceneSDF(p: vec3f, time: f32) -> f32 {
          let power = 8.0 + sin(time * 0.3) * 2.0;
          return mandelbulb(p * 1.5, power) / 1.5;
        }
      `,
      geometric: `
        fn sceneSDF(p: vec3f, time: f32) -> f32 {
          var d = sdPlane(p, vec3f(0.0, 1.0, 0.0), 1.0);
          
          // Rotating box
          let rotP = rotateY(p - vec3f(0.0, 0.0, 0.0), time);
          d = opSmoothUnion(d, sdBox(rotP, vec3f(0.5)), 0.1);
          
          // Torus
          let torusP = p - vec3f(2.0, 0.5, 0.0);
          d = opSmoothUnion(d, sdTorus(rotateX(torusP, time), vec2f(0.5, 0.2)), 0.1);
          
          // Cone
          let coneP = p - vec3f(-2.0, -0.5, 0.0);
          d = opSmoothUnion(d, sdCone(coneP, vec2f(0.6, 0.8), 1.0), 0.1);
          
          return d;
        }
      `,
      infinite: `
        fn sceneSDF(p: vec3f, time: f32) -> f32 {
          var mp = p;
          mp.x = fract(p.x + 0.5) - 0.5;
          mp.z = fract(p.z + 0.5) - 0.5;
          
          let h = sin(floor(p.x) * 1.3 + floor(p.z) * 0.7 + time) * 0.5 + 1.5;
          
          var d = sdCylinder(mp, h, 0.15);
          d = min(d, sdPlane(p, vec3f(0.0, 1.0, 0.0), 1.0));
          
          return d;
        }
      `,
    };
    return scenes[this.scene] || scenes['spheres'];
  }

  private async initializePipeline(): Promise<void> {
    if (!this.context) return;

    const { device, format } = this.context;

    this.uniformBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shaderModule = device.createShaderModule({
      label: 'Ray Marching',
      code: `
        struct Uniforms {
          time: f32,
          aspectRatio: f32,
          maxSteps: i32,
          shadowSoftness: f32,
          enableAO: u32,
          enableShadows: u32,
          animSpeed: f32,
          padding: f32,
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

        // SDF primitives
        fn sdSphere(p: vec3f, r: f32) -> f32 {
          return length(p) - r;
        }

        fn sdBox(p: vec3f, b: vec3f) -> f32 {
          let q = abs(p) - b;
          return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
        }

        fn sdPlane(p: vec3f, n: vec3f, h: f32) -> f32 {
          return dot(p, n) + h;
        }

        fn sdTorus(p: vec3f, t: vec2f) -> f32 {
          let q = vec2f(length(p.xz) - t.x, p.y);
          return length(q) - t.y;
        }

        fn sdCylinder(p: vec3f, h: f32, r: f32) -> f32 {
          let d = abs(vec2f(length(p.xz), p.y)) - vec2f(r, h);
          return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
        }

        fn sdCone(p: vec3f, c: vec2f, h: f32) -> f32 {
          let q = h * vec2f(c.x / c.y, -1.0);
          let w = vec2f(length(p.xz), p.y);
          let a = w - q * clamp(dot(w, q) / dot(q, q), 0.0, 1.0);
          let b = w - q * vec2f(clamp(w.x / q.x, 0.0, 1.0), 1.0);
          let k = sign(q.y);
          let d = min(dot(a, a), dot(b, b));
          let s = max(k * (w.x * q.y - w.y * q.x), k * (w.y - q.y));
          return sqrt(d) * sign(s);
        }

        fn opSmoothUnion(d1: f32, d2: f32, k: f32) -> f32 {
          let h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
          return mix(d2, d1, h) - k * h * (1.0 - h);
        }

        fn rotateY(p: vec3f, a: f32) -> vec3f {
          let c = cos(a);
          let s = sin(a);
          return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
        }

        fn rotateX(p: vec3f, a: f32) -> vec3f {
          let c = cos(a);
          let s = sin(a);
          return vec3f(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
        }

        ${this.getSceneSDF()}

        fn calcNormal(p: vec3f, time: f32) -> vec3f {
          let e = vec2f(0.001, 0.0);
          return normalize(vec3f(
            sceneSDF(p + e.xyy, time) - sceneSDF(p - e.xyy, time),
            sceneSDF(p + e.yxy, time) - sceneSDF(p - e.yxy, time),
            sceneSDF(p + e.yyx, time) - sceneSDF(p - e.yyx, time)
          ));
        }

        fn softShadow(ro: vec3f, rd: vec3f, mint: f32, maxt: f32, k: f32, time: f32) -> f32 {
          var res = 1.0;
          var t = mint;
          for (var i = 0; i < 32; i++) {
            let h = sceneSDF(ro + rd * t, time);
            if (h < 0.001) { return 0.0; }
            res = min(res, k * h / t);
            t += h;
            if (t > maxt) { break; }
          }
          return res;
        }

        fn calcAO(pos: vec3f, nor: vec3f, time: f32) -> f32 {
          var occ = 0.0;
          var sca = 1.0;
          for (var i = 0; i < 5; i++) {
            let h = 0.01 + 0.12 * f32(i) / 4.0;
            let d = sceneSDF(pos + h * nor, time);
            occ += (h - d) * sca;
            sca *= 0.95;
          }
          return clamp(1.0 - 3.0 * occ, 0.0, 1.0);
        }

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
          let time = uniforms.time * uniforms.animSpeed;
          
          // Camera
          let camPos = vec3f(4.0 * sin(time * 0.2), 2.0, 4.0 * cos(time * 0.2));
          let camTarget = vec3f(0.0, 0.0, 0.0);
          
          let cw = normalize(camTarget - camPos);
          let cu = normalize(cross(cw, vec3f(0.0, 1.0, 0.0)));
          let cv = cross(cu, cw);
          
          let uv = input.uv * vec2f(uniforms.aspectRatio, 1.0);
          let rd = normalize(uv.x * cu + uv.y * cv + 2.0 * cw);
          
          // Ray march
          var t = 0.0;
          var hit = false;
          
          for (var i = 0; i < uniforms.maxSteps; i++) {
            let p = camPos + rd * t;
            let d = sceneSDF(p, time);
            
            if (d < 0.001) {
              hit = true;
              break;
            }
            
            t += d;
            if (t > 100.0) { break; }
          }
          
          if (!hit) {
            // Sky gradient
            let skyColor = mix(
              vec3f(0.1, 0.1, 0.2),
              vec3f(0.02, 0.02, 0.05),
              input.uv.y * 0.5 + 0.5
            );
            return vec4f(skyColor, 1.0);
          }
          
          let pos = camPos + rd * t;
          let nor = calcNormal(pos, time);
          
          // Lighting
          let lightDir = normalize(vec3f(1.0, 1.0, 0.5));
          var dif = max(dot(nor, lightDir), 0.0);
          
          // Shadows
          if (uniforms.enableShadows == 1u) {
            dif *= softShadow(pos + nor * 0.01, lightDir, 0.01, 10.0, uniforms.shadowSoftness, time);
          }
          
          // Ambient occlusion
          var ao = 1.0;
          if (uniforms.enableAO == 1u) {
            ao = calcAO(pos, nor, time);
          }
          
          // Material color
          let baseColor = vec3f(0.2, 0.5, 0.8);
          var color = baseColor * (0.3 * ao + 0.7 * dif);
          
          // Fog
          let fog = exp(-t * 0.05);
          color = mix(vec3f(0.05, 0.05, 0.1), color, fog);
          
          // Gamma correction
          color = pow(color, vec3f(0.4545));
          
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
    const render = (time: number) => {
      if (!this.context || !this.pipeline) return;

      const { device, context, canvas } = this.context;
      const aspect = canvas.width / canvas.height;

      const uniforms = new ArrayBuffer(64);
      const floatView = new Float32Array(uniforms);
      const intView = new Int32Array(uniforms);
      const uintView = new Uint32Array(uniforms);
      
      floatView[0] = time * 0.001;
      floatView[1] = aspect;
      intView[2] = this.maxSteps;
      floatView[3] = this.shadowSoftness;
      uintView[4] = this.enableAO ? 1 : 0;
      uintView[5] = this.enableShadows ? 1 : 0;
      floatView[6] = this.animSpeed;
      
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

    this.demoBase.startRenderLoop(render);
  }
}

