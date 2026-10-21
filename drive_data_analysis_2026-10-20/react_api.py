"""Compatibility entry point for the canonical Alfa Product API."""
from __future__ import annotations

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import runpy
import sys

_CORE = Path(__file__).resolve().parents[1] / "modules" / "09-alfa-product" / "backend" / "react_api.py"
if __name__ == "__main__":
    runpy.run_path(str(_CORE), run_name="__main__")
else:
    _SPEC = spec_from_file_location(__name__, _CORE)
    if _SPEC is None or _SPEC.loader is None:
        raise ImportError("Alfa Product API is unavailable.")
    _MODULE = module_from_spec(_SPEC)
    sys.modules[__name__] = _MODULE
    _SPEC.loader.exec_module(_MODULE)
