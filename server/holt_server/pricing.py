"""What Holt sells and what each plan unlocks: config, not code.

The catalogue is a JSON file: `HOLT_PRICING_FILE`, or `pricing.json` next to
this module. It names the paid features and what each costs in credits, the
plans (free and pro: what each unlocks) and the passes that sell Pro. A pass
is one payment for a fixed number of days of Pro; it never renews, and a
second pass adds its days to the first. Prices are in minor units (paise,
cents). Nothing here takes money: the payment code (payments.py) reads
`on_sale` and the prices, and extends the user's plan once a payment is
confirmed.

A feature a plan doesn't cover can still be used by spending its `credits`
(null: plan only). `free_credits` says whether the free weekly credits may
pay for it, or only purchased ones (which only an admin grant gives now).

    python -m holt_server.pricing     # check the file this process would load
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, model_validator

DEFAULT_FILE = Path(__file__).with_name("pricing.json")
FREE = "free"
# The plan every pass gives.
PRO = "pro"


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Price(Strict):
    # Minor units: paise and cents. None: not decided yet.
    inr_paise: int | None = Field(None, ge=0)
    usd_cents: int | None = Field(None, ge=0)


class Feature(Strict):
    name: str
    # Credits one use costs when no plan covers it; None: plan only.
    credits: int | None = Field(None, ge=1)
    # Whether free (welcome and weekly) credits may pay for it.
    free_credits: bool = False


class PlanFeature(Strict):
    # Uses per calendar month (UTC), or unlimited.
    per_month: int | None = Field(None, ge=1)
    unlimited: bool = False

    @model_validator(mode="after")
    def _one(self) -> PlanFeature:
        if (self.per_month is None) == (not self.unlimited):
            raise ValueError("give exactly one of per_month or unlimited: true")
        return self


class Plan(Strict):
    name: str
    features: dict[str, PlanFeature] = {}


class Pass(Strict):
    name: str
    # Days of Pro one payment gives.
    days: int = Field(ge=1)
    on_sale: bool = False
    price: Price = Price()


class Catalogue(Strict):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)

    about: str = Field("", alias="_about")
    tbd: bool = True
    features: dict[str, Feature]
    plans: dict[str, Plan]
    passes: dict[str, Pass] = {}

    @model_validator(mode="after")
    def _consistent(self) -> Catalogue:
        if FREE not in self.plans:
            raise ValueError(f"there must be a {FREE!r} plan")
        if self.passes and PRO not in self.plans:
            raise ValueError(f"passes sell the {PRO!r} plan, and there isn't one")
        for name, plan in self.plans.items():
            unknown = set(plan.features) - set(self.features)
            if unknown:
                raise ValueError(f"plan {name!r} unlocks unknown features {sorted(unknown)}")
        return self

    def sold(self, feature: str) -> bool:
        """Whether a pass on sale unlocks `feature`."""
        pro = self.plans.get(PRO)
        return (pro is not None and feature in pro.features
                and any(p.on_sale for p in self.passes.values()))


def load(path: str | Path | None = None) -> Catalogue:
    """Read and check a catalogue. Raises ValueError with what is wrong."""
    path = Path(path) if path else DEFAULT_FILE
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"can't read the pricing file {path}: {exc}") from None
    return Catalogue.model_validate(raw)


@lru_cache
def cached(path: str) -> Catalogue:
    return load(path or None)


def main() -> int:
    from holt_server.settings import get_settings

    path = get_settings().pricing_file
    try:
        cat = load(path or None)
    except ValueError as exc:
        print(exc)
        return 1
    print(f"{path or DEFAULT_FILE}: {len(cat.features)} features, "
          f"plans {sorted(cat.plans)}, passes {sorted(cat.passes)}"
          + (" (prices TBD)" if cat.tbd else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
