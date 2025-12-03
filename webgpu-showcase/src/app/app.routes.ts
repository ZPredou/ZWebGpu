import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent)
  },
  {
    path: 'demos/hello-triangle',
    loadComponent: () => import('./pages/demos/hello-triangle/hello-triangle.component').then(m => m.HelloTriangleComponent)
  },
  {
    path: 'demos/shader-playground',
    loadComponent: () => import('./pages/demos/shader-playground/shader-playground.component').then(m => m.ShaderPlaygroundComponent)
  },
  {
    path: 'demos/procedural-graphics',
    loadComponent: () => import('./pages/demos/procedural-graphics/procedural-graphics.component').then(m => m.ProceduralGraphicsComponent)
  },
  {
    path: 'demos/particle-system',
    loadComponent: () => import('./pages/demos/particle-system/particle-system.component').then(m => m.ParticleSystemComponent)
  },
  {
    path: 'demos/game-of-life',
    loadComponent: () => import('./pages/demos/game-of-life/game-of-life.component').then(m => m.GameOfLifeComponent)
  },
  {
    path: 'demos/image-filters',
    loadComponent: () => import('./pages/demos/image-filters/image-filters.component').then(m => m.ImageFiltersComponent)
  },
  {
    path: 'demos/matrix-multiplication',
    loadComponent: () => import('./pages/demos/matrix-multiplication/matrix-multiplication.component').then(m => m.MatrixMultiplicationComponent)
  },
  {
    path: 'demos/neural-network',
    loadComponent: () => import('./pages/demos/neural-network/neural-network.component').then(m => m.NeuralNetworkComponent)
  },
  {
    path: 'demos/data-visualization',
    loadComponent: () => import('./pages/demos/data-visualization/data-visualization.component').then(m => m.DataVisualizationComponent)
  },
  {
    path: 'demos/fractal-renderer',
    loadComponent: () => import('./pages/demos/fractal-renderer/fractal-renderer.component').then(m => m.FractalRendererComponent)
  },
  {
    path: 'demos/ray-marching',
    loadComponent: () => import('./pages/demos/ray-marching/ray-marching.component').then(m => m.RayMarchingComponent)
  },
  {
    path: 'demos/instanced-rendering',
    loadComponent: () => import('./pages/demos/instanced-rendering/instanced-rendering.component').then(m => m.InstancedRenderingComponent)
  },
  {
    path: 'demos/path-tracing',
    loadComponent: () => import('./pages/demos/path-tracing/path-tracing.component').then(m => m.PathTracingComponent)
  },
  {
    path: 'demos/volumetric-rendering',
    loadComponent: () => import('./pages/demos/volumetric-rendering/volumetric-rendering.component').then(m => m.VolumetricRenderingComponent)
  },
  {
    path: 'demos/fluid-simulation',
    loadComponent: () => import('./pages/demos/fluid-simulation/fluid-simulation.component').then(m => m.FluidSimulationComponent)
  },
  {
    path: 'demos/rigid-body-physics',
    loadComponent: () => import('./pages/demos/rigid-body-physics/rigid-body-physics.component').then(m => m.RigidBodyPhysicsComponent)
  },
  {
    path: '**',
    redirectTo: ''
  }
];
