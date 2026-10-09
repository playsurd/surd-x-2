import * as THREE from 'three';
import {CollisionWorld} from './collision-world.js';

// Invisible collision planes span the tread noses; the original stair artwork
// and the collision of rails, walls and ceilings stay in place.
export function createStairCollision(ramps,world) {
  const vertices=[];
  for(const {from,to,width} of ramps){
    let lift=0;
    const a=new THREE.Vector3(...from),b=new THREE.Vector3(...to),direction=b.clone().sub(a);
    const run=Math.hypot(direction.x,direction.z),slope=direction.y/run;direction.y=0;direction.normalize();
    // Let the plane start below the bottom landing so the capsule never hits
    // the exposed edge of the first tread before reaching the ramp.
    a.addScaledVector(direction,-36);a.y-=36*slope;
    // Some flights end with a full-depth top tread at landing height. Stop at
    // that nose instead of projecting one extra step above the landing.
    if(world){
      const ray=new THREE.Ray(b.clone().addScaledVector(direction,8).add(new THREE.Vector3(0,16,0)),new THREE.Vector3(0,-1,0));
      const hit=world.rayIntersect(ray,0,34);
      if(hit&&hit.position.y<b.y&&hit.position.y>b.y-12){const drop=b.y-hit.position.y;b.addScaledVector(direction,-drop/slope);b.y=hit.position.y;}
      // Grate lips and fastening plates protrude above some tread noses.
      // Cover those small details too, without touching the visible mesh.
      const bottom=new THREE.Vector3(...from),span=b.clone().sub(bottom),steps=Math.ceil(Math.hypot(span.x,span.z)/4);
      for(let i=0;i<=steps;i++){
        const p=bottom.clone().addScaledVector(span,i/steps);
        const hit=world.rayIntersect(new THREE.Ray(p.clone().add(new THREE.Vector3(0,18,0)),new THREE.Vector3(0,-1,0)),0,30);
        if(hit)lift=Math.max(lift,hit.position.y-p.y);
      }
      lift=Math.min(lift,8);a.y+=lift;b.y+=lift;
    }
    const across=new THREE.Vector3(-(b.z-a.z),0,b.x-a.x).normalize().multiplyScalar(width/2-.5);
    const points=[a.clone().add(across),a.clone().sub(across),b.clone().add(across),b.clone().sub(across)];
    for(const i of [0,2,1,1,2,3])vertices.push(points[i].x,points[i].y+.2,points[i].z);
    if(lift>0){
      const landing=b.clone().addScaledVector(direction,24);landing.y-=lift;
      const bevel=[b.clone().add(across),b.clone().sub(across),landing.clone().add(across),landing.clone().sub(across)];
      for(const i of [0,2,1,1,2,3])vertices.push(bevel[i].x,bevel[i].y+.2,bevel[i].z);
    }
  }
  const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  return new CollisionWorld(geometry);
}
