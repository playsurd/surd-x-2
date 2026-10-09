import * as THREE from 'three';
import { Powerups } from './powerups.js';
import { loadModel } from './animation.js';
import { POWERUP_LIFETIME, powerupVisible } from './rules.js';

// _zombiemode_powerups.gsc: solo pickups use the blue effect; zombie-grabbable pickups glow red,
// cannot be taken by players and trigger when an AI enters a 32x72 radius (powerup_zombie_grab).
export class MoonPowerups extends Powerups {
  constructor(...args){
    super(...args);
    this.auras={solo:this.spriteMaterial.clone(),grab:this.spriteMaterial.clone()};
    this.auras.solo.color.setHex(0x3f8cff);this.auras.grab.color.setHex(0xff3624);
  }
  spawn(type,position,{weapon=null}={}){
    const item=super.spawn(type,position);if(!item)return null;
    const def=this.data.powerups[type];item.def=def;item.weapon=weapon;
    const aura=def.zombieGrabbable?this.auras.grab:def.solo?this.auras.solo:null;
    if(aura)for(const sprite of [item.aura,...item.motes])sprite.material=aura;
    if(weapon){
      const d=this.data.weapons[weapon.id],url=weapon.upgraded?d?.upgrade?.worldModel??d?.worldModel:d?.worldModel??this.data.equipment?.[weapon.id]?.worldModel;
      if(url)loadModel(url).then(model=>{if(!this.items.includes(item))return;item.root.remove(item.model);model.traverse(o=>{if(o.isMesh)o.frustumCulled=false;});item.root.add(model);item.model=model;});
    }
    return item;
  }
  // powerup_setup on an existing power-up: a new type and model in place, keeping its timeout.
  retype(item,type,position=null){
    const def=this.data.powerups[type],template=this.templates[type];if(!def||!template)return false;
    item.root.remove(item.model);item.model=template.clone(true);item.root.add(item.model);item.type=type;item.def=def;
    const aura=def.zombieGrabbable?this.auras.grab:def.solo?this.auras.solo:this.spriteMaterial;for(const sprite of [item.aura,...item.motes])sprite.material=aura;
    if(position)item.root.position.copy(position);return true;
  }
  update(dt,feet,canCollect=true,lineClear=()=>true,zombies=[],onZombieGrab=()=>{}){
    for(const p of [...this.items]){
      p.age+=dt;p.turn+=dt;
      if(p.turn>=p.duration){p.from.copy(p.model.quaternion);p.to.setFromEuler(new THREE.Euler((Math.random()-.5)*2.1,Math.random()*Math.PI*2,(Math.random()-.5)*1.57));p.duration=2.5+Math.random()*2.5;p.turn=0;}
      const t=p.turn/p.duration;p.model.quaternion.slerpQuaternions(p.from,p.to,t*t*(3-2*t));p.model.visible=powerupVisible(p.age);
      p.aura.scale.setScalar(88+Math.sin(p.age*3)*7);
      p.motes.forEach((m,i)=>{const a=p.age*1.4+i*2.4;m.position.set(Math.cos(a)*(16+i%3*4),((p.age*24+i*7)%65)-30,Math.sin(a)*(16+i%3*4));});
      if(p.age>=POWERUP_LIFETIME){this.remove(p);continue;}
      if(p.def?.zombieGrabbable){
        const z=zombies.find(z=>{const d=z.root.position.clone().sub(p.root.position);return Math.hypot(d.x,d.z)<32&&d.y>-40&&d.y<32;});
        if(z){const position=p.root.position.clone();this.remove(p);this.burst(position);onZombieGrab(p.type,position,p);}
        continue;
      }
      // powerup_grab: within 64 of the player's origin, without a sight check; canCollect may refuse a type (last stand).
      if((typeof canCollect==='function'?canCollect(p.type):canCollect)&&feet.distanceTo(p.root.position)<64){
        const position=p.root.position.clone();this.remove(p);this.burst(position);this.onCollect(p.type,position,p);
      }
    }
    for(const b of [...this.bursts]){b.age+=dt;b.sprite.scale.setScalar(30+b.age*240);b.sprite.material.opacity=Math.max(0,1-b.age*1.8);if(b.age>.6){b.sprite.removeFromParent();b.sprite.material.dispose();this.bursts.splice(this.bursts.indexOf(b),1);}}
  }
  snapshot(){return super.snapshot().map((s,i)=>({...s,weapon:this.items[i]?.weapon??null,zombieGrabbable:!!this.items[i]?.def?.zombieGrabbable}));}
}
