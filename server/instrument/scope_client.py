from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from copy import deepcopy
from threading import RLock
from .validation import validate_parameter, validate_measurement

from .backends import MockScopeBackend, RsInstrumentBackend, ScopeBackend
from .confirmation import ConfirmationGate
from request_validation import valid_session_id

try:
    from RsInstrument import RsInstrument  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    RsInstrument = None


@dataclass
class OperationResult:
    ok: bool
    name: str
    category: str
    needsConfirmation: bool = False
    confirmationId: str | None = None
    summary: str | None = None
    result: Any = None
    error: str | None = None


class ScopeClient:
    def __init__(self, backend, gate=None):
        self._backend = backend
        self._gate = gate or ConfirmationGate()
        self._lock = RLock()

    def read_state(self, scope="all", keys=None):
        try:
            if scope not in ("all", "channel", "trigger", "acquisition"):
                raise ValueError("Unsupported state scope")
            with self._lock:
                return OperationResult(
                    True,
                    "read_state",
                    "READ",
                    result=deepcopy(self._backend.read_state(scope, keys)),
                )
        except Exception as error:
            return OperationResult(False, "read_state", "READ", error=str(error))

    def _operation(
        self, action, path, proposed, confirmed, confirmation_id, session_id
    ):
        category = "WRITE" if action == "set_parameter" else "MEASUREMENT"
        try:
            if type(confirmed) is not bool:
                raise ValueError("confirmed must be a boolean")
            if not valid_session_id(session_id):
                raise ValueError("A valid session ID is required")
            with self._lock:
                state = deepcopy(self._backend.read_state("all"))
                previous = (
                    _lookup_path(state, path) if action == "set_parameter" else state
                )
                if not confirmed:
                    pending = self._gate.preview(
                        action, path, previous, proposed, session_id
                    )
                    summary = (
                        pending.summary
                        if action == "set_parameter"
                        else f"Configure {path} measurement on {proposed['source']}"
                    )
                    return OperationResult(
                        True,
                        action,
                        category,
                        True,
                        pending.confirmation_id,
                        summary,
                        {
                            "previousValue": (
                                previous if action == "set_parameter" else None
                            ),
                            "proposedValue": proposed,
                        },
                    )
                if not isinstance(confirmation_id, str) or not confirmation_id:
                    raise ValueError("Confirmation token required")
                pending = self._gate.confirm(
                    confirmation_id, action, path, previous, proposed, session_id
                )
                if action == "set_parameter":
                    self._backend.set_parameter(pending.path, pending.proposed_value)
                    readback = _lookup_path(
                        self._backend.read_state("all"), pending.path
                    )
                    if readback != pending.proposed_value:
                        raise RuntimeError(
                            f"Setting readback differs: requested {pending.proposed_value!r}, observed {readback!r}"
                        )
                    result = {"path": pending.path, "value": readback}
                else:
                    result = self._backend.run_measurement(
                        pending.path, **pending.proposed_value
                    )
                return OperationResult(True, action, category, result=result)
        except Exception as error:
            return OperationResult(False, action, category, error=str(error))

    def set_parameter(
        self, path, value, confirmed=False, confirmation_id=None, session_id="local"
    ):
        try:
            path, value = validate_parameter(path, value)
        except Exception as error:
            return OperationResult(False, "set_parameter", "WRITE", error=str(error))
        return self._operation(
            "set_parameter", path, value, confirmed, confirmation_id, session_id
        )

    def run_measurement(
        self,
        measurement_type,
        source=None,
        gate=None,
        confirmed=False,
        confirmation_id=None,
        session_id="local",
    ):
        try:
            measurement_type, source, gate = validate_measurement(
                measurement_type, source, gate
            )
        except Exception as error:
            return OperationResult(
                False, "run_measurement", "MEASUREMENT", error=str(error)
            )
        return self._operation(
            "run_measurement",
            measurement_type,
            {"source": source, "gate": gate},
            confirmed,
            confirmation_id,
            session_id,
        )

    def close(self):
        with self._lock:
            instrument = getattr(self._backend, "_inst", None)
            if instrument is not None:
                instrument.close()

    def cancel(self, confirmation_id, session_id="local"):
        if not valid_session_id(session_id):
            raise ValueError("A valid session ID is required")
        with self._lock:
            return self._gate.cancel(confirmation_id, session_id)


def build_mock_client() -> ScopeClient:
    from .training import TrainingScopeBackend

    return ScopeClient(TrainingScopeBackend())


def discover_usb_instruments() -> list[str]:
    """List all VISA resources visible to RsInstrument.
    Docs: https://rsinstrument.readthedocs.io/en/latest/
    Use list_resources('?*') for all, 'USB::?*' for USB only."""
    if RsInstrument is None:
        return []
    try:
        resources = RsInstrument.list_resources("?*")
        return [r for r in resources if r] if resources else []
    except Exception:
        return []


def build_rs_instrument_client(
    resource_name: str,
    reset: bool = False,
    id_query: bool = True,
    simulate: bool = False,
) -> ScopeClient:
    """Connect to a real R&S instrument via RsInstrument.
    resource_name: VISA address, or 'USB'/'AUTO' for auto-discovery.
    simulate: rejected here; vendor command-cache smoke tests are separate.
    Docs: https://rsinstrument.readthedocs.io/en/latest/"""
    if simulate:
        raise ValueError(
            "RsInstrument simulation is a command cache, not an RTB emulator. Unset SCOPE_RESOURCE for RHODA training; use scripts/check-driver.py for a vendor driver smoke test."
        )
    if RsInstrument is None:
        raise RuntimeError(
            "RsInstrument is not installed.\n"
            "  pip install RsInstrument\n"
            "  pip install pyvisa-py    (pure Python VISA backend)\n"
            "Docs: https://rsinstrument.readthedocs.io/en/latest/"
        )

    if resource_name.upper() in ("USB", "AUTO"):
        resources = discover_usb_instruments()
        if not resources:
            raise RuntimeError(
                "No VISA instruments found.\n"
                "  - Check USB cable connection\n"
                "  - Ensure oscilloscope is powered on\n"
                "  - Install VISA backend: pip install pyvisa-py\n"
                "  - Or install R&S VISA from rohde-schwarz.com"
            )
        resources = [
            r
            for r in resources
            if resource_name.upper() != "USB" or r.upper().startswith("USB")
        ]
        if len(resources) != 1:
            raise RuntimeError(
                "Specify the exact VISA address; expected one matching instrument"
            )
        resource_name = resources[0]
        print(f"  Auto-discovered: {resource_name}")

    options = (
        "SelectVisa='socket'" if resource_name.upper().endswith("::SOCKET") else ""
    )

    options = (
        options + "," if options else ""
    ) + "VisaTimeout=5000,OpcTimeout=5000,OpenTimeout=5000"
    instrument = RsInstrument(
        resource_name, id_query=id_query, reset=reset, options=options
    )

    try:
        backend = RsInstrumentBackend(instrument)
        return ScopeClient(backend)
    except Exception:
        instrument.close()
        raise


def _lookup_path(state, path):
    aliases = {
        "acquisition.state": "acquisition_state",
        "timebase.scale": "timebase_scale",
    }
    path = aliases.get(path, path)
    if path.startswith("channel."):
        path = "channels." + path[len("channel.") :]
    current = state
    for part in path.split("."):
        if not isinstance(current, dict):
            raise ValueError(f"State unavailable for {path}")
        key = int(part) if part.isdigit() else part
        if key not in current:
            raise ValueError(f"State unavailable for {path}")
        current = current[key]
    return current
