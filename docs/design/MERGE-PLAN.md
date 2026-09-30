# The merge plan (the AI report)

The merge plan is Holt Pro's AI part and replaces the old AI report: for one
repository, what to do to get a first pull request merged there, with every
claim tied to a count and the pull requests behind it. The rules still pick the
verdict; the AI writes the call and the steps and reads the threads.

The web app renders it at `/example-ai-report` from a recorded example
(processing/p5.js). holt-pro's `POST /v1/merge-plan` will write real ones; the
public server proxies it and drops the fields the web app doesn't use
(`fact_id`, `version`, `cached`, `archived`, `usage`). Its contract goes into
`API.md` with that endpoint.

## The shape

`web/src/lib/merge-plan.ts` is the one source of the `MergePlan` type; this is
a readable copy. Change the type there first, then here, and tell holt-pro.
The AI model is never named anywhere in it.

```ts
type PlanSource = {           // the playbook's source: a counted fact
  statement: string;          // "23 of 26 merged ... kept the sections of the template"
  seen: number | null;
  of: number | null;
  links: string[];            // GitHub pull request URLs
};

type MergePlan = {
  repo: string;               // "processing/p5.js"
  recorded_on: string;        // ISO time the evidence was read
  generated_at: string;       // ISO time the plan was written
  window: { days: number; since: string }; // since: oldest pull request counted (a date)
  sample: { merged: number; closed: number; merged_outside: number; closed_outside: number };
  note: string | null;        // why the counts cover everyone, when outside PRs were too few
  verdict: {                  // copied from the free report; never chosen by the AI
    verdict: Verdict; headline: string; tone: Tone; line: string;
    numbers: { value: string; label: string }[]; // three figures: "35 of 77" / "outside PRs merged"
  };
  call: { text: string; sources: PlanSource[] };  // one sentence: what to do here
  steps: {                    // the first pull request, in order (about six)
    title: string;            // may contain Markdown code spans
    detail: string | null;
    link: { label: string; url: string } | null;  // an issue, the guide, the template
    copy: { label: string; text: string } | null; // a comment to post
    sources: PlanSource[];
  }[];
  merged: {                   // what merged pull requests share (three figures)
    value: string; unit: string; label: string;   // "23" "of 26" "kept the template's sections"
    seen: number | null; of: number | null; sources: PlanSource[];
  }[];
  closed: {                   // why outside pull requests were closed, in maintainers' words
    reason: string; seen: number; of: number;
    quote: { text: string; who: string; url: string; number: number } | null;
    examples: { number: number; url: string }[];
  }[];
  reviewers: {
    people: { login: string; reviewed: number; of: number; areas: string[] }[];
    sources: PlanSource[];
  };
  ai: null | {                // what reading the threads found
    read_on: string;
    threads: number;
    signals: {                // one per engine field: outsider_posture, onboarding, repo_kind
      kind: string; value: string; headline: string; text: string;
      tone: Tone | "neutral"; url: string | null;
    }[];
    outcomes: { value: string; count: number }[];  // engine outcome values, most common first
    quotes: { text: string; url: string; number: number; outcome: string }[];
  };
};
```

## The example

`web/src/lib/example-merge-plan.json`, recorded 30 Sep 2026. Real: every
count, quote and link (holt-pro's playbook facts from the repo's last 50 merged
and 25 closed pull requests, the free report from the public API, maintainers'
comments on those pull requests). Stand-ins for the AI: the call, the step
wording, the grouping of closing reasons and the three signals.
`web/src/lib/merge-plan.test.ts` checks that it names no model, links only to
the repo, and that its counts add up.

One correction was made by hand: holt-pro read @davepagurek, a p5.js
maintainer whom GitHub shows as a contributor, as an outside contributor, so
his pull requests were left out of the counts.
