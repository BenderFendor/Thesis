import {
ACESFilmicToneMapping,
AdditiveBlending,
AmbientLight,
BackSide,
Clock,
DirectionalLight,
HemisphereLight,
Mesh,
SRGBColorSpace,
ShaderMaterial,
SphereGeometry,
TextureLoader,
} from "three";
import type { Material, Object3D, Points, Scene, Vector3 } from "three";
import {
  ATMOSPHERE_FRAGMENT_SHADER,
ATMOSPHERE_RADIUS_FACTOR,
CLOUD_RADIUS_FACTOR,
EARTH_RADIUS,
EARTH_VERTEX_SHADER,
GLOBE_TEXTURE_ROTATION_Y,
OPTIMIZED_TEXTURES,
STAR_FIELD_SPREAD_FACTOR,
SUN_LIGHT_DISTANCE_FACTOR,
createCloudsMaterial,
createStarField,
  findGlobeAnchor,
  getQualityTier,
  loadManagedTexture,
} from "./interactive-globe-visuals";
import type {
  GlobeTextureSet,
  GlobeUniformView,
  QualityTier,
  TextureReference,
  TextureLoaderContract,
} from "./interactive-globe-visuals";
import type { GlobeInstance } from "./interactive-globe-types";

interface TextureRendererView {
  readonly capabilities: Readonly<{
    getMaxAnisotropy: () => number;
    maxTextureSize: number;
  }>;
}

interface SceneLights {
  readonly ambientLight: AmbientLight;
  readonly hemisphereLight: HemisphereLight;
  readonly sunLight: DirectionalLight;
}

interface SceneResources extends SceneLights {
  readonly clock: Clock;
  readonly globeAnchor: SceneGraphView;
  readonly qualityTier: Readonly<QualityTier>;
  readonly renderer: TextureRendererView;
  readonly scene: Scene;
  readonly sceneMaterials: Material[];
  readonly sceneObjects: (Mesh | Points)[];
  readonly sceneTextures: TextureReference[];
}

interface SceneSetupContext {
  readonly container: HTMLDivElement | null;
  readonly globe: Readonly<GlobeInstance>;
  readonly uniforms: GlobeUniformView;
  readonly applyTextures: (textures: GlobeTextureSet) => void;
  readonly updateAnimation: (elapsedTime: number) => void;
}

interface TextureLoadContext {
  readonly qualityTier: QualityTier;
  readonly renderer: TextureRendererView;
  readonly textureLoader: TextureLoaderContract;
}

interface LayerContext {
  readonly globeAnchor: SceneGraphView;
  readonly globeRadius: number;
  readonly qualityTier: Readonly<QualityTier>;
  readonly uniforms: GlobeUniformView;
  readonly applyTextures: (textures: GlobeTextureSet) => void;
}

interface TextureBindingContext extends LayerContext, TextureLoadContext {}

interface SceneLayer {
  readonly material: Material;
  readonly object: Mesh | Points;
}

interface AnimationControls {
  readonly handleVisibilityChange: () => void;
  readonly isDisposed: () => boolean;
  readonly start: () => void;
  readonly stop: () => void;
  readonly dispose: () => void;
}

type SceneGraphView = Readonly<Pick<Object3D, "add">>;

type SunDirectionView = Readonly<{
  readonly uSunDirection: Readonly<{
    readonly value: Readonly<Pick<Vector3, "x" | "y" | "z">>;
  }>;
}>;

const createSceneLights = (scene: SceneGraphView, uniforms: SunDirectionView): SceneLights => {
  const ambientLight = new AmbientLight(0x15_21_31, 0.16);
  const hemisphereLight = new HemisphereLight(0x32_5D_87, 0x04_07_0D, 0.14);
  const sunLight = new DirectionalLight(0xFF_F4_DB, 2.4);
  const sunDirection = uniforms.uSunDirection.value;
  sunLight.position
    .set(sunDirection.x, sunDirection.y, sunDirection.z)
    .multiplyScalar(EARTH_RADIUS * SUN_LIGHT_DISTANCE_FACTOR);
  scene.add(ambientLight);
  scene.add(hemisphereLight);
  scene.add(sunLight);
  return { ambientLight, hemisphereLight, sunLight };
};

const configureRenderer = (globe: GlobeInstance): TextureRendererView => {
  const renderer = globe.renderer();
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
};

