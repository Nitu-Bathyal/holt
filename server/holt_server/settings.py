"""Configuration, all of it from the environment (or `server/.env`).

Names are the ones in `server/README.md`. Nothing here has a default that is
unsafe in production except `HOLT_INTERNAL_KEY` and `HOLT_SECRET_KEY`, which
are empty by default and make the server refuse the requests that need them.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # "dev" serves /docs and /openapi.json; anything else does not.
    env: str = Field("production", alias="HOLT_ENV")
    database_url: str = Field(
        "postgresql+asyncpg://holt:holt@127.0.0.1:20131/holt", alias="DATABASE_URL"
    )
    internal_key: str = Field("", alias="HOLT_INTERNAL_KEY")
    # Server secret for keyed hashes (usage counting).
    secret_key: str = Field("", alias="HOLT_SECRET_KEY")
    # Where the badge links to: `{web_url}/{owner}/{repo}`.
    web_url: str = Field("https://githolt.com", alias="HOLT_WEB_URL")

    github_tokens: str = Field("", alias="GITHUB_TOKENS")

    # The optional internal service for paid features. Empty URL = off.
    pro_url: str = Field("", alias="HOLT_PRO_URL")
    pro_key: str = Field("", alias="HOLT_PRO_KEY")

    openrouter_api_key: str = Field("", alias="OPENROUTER_API_KEY")
    openrouter_model: str = Field("openai/gpt-5-mini", alias="OPENROUTER_MODEL")
    openrouter_base_url: str = Field("https://openrouter.ai/api/v1", alias="OPENROUTER_BASE_URL")

    # Analyses and finds running at once for people (the user lane). Each is a
    # worker thread holding one crawl in memory; see deploy/prod/compose.yml.
    job_concurrency: int = Field(2, alias="HOLT_JOB_CONCURRENCY")
    # A job running longer than this is stopped and fails with a plain
    # "took too long" error (seconds; rules reports, AI reports, find).
    job_timeout_rules: float = Field(180, alias="HOLT_JOB_TIMEOUT_RULES")
    job_timeout_ai: float = Field(480, alias="HOLT_JOB_TIMEOUT_AI")
    job_timeout_find: float = Field(300, alias="HOLT_JOB_TIMEOUT_FIND")
    cache_hours: float = Field(24, alias="HOLT_CACHE_HOURS")
    # Free AI credits: given once to every signed-in user, then one more can
    # be claimed each time this many days have passed since the last claim.
    signup_ai_credits: int = Field(3, alias="HOLT_SIGNUP_AI_CREDITS")
    claim_every_days: float = Field(7, alias="HOLT_CLAIM_EVERY_DAYS")
    # Features, plans and credit packs (pricing.py). Empty: the packaged
    # holt_server/pricing.json, where every price is still TBD.
    pricing_file: str = Field("", alias="HOLT_PRICING_FILE")
    # Credit-pack checkout (payments.py). Off unless this is 1 AND the
    # Razorpay keys are set: with it off, no pack is offered and no order can
    # be created. Orders already paid for are still confirmed.
    payments_enabled: bool = Field(False, alias="HOLT_PAYMENTS_ENABLED")
    razorpay_key_id: str = Field("", alias="RAZORPAY_KEY_ID")
    razorpay_key_secret: str = Field("", alias="RAZORPAY_KEY_SECRET")
    # Set in the Razorpay dashboard with the webhook URL. Empty: webhooks refused.
    razorpay_webhook_secret: str = Field("", alias="RAZORPAY_WEBHOOK_SECRET")
    # Monthly plans (subscriptions.py): a switch of their own, separate from
    # credit packs. Off unless this is 1 AND the Razorpay keys are set: with it
    # off, no plan is offered and no subscription can be started. Subscriptions
    # that already exist still renew, lapse and can be cancelled.
    subscriptions_enabled: bool = Field(False, alias="HOLT_SUBSCRIPTIONS_ENABLED")
    # How long a paid plan outlives its billing period while Razorpay retries a
    # failed renewal. A halted subscription ends the plan straight away.
    subscription_grace_days: float = Field(7, alias="HOLT_SUBSCRIPTION_GRACE_DAYS")
    # User ids (comma-separated) that may read /v1/admin/*. Empty: nobody.
    admin_users: str = Field("", alias="HOLT_ADMIN_USERS")
    # New work (jobs, starter-issue lookups) per hour.
    anon_rate_per_hour: int = Field(10, alias="HOLT_ANON_RATE_PER_HOUR")
    user_rate_per_hour: int = Field(60, alias="HOLT_USER_RATE_PER_HOUR")
    # Reads that miss the cache (starter issues): a separate, generous bucket,
    # so viewing and reloading report pages never uses up the work bucket above.
    anon_read_rate_per_hour: int = Field(120, alias="HOLT_ANON_READ_RATE_PER_HOUR")
    user_read_rate_per_hour: int = Field(600, alias="HOLT_USER_READ_RATE_PER_HOUR")
    # How long starter issues for a repository are served from the cache.
    starter_cache_hours: float = Field(1, alias="HOLT_STARTER_CACHE_HOURS")
    # Rules checks queued by public badge requests: per client IP, and in total.
    # Separate from the buckets user requests draw from.
    badge_rate_per_ip: int = Field(20, alias="HOLT_BADGE_RATE_PER_IP")
    badge_rate_total: int = Field(60, alias="HOLT_BADGE_RATE_TOTAL")
    # The background lane: workers of their own for badge refreshes and warm
    # passes, on top of HOLT_JOB_CONCURRENCY. They take a person's queued job
    # first whenever one is waiting. 0 turns badge and warm work off.
    badge_concurrency: int = Field(1, alias="HOLT_BADGE_CONCURRENCY")
    # Warm cache (see warm.py). 0 hours = no in-process schedule.
    warm_interval_hours: float = Field(0, alias="HOLT_WARM_INTERVAL_HOURS")
    warm_seeds_file: str = Field("", alias="HOLT_WARM_SEEDS")
    # Reports younger than this are not re-run by a warm pass.
    warm_max_age_hours: float = Field(20, alias="HOLT_WARM_MAX_AGE_HOURS")
    # Stop a warm pass when any GitHub token has fewer GraphQL points left.
    warm_min_points: int = Field(1500, alias="HOLT_WARM_MIN_POINTS")
    # My Contributions: re-read connected users' pull requests this often, in
    # the background (contributions.py). 0 = no background refresh.
    contributions_refresh_hours: float = Field(24, alias="HOLT_CONTRIBUTIONS_REFRESH_HOURS")
    # How long a finished /v1/find result is served for the same search.
    find_cache_hours: float = Field(6, alias="HOLT_FIND_CACHE_HOURS")
    # Pull-request pages crawled per analysis (25 PRs a page).
    max_pages: int = Field(8, alias="HOLT_MAX_PAGES")

    @property
    def token_list(self) -> list[str]:
        return [t.strip() for t in self.github_tokens.split(",") if t.strip()]

    @property
    def admin_user_ids(self) -> frozenset[str]:
        return frozenset(u.strip() for u in self.admin_users.split(",") if u.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
