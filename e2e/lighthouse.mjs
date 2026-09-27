// Lighthouse (mobile) for the key pages, one run at a time, with the cached Chromium.
//   node lighthouse.mjs                         # staging: /, /pallets/flask, /find
//   node lighthouse.mjs --runs 3 --calibrate    # median of 3, CPU slowdown calibrated
//   BASE_URL=http://127.0.0.1:3000 node lighthouse.mjs / /find
//
// Lighthouse's default 4x CPU slowdown assumes a high-end desktop host
// (benchmarkIndex 1500-2000). On a slower or busy host that emulates a
// low-end phone instead. --calibrate reads the benchmarkIndex of each run
// and picks the multiplier from Lighthouse's docs (docs/throttling.md) for
// a mid-tier phone target: >=1500 -> 4x, 1000-1500 -> 2x, <1000 -> 1x.
// Each run waits until the 1-minute load is under LH_MAX_LOAD (default 4,
// up to 10 minutes). Reports go to lighthouse/<page>-<n>.json.
//
// Behind Cloudflare Access, set STAGING_CF_ACCESS_CLIENT_ID and
// STAGING_CF_ACCESS_CLIENT_SECRET: the token is traded for Access's cookie
// (access.mjs), and each run gets a Chrome of its own with that cookie set for
// the site's host only, which Lighthouse drives with --port. Lighthouse's own
// --extra-headers would send the token to every origin a page loads from.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { accessCookie, accessToken } from "./access.mjs";

const argv = process.argv.slice(2);
const flag = (f) => { const i = argv.indexOf(f); if (i < 0) return false; argv.splice(i, 1); return true; };
const opt = (f, d) => { const i = argv.indexOf(f); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const calibrate = flag("--calibrate");
const runs = Number(opt("--runs", 1));
const fixedCpu = opt("--cpu", null);
const base = (process.env.BASE_URL || `https://${process.env.STAGING_HOST || "staging.githolt.com"}`).replace(/\/$/, "");
const pages = argv.length ? argv : ["/", "/pallets/flask", "/find"];
const maxLoad = Number(process.env.LH_MAX_LOAD || 4);

function chrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), ".cache/ms-playwright");
  const dir = fs.readdirSync(cache).filter((d) => d.startsWith("chromium-")).sort().reverse()[0];
  return dir && path.join(cache, dir, "chrome-linux64/chrome");
}

function waitForQuiet() {
  for (let waited = 0; waited < 600; waited += 15) {
    if (os.loadavg()[0] < maxLoad) return;
    if (waited === 0) console.error(`waiting for load < ${maxLoad} (now ${os.loadavg()[0].toFixed(1)})`);
    spawnSync("sleep", ["15"]);
  }
  console.error(`host still busy (load ${os.loadavg()[0].toFixed(1)}); measuring anyway`);
}

// Chrome with Access's cookie, for Lighthouse to connect to. The flags are
// chrome-launcher's defaults (what Lighthouse launches with) plus ours.
const LAUNCHER_FLAGS = ["--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,CalculateNativeWinOcclusion,InterestFeedContentSuggestions,CertificateTransparencyComponentUpdater,AutofillServerCommunication,PrivacySandboxSettings4",
  "--disable-extensions", "--disable-component-extensions-with-background-pages", "--disable-background-networking",
  "--disable-component-update", "--disable-client-side-phishing-detection", "--disable-sync", "--metrics-recording-only",
  "--disable-default-apps", "--mute-audio", "--no-default-browser-check", "--no-first-run",
  "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
  "--disable-ipc-flooding-protection", "--password-store=basic", "--use-mock-keychain",
  "--force-fieldtrials=*BackgroundTracing/default/", "--disable-hang-monitor", "--disable-prompt-on-repost",
  "--disable-domain-reliability", "--propagate-iph-for-testing"];

