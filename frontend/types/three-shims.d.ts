declare module "three" {
  export const DoubleSide: number;

  export class Object3D {
    name: string;
    visible: boolean;
    userData: Record<string, unknown>;
    position: {
      x: number;
      y: number;
      z: number;
      set: (x: number, y: number, z: number) => void;
    };
    scale: {
      x: number;
      y: number;
      z: number;
      set: (x: number, y: number, z: number) => void;
    };
    children: Object3D[];
    add: (obj: Object3D) => void;
    remove: (obj: Object3D) => void;
    traverse: (callback: (child: Object3D) => void) => void;
  }

  export class Scene extends Object3D {}

  export class Group extends Object3D {}

  export class PerspectiveCamera extends Object3D {
    constructor(fov: number, aspect: number, near: number, far: number);
  }

  export class WebGLRenderer {
    constructor(params?: Record<string, unknown>);
    domElement: HTMLElement;
    setSize: (width: number, height: number) => void;
    setClearColor: (color: number, alpha?: number) => void;
    render: (scene: Scene, camera: PerspectiveCamera) => void;
    dispose: () => void;
  }

  export class Material {
    name: string;
    side: number;
  }

  export class Texture {}

  export class SphereGeometry {
    constructor(radius: number, widthSegments: number, heightSegments: number);
  }

  export class MeshBasicMaterial extends Material {
    constructor(params?: Record<string, unknown>);
  }

  export class Mesh extends Object3D {
    constructor(geometry?: unknown, material?: unknown);
    isMesh: boolean;
    material: Material | Material[];
  }

  export class AmbientLight extends Object3D {
    constructor(color: number, intensity?: number);
  }

  export class DirectionalLight extends Object3D {
    constructor(color: number, intensity?: number);
  }

  export class Raycaster {
    setFromCamera: (coords: Vector2, camera: PerspectiveCamera) => void;
    intersectObjects: (objects: Object3D[]) => Array<{ object: Object3D }>;
  }

  export class Vector2 {
    x: number;
    y: number;
    constructor();
  }
}

declare module "three/examples/jsm/loaders/GLTFLoader.js" {
  import type { Object3D } from "three";

  export class GLTFLoader {
    load: (
      url: string,
      onLoad: (gltf: { scene: Object3D }) => void,
      onProgress?: ((event: ProgressEvent) => void) | undefined,
      onError?: ((error: unknown) => void) | undefined
    ) => void;
  }
}

declare module "three/examples/jsm/controls/OrbitControls.js" {
  import type { PerspectiveCamera } from "three";

  export class OrbitControls {
    constructor(camera: PerspectiveCamera, domElement: HTMLElement);
    enableDamping: boolean;
    dampingFactor: number;
    enableZoom: boolean;
    enablePan: boolean;
    autoRotate: boolean;
    autoRotateSpeed: number;
    update: () => void;
  }
}
