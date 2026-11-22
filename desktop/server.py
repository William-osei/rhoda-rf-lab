"""One loopback origin for RHODA's built pages and existing offline API.

This local desktop host uses Werkzeug, not a public production deployment.
The supervisor supplies an in-memory nonce through RHODA_DESKTOP_TOKEN; it is
never accepted in a URL, written to disk or printed by this service.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
from threading import Event, Lock, Thread

from flask import abort, jsonify, request, send_file
from werkzeug.serving import WSGIRequestHandler, make_server


ENTRY_PAGES = frozenset(("desktop.html", "index.html", "chat.html", "library.html", "practice.html", "spatial-bench.html", "instruments.html", "instructor.html"))
PUBLIC_DIRECTORIES = frozenset(("assets", "audio", "fonts", "gltf", "learning", "ui"))
PUBLIC_SUFFIXES = frozenset((".js", ".css", ".json", ".html", ".txt", ".md", ".glb", ".gltf", ".bin", ".wasm", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".ogg", ".wav", ".mp3", ".mp4", ".ktx2"))


class DesktopConfigurationError(RuntimeError):
    pass


def load_environment(project_root: Path) -> None:
    """Keep explicit account settings while the desktop safety flags take priority."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        # Never quietly bypass an account configuration in a minimal runtime.
        for name in (".env.local", ".env"):
            source = project_root / name
            if source.is_file() and re.search(r"^\s*(?:export\s+)?RHODA_AUTH_\w+\s*=", source.read_text(encoding="utf-8-sig"), re.M):
                raise DesktopConfigurationError("Account configuration requires python-dotenv in this Python environment.")
        return
    # Local settings win over .env; explicit inherited settings win over both.
    load_dotenv(project_root / ".env.local", override=False)
    load_dotenv(project_root / ".env", override=False)


def static_inventory(dist: Path) -> dict[str, Path]:
    missing = sorted(name for name in ENTRY_PAGES if not (dist / name).is_file())
    if missing:
        raise DesktopConfigurationError("Built application is incomplete; missing: " + ", ".join(missing))
    allowed = {}
    for candidate in dist.rglob("*"):
        if not candidate.is_file():
            continue
        relative = candidate.relative_to(dist).as_posix()
        parts = PurePosixPath(relative).parts
        resolved = candidate.resolve()
        if any(part.startswith(".") for part in parts) or not resolved.is_relative_to(dist):
            continue
        if relative in ENTRY_PAGES or (parts[0] in PUBLIC_DIRECTORIES and (
            candidate.suffix.lower() in PUBLIC_SUFFIXES
            # This is an intentional downloadable educational example, not
            # executable server/application source.
            or relative == "learning/signal_ml_starter.py"
        )):
            allowed[relative] = resolved
    if not ENTRY_PAGES <= allowed.keys():
        raise DesktopConfigurationError("Built application pages must remain inside the dist directory.")
    return allowed


