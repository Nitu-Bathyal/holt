// The end-of-run summary: one row per window, printed and written as JSON
// ($SUMMARY_FILE) for report.py to join with the server's samples.
import { BASE, LOCAL } from "./target.js";

/** How a fresh check can end (lib/check.js tags each one). */
export const OUTCOMES = ["done", "error", "refused", "cached", "no_ticket"];

const ms = (v) => (v === undefined || v === null ? null : Math.round(v * 10) / 10);

function trend(metrics, name) {
  const v = metrics[name] && metrics[name].values;
  if (!v || !v.count) return null;
  return { count: v.count, p50: ms(v.med), p95: ms(v["p(95)"]), p99: ms(v["p(99)"]), max: ms(v.max) };
}

function rate(metrics, name) {
  const v = metrics[name] && metrics[name].values;
  return v ? Math.round(v.rate * 10000) / 10000 : null;
}

function count(metrics, name) {
  const v = metrics[name] && metrics[name].values;
  return v ? v.count : 0;
}

function row(metrics, w, pages) {
  const tag = `step:${w.name}`;
  const requests = count(metrics, `http_reqs{${tag}}`);
  const out = {
    name: w.name,
    vus: w.vus || null,
    from: w.from,
    to: w.to,
    requests,
    per_second: Math.round((requests / (w.to - w.from)) * 10) / 10,
    failed: rate(metrics, `http_req_failed{${tag}}`),
    bad: rate(metrics, `page_bad{${tag}}`),
    duration: trend(metrics, `http_req_duration{${tag}}`),
    first_byte: trend(metrics, `http_req_waiting{${tag}}`),
    pages: {},
  };
  for (const p of pages) {
    const d = trend(metrics, `http_req_duration{${tag},page:${p}}`);
    if (d) out.pages[p] = { ...d, bad: rate(metrics, `page_bad{${tag},page:${p}}`) };
  }
  return out;
}

const pad = (s, n) => String(s === null || s === undefined ? "-" : s).padStart(n);
const pct = (r) => (r === null ? "-" : `${(r * 100).toFixed(2)}%`);

function table(rows) {
  const head = `${"window".padEnd(8)}${pad("VUs", 5)}${pad("pages/s", 9)}${pad("p50 ms", 9)}${pad("p95 ms", 9)}${pad("p99 ms", 9)}${pad("max ms", 9)}${pad("failed", 9)}${pad("bad", 9)}`;
  const body = rows.map((r) => {
    const d = r.duration || {};
    return `${r.name.padEnd(8)}${pad(r.vus, 5)}${pad(r.per_second, 9)}${pad(d.p50, 9)}${pad(d.p95, 9)}${pad(d.p99, 9)}${pad(d.max, 9)}${pad(pct(r.failed), 9)}${pad(pct(r.bad), 9)}`;
  });
  return [head, ...body].join("\n");
}

/**
 * Build k6's handleSummary. `windows`: the reader windows (may be empty);
 * `pages`: the page names tagged in them; `withChecks`: fresh checks ran.
 */
export function summarise({ scenario, windows, pages, withChecks }) {
  return (data) => {
    const m = data.metrics;
    const setup = data.setup_data || {};
    const result = {
      scenario,
      target: BASE,
      path: LOCAL ? "local edge" : "public URL (Cloudflare tunnel and Access)",
      live: setup.target ? setup.target.live : null,
      started: setup.started || null,
      windows: windows.map((w) => row(m, w, pages)),
    };
    let text = `\n${scenario} against ${BASE} (${result.path})\n`;
    if (result.windows.length) text += `${table(result.windows)}\n`;
    if (withChecks) {
      result.checks = {
        outcomes: Object.fromEntries(OUTCOMES.map((o) => [o, count(m, `fresh_checks{outcome:${o}}`)])),
        total: trend(m, "check_total_ms"),
        start: trend(m, "check_start_ms"),
        most_ahead: m.check_queue_ahead && m.check_queue_ahead.values.count ? m.check_queue_ahead.values.max : null,
      };
      const c = result.checks;
      const t = c.total || {};
      text += `checks: ${OUTCOMES.map((o) => `${c.outcomes[o]} ${o}`).join(", ")}\n`;
      text += `start to report: p50 ${pad(t.p50, 0)} ms, max ${pad(t.max, 0)} ms; most checks ahead in the queue: ${pad(c.most_ahead, 0)}\n`;
    }
    const files = { stdout: text };
    if (__ENV.SUMMARY_FILE) files[__ENV.SUMMARY_FILE] = JSON.stringify(result, null, 2);
    return files;
  };
}
