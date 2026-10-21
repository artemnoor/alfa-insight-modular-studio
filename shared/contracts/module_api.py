"""Shared v1 shapes used by the module HTTP gateway and adapter authors."""
from typing import Any, Literal, TypedDict

DataMode = Literal["fixture", "local_data", "external_ai"]
ValidationStatus = Literal["PASS", "FAIL"]

class ModuleRunRequest(TypedDict, total=False):
    mode: DataMode
    scenarioId: str
    input: dict[str, Any]

class ModuleApiError(TypedDict):
    contractVersion: Literal["1.0"]
    error: dict[str, str]

class ModuleCheck(TypedDict):
    name: str
    passed: bool
    expected: dict[str, Any]
    actual: Any

class ModuleRunEnvelope(TypedDict):
    contractVersion: Literal["1.0"]
    module: str
    mode: DataMode
    status: Literal["ok", "validation_failed"]
    data: dict[str, Any]
    provenance: dict[str, Any]
    validation: dict[str, Any]