const createStarFieldLayer = (
  scene: SceneGraphView,
  qualityTier: Readonly<QualityTier>,
  globeRadius: number,
): SceneLayer => {
  const starField = createStarField(
    qualityTier.starCount,
    globeRadius * STAR_FIELD_SPREAD_FACTOR,
  );
  starField.renderOrder = -20;
  scene.add(starField);
  return { material: starField.material, object: starField };
};

const createSceneResourceState = (
  context: Readonly<SceneSetupContext>,
  renderer: Readonly<TextureRendererView>,
  qualityTier: Readonly<QualityTier>,
): SceneResources => {
  const scene = context.globe.scene();
  const lights = createSceneLights(scene, context.uniforms);
  const globeRadius = context.globe.getGlobeRadius();
  const globeAnchor = findGlobeAnchor(scene);
  const starField = createStarFieldLayer(scene, qualityTier, globeRadius);
  return {
    ...lights,
    clock: new Clock(),
    globeAnchor,
    qualityTier,
    renderer,
    scene,
    sceneMaterials: [starField.material],
    sceneObjects: [starField.object],
    sceneTextures: [],
  };
};

const createSceneResources = (context: Readonly<SceneSetupContext>): SceneResources => {
  const renderer = configureRenderer(context.globe);
  const qualityTier = getQualityTier(
    context.container?.clientWidth ?? globalThis.innerWidth,
    context.container?.clientHeight ?? globalThis.innerHeight,
  );
  return createSceneResourceState(context, renderer, qualityTier);
};

const loadEarthTextures = async (
  context: Readonly<TextureLoadContext>,
): Promise<GlobeTextureSet> => {
  const { qualityTier, renderer, textureLoader } = context;
  const maxTextureSize = Math.min(
    renderer.capabilities.maxTextureSize || qualityTier.maxTextureSize,
    qualityTier.maxTextureSize,
  );
  const anisotropy = Math.min(
    renderer.capabilities.getMaxAnisotropy(),
    qualityTier.anisotropyCap,
  );
  const [dayTexture, bumpTexture, nightTexture, surfaceMaskTexture, cloudTexture] =
    await Promise.all([
      loadManagedTexture(textureLoader, OPTIMIZED_TEXTURES.day, {
        anisotropy,
        color: true,
        maxTextureSize,
      }),
      loadManagedTexture(textureLoader, OPTIMIZED_TEXTURES.bump, {
        anisotropy,
        maxTextureSize,
      }),
      loadManagedTexture(textureLoader, OPTIMIZED_TEXTURES.night, {
        anisotropy,
        maxTextureSize,
      }),
      loadManagedTexture(textureLoader, OPTIMIZED_TEXTURES.surfaceMask, {
        anisotropy,
        maxTextureSize,
      }),
      loadManagedTexture(textureLoader, OPTIMIZED_TEXTURES.clouds, {
        anisotropy,
        maxTextureSize,
      }),
    ]);
  return { bumpTexture, cloudTexture, dayTexture, nightTexture, surfaceMaskTexture };
};

const disposeTextures = (textures: GlobeTextureSet): void => {
  textures.bumpTexture.dispose();
  textures.cloudTexture.dispose();
  textures.dayTexture.dispose();
  textures.nightTexture.dispose();
  textures.surfaceMaskTexture.dispose();
};

const createCloudLayer = (context: Readonly<LayerContext>, texture: TextureReference): SceneLayer => {
  const { globeAnchor, globeRadius, qualityTier, uniforms } = context;
  const material = createCloudsMaterial(uniforms, texture);
  const mesh = new Mesh(
    new SphereGeometry(
      globeRadius * CLOUD_RADIUS_FACTOR,
      qualityTier.sphereSegments,
      qualityTier.sphereSegments,
    ),
    material,
  );
  mesh.rotateY(GLOBE_TEXTURE_ROTATION_Y);
  mesh.renderOrder = -1;
  globeAnchor.add(mesh);
  return { material, object: mesh };
};

