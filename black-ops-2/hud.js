// In-game HUD drawn with the game's own art from `export/web/ui/hud/`
// (see .tools/export_hud.py). The layout is rebuilt in the browser -- T6
// menudefs do not dump -- so placement here approximates the shipped HUD:
// square minimap top left, compass tape under it, ammo bottom right, and the
// low-health vignette over the screen. T6 draws health through screen effects
// alone, so there is deliberately no health bar.

const ART = 'ui/hud/';

// World-to-radar calibration. Each map authors two `minimap_corner`
// entities that bound the square its `compass_map_*` art covers. Entity Y
// is negated when imported as Three.js world Z. The art's orientation is the
// engine's, shared by every map: world X runs vertically and world Z
// horizontally, flipped per the constants below.
const RADAR_FLIP_U = 1;
const RADAR_FLIP_V = -1;

export function calibrationFromCorners(corners, minimapSpan) {
  const xs = corners.map((corner) => Number(corner[0]));
  const ys = corners.map((corner) => Number(corner[1]));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    centerX: (minX + maxX) / 2,
    centerZ: 0 - (minY + maxY) / 2 || 0,
    size: Math.max(maxX - minX, maxY - minY),
    flipU: RADAR_FLIP_U,
    flipV: RADAR_FLIP_V,
    minimapSpan,
  };
}

// Hijacked's corners are (-3904, -3600) and (3272, 3576), a 7176-unit
// square. Kept as the fallback when a map's hints carry no corners.
export const MAP_CAL = calibrationFromCorners([[-3904, -3600], [3272, 3576]], 1250);

export function worldToMinimapUv(x, z, cal = MAP_CAL) {
  return {
    u: 0.5 + ((z - cal.centerZ) * cal.flipU) / cal.size,
    v: 0.5 + ((x - cal.centerX) * cal.flipV) / cal.size,
  };
}

// `compass_mp_hud` is a 512x64 strip: one tick per 10 degrees and the
// cardinals a quarter turn apart, wrapping at the full texture width.
// Letter centres were measured from the art (N 9.5, E 136, S 265, W 392).
const TAPE = { width: 512, height: 64, period: 512, northCenter: 9.5 };

const VIEW = { minimap: 176, compassWidth: 264, compassHeight: 40 };
const FIRE_PING_SECONDS = 1.2;
export const MINIMAP_PING_SIZE = 80;

const RAD2DEG = 180 / Math.PI;

function div(className, parent) {
  const element = document.createElement('div');
  element.className = className;
  parent.appendChild(element);
  return element;
}

export class Hud {
  constructor({
    minimap, compass, ammoRow, weaponName, damage,
    radar = `${ART}compass_map_mp_hijacked.png`, calibration = MAP_CAL,
  }) {
    this.minimap = minimap;
    this.damage = damage;
    this.weaponName = weaponName;
    this.cal = calibration;

    this.rot = div('hud-minimap-rot', minimap);
    this.mapLayer = div('hud-minimap-map', this.rot);
    // A map without exported radar art still gets the spinning frame and pings.
    if (radar) this.mapLayer.style.backgroundImage = `url('${radar}')`;
    this.arrow = div('hud-minimap-arrow', minimap);
    this.arrow.style.backgroundImage = `url('${ART}compassping_player.png')`;

    // One tape copy per wrap period keeps a cardinal in view for any heading.
    // Each copy clips itself to one period so neighbours never overpaint it.
    const tapeScale = VIEW.compassHeight / TAPE.height;
    this.tapePeriod = TAPE.period * tapeScale;
    this.tape = [];
    for (let i = 0; i < 3; i += 1) {
      const copy = div('hud-compass-tape', compass);
      copy.style.backgroundImage = `url('${ART}compass_mp_hud.png')`;
      copy.style.width = `${this.tapePeriod}px`;
      copy.style.backgroundSize = `${TAPE.width * tapeScale}px ${VIEW.compassHeight}px`;
      this.tape.push(copy);
    }

    this.ammoRow = ammoRow;
    this.magDigits = [];
    this.reserveDigits = [];
    for (let i = 0; i < 3; i += 1) this.magDigits.push(this.buildDigit());
    const divider = div('hud-digit hud-digit-divider', ammoRow);
    divider.style.backgroundImage = `url('${ART}hud_mp_num_big_line.png')`;
    for (let i = 0; i < 3; i += 1) {
      this.reserveDigits.push(this.buildDigit('hud-digit-reserve'));
    }

    // Pooled firing pings; an enemy lights at most one at a time.
    this.pings = [];
    this.firedAt = new Map();

    this.lastMag = null;
    this.lastReserve = null;
  }

  /** Swap the radar calibration once the map's hints have loaded. */
  setCalibration(calibration) {
    this.cal = calibration;
  }

  buildDigit(extraClass) {
    return div(extraClass ? `hud-digit ${extraClass}` : 'hud-digit', this.ammoRow);
  }

  // Called when enemy index fires so its map ping lights for a moment.
  markEnemyFire(index) {
    this.firedAt.set(index, performance.now());
  }

