"""POST /api/cause  {question, schema, sql, columns, rows}  ->  {sql, value_column, label_columns, title}
원래 결과(최대 50행)를 한 번 더 쪼개는 SQL 하나를 AI에게서 받는다. 실행은 브라우저가 한다."""
import json

try:
    from _common import make_handler
    from _gemini import GeminiError, call_json
except ImportError:
    from api._common import make_handler
    from api._gemini import GeminiError, call_json

MAX_ROWS = 50
MAX_Q = 500
MAX_SQL = 6000
MAX_SCHEMA = 60_000

SYSTEM = """당신은 DuckDB SQL 작성자입니다. 사용자의 질문, 이미 실행한 SQL, 그 결과(최대 50행)를 보고 «원인을 한 단계 더 쪼개는» SQL 하나를 씁니다.
규칙:
- SELECT 또는 WITH 로 시작하는 읽기 전용 SQL 한 문장만 씁니다. 테이블 설명에 없는 테이블·컬럼은 쓰지 않습니다.
- 테이블 이름이나 컬럼 이름이 영문·숫자·밑줄이 아니면(한글·공백·점 등) 큰따옴표로 감쌉니다. uploaded 가 true 인 테이블은 사용자가 올린 파일로, 컬럼 뜻이 없으니 컬럼 이름과 타입으로만 판단합니다.
- 질문이 쪼갤 기준(예: 상품별, 쇼핑몰별, 주문일 구간별)을 말했으면 그 기준을 따릅니다. 말하지 않았으면 결과의 차이를 가장 잘 나눌 기준을 고릅니다. (예: 주문 매출과 출고 매출의 차이 → 쇼핑몰별 · 주문일 구간별)
- 지표는 테이블 설명의 metrics 정의를 따릅니다.
- 쪼갠 결과에는 «합하면 설명하려는 전체가 되는» 수량·금액 컬럼(value_column)이 있어야 합니다. 비율(%)이나 평균은 value_column 이 될 수 없으니, 비율을 설명할 때는 분자가 되는 수량·금액을 value_column 으로 두고 필요하면 비율은 다른 컬럼으로 함께 냅니다.
- 쪼갠 행을 상위 N개로 자르거나 LIMIT 으로 줄이지 않습니다. 전체를 쪼개서 냅니다(합계가 맞아야 비중을 셀 수 있습니다). 정렬은 value_column 내림차순.
- 결과 컬럼 이름은 한국어 별칭으로 붙입니다.
- 쪼갤 수 없으면 sql 을 빈 문자열로 두고 note 에 이유를 씁니다.
반드시 아래 JSON 한 개만 돌려줍니다:
{"sql": "...", "value_column": "쪼갠 SQL 결과에서 합산되는 수량·금액 컬럼의 별칭", "label_columns": ["덩어리를 구분하는 컬럼의 별칭들"], "title": "무엇을 어떻게 쪼갰는지 한 줄", "note": ""}"""


def handle(method, body):
    if method != "POST":
        return 405, {"error": "POST 로 보내 주세요."}
    question = (body.get("question") or "").strip()
    sql = (body.get("sql") or "").strip()
    schema = body.get("schema")
    columns = body.get("columns")
    rows = body.get("rows")
    if not question or not sql:
        return 400, {"error": "질문과 SQL이 필요합니다."}
    if len(question) > MAX_Q or len(sql) > MAX_SQL:
        return 400, {"error": "질문 또는 SQL이 너무 깁니다."}
    if not isinstance(schema, dict) or not isinstance(schema.get("tables"), list):
        return 400, {"error": "테이블 설명(schema)이 없습니다."}
    if len(json.dumps(schema, ensure_ascii=False).encode("utf-8")) > MAX_SCHEMA:
        return 400, {"error": "테이블 설명이 너무 큽니다."}
    if not isinstance(columns, list) or not isinstance(rows, list):
        return 400, {"error": "결과(columns, rows)가 필요합니다."}
    if len(rows) > MAX_ROWS:  # 원본 행이 흘러가지 않게 서버도 막는다
        return 400, {"error": f"결과는 {MAX_ROWS}행 이하만 받습니다."}
    user = (
        "[테이블 설명]\n" + json.dumps(schema, ensure_ascii=False)
        + "\n\n[질문]\n" + question
        + "\n\n[이미 실행한 SQL]\n" + sql
        + "\n\n[그 결과 (최대 50행)]\n" + json.dumps({"columns": columns, "rows": rows}, ensure_ascii=False)
    )
    try:
        out = call_json(SYSTEM, user)
    except GeminiError as e:
        return 502, {"error": str(e)}
    if not isinstance(out, dict):
        return 502, {"error": "AI 응답 형식이 올바르지 않습니다."}
    return 200, {
        "sql": str(out.get("sql") or "").strip(),
        "value_column": str(out.get("value_column") or ""),
        "label_columns": [str(c) for c in (out.get("label_columns") or [])][:6],
        "title": str(out.get("title") or ""),
        "note": str(out.get("note") or ""),
    }


handler = make_handler(handle)
