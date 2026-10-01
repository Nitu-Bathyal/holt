// Fetches an image from an address a README named, for the image proxy
// (app/api/readme-image). The address is untrusted, so: https on the standard
// port only, no credentials, only public internet addresses (checked again when
// the connection is made, so a name that changes its answer can't slip through),
// a few redirects each checked the same way, a time limit, a size limit, and
// only image types back. Server only.
import dns from "node:dns";
import https from "node:https";
import net from "node:net";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 6000;

/** What may be sent on, by the type the host claims. SVG is allowed: it is only ever drawn in an <img>, and is sent sandboxed. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/svg+xml", "image/x-icon", "image/vnd.microsoft.icon"];

const blocked = new net.BlockList();
for (const [addr, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) blocked.addSubnet(addr, bits, "ipv4");
for (const [addr, bits] of [["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) blocked.addSubnet(addr, bits, "ipv6");

/** Whether an address is on the public internet. An IPv4 address written inside an IPv6 one is judged as the IPv4 one. */
export function isPublicIp(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return isPublicIp(mapped[1]);
  const family = net.isIP(ip);
  if (!family) return false;
  return !blocked.check(ip, family === 4 ? "ipv4" : "ipv6");
}

type LookupCb = (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;

/** DNS lookup that refuses any answer that isn't public. Used at connect time. */
function publicLookup(hostname: string, options: dns.LookupOptions, cb: LookupCb): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = addrs.filter((a) => isPublicIp(a.address));
    if (!ok.length || ok.length !== addrs.length) return cb(Object.assign(new Error("not a public address"), { code: "EBLOCKED" }));
    if (options.all) return cb(null, ok);
    cb(null, ok[0].address, ok[0].family);
  });
}

export type Fetched = { ok: true; type: string; body: Buffer } | { ok: false; reason: string };

/** Whether this address may be asked for at all, before any connection. */
export function allowedUrl(u: URL): boolean {
  if (u.protocol !== "https:" || u.username || u.password) return false;
  if (u.port && u.port !== "443") return false;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return isPublicIp(host);
  return host.includes(".") && !/\.(local|internal|localhost|lan)$/i.test(host);
}

export function fetchImage(url: URL, hops = 0): Promise<Fetched> {
  return new Promise((resolve) => {
    if (!allowedUrl(url)) return resolve({ ok: false, reason: "address not allowed" });
    const req = https.request(url, { method: "GET", lookup: publicLookup as never, timeout: TIMEOUT_MS, headers: { "user-agent": "Holt image proxy (githolt.com)", accept: "image/*" } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (hops >= MAX_REDIRECTS) return resolve({ ok: false, reason: "too many redirects" });
        try {
          return resolve(fetchImage(new URL(res.headers.location, url), hops + 1));
        } catch {
          return resolve({ ok: false, reason: "bad redirect" });
        }
      }
      const type = (res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (status !== 200 || !IMAGE_TYPES.includes(type)) {
        res.resume();
        return resolve({ ok: false, reason: status !== 200 ? `status ${status}` : "not an image" });
      }
      if (Number(res.headers["content-length"]) > MAX_IMAGE_BYTES) {
        res.resume();
        return resolve({ ok: false, reason: "too large" });
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_IMAGE_BYTES) {
          res.destroy();
          return resolve({ ok: false, reason: "too large" });
        }
        chunks.push(c);
      });
      res.on("end", () => resolve({ ok: true, type, body: Buffer.concat(chunks) }));
      res.on("error", () => resolve({ ok: false, reason: "read failed" }));
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, reason: "timed out" });
    });
    req.on("error", () => resolve({ ok: false, reason: "could not connect" }));
    req.end();
  });
}