  setDigit(element, value) {
    const image = value === null ? 'none' : `url('${ART}hud_mp_num_big_${value}.png')`;
    if (element.dataset.image !== image) {
      element.style.backgroundImage = image;
      element.dataset.image = image;
    }
  }

  // Renders a number right-to-left into a digit pool; leading slots hide.
  renderNumber(pool, value) {
    const text = value === null ? '' : String(Math.max(0, Math.trunc(value)));
    for (let i = 0; i < pool.length; i += 1) {
      const fromRight = pool.length - 1 - i;
      const digit = fromRight < text.length ? Number(text[text.length - 1 - fromRight]) : null;
      this.setDigit(pool[i], digit);
      pool[i].style.visibility = fromRight < text.length ? '' : 'hidden';
    }
  }

  update({
    x, z, yaw, enemies, weapon, health, hitFlash, dead,
  }) {
    const heading = ((-yaw * RAD2DEG) % 360 + 360) % 360;

    // Compass tape: N centers at heading 0 and the strip advances one period
    // per revolution, so turning right scrolls the letters left.
    const tapeScale = this.tapePeriod / TAPE.period;
    const periodPx = this.tapePeriod;
    const base = VIEW.compassWidth / 2
      - (TAPE.northCenter + (heading / 360) * TAPE.period) * tapeScale;
    const wrapped = ((base % periodPx) + periodPx) % periodPx - periodPx;
    for (let i = 0; i < this.tape.length; i += 1) {
      this.tape[i].style.transform = `translateX(${(wrapped + i * periodPx).toFixed(1)}px)`;
    }

    // Minimap: the art spins about the player, who stays centred under a
    // fixed up-pointing arrow. `spin` is the clockwise rotation that brings
    // the facing direction to screen-up given the art's axis mapping.
    const cal = this.cal;
    const mmScale = VIEW.minimap / cal.minimapSpan;
    const mmSize = cal.size * mmScale;
    // World facing is (-sin yaw, -cos yaw); art X runs along world Z and art
    // Y along world X, flipped per the calibration.
    const artU = -Math.cos(yaw) * cal.flipU;
    const artV = -Math.sin(yaw) * cal.flipV;
    const spin = -Math.atan2(artU, -artV);
    this.rot.style.transform = `rotate(${spin.toFixed(4)}rad)`;
    this.mapLayer.style.width = `${mmSize}px`;
    this.mapLayer.style.height = `${mmSize}px`;
    this.mapLayer.style.backgroundSize = `${mmSize}px ${mmSize}px`;
    const mapUv = worldToMinimapUv(x, z, cal);
    const px = mapUv.u * mmSize;
    const py = mapUv.v * mmSize;
    this.mapLayer.style.left = `${VIEW.minimap / 2 - px}px`;
    this.mapLayer.style.top = `${VIEW.minimap / 2 - py}px`;

    const now = performance.now();
    let pingIndex = 0;
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      const firedAt = this.firedAt.get(enemy.index);
      if (firedAt === undefined) continue;
      const age = (now - firedAt) / 1000;
      if (age > FIRE_PING_SECONDS) continue;
      let ping = this.pings[pingIndex];
      if (!ping) {
        ping = div('hud-minimap-ping', this.mapLayer);
        ping.style.setProperty('--ping-size', `${MINIMAP_PING_SIZE}px`);
        this.pings[pingIndex] = ping;
      }
      ping.style.display = '';
      ping.style.opacity = (1 - age / FIRE_PING_SECONDS).toFixed(3);
      ping.style.left = `${px + (enemy.z - z) * cal.flipU * mmScale - MINIMAP_PING_SIZE / 2}px`;
      ping.style.top = `${py + (enemy.x - x) * cal.flipV * mmScale - MINIMAP_PING_SIZE / 2}px`;
      pingIndex += 1;
    }
    for (; pingIndex < this.pings.length; pingIndex += 1) {
      this.pings[pingIndex].style.display = 'none';
    }

    if (weapon.magazine !== this.lastMag) {
      this.renderNumber(this.magDigits, weapon.magazine);
      this.lastMag = weapon.magazine;
    }
    if (weapon.reserveAmmo !== this.lastReserve) {
      this.renderNumber(this.reserveDigits, weapon.reserveAmmo);
      this.lastReserve = weapon.reserveAmmo;
    }
    this.weaponName.textContent = weapon.ready ? (weapon.name ?? 'M27') : '';

    // Damage: the hit flash rides the same vignette art the game fades in as
    // health drops, so a hard hit reads as a pulse of the low-health state.
    const lowHealth = health < 40 && !dead ? (1 - health / 40) * 0.9 : 0;
    const opacity = Math.max(hitFlash * 0.55, lowHealth);
    if (this.damage.dataset.opacity !== opacity.toFixed(3)) {
      this.damage.style.opacity = opacity.toFixed(3);
      this.damage.dataset.opacity = opacity.toFixed(3);
    }
  }
}
