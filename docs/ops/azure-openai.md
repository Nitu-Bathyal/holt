# Azure OpenAI (Azure for Students credit)

Can Holt's AI run on the $100/year Azure for Students credit instead of
OpenRouter? Researched from Microsoft's own docs on 30 September 2026. No call
to Azure was made (there is no key yet); the code paths are covered by tests
with fake clients.

## Verdict

- **gpt-5-mini: yes, most likely.** It is GA on Azure OpenAI, needs no access
  request, supports structured outputs, and costs the same as OpenAI direct on
  a Global Standard deployment. What Microsoft does not document is the quota
  a student subscription gets; confirm it in the portal before relying on it
  (see "Before you rely on it").
- **gpt-5: deployable in principle, but don't count on it.** No registration
  is required any more, but the lowest quota tier (Tier 0) lists only
  gpt-5-mini, and student accounts are known to get little or no quota for
  larger models. Holt runs on gpt-5-mini anyway.
- **Holt works with it.** The server and holt-pro already speak the OpenAI wire
  format, and Azure's v1 endpoint accepts it with the Azure key as a normal
  API key. This PR makes the server pick OpenAI's parameter names for an Azure
  URL on its own, passes the model settings through the production compose
  file, and adds an `azure` provider to the CLI.

## What Microsoft's docs say

### Models, access and retirement

[Foundry Models sold by Azure][models]: `gpt-5` and `gpt-5-mini`, both version
`2025-08-07`, support reasoning, the Chat Completions API, the Responses API
and structured outputs. The context window is 400,000 tokens (272,000 in,
128,000 out). Neither is listed as a limited-access model. (The page still
lists `computer-use-preview`, `grok-4` and others as needing registration.)

[Retirement schedule][retire]: both `gpt-5 2025-08-07` and
`gpt-5-mini 2025-08-07` are GA and retire on **2027-02-09**. So the student
credit covers Hacktoberfest 2026 and a few months after. Plan the move to a
newer mini model (`gpt-5.4-mini`, retiring 2027-09-21) before February 2027.
That move needs a `PRICES` entry in `src/holt/model.py`, or the server treats
the model as unpriced and turns AI off.

### Regions

[Region availability][regions], Global Standard (the cheapest type, and the
one that pools capacity worldwide). gpt-5-mini 2025-08-07 is available in:

- Americas: brazilsouth, canadaeast, centralus, eastus, eastus2,
  northcentralus, southcentralus, westus, westus3 (not canadacentral)
- Europe: francecentral, germanywestcentral, italynorth, norwayeast,
  polandcentral, spaincentral, swedencentral, switzerlandnorth, uksouth,
  westeurope (not northeurope or switzerlandwest)
- Asia Pacific: australiaeast, japaneast, koreacentral, southeastasia,
  southindia
- Middle East and Africa: southafricanorth, uaenorth

gpt-5 is in the same Global Standard regions. **Pick `eastus2` or
`swedencentral`**: both carry every GPT-5 model and deployment type.
`southindia` is closest to the server, but latency doesn't matter much for a
job that takes 30 to 60 seconds, and quota and new models arrive first in the
big US and EU regions.

### Price vs OpenAI direct

From the [Azure retail prices API][prices] (the source behind the pricing
page), USD per million tokens, eastus2:

| Model | Deployment | Input | Cached input | Output |
|---|---|---|---|---|
| gpt-5-mini | Global Standard | 0.25 | 0.025 | 2.00 |
| gpt-5-mini | Data Zone | 0.275 | 0.0275 | 2.20 |
| gpt-5 | Global Standard | 1.25 | n/a | 10.00 |
| gpt-5 | Data Zone | 1.375 | n/a | 11.00 |

OpenAI direct is $0.25 / $2.00 for gpt-5-mini and $1.25 / $10.00 for gpt-5,
the rates already in `PRICES` (`src/holt/model.py`). **Global Standard costs
the same as OpenAI direct**; Data Zone is 10% more. OpenRouter passes the same
rates through, so the credit is the only saving, and it is the whole point:
$100 at about $0.005 per AI report is roughly 20,000 reports.

