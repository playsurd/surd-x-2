export class WeaponController {
  constructor({
    magazineSize = 30,
    reserveAmmo = 120,
    roundsPerMinute = 750,
    initialRoundsPerMinute = null,
    initialShotCount = 0,
    // 'auto' fires while the trigger is held, 'single' once per pull, and
    // 'burst' `burstCount` rounds per pull at the weapon's cadence.
    fireMode = 'auto',
    burstCount = 3,
    onFire = null,
    onEmpty = null,
  } = {}) {
    if (!(magazineSize > 0)) throw new Error('magazineSize must be positive');
    if (!(roundsPerMinute > 0)) throw new Error('roundsPerMinute must be positive');
    if (initialShotCount > 0 && !(initialRoundsPerMinute > 0)) {
      throw new Error('initialRoundsPerMinute must be positive when initialShotCount is set');
    }

    this.magazineSize = Math.floor(magazineSize);
    this.magazine = this.magazineSize;
    this.startingReserveAmmo = Math.max(0, Math.floor(reserveAmmo));
    this.reserveAmmo = this.startingReserveAmmo;
    this.shotInterval = 60 / roundsPerMinute;
    this.initialShotInterval = initialShotCount > 0 ? 60 / initialRoundsPerMinute : null;
    this.initialShotCount = Math.max(0, Math.floor(initialShotCount));
    this.fireMode = ['auto', 'single', 'burst'].includes(fireMode) ? fireMode : 'auto';
    this.burstCount = Math.max(1, Math.floor(Number(burstCount) || 1));
    this.onFire = onFire;
    this.onEmpty = onEmpty;

    this.triggerHeld = false;
    this.reloading = false;
    this.cooldown = 0;
    this.fireCount = 0;
    this.emptyNotified = false;
    this.immediateShot = false;
    this.triggerShotCount = 0;
  }

  resetLoadout({ reserveAmmo = this.startingReserveAmmo } = {}) {
    this.magazine = this.magazineSize;
    this.reserveAmmo = Math.max(0, Math.floor(Number(reserveAmmo) || 0));
    this.triggerHeld = false;
    this.reloading = false;
    this.cooldown = 0;
    this.emptyNotified = false;
    this.immediateShot = false;
    this.triggerShotCount = 0;
    return { magazine: this.magazine, reserveAmmo: this.reserveAmmo };
  }

  get canReload() {
    return !this.reloading && this.magazine < this.magazineSize && this.reserveAmmo > 0;
  }

  /** Rounds one trigger pull may still fire: unbounded for automatics. */
  get shotsLeftInPull() {
    if (this.fireMode === 'single') return Math.max(0, 1 - this.triggerShotCount);
    if (this.fireMode === 'burst') return Math.max(0, this.burstCount - this.triggerShotCount);
    return Infinity;
  }

  setTrigger(held) {
    const next = Boolean(held);
    if (next && !this.triggerHeld) {
      this.immediateShot = true;
      this.triggerShotCount = 0;
    }
    if (!next) this.emptyNotified = false;
    this.triggerHeld = next;
  }

  startReload() {
    if (!this.canReload) return false;
    this.reloading = true;
    this.cooldown = 0;
    this.immediateShot = false;
    this.triggerShotCount = 0;
    return true;
  }

  finishReload() {
    if (!this.reloading) return 0;
    const loaded = Math.min(this.magazineSize - this.magazine, this.reserveAmmo);
    this.magazine += loaded;
    this.reserveAmmo -= loaded;
    this.reloading = false;
    this.emptyNotified = false;
    return loaded;
  }

  cancelReload() {
    this.reloading = false;
  }

  update(deltaSeconds, { canFire = true } = {}) {
    const dt = Math.max(0, Math.min(Number(deltaSeconds) || 0, 0.25));
    const shortestInterval = Math.min(this.shotInterval, this.initialShotInterval ?? this.shotInterval);
    this.cooldown = Math.max(-shortestInterval * 4, this.cooldown - dt);

    if (!this.triggerHeld || !canFire || this.reloading) return 0;
    if (this.immediateShot) {
      // An automatic answers a fresh pull at once. Semi-automatics and bursts
      // keep their cadence: a pull inside the cooldown waits it out, so the
      // trigger cannot be tapped faster than the weapon file's fireTime.
      if (this.fireMode === 'auto') this.cooldown = 0;
      this.immediateShot = false;
    }

    let shots = 0;
    while (this.cooldown <= 0 && shots < 4) {
      // A semi-automatic or burst weapon has spent its pull; the trigger has
      // to be released and pulled again for more.
      if (this.shotsLeftInPull <= 0) break;
      if (this.magazine <= 0) {
        if (!this.emptyNotified) {
          this.emptyNotified = true;
          this.onEmpty?.();
        }
        break;
      }

      this.magazine -= 1;
      this.fireCount += 1;
      shots += 1;
      this.triggerShotCount += 1;
      const interval = this.initialShotInterval && this.triggerShotCount < this.initialShotCount
        ? this.initialShotInterval
        : this.shotInterval;
      // An automatic banks a little negative cooldown so a long frame can catch
      // up its cadence; a semi-automatic or burst counts from the shot itself,
      // so a quick second pull cannot beat the weapon file's fireTime.
      this.cooldown = this.fireMode === 'auto' ? this.cooldown + interval : Math.max(this.cooldown, 0) + interval;
      this.onFire?.({
        fireCount: this.fireCount,
        triggerShotCount: this.triggerShotCount,
        magazine: this.magazine,
        reserveAmmo: this.reserveAmmo,
      });
    }
    return shots;
  }
}
