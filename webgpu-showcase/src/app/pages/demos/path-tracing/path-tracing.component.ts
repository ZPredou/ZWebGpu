import { Component, ViewChild, AfterViewInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DemoBaseComponent } from '../../../components/shared/demo-base/demo-base.component';
import { WebGPUContext } from '../../../types/webgpu.types';

@Component({
  selector: 'app-path-tracing',
  standalone: true,
  imports: [CommonModule, FormsModule, DemoBaseComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './path-tracing.component.html',
  styleUrl: './path-tracing.component.scss'
})
export class PathTracingComponent implements AfterViewInit {
  @ViewChild('demoBase') demoBase!: DemoBaseComponent;

  samplesPerPixel = 4;
  maxBounces = 8;
  exposure = 1.0;
  showAccumulation = true;
  frameCount = 0;

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

  onSamplesChange(): void {
    this.frameCount = 0; // Reset accumulation
  }

  private async initializePipeline(): Promise<void> {
    if (!this.context) return;

    const { device, format } = this.context;

    this.uniformBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shaderModule = device.createShaderModule({
      label: 'Path Tracing',
      code: `
        struct Uniforms {
          time: f32,
          frameCount: u32,
          samplesPerPixel: u32,
          maxBounces: u32,
          exposure: f32,
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

        fn random(seed: u32) -> f32 {
          var state = seed;
          state ^= state << 13u;
          state ^= state >> 17u;
          state ^= state << 5u;
          // Normalize to [0, 1) range
          return f32(state) / 4294967296.0;
        }
        
        fn hash(u: u32) -> u32 {
          var v = u;
          v ^= v >> 16u;
          v *= 0x85ebca6bu;
          v ^= v >> 13u;
          v *= 0xc2b2ae35u;
          v ^= v >> 16u;
          return v;
        }

        fn randomVec2(seed: u32) -> vec2f {
          return vec2f(random(seed), random(seed + 1u));
        }

        fn randomVec3(seed: u32) -> vec3f {
          return vec3f(random(seed), random(seed + 1u), random(seed + 2u));
        }

        fn randomOnSphere(seed: u32) -> vec3f {
          let u = randomVec2(seed);
          let z = 1.0 - 2.0 * u.x;
          let r = sqrt(max(0.0, 1.0 - z * z));
          let phi = 2.0 * 3.14159 * u.y;
          return vec3f(r * cos(phi), r * sin(phi), z);
        }

        fn reflect(incident: vec3f, normal: vec3f) -> vec3f {
          return incident - 2.0 * dot(incident, normal) * normal;
        }

        struct Ray {
          origin: vec3f,
          direction: vec3f,
        }

        struct Hit {
          t: f32,
          normal: vec3f,
          material: u32,
        }

        fn intersectSphere(ray: Ray, center: vec3f, radius: f32) -> f32 {
          let oc = ray.origin - center;
          let a = dot(ray.direction, ray.direction);
          let b = 2.0 * dot(oc, ray.direction);
          let c = dot(oc, oc) - radius * radius;
          let discriminant = b * b - 4.0 * a * c;
          
          if (discriminant < 0.0) { return -1.0; }
          
          let t = (-b - sqrt(discriminant)) / (2.0 * a);
          return t;
        }

        fn scene(ray: Ray) -> Hit {
          var hit: Hit;
          hit.t = 1000.0;
          hit.normal = vec3f(0.0);
          hit.material = 0u;

          // Ground plane
          let t_plane = -ray.origin.y / ray.direction.y;
          if (t_plane > 0.01 && t_plane < hit.t) {
            hit.t = t_plane;
            hit.normal = vec3f(0.0, 1.0, 0.0);
            hit.material = 1u;
          }

          // Spheres
          let spheres = array<vec4f, 3>(
            vec4f(0.0, 1.0, 0.0, 1.0),      // Center sphere
            vec4f(-2.5, 1.0, 0.0, 1.0),     // Left sphere
            vec4f(2.5, 1.0, 0.0, 1.0),     // Right sphere
          );

          for (var i = 0u; i < 3u; i++) {
            let t = intersectSphere(ray, spheres[i].xyz, spheres[i].w);
            if (t > 0.01 && t < hit.t) {
              hit.t = t;
              hit.normal = normalize((ray.origin + ray.direction * t) - spheres[i].xyz);
              hit.material = i + 2u;
            }
          }

          return hit;
        }

        fn trace(ray: Ray, maxBounces: u32, seed: u32) -> vec3f {
          var color = vec3f(0.0);
          var throughput = vec3f(1.0);
          var currentRay = ray;
          var currentSeed = seed;

          for (var bounce = 0u; bounce < maxBounces; bounce++) {
            let hit = scene(currentRay);
            
            if (hit.t > 999.0) {
              // Sky
              let skyColor = mix(
                vec3f(0.5, 0.7, 1.0),
                vec3f(1.0, 1.0, 1.0),
                max(0.0, currentRay.direction.y)
              );
              color += throughput * skyColor;
              break;
            }

            let hitPoint = currentRay.origin + currentRay.direction * hit.t;
            
            // Material properties
            var albedo = vec3f(0.8);
            var emission = vec3f(0.0);
            var isMetal = false;
            var isGlass = false;
            
            if (hit.material == 1u) {
              // Checkerboard floor
              let check = floor(hitPoint.x * 0.5) + floor(hitPoint.z * 0.5);
              albedo = select(vec3f(0.2), vec3f(0.8), (u32(check) % 2u) == 0u);
            } else if (hit.material == 2u) {
              // Center sphere - diffuse
              albedo = vec3f(0.8, 0.2, 0.2);
            } else if (hit.material == 3u) {
              // Left sphere - metal
              albedo = vec3f(0.8, 0.8, 0.9);
              isMetal = true;
            } else if (hit.material == 4u) {
              // Right sphere - glass
              albedo = vec3f(0.9, 0.9, 0.95);
              isGlass = true;
            }

            // Add emission for light
            if (hit.material == 2u) {
              emission = vec3f(2.0, 1.5, 1.0);
            }

            color += throughput * emission;

            // Sample new direction based on material type
            var newDir: vec3f;
            var newThroughput: vec3f;
            
            if (isMetal) {
              // Metal: specular reflection with slight roughness
              let reflectDir = reflect(currentRay.direction, hit.normal);
              // Add slight fuzziness for rough metal
              let roughness = 0.1;
              newDir = normalize(reflectDir + randomOnSphere(currentSeed) * roughness);
              currentSeed = hash(currentSeed + 1u);
              newThroughput = albedo;
            } else if (isGlass) {
              // Glass: refraction with Fresnel
              let ior = 1.5; // Index of refraction for glass
              var cosI = -dot(currentRay.direction, hit.normal);
              var n1 = 1.0; // Air
              var n2 = ior;
              var normal = hit.normal;
              
              // Check if we're inside the sphere
              if (cosI < 0.0) {
                cosI = -cosI;
                normal = -normal;
                n1 = ior;
                n2 = 1.0;
              }
              
              let eta = n1 / n2;
              let sinT2 = eta * eta * (1.0 - cosI * cosI);
              
              // Fresnel reflection coefficient
              var r0 = (n1 - n2) / (n1 + n2);
              r0 = r0 * r0;
              let fresnel = r0 + (1.0 - r0) * pow(1.0 - cosI, 5.0);
              
              // Choose reflection or refraction based on Fresnel
              if (sinT2 > 1.0 || random(currentSeed) < fresnel) {
                // Total internal reflection or Fresnel reflection
                newDir = reflect(currentRay.direction, hit.normal);
                newThroughput = albedo;
              } else {
                // Refraction
                let cosT = sqrt(1.0 - sinT2);
                newDir = normalize(eta * currentRay.direction + (eta * cosI - cosT) * normal);
                newThroughput = albedo * (1.0 - fresnel);
              }
              currentSeed = hash(currentSeed + 1u);
            } else {
              // Diffuse: cosine-weighted hemisphere sampling
              newDir = normalize(hit.normal + randomOnSphere(currentSeed));
              currentSeed = hash(currentSeed + 1u);
              newThroughput = albedo * max(0.0, dot(newDir, hit.normal));
            }
            
            throughput *= newThroughput;
            currentRay = Ray(hitPoint + hit.normal * 0.01, newDir);
          }

          return color;
        }

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
          let uv = input.uv;
          let aspect = uniforms.aspectRatio;
          
          // Camera setup
          let cameraPos = vec3f(0.0, 2.0, 5.0);
          let lookAt = vec3f(0.0, 1.0, 0.0);
          let forward = normalize(lookAt - cameraPos);
          let right = normalize(cross(forward, vec3f(0.0, 1.0, 0.0)));
          let up = cross(right, forward);

          // Generate seed from pixel position and frame with better hashing
          let pixelX = u32((uv.x * 0.5 + 0.5) * 10000.0);
          let pixelY = u32((uv.y * 0.5 + 0.5) * 10000.0);
          let pixelSeed = hash(pixelX) ^ hash(pixelY) ^ hash(uniforms.frameCount);
          
          var color = vec3f(0.0);
          
          // Multiple samples per pixel with better distribution
          for (var s = 0u; s < uniforms.samplesPerPixel; s++) {
            let sampleSeed = hash(pixelSeed + s * 7919u + uniforms.frameCount * 10007u);
            let jitter = randomVec2(sampleSeed) - 0.5; // Center around 0
            let screenPos = vec2f(uv.x * aspect, uv.y) + jitter * vec2f(aspect, 1.0) * 0.002;
            
            let rayDir = normalize(
              forward * 2.0 +
              right * screenPos.x +
              up * screenPos.y
            );
            
            let ray = Ray(cameraPos, rayDir);
            let sampleColor = trace(ray, uniforms.maxBounces, sampleSeed);
            color += sampleColor;
          }
          
          color /= f32(uniforms.samplesPerPixel);
          
          // Tone mapping and exposure
          color = vec3f(1.0) - exp(-color * uniforms.exposure);
          
          // Gamma correction
          color = pow(color, vec3f(1.0 / 2.2));
          
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

      if (this.showAccumulation) {
        this.frameCount++;
      } else {
        this.frameCount = 0;
      }

      const uniforms = new ArrayBuffer(64);
      const floatView = new Float32Array(uniforms);
      const uintView = new Uint32Array(uniforms);
      
      floatView[0] = time * 0.001;
      uintView[1] = this.frameCount;
      uintView[2] = this.samplesPerPixel;
      uintView[3] = this.maxBounces;
      floatView[4] = this.exposure;
      floatView[5] = aspect;

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