### Quota

[Quotas and limits][quotas]: Azure now puts every subscription on a quota tier
(Free/Tier 0, then Tiers 1 to 6), set from usage and the account's
relationship with Microsoft. The page does not say which tier a student
subscription starts on.

- Tier 0 lists four models, gpt-5-mini among them: Global Standard, 500 RPM,
  500,000 TPM. It lists no gpt-5.
- Tier 1: gpt-5-mini Global Standard 1,000 RPM, 1,000,000 TPM; gpt-5 10,000
  RPM, 1,000,000 TPM.
- Batch quota for "Azure for Students, free trials" is N/A for every model.
  Holt doesn't use batch.

An AI report makes about four calls of about 10,000 tokens each, so even Tier 0
is far more than Holt needs (500,000 TPM is about 12 reports a minute).
Microsoft Q&A threads from student accounts ([1][qa1], [2][qa2]) report
zero or limited quota for some models, fixed by the [quota request
form][quota-form] or by moving to Pay-As-You-Go. Those are forum answers, not
docs, and they date from before the tiers.

### The endpoint, from [the v1 API page][v1]

- **Base URL:** `https://<resource>.openai.azure.com/openai/v1/`. The page also
  accepts `https://<resource>.services.ai.azure.com/openai/v1/` (a Foundry
  resource). The `/openai/v1/` suffix is required.
- **api-version:** not needed with v1 (GA since August 2025). Holt uses the
  plain `OpenAI()` client, not `AzureOpenAI()`.
- **Model:** the **deployment name**, not the model id. Name the deployment
  exactly `gpt-5-mini`. Holt prices a run by that name (`gpt-5-mini` is an
  alias of `gpt-5-mini-2025-08-07` in `MODEL_ALIASES`). Any other name has no
  known price, and the server then refuses AI reports ("the model has no known
  price, so its cost can't be capped"). The response's own `model` field
  carries the dated id.
- **Auth:** the docs' Python example passes the Azure key as `api_key` to
  `OpenAI()`, which sends `Authorization: Bearer <key>`; their REST example
  sends `api-key: <key>`. Both work on v1, so no custom header is needed.
  Microsoft Entra ID tokens also work, but a key is simpler here.
- **Parameters:** OpenAI's own names. `max_completion_tokens` (reasoning
  models reject `max_tokens`) and `reasoning_effort`; OpenRouter's
  `reasoning: {effort}` is not understood. Structured output is the usual
  `response_format: {"type": "json_schema", "json_schema": {..., "strict":
  true}}` on Chat Completions.
- **Content filter:** Azure runs a content filter by default. A filtered answer
  ends with `finish_reason: "content_filter"` and no JSON. Holt then fails the
  run and refunds it, the same as any unusable answer. The prompts are about
  pull requests, so this should be rare; if it isn't, the filter can be
  loosened on the deployment.

## How each part of Holt uses it

| Part | Change needed | How |
|---|---|---|
| Server (AI reports) | None beyond this PR | `OPENROUTER_BASE_URL` set to the Azure URL. `llm.provider_for` now reads `*.openai.azure.com`, `*.services.ai.azure.com` and `*.cognitiveservices.azure.com` as the `openai` dialect. `HOLT_MODEL_PROVIDER=openai` does the same by hand. |
| Production compose | This PR | `deploy/prod/compose.yml` now passes `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL`, `HOLT_MODEL_PROVIDER` and `HOLT_MODEL_REASONING_EFFORT` from `secrets.env` to the server. Before, only the key reached it. The defaults are the server's own, so nothing changes until you set them. |
| holt-pro (playbooks, pre-flight summaries) | None | `HOLT_PRO_MODEL_PROVIDER=openai` sends `max_completion_tokens` and `Authorization: Bearer`, which v1 accepts. Its cost is priced from the tokens and the dated model id it reports. |
| CLI | This PR | `holt models --provider azure --model gpt-5-mini --base-url https://<resource>.openai.azure.com/openai/v1/` and `AZURE_OPENAI_API_KEY`. |

