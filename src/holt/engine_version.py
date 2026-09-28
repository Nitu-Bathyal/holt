"""The engine's version, for caches of its reports.

Bump ENGINE_VERSION (by one) in the same PR as any change that alters what a
report says for the same evidence: the verdict rules (`agent/verdict.py`), the
signals and thresholds they read, or the report's shape (fields added,
removed or reworded in `report.py`). Refactors that leave every report the
same don't bump it.

The server stamps it on every report it stores and treats a report from an
older version as out of date: pages run a fresh check instead of serving it,
and `python -m holt_server.warm --stale-only` re-runs them after a deploy.
"""

ENGINE_VERSION = 2
