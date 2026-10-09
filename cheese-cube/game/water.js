import * as THREE from 'three';

// WebGL reconstruction of the original flow material using its own textures and
// four authored scrolling layers. Only shading moves: the lethal surface stays flat.
export class WaterSurface {
  constructor() { this.time = {value: 0}; this.material = null; this.textures = {}; }

  async load({world, base, config, manager, environment}) {
    if (!config) return;
    const loader = new THREE.TextureLoader(manager);
    await Promise.all(Object.entries(config.textures).map(async ([role, file]) => {
      const texture = await loader.loadAsync(`${base}/${file}`);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = role === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.flipY = false;
      texture.anisotropy = 4;
      this.textures[role] = texture;
    }));
    const t = this.textures, p = config.parameters;
    const material = new THREE.MeshPhysicalMaterial({
      name: config.material, map: t.color, normalMap: t.normal,
      normalScale: new THREE.Vector2(.45, .45), roughness: .24, metalness: 0, ior: 1.333,
      envMap: environment, envMapIntensity: .45, side: THREE.DoubleSide,
      transparent: false, depthWrite: true,
    });
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, {
        waterTime: this.time, waterFlow: {value: t.flow}, waterNoise: {value: t.noise}, waterFoam: {value: t.foam},
        waterScroll01: {value: new THREE.Vector4(...p.scroll01)}, waterScroll23: {value: new THREE.Vector4(...p.scroll23)},
        waterScale01: {value: new THREE.Vector4(...p.scale01)}, waterScale23: {value: new THREE.Vector4(...p.scale23)},
      });
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 waterWorld;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nwaterWorld = (modelMatrix * vec4(position, 1.0)).xz * vec2(1.0, -1.0);');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec2 waterWorld;
        uniform float waterTime;
        uniform sampler2D waterFlow, waterNoise, waterFoam;
        uniform vec4 waterScroll01, waterScroll23, waterScale01, waterScale23;
      `).replace('#include <map_fragment>', `
        vec2 flow = texture2D(waterFlow, vMapUv * .2).rg * 2.0 - 1.0;
        float phase = fract(waterTime * .08 + texture2D(waterNoise, vMapUv * .25).r);
        float phaseB = fract(phase + .5);
        float blend = abs(phase * 2.0 - 1.0);
        vec2 driftA = flow * .04 * phase, driftB = flow * .04 * phaseB;
        vec4 waterColor = mix(texture2D(map, vMapUv + driftA), texture2D(map, vMapUv + driftB), blend);
        float foam = texture2D(waterFoam, vMapUv + driftA).r;
        diffuseColor.rgb *= waterColor.rgb * (1.0 + foam * .4);
      `).replace('#include <normal_fragment_maps>', `
        vec2 waterNormal = texture2D(normalMap, waterWorld * waterScale01.xy + waterScroll01.xy * waterTime + driftA).rg;
        waterNormal += texture2D(normalMap, waterWorld * waterScale01.zw + waterScroll01.zw * waterTime + driftB).rg;
        waterNormal += texture2D(normalMap, waterWorld * waterScale23.xy + waterScroll23.xy * waterTime - driftA).rg;
        waterNormal += texture2D(normalMap, waterWorld * waterScale23.zw + waterScroll23.zw * waterTime - driftB).rg;
        waterNormal = (waterNormal * .5 - 1.0) * normalScale;
        vec3 mapN = vec3(waterNormal, sqrt(max(.001, 1.0 - dot(waterNormal, waterNormal))));
        normal = normalize(tbn * mapN);
      `);
    };
    material.customProgramCacheKey = () => 'cheese-water-flow-v1';
    this.material = material;
    for (const piece of world.byTarget.get('rising_brush') ?? []) piece.traverse(object => {
      if (object.isMesh) object.material = material;
    });
  }

  update(seconds) { this.time.value = seconds; }
  reset() { this.update(0); }
}
