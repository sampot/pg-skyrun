// pg.js — wait for host-injected window.PG (no self-load of sdk.js).

/**
 * Poll until `window.PG` / `globalThis.PG` appears or timeout.
 * Needed when the host mounts PG via a classic script that can race a
 * dynamically-inserted entry module (go memory canvas).
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<object|null>}
 */
export async function waitForPg(timeoutMs = 5000) {
  if (globalThis.PG) return globalThis.PG;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 0));
    if (globalThis.PG) return globalThis.PG;
  }
  return null;
}
