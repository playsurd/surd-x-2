import * as THREE from 'three';
import { loadGltf } from './load-gltf.js';

import { AdsBlend } from './gunplay.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { createMuzzleFlashTexture } from './weapon-effects.js';
import { parseNotetracks, NotetrackTimeline } from './notetracks.js';
import { WEAPON_CAMOS, WEAPON_CAMO_IDS, DEFAULT_WEAPON_CAMO, findCamo, nextCamo } from './skins.js';

// The exported viewhands skeleton keeps the engine's view axes in tag_view's
// local space: X forward (down the barrel), Y left, Z up. This basis maps that
// onto the three.js camera convention (X right, Y up, -Z forward).
const VIEW_TO_CAMERA = new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 0, -1),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
);

// GLB meshes are Y-up; animation joints below the exported root retain T6 axes.
const GLTF_TO_ENGINE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const ENGINE_TO_GLTF = GLTF_TO_ENGINE.clone().invert();

export function mountWeaponAttachment(model, joint, offset = [0, 0, 0], rotation = [0, 0, 0]) {
  model.matrixAutoUpdate = true;
  model.position.fromArray(offset);
  model.quaternion.setFromEuler(new THREE.Euler(...rotation)).multiply(GLTF_TO_ENGINE);
  joint.add(model);
  return model;
}

// hideTags names skin influences, not separate render objects. Hiding a Bone
// itself leaves its weighted triangles visible, so remove those triangles.
export function hideModelTags(root, names = []) {
  const hidden = new Set(names);
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh || !hidden.size) return;
    const indices = mesh.geometry.getIndex();
    const joints = mesh.geometry.getAttribute('skinIndex');
    const weights = mesh.geometry.getAttribute('skinWeight');
    const hiddenBones = new Set(mesh.skeleton.bones.flatMap((bone, i) => {
      for (let node = bone; node; node = node.parent) if (hidden.has(node.name)) return [i];
      return [];
    }));
    const hiddenVertex = i => {
      let weight = 0;
      for (let c = 0; c < 4; c++) if (hiddenBones.has(joints.getComponent(i, c))) weight += weights.getComponent(i, c);
      return weight > 0.5;
    };
    const kept = [];
    const count = indices?.count ?? joints.count;
    for (let i = 0; i < count; i += 3) {
      const tri = [0, 1, 2].map(c => indices ? indices.getX(i + c) : i + c);
      if (!tri.some(hiddenVertex)) kept.push(...tri);
    }
    if (kept.length !== count) { mesh.geometry = mesh.geometry.clone(); mesh.geometry.setIndex(kept); }
  });
}

const { clamp, damp } = THREE.MathUtils;

// The camo catalog lives in skins.js; T6 paints a camo onto every `_camoN`
// material of a gun and leaves the rest (sights, magazine well, tritium) alone.
export const CAMO_MATERIAL_PATTERN = /_camo\d*$/i;
// Names the weapon rigs use for the tag the fresh magazine rides in on. Only
// the rigs that animate two magazines carry one; see mountSpareMagazine().
const SPARE_MAGAZINE_TAGS = Object.freeze(['tag_clip_full', 'tag_clip1']);
// Every magazine channel is authored as a displacement and has to be anchored
// to its own bind position before it can be played. See loadClips().
const MAGAZINE_TAGS = Object.freeze(new Set(['tag_clip', ...SPARE_MAGAZINE_TAGS]));
// Sprint carry pose, blended in by sprintBlend. Rotations are radians, offsets
// are rig units (inches), both in camera space (X right, Y up, -Z forward).
// The rotation is applied about `pivot`, roughly the firing hand, so the gun
// visibly turns across the body (muzzle down-left, stock up-right) instead of
// orbiting the camera as a whole.
const SPRINT_POSE = Object.freeze({
  pitch: -0.45,
  yaw: 0.65,
  roll: -0.38,
  x: 0.2,
  y: -1.2,
  z: -0.5,
  // Keep the rotation centre near the shoulders. A pivot six units forward
  // swung the SCAR/Ballista sleeves through the eye during downward look lag.
  pivot: new THREE.Vector3(0, -3, -3),
});

// How the walk bob changes as sprintBlend rises: stride rate drops by `slow`,
// lateral and vertical travel grow by `widen` and `lift`, and the gun rolls
// and nods with the stride by up to `roll` and `pitch` radians.
const SPRINT_BOB = Object.freeze({
  slow: 0.45,
  widen: 0.9,
  lift: 0.5,
  roll: 0.05,
  pitch: 0.025,
});

const BOB_GROUND_GRACE = 0.25;
// Where along the ADS raise a scope takes over, and where along the lower it
// lets go; see weapons.js SCOPE.
const SCOPE_IN_FRAC = 0.985;
const SCOPE_OUT_FRAC = 0.95;
// Where a grenade sits in the right palm, in the wrist joint's frame (inches).
const GRENADE_PALM_OFFSET = Object.freeze([3.2, -0.6, 1.4]);
// The M67 body's material carries no colour map in the export; this is the
// olive drab it should read as. Shared with grenades.js for the thrown body.
export const GRENADE_BODY_COLOR = 0x3b4634;
export function tintUntexturedGrenade(mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) {
    if (!material || material.map || material.userData.grenadeTinted) continue;
    material.color?.set(GRENADE_BODY_COLOR);
    if ('roughness' in material) material.roughness = 0.75;
    material.userData.grenadeTinted = true;
  }
}

// The cue the clips fire as the empty magazine is released, which is the instant
// the fresh one takes over as the magazine the reload is about; see
// handOverMagazine().
const MAGAZINE_HANDOVER_CUE = /mag_out/;
// The red tritium insert capping the front post is the element the eye lines up
// on, so it defines where the sight picture points, not the tag authored on the
// sight base. See computeAdsAlignment().
const SIGHT_INSERT_PATTERN = /tritium/i;

// The rear sight carries no tag and no material of its own, so it is measured
// off the posed geometry instead: the top of the rear sight, which is the point
// a shooter levels the front post against. Taking the floor of the notch instead
// buries the post behind the sight body — the post tip is authored level with
// that floor, so it grazes it and nothing stands up in the opening. Levelling on
// the top instead drops the rear sight just below centre and frames the front
// sight above it, which is the picture the game itself shows.
// Thresholds are in rig units, about one per inch on the shipped weapons.
const REAR_SIGHT_MIN_RADIUS = 2;
const REAR_SIGHT_PLANE_BAND = 0.35;
// Wide enough to span the rear sight's shoulders, which stand 0.2 either side of
// the centreline on this rig, and still far short of anything else in the band.
const REAR_SIGHT_HALF_WIDTH = 0.5;

function findNode(root, name) {
  let found = null;
  root.traverse((object) => {
    if (!found && object.name === name) found = object;
  });
  return found;
}

