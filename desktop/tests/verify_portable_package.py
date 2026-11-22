"""Smoke-test an extracted RHODA portable bundle without a child process."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import threading
import urllib.request
import zipfile


def free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def request(base: str, path: str, token: str | None = None, method: str = "GET"):
    headers = {"X-Rhoda-Desktop-Token": token} if token else {}
    req = urllib.request.Request(base + path, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=5) as response:
        return response.status, response.read()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path, help="Extracted RHODA-Portable folder")
    parser.add_argument("--archive", required=True, type=Path, help="ZIP created by build-portable.ps1")
    args = parser.parse_args()
    root, archive = args.root.resolve(), args.archive.resolve()
    if not (root / "RHODA.exe").is_file() or not archive.is_file():
        parser.error("root must be an extracted package and archive must exist")

    python_env = {"PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1",
                  "RHODA_AI_ENABLED": "0", "RHODA_RAG_ENABLED": "1", "SCOPE_RESOURCE": "", "SCOPE_SIMULATE": "0"}
    names = ("PYTHONUTF8", "PYTHONIOENCODING", "PYTHONDONTWRITEBYTECODE", "RHODA_AI_ENABLED", "RHODA_RAG_ENABLED",
             "SCOPE_RESOURCE", "SCOPE_SIMULATE", "RHODA_DESKTOP_TOKEN")
    prior_env = {name: os.environ.get(name) for name in names}
    prior_cwd = Path.cwd()
    token, port = secrets.token_hex(24), free_port()
    python_env["RHODA_DESKTOP_TOKEN"] = token
    os.environ.update(python_env)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    httpd = thread = None
    try:
        root_server = str(root / "server")
        sys.path.insert(0, root_server)
        spec = importlib.util.spec_from_file_location("rhoda_portable_smoke_server", root / "desktop" / "server.py")
        if spec is None or spec.loader is None:
            raise RuntimeError("Could not load the packaged desktop server")
        desktop = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(desktop)
        app, state = desktop.create_application(root, root / "resources", root / "data", port, token)
        httpd = desktop.make_server("127.0.0.1", port, app, threaded=True, request_handler=desktop.QuietRequestHandler)
        state.update({"ready": True, "server": httpd})
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{port}"

        ready_status, ready_body = request(base, "/_desktop/ready", token)
        ready = json.loads(ready_body)
        docs_status, docs_body = request(base, "/api/library/documents")
        documents = json.loads(docs_body).get("documents", [])
        search_status, search_body = request(base, "/api/library/search?q=oscilloscope")
        results = json.loads(search_body).get("results", [])
        pages = {path: request(base, path)[0] for path in ("/library.html", "/desktop.html")}
        with (root / "resources" / "00-START-HERE" / "catalog" / "documents.json").open(encoding="utf-8") as source:
            catalog = json.load(source)
        metadata = json.loads((root / "RESOURCE-PACKAGE.json").read_text(encoding="utf-8-sig"))

        with zipfile.ZipFile(archive) as bundle:
            entries = bundle.namelist()
        normalized = [entry.lower().replace("\\", "/") for entry in entries]
        forbidden = ("rhodes and schwarze", "lab-assistant", "rhoda_technical_report", "catalog/extracted-text")
        restricted = [entry for entry in normalized if any(fragment in entry for fragment in forbidden)]
        asset_notices = ("dist/gltf/lab-companion.credit.json", "dist/gltf/research-companion.credit.json",
                         "dist/gltf/rocketbox-license.txt")
        included_asset_notices = [notice for notice in asset_notices if notice in normalized]
        with (root / "dist" / "gltf" / "lab-companion.credit.json").open(encoding="utf-8") as source:
            lab_license = json.load(source).get("license")
        with (root / "dist" / "gltf" / "research-companion.credit.json").open(encoding="utf-8") as source:
            research_license = json.load(source).get("license")
        checks = {
            "ready": ready_status == 200 and ready.get("ready") and ready.get("mode") == "mock",
            "empty_local_document_catalog": docs_status == 200 and not documents and not catalog and metadata.get("documents") == 0,
            "no_vendor_search_results": search_status == 200 and not results,
            "app_pages_served": all(status == 200 for status in pages.values()),
            "restricted_payload_absent": not restricted,
            "avatar_license_notices_present": len(included_asset_notices) == len(asset_notices) and lab_license == "MIT" and research_license == "CC0-1.0",
        }
        if not all(checks.values()):
            raise AssertionError(json.dumps({"checks": checks, "pages": pages, "restricted": restricted}, indent=2))
        print(json.dumps({"checks": checks, "documents": len(documents), "searchResults": len(results),
                          "pages": pages, "avatarNotices": included_asset_notices, "archiveEntries": len(entries)}, indent=2))
        return 0
    finally:
        if httpd is not None:
            try:
                request(f"http://127.0.0.1:{port}", "/_desktop/shutdown", token, method="POST")
            except Exception:
                state = locals().get("state")
                if state is not None:
                    state["ready"] = False
                    httpd.shutdown()
            httpd.server_close()
        if thread is not None:
            thread.join(timeout=3)
        os.chdir(prior_cwd)
        for name, value in prior_env.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        if root_server in sys.path:
            sys.path.remove(root_server)


if __name__ == "__main__":
    raise SystemExit(main())
