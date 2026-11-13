import contextlib
import hashlib
import io
import json
import os
import stat
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import import_notice  # noqa: E402

TOKEN = "secret-token-value-123"
SOURCE = "公告原文 bytes\n".encode("utf-8")
SHA = hashlib.sha256(SOURCE).hexdigest()
NOTICE = {"title": "T", "source": "FN-1", "summary": ["x"]}


class FakeApi:
    def __init__(self, post_status=200, get_hash=SHA, get_id="n1", on_post=None, redirect_to=None, post_result=None):
        self.post_status = post_status
        self.get_hash = get_hash
        self.get_id = get_id
        self.on_post = on_post
        self.redirect_to = redirect_to
        self.post_result = post_result
        self.posts = []
        api = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, status, obj):
                body = json.dumps(obj).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                raw = self.rfile.read(int(self.headers["Content-Length"]))
                api.posts.append((self.path, self.headers.get("Authorization"), json.loads(raw)))
                if api.redirect_to:
                    self.send_response(302)
                    self.send_header("Location", api.redirect_to)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                if api.on_post:
                    api.on_post()
                if api.post_status != 200:
                    self._send(api.post_status, {"ok": False, "message": f"fail {TOKEN}"})
                else:
                    self._send(200, api.post_result or {"ok": True, "saved": True, "action": "created", "notice_id": "n1"})

            def do_GET(self):
                self._send(200, {"notices": [{"id": api.get_id, "_source": {"sha256": api.get_hash}}]})

        self.server = HTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def __enter__(self):
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *a):
        self.server.shutdown()
        self.server.server_close()


class ImportNoticeTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)
        self.src = self.tmp / "source.txt"
        self.src.write_bytes(SOURCE)
        self.notice = self.tmp / "notice.json"
        self.notice.write_text(json.dumps(NOTICE), encoding="utf-8")
        self.receipt = self.tmp / "rcpt" / "r.json"

    def run_main(self, api, timeout="0.3"):
        argv = ["--input", str(self.notice), "--source-file", str(self.src),
                "--note-id", "NOTE", "--item-id", "ITEM", "--base-url", api.url,
                "--verify-timeout", timeout, "--receipt", str(self.receipt)]
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = import_notice.main(argv, env={"JX_BRIEFING_UPLOAD_TOKEN": TOKEN}, poll_interval=0.05)
        self.assertNotIn(TOKEN, out.getvalue() + err.getvalue())
        return code

    def test_success_posts_payload_and_writes_private_receipt(self):
        with FakeApi() as api:
            self.assertEqual(self.run_main(api), 0)
        path, auth, body = api.posts[0]
        self.assertEqual(path, "/api/notices/import")
        self.assertEqual(auth, f"Bearer {TOKEN}")
        self.assertEqual(body["notice"], NOTICE)
        self.assertEqual(body["provenance"], {
            "kind": "apple_notes", "note_id": "NOTE", "item_id": "ITEM",
            "sha256": SHA, "filename": "source.txt"})
        receipt = json.loads(self.receipt.read_text())
        self.assertTrue(receipt["verified"])
        self.assertEqual(receipt["notice_id"], "n1")
        self.assertEqual(receipt["sha256"], SHA)
        self.assertNotIn(TOKEN, self.receipt.read_text())
        self.assertEqual(stat.S_IMODE(self.receipt.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.receipt.parent.stat().st_mode), 0o700)
        self.assertTrue(self.src.exists())

    def test_get_hash_mismatch_fails(self):
        with FakeApi(get_hash="0" * 64) as api:
            self.assertEqual(self.run_main(api), 1)
        self.assertFalse(self.receipt.exists())

    def test_get_id_mismatch_fails(self):
        with FakeApi(get_id="other") as api:
            self.assertEqual(self.run_main(api), 1)
        self.assertFalse(self.receipt.exists())

    def test_api_failure_fails(self):
        for status in (401, 500, 503):
            with self.subTest(status=status), FakeApi(post_status=status) as api:
                self.assertEqual(self.run_main(api), 1)
                self.assertFalse(self.receipt.exists())

    def test_source_changed_during_import_fails(self):
        def mutate():
            self.src.write_bytes(SOURCE + b"extra")

        with FakeApi(on_post=mutate) as api:
            self.assertEqual(self.run_main(api), 1)
        self.assertFalse(self.receipt.exists())
        self.assertTrue(self.src.exists())

    def test_preview_cannot_produce_verified_receipt(self):
        with FakeApi(post_result={"ok": True, "saved": False, "dry_run": True, "notice_id": "n1"}) as api:
            self.assertEqual(self.run_main(api), 1)
        self.assertFalse(self.receipt.exists())

    def test_redirect_does_not_forward_credentials(self):
        with FakeApi() as destination, FakeApi(redirect_to=destination.url + "/api/notices/import") as origin:
            self.assertEqual(self.run_main(origin), 1)
            self.assertEqual(destination.posts, [])
        self.assertFalse(self.receipt.exists())

    def test_unrecognized_base_is_rejected_before_credentials(self):
        argv = ["--input", str(self.notice), "--source-file", str(self.src),
                "--note-id", "N", "--item-id", "I", "--base-url", "https://unrecognized.invalid"]
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            import_notice.parse_args(argv)

    def test_missing_token_fails_without_post(self):
        with FakeApi() as api:
            argv = ["--input", str(self.notice), "--source-file", str(self.src),
                    "--note-id", "N", "--item-id", "I", "--base-url", api.url,
                    "--receipt", str(self.receipt)]
            orig = import_notice.find_secrets_token
            import_notice.find_secrets_token = lambda *a: None
            try:
                with contextlib.redirect_stderr(io.StringIO()):
                    code = import_notice.main(argv, env={})
            finally:
                import_notice.find_secrets_token = orig
        self.assertEqual(code, 1)
        self.assertEqual(api.posts, [])


if __name__ == "__main__":
    unittest.main()
