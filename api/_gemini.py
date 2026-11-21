"""Gemini REST 호출 공통 (urllib만 사용). 키는 환경 변수 GEMINI_API_KEY, 모델은 GEMINI_MODEL."""
import json
import os
import urllib.error
import urllib.request

DEFAULT_MODEL = "gemini-3.5-flash-lite"


class GeminiError(Exception):
    pass


def call_json(system, user, timeout=45):
    """프롬프트를 보내고 JSON 객체 하나를 받아 dict 로 돌려준다."""
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise GeminiError("GEMINI_API_KEY 가 설정되어 있지 않습니다.")
    model = os.environ.get("GEMINI_MODEL") or DEFAULT_MODEL
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            res = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = json.loads(e.read().decode("utf-8")).get("error", {}).get("message", "")
        except Exception:
            pass
        raise GeminiError(f"Gemini 오류 {e.code}: {detail[:200]}")
    except Exception as e:
        raise GeminiError(f"Gemini 호출 실패: {e}")
    try:
        text = res["candidates"][0]["content"]["parts"][0]["text"]
        return json.loads(text)
    except Exception:
        raise GeminiError("Gemini 응답을 JSON으로 읽지 못했습니다.")
