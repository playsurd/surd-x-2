import * as THREE from 'three';

// T5 renders the world through per-area volumetric fog (setVolFogForClient),
// a vision set (r_film* grading, r_sCurve* filmic curve, r_bloom*) and an HDR
// sky cubemap whose night and day halves are selected by r_skyTransition.
// Sources: clientscripts/zombie_moon.csc, zombie_moon_fx.csc, vision/*.vision.

// cg_fov is a horizontal angle on a 4:3 basis (Hor+); return the vertical FOV.
export const t5Fov = (fov = 65) => 2*THREE.MathUtils.radToDeg(Math.atan(.75*Math.tan(THREE.MathUtils.degToRad(fov)/2)));
const browser = v => new THREE.Vector3(v[0], v[2], -v[1]);
// AnglesToForward(pitch, yaw) in the browser basis.
const forward = (pitch, yaw) => { const p = THREE.MathUtils.degToRad(pitch), y = THREE.MathUtils.degToRad(yaw); return browser([Math.cos(p)*Math.cos(y), Math.cos(p)*Math.sin(y), -Math.sin(p)]); };
// Script-model angles, conjugated into the y-up basis exactly as compose_scene_t5.py does.
export function gameMatrix(origin, angles, scale = 1) {
  const [pitch, yaw, roll] = angles.map(THREE.MathUtils.degToRad), cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const axes = [[cy*cp, sy*cp, -sp], [cy*sp*sr-sy*cr, sy*sp*sr+cy*cr, cp*sr], [cy*sp*cr+sy*sr, sy*sp*cr-cy*sr, cp*cr]], rot = v => [v[0], v[2], -v[1]];
  const cols = [rot(axes[0]), rot(axes[2]), rot(axes[1]).map(c => -c)];
  return new THREE.Matrix4().fromArray([...cols[0].map(c => c*scale), 0, ...cols[1].map(c => c*scale), 0, ...cols[2].map(c => c*scale), 0, origin[0], origin[2], -origin[1], 1]);
}
// Black-body colour (Tanner Helland fit) relative to 6500K: lower values warm the image.
function kelvin(k) {
  const t = k/100, c = [t <= 66 ? 1 : 329.698727446*Math.pow(t-60, -.1332047592)/255,
    t <= 66 ? (99.4708025861*Math.log(t)-161.1195681661)/255 : 288.1221695283*Math.pow(t-60, -.0755148492)/255,
    t >= 66 ? 1 : t <= 19 ? 0 : (138.5177312231*Math.log(t-10)-305.0447927307)/255];
  return c.map(v => THREE.MathUtils.clamp(v, 0, 1));
}
const WHITE = kelvin(6500), temperature = k => kelvin(k).map((v, i) => v/WHITE[i]);

// The sCurve dvars are Hable's filmic operator (shoulder, linear, angle, toe
// strength/numerator/denominator). The vision files carry no white point or
// exposure, so these two constants calibrate the HDR scale of the browser lights.
const WHITE_POINT = 11.2, EXPOSURE = 2.2, UNLIT_SCALE = 2.4;
const hable = (p, x) => ((x*(p[0]*x+p[2]*p[1])+p[3]*p[4])/(x*(p[0]*x+p[1])+p[3]*p[5]))-p[4]/p[5];

const uniforms = {
  moonFogA: {value: new THREE.Vector4()}, moonFogColor: {value: new THREE.Vector4()}, moonFogSun: {value: new THREE.Vector4()}, moonFogSunDir: {value: new THREE.Vector4()},
  moonCurveA: {value: new THREE.Vector4()}, moonCurveB: {value: new THREE.Vector4()}, moonFilmRange: {value: new THREE.Vector4()},
  moonFilmDark: {value: new THREE.Vector3(1, 1, 1)}, moonFilmMid: {value: new THREE.Vector3(1, 1, 1)}, moonFilmLight: {value: new THREE.Vector3(1, 1, 1)},
  moonFilmSat: {value: new THREE.Vector3(1, 1, 1)}, moonFilmContrast: {value: new THREE.Vector3(1, 1, 1)}, moonFilmBleach: {value: new THREE.Vector3()}, moonFilmEnable: {value: new THREE.Vector2(1, 1)},
  moonBrowserTone: {value: 0},
};
export const moonUniforms = uniforms;
// Every Moon material receives the shared fog/grading uniforms; materials with
// their own onBeforeCompile call this hook themselves.
export function moonShaderHook(shader) { Object.assign(shader.uniforms, uniforms); }
THREE.Material.prototype.onBeforeCompile = moonShaderHook;

