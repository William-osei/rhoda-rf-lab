"""
Rhoda Lab Assistant — Unified Backend

Combines:
  - Instrument control (William) — mock or real R&S oscilloscope via RsInstrument
  - RAG retrieval (Gregory) — procedure/safety/fault corpus with sentence-transformers
  - Session logging + progress tracking
  - Conversation transcript export

Start: python server/app.py
Or:    ./start.sh (runs backend + frontend in parallel)
"""

import os
import atexit
import sys
import json
from datetime import datetime
from pathlib import Path
from flask import Flask, jsonify, request, Response, g
from flask_cors import CORS
from werkzeug.exceptions import RequestEntityTooLarge

# Windows terminals may default to CP1252, while startup diagnostics include
# Unicode symbols. Replace unsupported console characters instead of aborting
# the server before Flask binds its health endpoint.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))
try:
    from dotenv import load_dotenv
    load_dotenv(ROOT.parent / '.env.local', override=False)
except ImportError:
    pass  # Simulator-only installations can use environment configuration.

app = Flask(__name__)
from request_validation import allowed_origins, valid_session_id
from auth import configure as configure_auth
auth_manager = configure_auth(app)
from session_store import SessionStore
session_logs = SessionStore(
    os.environ.get("RHODA_SESSION_DB", str(ROOT / "data" / "sessions.sqlite3"))
)
# An enabled pilot must have a writable ownership journal before an instrument
# connection is initialized, as well as valid account/secret configuration.
auth_manager.bind_journal(session_logs.path)
app.config["MAX_CONTENT_LENGTH"] = 512000
CORS(app, origins=allowed_origins(), supports_credentials=auth_manager.enabled)
from ai_service import ai
app.register_blueprint(ai)
from library import library
app.register_blueprint(library)

# ─────────────────────────────────────────────
# Instrument API (William's ScopeClient)
# ─────────────────────────────────────────────

from instrument.scope_client import (
    build_mock_client,
    build_rs_instrument_client,
    discover_usb_instruments,
)

SCOPE_RESOURCE = os.environ.get("SCOPE_RESOURCE")
SCOPE_SIMULATE = os.environ.get("SCOPE_SIMULATE", "").lower() in ("1", "true", "yes")
instrument_mode = "mock"
instrument_error = None
if SCOPE_RESOURCE:
    print(
        f"🔬 Instrument: connecting to {SCOPE_RESOURCE}"
        + (" (simulation)" if SCOPE_SIMULATE else "")
    )
    try:
        scope = build_rs_instrument_client(SCOPE_RESOURCE, simulate=SCOPE_SIMULATE)
        instrument_mode = "driver-simulation" if SCOPE_SIMULATE else "hardware"
    except Exception as e:
        print(f"🔬 Instrument: connection failed — {e}")
        instrument_mode, instrument_error, scope = "unavailable", str(e), None
else:
    print("🔬 Instrument: simulator (set SCOPE_RESOURCE=USB for real hardware)")
    scope = build_mock_client()


atexit.register(lambda: scope.close() if scope is not None else None)


@app.before_request
def validate_instrument_request():
    origin = request.headers.get("Origin")
    if request.path.startswith("/api/") and origin and origin not in allowed_origins():
        return jsonify({"ok": False, "error": "Origin not allowed", "code": "origin_denied"}), 403
    if request.method == "OPTIONS":
        return None
    if request.path.startswith("/api/session/") and request.method == "GET":
        sid = request.args.get("session_id")
        if sid is not None and not valid_session_id(sid):
            return jsonify({"ok": False, "error": "Invalid session ID"}), 400
    instrument_path = request.path.startswith("/api/instrument/") or request.path in (
        "/api/state",
        "/api/set",
        "/api/measure",
        "/api/confirm",
    )
    if (
        instrument_path
        and scope is None
        and request.path != "/api/instrument/diagnostics"
    ):
        return (
            jsonify(
                {"ok": False, "error": instrument_error or "Instrument unavailable"}
            ),
            503,
        )
    if (instrument_path or request.path == "/api/training/scenarios") and request.method == "POST":
        sid = request.headers.get("X-Rhoda-Session", "")
        if not valid_session_id(sid):
            return (
                jsonify({"ok": False, "error": "A valid X-Rhoda-Session header is required"}),
                400,
            )
        if request.content_length and request.content_length > 16384:
            return jsonify({"ok": False, "error": "Instrument request too large"}), 413
        if not isinstance(request.get_json(silent=True), dict):
            return jsonify({"ok": False, "error": "Expected JSON object"}), 400