/**
 * Paint a camo tile onto every `_camo` material under `root`. Shared with the
 * bots' world weapons, which carry the same material names.
 */
export function applyCustomCamo(root, texture, { repeat = 3 } = {}) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.needsUpdate = true;

  root.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!CAMO_MATERIAL_PATTERN.test(material.name)) continue;
      material.map = texture;
      material.color.set(0xffffff);
      material.needsUpdate = true;
    }
  });
}

export class Viewmodel {
  // adsEyeRelief is the gap the aiming eye keeps behind the *rear* sight, which
  // is what decides whether the rear sight is in front of the camera at all.
  // adsDistance only applies to rigs with no rear sight to find, where it keeps
  // its old meaning: the distance from the eye to tag_sights/tag_sights_on.
  // A weapon may provide measured ADS anchors as the plain serializable
  // `adsSightAnchors: { front: [x, y, z], rear: [x, y, z] }` option, in j_gun
  // local space. This is for exported rigs whose front sight has no identifiable
  // insert material for findSightTip to measure — saritch, scar and sig556 ship
  // no tritium at all, so the geometry search has nothing to key on.
  // `front` alone is enough: findRearSight works off the post tip, so supplying
  // the front point lets the rear one still come from the geometry. `rear` alone
  // is not — there is no line without a front point, and on these rigs nothing
  // can supply one — so it warns and takes the single-point fallback.
  constructor({
    fov = 75,
    adsFov = 55,
    adsDistance = 7,
    adsEyeRelief = 3.5,
    adsSightAnchors = null,
    adsTransInTime = 0.25,
    adsTransOutTime = 0.25,
    camo = DEFAULT_WEAPON_CAMO,
    // A sniper's scope: { zoomFov, overlay, idleAmount, ... } from weapons.js.
    // With one set, the rig leaves the view at the top of the raise and the
    // page draws the overlay; `scoped` says when.
    scope = null,
    // Bolt-actions play their rechamber clip after every shot and cannot
    // fire until it ends.
    boltAction = false,
    // tag_torso position the weapon's clips assume, engine axes, when it is
    // not the viewhands' bind. Applied before any clip binds so it is what
    // the mixer restores to.
    torsoBind = null,
  } = {}) {
    this.baseFov = fov;
    // Raise and lower on the weapon file's adsTransInTime / adsTransOutTime.
    this.adsTransition = new AdsBlend({ adsTransInTime, adsTransOutTime });
    this.adsFov = adsFov;
    this.adsDistance = adsDistance;
    this.adsEyeRelief = adsEyeRelief;
    this.adsSightAnchors = adsSightAnchors;

    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.5, 500);
    this.scene = new THREE.Scene();

