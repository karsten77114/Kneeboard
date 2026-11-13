#!/usr/bin/env python3
"""Publish a reviewed notice JSON to the Kneeboard API and verify it by read-back.

Never touches Apple Notes, never deletes files. Exit 0 only when verified=true.
"""
import argparse
import hashlib
import json
import math
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_BASE_URL = "https://jx-briefing.karsten77114.workers.dev"
DEFAULT_VERIFY_TIMEOUT = 90.0
HTTP_TIMEOUT = 30
TOKEN_KEY = "JX_BRIEFING_UPLOAD_TOKEN"
DEFAULT_RECEIPT_DIR = Path.home() / ".local/share/karsten-agent/kneeboard/import-receipts"


class ImportError_(Exception):
    """Any failure that must produce a non-zero exit."""


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def read_source(path):
    try:
        return Path(path).read_bytes()
    except OSError as e:
        raise ImportError_(f"cannot read source file: {e.strerror or e}")


def find_secrets_token(start=None):
    """Read the one authorized shared upload token, without searching other secrets."""
    repo = Path(__file__).resolve().parents[1]
    shared = repo.parents[2] / "000_Agent" / ".secrets" / "secrets.env"
    if not shared.is_file():
        return None
    try:
        with shared.open(encoding="utf-8") as handle:
            for raw in handle:
                line = raw.strip()
                if line.startswith("export "):
                    line = line[7:].strip()
                key, sep, value = line.partition("=")
                if sep and key.strip() == TOKEN_KEY:
                    return value.strip().strip("'\"")
    except OSError:
        return None
    return None


def load_token(env=None):
    env = os.environ if env is None else env
    token = env.get(TOKEN_KEY) or env.get("UPLOAD_TOKEN") or find_secrets_token()
    if not token:
        raise ImportError_(f"no upload token found (set {TOKEN_KEY} or UPLOAD_TOKEN)")
    return token


def build_payload(notice, note_id, item_id, source_bytes, filename):
    return {
        "notice": notice,
        "provenance": {
            "kind": "apple_notes",
            "note_id": note_id,
            "item_id": item_id,
            "sha256": sha256_hex(source_bytes),
            "filename": filename,
        },
    }


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ImportError_("unexpected API redirect; credentials were not forwarded")


def _request(req, token):
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=HTTP_TIMEOUT) as resp:
            body = resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        raise ImportError_(f"HTTP {e.code}: {detail.replace(token, '***')}")
    except (urllib.error.URLError, OSError) as e:
        raise ImportError_(f"request failed: {getattr(e, 'reason', e)}")
    try:
        return json.loads(body)
    except ValueError:
        raise ImportError_("response was not valid JSON")


def post_import(base_url, token, payload):
    req = urllib.request.Request(
        base_url.rstrip("/") + "/api/notices/import",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": f"Bearer {token}",
            "User-Agent": "kneeboard-import-notice/1",
        },
    )
    result = _request(req, token)
    if not (isinstance(result, dict) and result.get("ok") is True
            and result.get("saved") is True and result.get("notice_id")):
        msg = result.get("message") if isinstance(result, dict) else None
        raise ImportError_(f"import was not saved: {str(msg).replace(token, '***')[:300]}")
    return result


def fetch_notices(base_url, token):
    req = urllib.request.Request(
        base_url.rstrip("/") + "/api/notices",
        headers={"Accept": "application/json", "User-Agent": "kneeboard-import-notice/1"},
    )
    data = _request(req, token)
    if isinstance(data, dict):
        data = data.get("notices")
    if not isinstance(data, list):
        raise ImportError_("unexpected GET /api/notices response shape")
    return data


def notice_matches(notices, notice_id, sha):
    for n in notices:
        if (isinstance(n, dict) and n.get("id") == notice_id
                and isinstance(n.get("_source"), dict)
                and n["_source"].get("sha256") == sha):
            return True
    return False


def verify_readback(base_url, token, notice_id, sha, timeout, interval=2.0):
    deadline = time.monotonic() + timeout
    while True:
        if notice_matches(fetch_notices(base_url, token), notice_id, sha):
            return
        if time.monotonic() >= deadline:
            raise ImportError_(f"read-back did not match id/hash within {timeout:g}s")
        time.sleep(min(interval, max(0.0, deadline - time.monotonic())))


def write_receipt(path, receipt):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".receipt-")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(receipt, f, ensure_ascii=False, indent=2)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def run(args, env=None, poll_interval=2.0):
    notice_path = Path(args.input)
    try:
        notice = json.loads(notice_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise ImportError_(f"cannot read notice JSON: {e}")
    if not isinstance(notice, dict):
        raise ImportError_("notice JSON must be an object")

    source = Path(args.source_file)
    source_bytes = read_source(source)
    sha = sha256_hex(source_bytes)
    token = load_token(env)

    payload = build_payload(notice, args.note_id, args.item_id, source_bytes, source.name)
    result = post_import(args.base_url, token, payload)
    notice_id = result["notice_id"]

    verify_readback(args.base_url, token, notice_id, sha, args.verify_timeout, poll_interval)

    if sha256_hex(read_source(source)) != sha:
        raise ImportError_("source file changed during import; not verified")

    receipt = {
        "verified": True,
        "notice_id": notice_id,
        "action": result.get("action"),
        "note_id": args.note_id,
        "item_id": args.item_id,
        "sha256": sha,
        "filename": source.name,
        "verified_at": datetime.now(timezone.utc).isoformat(),
    }
    receipt_path = Path(args.receipt) if args.receipt else DEFAULT_RECEIPT_DIR / f"{sha}.json"
    write_receipt(receipt_path, receipt)
    return receipt, receipt_path


def parse_args(argv):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", required=True, help="notice JSON (notice object only)")
    p.add_argument("--source-file", required=True)
    p.add_argument("--note-id", required=True)
    p.add_argument("--item-id", required=True)
    p.add_argument("--base-url", default=DEFAULT_BASE_URL)
    p.add_argument("--verify-timeout", type=float, default=DEFAULT_VERIFY_TIMEOUT)
    p.add_argument("--receipt", help="receipt path (default: private per-hash file)")
    args = p.parse_args(argv)
    endpoint = urlparse(args.base_url)
    loopback = endpoint.hostname in {"127.0.0.1", "localhost", "::1"}
    canonical = endpoint.scheme == "https" and endpoint.hostname == "jx-briefing.karsten77114.workers.dev"
    if not (canonical or (loopback and endpoint.scheme in {"http", "https"})) or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment or endpoint.path not in {"", "/"}:
        p.error("base URL must be the Kneeboard Worker or a local test server")
    if args.verify_timeout < 0 or not math.isfinite(args.verify_timeout):
        p.error("verify timeout must be a finite non-negative number")
    return args


def main(argv=None, env=None, poll_interval=2.0):
    args = parse_args(argv)
    try:
        receipt, path = run(args, env, poll_interval)
    except ImportError_ as e:
        print(f"NOT VERIFIED: {e}", file=sys.stderr)
        return 1
    print(f"verified notice_id={receipt['notice_id']} action={receipt['action']} receipt={path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
