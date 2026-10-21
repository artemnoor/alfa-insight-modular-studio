"""Compatibility import for the canonical AI Agent module."""
from __future__ import annotations

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sys

_CORE = Path(__file__).resolve().parents[1] / "modules" / "07-ai-agent" / "backend" / "agent_orchestrator.py"
_SPEC = spec_from_file_location(__name__, _CORE)
if _SPEC is None or _SPEC.loader is None:
    raise ImportError("AI Agent core is unavailable.")
_MODULE = module_from_spec(_SPEC)
sys.modules[__name__] = _MODULE
_SPEC.loader.exec_module(_MODULE)
