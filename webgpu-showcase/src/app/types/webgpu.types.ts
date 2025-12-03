export interface WebGPUContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  canvas: HTMLCanvasElement;
}

export interface DemoInfo {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: DemoCategory;
  difficulty: 'beginner' | 'easy' | 'medium' | 'advanced';
  route: string;
}

export type DemoCategory = 
  | 'graphics'
  | 'compute'
  | 'ml'
  | 'visualization'
  | 'interactive';

export const DEMO_CATEGORIES: Record<DemoCategory, { label: string; icon: string }> = {
  graphics: { label: 'Graphics & Rendering', icon: '🎨' },
  compute: { label: 'Compute Shaders', icon: '🔬' },
  ml: { label: 'Machine Learning', icon: '🤖' },
  visualization: { label: 'Data Visualization', icon: '📊' },
  interactive: { label: 'Interactive Demos', icon: '🎮' }
};

export const DEMOS: DemoInfo[] = [
  // Graphics & Rendering
  {
    id: 'hello-triangle',
    title: 'Hello Triangle',
    description: 'The classic "Hello World" of graphics programming - rendering a colorful triangle.',
    icon: '🔺',
    category: 'graphics',
    difficulty: 'beginner',
    route: '/demos/hello-triangle'
  },
  {
    id: 'shader-playground',
    title: 'Shader Playground',
    description: 'Interactive fragment shader editor with real-time preview.',
    icon: '✨',
    category: 'graphics',
    difficulty: 'easy',
    route: '/demos/shader-playground'
  },
  {
    id: 'procedural-graphics',
    title: 'Procedural Graphics',
    description: 'Generate textures and patterns procedurally on the GPU.',
    icon: '🌀',
    category: 'graphics',
    difficulty: 'medium',
    route: '/demos/procedural-graphics'
  },
  {
    id: 'path-tracing',
    title: 'Path Tracing',
    description: 'Real-time path tracing with global illumination, reflections, and refractions.',
    icon: '✨',
    category: 'graphics',
    difficulty: 'advanced',
    route: '/demos/path-tracing'
  },
  {
    id: 'volumetric-rendering',
    title: 'Volumetric Rendering',
    description: 'Real-time volumetric cloud rendering with dynamic lighting and shadows.',
    icon: '☁️',
    category: 'graphics',
    difficulty: 'advanced',
    route: '/demos/volumetric-rendering'
  },
  
  // Compute Shaders
  {
    id: 'particle-system',
    title: 'Particle System',
    description: 'Millions of particles simulated in parallel using compute shaders.',
    icon: '💫',
    category: 'compute',
    difficulty: 'medium',
    route: '/demos/particle-system'
  },
  {
    id: 'game-of-life',
    title: 'Game of Life',
    description: "Conway's Game of Life running entirely on the GPU.",
    icon: '🧬',
    category: 'compute',
    difficulty: 'medium',
    route: '/demos/game-of-life'
  },
  {
    id: 'image-filters',
    title: 'Image Filters',
    description: 'Real-time image processing with various filter effects.',
    icon: '🖼️',
    category: 'compute',
    difficulty: 'medium',
    route: '/demos/image-filters'
  },
  {
    id: 'fluid-simulation',
    title: 'Fluid Simulation',
    description: 'Real-time fluid dynamics with advection, viscosity, and pressure simulation.',
    icon: '🌊',
    category: 'compute',
    difficulty: 'advanced',
    route: '/demos/fluid-simulation'
  },
  {
    id: 'rigid-body-physics',
    title: 'Rigid Body Physics',
    description: 'GPU-accelerated rigid body physics with collision detection and response.',
    icon: '⚙️',
    category: 'compute',
    difficulty: 'advanced',
    route: '/demos/rigid-body-physics'
  },
  
  // Machine Learning
  {
    id: 'matrix-multiplication',
    title: 'Matrix Multiplication',
    description: 'GPU-accelerated matrix operations - the foundation of neural networks.',
    icon: '🔢',
    category: 'ml',
    difficulty: 'medium',
    route: '/demos/matrix-multiplication'
  },
  {
    id: 'neural-network',
    title: 'Neural Network',
    description: 'Simple neural network inference running on the GPU.',
    icon: '🧠',
    category: 'ml',
    difficulty: 'advanced',
    route: '/demos/neural-network'
  },
  
  // Data Visualization
  {
    id: 'data-visualization',
    title: 'Data Visualization',
    description: 'Render millions of data points efficiently with WebGPU.',
    icon: '📈',
    category: 'visualization',
    difficulty: 'medium',
    route: '/demos/data-visualization'
  },
  
  // Interactive Demos
  {
    id: 'fractal-renderer',
    title: 'Fractal Renderer',
    description: 'Explore the Mandelbrot set with infinite zoom capability.',
    icon: '🌌',
    category: 'interactive',
    difficulty: 'medium',
    route: '/demos/fractal-renderer'
  },
  {
    id: 'ray-marching',
    title: 'Ray Marching',
    description: 'Real-time ray marching with signed distance functions.',
    icon: '🔮',
    category: 'interactive',
    difficulty: 'advanced',
    route: '/demos/ray-marching'
  },
  {
    id: 'instanced-rendering',
    title: 'Instanced Rendering',
    description: 'Draw thousands of objects efficiently with instancing.',
    icon: '🏗️',
    category: 'interactive',
    difficulty: 'advanced',
    route: '/demos/instanced-rendering'
  }
];

export function getDemosByCategory(category: DemoCategory): DemoInfo[] {
  return DEMOS.filter(demo => demo.category === category);
}

export function getAllCategories(): DemoCategory[] {
  return Object.keys(DEMO_CATEGORIES) as DemoCategory[];
}

