import { describe, expect, it } from "@jest/globals";
import { Texture } from "three";

import { applyGlobeTextures, createGlobeMaterial } from "@/components/interactive-globe-visuals-materials";

describe("globe material lifecycle", () => {
  it("replaces placeholders without breaking shared animation and lighting uniforms", () => {
    const globe = createGlobeMaterial();
    const textures = {
      bumpTexture: new Texture(),
      cloudTexture: new Texture(),
      dayTexture: new Texture(),
      nightTexture: new Texture(),
      surfaceMaskTexture: new Texture(),
    };
    applyGlobeTextures(globe.uniforms, textures);
    globe.uniforms.uLightingMode.value = 1;
    globe.uniforms.uCloudOffset.value = 0.25;

    expect(globe.material.uniforms).toMatchObject({
      uBumpTexture: { value: textures.bumpTexture },
      uCloudOffset: { value: 0.25 },
      uCloudTexture: { value: textures.cloudTexture },
      uDayTexture: { value: textures.dayTexture },
      uLightingMode: { value: 1 },
      uNightTexture: { value: textures.nightTexture },
      uSurfaceMask: { value: textures.surfaceMaskTexture },
    });

    expect(globe.placeholderTextures).toHaveLength(5);
  });
});
