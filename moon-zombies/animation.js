import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { assetManager, disposeSkeletons } from './runtime-assets.js';

const loader=new GLTFLoader(assetManager), models=new Map(), clips=new Map();
export async function loadModel(url){
  if(!url)return null;
  if(!models.has(url))models.set(url,loader.loadAsync(url).then(({scene})=>{
    // These native weapon shaders blend their texture alpha. The extracted
    // GLBs defaulted to opaque, turning lenses and reticles into solid plates.
    scene.traverse(node=>{for(const material of [].concat(node.material??[])){
      if(/(?:weapon|mtl_law).*?(?:lens|reticle|crosshair|red_dot)/.test(material.name)){
        material.transparent=true;material.depthWrite=false;material.alphaTest=.001;
      }
      // The reflex shader adds a lit dot from an RGB image. Alpha blending
      // leaves its black background opaque; repeating UVs creates nine dots.
      if(material.name==='mc/mtl_weapon_reflex_red_dot'){
        material.blending=THREE.AdditiveBlending;material.color.set(0x000000);
        material.emissive.set(0xff2010);material.emissiveMap=material.map;material.toneMapped=false;
        material.map.wrapS=material.map.wrapT=THREE.ClampToEdgeWrapping;material.map.needsUpdate=true;
      }
    }});
    scene.traverse(node=>{
      if(node.material?.name!=='mc/mtl_weapon_reflex_red_dot')return;
      // Native reflex UVs are centered at (-.5, 1.5), while the Cobra uses
      // (.5, .5). Center each surface without tiling the reticle texture.
      const uv=node.geometry.attributes.uv,index=node.geometry.index;
      const min=new THREE.Vector2(Infinity,Infinity),max=new THREE.Vector2(-Infinity,-Infinity),p=new THREE.Vector2();
      for(let i=0;i<(index?.count??uv.count);i++){p.fromBufferAttribute(uv,index?index.getX(i):i);min.min(p);max.max(p);}
      node.material=node.material.clone();const map=node.material.map.clone();
      map.offset.set(.5-(min.x+max.x)/2,.5-(min.y+max.y)/2);map.needsUpdate=true;
      node.material.map=node.material.emissiveMap=map;
    });
    return scene;
  }));
  return clone(await models.get(url));
}
export async function loadAnimation(url){if(!clips.has(url))clips.set(url,fetch(url).then(r=>{if(!r.ok)throw new Error('Animation '+url+': '+r.status);return r.json();}));return clips.get(url);}
export function makeClip(root, data, locomotion=false){
  const tracks=[];const nodes=new Map();
  root.traverse(n=>{if(!nodes.has(n.name))nodes.set(n.name,[]);nodes.get(n.name).push(n);});
  for(const b of data.bones){
    if(b.name==='tag_sync')continue;
    for(const node of nodes.get(b.name)??[]){
      if(b.name==='tag_origin'&&!node.userData.weaponBindPosition)continue;
      if(node.userData.animationAnchor)continue;
      if(b.rot){
        const values=b.rot.values.slice(),offset=node.userData.weaponRotationOffset;
        if(offset){const correction=new THREE.Quaternion().fromArray(offset),q=new THREE.Quaternion();for(let i=0;i<values.length;i+=4)q.fromArray(values,i).premultiply(correction).normalize().toArray(values,i);}
        tracks.push(new THREE.QuaternionKeyframeTrack(node.uuid+'.quaternion',b.rot.frames.map(f=>f/data.fps),values));
      }
      if(b.pos){
        const values=b.pos.values.slice();
        // Weapon-part tracks are displacements from the model's bind joints.
        // Arm tracks already contain absolute local positions. Treating both
        // alike lifts shells out of their chambers and separates knife parts.
        const bind=node.userData.weaponBindPosition;
        if(bind)for(let i=0;i<values.length;i++)values[i]+=bind[i%3];
        // T5 locomotion stores j_mainroot translations as displacement from
        // the bind pelvis, unlike the absolute viewmodel pose tracks.
        if(locomotion&&b.name==='j_mainroot')for(let i=0;i<values.length;i+=3){values[i]=node.position.x;values[i+1]=node.position.y;values[i+2]+=node.position.z;}
        tracks.push(new THREE.VectorKeyframeTrack(node.uuid+'.position',b.pos.frames.map(f=>f/data.fps),values));
      }
    }
  }
  return new THREE.AnimationClip(data.name,Math.max(1/data.fps,data.duration),tracks);
}
export class Rig {
  constructor(root,onNotify=()=>{}){this.root=root;this.mixer=new THREE.AnimationMixer(root);this.actions={};this.data={};this.current=null;this.onNotify=onNotify;this.elapsed=0;}
  add(key,data,locomotion=false){this.data[key]=data;this.actions[key]=this.mixer.clipAction(makeClip(this.root,data,locomotion));}
  play(key,loop=true,speed=1,fade=.1){
    const a=this.actions[key];if(!a)return false;if(this.current===key&&loop)return true;
    const old=this.actions[this.current];
    // Fading a short firing action into itself erased most of its recoil.
    if(old&&old!==a){if(fade)old.fadeOut(fade);else old.stop();}
    a.stop().reset().setEffectiveWeight(1).setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);
    a.clampWhenFinished=!loop;a.timeScale=speed;if(fade)a.fadeIn(fade);a.play();this.current=key;this.elapsed=-1e-6;return true;
  }
  update(dt){
    const action=this.actions[this.current],data=this.data[this.current],before=this.elapsed;
    if(action){this.elapsed+=dt*action.timeScale;for(const n of data.notifies??[])if(n.time>before&&n.time<=this.elapsed)this.onNotify(n.name,this.current);}
    this.mixer.update(dt);
  }
}

