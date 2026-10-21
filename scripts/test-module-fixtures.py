"""Run one module's prepared contract scenarios without starting the app server."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from shared.backend.modules_api import dispatch


def main() -> int:
    if len(sys.argv) != 2:
        print("Pass exactly one module slug.", file=sys.stderr)
        return 2
    slug = sys.argv[1]
    status, result = dispatch("POST", f"/api/modules/{slug}/tests", {})
    if status != 200 or result.get("status") != "PASS":
        print(json.dumps(result, ensure_ascii=True, indent=2))
        return 1
    scenarios = result.get("scenarios", [])
    print(f"{slug}: PASS ({len(scenarios)} prepared scenarios)")
    for scenario in scenarios:
        print(f"  {scenario.get('id', 'unknown')}: {scenario.get('status', 'UNKNOWN')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
