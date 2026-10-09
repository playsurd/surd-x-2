// Where multiplayer rooms live. Hosted builds use the Cloudflare room relay (.tools/multiplayer-worker.js).
// Local servers use their own /mp/connect endpoint when they have one (`npm start`); static servers without a
// relay, such as `vibe play`, fall back to the hosted relay, which accepts localhost pages. `?relay=<origin>`
// overrides both on a local page (tests point it at `npm run mp:dev`, the Worker runtime).
export const HOSTED_RELAY = 'https://claude-of-duty-mp.alanquillo.workers.dev';
const LOCAL = ['localhost', '127.0.0.1', '[::1]'];

export async function relayOrigin() {
  if (!LOCAL.includes(location.hostname)) return HOSTED_RELAY;
  const override = new URLSearchParams(location.search).get('relay');
  if (override) return override;
  try {
    const response = await fetch('/mp/health', { cache: 'no-store' });
    if (response.ok && (await response.json()).service === 'claude-of-duty-mp') return location.origin;
  } catch {}
  return HOSTED_RELAY;
}