@app.errorhandler(RequestEntityTooLarge)
def request_too_large(_error):
    return jsonify({"ok": False, "ack": False, "error": "Request too large"}), 413


def instrument_session_id():
    # Journal session IDs identify owned learning records. Approval tokens also
    # bind to this exact login, so logout/relogin cannot revive an old approval.
    session = getattr(g, "auth_session", None)
    sid = request.headers.get("X-Rhoda-Session", "")
    return f"{session.confirmation_session}_{sid}" if session else sid


def journal_filter():
    return getattr(g, "auth_session_filter", request.args.get("session_id"))


@app.after_request
def protect_account_response(response):
    if app.extensions["rhoda_auth"].enabled and request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/api/instrument/cancel", methods=["POST"])
def instrument_cancel():
    token = request.get_json().get("confirmationId")
    if not isinstance(token, str) or not token:
        return (
            jsonify({"ok": False, "error": "Confirmation token must be a string"}),
            400,
        )
    try:
        cancelled = scope.cancel(token, instrument_session_id())
        return jsonify({"ok": True, "cancelled": cancelled})
    except ValueError as error:
        return jsonify({"ok": False, "error": str(error)}), 409


def _op(r):
    return {
        "ok": r.ok,
        "name": r.name,
        "category": r.category,
        "needsConfirmation": r.needsConfirmation,
        "confirmationId": r.confirmationId,
        "summary": r.summary,
        "result": r.result,
        "error": r.error,
        "provenance": {
            "mode": instrument_mode,
            "source": "backend operation",
            "hardware_acceptance": (
                "pending" if instrument_mode == "hardware" else "not hardware evidence"
            ),
        },
    }


@app.route("/api/instrument/state", methods=["GET"])
@app.route("/api/state", methods=["GET"])
def instrument_state():
    return jsonify(_op(scope.read_state(scope=request.args.get("scope", "all"))))


@app.route("/api/instrument/set", methods=["POST"])
@app.route("/api/set", methods=["POST"])
def instrument_set():
    d = request.get_json(force=True)
    return jsonify(
        _op(
            scope.set_parameter(
                path=d.get("path", ""),
                value=d.get("value"),
                confirmed=d.get("confirmed", False),
                confirmation_id=d.get("confirmationId"),
                session_id=instrument_session_id(),
            )
        )
    )


@app.route("/api/instrument/measure", methods=["POST"])
@app.route("/api/measure", methods=["POST"])
def instrument_measure():
    d = request.get_json(force=True)
    return jsonify(
        _op(
            scope.run_measurement(
                measurement_type=d.get("measurementType", "frequency"),
                source=d.get("source"),
                gate=d.get("gate"),
                confirmed=d.get("confirmed", False),
                confirmation_id=d.get("confirmationId"),
                session_id=instrument_session_id(),
            )
        )
    )


@app.route("/api/instrument/confirm", methods=["POST"])
@app.route("/api/confirm", methods=["POST"])
def instrument_confirm():
    d = request.get_json(force=True)
    return jsonify(
        _op(
            scope.set_parameter(
                path=d.get("path", ""),
                value=d.get("value"),
                confirmed=True,
                confirmation_id=d.get("confirmationId"),
                session_id=instrument_session_id(),
            )
        )
    )


@app.route("/api/instrument/discover", methods=["GET"])
def instrument_discover():
    resources = discover_usb_instruments()
    return jsonify({"resources": resources, "count": len(resources)})


@app.route("/api/instrument/diagnostics")
def instrument_diagnostics():
    from instrument.diagnostics import connection_diagnostics

    return jsonify(
        {
            **connection_diagnostics(),
            "mode": instrument_mode,
            "connection_error": instrument_error,
            "profile": (
                getattr(
                    scope._backend,
                    "profile",
                    {
                        "family": "RHODA training",
                        "channels": 4,
                        "hardware_acceptance": "not applicable",
                    },
                )
                if scope
                else None
            ),
        }
    )


@app.route("/api/training/scenarios", methods=["GET", "POST"])
def training_scenarios():
    from instrument.training import SCENARIOS, TrainingScopeBackend

    if (
        instrument_mode != "mock"
        or scope is None
        or not isinstance(scope._backend, TrainingScopeBackend)
    ):
        return (
            jsonify({"ok": False, "error": "Training is only available in mock mode"}),
            409,
        )
    if request.method == "POST":
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or not request.headers.get("X-Rhoda-Session"):
            return (
                jsonify(
                    {"ok": False, "error": "JSON object and session header required"}
                ),
                400,
            )
        try:
            with scope._lock:
                scope._backend.select_scenario(body.get("scenario"))
        except ValueError as error:
            return jsonify({"ok": False, "error": str(error)}), 400
    return jsonify({"scenarios": SCENARIOS})