const createAtmosphereLayer = (context: Readonly<LayerContext>): SceneLayer => {
  const { globeAnchor, globeRadius, qualityTier, uniforms } = context;
  const material = new ShaderMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
    side: BackSide,
    transparent: true,
    uniforms: {
      uLightingMode: uniforms.uLightingMode,
      uSunDirection: uniforms.uSunDirection,
    },
    vertexShader: EARTH_VERTEX_SHADER,
  });
  const mesh = new Mesh(
    new SphereGeometry(
      globeRadius * ATMOSPHERE_RADIUS_FACTOR,
      qualityTier.sphereSegments,
      qualityTier.sphereSegments,
    ),
    material,
  );
  mesh.renderOrder = 1;
  globeAnchor.add(mesh);
  return { material, object: mesh };
};

const bindEarthTextures = (context: Readonly<TextureBindingContext>): Promise<GlobeTextureSet> =>
  loadEarthTextures(context);

const createAnimationControls = (update: () => void): AnimationControls => {
  let disposed = false;
  let animationFrameId = 0;
  const animate = (): void => {
    if (disposed) {
      return;
    }
    update();
    animationFrameId = requestAnimationFrame(animate);
  };
  const stop = (): void => {
    if (animationFrameId === 0) {
      return;
    }
    cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  };
  const start = (): void => {
    if (animationFrameId === 0 && !disposed) {
      animationFrameId = requestAnimationFrame(animate);
    }
  };
  const handleVisibilityChange = (): void => {
    if (document.hidden) {
      stop();
      return;
    }
    start();
  };
  const isDisposed = (): boolean => disposed;
  const dispose = (): void => {
    disposed = true;
    stop();
  };
  return { dispose, handleVisibilityChange, isDisposed, start, stop };
};

const addEarthLayers = (
  context: Readonly<LayerContext>,
  cloudTexture: TextureReference,
): readonly SceneLayer[] => {
  const cloudLayer = createCloudLayer(context, cloudTexture);
  const atmosphereLayer = createAtmosphereLayer(context);
  return [cloudLayer, atmosphereLayer];
};

const applyEarthTextures = (
  context: Readonly<LayerContext>,
  textures: GlobeTextureSet,
  animation: Readonly<AnimationControls>,
): readonly SceneLayer[] | null => {
  if (animation.isDisposed()) {
    disposeTextures(textures);
    return null;
  }
  context.applyTextures(textures);
  return addEarthLayers(context, textures.cloudTexture);
};

const loadTexturesSafely = async (
  load: () => Promise<GlobeTextureSet>,
  onLoaded: (textures: Readonly<GlobeTextureSet>) => void,
): Promise<void> => {
  try {
    const textures = await load();
    onLoaded(textures);
  } catch {
    // The placeholder globe remains usable when optional textures fail.
  }
};

const setupGlobeScene = (
  context: Readonly<SceneSetupContext>,
): (() => void) => {
  const resources = createSceneResources(context);
  const textureLoader = new TextureLoader();
  const layerContext: LayerContext = {
    applyTextures: context.applyTextures,
    globeAnchor: resources.globeAnchor,
    globeRadius: context.globe.getGlobeRadius(),
    qualityTier: resources.qualityTier,
    uniforms: context.uniforms,
  };
  const animation = createAnimationControls(() => {
    context.updateAnimation(resources.clock.getElapsedTime());
  });
  void loadTexturesSafely(
    () => bindEarthTextures({ ...layerContext, renderer: resources.renderer, textureLoader }),
    (textures) => {
      const layers = applyEarthTextures(layerContext, textures, animation);
      if (layers === null) {
        return;
      }
      resources.sceneTextures.push(textures.dayTexture, textures.bumpTexture, textures.nightTexture, textures.surfaceMaskTexture, textures.cloudTexture);
      layers.forEach((layer) => {
        resources.sceneObjects.push(layer.object);
        resources.sceneMaterials.push(layer.material);
      });
    },
  );
  document.addEventListener("visibilitychange", animation.handleVisibilityChange);
  if (!document.hidden) {
    animation.start();
  }
  return () => {
    animation.dispose();
    document.removeEventListener("visibilitychange", animation.handleVisibilityChange);
    resources.scene.remove(resources.ambientLight, resources.hemisphereLight, resources.sunLight);
    resources.sceneObjects.forEach((object) => {
      object.parent?.remove(object);
      object.geometry.dispose();
    });
    resources.sceneMaterials.forEach((material) => {
      material.dispose();
    });
    resources.sceneTextures.forEach((texture) => {
      texture.dispose();
    });
  };
};

export { setupGlobeScene };
