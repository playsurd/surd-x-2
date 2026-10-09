// Skins: the weapon camo catalog and the operator (body) skin catalog, plus
// the random draw both use at match start. Data only, no DOM or Three.js, so
// the catalogs load in node tests and in the bake tools.
//
// Weapon camos are the game's own: T6 paints a camo by swapping the diffuse on
// every `_camoN` material of a gun, and that is what viewmodel.js and the bot
// weapons do with these tiles. Add a camo by dropping its tile in
// export/web/images/camo/ (`.tools/import_weapon_assets.py` writes them from
// the game's `t6_camo_<name>_pattern` images) and adding a row here.
export const WEAPON_CAMOS = Object.freeze([
  // The two the project shipped with keep their place at the front.
  Object.freeze({ id: 'openai', name: 'OpenAI', url: './images/openai-camo.webp', repeat: 3 }),
  Object.freeze({ id: 'claude', name: 'Claude', url: './images/claude-camo.webp', repeat: 3 }),
  // Black Ops II unlock camos, in the game's unlock order.
  Object.freeze({ id: 'erdl', name: 'ERDL', url: './images/camo/erdl.webp', repeat: 2 }),
  Object.freeze({ id: 'choco', name: 'Choco', url: './images/camo/choco.webp', repeat: 2 }),
  Object.freeze({ id: 'flora', name: 'Flora', url: './images/camo/flora.webp', repeat: 2 }),
  Object.freeze({ id: 'sahara', name: 'Sahara', url: './images/camo/sahara.webp', repeat: 2 }),
  Object.freeze({ id: 'siberia', name: 'Siberia', url: './images/camo/siberia.webp', repeat: 2 }),
  Object.freeze({ id: 'tiger_blue', name: 'Blue Tiger', url: './images/camo/tiger_blue.webp', repeat: 2 }),
  Object.freeze({ id: 'tiger_jungle', name: 'Jungle Tiger', url: './images/camo/tiger_jungle.webp', repeat: 2 }),
  Object.freeze({ id: 'urban_russia', name: 'Blue Urban', url: './images/camo/urban_russia.webp', repeat: 2 }),
  Object.freeze({ id: 'flecktarn', name: 'Flecktarn', url: './images/camo/flecktarn.webp', repeat: 2 }),
  Object.freeze({ id: 'atacs', name: 'A-TACS', url: './images/camo/atacs.webp', repeat: 2 }),
  Object.freeze({ id: 'devgru', name: 'DEVGRU', url: './images/camo/devgru.webp', repeat: 2 }),
  Object.freeze({ id: 'nevada', name: 'Nevada', url: './images/camo/nevada.webp', repeat: 2 }),
  Object.freeze({ id: 'kryptek_typhon', name: 'Kryptek Typhon', url: './images/camo/kryptek_typhon.webp', repeat: 2 }),
  Object.freeze({ id: 'ghostex_delta6', name: 'Ghostex: Delta 6', url: './images/camo/ghostex_delta6.webp', repeat: 2 }),
  Object.freeze({ id: 'bloodshot', name: 'Bloodshot', url: './images/camo/bloodshot.webp', repeat: 2 }),
  Object.freeze({ id: 'blossom', name: 'Cherry Blossom', url: './images/camo/blossom.webp', repeat: 2 }),
  Object.freeze({ id: 'skulls', name: 'Skulls', url: './images/camo/skulls.webp', repeat: 2 }),
  Object.freeze({ id: 'ronin', name: 'Ronin', url: './images/camo/ronin.webp', repeat: 2 }),
  Object.freeze({ id: 'artofwar', name: 'Art of War', url: './images/camo/artofwar.webp', repeat: 2 }),
  Object.freeze({ id: 'massacre', name: 'Massacre', url: './images/camo/massacre.webp', repeat: 2 }),
  Object.freeze({ id: 'elite', name: 'Elite', url: './images/camo/elite.webp', repeat: 2 }),
]);

export const WEAPON_CAMO_IDS = Object.freeze(WEAPON_CAMOS.map((camo) => camo.id));
export const DEFAULT_WEAPON_CAMO = WEAPON_CAMOS[0].id;

export function findCamo(id) {
  return WEAPON_CAMOS.find((camo) => camo.id === id) ?? null;
}

/** The camo one step from `current` in catalog order, wrapping at both ends. */
export function nextCamo(current, step = 1, ids = WEAPON_CAMO_IDS) {
  if (!ids.length) return null;
  const index = Math.max(0, ids.indexOf(current));
  return ids[((index + step) % ids.length + ids.length) % ids.length];
}

// Operator skins. Every bot is the exported PLA assault body; a skin is a
// colour treatment of its clothing textures, applied when the body atlas is
// built (see enemy-system.js). `hue` rotates the fabric colours in degrees,
// `saturation` and `lightness` scale them, and `tint` multiplies the result.
// The head, hands and visor are left alone so skin tones stay put. A second
// body mesh (SEALs, Mercs, ISA...) is a `bodyUrl` and texture set the same
// enemy loader already accepts; it belongs here once exported.
export const PLAYER_SKINS = Object.freeze([
  Object.freeze({ id: 'pla_assault', name: 'PLA Assault', hue: 0, saturation: 1, lightness: 1, tint: null }),
  Object.freeze({ id: 'pla_desert', name: 'PLA Desert', hue: 22, saturation: 0.8, lightness: 1.18, tint: [1.0, 0.94, 0.8] }),
  Object.freeze({ id: 'pla_arctic', name: 'PLA Arctic', hue: 0, saturation: 0.25, lightness: 1.45, tint: [0.92, 0.95, 1.0] }),
  Object.freeze({ id: 'pla_night', name: 'PLA Night Ops', hue: -20, saturation: 0.6, lightness: 0.62, tint: [0.75, 0.8, 0.95] }),
  Object.freeze({ id: 'pla_jungle', name: 'PLA Jungle', hue: 38, saturation: 1.25, lightness: 0.85, tint: [0.85, 1.0, 0.8] }),
  Object.freeze({ id: 'pla_urban', name: 'PLA Urban', hue: 0, saturation: 0.15, lightness: 0.9, tint: [0.9, 0.9, 0.92] }),
]);

export const PLAYER_SKIN_IDS = Object.freeze(PLAYER_SKINS.map((skin) => skin.id));
export const DEFAULT_PLAYER_SKIN = PLAYER_SKINS[0].id;

export function findSkin(id) {
  return PLAYER_SKINS.find((skin) => skin.id === id) ?? null;
}

// Textures a skin recolours: the PLA body's clothing and gear. Anything not
// matched (head, gloves, visor, eyes, the weapon) keeps its authored colour.
export const SKINNABLE_TEXTURE_PATTERN = /_(lower2|upper1_shirt|upper1_vest|gear|gear2|gear_assault|gear_smg_assault|armplatform)_c(\.|$)/i;

/** Draw one entry from a list with the given random source. */
export function randomPick(list, random = Math.random) {
  if (!list?.length) return null;
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

/**
 * Deal skins to a squad so they spread out: shuffles the catalog and hands
 * one to each, wrapping around when the squad outnumbers the catalog. A bot
 * keeps its skin for the whole match, through every respawn.
 */
export function dealSkins(count, random = Math.random, ids = PLAYER_SKIN_IDS) {
  const deck = [...ids];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return Array.from({ length: Math.max(0, count) }, (_, index) => deck[index % Math.max(1, deck.length)] ?? null);
}