const GRADE = `
uniform vec4 moonCurveA, moonCurveB, moonFilmRange;
uniform vec3 moonFilmDark, moonFilmMid, moonFilmLight, moonFilmSat, moonFilmContrast, moonFilmBleach;
uniform vec2 moonFilmEnable;
uniform float moonBrowserTone;
vec3 moonCurve(vec3 x) {
  float A = moonCurveA.x, B = moonCurveA.y, C = moonCurveA.z, D = moonCurveA.w, E = moonCurveB.x, F = moonCurveB.y;
  return ((x*(A*x+C*B)+D*E)/(x*(A*x+B)+D*F))-E/F;
}
vec3 moonFilm(vec3 c, vec3 gain, float sat, float contrast, float bleach) {
  float l = dot(c, vec3(.2126, .7152, .0722));
  c = mix(vec3(l), c, sat)*gain;
  c = (c-.5)*contrast+.5;
  l = dot(c, vec3(.2126, .7152, .0722));
  vec3 b = mix(2.*c*l, 1.-2.*(1.-c)*(1.-l), step(.5, l));
  return mix(c, b, bleach);
}
vec3 moonTone(vec3 color) {
  vec3 browserColor = ACESFilmicToneMapping(max(color, 0.));
  color = max(color*moonCurveB.w, 0.);
  vec3 nativeColor = clamp(moonFilmEnable.y > .5 ? moonCurve(color)*moonCurveB.z : color/(1.+color), 0., 1.);
  return mix(nativeColor, browserColor, moonBrowserTone);
}
vec3 moonFilmGrade(vec3 color) {
  if (moonFilmEnable.x < .5) return color;
  vec3 g = pow(color, vec3(1./2.2));
  float l = dot(g, vec3(.2126, .7152, .0722));
  float dark = 1.-smoothstep(moonFilmRange.x*(1.-moonFilmRange.z), moonFilmRange.x+1e-4, l);
  float light = smoothstep(moonFilmRange.y, mix(moonFilmRange.y, 1., moonFilmRange.w)+1e-4, l);
  float mid = max(0., 1.-dark-light);
  g = dark*moonFilm(g, moonFilmDark, moonFilmSat.x, moonFilmContrast.x, moonFilmBleach.x)
    + mid*moonFilm(g, moonFilmMid, moonFilmSat.y, moonFilmContrast.y, moonFilmBleach.y)
    + light*moonFilm(g, moonFilmLight, moonFilmSat.z, moonFilmContrast.z, moonFilmBleach.z);
  return pow(clamp(g, 0., 1.), vec3(2.2));
}`;
// Volumetric fog: density halves every halfway distance at base height and
// every halfway height above it; integrated analytically along the view ray.
const FOG = `
#ifdef USE_FOG
varying vec3 vMoonFogPos;
uniform vec4 moonFogA, moonFogColor, moonFogSun, moonFogSunDir;
float moonFogG(float x) { return x < 0. ? x : moonFogA.z*1.442695*(1.-exp2(-x/moonFogA.z)); }
vec3 moonApplyFog(vec3 color) {
  if (moonFogA.y <= 0.) return color;
  vec3 ray = vMoonFogPos-cameraPosition; float dist = length(ray), travel = dist-moonFogA.x;
  if (travel <= 0.) return color;
  vec3 dir = ray/dist;
  float a = cameraPosition.y+dir.y*moonFogA.x-moonFogA.w, b = vMoonFogPos.y-moonFogA.w;
  float density = abs(b-a) > 1. ? (moonFogG(b)-moonFogG(a))/(b-a) : exp2(-max(a, 0.)/moonFogA.z);
  float fog = min(1.-exp2(-travel*density/moonFogA.y), moonFogColor.a);
  #ifdef MOON_ADDITIVE
  return color*(1.-fog);
  #else
  return mix(color, mix(moonFogColor.rgb, moonFogSun.rgb, smoothstep(moonFogSunDir.w, moonFogSun.w, dot(dir, moonFogSunDir.xyz))), fog);
  #endif
}
#endif`;
const chunks = THREE.ShaderChunk;
chunks.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying vec3 vMoonFogPos;\n#endif';
chunks.fog_vertex = '#ifdef USE_FOG\n\tvMoonFogPos = cameraPosition + ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;\n#endif';
chunks.fog_pars_fragment = FOG;
chunks.fog_fragment = '';
// Apply fog before tone mapping so the HDR fog colour is graded like the scene.
chunks.tonemapping_fragment = '#ifdef USE_FOG\n\tgl_FragColor.rgb = moonApplyFog( gl_FragColor.rgb );\n#endif\n' + chunks.tonemapping_fragment;
chunks.tonemapping_pars_fragment = chunks.tonemapping_pars_fragment.replace('vec3 CustomToneMapping( vec3 color ) { return color; }', GRADE + '\nvec3 CustomToneMapping( vec3 color ) { return moonFilmGrade( moonTone( color ) ); }');