@app.route("/api/training/waveform")
def training_waveform():
    from instrument.training import TrainingScopeBackend

    if (
        instrument_mode != "mock"
        or scope is None
        or not isinstance(scope._backend, TrainingScopeBackend)
    ):
        return (
            jsonify({"ok": False, "error": "No training waveform in hardware mode"}),
            409,
        )
    try:
        with scope._lock:
            return jsonify(scope._backend.waveform(request.args.get("source", "CH1")))
    except ValueError as error:
        return jsonify({"ok": False, "error": str(error)}), 400


# ─────────────────────────────────────────────
# RAG Retrieval (Gregory's RetrievalIndex)
# ─────────────────────────────────────────────

rag_index = None
# The desktop offline host skips optional embeddings and their model downloads.
# Local library keyword search remains available without this semantic index.
if os.environ.get("RHODA_RAG_ENABLED", "1") != "0":
    try:
        from rag.rag import RetrievalIndex

        corpus_dir = ROOT / "rag" / "corpus"
        if corpus_dir.exists() and any(corpus_dir.glob("*/*.md")):
            rag_index = RetrievalIndex(corpus_dir=corpus_dir)
            print(f"📚 RAG: {len(rag_index.docs)} docs loaded from {corpus_dir}")
        else:
            print(f"📚 RAG: no corpus found at {corpus_dir}")
    except ImportError as e:
        print(f"📚 RAG: sentence-transformers not installed ({e})")
    except Exception as e:
        print(f"📚 RAG: failed ({e})")


@app.route("/api/rag/status", methods=["GET"])
def rag_status():
    if not rag_index:
        return jsonify({
            "available": False,
            "method": "unavailable",
            "error": "Canonical retrieval index is unavailable",
        })
    return jsonify(rag_index.status())


@app.route("/api/rag/retrieve", methods=["POST"])
def rag_retrieve():
    d = request.get_json(silent=True)
    if not isinstance(d, dict):
        return jsonify({"ok": False, "error": "Expected JSON object"}), 400
    query, top_k, category = d.get("query"), d.get("top_k", 3), d.get("category")
    if not isinstance(query, str) or not query.strip() or len(query) > 12000:
        return jsonify({"ok": False, "error": "Query must contain 1–12000 characters"}), 400
    if type(top_k) is not int or not 1 <= top_k <= 10:
        return jsonify({"ok": False, "error": "top_k must be an integer between 1 and 10"}), 400
    if category not in (None, "all", "procedure", "safety", "fault"):
        return jsonify({"ok": False, "error": "Unsupported retrieval category"}), 400
    if not rag_index:
        return jsonify({
            "chunks": [],
            "available": False,
            "method": "unavailable",
            "error": "Canonical retrieval index is unavailable",
        })
    try:
        return jsonify({
            **rag_index.retrieve(
                query=query.strip(),
                top_k=top_k,
                category=None if category == "all" else category,
            ),
            "available": True,
            "method": getattr(rag_index, "method", "semantic"),
        })
    except Exception:
        return jsonify({"ok": False, "error": "Semantic retrieval unavailable; retry or use local library search"}), 503


# ─────────────────────────────────────────────
# Session Logging + Transcript Export
# ─────────────────────────────────────────────

@app.route("/api/session/log", methods=["POST"])
def log_event():
    try:
        event = request.get_json(silent=True)
        session = getattr(g, "auth_session", None)
        if session and isinstance(event, dict):
            event = {**event, "auth_owner": session.user.username}
        inserted = session_logs.append(event)
        count = len(session_logs.snapshot(event["session_id"])) if session else len(session_logs)
        return jsonify({"ack": True, "inserted": inserted, "count": count})
    except (ValueError, TypeError) as error:
        return jsonify({"ack": False, "error": str(error)}), 400


@app.route("/api/session/logs", methods=["GET"])
def get_logs():
    sid = journal_filter()
    logs = session_logs.snapshot(sid)
    return jsonify({"logs": logs, "count": len(logs)})