def create_application(project_root: Path, resource_root: Path, data_dir: Path, port: int, token: str):
    project_root, resource_root, data_dir = (path.resolve() for path in (project_root, resource_root, data_dir))
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,160}", token or ""):
        raise DesktopConfigurationError("A valid supervisor nonce is required.")
    if not 1 <= port <= 65535:
        raise DesktopConfigurationError("Choose a valid local TCP port.")
    backend = project_root / "server" / "app.py"
    if not backend.is_file():
        raise DesktopConfigurationError("The project backend could not be found.")
    if not (resource_root / "00-START-HERE" / "catalog" / "documents.json").is_file():
        raise DesktopConfigurationError("The resource folder must contain 00-START-HERE/catalog/documents.json.")
    dist = (project_root / "dist").resolve()
    inventory = static_inventory(dist)
    origin = f"http://127.0.0.1:{port}"
    # Set before dotenv/backend import: no inherited setting may connect hardware
    # or a paid provider, or initialize/download an optional embedding model.
    os.environ.update({"SCOPE_RESOURCE": "", "SCOPE_SIMULATE": "0", "RHODA_AI_ENABLED": "0", "RHODA_RAG_ENABLED": "1", "RHODA_ALLOWED_ORIGINS": origin,
                       "RHODA_RESOURCE_ROOT": str(resource_root), "RHODA_SESSION_DB": str(data_dir / "sessions.sqlite3"), "HOST": "127.0.0.1", "PORT": str(port)})
    # Account file paths in .env follow the ordinary project-root launch, even
    # when the supervisor itself starts from another working directory.
    os.chdir(project_root)
    load_environment(project_root)
    data_dir.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(backend.parent))
    spec = importlib.util.spec_from_file_location("rhoda_desktop_backend", backend)
    if not spec or not spec.loader:
        raise DesktopConfigurationError("The project backend could not be loaded.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    if module.instrument_mode != "mock" or module.scope is None:
        raise DesktopConfigurationError("The desktop host must start in the training simulator.")
    # The legacy discovery route otherwise probes VISA resources even when the
    # active scope is a mock. This desktop entry point has no equipment access.
    module.discover_usb_instruments = lambda: []
    app = module.app
    state = {"ready": False, "server": None}
    exit_requested = Event()
    stop_requested = Event()
    stop_lock = Lock()
    expected_host = f"127.0.0.1:{port}"

    def desktop_boundary():
        if request.environ.get("HTTP_HOST", "") != expected_host:
            return jsonify({"error": "Host not allowed"}), 403
        supplied_origin = request.headers.get("Origin")
        if supplied_origin and supplied_origin != origin:
            return jsonify({"error": "Origin not allowed"}), 403
        if request.path.startswith("/_desktop/"):
            provided = request.headers.get("X-Rhoda-Desktop-Token", "")
            if len(provided) > 160 or not hmac.compare_digest(provided.encode(), token.encode()):
                return jsonify({"error": "Desktop supervisor token required"}), 403
        elif not request.path.startswith("/api/"):
            relative = request.path.lstrip("/") or "index.html"
            if relative not in inventory:
                # This also blocks Flask's default backend /static route. The
                # application exposes built dist assets only, never source.
                abort(404)
        return None

    # Host and supervisor controls must run before backend account/API hooks.
    app.before_request_funcs.setdefault(None, []).insert(0, desktop_boundary)

    @app.get("/_desktop/ready")
    def ready():
        available = state["ready"] and not stop_requested.is_set()
        project_identity = str(project_root).casefold() if os.name == "nt" else str(project_root)
        return jsonify({"app": "rhoda-desktop", "ready": available, "mode": "mock", "port": port, "pid": os.getpid(),
                        "projectId": hashlib.sha256(project_identity.encode()).hexdigest()[:20], "entryPages": len(ENTRY_PAGES)}), 200 if available else 503

    @app.post("/_desktop/shutdown")
    def shutdown():
        with stop_lock:
            if not stop_requested.is_set():
                stop_requested.set()
                server = state["server"]
                if server is not None:
                    Thread(target=server.shutdown, name="rhoda-desktop-shutdown", daemon=True).start()
        return jsonify({"app": "rhoda-desktop", "stopping": True}), 202

    @app.post("/api/desktop/exit")
    def request_desktop_exit():
        # This is a local app-window action, not an account operation. Require
        # an actual same-origin JSON fetch so a web page cannot close RHODA.
        if request.headers.get("Origin") != origin:
            return jsonify({"error": "Origin not allowed"}), 403
        if not request.is_json:
            return jsonify({"error": "Expected a same-origin JSON request"}), 415
        exit_requested.set()
        return jsonify({"requested": True}), 202

    @app.get("/_desktop/exit-requested")
    def desktop_exit_requested():
        return jsonify({"requested": exit_requested.is_set()}), 200

    @app.route("/api/desktop/display-mode", methods=["GET", "POST"])
    def desktop_display_mode():
        preference_path = data_dir / "display-mode.json"
        if request.method == "GET":
            if not preference_path.is_file():
                return jsonify({"mode": "borderless"})
            try:
                preference = json.loads(preference_path.read_text(encoding="utf-8"))
            except (OSError, ValueError) as error:
                raise DesktopConfigurationError("The desktop display preference could not be read.") from error
            if not isinstance(preference, dict) or preference.get("mode") not in {"windowed", "borderless", "fullscreen"}:
                return jsonify({"mode": "borderless"})
            return jsonify({"mode": preference["mode"]})
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict) or payload.get("mode") not in {"windowed", "borderless", "fullscreen"}:
            return jsonify({"error": "Display mode must be windowed, borderless or fullscreen."}), 400
        temporary_path = preference_path.with_suffix(".tmp")
        temporary_path.write_text(json.dumps({"mode": payload["mode"]}), encoding="utf-8")
        temporary_path.replace(preference_path)
        return jsonify({"mode": payload["mode"], "restartRequired": True})

    @app.route("/", methods=["GET", "HEAD"])
    @app.route("/<path:relative>", methods=["GET", "HEAD"])
    def built_frontend(relative="index.html"):
        if relative.startswith(("api/", "_desktop/", "src/", "server/")) or "\\" in relative:
            abort(404)
        target = inventory.get(relative)
        if target is None or not target.is_file() or not target.resolve().is_relative_to(dist):
            abort(404)
        return send_file(target, conditional=True, max_age=0)

    @app.after_request
    def desktop_response(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        # Local APIs/assets keep working; legacy direct cloud fetches cannot
        # contact a provider from this deliberately offline application host.
        # Other CSP directives and ordinary external reference links are left
        # alone so that local 3D workers and educational navigation still work.
        response.headers["Content-Security-Policy"] = "connect-src 'self' blob:"
        if request.path.startswith("/_desktop/") or request.path == "/" or request.path.endswith(".html"):
            response.headers["Cache-Control"] = "no-store"
        return response

    return app, state


class QuietRequestHandler(WSGIRequestHandler):
    # Query strings can contain user material; the private supervisor needs only
    # startup/failure logs, not a second transcript of browser requests.
    def log_request(self, code="-", size="-"):
        pass


def main(argv=None):
    parser = argparse.ArgumentParser(description="RHODA offline desktop loopback service")
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--resource-root", required=True, type=Path)
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--port", default=8765, type=int)
    args = parser.parse_args(argv)
    try:
        app, state = create_application(args.project_root, args.resource_root, args.data_dir, args.port, os.environ.get("RHODA_DESKTOP_TOKEN", ""))
        server = make_server("127.0.0.1", args.port, app, threaded=True, request_handler=QuietRequestHandler)
        state.update({"ready": True, "server": server})
        print(f"RHODA desktop simulator ready at http://127.0.0.1:{args.port}", flush=True)
        try:
            server.serve_forever(poll_interval=.2)
        finally:
            state["ready"] = False
            server.server_close()
        return 0
    except (DesktopConfigurationError, OSError, RuntimeError) as error:
        print("RHODA desktop startup failed: " + str(error), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
