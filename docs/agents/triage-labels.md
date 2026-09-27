# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the strings used in Holt's maintainer tracker, where each one is written as the `Status:` line of a ticket file (see `issue-tracker.md`).

| Label in mattpocock/skills | Label in our tracker | Meaning                                                          |
| -------------------------- | -------------------- | ---------------------------------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue                          |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information                         |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified; the orchestrator can hand it to a worker        |
| `ready-for-human`          | `ready-for-human`    | Needs the maintainer (money, auth, deploy, dashboards, decisions) |
| `wontfix`                  | `wontfix`            | Will not be actioned                                             |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding string from this table.

These are not GitHub labels. The public repo's labels (`good first issue`, `hacktoberfest`, and so on) are separate.
