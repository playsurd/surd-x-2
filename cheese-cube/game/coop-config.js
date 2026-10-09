// Where co-op rooms live. Hosted builds use the Cloudflare room relay (.tools/coop-worker.js). Local servers use
// their own /coop/connect endpoint when they have one (`npm start`); static servers without a relay, such as
// `vibe play`, fall back to the hosted relay, which accepts localhost pages.
export const HOSTED_RELAY = 'https://cheese-cube-coop.alanquillo.workers.dev';
const LOCAL = ['localhost', '127.0.0.1', '[::1]'];

export async function relayOrigin() {
  if (!LOCAL.includes(location.hostname)) return HOSTED_RELAY;
  const override = new URLSearchParams(location.search).get('relay');
  if (override) return override;
  try {
    const response = await fetch('/coop/health', {cache: 'no-store'});
    if (response.ok && (await response.json()).service === 'cheese-cube-coop') return location.origin;
  } catch {}
  return HOSTED_RELAY;
}
