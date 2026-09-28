// Friendly progress copy. Server stage strings are plain English already;
// these add a line of context for someone waiting on a phone.
const FRIENDLY: [RegExp, string, string][] = [
  [/queue/i, "Getting in line", "Someone else's report is running. Yours is next."],
  [/fetch|pull request/i, "Fetching pull requests", "The last few months of PRs from people outside the team."],
  [/thread|read/i, "Reading threads", "Who replied, how fast, and what happened to each PR."],
  [/check|verif|evidence/i, "Checking evidence", "Every claim has to link to a real GitHub page, or it's dropped."],
  [/writ|report|verdict/i, "Writing the report", "The same written rules as every other repo."],
];

export function friendlyStage(stage: string | undefined): { title: string; detail: string } {
  if (!stage) return { title: "Starting", detail: "Warming up." };
  // "In the queue: 3 checks ahead of yours" -> the place in line as the detail.
  const place = /^In the queue: (.+)$/.exec(stage);
  if (place) return { title: "Getting in line", detail: place[1].charAt(0).toUpperCase() + place[1].slice(1) + "." };
  for (const [re, title, detail] of FRIENDLY) if (re.test(stage)) return { title, detail };
  return { title: stage, detail: "" };
}

export const STAGE_ORDER = ["Fetching pull requests", "Reading threads", "Checking evidence", "Writing the report"];
