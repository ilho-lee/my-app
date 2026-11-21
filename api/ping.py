import os

try:
    from _common import make_handler
except ImportError:  # tools/serve.py 에서 패키지로 불러올 때
    from api._common import make_handler


def handle(method, body):
    # 키 값은 절대 돌려주지 않고 설정 여부만 알려 준다.
    return 200, {
        "ok": True,
        "key_set": bool(os.environ.get("GEMINI_API_KEY")),
        "model": os.environ.get("GEMINI_MODEL") or "gemini-3.5-flash-lite",
    }


handler = make_handler(handle)
