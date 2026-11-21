"""api/ 함수 공통: 요청 처리 함수 하나(fn)를 Vercel용 handler 클래스로 감싼다.
tools/serve.py 도 같은 fn 을 직접 불러 쓴다."""
import json
from http.server import BaseHTTPRequestHandler


def make_handler(fn):
    """fn(method: str, body: dict) -> (status: int, payload: dict)"""

    class handler(BaseHTTPRequestHandler):
        def _send(self, status, payload):
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _run(self, method):
            body = {}
            if method == "POST":
                n = int(self.headers.get("Content-Length") or 0)
                try:
                    body = json.loads(self.rfile.read(n) or b"{}")
                except ValueError:
                    return self._send(400, {"error": "요청 본문이 JSON이 아닙니다."})
            status, payload = fn(method, body)
            self._send(status, payload)

        def do_GET(self):
            self._run("GET")

        def do_POST(self):
            self._run("POST")

    return handler
