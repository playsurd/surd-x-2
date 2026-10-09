// Agent controls use the same simulation and inputs as a normal match.
export function installVibe(bo3) {
  let input = {};
  const observe = () => ({...bo3.debug.snapshot(), water: {
    time: bo3.water.time.value, level: bo3.world.waterLevel, stopped: bo3.quest.waterStopped,
    alarmReady: bo3.sound.buffers.has('cheese_unlimited_alarm'),
    alarmPlays: bo3.sound.played.get('cheese_unlimited_alarm') ?? 0,
  }});
  const act = command => {
    input = {...input, ...command};
    if (command.look) bo3.camera.rotation.set(command.look[1] * Math.PI / 180, command.look[0] * Math.PI / 180, 0);
    if (command.lookAt) bo3.debug.lookAt(command.lookAt);
    return observe();
  };
  const step = (seconds = .5) => {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 120) throw new Error('Step must be 0..120 seconds');
    const keys = [...(input.keys ?? [])];
    const move = {forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD'}[input.move];
    if (move) keys.push(move);
    if (input.sprint) keys.push('ShiftLeft');
    if (input.jump) keys.push('Space');
    if (input.use) keys.push('KeyF');
    bo3.debug.step(seconds, {keys, fire: !!input.fire, aim: !!input.aim});
    return observe();
  };
  window.vibe = {
    ready: true, name: 'Cheese Cube', observe, describe: observe, act, step,
    async perf(ms = 3000) {
      await new Promise(resolve => setTimeout(resolve, ms));
      return {fps: bo3.debug.snapshot().fps};
    },
    async start() { input = {}; await bo3.debug.reset(); return observe(); },
    turn({seconds = .5, act: command} = {}) { if (command) act(command); return {state: step(seconds)}; },
    help: () => 'step <seconds> move=forward|back|left|right sprint jump use fire aim; look=yaw,pitch (degrees)',
  };
}
