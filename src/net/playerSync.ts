import { loadHistory, mergeHistories, replaceHistory, type DriverProfile } from "../race/history";
import { loadSetting, saveSetting } from "../race/storage";

/** The relay's web address, from the ws:// or wss:// address the player typed. */
export function httpBase(wsUrl: string): string | null {
  const m = /^(wss?):\/\/([^/\s]+)/i.exec(wsUrl.trim());
  return m ? `${m[1]!.toLowerCase() === "wss" ? "https" : "http"}://${m[2]}` : null;
}

/**
 * Plain http:// and ws:// carry the device token and race history unencrypted, so they are only accepted for this
 * computer and private home or office networks (localhost, 10.x, 172.16-31.x, 192.168.x, *.local). Anything on the
 * public internet must use https:// or wss://.
 */
export function isSafeAddress(address: string): boolean {
  const m = /^(https?|wss?):\/\/(\[[^\]]+\]|[^/:\s]+)/i.exec(address.trim());
  if (!m) return false;
  const scheme = m[1]!.toLowerCase();
  if (scheme === "https" || scheme === "wss") return true;
  const host = m[2]!.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".local")) return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!ip) return false;
  const a = Number(ip[1]);
  const b = Number(ip[2]);
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

/** A secret kept only on this device. The first save for a driver ID claims it, so nobody else can overwrite that history. */
export function playerToken(): string {
  let t = loadSetting("token", "");
  if (t.length < 16) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    t = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    saveSetting("token", t);
  }
  return t;
}

export type SyncResult = "ok" | "offline" | "forbidden";

/** Download what the relay has for this driver, merge it with this device's history, and upload the result. */
/** `address` is either the data store's https:// address or a relay's ws:// address (the relay keeps players too). */
export async function syncPlayer(address: string, profile: DriverProfile): Promise<SyncResult> {
  const web = /^https?:\/\/[^/\s]+/i.exec(address.trim());
  const base = web ? web[0] : httpBase(address);
  if (!base || !isSafeAddress(address)) return "offline";
  const headers = { "x-player-token": playerToken(), "content-type": "application/json" };
  try {
    const got = await fetch(`${base}/player/${profile.id}`, { headers });
    if (got.status === 403) return "forbidden";
    const remote = got.ok ? ((await got.json()) as { records?: unknown[] }) : { records: [] };
    const merged = mergeHistories(loadHistory(), remote.records ?? []);
    replaceHistory(merged);
    const put = await fetch(`${base}/player/${profile.id}`, { method: "PUT", headers, body: JSON.stringify({ name: profile.name, records: merged.slice(0, 100) }) });
    return put.status === 403 ? "forbidden" : put.ok ? "ok" : "offline";
  } catch {
    return "offline";
  }
}
