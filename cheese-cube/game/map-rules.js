// Shared by the collision bake and runtime: these objects can move or disappear.
export function dynamicTargets(entities) {
  const targets = new Set(entities.filter(e => ['zombie_door', 'zombie_debris'].includes(e.targetname) && e.target).map(e => e.target));
  for (const e of entities) if (/^(powcraft_|cheese_model_|cheese_place_brush|cheese_reward_cage_model|cheese_unlock_cage_trig|end_game_door|rising_brush|step_move|trivia|dalek_ee_brush|cheese_poster\d_brush)/.test(e.targetname)) targets.add(e.targetname);
  return targets;
}

// Water verified against Workshop 1168113418's zm_ccube.gsc (function at 0x1120):
// wait 90; rising_water MoveZ(3480, 2000); linked trigger checked every .05 seconds.
// Box (3.9 s cycle + 0.1 s, 12 s offer), Pack-a-Punch (0.35 + 3 s, 15 s offer) and the 2.7 s switch build come from
// _zm_magicbox / _zm_pack_a_punch / zm_ccube.gsc.
export const CHEESE_RULES = Object.freeze({escapeCost: 30000, riseDelay: 90, riseDistance: 3480, riseSeconds: 2000, waterCheckSeconds: .05, craftSeconds: 2.7, boxSeconds: 4, boxOfferSeconds: 12, offerSeconds: 15, papSeconds: 3.35});
