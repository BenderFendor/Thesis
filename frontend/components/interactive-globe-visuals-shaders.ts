const ATMOSPHERE_FRAGMENT_SHADER = `
  uniform vec3 uSunDirection;
  uniform float uLightingMode;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  #include <common>

  float clamp01(float value) {
    return clamp(value, 0.0, 1.0);
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 sunDirection = normalize(uSunDirection);

    float horizon = pow(1.0 - clamp01(dot(normal, viewDirection)), 3.4);
    float sunFacing = clamp01(dot(normal, sunDirection));
    float lightingMix = clamp01(uLightingMode);
    float forwardScatter = pow(clamp01(dot(viewDirection, sunDirection)), 6.0) * lightingMix;

    float alpha = mix(
      horizon * 0.26,
      horizon * (0.18 + sunFacing * 0.72) + horizon * forwardScatter * 0.12,
      lightingMix
    );
    vec3 color = mix(
      vec3(0.18, 0.42, 0.74),
      mix(vec3(0.08, 0.24, 0.52), vec3(0.44, 0.74, 1.0), sunFacing),
      lightingMix
    );

    gl_FragColor = vec4(color, alpha * 0.68);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const CLOUD_FRAGMENT_SHADER = `
  uniform sampler2D uCloudTexture;
  uniform vec3 uSunDirection;
  uniform float uCloudOffset;
  uniform float uLightingMode;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  #include <common>

  float clamp01(float value) {
    return clamp(value, 0.0, 1.0);
  }

  float luma(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 sunDirection = normalize(uSunDirection);

    vec2 cloudUv = vec2(vUv.x + uCloudOffset, vUv.y);
    float cloudMask = smoothstep(0.24, 0.8, luma(texture2D(uCloudTexture, cloudUv).rgb));
    float daylight = clamp01(dot(normal, sunDirection));
    float lightingMix = clamp01(uLightingMode);
    float rim = pow(1.0 - clamp01(dot(normal, viewDirection)), 3.0);
    float silverLining = pow(clamp01(dot(reflect(-sunDirection, normal), viewDirection)), 6.0);

    vec3 litColor = mix(vec3(0.08, 0.10, 0.14), vec3(0.92, 0.96, 1.0), 0.18 + daylight * 0.82);
    vec3 allLitColor = mix(vec3(0.72, 0.78, 0.84), vec3(0.96, 0.98, 1.0), 0.46 + rim * 0.24);
    vec3 color = mix(allLitColor, litColor, lightingMix);
    color += vec3(0.28, 0.36, 0.48) * rim * 0.25;
    color += vec3(1.0) * silverLining * mix(0.08, 0.18, lightingMix);

    float alpha = cloudMask * mix(0.22 + rim * 0.1, 0.16 + daylight * 0.42 + rim * 0.14, lightingMix);
    if (alpha < 0.01) discard;

    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const EARTH_FRAGMENT_SHADER = `
  uniform sampler2D uDayTexture;
  uniform sampler2D uNightTexture;
  uniform sampler2D uBumpTexture;
  uniform sampler2D uSurfaceMask;
  uniform sampler2D uCloudTexture;
  uniform vec3 uSunDirection;
  uniform float uTime;
  uniform float uCloudOffset;
  uniform float uLightingMode;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  #include <common>

  float clamp01(float value) {
    return clamp(value, 0.0, 1.0);
  }

  float luma(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 sunDirection = normalize(uSunDirection);

    vec2 surfaceUv = vUv;
    vec2 cloudUv = vec2(vUv.x + uCloudOffset, vUv.y);

    vec3 dayColor = texture2D(uDayTexture, surfaceUv).rgb;
    float terrainHeight = texture2D(uBumpTexture, surfaceUv).r;
    float landMask = texture2D(uSurfaceMask, surfaceUv).r;
    float oceanMask = 1.0 - landMask;
    float nightMask = texture2D(uNightTexture, surfaceUv).r;
    float cloudMask = smoothstep(0.28, 0.82, luma(texture2D(uCloudTexture, cloudUv).rgb));
    float lightingMix = clamp01(uLightingMode);

    float sunFacing = dot(normal, sunDirection);
    float daylight = smoothstep(-0.18, 0.22, sunFacing);
    float diffuse = smoothstep(-0.08, 0.8, sunFacing);
    float displayDaylight = mix(1.0, daylight, lightingMix);
    float nightSide = (1.0 - daylight) * lightingMix;

    float viewFacing = clamp01(dot(normal, viewDirection));
    float fresnel = pow(1.0 - viewFacing, 5.0);
    float microWaves = 0.94 + 0.06 * sin(surfaceUv.x * 320.0 + uTime * 0.28) * sin(surfaceUv.y * 180.0 - uTime * 0.2);
    float terrainAccent = smoothstep(0.26, 0.78, terrainHeight);

    vec3 landDay = mix(dayColor, vec3(luma(dayColor)), 0.05);
    landDay *= mix(1.02 + terrainAccent * 0.08, 0.9 + diffuse * 0.16 + terrainAccent * 0.12, lightingMix);

    vec3 oceanDay = mix(dayColor, dayColor * vec3(0.18, 0.44, 0.84), 0.22);
    oceanDay = mix(oceanDay, vec3(0.006, 0.038, 0.11), 0.34);
    oceanDay *= mix(0.84, 0.35 + diffuse * 0.58, lightingMix);

    vec3 daySurface = mix(oceanDay, landDay, landMask);
    daySurface *= 1.0 - cloudMask * mix(0.06, daylight * 0.16, lightingMix);

    vec3 nightBase = mix(dayColor * 0.03, vec3(0.003, 0.005, 0.01), 0.55);
    vec3 cityLights = vec3(1.08, 0.77, 0.46) * pow(nightMask, 1.35) * nightSide * landMask * 1.85;

    vec3 halfVector = normalize(sunDirection + viewDirection);
    float specular = pow(clamp01(dot(normal, halfVector)), mix(220.0, 180.0, lightingMix));
    float specularStrength = mix(0.012 + fresnel * 0.08, mix(0.04, 0.58, fresnel), lightingMix);
    float oceanSpecular = specular * oceanMask * mix(0.35, daylight, lightingMix) * microWaves * specularStrength * 0.82;

    float twilight = smoothstep(-0.22, 0.02, sunFacing) * (1.0 - smoothstep(0.02, 0.22, sunFacing));
    twilight *= (0.45 + 0.55 * fresnel) * lightingMix;
    vec3 twilightColor = vec3(0.94, 0.39, 0.08) * twilight * 0.55;

    vec3 atmosphereWrap = mix(
      vec3(0.06, 0.12, 0.22) * fresnel * 0.16,
      vec3(0.10, 0.18, 0.32) * fresnel * daylight * 0.18,
      lightingMix
    );

    vec3 color = mix(nightBase, daySurface, displayDaylight);
    color += cityLights;
    color += vec3(oceanSpecular);
    color += twilightColor;
    color += atmosphereWrap;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const EARTH_VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export {
  ATMOSPHERE_FRAGMENT_SHADER,
  CLOUD_FRAGMENT_SHADER,
  EARTH_FRAGMENT_SHADER,
  EARTH_VERTEX_SHADER
};
