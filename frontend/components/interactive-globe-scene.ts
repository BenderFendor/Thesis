import { useEffect } from "react";
import { applyGlobeTextures, updateAnimationUniforms } from "./interactive-globe-visuals";
import type { GlobeUniformView } from "./interactive-globe-visuals";
import type { GlobeInstance } from "./interactive-globe-types";
import { setupGlobeScene } from "./interactive-globe-scene-setup";

interface SceneContainerRef {
  readonly current: HTMLDivElement | null;
}

interface GlobeSceneContext {
  readonly containerRef: SceneContainerRef;
  readonly globeInstance: Readonly<GlobeInstance> | null;
  readonly globeUniforms: GlobeUniformView;
}

const useGlobeScene = (context: Readonly<GlobeSceneContext>): void => {
  const { containerRef, globeInstance, globeUniforms } = context;
  useEffect(() => {
    if (globeInstance === null) {
      return () => {};
    }
    return setupGlobeScene({
      applyTextures: (textures) => {
        applyGlobeTextures(globeUniforms, textures);
      },
      container: containerRef.current,
      globe: globeInstance,
      uniforms: globeUniforms,
      updateAnimation: (elapsedTime) => {
        updateAnimationUniforms(globeUniforms, elapsedTime);
      },
    });
  }, [containerRef, globeInstance, globeUniforms]);
};

export { useGlobeScene };
