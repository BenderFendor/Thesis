import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  NormalBlending,
  Points,
  PointsMaterial,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderMaterial,
} from "three";
import type { Texture } from "three";
import type {
  TextureLoaderContract,
  GlobeUniforms,
  GlobeUniformView,
  GlobeMaterialSetup,
  GlobeTextureSet,
  TextureReference,
} from "./interactive-globe-visuals-types";
import {
  BUMP_PLACEHOLDER_COLOR,
  CLOUD_PLACEHOLDER_COLOR,
  MIN_TEXTURE_EDGE,
  NIGHT_PLACEHOLDER_COLOR,
  PLACEHOLDER_DAY_COLOR,
  PLACEHOLDER_TEXTURE_HEIGHT,
  PLACEHOLDER_TEXTURE_WIDTH,
  SUN_LIGHT_DIRECTION,
  ZERO_COUNT,
  MASK_PLACEHOLDER_COLOR,
} from "./interactive-globe-visuals-config";
import {
  CLOUD_FRAGMENT_SHADER,
  EARTH_FRAGMENT_SHADER,
  EARTH_VERTEX_SHADER,
} from "./interactive-globe-visuals-shaders";

interface PlaceholderTextures {
  readonly bump: Texture;
  readonly cloud: Texture;
  readonly day: Texture;
  readonly mask: Texture;
  readonly night: Texture;
}

type ManagedTextureImage = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

const applyGlobeTextures = (uniforms: GlobeUniforms, textures: GlobeTextureSet): void => {
  uniforms.uDayTexture.value = textures.dayTexture;
  uniforms.uNightTexture.value = textures.nightTexture;
  uniforms.uBumpTexture.value = textures.bumpTexture;
  uniforms.uSurfaceMask.value = textures.surfaceMaskTexture;
  uniforms.uCloudTexture.value = textures.cloudTexture;
  uniforms.uCloudOffset.value = ZERO_COUNT;
};

const configureTexture = (
  texture: Texture,
  options: Readonly<{ anisotropy: number; color?: boolean }>,
): void => {
  texture.anisotropy = options.anisotropy;
  texture.colorSpace = getTextureColorSpace(options.color);
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
};

const getTextureColorSpace = (color: boolean | undefined) => {
  if (color === true) {
    return SRGBColorSpace;
  }
  return NoColorSpace;
};

const createCloudsMaterial = (
  uniforms: GlobeUniformView,
  cloudTexture: TextureReference,
): ShaderMaterial =>
  new ShaderMaterial({
    blending: NormalBlending,
    depthWrite: false,
    fragmentShader: CLOUD_FRAGMENT_SHADER,
    uniforms: {
      uCloudOffset: uniforms.uCloudOffset,
      uCloudTexture: { value: cloudTexture },
      uLightingMode: uniforms.uLightingMode,
      uSunDirection: uniforms.uSunDirection,
    },
    vertexShader: EARTH_VERTEX_SHADER,
  });

const createPlaceholderTextures = (): PlaceholderTextures => ({
  bump: createPlaceholderTexture(BUMP_PLACEHOLDER_COLOR, {}),
  cloud: createPlaceholderTexture(CLOUD_PLACEHOLDER_COLOR, {}),
  day: createPlaceholderTexture(PLACEHOLDER_DAY_COLOR, { color: true }),
  mask: createPlaceholderTexture(MASK_PLACEHOLDER_COLOR, {}),
  night: createPlaceholderTexture(NIGHT_PLACEHOLDER_COLOR, {}),
});

const createGlobeMaterial = (): GlobeMaterialSetup => {
  const placeholders = createPlaceholderTextures();
  const uniforms: GlobeUniforms = {
    uBumpTexture: { value: placeholders.bump },
    uCloudOffset: { value: ZERO_COUNT },
    uCloudTexture: { value: placeholders.cloud },
    uDayTexture: { value: placeholders.day },
    uLightingMode: { value: ZERO_COUNT },
    uNightTexture: { value: placeholders.night },
    uSunDirection: { value: SUN_LIGHT_DIRECTION },
    uSurfaceMask: { value: placeholders.mask },
    uTime: { value: ZERO_COUNT },
  };
  const material = new ShaderMaterial({
    fragmentShader: EARTH_FRAGMENT_SHADER,
    uniforms: {
      uBumpTexture: uniforms.uBumpTexture,
      uCloudOffset: uniforms.uCloudOffset,
      uCloudTexture: uniforms.uCloudTexture,
      uDayTexture: uniforms.uDayTexture,
      uLightingMode: uniforms.uLightingMode,
      uNightTexture: uniforms.uNightTexture,
      uSunDirection: uniforms.uSunDirection,
      uSurfaceMask: uniforms.uSurfaceMask,
      uTime: uniforms.uTime,
    },
    vertexShader: EARTH_VERTEX_SHADER,
  });
  return {
    material,
    placeholderTextures: [
      placeholders.day,
      placeholders.night,
      placeholders.bump,
      placeholders.mask,
      placeholders.cloud,
    ],
    uniforms,
  };
};