Each AI run's model id is now recorded in `ai_runs.model` (never shown to
users), so Azure and OpenRouter runs can be compared offline:

```sql
SELECT model, count(*), avg(cost_micros) / 1e6 AS avg_usd
FROM ai_runs WHERE settled_at IS NOT NULL GROUP BY model;
```

Reports' model is the configured name (`openai/gpt-5-mini` on OpenRouter,
`gpt-5-mini` on Azure). holt-pro runs record what the provider answered with
(`gpt-5-mini-2025-08-07`).

## Setting it up

1. Activate Azure for Students (azure.microsoft.com/free/students; no card).
2. In the portal, create an **Azure OpenAI** resource (or a Foundry resource)
   in **eastus2** (or swedencentral). Standard S0 pricing tier.
3. In the Foundry portal, deploy **gpt-5-mini**, version 2025-08-07,
   deployment type **Global Standard**, deployment name **`gpt-5-mini`**. If it
   says there is no quota, request some with the [quota form][quota-form].
4. Copy the endpoint (`https://<resource>.openai.azure.com/`) and Key 1 from
   the resource's "Keys and Endpoint" page.
5. Set a cost alert on the subscription (Cost Management, Budgets) below
   $100, so the credit running out isn't a surprise. When the credit is used
   up, Azure for Students disables the subscription rather than billing you,
   and AI reports then fail and are refunded until the key changes.

### Before you rely on it

Run one AI report on staging with the Azure settings and check its row:
`SELECT model, cost_micros, estimated FROM ai_runs ORDER BY id DESC LIMIT 1;`
It should say `gpt-5-mini` with a cost of a few thousand micros.

## Settings for `~/.config/holt/secrets.env`

Once the deployment exists, for AI reports (the public server):

```sh
OPENROUTER_API_KEY=<Azure Key 1>
OPENROUTER_BASE_URL=https://<resource>.openai.azure.com/openai/v1/
OPENROUTER_MODEL=gpt-5-mini
HOLT_MODEL_PROVIDER=openai
```

`HOLT_MODEL_PROVIDER=openai` is optional after this PR (the URL says so), but
it makes the choice explicit. The variables keep their OpenRouter names; they
hold whichever OpenAI-compatible endpoint the server uses.

For holt-pro (playbooks and pre-flight summaries), in the same file:

```sh
HOLT_PRO_MODEL_KEY=<Azure Key 1>
HOLT_PRO_MODEL_PROVIDER=openai
HOLT_PRO_MODEL_URL=https://<resource>.openai.azure.com/openai/v1/chat/completions
HOLT_PRO_PLAYBOOK_MODEL=gpt-5-mini
```

Then `FORCE=1 deploy/prod/deploy.sh` for the server, and holt-pro's own
`docker compose -p holt-pro ... up -d` (see `holt-pro/deploy/compose.pro.yml`).
To go back to OpenRouter, delete these lines and set the OpenRouter key again.

[models]: https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure
[retire]: https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-retirement-schedule
[regions]: https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure-region-availability
[prices]: https://prices.azure.com/api/retail/prices?$filter=productName%20eq%20%27Azure%20OpenAI%20GPT5%27%20and%20armRegionName%20eq%20%27eastus2%27
[quotas]: https://learn.microsoft.com/en-us/azure/foundry/openai/quotas-limits
[quota-form]: https://aka.ms/oai/stuquotarequest
[v1]: https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle
[qa1]: https://learn.microsoft.com/en-us/answers/questions/2183197/azure-openai-with-azure-for-students
[qa2]: https://learn.microsoft.com/en-ie/answers/questions/2224916/azure-ai-foundry-quota-insufficient-issues-student
