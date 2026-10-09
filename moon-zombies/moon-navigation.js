import * as THREE from 'three';
import { init, importNavMesh, NavMeshQuery } from '@recast-navigation/core';

export class MoonNavigation {
  constructor(data) { this.data=data; this.regions={}; this.area='earth'; this.disabled=new Set(); this.cut=new Set(); }
  async load() {
    await init();
    const checked = async url => {const r=await fetch(url);if(!r.ok)throw new Error(url+': '+r.status);return r;};
    const [earth,moon,metadata]=await Promise.all(['moon/navigation-earth.bin','moon/navigation-moon.bin','moon/navigation.json'].map(checked));
    this.metadata=await metadata.json();
    for(const [name,response] of [['earth',earth],['moon',moon]]){
      const {navMesh}=importNavMesh(new Uint8Array(await response.arrayBuffer()));
      const query=new NavMeshQuery(navMesh,{maxNodes:8192}); query.defaultQueryHalfExtents={x:60,y:90,z:60};
      this.regions[name]={navMesh,query};
    }
  }
  get query(){return this.regions[this.area].query;}
  closest(p,extents){const r=this.query.findClosestPoint(p,extents?{halfExtents:extents}:undefined);return r.success?new THREE.Vector3(r.point.x,r.point.y,r.point.z):null;}
  path(a,b){const r=this.query.computePath(a,b);return r.success?r.path.map(p=>new THREE.Vector3(p.x,p.y,p.z)):[];}
  reachable(a,b){const path=this.path(a,b);return path.length>0&&path.at(-1).distanceTo(b)<24;}
  // A wide nearest-poly query can pick the lab ceiling above an elevated spawn
  // marker. Only use a floor with a complete route to the current player.
  closestReachable(position,goal,extent=250){
    const q=this.query,refs=q.queryPolygons(position,{x:extent,y:extent,z:extent}).polyRefs??[];
    const candidates=refs.map(ref=>q.closestPointOnPoly(ref,position)).filter(r=>r.success)
      .map(r=>new THREE.Vector3(r.closestPoint.x,r.closestPoint.y,r.closestPoint.z))
      .sort((a,b)=>a.distanceToSquared(position)-b.distanceToSquared(position));
    return candidates.find(p=>this.reachable(p,goal))??null;
  }
  // Stay on the connected polygon corridor instead of snapping each frame to
  // whichever floor/ledge happens to be nearest to the desired next position.
  move(start,end){
    const q=this.query,nearest=q.findNearestPoly(start,{halfExtents:{x:24,y:36,z:24}});
    if(!nearest.success||!nearest.nearestRef)return null;
    const moved=q.moveAlongSurface(nearest.nearestRef,nearest.nearestPoint,end);
    if(!moved.success||!moved.visited.length)return null;
    // Clamp to the visited polygon before sampling height: Detour can return
    // a boundary point a float epsilon outside it, where getPolyHeight fails.
    const floor=q.closestPointOnPoly(moved.visited.at(-1),moved.resultPosition);
    return floor.success?new THREE.Vector3(floor.closestPoint.x,floor.closestPoint.y,floor.closestPoint.z):null;
  }
  setDoors(parts){
    const {navMesh,query}=this.regions.moon;
    for(const ref of this.disabled)navMesh.setPolyFlags(ref,1);this.disabled.clear();
    for(const part of parts.values()){
      // Moving blockers (excavators, gates, hatch clips) set navBlock and block at their current offset;
      // purchased airlocks stay connected while they cycle (airlock_connect_paths).
      if(!(part.navBlock??part.amount<1))continue;
      const box=part.collider.geometry.boundingBox;
      if(!box)continue;
      const center=box.getCenter(new THREE.Vector3()),extent=box.getSize(new THREE.Vector3()).multiplyScalar(.5);extent.x+=2;extent.z+=2;
      if(part.navBlock!==undefined)center.add(part.delta);
      for(const ref of query.queryPolygons(center,extent).polyRefs??[])this.disabled.add(ref);
    }
    for(const ref of this.disabled)navMesh.setPolyFlags(ref,0);
  }
  // Excavator breaches disconnect zone adjacencies until the arm lifts (digger_arm_breach_logic).
  activeZones(session){
    if(session.area==='earth')return new Set(['nml_zone']);
    const zones=new Set(['bridge_zone']);let changed=true;
    while(changed){changed=false;for(const [a,b,flag]of this.data.zoneLinks)if((session.flags.has(flag)||flag==='digsite_group')&&!this.cut.has(a+'|'+b)&&!this.cut.has(b+'|'+a)&&(zones.has(a)||zones.has(b))){if(!zones.has(a)||!zones.has(b))changed=true;zones.add(a);zones.add(b);}}
    return zones;
  }
}