    // Levels assume the renderer's ACES tone mapping and the vision set's
    // exposure (see lighting.js). setEnvironment() supplies ambient/specular
    // from the map's reflection probe; these two only shape the weapon.
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a4a55, 0.32);
    this.scene.add(this.hemi);
    const lamp = new THREE.DirectionalLight(0xfff2d8, 0.65);
    lamp.position.set(-2, 3, 1.5);
    this.scene.add(lamp);
    this.lamp = lamp;

    // adsGroup carries the aim translation, swayGroup the idle/motion offsets,
    // and root the fixed rig placement (tag_view anchored to the camera).
    this.adsGroup = new THREE.Group();
    this.swayGroup = new THREE.Group();
    this.root = new THREE.Group();
    this.root.matrixAutoUpdate = false;
    this.swayGroup.add(this.root);
    this.adsGroup.add(this.swayGroup);
    this.scene.add(this.adsGroup);

    this.ready = false;
    this.aiming = false;
    this.aimBlend = 0;
    this.sprintBlend = 0;
    this.pivotShift = new THREE.Vector3();
    this.sprintEuler = new THREE.Euler();
    this.bobTime = 0;
    this.bobAmp = 0;
    this.airTime = 0;
    this.pendingLook = new THREE.Vector2();
    this.lookVel = new THREE.Vector2();
    this.swayRot = new THREE.Vector2();
    this.swayPos = new THREE.Vector2();
    this.adsOffset = new THREE.Vector3();
    this.adsMatrix = new THREE.Matrix4();
    this.adsPos = new THREE.Vector3();
    this.adsQuat = new THREE.Quaternion();
    this.adsScale = new THREE.Vector3(1, 1, 1);
    this.identityQuat = new THREE.Quaternion();
    this.tagFlash = null;
    this.muzzleFlash = null;
    this.muzzleLight = null;
    this.flashTime = 0;

    this.mixer = null;
    this.clips = new Map();
    // Cues authored into the clips. onNotetrack receives {type, name, time} as
    // each one passes; index.html routes the sound cues to the audio engine.
    this.notetracks = new Map();
    this.onNotetrack = null;
    this.activeTimeline = null;
    this.notetrackAction = null;
    this.idleAction = null;
    this.reloadAction = null;
    this.reloadEmptyAction = null;
    this.fireAction = null;
    this.adsFireAction = null;
    this.introFireAction = null;
    this.introAdsFireAction = null;
    this.reloading = false;
    this.weaponRoot = null;
    this.magazineRoot = null;
    this.scopeRoot = null;
    this.attachmentAnimationBases = new Map();
    this.spareMagazine = null;
    this.camo = findCamo(camo) ? camo : DEFAULT_WEAPON_CAMO;
    this.camoTextures = new Map();
    this.camoRoots = [];
    // Melee: the knife rides tag_knife_attach on the hands for the swing,
    // then goes away again. Pistols whip with their own clip and no knife.
    this.knifeRoot = null;
    this.meleeAction = null;
    this.meleeing = false;
    this.meleeTimer = 0;
    // Grenade throws: the gun drops out of view, a grenade body sits on
    // tag_weapon for the pull-pin and throw clips, then the gun comes back.
    this.grenadeRoot = null;
    this.grenadeModels = new Map();
    this.pullPinAction = null;
    this.throwAction = null;
    this.throwing = false;
    this.throwPhase = null;
    this.onThrowRelease = null;
    this.onMeleeStrike = null;
    this.scope = scope;
    this.boltAction = Boolean(boltAction);
    this.torsoBind = Array.isArray(torsoBind) && torsoBind.length === 3 ? torsoBind : null;
    this.scoped = false;
    this.onScopeChange = null;
    this.rechamberAction = null;
    this.adsRechamberAction = null;
    this.rechambering = false;
    this.pendingRechamber = false;
  }

  get availableCamos() {
    return WEAPON_CAMO_IDS;
  }

  setCamo(name) {
    const texture = this.camoTextures.get(name);
    if (!texture) return false;
    const repeat = findCamo(name)?.repeat ?? 3;
    for (const root of this.camoRoots) applyCustomCamo(root, texture, { repeat });
    this.camo = name;
    return true;
  }

  // Reports the camo actually on the gun, not the one asked for: a texture that
  // failed to load leaves setCamo a no-op, and the caller's key binding and the
  // debug state both read this back as the current skin.
  cycleCamo(step = 1) {
    this.setCamo(nextCamo(this.camo, step, this.availableCamos));
    return this.camo;
  }

  // A mag change involves two magazines: the empty one is pulled out and thrown
  // clear, and a fresh one is brought up and seated. T6 animates the empty one
  // on the attachment's own `tag_clip` and the fresh one on a spare tag the
  // *weapon* rig carries, mounting a second copy of the same magazine xmodel
  // there for the length of the reload. Rigs that reuse one magazine for both
  // halves have no spare tag and need none of this; the hk416 is one of them,
  // which is why nothing missed it until the whole roster shipped. Without it
  // the only magazine on the gun is the discarded one, so the fresh magazine is
  // invisible and the hands mime seating nothing — worst on the an94 and sa58,
  // whose empties are thrown 73 and 95 units clear.
  mountSpareMagazine(weaponScene, magazineScene) {
    const tag = SPARE_MAGAZINE_TAGS
      .map((name) => findNode(weaponScene, name))
      .find(Boolean);
    if (!tag) return null;

    const spare = cloneSkinned(magazineScene);
    // The clone carries its own `tag_clip`, and clips bind by name to the first
    // match in the tree. Rename it so it cannot capture the empty magazine's
    // channel: the spare is driven by the weapon's tag, which is already bound.
    spare.traverse((node) => {
      if (node.name === 'tag_clip') node.name = 'tag_clip_spare';
    });
    // The spare tag is posed by the clip in the weapon's space, so the mount
    // must not re-apply the magwell offset the seated magazine needs.
    mountWeaponAttachment(spare, tag);
    spare.visible = false;
    this.camoRoots.push(spare);
    return spare;
  }

  async load(handsUrl, weaponUrl, magazineUrl, onProgress, {
    magazineOffset = null,
    magazineRotation = null,
    hiddenTags = [],
  } = {}) {
    // The exported GLBs reference sibling textures as .dds; the web export ships
    // WebP copies instead, so remap the suffix at load time. They were PNG until
    // the nine-rifle roster took this folder to 28 MB on a load that fetches every
    // weapon slot before the player can move; re-encoding cut it to 10 MB with the
    // normal maps kept lossless. See .tools/pack_web_textures.mjs.
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => (url.endsWith('.dds') ? `${url.slice(0, -4)}.webp` : url));
    const loader = new GLTFLoader(manager);
    const textureLoader = new THREE.TextureLoader(manager);
    const load = (url, label) => loadGltf(loader, url, (event) => onProgress?.(label, event));
    const [hands, weapon, magazine, camoTextures, optic] = await Promise.all([
      load(handsUrl, 'hands'),
      load(weaponUrl, 'weapon'),
      magazineUrl
        ? load(magazineUrl, 'magazine').catch((error) => {
          console.warn('Magazine attachment unavailable:', error);
          return null;
        })
        : Promise.resolve(null),
      // Camo tiles are small (a few KB each), so the whole catalog loads with
      // the gun and a switch is instant. A tile that fails to load is left
      // out and setCamo() refuses it, so a bad file cannot strip the gun.
      Promise.all(WEAPON_CAMOS.map(async (camo) => {
        try {
          return [camo.id, await textureLoader.loadAsync(camo.url)];
        } catch (error) {
          console.warn(`camo ${camo.id} unavailable:`, error);
          return null;
        }
      })),
      this.scope?.modelUrl ? load(this.scope.modelUrl, 'scope') : Promise.resolve(null),
    ]);

    this.camoTextures = new Map(camoTextures.filter(Boolean));
    this.camoRoots = [weapon.scene, ...(magazine ? [magazine.scene] : []), ...(optic ? [optic.scene] : [])];
    this.setCamo(this.camo);

    this.root.add(hands.scene, weapon.scene);
    const attachmentJoint = findNode(weapon.scene, 'j_gun');
    hideModelTags(weapon.scene, hiddenTags);
    const registerAttachment = (model, tagName, rotation = [0, 0, 0]) => {
      const node = findNode(model, tagName);
      if (node) this.attachmentAnimationBases.set(tagName,
        ENGINE_TO_GLTF.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)).invert()));
    };
    if (magazine) {
      mountWeaponAttachment(magazine.scene, attachmentJoint, magazineOffset ?? [0, 0, 0], magazineRotation ?? [0, 0, 0]);
      registerAttachment(magazine.scene, 'tag_clip', magazineRotation ?? [0, 0, 0]);
      this.magazineRoot = magazine.scene;
      this.spareMagazine = this.mountSpareMagazine(weapon.scene, magazine.scene);
    }
    if (optic) {
      this.scopeRoot = mountWeaponAttachment(optic.scene, attachmentJoint, this.scope.offset);
      registerAttachment(optic.scene, 'tag_scope');
    }
    this.root.updateMatrixWorld(true);

    // T6 mount convention: the weapon's j_gun joint lands exactly on the
    // hands' tag_weapon joint. Parent the weapon under tag_weapon (weld =
    // j_gun's inverse bind world matrix) so animated hand motion such as the
    // reload carries the gun along.
    const tagWeapon = findNode(hands.scene, 'tag_weapon');
    const jGun = findNode(weapon.scene, 'j_gun');
    const tagView = findNode(hands.scene, 'tag_view');
    if (!tagWeapon || !jGun || !tagView) {
      throw new Error('viewmodel joints not found in exported rigs');
    }

    weapon.scene.matrixAutoUpdate = false;
    weapon.scene.matrix.copy(jGun.matrixWorld).invert();
    tagWeapon.add(weapon.scene);
    this.weaponRoot = weapon.scene;

    // A rig whose clips assume another torso pose gets it here, before the
    // view anchor and before any clip binds the joint.
    if (this.torsoBind) {
      const torso = findNode(hands.scene, 'tag_torso');
      if (torso) torso.position.fromArray(this.torsoBind);
    }
    // Anchor tag_view at the camera origin so the authored hip pose shows.
    this.root.updateMatrixWorld(true);
    this.root.matrix.multiplyMatrices(VIEW_TO_CAMERA, tagView.matrixWorld.clone().invert());
    this.root.updateMatrixWorld(true);
    this.computeAdsAlignment();
    this.tagFlash = findNode(weapon.scene, 'tag_flash');
    this.createMuzzleFlash();

    this.root.traverse((object) => {
      object.frustumCulled = false;
      if (object.isMesh) {
        object.castShadow = false;
        object.receiveShadow = false;
      }
    });

    this.ready = true;
  }

  // Share the world's prefiltered environment so the weapon picks up the same
  // sky/probe reflections the map does. Intensity is kept a little under the
  // world's because the viewmodel sits in its own overlay scene with no
  // surrounding geometry to occlude it.
  setEnvironment(texture, intensity = 0.5) {
    this.scene.environment = texture;
    this.scene.environmentIntensity = intensity;
  }

  createMuzzleFlash() {
    if (!this.tagFlash) return;
    const material = new THREE.SpriteMaterial({
      map: createMuzzleFlashTexture(),
      color: 0xffd27a,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.muzzleFlash = new THREE.Sprite(material);
    this.muzzleFlash.scale.set(8, 8, 1);
    this.muzzleFlash.visible = false;
    this.muzzleFlash.renderOrder = 100;
    this.muzzleLight = new THREE.PointLight(0xffa43b, 0, 25, 2);
    this.tagFlash.add(this.muzzleFlash, this.muzzleLight);
  }

  // ADS: line the eye, the rear sight and the front post up on one axis. The
  // sight picture is a two-point problem — squaring the barrel to the view and
  // centring the front post alone leaves the rear sight wherever it happens to
  // fall. Worse, the eye used to be anchored on tag_sights, which this rig
  // authors on the *front* sight base, putting the camera between the two
  // sights: the rear sight sat about 4 units behind the camera and was never
  // drawn, so only the front post was ever visible down the sight.
  computeAdsAlignment() {
    const jGun = findNode(this.root, 'j_gun');
    const tagSights = findNode(this.root, 'tag_sights')
      ?? findNode(this.root, 'tag_sights_on');
    if (!jGun) return;
    const gunQuat = jGun.getWorldQuaternion(new THREE.Quaternion());
    const gunUp = new THREE.Vector3(0, 0, 1).applyQuaternion(gunQuat).normalize();

    // Each end of the sight line resolves from its override first and from the
    // geometry second, and the two stay independent: hanging the rear on the
    // front discarded a supplied rear anchor whenever findSightTip came up empty
    // — which is every rig the override exists for, since those are the ones
    // with no insert material to key on. The pair then fell through to the
    // single-point fallback, putting the rear sight back behind the camera.
    const optic = this.findScopeSights(jGun);
    const front = optic?.front ?? this.getSightAnchor(jGun, 'front') ?? this.findSightTip(jGun);
    const rear = optic?.rear ?? this.getSightAnchor(jGun, 'rear')
      ?? (front ? this.findRearSight(jGun, front) : null);
    // A rear anchor alone cannot be solved: without a front point there is no
    // line, and on these rigs the geometry cannot supply one either. That is a
    // mis-authored definition rather than a rig the fallback handles, and the
    // fallback's sight picture is the bug this whole solve replaced, so say so.
    if (rear && !front) {
      console.warn('viewmodel: adsSightAnchors.rear needs a matching front anchor on a rig with no sight insert; falling back to tag_sights');
    }

    // With both sights the sight line itself is the aim axis and the rear sight
    // anchors the eye relief. With only one there is no line to solve, so the
    // barrel stands in for it and tag_sights/tag_sights_on anchors the eye, as
    // before.
    const sightLine = Boolean(front && rear);
    const anchor = sightLine ? rear : tagSights?.getWorldPosition(new THREE.Vector3()) ?? front;
    if (!anchor) return;
    const relief = sightLine ? this.adsEyeRelief : this.adsDistance;
    const back = sightLine
      ? rear.clone().sub(front).normalize()
      : new THREE.Vector3(-1, 0, 0).applyQuaternion(gunQuat).normalize();

    // Back/up/right, orthonormalized. makeBasis puts them in the columns, which
    // reads camera coordinates back into the rig; the rig is what has to move,
    // so transpose it into the rig-to-camera direction.
    const zAxis = back;
    const yAxis = gunUp.clone().addScaledVector(zAxis, -gunUp.dot(zAxis)).normalize();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
    const sightToCamera = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).transpose();

    this.adsMatrix
      .multiplyMatrices(new THREE.Matrix4().makeTranslation(0, 0, -relief), sightToCamera)
      .multiply(new THREE.Matrix4().makeTranslation(-anchor.x, -anchor.y, -anchor.z));

    // On the fallback path tag_sights is authored on the sight base, about 0.4
    // units below the front post tip the eye actually aligns with, so centring
    // the tag alone floats the sight picture above the ray the shot follows
    // (see WeaponEffects.fire, which casts through the exact screen centre).
    // Slide the rig perpendicular to the view axis until the post tip lands on
    // it; the depth term is left alone so the tag still sets the eye relief.
    // With a rear sight the two-point solve already puts both points on the
    // axis, so there is nothing left to correct.
    if (front && !sightLine) {
      const tip = front.clone().applyMatrix4(this.adsMatrix);
      this.adsMatrix.premultiply(new THREE.Matrix4().makeTranslation(-tip.x, -tip.y, 0));
    }
    this.adsMatrix.decompose(this.adsPos, this.adsQuat, this.adsScale);
  }

  // The top of the rear sight in world space. Precision matters here: the solve
  // above runs its axis through whatever point this returns, so an error of e
  // leaves the rear sight sitting e/adsEyeRelief off the front post on screen —
  // a hundredth of a unit is worth a couple of pixels.
  findRearSight(jGun, frontTip) {
    const toGun = new THREE.Matrix4().copy(jGun.matrixWorld).invert();
    const front = frontTip.clone().applyMatrix4(toGun);
    const vertex = new THREE.Vector3();
    let best = null;

    // Only the weapon: the hands wrap the grip and handguard and could stray
    // into the search band, and there is no material to tell them apart here.
    (this.weaponRoot ?? this.root).traverse((object) => {
      if (!object.isMesh) return;
      const toGunLocal = new THREE.Matrix4().multiplyMatrices(toGun, object.matrixWorld);
      const position = object.geometry.getAttribute('position');
      const index = object.geometry.getIndex();
      const count = index ? index.count : position.count;
      for (let i = 0; i < count; i += 1) {
        const vertexIndex = index ? index.getX(i) : i;
        vertex.fromBufferAttribute(position, vertexIndex);
        if (object.isSkinnedMesh) object.applyBoneTransform(vertexIndex, vertex);
        vertex.applyMatrix4(toGunLocal);
        // j_gun holds the engine's joint axes: X down the barrel, Y left, Z up.
        if (vertex.x > front.x - REAR_SIGHT_MIN_RADIUS) continue;
        if (Math.abs(vertex.y - front.y) > REAR_SIGHT_HALF_WIDTH) continue;
        if (Math.abs(vertex.z - front.z) > REAR_SIGHT_PLANE_BAND) continue;
        if (!best || vertex.z > best.z) best = vertex.clone();
      }
    });
    if (!best) return null;
    // The winning vertex is one of the two shoulders, so its own lateral offset
    // is meaningless — the sight is symmetric about the weapon's centreline and
    // that is where the eye looks. Keeping the shoulder's 0.2 offset would swing
    // the sight picture sideways by 0.2/adsEyeRelief, most of a degree.
    best.y = front.y;
    return jGun.localToWorld(best);
  }

  // Read only referenced vertices: each exported surface shares a larger
  // position buffer with the rest of the weapon.
  sightVertices(root, jGun, pattern) {
    const points = [];
    root?.traverse(object => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (!materials.some(material => pattern.test(material?.name ?? ''))) return;
      const position = object.geometry.getAttribute('position');
      const index = object.geometry.getIndex();
      for (let i = 0; i < (index?.count ?? position.count); i++) {
        const k = index ? index.getX(i) : i;
        const vertex = new THREE.Vector3().fromBufferAttribute(position, k);
        if (object.isSkinnedMesh) object.applyBoneTransform(k, vertex);
        points.push(jGun.worldToLocal(object.localToWorld(vertex)));
      }
    });
    return points;
  }

  findSightTip(jGun) {
    const points = this.sightVertices(this.weaponRoot ?? this.root, jGun, SIGHT_INSERT_PATTERN);
    if (!points.length) return null;
    // Front and rear dots often share one material. Only the forward cluster
    // belongs to the post; combining both measures a point above the receiver.
    const forward = Math.max(...points.map(p => p.x));
    const box = new THREE.Box3().setFromPoints(points.filter(p => p.x > forward - 0.4));
    const tip = box.getCenter(new THREE.Vector3());
    tip.z = box.max.z;
    return jGun.localToWorld(tip);
  }

  findScopeSights(jGun) {
    const points = this.sightVertices(this.scopeRoot, jGun, /lens/i);
    if (!points.length) return null;
    const box = new THREE.Box3().setFromPoints(points);
    const rear = box.getCenter(new THREE.Vector3());
    rear.x = box.min.x;
    const front = rear.clone();
    front.x = Math.max(box.max.x, rear.x + 1);
    return { front: jGun.localToWorld(front), rear: jGun.localToWorld(rear) };
  }

  getSightAnchor(jGun, key) {
    const point = this.adsSightAnchors?.[key];
    if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite)) {
      return null;
    }
    return jGun.localToWorld(new THREE.Vector3().fromArray(point));
  }

  // Loads xanim-derived JSON clips (see .tools/xanim_to_json.mjs) and turns
  // them into AnimationClips bound to the rig by bone name. The idle clip is
  // the authored hip-fire pose, so it becomes the always-on base layer the
  // reload crossfades against; the GLB bind pose only shows before it starts.
  async loadClips(entries) {
    const pending = Object.entries(entries).map(async ([key, url]) => {
      const response = await fetch(String(url));
      if (!response.ok) throw new Error(`clip ${key} HTTP ${response.status}`);
      return [key, await response.json()];
    });
    const loaded = await Promise.all(pending);

    this.mixer = new THREE.AnimationMixer(this.root);
    this.mixer.addEventListener('finished', (event) => this.onClipFinished(event));

    for (const [key, data] of loaded) {
      const tracks = [];
      for (const bone of data.bones) {
        const node = findNode(this.root, bone.name);
        if (!node) continue;
        if (bone.rot?.values?.length) {
          const times = bone.rot.frames.map((frame) => frame / data.fps);
          const values = bone.rot.values.slice();
          const basis = this.attachmentAnimationBases.get(bone.name);
          if (basis) {
            const q = new THREE.Quaternion();
            for (let i = 0; i < values.length; i += 4) {
              q.fromArray(values, i).premultiply(basis).normalize().toArray(values, i);
            }
          }
          tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values));
        }
        if (bone.pos?.values?.length) {
          const times = bone.pos.frames.map((frame) => frame / data.fps);
          const values = bone.pos.values.slice();
          // Magazine tracks are displacements from each joint's own bind.
          // Embedded/spare joints are already in engine axes; only attachment
          // root tracks cross the GLB conversion and authored mount rotation.
          const basis = this.attachmentAnimationBases.get(bone.name);
          if (MAGAZINE_TAGS.has(bone.name) || basis) {
            const delta = new THREE.Vector3();
            for (let i = 0; i < values.length; i += 3) {
              delta.fromArray(values, i);
              if (basis) delta.applyQuaternion(basis);
              delta.add(node.position).toArray(values, i);
            }
          }
          tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, values));
        }
      }
      this.clips.set(key, new THREE.AnimationClip(key, data.duration, tracks));
      this.notetracks.set(key, parseNotetracks(data.notifies));
    }

    if (this.clips.has('idle')) {
      this.idleAction = this.mixer.clipAction(this.clips.get('idle'));
      this.idleAction.setLoop(THREE.LoopOnce, 1);
      this.idleAction.clampWhenFinished = true;
      this.idleAction.play();
      this.mixer.update(0);
      this.root.updateMatrixWorld(true);
      // The sight alignment must match the pose the rig actually holds.
      this.computeAdsAlignment();
    }

    if (this.clips.has('reload') && this.idleAction) {
      this.reloadAction = this.mixer.clipAction(this.clips.get('reload'));
      this.reloadAction.setLoop(THREE.LoopOnce, 1);
      this.reloadAction.clampWhenFinished = true;
    }
    if (this.clips.has('reloadEmpty') && this.idleAction) {
      this.reloadEmptyAction = this.mixer.clipAction(this.clips.get('reloadEmpty'));
      this.reloadEmptyAction.setLoop(THREE.LoopOnce, 1);
      this.reloadEmptyAction.clampWhenFinished = true;
    }
    if (this.clips.has('fire') && this.idleAction) {
      this.fireAction = this.mixer.clipAction(this.clips.get('fire'));
      this.fireAction.setLoop(THREE.LoopOnce, 1);
    }
    if (this.clips.has('adsFire') && this.idleAction) {
      this.adsFireAction = this.mixer.clipAction(this.clips.get('adsFire'));
      this.adsFireAction.setLoop(THREE.LoopOnce, 1);
    }
    if (this.clips.has('introFire') && this.idleAction) {
      this.introFireAction = this.mixer.clipAction(this.clips.get('introFire'));
      this.introFireAction.setLoop(THREE.LoopOnce, 1);
    }
    if (this.clips.has('introAdsFire') && this.idleAction) {
      this.introAdsFireAction = this.mixer.clipAction(this.clips.get('introAdsFire'));
      this.introAdsFireAction.setLoop(THREE.LoopOnce, 1);
    }
    if (this.clips.has('rechamber') && this.idleAction) {
      this.rechamberAction = this.mixer.clipAction(this.clips.get('rechamber'));
      this.rechamberAction.setLoop(THREE.LoopOnce, 1);
      this.rechamberAction.clampWhenFinished = true;
    }
    if (this.clips.has('adsRechamber') && this.idleAction) {
      this.adsRechamberAction = this.mixer.clipAction(this.clips.get('adsRechamber'));
      this.adsRechamberAction.setLoop(THREE.LoopOnce, 1);
      this.adsRechamberAction.clampWhenFinished = true;
    }
    if (this.clips.has('melee') && this.idleAction) {
      this.meleeAction = this.mixer.clipAction(this.clips.get('melee'));
      this.meleeAction.setLoop(THREE.LoopOnce, 1);
      this.meleeAction.clampWhenFinished = true;
    }
    if (this.clips.has('pullPin') && this.idleAction) {
      this.pullPinAction = this.mixer.clipAction(this.clips.get('pullPin'));
      this.pullPinAction.setLoop(THREE.LoopOnce, 1);
      this.pullPinAction.clampWhenFinished = true;
    }
    if (this.clips.has('throw') && this.idleAction) {
      this.throwAction = this.mixer.clipAction(this.clips.get('throw'));
      this.throwAction.setLoop(THREE.LoopOnce, 1);
      this.throwAction.clampWhenFinished = true;
    }
  }

  /**
   * Mounts the knife model on the hands' knife tag, hidden until a melee. The
   * rifle rigs melee with knife_mp's clips, which animate tag_knife_attach.
   */
  attachKnife(knifeScene, tagName = 'tag_knife_attach') {
    const tag = findNode(this.root, tagName);
    if (!tag || !knifeScene) return false;
    const knife = cloneSkinned(knifeScene);
    // The knife's own j_gun is its origin; the clip poses the tag it hangs on.
    knife.position.set(0, 0, 0);
    knife.quaternion.identity();
    knife.visible = false;
    knife.traverse((object) => {
      object.frustumCulled = false;
      if (object.isMesh) {
        object.castShadow = false;
        object.receiveShadow = false;
      }
    });
    tag.add(knife);
    this.knifeRoot = knife;
    return true;
  }

  /**
   * Registers a grenade body to show in the hand while that kind is thrown.
   * The M67 clips were authored for the grenade viewmodel, whose tag_weapon
   * is parked well out of view, so the body rides the throwing hand's wrist
   * with a small offset into the palm instead.
   */
  attachGrenadeModel(kind, grenadeScene, { tagName = 'j_wrist_ri', offset = GRENADE_PALM_OFFSET } = {}) {
    const tag = findNode(this.root, tagName) ?? findNode(this.root, 'tag_weapon');
    if (!tag || !grenadeScene) return false;
    const body = cloneSkinned(grenadeScene);
    body.position.fromArray(offset);
    body.quaternion.identity();
    body.visible = false;
    body.traverse((object) => {
      object.frustumCulled = false;
      // The frag body ships with no colour map; untinted it renders white.
      if (object.isMesh) tintUntexturedGrenade(object);
    });
    tag.add(body);
    this.grenadeModels.set(kind, body);
    return true;
  }

  /**
   * Swing. Returns false while another action owns the hands. `strikeDelay`
   * is when the blade lands, from the weapon file's meleeDelay; `duration`
   * the lockout, meleeTime. The knife shows for rifle swings only.
   */
  melee({ strikeDelay = 0.125, duration = 0.8, knife = true } = {}) {
    if (!this.ready || this.reloading || this.meleeing || this.throwing || this.rechambering || this.pendingRechamber || !this.meleeAction) return false;
    this.meleeing = true;
    this.meleeTimer = duration;
    this.meleeStrikeAt = strikeDelay;
    this.meleeStruck = false;
    for (const other of [this.fireAction, this.adsFireAction, this.introFireAction, this.introAdsFireAction]) other?.stop();
    this.meleeAction.reset().fadeIn(0.04).play();
    this.idleAction?.fadeOut(0.04);
    if (this.knifeRoot) this.knifeRoot.visible = Boolean(knife);
    this.startNotetracks('melee', this.meleeAction);
    return true;
  }

  /**
   * Begin a throw: the gun leaves the view, the grenade appears in the hand
   * and the pin comes out. The fuse starts now when the grenade cooks.
   */
  beginThrow(kind) {
    if (!this.ready || this.reloading || this.meleeing || this.throwing || this.rechambering || this.pendingRechamber || !this.throwAction) return false;
    this.throwing = true;
    this.throwPhase = 'pin';
    this.throwKind = kind;
    this.setAiming(false);
    for (const other of [this.fireAction, this.adsFireAction, this.introFireAction, this.introAdsFireAction]) other?.stop();
    if (this.weaponRoot) this.weaponRoot.visible = false;
    const body = this.grenadeModels.get(kind);
    if (body) body.visible = true;
    const action = this.pullPinAction ?? this.throwAction;
    action.reset().fadeIn(0.06).play();
    this.idleAction?.fadeOut(0.06);
    this.startNotetracks(this.pullPinAction ? 'pullPin' : 'throw', action);
    return true;
  }

  /** Let go: play the throw; `onThrowRelease` fires at the release frame. */
  releaseThrow() {
    if (!this.throwing || this.throwPhase === 'throw') return false;
    this.throwPhase = 'throw';
    this.pullPinAction?.fadeOut(0.05);
    this.throwAction.reset().fadeIn(0.05).play();
    this.startNotetracks('throw', this.throwAction);
    this.throwReleased = false;
    return true;
  }

  finishThrow() {
    if (!this.throwing) return;
    this.throwing = false;
    this.throwPhase = null;
    for (const body of this.grenadeModels.values()) body.visible = false;
    if (this.weaponRoot) this.weaponRoot.visible = true;
    this.throwAction?.fadeOut(0.1);
    this.pullPinAction?.stop();
    this.stopNotetracks();
    this.idleAction?.reset().fadeIn(0.12).play();
  }

  /**
   * Work the bolt. Plays the scoped or hip rechamber clip and blocks firing
   * and reloading until it ends. Returns false when nothing is loaded.
   */
  rechamber() {
    const action = this.aimBlend > 0.5 && this.adsRechamberAction ? this.adsRechamberAction : this.rechamberAction;
    if (!this.ready || !action || this.rechambering || this.reloading) return false;
    this.rechambering = true;
    this.pendingRechamber = false;
    for (const other of [this.fireAction, this.adsFireAction]) other?.stop();
    action.reset().fadeIn(0.03).play();
    this.idleAction?.fadeOut(0.03);
    this.startNotetracks(action === this.adsRechamberAction ? 'adsRechamber' : 'rechamber', action);
    return true;
  }

  onClipFinished(event) {
    if (event.action === this.rechamberAction || event.action === this.adsRechamberAction) {
      this.rechambering = false;
      this.stopNotetracks();
      this.idleAction.reset().fadeIn(0.08).play();
      event.action.fadeOut(0.08);
      return;
    }
    if (event.action === this.meleeAction) {
      this.meleeing = false;
      if (this.knifeRoot) this.knifeRoot.visible = false;
      this.stopNotetracks();
      this.idleAction.reset().fadeIn(0.1).play();
      event.action.fadeOut(0.1);
      return;
    }
    if (event.action === this.throwAction) {
      if (!this.throwReleased) {
        this.throwReleased = true;
        this.onThrowRelease?.(this.throwKind);
      }
      this.finishThrow();
      return;
    }
    if (event.action === this.pullPinAction) {
      // Cooking: the hand holds the pinned grenade until the key is released.
      return;
    }
    if (event.action === this.reloadAction || event.action === this.reloadEmptyAction) {
      this.reloading = false;
      this.showSpareMagazine(false);
      this.stopNotetracks();
      this.idleAction.reset().fadeIn(0.12).play();
      event.action.fadeOut(0.12);
      return;
    }
    if ([this.fireAction, this.adsFireAction, this.introFireAction, this.introAdsFireAction]
      .includes(event.action)) {
      event.action.stop();
      // A bolt-action works the bolt as soon as the shot's own clip is done.
      if (this.pendingRechamber && !this.reloading && this.rechamber()) return;
      if (!this.reloading) this.idleAction.reset().fadeIn(0.06).play();
    }
  }

  reload(empty = false) {
    const action = empty && this.reloadEmptyAction ? this.reloadEmptyAction : this.reloadAction;
    if (!this.ready || !action || this.reloading || this.meleeing || this.throwing) return false;
    // A reload cuts a rechamber short; the fresh magazine chambers a round.
    this.rechamberAction?.stop();
    this.adsRechamberAction?.stop();
    this.rechambering = false;
    this.pendingRechamber = false;
    this.reloading = true;
    this.fireAction?.stop();
    this.adsFireAction?.stop();
    this.introFireAction?.stop();
    this.introAdsFireAction?.stop();
    action.reset().fadeIn(0.12).play();
    this.idleAction.fadeOut(0.12);
    // The empty magazine still holds the well; the fresh one waits for mag_out.
    this.showSpareMagazine(false);
    this.startNotetracks(empty && this.reloadEmptyAction ? 'reloadEmpty' : 'reload', action);
    return true;
  }

  // Exactly one magazine is ever on the gun. The empty one holds the well until
  // the clip releases it, the fresh one owns the rest of the reload, and the
  // swap happens on the mag_out cue, which is authored at the moment of release.
  //
  // Showing the fresh one for the whole reload instead put two magazines on the
  // gun: the tracks park it wherever the hand is about to pick it up, and on the
  // sig556 that is the magwell itself for the first 1.6s of a 2.5s clip. Timing
  // the swap off the cue keeps it correct without per-rig tuning, since the cue
  // is authored against the same motion on every rig.
  handOverMagazine() {
    if (!this.spareMagazine) return false;
    this.spareMagazine.visible = true;
    if (this.magazineRoot) this.magazineRoot.visible = false;
    return true;
  }

  // Back to the resting state: the empty magazine's track has run itself out to
  // wherever it was thrown, but the action stops with it and the node returns to
  // its bind in the well, so the seated magazine is the right one to show again.
  showSpareMagazine(visible) {
    if (!this.spareMagazine) return false;
    this.spareMagazine.visible = Boolean(visible);
    if (this.magazineRoot) this.magazineRoot.visible = !visible;
    return true;
  }

  cancelReload() {
    if (!this.reloading) return false;
    this.reloadAction?.stop();
    this.reloadEmptyAction?.stop();
    this.stopNotetracks();
    this.reloading = false;
    this.showSpareMagazine(false);
    this.idleAction?.reset().fadeIn(0.08).play();
    return true;
  }

  startNotetracks(clipKey, action) {
    const events = this.notetracks.get(clipKey) ?? [];
    this.notetrackAction = action;
    this.activeTimeline = events.length ? new NotetrackTimeline(events) : null;
  }

  stopNotetracks() {
    this.activeTimeline = null;
    this.notetrackAction = null;
  }

  fire({ intro = false } = {}) {
    if (!this.ready || this.reloading || this.meleeing || this.throwing || this.rechambering) return false;
    if (this.boltAction) this.pendingRechamber = true;
    const aiming = this.aimBlend > 0.5;
    const action = intro
      ? (aiming && this.introAdsFireAction ? this.introAdsFireAction : this.introFireAction)
      : (aiming && this.adsFireAction ? this.adsFireAction : this.fireAction);
    if (action) {
      for (const other of [
        this.fireAction,
        this.adsFireAction,
        this.introFireAction,
        this.introAdsFireAction,
      ]) {
        if (other !== action) other?.stop();
      }
      this.idleAction?.fadeOut(0.02);
      action.reset().setEffectiveWeight(1).fadeIn(0.005).play();
    }
    this.flashTime = 0.045;
    if (this.muzzleFlash) {
      this.muzzleFlash.material.rotation = Math.random() * Math.PI;
      this.muzzleFlash.material.opacity = 1;
      this.muzzleFlash.visible = true;
    }
    if (this.muzzleLight) this.muzzleLight.intensity = 7;
    return true;
  }

  setAiming(aiming) {
    this.aiming = Boolean(aiming);
  }

  resetAiming() {
    this.setAiming(false);
    this.adsTransition.reset();
    this.aimBlend = 0;
    if (this.scoped) this.onScopeChange?.(false);
    this.scoped = false;
    if (this.root) this.root.visible = true;
  }

  // A new life cannot inherit a delayed strike, throw or bolt animation.
  resetActions({ preserveChamber = false } = {}) {
    const needsChamber = preserveChamber && (this.rechambering || this.pendingRechamber);
    this.mixer?.stopAllAction();
    this.stopNotetracks();
    this.reloading = this.meleeing = this.throwing = false;
    this.rechambering = false;
    this.pendingRechamber = needsChamber;
    this.throwPhase = null;
    this.meleeStruck = this.throwReleased = true;
    this.showSpareMagazine(false);
    if (this.knifeRoot) this.knifeRoot.visible = false;
    if (this.weaponRoot) this.weaponRoot.visible = true;
    for (const body of this.grenadeModels.values()) body.visible = false;
    this.resetAiming();
    this.idleAction?.reset().play();
  }

  addLook(dx, dy) {
    this.pendingLook.x += dx;
    this.pendingLook.y += dy;
  }

  setSize(width, height) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  muzzlePosition(target = new THREE.Vector3()) {
    if (!this.ready || !this.tagFlash) return null;
    this.scene.updateMatrixWorld(true);
    return this.tagFlash.getWorldPosition(target);
  }

  update(dt, state = {}) {
    if (!this.ready) return;
    this.mixer?.update(dt);
    if (this.activeTimeline && this.notetrackAction) {
      for (const cue of this.activeTimeline.advance(this.notetrackAction.time)) {
        if (MAGAZINE_HANDOVER_CUE.test(cue.name)) this.handOverMagazine();
        this.onNotetrack?.(cue);
      }
    }
    if (this.meleeing) {
      this.meleeTimer = Math.max(0, this.meleeTimer - dt);
      // The blade lands meleeDelay into the swing, not at the end of the clip.
      if (!this.meleeStruck && this.meleeAction && this.meleeAction.time >= this.meleeStrikeAt) {
        this.meleeStruck = true;
        this.onMeleeStrike?.();
      }
      if (this.meleeTimer <= 0 && !this.meleeAction?.isRunning()) {
        this.meleeing = false;
        if (this.knifeRoot) this.knifeRoot.visible = false;
      }
    }
    if (this.throwing && this.throwPhase === 'throw' && !this.throwReleased && this.throwAction) {
      // The M67 throw lets go about a third of the way through the clip.
      if (this.throwAction.time >= this.throwAction.getClip().duration * 0.35) {
        this.throwReleased = true;
        this.onThrowRelease?.(this.throwKind);
      }
    }
    this.flashTime = Math.max(0, this.flashTime - dt);
    if (this.muzzleFlash) {
      const flash = clamp(this.flashTime / 0.045, 0, 1);
      this.muzzleFlash.visible = flash > 0;
      this.muzzleFlash.material.opacity = flash;
      this.muzzleFlash.scale.setScalar(6 + flash * 4);
      this.muzzleLight.intensity = flash * 7;
    }
    const speed = state.speed ?? 0;
    const grounded = state.grounded ?? true;
    const moving = Boolean(state.moving);
    const sprinting = Boolean(state.sprinting) && moving;

    // Smoothed look velocity drives the weapon lag (sway) behind the camera.
    const safeDt = Math.max(dt, 1e-4);
    this.lookVel.x = damp(this.lookVel.x, this.pendingLook.x / safeDt, 10, dt);
    this.lookVel.y = damp(this.lookVel.y, this.pendingLook.y / safeDt, 10, dt);
    this.pendingLook.set(0, 0);
    this.swayRot.x = damp(this.swayRot.x, clamp(-this.lookVel.y * 0.00035, -0.2, 0.2), 12, dt);
    this.swayRot.y = damp(this.swayRot.y, clamp(-this.lookVel.x * 0.00035, -0.3, 0.3), 12, dt);
    this.swayPos.x = damp(this.swayPos.x, clamp(-this.lookVel.x * 0.004, -1.2, 1.2), 10, dt);
    this.swayPos.y = damp(this.swayPos.y, clamp(this.lookVel.y * 0.004, -1.2, 1.2), 10, dt);

    // Walk bob: figure-eight drift scaled by ground speed. Ground contact
    // drops for a few physics steps on every stair riser and lip, so the
    // stride carries on briefly after the last contact instead of hitching.
    this.airTime = grounded ? 0 : this.airTime + dt;
    const movingGrounded = moving && this.airTime < BOB_GROUND_GRACE;
    const speedFactor = clamp(speed / 300, 0, 1.4);
    this.sprintBlend = damp(
      this.sprintBlend,
      sprinting && !this.aiming && !this.reloading ? 1 : 0,
      8,
      dt,
    );
    // Reloading, a melee or a throw cancels the sight picture, as in the game.
    this.aimBlend = this.adsTransition.update(dt, this.aiming && !this.reloading && !this.meleeing && !this.throwing);
    if (this.scope) {
      // The glass takes over at the top of the raise and lets go at the first
      // touch of the lower (adsZoomInFrac 0 / adsZoomOutFrac 0.05); the rig is
      // hidden while scoped so the page's overlay is the whole picture.
      const scoped = this.scoped ? this.aimBlend > SCOPE_OUT_FRAC : this.aimBlend >= SCOPE_IN_FRAC;
      if (scoped !== this.scoped) {
        this.scoped = scoped;
        this.root.visible = !scoped;
        this.onScopeChange?.(scoped);
      }
    }
    const sprint = this.sprintBlend;

    this.bobAmp = damp(this.bobAmp, movingGrounded ? speedFactor : 0, 8, dt);
    // The sprint stride is slower and heavier than the walk: fewer, longer
    // steps that throw the gun further across the body and roll it with them.
    if (movingGrounded) this.bobTime += dt * (5.5 + 4 * speedFactor) * (1 - SPRINT_BOB.slow * sprint);
    const bobX = Math.sin(this.bobTime) * 0.85 * this.bobAmp * (1 + SPRINT_BOB.widen * sprint);
    const bobY = Math.sin(this.bobTime * 2) * 0.45 * this.bobAmp * (1 + SPRINT_BOB.lift * sprint);
    const bobRoll = Math.sin(this.bobTime) * SPRINT_BOB.roll * this.bobAmp * sprint;
    const bobPitch = Math.sin(this.bobTime * 2) * SPRINT_BOB.pitch * this.bobAmp * sprint;

    const aimScale = 1 - this.aimBlend * 0.88;
    // Sprinting tightens the grip, so look lag eases off while the stride
    // bob carries on at full strength.
    const lagScale = aimScale * (1 - sprint * 0.6);
    this.sprintEuler.set(
      SPRINT_POSE.pitch * sprint,
      SPRINT_POSE.yaw * sprint,
      SPRINT_POSE.roll * sprint,
    );
    this.swayGroup.rotation.set(
      this.swayRot.x * lagScale + this.sprintEuler.x + bobPitch,
      this.swayRot.y * lagScale + this.sprintEuler.y,
      this.swayRot.y * -0.4 * lagScale + this.sprintEuler.z + bobRoll,
    );
    // Re-centre every rotation on the hand pivot: p + R(-p) keeps the pivot
    // fixed in camera space while the rest of the gun swings around it. That
    // covers look lag too, so a fast pitch swings the muzzle rather than
    // tilting the whole rig and pushing the shoulders through the near plane.
    this.pivotShift
      .copy(SPRINT_POSE.pivot)
      .negate()
      .applyEuler(this.swayGroup.rotation)
      .add(SPRINT_POSE.pivot);
    this.swayGroup.position.set(
      this.swayPos.x * lagScale + bobX * aimScale + SPRINT_POSE.x * sprint + this.pivotShift.x,
      this.swayPos.y * lagScale + bobY * aimScale + SPRINT_POSE.y * sprint + this.pivotShift.y,
      SPRINT_POSE.z * sprint + this.pivotShift.z,
    );

    this.adsGroup.position.copy(this.adsPos).multiplyScalar(this.aimBlend);
    if (this.aimBlend > 0) {
      this.adsGroup.quaternion.slerpQuaternions(this.identityQuat, this.adsQuat, this.aimBlend);
    } else {
      this.adsGroup.quaternion.identity();
    }
    this.camera.fov = this.baseFov + (this.adsFov - this.baseFov) * this.aimBlend;
    this.camera.updateProjectionMatrix();
  }

  render(renderer) {
    if (!this.ready) return;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
