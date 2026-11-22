"""Single-use confirmation bound to an exact operation and session."""

from copy import deepcopy
from dataclasses import dataclass
from time import monotonic
from uuid import uuid4
from typing import Any


@dataclass(frozen=True)
class PendingChange:
    confirmation_id: str
    action: str
    path: str
    previous_value: Any
    proposed_value: Any
    session_id: str
    expires_at: float
    summary: str


class ConfirmationGate:
    def __init__(self, ttl_seconds=120, clock=monotonic):
        self._pending = {}
        self._ttl, self._clock = ttl_seconds, clock

    def preview(self, action, path, previous_value, proposed_value, session_id="local"):
        now = self._clock()
        self._pending = {k: v for k, v in self._pending.items() if v.expires_at > now}
        if len(self._pending) >= 256:
            raise ValueError("Too many pending changes; wait for expiry")
        token = uuid4().hex
        pending = PendingChange(
            token,
            action,
            path,
            deepcopy(previous_value),
            deepcopy(proposed_value),
            session_id,
            now + self._ttl,
            f"{action}: {path} {previous_value!r} -> {proposed_value!r}",
        )
        self._pending[token] = pending
        return pending

    def confirm(
        self,
        confirmation_id,
        action,
        path,
        previous_value,
        proposed_value,
        session_id="local",
    ):
        if not isinstance(confirmation_id, str):
            raise ValueError("Confirmation token must be a string")
        pending = self._pending.get(confirmation_id)
        if pending is None or pending.expires_at <= self._clock():
            self._pending.pop(confirmation_id, None)
            raise ValueError(
                "Unknown or expired confirmation token; request a new preview"
            )
        if pending.session_id != session_id:
            raise ValueError("Confirmation belongs to another session")
        del self._pending[confirmation_id]
        if (pending.action, pending.path, pending.proposed_value) != (
            action,
            path,
            proposed_value,
        ):
            raise ValueError("Confirmation does not match the previewed operation")
        if pending.previous_value != previous_value:
            raise ValueError("Instrument state changed; request a new preview")
        return pending

    def cancel(self, confirmation_id, session_id="local"):
        if not isinstance(confirmation_id, str) or not confirmation_id:
            raise ValueError("Confirmation token must be a string")
        pending = self._pending.get(confirmation_id)
        if pending is None:
            return False  # Idempotent retry after a consumed or already cancelled token.
        if pending.session_id != session_id:
            raise ValueError("Confirmation belongs to another session")
        del self._pending[confirmation_id]
        return pending.expires_at > self._clock()