async function chromeWithCookie(cookie) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "holt-lh-"));
  const proc = spawn(chrome(), [...LAUNCHER_FLAGS, "--headless=new", "--no-sandbox", "--disable-gpu",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore", detached: true });
  const exited = new Promise((r) => proc.once("exit", r));
  const close = async () => {
    try { process.kill(-proc.pid); } catch { /* already gone */ }   // Chrome and its helpers
    await exited;
    // Helpers can still be flushing the profile for a moment after the main process exits.
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 100));
    const port = Number(fs.readFileSync(portFile, "utf-8").split("\n")[0]);
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
    // `url` and no domain: a host-only cookie, as the site itself would set it.
    const { name, value, secure, httpOnly, sameSite } = cookie;
    const url = `${secure ? "https" : "http"}://${cookie.domain}/`;
    ws.send(JSON.stringify({ id: 1, method: "Storage.setCookies", params: { cookies: [{ name, value, url, secure, httpOnly, sameSite }] } }));
    const reply = await new Promise((ok) => { ws.onmessage = (m) => ok(JSON.parse(m.data)); });
    ws.close();
    if (reply.error) throw new Error(`couldn't set the Access cookie in Chrome: ${reply.error.message}`);
    return { port, close };
  } catch (e) {
    await close();
    throw e;
  }
}

const token = accessToken();
const cookie = token ? await accessCookie(base, token) : null;

const multiplierFor = (bi) => (bi >= 1500 ? 4 : bi >= 1000 ? 2 : 1);

async function lighthouse(url, out, cpu) {
  waitForQuiet();
  const args = ["-y", "lighthouse@13", url, "--quiet", "--output=json", `--output-path=${out}`,
    "--only-categories=performance,accessibility,best-practices,seo",
    "--chrome-flags=--headless=new --no-sandbox --disable-gpu"];
  if (cpu) args.push(`--throttling.cpuSlowdownMultiplier=${cpu}`);
  const browser = cookie ? await chromeWithCookie(cookie) : null;
  if (browser) args.push(`--port=${browser.port}`);
  // The token stays out of Lighthouse's environment; it only needs the cookie already in Chrome.
  const env = { ...process.env, CHROME_PATH: chrome() };
  delete env.STAGING_CF_ACCESS_CLIENT_ID;
  delete env.STAGING_CF_ACCESS_CLIENT_SECRET;
  try {
    const r = spawnSync("npx", args, { stdio: ["ignore", "ignore", "inherit"], env });
    return r.status === 0 && fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf-8")) : null;
  } finally {
    await browser?.close();
  }
}

fs.mkdirSync("lighthouse", { recursive: true });
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
const rows = [];
for (const p of pages) {
  const slug = p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home";
  const results = [];
  for (let n = 1; n <= runs; n++) {
    let lhr = await lighthouse(base + p, path.join("lighthouse", `${slug}-${n}.json`), fixedCpu);
    if (lhr && calibrate) {
      const cpu = multiplierFor(lhr.environment.benchmarkIndex);
      if (cpu !== 4) lhr = await lighthouse(base + p, path.join("lighthouse", `${slug}-${n}-cal.json`), cpu);
    }
    if (lhr) results.push(lhr);
  }
  if (!results.length) { rows.push([p, "failed"]); continue; }
  // The run with the median performance score stands for the page.
  const perf = (l) => l.categories.performance.score;
  const lhr = results.find((l) => perf(l) === median(results.map(perf)));
  const c = lhr.categories, a = lhr.audits;
  rows.push([p, ...["performance", "accessibility", "best-practices", "seo"].map((k) => Math.round(c[k].score * 100)),
    a["first-contentful-paint"].displayValue, a["largest-contentful-paint"].displayValue,
    a["total-blocking-time"].displayValue, a["cumulative-layout-shift"].displayValue,
    `${lhr.configSettings.throttling.cpuSlowdownMultiplier}x`, Math.round(lhr.environment.benchmarkIndex),
    results.map((l) => Math.round(perf(l) * 100)).join("/")]);
}
console.log("\n| page | perf | a11y | best practices | SEO | FCP | LCP | TBT | CLS | CPU | benchmark | perf, all runs |\n|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.join(" | ")} |`);
