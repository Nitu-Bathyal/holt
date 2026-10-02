// A run is cut into named windows of time (a step of the ramp, or "before"
// and "during" a burst of checks). Every request is tagged with the window it
// started in, and the summary reports each window on its own. Requests made
// while the load is changing are tagged "ramp" and left out.
import exec from "k6/execution";

const num = (v, d) => (v === undefined || v === "" ? d : Number(v));

/** The ramp: hold each number of virtual users for `hold` seconds, `ramp` seconds to get there. */
export function ramp() {
  const steps = (__ENV.STEPS || "10,50,100,200").split(",").map((s) => parseInt(s, 10)).filter((n) => n > 0);
  const hold = num(__ENV.STEP_SECONDS, 45);
  const rampS = num(__ENV.RAMP_SECONDS, 10);
  const stages = [];
  const windows = [];
  let t = 0;
  for (const vus of steps) {
    stages.push({ duration: `${rampS}s`, target: vus }, { duration: `${hold}s`, target: vus });
    windows.push({ name: `s${String(vus).padStart(3, "0")}`, vus, from: t + rampS, to: t + rampS + hold });
    t += rampS + hold;
  }
  stages.push({ duration: "5s", target: 0 });
  return { stages, windows, seconds: t + 5 };
}

/** The window this moment falls in, counted from the start of the scenario. */
export function windowNow(windows) {
  const t = (Date.now() - exec.scenario.startTime) / 1000;
  for (const w of windows) if (t >= w.from && t < w.to) return w.name;
  return "ramp";
}

/**
 * Thresholds that always pass. k6 only keeps a tagged sub-metric in its
 * summary when a threshold names it, so each window (and each page in it)
 * gets one here.
 */
export function keep(windows, pages) {
  const t = {};
  for (const w of windows) {
    const tag = `step:${w.name}`;
    t[`http_req_duration{${tag}}`] = ["max>=0"];
    t[`http_req_waiting{${tag}}`] = ["max>=0"];
    t[`http_req_failed{${tag}}`] = ["rate>=0"];
    t[`http_reqs{${tag}}`] = ["count>=0"];
    t[`page_bad{${tag}}`] = ["rate>=0"];
    for (const p of pages) {
      t[`http_req_duration{${tag},page:${p}}`] = ["max>=0"];
      t[`page_bad{${tag},page:${p}}`] = ["rate>=0"];
    }
  }
  return t;
}

/** Stop a run that is plainly breaking the site instead of pushing on. */
export const GIVE_UP = {
  http_req_failed: [{ threshold: "rate<0.5", abortOnFail: true, delayAbortEval: "20s" }],
};

export const TREND_STATS = ["min", "med", "p(95)", "p(99)", "max", "count"];
