// Original adsOverlayShader images from the native Kino weapon definitions.
const overlays={l96a1_zm:'l96a1',dragunov_zm:'dragunov',g11_lps_zm:'g11'};

export class WeaponScope {
  constructor(){
    this.element=document.createElement('div');this.element.id='weapon-scope';this.element.hidden=true;
    this.element.setAttribute('aria-hidden','true');
    this.image=document.createElement('img');this.image.alt='';this.element.append(this.image);
    document.body.append(this.element);this.active=false;this.weapon=null;
  }
  update(view,allowed){
    const name=view?.def&&!view.def.attachmentActive?overlays[view.def.id]:null;
    if(name&&name!==this.weapon){this.weapon=name;this.image.src=`textures/scope_overlay_${name}_1024.png`;}
    this.active=!!(allowed&&name&&view.ready&&view.aim>=.98&&['idle','fire'].includes(view.mode)&&this.image.complete&&this.image.naturalWidth);
    this.element.hidden=!this.active;
    document.body.classList.toggle('scope-active',this.active);
  }
}