const SKY_VERTEX = `varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position, 1.); gl_Position.z = gl_Position.w; }`;
// mc_sky_cubemap_hdr_cl1: cube lookup in game space rotated by skyBoxRotationSize
// (sin, cos, -sin); r_skyTransition turns the cube 180 degrees about its Y axis so
// the day hemisphere is overhead. The cl1 layer adds masked stars_a twinkle.
const SKY_FRAGMENT = `uniform samplerCube moonSky; uniform sampler2D moonStars, moonStarMask;
uniform vec4 moonSkyRot; uniform vec3 moonSkyTint; uniform float moonSkyTransition, moonSkyTime; uniform vec4 moonSkyStars;
varying vec3 vDir;
void main() {
  vec3 g = normalize(vec3(vDir.x, -vDir.z, vDir.y));
  vec3 c = vec3(dot(g.xy, moonSkyRot.yz), dot(g.xy, moonSkyRot.xy), g.z);
  float a = 3.14159265*moonSkyTransition, ca = cos(a), sa = sin(a);
  c = vec3(ca*c.x+sa*c.z, c.y, ca*c.z-sa*c.x);
  vec3 color = textureCube(moonSky, c).rgb;
  float night = (1.-moonSkyTransition)*clamp(g.z*moonSkyStars.y+moonSkyStars.x, 0., 1.);
  if (night > 0.) {
    vec2 uv = g.xy/max(g.z, .08)*moonSkyStars.z;
    color += texture2D(moonStars, uv).a*texture2D(moonStarMask, uv*.5+moonSkyTime*moonSkyStars.w).r*night;
  }
  gl_FragColor = vec4(color*moonSkyTint, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const QUAD_VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
const BRIGHT = `uniform sampler2D tColor; uniform vec2 texel; uniform vec3 moonBloomScale; uniform vec4 moonBloomCurve; varying vec2 vUv;
#include <tonemapping_pars_fragment>
void main() {
  vec3 c = .25*(texture2D(tColor, vUv+texel*vec2(-1., -1.)).rgb+texture2D(tColor, vUv+texel*vec2(1., -1.)).rgb+texture2D(tColor, vUv+texel*vec2(-1., 1.)).rgb+texture2D(tColor, vUv+texel).rgb);
  c = moonTone(c);
  float bp = moonBloomCurve.x;
  vec3 lo = pow(clamp(c/bp, 0., 1.), vec3(moonBloomCurve.y))*bp, hi = bp+pow(clamp((c-bp)/(1.-bp), 0., 1.), vec3(moonBloomCurve.z))*(1.-bp);
  gl_FragColor = vec4(mix(lo, hi, step(bp, c))*moonBloomScale, 1.);
}`;
const BLUR = `uniform sampler2D tColor; uniform vec2 direction; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb*.2270270270;
  c += (texture2D(tColor, vUv+direction*1.3846153846).rgb+texture2D(tColor, vUv-direction*1.3846153846).rgb)*.3162162162;
  c += (texture2D(tColor, vUv+direction*3.2307692308).rgb+texture2D(tColor, vUv-direction*3.2307692308).rgb)*.0702702703;
  gl_FragColor = vec4(c, 1.);
}`;
const FINAL = `uniform sampler2D tColor, tBloom; uniform float bloomOn; varying vec2 vUv;
#include <tonemapping_pars_fragment>
void main() {
  vec3 c = moonTone(texture2D(tColor, vUv).rgb);
  if (bloomOn > .5) c = min(c+texture2D(tBloom, vUv).rgb, 1.);
  gl_FragColor = vec4(moonFilmGrade(c), 1.);
  #include <colorspace_fragment>
}`;

const AREA_FOG = {exterior: 'exterior', interior: 'interior', biodome: 'biodome', tunnels: 'tunnels', nml: 'nml'};
const lerp = (a, b, t) => Array.isArray(a) ? a.map((v, i) => lerp(v, b[i], t)) : a+(b-a)*t;

export class MoonRender {
  constructor(renderer, scene, camera, {mobile = false, sun = null, ambient = null, hemisphere = null, fill = null, viewScene = null, shadowParts = []} = {}) {
    Object.assign(this, {renderer, scene, camera, mobile, sun});
    // The lunar rooms still depend on broad fill until their native lightmaps
    // are restored. Daylight in the yard needs a much lower indirect floor.
    this.lighting = [ambient, hemisphere, fill, viewScene?.children.find(o => o.isAmbientLight), viewScene?.children.find(o => o.isDirectionalLight)]
      .map((light, i) => ({light, lunar: light?.intensity, daylight: [.035, .18, .04, .2, 2.4][i]}));
    this.shadowParts = shadowParts.filter(p => p.object && p.entity.position[0] > 8000);
    this.area = null; this.areaVision = null; this.visions = [{name: 'base', code: null, priority: 0}]; this.grade = null; this.blend = null;
    this.transition = 1; this.destroyed = false; this.time = 0; this.lunar = false; this.previousFeet = null; this.ending = false;
    renderer.toneMapping = mobile ? THREE.CustomToneMapping : THREE.NoToneMapping;
    renderer.info.autoReset = false;
    scene.background = null;
    scene.fog = new THREE.Fog(0, 1, 2);
  }
  async load(data) {
    const [atmosphere] = await Promise.all([fetch('moon/atmosphere.json').then(r => { if (!r.ok) throw new Error('Moon atmosphere data is missing. Run .tools/build_moon_atmosphere.py.'); return r.json(); })]);
    this.data = atmosphere;
    this.triggers = data.entities.filter(e => atmosphere.triggers[e.targetname] && e.bounds).map(e => ({id: e.id, area: atmosphere.triggers[e.targetname], time: Number(e.script_int ?? 0),
      box: new THREE.Box3(new THREE.Vector3(...e.bounds[0]), new THREE.Vector3(...e.bounds[1])), earth: e.bounds[0][0] > 8000}));
    const world = data.entities.find(e => e.classname === 'worldspawn') ?? {};
    this.worldSun = {sunlight: Number(world.sunlight ?? 16), sundirection: (world.sundirection ?? '-16.28 56.06 0').split(' ').map(Number), suncolor: (world.suncolor ?? '.84 .89 .89').split(' ').map(Number)};
    this.sunState = {...atmosphere.fog.moon};
    this.skyTemp = 6400; this.skyFactor = 1;
    const loader = new THREE.TextureLoader(), faces = ['px', 'nx', 'py', 'ny', 'pz', 'nz'].map(f => `moon/textures/sky/skybox_zom_moon_${f}.png`);
    const [cube, stars, mask, earth, destroyed] = await Promise.all([new THREE.CubeTextureLoader().loadAsync(faces),
      ...['sky/stars_a', 'sky/skybox_night_stars_mask', 'moon_vista_earth_c', 'moon_vista_earth_destroyed'].map(n => loader.loadAsync(`moon/textures/${n}.png`))]);
    cube.colorSpace = earth.colorSpace = destroyed.colorSpace = THREE.SRGBColorSpace; mask.colorSpace = stars.colorSpace = THREE.NoColorSpace;
    stars.wrapS = stars.wrapT = mask.wrapS = mask.wrapT = THREE.RepeatWrapping;
    const sky = atmosphere.sky, rotation = sky.skyBoxRotationSize, feather = sky.cloudsFeather, mul = sky.cloudsUVMul1;
    this.skyUniforms = {moonSky: {value: cube}, moonStars: {value: stars}, moonStarMask: {value: mask}, moonSkyRot: {value: new THREE.Vector4(...rotation)},
      moonSkyTint: {value: new THREE.Vector3(1, 1, 1)}, moonSkyTransition: {value: 1}, moonSkyTime: {value: 0},
      moonSkyStars: {value: new THREE.Vector4(feather[0], feather[1], sky.cloudsHeights[0]*mul[0], mul[2]*1000)}};
    this.skyScene = new THREE.Scene(); this.skyCamera = new THREE.PerspectiveCamera(this.camera.fov, this.camera.aspect, 10, 400000);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), new THREE.ShaderMaterial({uniforms: this.skyUniforms, vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: THREE.BackSide, depthTest: false, depthWrite: false}));
    this.sky.frustumCulled = false; this.skyScene.add(this.sky);
    // p_zom_moon_earth(_dest): 37,500-unit quads (mc_unlit_blend, alphaTest GT0) spawned at the
    // source origin and angles by do_show_earth/do_show_destroyed_earth.
    const quad = (x = 0, dy = 0) => new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([x, -18750+dy, 18750, x, 18750+dy, -18750, x, 18750+dy, 18750, x, -18750+dy, -18750].flatMap((v, i, a) => i%3 ? [] : [a[i], a[i+2], -a[i+1]]), 3))
      .setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 1, 0, 1, 1, 0], 2)).setIndex([0, 1, 2, 0, 3, 1]);
    const material = map => new THREE.MeshBasicMaterial({map, color: new THREE.Color(UNLIT_SCALE, UNLIT_SCALE, UNLIT_SCALE), transparent: true, alphaTest: 1/255, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false});
    this.earth = new THREE.Group(); this.earth.matrixAutoUpdate = false;
    this.earth.matrix.copy(gameMatrix([-22060.8, -121800, 34463.4], [18, 78, 22]));
    this.earthModel = new THREE.Mesh(quad(), material(earth)); this.earthDestroyed = new THREE.Mesh(quad(326.293, -1530.3), material(destroyed));
    this.earthModel.renderOrder = 1; this.earthDestroyed.renderOrder = 2; this.earthDestroyed.visible = false;
    this.earth.add(this.earthModel, this.earthDestroyed); this.skyScene.add(this.earth);
    this.createSunShadows();
    if (!this.mobile) this.createPost();
    this.applyArea(this.mobile ? 'nml' : 'nml', 0);
  }
  createSunShadows() {
    if (!this.sun) return;
    // A cached yard shadow map supplies the missing lightmapped sun occlusion.
    // Only existing world geometry casts; actors added later do not leave stale
    // silhouettes in the cache. Refresh when a yard gate/door moves or on travel.
    this.scene.traverseVisible(object => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      object.castShadow = materials.every(m => !m.transparent && !/sky|decal|water|lightshaft/i.test(m.name));
      object.receiveShadow = true;
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const shadow = this.sun.shadow;
    shadow.mapSize.set(this.mobile ? 1024 : 2048, this.mobile ? 1024 : 2048);
    Object.assign(shadow.camera, {left: -1800, right: 1800, top: 1800, bottom: -1800, near: 1, far: 8000});
    shadow.camera.updateProjectionMatrix();
    shadow.bias = -.0001; shadow.normalBias = 1.5;
    shadow.autoUpdate = false;
    this.scene.add(this.sun.target);
  }
  createPost() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2()), half = this.renderer.extensions.has('EXT_color_buffer_half_float') || this.renderer.extensions.has('EXT_color_buffer_float');
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, {type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: 4, colorSpace: THREE.LinearSRGBColorSpace});
    const small = () => new THREE.WebGLRenderTarget(1, 1, {type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: false});
    this.bloomA = small(); this.bloomB = small();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const pass = (fragmentShader, extra) => { const m = new THREE.ShaderMaterial({uniforms: {...uniforms, ...extra}, vertexShader: QUAD_VERTEX, fragmentShader, depthTest: false, depthWrite: false}); const s = new THREE.Scene(), q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m); q.frustumCulled = false; s.add(q); return {scene: s, material: m}; };
    this.bright = pass(BRIGHT, {tColor: {value: null}, texel: {value: new THREE.Vector2()}, moonBloomScale: {value: new THREE.Vector3()}, moonBloomCurve: {value: new THREE.Vector4()}});
    this.blur = pass(BLUR, {tColor: {value: null}, direction: {value: new THREE.Vector2()}});
    this.final = pass(FINAL, {tColor: {value: this.target.texture}, tBloom: {value: this.bloomA.texture}, bloomOn: {value: 0}});
    this.resize();
  }
  resize() {
    if (!this.target) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target.setSize(size.x, size.y);
    const w = Math.max(1, Math.round(size.x/4)), h = Math.max(1, Math.round(size.y/4));
    this.bloomA.setSize(w, h); this.bloomB.setSize(w, h);
  }
  // Nearest native trigger decides the area after a teleport or explore jump.
  relocate(feet, onMoon) {
    this.lunar = onMoon; this.previousFeet = feet.clone();
    let best = null, distance = Infinity;
    for (const t of this.triggers) if (t.earth !== onMoon) { const d = t.box.distanceToPoint(feet); if (d < distance) { distance = d; best = t; } }
    this.applyArea(onMoon ? best?.area ?? 'exterior' : 'nml', 0);
  }
  setEarthDestroyed(destroyed) {
    if (destroyed === this.destroyed) return;
    this.destroyed = destroyed;
    // dte_watcher: zombie_coast_powerOn at priority 7 for three seconds, removed over six.
    if (destroyed) { this.applyVision('zombie_coast_powerOn', this.data.visionPriorities.dte, .1); clearTimeout(this.dteTimer); this.dteTimer = setTimeout(() => this.removeVision('zombie_coast_powerOn', 6), 3000); }
    else { clearTimeout(this.dteTimer); this.removeVision('zombie_coast_powerOn', 0); }
    if (this.area) this.applyArea(this.area, 0, true);
  }
  applyVision(name, priority, time = 1) { this.visions = this.visions.filter(v => v.name !== name); this.visions.push({name, priority}); this.refreshVision(time); }
  removeVision(name, time = 1) { this.visions = this.visions.filter(v => v.name !== name); this.refreshVision(time); }
  refreshVision(time) {
    const top = this.visions.reduce((a, b) => b.priority >= a.priority ? b : a), name = top.name === 'base' ? this.areaVision : top.name;
    if (!name || name === this.visionName) return;
    this.visionName = name;
    const target = this.gradeFor(this.data.visions[name]), current = this.currentGrade();
    this.blend = time > 0 && current ? {from: current, to: target, t: 0, duration: time} : null;
    this.grade = target; this.writeGrade(this.blend ? current : target);
  }
  gradeFor(v) {
    // The source vision values assume T5's HDR lighting and lightmaps. Applied
    // to this reconstruction's broad fill they mute lunar textures to gray and
    // turn cool metal brown. Keep the browser's neutral, full-color lunar look;
    // authored event visions and the calibrated Earth daylight remain separate.
    const lunarBase = ['zombie_moon', 'zombie_moonInterior', 'zombie_moonBioDome', 'zombie_moonTunnels']
      .some(name => v === this.data.visions[name]);
    // The Kelvin fit is an approximation of T5's grading. Calibrate daylight
    // against the native yard reference without shifting the lunar vision sets.
    const daylightKelvin = v === this.data.visions.zombie_moonHanger18 ? 480 : 0;
    const f = (k, d) => v[k] ?? d, temp = f('r_filmColorTemp', [6500, 6500, 6500]).map(k => temperature(k+daylightKelvin));
    const tint = ['r_filmDarkTint', 'r_filmMidTint', 'r_filmLightTint'].map((k, i) => lunarBase ? [1, 1, 1] : f(k, [1, 1, 1]).map((c, j) => c*temp[i][j]));
    const curve = [f('r_sCurveShoulderStrength', .15), f('r_sCurveLinearStrength', .5), f('r_sCurveLinearAngle', .1), f('r_sCurveToeStrength', .2), f('r_sCurveToeNumerator', .02), f('r_sCurveToeDenominator', .3)];
    return {curve, range: [f('r_filmMidStart', .25), f('r_filmMidEnd', .75), f('r_filmDarkFeather', .5), f('r_filmLightFeather', .5)], tint,
      sat: lunarBase ? [1, 1, 1] : f('r_filmSaturation', [1, 1, 1]), contrast: lunarBase ? [1, 1, 1] : f('r_filmContrast', [1, 1, 1]), bleach: f('r_filmBleach', [0, 0, 0]), enable: [f('r_filmEnable', 1), f('r_sCurveEnable', 1)],
      browserTone: lunarBase ? 1 : 0,
      bloom: lunarBase ? [0, 0, 0] : f('r_bloomColorScale', [0, 0, 0, 0]).slice(0, 3), bloomCurve: [f('r_bloomCurveBreakpoint', [1])[0], f('r_bloomCurveLoGamma', [1])[0], f('r_bloomCurveHiGamma', [1])[0]], bloomRadius: f('r_bloomBlurRadius', 1.75)};
  }
  currentGrade() { return this.shown ?? null; }
  writeGrade(g) {
    this.shown = g;
    const c = g.curve;
    uniforms.moonCurveA.value.set(c[0], c[1], c[2], c[3]); uniforms.moonCurveB.value.set(c[4], c[5], 1/hable(c, WHITE_POINT), EXPOSURE);
    uniforms.moonBrowserTone.value = g.browserTone;
    uniforms.moonFilmRange.value.set(...g.range);
    uniforms.moonFilmDark.value.set(...g.tint[0]); uniforms.moonFilmMid.value.set(...g.tint[1]); uniforms.moonFilmLight.value.set(...g.tint[2]);
    uniforms.moonFilmSat.value.set(...g.sat); uniforms.moonFilmContrast.value.set(...g.contrast); uniforms.moonFilmBleach.value.set(...g.bleach);
    uniforms.moonFilmEnable.value.set(g.enable[0] > .5 ? 1 : 0, g.enable[1] > .5 ? 1 : 0);
  }
  applyArea(area, time = 0, force = false) {
    if (area === this.area && !force) return;
    this.area = area;
    const nml = area === 'nml', fogName = nml && this.destroyed ? 'hellearth' : AREA_FOG[area], fog = this.data.fog[fogName];
    // NML triggers stop changing fog after the ending; moon_nml_transition uses hellEarth.
    this.fogName = fogName; this.areaVision = this.data.visionSets[fog.vision];
    const scale = fog.fog_scale, sun = browser(fog.sunDir).normalize(), sunOn = fog.sun_stop_ang > fog.sun_start_ang;
    uniforms.moonFogA.value.set(fog.start_dist, fog.half_dist, Math.max(1, fog.half_height), fog.base_height);
    uniforms.moonFogColor.value.set(...fog.color.map(v => v*scale), fog.max_fog_opacity);
    uniforms.moonFogSun.value.set(...(sunOn ? fog.sunColor : fog.color).map(v => v*scale), Math.cos(THREE.MathUtils.degToRad(fog.sun_start_ang)));
    uniforms.moonFogSunDir.value.set(sun.x, sun.y, sun.z, Math.cos(THREE.MathUtils.degToRad(sunOn ? fog.sun_stop_ang : 180)));
    // r_lightTweakSun*: unset fields keep their previous value, as in the dvars.
    for (const key of ['sunlight', 'sundirection', 'suncolor']) if (fog[key] !== undefined) this.sunState[key] = fog[key];
    if (fog.r_skyColorTemp !== undefined) this.skyTemp = fog.r_skyColorTemp;
    if (fog.r_sky_intensity_factor0 !== undefined) this.skyFactor = fog.r_sky_intensity_factor0;
    // r_skyTransition: day in No Man's Land until the Earth is destroyed.
    this.transition = nml && !this.destroyed ? 1 : 0;
    this.updateSun();
    this.refreshVision(time);
  }
  updateSun() {
    const s = this.sunState, sky = temperature(this.skyTemp).map(v => v*UNLIT_SCALE*this.skyFactor);
    if (this.skyUniforms) { this.skyUniforms.moonSkyTint.value.set(...sky); this.skyUniforms.moonSkyTransition.value = this.transition; }
    const daylight = this.area === 'nml';
    for (const {light, lunar, daylight: intensity} of this.lighting) if (light) light.intensity = daylight ? intensity : lunar;
    if (!this.sun) return;
    // The browser sun stands in for lightmapped sun; scale it by r_lightTweakSunLight relative to the Moon's 8.
    this.sun.target.position.set(daylight ? 14000 : 0, daylight ? -600 : 0, daylight ? 14600 : 0);
    this.sun.position.copy(forward(...s.sundirection)).multiplyScalar(daylight ? 4500 : 1).add(this.sun.target.position);
    this.sun.castShadow = daylight;
    this.sun.shadow.needsUpdate = daylight;
    this.sun.color.setRGB(...s.suncolor);
    this.sun.intensity = (daylight ? 2.8/5 : 2.4/8)*s.sunlight;
  }
  // T5 trigger_multiple volumes fire when the player's 30x30x72 box touches them;
  // sweep the feet between frames so thin doorway triggers are not skipped.
  update(dt, feet) {
    this.time += dt;
    if (this.skyUniforms) this.skyUniforms.moonSkyTime.value = this.time;
    if (this.blend) {
      this.blend.t = Math.min(1, this.blend.t+dt/this.blend.duration);
      const {from, to, t} = this.blend, g = {};
      for (const k of Object.keys(to)) g[k] = lerp(from[k], to[k], t);
      this.writeGrade(g); if (t >= 1) this.blend = null;
    }
    if (!feet || !this.triggers) return;
    const start = this.previousFeet ?? feet, delta = feet.clone().sub(start), box = new THREE.Box3();
    let hit = null, hitT = -1;
    if (delta.lengthSq() < 250000) for (const t of this.triggers) {
      box.copy(t.box); box.min.x -= 15; box.min.z -= 15; box.max.x += 15; box.max.z += 15; box.min.y -= 72;
      const entry = segmentBox(start, delta, box);
      if (entry !== null && entry >= hitT) { hit = t; hitT = entry; }
    }
    this.previousFeet = feet.clone();
    if (hit && !(hit.area === 'nml' && this.destroyed)) this.applyArea(hit.area, hit.time);
  }
  render(viewScene, viewCamera) {
    const r = this.renderer, camera = this.camera;
    if (this.sun?.castShadow) for (const part of this.shadowParts) {
      const key = `${part.amount}:${part.object.visible}`;
      if (part.sunShadowState !== key) { part.sunShadowState = key; this.sun.shadow.needsUpdate = true; }
    }
    r.info.reset();
    this.skyCamera.fov = camera.fov; this.skyCamera.aspect = camera.aspect; this.skyCamera.updateProjectionMatrix();
    camera.updateMatrixWorld(); this.skyCamera.position.setFromMatrixPosition(camera.matrixWorld); this.skyCamera.quaternion.setFromRotationMatrix(camera.matrixWorld);
    this.sky.position.copy(this.skyCamera.position);
    this.earth.visible = this.lunar || this.destroyed; this.earthModel.visible = true; this.earthDestroyed.visible = this.destroyed;
    r.setRenderTarget(this.target ?? null); r.setClearColor(0x000000, 1); r.clear();
    r.render(this.skyScene, this.skyCamera); r.clearDepth();
    r.render(this.scene, camera);
    if (viewScene) { r.clearDepth(); r.render(viewScene, viewCamera); }
    if (!this.target) return;
    const g = this.shown, bloom = g && Math.max(...g.bloom) > .001;
    if (bloom) {
      const w = this.bloomA.width, h = this.bloomA.height, radius = g.bloomRadius/1.75;
      this.bright.material.uniforms.tColor.value = this.target.texture; this.bright.material.uniforms.texel.value.set(.5/this.target.width, .5/this.target.height);
      this.bright.material.uniforms.moonBloomScale.value.set(...g.bloom); this.bright.material.uniforms.moonBloomCurve.value.set(...g.bloomCurve, 0);
      r.setRenderTarget(this.bloomA); r.render(this.bright.scene, this.quadCamera);
      for (const [source, dest, x, y] of [[this.bloomA, this.bloomB, radius/w, 0], [this.bloomB, this.bloomA, 0, radius/h]]) {
        this.blur.material.uniforms.tColor.value = source.texture; this.blur.material.uniforms.direction.value.set(x, y);
        r.setRenderTarget(dest); r.render(this.blur.scene, this.quadCamera);
      }
    }
    this.final.material.uniforms.bloomOn.value = bloom ? 1 : 0;
    r.setRenderTarget(null); r.render(this.final.scene, this.quadCamera);
  }
  snapshot() { return {area: this.area, fog: this.fogName, vision: this.visionName, sky: this.transition ? 'day' : 'night', earth: this.earth?.visible ? (this.destroyed ? 'destroyed' : 'intact') : 'hidden', post: !!this.target}; }
}

// Slab test: entry fraction of the segment start + delta*[0,1] into the box, or null.
function segmentBox(start, delta, box) {
  let near = 0, far = 1;
  for (const axis of ['x', 'y', 'z']) {
    const s = start[axis], d = delta[axis], min = box.min[axis], max = box.max[axis];
    if (Math.abs(d) < 1e-9) { if (s < min || s > max) return null; continue; }
    let a = (min-s)/d, b = (max-s)/d; if (a > b) [a, b] = [b, a];
    near = Math.max(near, a); far = Math.min(far, b); if (near > far) return null;
  }
  return near;
}