@app.route("/api/session/transcript", methods=["GET"])
def export_transcript():
    sid = journal_filter()
    logs = session_logs.snapshot(sid)
    lines = []
    for l in logs:
        role = l.get("role", "?").upper()
        content = l.get("content", "")
        ts = l.get("timestamp", l.get("server_timestamp", ""))
        # Combined exports must retain the same session attribution as the dashboard.
        owner = l.get("auth_owner") or "Offline / owner unavailable"
        attribution = f"[session: {l['session_id']}; owner: {json.dumps(owner, ensure_ascii=False)}]"
        tool = l.get("tool_call")
        if tool:
            lines.append(
                f"[{ts}] {attribution} TOOL: {tool.get('name','')} ({tool.get('category','')}) confirmed={l.get('confirmed','')}"
            )
        else:
            lines.append(f"[{ts}] {attribution} {role}: {content}")
    text = "\n".join(lines)
    return Response(
        text,
        mimetype="text/plain",
        headers={
            "Content-Disposition": f"attachment; filename=transcript_{sid or 'all'}.txt"
        },
    )


# ─────────────────────────────────────────────
# Progress Tracking
# ─────────────────────────────────────────────

TOPIC_KEYWORDS = {
    "probe_compensation": ["probe", "compensation", "calibrat", "trimmer"],
    "vertical_scale": ["vertical", "v/div", "volts", "amplitude", "scale"],
    "timebase": ["timebase", "time/div", "horizontal", "sweep"],
    "triggering": ["trigger", "edge", "level", "slope"],
    "measurements": ["measure", "frequency", "period", "peak", "rms"],
    "safety": ["safety", "voltage limit", "ground", "overload", "warning"],
    "troubleshooting": ["noise", "clip", "alias", "drift", "fault", "fix"],
}


@app.route("/api/session/progress", methods=["GET"])
def get_progress():
    sid = journal_filter()
    logs = session_logs.snapshot(sid)

    topic_scores: dict[str, int] = {}
    for log in logs:
        content = (log.get("content", "") or "").lower()
        for topic, keywords in TOPIC_KEYWORDS.items():
            if any(kw in content for kw in keywords):
                topic_scores[topic] = topic_scores.get(topic, 0) + 1

    covered = [t for t, s in topic_scores.items() if s >= 2]
    curriculum = [
        "safety",
        "probe_compensation",
        "vertical_scale",
        "timebase",
        "triggering",
        "measurements",
        "troubleshooting",
    ]
    next_topic = next(
        (t for t in curriculum if topic_scores.get(t, 0) < 2), curriculum[0]
    )

    return jsonify(
        {
            "session_id": sid,
            "total_turns": len(logs),
            "topic_scores": topic_scores,
            "topics_covered": covered,
            "recommended_next": next_topic,
        }
    )


# ─────────────────────────────────────────────
# Failure Points (Instructor View)
# ─────────────────────────────────────────────


@app.route("/api/session/failure-points", methods=["GET"])
def failure_points():
    logs = session_logs.snapshot(journal_filter())
    errors = [
        l
        for l in logs
        if l.get("role") == "system" and "error" in (l.get("content", "") or "").lower()
    ]
    faults = [
        l
        for l in logs
        if l.get("topic") == "troubleshooting"
        or "fault" in (l.get("content", "") or "").lower()
    ]
    denied = [l for l in logs if l.get("confirmed") is False]

    fault_counts: dict[str, int] = {}
    for f in faults:
        content = (f.get("content", "") or "")[:80]
        fault_counts[content] = fault_counts.get(content, 0) + 1

    return jsonify(
        {
            "total_errors": len(errors),
            "total_faults": len(faults),
            "total_denied_actions": len(denied),
            "common_faults": sorted(
                fault_counts.items(), key=lambda x: x[1], reverse=True
            )[:10],
            "recent_errors": errors[-10:],
        }
    )


# ─────────────────────────────────────────────
# Health
# ─────────────────────────────────────────────


@app.route("/api/health", methods=["GET"])
def health():
    session = getattr(g, "auth_session", None)
    count = len(session_logs)
    if session:
        from auth import permissions
        rights = permissions(session.user.role)
        if not rights["inspectAllSessions"]:
            count = len(session_logs.snapshot(session.learning_session)) if rights["readJournal"] else None
    return jsonify(
        {
            "status": "ok",
            "instrument": instrument_mode,
            "instrument_error": instrument_error,
            "rag": f"{len(rag_index.docs)} docs" if rag_index else "disabled",
            "session_logs": count,
        }
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    print(f"\n{'='*44}")
    print(f"  Rhoda Backend — http://127.0.0.1:{port}")
    print(f"  Instrument: {instrument_mode}")
    print(f"  RAG: {len(rag_index.docs) if rag_index else 0} docs")
    print(f"{'='*44}\n")
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=port, debug=False)
