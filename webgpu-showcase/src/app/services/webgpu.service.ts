import { Injectable, signal } from '@angular/core';
import { WebGPUContext } from '../types/webgpu.types';

@Injectable({
  providedIn: 'root'
})
export class WebGPUService {
  private adapter: GPUAdapter | null = null;
  private _device: GPUDevice | null = null;
  
  readonly isSupported = signal<boolean | null>(null);
  readonly isInitialized = signal(false);
  readonly error = signal<string | null>(null);
  readonly adapterInfo = signal<GPUAdapterInfo | null>(null);

  get device(): GPUDevice | null {
    return this._device;
  }

  async checkSupport(): Promise<boolean> {
    if (this.isSupported() !== null) {
      return this.isSupported()!;
    }

    const supported = 'gpu' in navigator;
    this.isSupported.set(supported);
    
    if (!supported) {
      this.error.set('WebGPU is not supported in this browser. Please use Chrome 113+ or Edge 113+.');
    }
    
    return supported;
  }

  async initialize(): Promise<GPUDevice | null> {
    if (this._device) {
      return this._device;
    }

    try {
      const supported = await this.checkSupport();
      if (!supported) {
        return null;
      }

      // Try high-performance first, then fallback to default, then low-power
      const adapterOptions: GPURequestAdapterOptions[] = [
        { powerPreference: 'high-performance' },
        {}, // default
        { powerPreference: 'low-power' },
      ];

      for (const options of adapterOptions) {
        try {
          this.adapter = await navigator.gpu.requestAdapter(options);
          if (this.adapter) {
            console.log('WebGPU adapter acquired with options:', options);
            break;
          }
        } catch (e) {
          console.warn('Failed to get adapter with options:', options, e);
        }
      }

      if (!this.adapter) {
        this.error.set('Failed to get GPU adapter. Your GPU may not support WebGPU. Check chrome://gpu for details.');
        return null;
      }

      // Get adapter info
      this.adapterInfo.set(this.adapter.info);
      console.log('GPU Adapter Info:', this.adapter.info);

      this._device = await this.adapter.requestDevice({
        requiredFeatures: [],
        requiredLimits: {}
      });

      this._device.lost.then((info) => {
        console.error('WebGPU device was lost:', info.message);
        this.error.set(`GPU device lost: ${info.message}`);
        this._device = null;
        this.isInitialized.set(false);
      });

      this.isInitialized.set(true);
      return this._device;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.error.set(`Failed to initialize WebGPU: ${message}`);
      return null;
    }
  }

  async createContext(canvas: HTMLCanvasElement): Promise<WebGPUContext | null> {
    const device = await this.initialize();
    if (!device) {
      return null;
    }

    const context = canvas.getContext('webgpu');
    if (!context) {
      this.error.set('Failed to get WebGPU context from canvas.');
      return null;
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    
    context.configure({
      device,
      format,
      alphaMode: 'premultiplied'
    });

    return {
      device,
      context,
      format,
      canvas
    };
  }

  getPreferredFormat(): GPUTextureFormat {
    return navigator.gpu.getPreferredCanvasFormat();
  }

  createBuffer(
    data: Float32Array | Uint32Array | Uint16Array,
    usage: GPUBufferUsageFlags
  ): GPUBuffer | null {
    if (!this._device) return null;

    const buffer = this._device.createBuffer({
      size: data.byteLength,
      usage,
      mappedAtCreation: true
    });

    if (data instanceof Float32Array) {
      new Float32Array(buffer.getMappedRange()).set(data);
    } else if (data instanceof Uint32Array) {
      new Uint32Array(buffer.getMappedRange()).set(data);
    } else {
      new Uint16Array(buffer.getMappedRange()).set(data);
    }

    buffer.unmap();
    return buffer;
  }

  createShaderModule(code: string, label?: string): GPUShaderModule | null {
    if (!this._device) return null;

    return this._device.createShaderModule({
      label,
      code
    });
  }
}