const basis=new THREE.Matrix4().makeBasis(new THREE.Vector3(0,0,-1),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,1,0));
export class ViewWeapon {
  constructor(scene,data,onSound=()=>{}){
    this.scene=scene;this.data=data;this.onSound=onSound;this.pivot=new THREE.Group();scene.add(this.pivot);
    this.token=0;this.currentId=null;this.recoil=0;this.aim=0;this.mode='idle';this.meleeLeft=0;this.sprintBlend=0;
  }
  // first: a newly given weapon plays firstRaiseAnim over firstRaiseTime instead of raiseAnim.
  async equip(def,{first=false}={}){
    const key=def.id+(def.upgraded?':upgraded':'')+(def.attachmentActive?':attachment':'');
    if(this.currentId===key&&this.ready)return;this.currentId=key;this.ready=false;const token=++this.token;
    this.pivot.visible=false;
    const [hands,gun,leftGun,...knives]=await Promise.all([
      loadModel(def.handsModel??this.data.characters.viewmodel_usa_pow_arms??this.data.characters.viewhands_usmc),loadModel(def.model),
      def.leftModel?loadModel(def.leftModel):Promise.resolve(null),
      ...Object.values(this.data.melee).map(d=>loadModel(d.model))]);
    const entries=await Promise.all(Object.entries(def.animations).map(async([key,url])=>[key,await loadAnimation(url)]));
    if(def.leftAnimations){
      const left=new Map(await Promise.all(Object.entries(def.leftAnimations).filter(([key])=>key.endsWith('AnimLeft')).map(async([key,url])=>[key,await loadAnimation(url)])));
      const right=new Map(entries),combine=(a,b,name)=>a&&b?{...a,name,duration:Math.max(a.duration,b.duration),bones:[...a.bones,...b.bones.filter(n=>!a.bones.some(r=>r.name===n.name))]}:a;
      for(const [key,clip]of right){const l=(key.startsWith('reload')?left.get('reloadAnimLeft'):left.get('idleAnimLeft'));if(l&&['idleAnim','fireAnim','lastShotAnim','reloadAnim','reloadEmptyAnim'].includes(key))entries.push([key,combine(clip,l,clip.name+'-dual')]);}
      if(left.has('fireAnimLeft'))entries.push(['leftFireAnim',combine(left.get('fireAnimLeft'),right.get('idleAnim'),'dual-left-fire')]);
    }
    const meleeEntries=await Promise.all(Object.entries(this.data.melee).flatMap(([type,d])=>
      Object.entries(d.animations).filter(([k])=>k.startsWith('melee')).map(async([key,url])=>[type+':'+key,await loadAnimation(url)])));
    if(token!==this.token){for(const model of [hands,gun,leftGun,...knives])disposeSkeletons(model);return;}
    if(this.rig)this.rig.mixer.uncacheRoot(this.rig.root);
    disposeSkeletons(this.root);
    if(!hands||!gun)throw new Error('Missing viewmodel for '+def.id);
    this.def=def;this.pivot.clear();this.pivot.position.set(0,0,0);this.pivot.rotation.set(0,0,0);
    // Assemble outside the scene. Using matrixWorld under the previous gun's
    // ADS/recoil pivot baked that pose into every subsequent weapon attachment.
    this.root=new THREE.Group();this.root.add(hands);this.gun=gun;this.hands=hands;
    const view=hands.getObjectByName('tag_view'),tag=hands.getObjectByName('tag_weapon');
    if(!view||!tag)throw new Error('Missing viewmodel attachment bones');
    view.userData.animationAnchor=true;
    this.root.updateMatrixWorld(true);
    const cameraBasis=new THREE.Matrix4().multiplyMatrices(basis,view.matrixWorld.clone().invert());
    const attach=(model,parent,boneName)=>{
      model.updateMatrixWorld(true);
      let bone=model.getObjectByName(boneName);model.traverse(n=>{if(!bone&&n.isBone)bone=n;});
      if(!bone)throw new Error('Missing attachment root '+boneName);
      bone.userData.animationAnchor=true;
      model.matrixAutoUpdate=false;model.matrix.copy(bone.matrixWorld).invert();parent.add(model);
    };
    attach(gun,tag,'j_gun');
    this.leftGun=leftGun;
    if(leftGun){const leftTag=hands.getObjectByName('tag_weapon1');if(leftTag)attach(leftGun,leftTag,leftGun.getObjectByName('j_gun1')?'j_gun1':'j_gun');}
    for(const model of [gun,leftGun])model?.traverse(node=>{if(node.isBone&&!node.userData.animationAnchor)node.userData.weaponBindPosition=node.position.toArray();});
    // AUG's embedded Masterkey pump has a different joint basis from the
    // attachment clips. Retarget their rest rotation while keeping the motion.
    if(def.id==='aug_acog_zm'){
      const pump=gun.getObjectByName('tag_pump2'),rest=entries.find(([key])=>key==='idleAnim')?.[1].bones.find(b=>b.name==='tag_pump2')?.rot;
      if(pump&&rest)pump.userData.weaponRotationOffset=pump.quaternion.clone().multiply(new THREE.Quaternion().fromArray(rest.values).invert()).normalize().toArray();
    }
    // Bottles animate j_gun relative to tag_weapon throughout opening/drinking.
    // Freezing that root leaves the bottle behind while the hands move away.
    if(def.id.startsWith('zombie_perk_bottle_')){gun.getObjectByName('j_gun').userData.animationAnchor=false;gun.matrix.identity();}
    this.knives={};const knifeTag=hands.getObjectByName('tag_knife_attach');
    if(knifeTag)Object.keys(this.data.melee).forEach((type,i)=>{attach(knives[i],knifeTag,'tag_knife');knives[i].visible=false;this.knives[type]=knives[i];});
    this.hiddenTags=[];
    for(const name of def.hideTags??[]){const bone=gun.getObjectByName(name);if(bone){bone.scale.setScalar(.000001);this.hiddenTags.push(name);}}
    this.root.matrixAutoUpdate=false;this.root.matrix.copy(cameraBasis);this.pivot.add(this.root);
    this.rig=new Rig(this.root,(name)=>this.onSound(name,this.meleeType?this.data.melee[this.meleeType]:this.def));
    for(const [key,clip] of [...entries,...meleeEntries])this.rig.add(key,clip);
    // ADS is a separate native animation of tag_torso. Its first frame also
    // defines each gun's HIP pose; the arms' bind torso is only right for M1911.
    const aimData=entries.find(([key])=>key==='adsUpAnim')?.[1];
    this.aimTracks=[];this.aimDuration=aimData?.duration??0;
    for(const b of aimData?.bones??[]){const node=hands.getObjectByName(b.name);if(!node)continue;
      if(b.pos)this.aimTracks.push({node,property:'position',sample:new THREE.VectorKeyframeTrack('',b.pos.frames.map(f=>f/aimData.fps),b.pos.values).createInterpolant()});
      if(b.rot)this.aimTracks.push({node,property:'quaternion',sample:new THREE.QuaternionKeyframeTrack('',b.rot.frames.map(f=>f/aimData.fps),b.rot.values).createInterpolant()});
    }
    this.aim=0;this.recoil=0;this.meleeLeft=0;this.meleeType=null;this.sprintBlend=0;this.applyAim();
    this.rig.play('idleAnim',true,1,0);this.rig.update(0);
    const raise=first&&this.rig.actions.firstRaiseAnim?'firstRaiseAnim':'raiseAnim';
    this.mode=this.rig.play(raise,false,this.clipSpeed(raise,raise==='firstRaiseAnim'?def.firstRaiseTime??def.raiseTime:def.raiseTime),.04)?'raise':'idle';
    this.root.traverse(o=>{o.frustumCulled=false;});
    this.ready=true;this.pivot.visible=true;
  }
  clipSpeed(key,duration){return duration>0?(this.rig.data[key]?.duration??duration)/duration:1;}
  applyAim(restOnly=false){
    for(const t of this.aimTracks){
      const b=this.rig.data[this.rig.current]?.bones.find(b=>b.name===t.node.name);
      if(restOnly&&b?.[t.property==='position'?'pos':'rot'])continue;
      t.node[t.property].fromArray(t.sample.evaluate(restOnly?0:this.aim*this.aimDuration));
    }
  }
  shoot({ads=false,empty=false,hand='right'}={}){
    if(!this.ready||this.meleeLeft>0)return;
    let key=ads?(empty?'adsLastShotAnim':'adsFireAnim'):(empty?'lastShotAnim':'fireAnim');
    if(hand==='left'&&this.rig.actions.leftFireAnim)key='leftFireAnim';
    if(!this.rig.actions[key])key='fireAnim';this.recoil=1;this.mode='fire';this.rig.play(key,false,1,0);
  }
  reload(empty,duration,stage='magazine'){
    if(!this.ready)return;const key=stage==='start'?'reloadStartAnim':stage==='end'?'reloadEndAnim':empty&&this.rig.actions.reloadEmptyAnim?'reloadEmptyAnim':'reloadAnim';
    this.mode='reload';this.aim=0;this.rig.play(key,false,this.clipSpeed(key,duration),.06);
  }
  melee(type='knife',charge=false){
    if(!this.ready||this.meleeLeft>0)return null;
    if(this.def.melee){
      const d=this.def.melee,key=charge?'meleeChargeAnim':'meleeAnim',duration=Math.max(charge?d.meleeChargeTime:d.meleeTime,this.rig.data[key]?.duration??0);
      this.meleeType=null;this.meleeLeft=duration;this.mode='melee';this.aim=0;this.rig.play(key,false,this.clipSpeed(key,duration),0);
      return {duration,delay:charge?d.meleeChargeDelay:d.meleeDelay,damage:d.meleeDamage};
    }
    const def=this.data.melee[type],key=type+':'+(charge?'meleeChargeAnim':'meleeAnim');
    const duration=Math.max(charge?def.chargeTime:def.time,this.rig.data[key].duration);
    this.meleeType=type;this.meleeLeft=duration;this.mode='melee';this.aim=0;
    for(const [k,model] of Object.entries(this.knives))model.visible=k===type;
    this.rig.play(key,false,this.clipSpeed(key,duration),0);
    return {duration,delay:charge?def.chargeDelay:def.delay,damage:def.damage};
  }
  // setlowready: the in clip, its loop while held, then the out clip back to idle.
  lowReady(on){
    if(!this.ready)return false;
    if(on){if(!this.rig.actions.lowReadyInAnim)return false;this.mode='lowReadyIn';this.rig.play('lowReadyInAnim',false,1,.06);return true;}
    if(!['lowReadyIn','lowReady'].includes(this.mode))return false;this.mode='lowReadyOut';if(!this.rig.play('lowReadyOutAnim',false,1,.06))this.mode='idle';return true;
  }
  update(dt,{moving=false,sprint=false,ads=false,reloading=false,empty=false,time=0}={}){
    if(!this.ready)return;
    this.rig.update(dt);this.meleeLeft=Math.max(0,this.meleeLeft-dt);
    const action=this.rig.actions[this.rig.current],finished=!action?.isRunning();
    const sprintKey=phase=>{const key='sprint'+phase+(empty?'Empty':'')+'Anim';return this.rig.actions[key]?key:'sprint'+phase+'Anim';};
    if(this.mode==='melee'&&this.meleeLeft===0){for(const model of Object.values(this.knives))model.visible=false;this.meleeType=null;this.mode='idle';}
    if(this.mode==='reload'&&!reloading)this.mode='idle';
    if(['fire','raise','sprintOut','lowReadyOut'].includes(this.mode)&&finished)this.mode='idle';
    if(this.mode==='lowReadyIn'&&finished){this.mode='lowReady';this.rig.play(this.rig.actions.lowReadyLoopAnim?'lowReadyLoopAnim':'idleAnim',true,1,.04);}
    if(this.mode==='sprintIn'&&finished){this.mode='sprint';this.rig.play(sprintKey('Loop'),true,this.clipSpeed(sprintKey('Loop'),this.def.sprintLoopTime),.04);}
    if(['idle','fire'].includes(this.mode)&&sprint){this.mode='sprintIn';if(!this.rig.play(sprintKey('In'),false,this.clipSpeed(sprintKey('In'),this.def.sprintInTime),.06)){this.mode='sprint';this.rig.play(this.rig.actions[sprintKey('Loop')]?sprintKey('Loop'):'idleAnim');}}
    if(['sprint','sprintIn'].includes(this.mode)&&!sprint){this.mode='sprintOut';if(!this.rig.play(sprintKey('Out'),false,this.clipSpeed(sprintKey('Out'),this.def.sprintOutTime),.04))this.mode='idle';}
    if(this.mode==='idle')this.rig.play(empty&&this.rig.actions.emptyIdleAnim?'emptyIdleAnim':'idleAnim',true,1,.06);
    const aiming=ads&&['idle','fire'].includes(this.mode);
    this.aim=THREE.MathUtils.clamp(this.aim+(aiming?dt/Math.max(.01,this.def.adsInTime):-dt/Math.max(.01,this.def.adsOutTime)),0,1);
    this.applyAim(!['idle','fire'].includes(this.mode));
    this.recoil=Math.max(0,this.recoil-dt*8);
    const bob=moving&&this.mode!=='melee'?(1-this.aim)*.13:0;
    this.pivot.position.set(Math.sin(time*(sprint?13:9))*bob,Math.cos(time*(sprint?26:18))*bob*.7,this.recoil*.25);
    this.pivot.rotation.set(this.recoil*.012,0,0);
    // Ray Gun uses authored weapon offsets in place of sprint XAnims.
    const offsetSprint=sprint&&!this.rig.actions.sprintLoopAnim&&this.mode==='sprint';
    this.sprintBlend=THREE.MathUtils.damp(this.sprintBlend,offsetSprint?1:0,16,dt);
    if(this.sprintBlend>.001){this.pivot.position.addScaledVector(new THREE.Vector3(...this.def.sprintOffset),this.sprintBlend);const r=this.def.sprintRotation;this.pivot.rotation.set(r[0]*this.sprintBlend,r[1]*this.sprintBlend,r[2]*this.sprintBlend);}
    this.root.updateMatrixWorld(true);
  }
  snapshot(){
    const position=name=>this.root?.getObjectByName(name)?.getWorldPosition(new THREE.Vector3()).toArray();
    return {ready:this.ready,id:this.currentId,hiddenTags:this.hiddenTags??[],mode:this.mode,animation:this.rig?.current,
      time:this.rig?.actions[this.rig.current]?.time,aim:this.aim,melee:this.meleeType,meleeLeft:this.meleeLeft,
      knifeVisible:Object.entries(this.knives??{}).filter(([,m])=>m.visible).map(([k])=>k),
      gun:position('j_gun'),knife:position('tag_knife_attach'),torso:this.hands?.getObjectByName('tag_torso')?.position.toArray()};
  }
}
