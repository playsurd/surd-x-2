import * as THREE from 'three';
import { DIGGERS } from './moon-progression.js';

// zombie_moon_digger.gsc digger_think_move / digger_follow_path / digger_arm_logic: the tracks
// follow their vehicle nodes, the body and arm are linked to them, the arm pitches by
// down_angle to dig and the bucket wheel spins; diggers_visible hides them in No Man's Land.
const V=a=>new THREE.Vector3(...a),rad=d=>THREE.MathUtils.degToRad(d);
export class MoonExcavators {
  constructor(data,objects,scene,paths){Object.assign(this,{data,objects,scene,paths});this.rigs={};}
  build(){
    const E=this.data.entities,find=n=>E.find(e=>e.targetname===n);
    for(const [id,D] of Object.entries(DIGGERS)){
      const tracks=E.find(e=>e.target===D.path&&e.model==='p_zom_digger_body'),body=tracks&&E.find(e=>e.targetname==='digger_body'&&e.target===tracks.targetname);
      const arm=body&&E.find(e=>e.targetname===body.target&&e.model==='p_zom_digger_arm'),center=arm&&find(arm.target),blade=center&&find(center.target);
      if(!tracks||!arm||!center||!blade)continue;
      const rig=new THREE.Group(),pivot=new THREE.Group(),spin=new THREE.Group();
      rig.position.copy(V(tracks.position));rig.rotation.y=tracks.yaw;this.scene.add(rig);rig.updateMatrixWorld(true);
      pivot.position.copy(V(arm.position));pivot.rotation.y=arm.yaw;spin.position.copy(V(center.position));spin.rotation.y=arm.yaw;
      rig.attach(pivot);pivot.attach(spin);
      const parts=[tracks,body].map(e=>this.objects.get(e.id)).filter(Boolean);for(const o of parts)rig.attach(o);
      const armObject=this.objects.get(arm.id),bladeObject=this.objects.get(blade.id);if(armObject)pivot.attach(armObject);if(bladeObject)spin.attach(bladeObject);
      this.rigs[id]={id,rig,pivot,spin,rest:pivot.quaternion.clone(),spinRest:spin.quaternion.clone(),down:D.down,angle:0,ids:[tracks,body,arm,blade].map(e=>e.id)};
    }
  }
  place(id,progress){
    const r=this.rigs[id],path=this.paths[id];if(!r||!path?.nodes.length)return;
    let left=progress*path.length,i=0;const n=path.nodes;
    while(i<n.length-2){const s=V(n[i].position).distanceTo(V(n[i+1].position));if(left<=s)break;left-=s;i++;}
    const a=n[i],b=n[Math.min(i+1,n.length-1)],length=Math.max(1e-6,V(a.position).distanceTo(V(b.position))),f=Math.min(1,left/length);
    r.rig.position.copy(V(a.position).lerp(V(b.position),f));
    const ya=rad(Number((a.angles??'0 0 0').split(' ')[1])),yb=rad(Number((b.angles??'0 0 0').split(' ')[1])),d=Math.atan2(Math.sin(yb-ya),Math.cos(yb-ya));
    r.rig.rotation.y=ya+d*f;
  }
  update(dt,diggers,visible){
    for(const [id,r] of Object.entries(this.rigs)){
      const d=diggers[id];r.rig.visible=visible;this.place(id,d.progress);
      // RotatePitch(down_angle): positive pitch turns the forward vector down about the left axis.
      r.pivot.quaternion.copy(r.rest).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-rad(r.down*d.arm)));
      if(d.arm>.99&&['arm','digging'].includes(d.phase))r.angle=(r.angle+dt*rad(120))%(Math.PI*2);
      r.spin.quaternion.copy(r.spinRest).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-r.angle));
    }
  }
  snapshot(){return Object.fromEntries(Object.entries(this.rigs).map(([id,r])=>[id,{position:r.rig.position.toArray().map(Math.round),yaw:+r.rig.rotation.y.toFixed(3),visible:r.rig.visible}]));}
}
