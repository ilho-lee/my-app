"""내 PC용 개발 서버: 화면(정적 파일)과 /api/* 를 한 포트로 제공한다.
사용: python tools/serve.py [포트]   (기본 8780)  — 키는 프로젝트 루트 .env 에서 읽는다."""
import importlib
import json
import mimetypes
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "api"))  # Vercel 처럼 `from _common import ...` 가 되게

# 정적 파일로 내보내지 않을 것
BLOCKED = {".env", ".git", "tools", "api", ".vercel"}


def load_env():
    f = ROOT / ".env"
    if not f.exists():
        return
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("[serve] " + (fmt % args) + "\n")

    def _json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _api(self, method, name):
        if not name.isidentifier() or name.startswith("_"):
            return self._json(404, {"error": "없는 API 입니다."})
        try:
            mod = importlib.import_module(f"api.{name}")
            importlib.reload(mod)  # 개발 서버: 파일을 고치면 서버를 다시 띄우지 않아도 반영
        except ModuleNotFoundError:
            return self._json(404, {"error": "없는 API 입니다."})
        except Exception as e:
            return self._json(500, {"error": f"API 불러오기 실패: {e}"})
        body = {}
        if method == "POST":
            n = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                return self._json(400, {"error": "요청 본문이 JSON이 아닙니다."})
        try:
            status, payload = mod.handle(method, body)
        except Exception as e:  # 개발 서버: 화면에 원인을 보여 준다
            return self._json(500, {"error": f"서버 오류: {e}"})
        self._json(status, payload)

    def _static(self):
        path = unquote(urlparse(self.path).path)
        if path.endswith("/"):
            path += "index.html"
        rel = Path(path.lstrip("/"))
        target = (ROOT / rel).resolve()
        if ROOT not in target.parents and target != ROOT:
            return self._json(403, {"error": "접근할 수 없습니다."})
        if rel.parts and rel.parts[0] in BLOCKED:
            return self._json(404, {"error": "없는 파일입니다."})
        if not target.is_file():
            return self._json(404, {"error": "없는 파일입니다."})
        data = target.read_bytes()
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        p = urlparse(self.path).path
        if p.startswith("/api/"):
            return self._api("GET", p[5:].strip("/"))
        self._static()

    def do_POST(self):
        p = urlparse(self.path).path
        if p.startswith("/api/"):
            return self._api("POST", p[5:].strip("/"))
        self._json(405, {"error": "허용되지 않는 요청입니다."})


if __name__ == "__main__":
    load_env()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8780
    print(f"http://localhost:{port}  (Ctrl+C 로 종료)")
    print("AI 키:", "설정됨" if os.environ.get("GEMINI_API_KEY") else "없음(.env 확인)")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
