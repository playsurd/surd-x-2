import * as THREE from 'three';
import { MysteryBox } from './mystery-box.js';

const cycleTime=3.9,offerTime=12,limited={knife_ballistic_zm:1,microwavegundw_zm:1};
// _zombiemode_weapons.gsc treasure_chest_* with the Moon box hacks (_zombiemode_hackables_box.gsc).
export class MoonMysteryBox extends MysteryBox {
  constructor(...args){super(...args);this.order=[];this.index=0;this.hacked=new Map();this.moving=null;}
  async load(){await super.load();this.chooseStart();}
  // Chest sounds play at the chest (play_sound_at_pos / playsoundatposition).
  boxEvent(b,path,volume=1){this.audio.event(path,volume,new THREE.Vector3(...b.entity.position));}
  // show_chest: zmb_box_poof_land and zmb_couch_slam on the lid, and default_pandora_show_func's zmb_box_poof.
  arrive(b){this.boxEvent(b,'box/land/land_00');this.boxEvent(b,'couch/slam/slam_00');this.boxEvent(b,'box/poof/poof_00');}
  // fire_sale_fix: a sale chest that hides again plays zmb_box_poof_land and zmb_couch_slam.
  leave(b){this.boxEvent(b,'box/land/land_00');this.boxEvent(b,'couch/slam/slam_00');}
  close(b){this.audio.unloop?.('rerespin-'+b.id);super.close(b);if(b.saleHide){b.saleHide=false;this.leave(b);}}
  shuffle(list){const a=list.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(this.session.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
  // level.random_pandora_box_start: the first randomized chest without start_exclude (the bridge chest).
  chooseStart(){this.order=this.shuffle(this.world.boxLocations);this.index=Math.max(0,this.order.findIndex(e=>e.start_exclude!=='1'));this.world.activeBox=this.order[this.index];}
  hackedRecently(e){return (this.hacked.get(e.id)??0)>=this.session.round;}
  saleLocation(e){return !this.hackedRecently(e);}
  available(e){
    const b=this.boxes.get(e.id);if(!b)return false;if(b.roll)return true;if(b.closing||b.cooldown>this.session.time)return false;
    return e.id===this.world.activeBox.id&&!this.moving||this.world.fireSale&&this.saleLocation(e);
  }
  // treasure_chest_ChooseWeightedRandomWeapon: a player's own weapons are skipped only when a player is passed
  // (the QED random weapon passes none); limited weapons count every holder and open chest.
  pool({player=true}={}){
    const s=this.session,owned=id=>s.inventory.some(w=>w.id===id)||s.equipment===id||s.pack?.weapon.id===id;
    const offered=new Set([...this.boxes.values()].map(b=>b.roll?.weapon).filter(Boolean));
    return (this.data.boxPool??[]).filter(id=>this.models[id]&&!(player&&owned(id))&&!(limited[id]&&(offered.has(id)||owned(id))));
  }
  teddy({sale,noFly}){
    if(sale||noFly)return false;
    const a=this.uses,random=Math.floor(this.session.random()*100);let chance=-1;
    if(a>=4){chance=a+20;if(!this.moves&&a>=8)chance=100;if(a<8)chance=random<15?100:-1;
      if(this.moves>0){if(a>=8&&a<13)chance=random<30?100:-1;if(a>=13)chance=random<50?100:-1;}}
    // check_for_free_locations: no other chest that was not recently summoned by a hack.
    if(!this.world.boxLocations.some(e=>e.id!==this.world.activeBox.id&&!this.hackedRecently(e)))chance=-1;
    return chance>random;
  }
  start(e,{free=false,noFly=false,cost=950}={}){
    const b=this.boxes.get(e.id);if(!b||b.roll||b.closing)return false;
    const pool=this.pool();
    if(!pool.length)return false;
    const saleOpen=this.session.effects.fire_sale>this.session.time&&this.saleLocation(e);
    b.roll={weapon:pool[Math.floor(this.session.random()*pool.length)],ready:false,time:this.session.time+cycleTime,expires:this.session.time+cycleTime+offerTime,started:this.session.time,
      sale:saleOpen,teddy:this.teddy({sale:saleOpen,noFly}),pool,cost:free?0:cost,noFly,free};
    b.opening=0;this.world.openBoxes.add(b.id);this.world.updateBox();this.boxEvent(b,'box/open/open_00');this.boxEvent(b,'box/music_box/music_box_00',.7);return true;
  }
  take(e){const b=this.boxes.get(e.id);if(!b?.roll?.ready||b.roll.teddy)return null;const weapon=b.roll.weapon;this.finish(b);return weapon;}
  // chest_accessed counts collected or expired offers, but not Fire Sale pulls.
  finish(b){if(!b.roll.sale&&!b.roll.teddy)this.uses++;const summoned=b.roll.summoned;this.close(b);b.cooldown=this.session.time+3;if(summoned)b.summonHide=this.session.time+.6;}
  // box_hacked_respin: a fresh weighted spin for the hacker, with the open and music box sounds; no teddy.
  respin(e){
    const b=this.boxes.get(e.id),r=b?.roll;if(!r?.ready||r.teddy)return false;
    Object.assign(r,{ready:false,respun:true,noFly:true,teddy:false,weapon:r.pool[Math.floor(this.session.random()*r.pool.length)],started:this.session.time,time:this.session.time+cycleTime,expires:this.session.time+cycleTime+offerTime});
    if(b.shown)this.show(b,null);this.boxEvent(b,'box/open/open_00');this.boxEvent(b,'box/music_box/music_box_00',.7);return true;
  }
  // box_hacked_rerespin: the weapon stops sinking at chest + 40 and floats like a power-up anyone may grab, blinking after
  // 15 s and timing out 26.5 s after the hack.
  rerespin(b){
    const r=b?.roll;if(!r?.ready||r.teddy||r.rerespun)return false;
    r.rerespun=this.session.time;r.expires=this.session.time+26.5;r.turn=0;r.duration=0;
    this.boxEvent(b,'powerup/spawn/spawn_00',.65);this.audio.loop?.('rerespin-'+b.id,'moon/evt/zombie_global/powerup/loop/loop_00_l',{position:new THREE.Vector3(...b.entity.position),distance:800});return true;
  }
  summon(e){
    const b=this.boxes.get(e.id);if(!b||b.roll||this.moving?.id===e.id)return false;
    this.hacked.set(e.id,this.session.round+2+Math.floor(this.session.random()*3));
    // show_chest: the pandora light, zmb_box_poof, the land and couch slam; then it opens free for the hacker.
    b.summoned=true;this.world.updateBox();this.arrive(b);const ok=this.start(e,{free:true,noFly:true});if(ok)b.roll.summoned=true;return ok;
  }
  // default_box_move_logic, skipping recently hacked chests (custom_box_move_logic).
  next(){
    const hacked=this.order.filter(e=>this.hackedRecently(e)).length;
    if(hacked){for(let i=1;i<this.order.length;i++){const next=(this.index+i)%this.order.length;if(!this.hackedRecently(this.order[next])){this.index=next;break;}}return;}
    this.index++;
    if(this.index>=this.order.length){const previous=this.order[this.index-1].id;this.order=this.shuffle(this.order);this.index=this.order[0].id===previous&&this.order.length>1?1:0;}
  }
  update(dt){
    const s=this.session,sale=s.effects.fire_sale>s.time;
    if(this.world.fireSale!==sale){
      for(const b of this.boxes.values())if(b.id!==this.world.activeBox.id&&this.saleLocation(b.entity)){if(sale)this.arrive(b);else if(b.roll)b.saleHide=true;else this.leave(b);}
      this.world.fireSale=sale;this.world.updateBox();this.audio.fireSale(sale);
    }
    // treasure_chest_move: the poof 5 s after the lift starts, Richtofen's box_move line, then show_chest at the new location.
    const m=this.moving;
    if(m&&m.poofAt&&s.time>=m.poofAt){m.poofAt=0;this.boxEvent(m.from,'box/poof/poof_00');this.audio.vox?.('general','box_move');}
    if(m&&s.time>=m.until){this.moving=null;this.next();this.world.activeBox=this.order[this.index];this.world.updateBox();this.toast('The Mystery Box has moved');const b=this.boxes.get(this.world.activeBox.id);if(b)this.arrive(b);}
    for(const b of this.boxes.values()){
      if(b.summonHide&&s.time>=b.summonHide){b.summonHide=0;b.summoned=false;this.world.updateBox();}
      const r=b.roll;
      if(r){
        const age=s.time-r.started;b.opening=Math.min(.5,b.opening+dt);
        if(s.time>=r.time&&!r.ready){r.ready=true;this.show(b,r.teddy?'teddy':r.weapon);
          this.toast(r.teddy?'The Mystery Box is moving…':(this.data.weapons[r.weapon]??this.data.equipment[r.weapon]).name+' — press F to take',4);
          // Teddy refunds the user's cost (add_to_player_score, not counted as earned).
          if(r.teddy)s.points+=r.cost;}
        if(!r.ready){const step=age<1?Math.floor(age/.05):age<2?20+Math.floor((age-1)/.1):age<3?30+Math.floor((age-2)/.2):35+Math.floor((age-3)/.3);this.show(b,r.pool[step%r.pool.length]);}
        if(b.wrapper){const since=s.time-r.time,sink=Math.min(1,Math.max(0,since/offerTime));
          if(r.rerespun){const age=s.time-r.rerespun,blink=age<15?1:age<22.5?Math.floor((age-15)/.5)%2:age<25?Math.floor((age-22.5)/.25)%2:Math.floor((age-25)/.1)%2;
            b.wrapper.visible=blink===0||age<15;r.turn+=dt;if(r.turn>=r.duration){r.from=b.wrapper.quaternion.clone();r.to=new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random()-.5)*2.1,Math.random()*Math.PI*2,(Math.random()-.5)*1.57));r.duration=2.5+Math.random()*2.5;r.turn=0;}
            if(r.from){const t=r.turn/r.duration;b.wrapper.quaternion.slerpQuaternions(r.from,r.to,t*t*(3-2*t));}}
          b.wrapper.position.y=r.teddy&&r.ready?40+(since>2.5?500*Math.min(1,(since-2.5)/4)**2:0):r.ready?(r.rerespun?40:40*(1-sink*sink*(3-2*sink))):Math.min(64,age/3*64);}
        // Teddy: 0.5 s + 2 s, then MoveZ(500, 4); the chest lifts 5 s and the new one appears 12 s later (7 s during a Fire Sale).
        // weapon_fly_away_start 0.5 s after the bear: play_crazi_sound for every player.
        if(r.teddy&&r.ready&&!r.laughed&&s.time>=r.time+.5){r.laughed=true;this.audio.laugh?.();}
        // weapon_fly_away_end: the lid closes, zmb_box_move on the lid and zmb_whoosh with the magic box line at the chest.
        if(r.teddy&&r.ready&&s.time>r.time+6.5){this.close(b);this.boxEvent(b,'box/disappear/disappear_00');this.boxEvent(b,'box/whoosh/whoosh_00');this.audio.boxVox?.(new THREE.Vector3(...b.entity.position));
          this.moves++;this.uses=0;this.moving={id:b.id,from:b,poofAt:s.time+5,until:s.time+5.1+(sale?7:12)};this.world.updateBox();}
        else if(!r.teddy&&s.time>r.expires)this.finish(b);
      }
      if(b.closing){b.closing=Math.max(0,b.closing-dt);b.opening=b.closing;if(!b.closing){this.world.openBoxes.delete(b.id);this.world.updateBox();}}
      const t=b.opening/.5,angle=t*t*(3-2*t)*105*Math.PI/180;
      b.lid.quaternion.copy(b.closed).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),angle));b.glow.material.opacity=t*.2;
    }
  }
  reset(){super.reset();this.hacked.clear();this.moving=null;for(const b of this.boxes.values()){b.cooldown=0;b.summoned=false;b.summonHide=0;}this.chooseStart();this.world.updateBox();}
  snapshot(){return super.snapshot().map(s=>({...s,summoned:!!this.boxes.get(s.id).summoned,rerespun:!!this.boxes.get(s.id).roll?.rerespun}));}
}
