"""api/ 함수 공통: 요청 처리 함수 하나(fn)의 결과를 HTTP 응답으로 써 준다.
handler 클래스는 Vercel 이 소스에서 직접 찾으므로 각 api/*.py 에 적는다.
tools/serve.py 는 fn(handle)을 직접 불러 쓴다."""
import json


def respond(h, fn, method):
    """h: BaseHTTPRequestHandler. fn(method, body) -> (status, payload)"""

    def send(status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        h.send_response(status)
        h.send_header("Content-Type", "application/json; charset=utf-8")
        h.send_header("Cache-Control", "no-store")
        h.send_header("Content-Length", str(len(data)))
        h.end_headers()
        h.wfile.write(data)

    body = {}
    if method == "POST":
        n = int(h.headers.get("Content-Length") or 0)
        try:
            body = json.loads(h.rfile.read(n) or b"{}")
        except ValueError:
            return send(400, {"error": "요청 본문이 JSON이 아닙니다."})
    status, payload = fn(method, body)
    send(status, payload)