const createPlaceholderTexture = (
  color: Readonly<readonly [number, number, number, number]>,
  options: Readonly<{ color?: boolean }>,
): Texture => {
  const texture = new DataTexture(
    new Uint8Array(color),
    PLACEHOLDER_TEXTURE_WIDTH,
    PLACEHOLDER_TEXTURE_HEIGHT,
    RGBAFormat,
  );
  configureTexture(texture, { anisotropy: 1, color: options.color });
  return texture;
};

const createStarColors = (count: number): Float32Array => {
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const brightness = 0.55 + Math.random() * 0.4,
      cursor = index * 3,
      warmth = Math.random() * 0.08;
    colors[cursor] = brightness;
    colors[cursor + 1] = brightness - warmth * 0.5;
    colors[cursor + 2] = brightness + warmth;
  }
  return colors;
};

const createStarPositions = (count: number, spread: number): Float32Array => {
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const cursor = index * 3;
    positions[cursor] = (Math.random() - 0.5) * spread;
    positions[cursor + 1] = (Math.random() - 0.5) * spread;
    positions[cursor + 2] = (Math.random() - 0.5) * spread;
  }
  return positions;
};

const createStarField = (count: number, spread: number): Points<BufferGeometry, PointsMaterial> => {
  const colors = createStarColors(count);
  const positions = createStarPositions(count, spread);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  const material = new PointsMaterial({
    depthWrite: false,
    opacity: 0.72,
    size: 1.15,
    sizeAttenuation: true,
    transparent: true,
    vertexColors: true,
  });

  return new Points(geometry, material);
};

const resizeTexture = (
  texture: Texture,
  options: Readonly<{ maxTextureSize: number }>,
): Texture => {
  const sourceImage = getTextureImage(texture);
  if (
    sourceImage === null ||
    (sourceImage.width <= options.maxTextureSize && sourceImage.height <= options.maxTextureSize)
  ) {
    return texture;
  }
  const canvas = createTextureCanvas(sourceImage.width, sourceImage.height, options.maxTextureSize);
  const context = canvas.getContext("2d");
  if (context === null) {
    return texture;
  }
  context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
  texture.dispose();
  return new CanvasTexture(canvas);
};

const getTextureImage = (texture: Readonly<{ readonly image: unknown }>): ManagedTextureImage | null => {
  const sourceImage: unknown = texture.image;
  if (
    sourceImage instanceof HTMLImageElement ||
    sourceImage instanceof HTMLCanvasElement ||
    sourceImage instanceof ImageBitmap
  ) {
    return sourceImage;
  }
  return null;
};

const createTextureCanvas = (
  width: number,
  height: number,
  maxTextureSize: number,
): HTMLCanvasElement => {
  const canvas = document.createElement("canvas"),
    scale = Math.min(maxTextureSize / width, maxTextureSize / height);
  canvas.width = Math.max(MIN_TEXTURE_EDGE, Math.floor(width * scale));
  canvas.height = Math.max(MIN_TEXTURE_EDGE, Math.floor(height * scale));
  return canvas;
};

const loadManagedTexture = async (
  textureLoader: TextureLoaderContract,
  path: string,
  options: Readonly<{ anisotropy: number; color?: boolean; maxTextureSize: number }>,
): Promise<Texture> => {
  let texture = await textureLoader.loadAsync(path);
  texture = resizeTexture(texture, options);
  configureTexture(texture, { anisotropy: options.anisotropy, color: options.color });
  return texture;
};
export {
  applyGlobeTextures,
  createCloudsMaterial,
  createGlobeMaterial,
  createStarField,
  loadManagedTexture,
};
