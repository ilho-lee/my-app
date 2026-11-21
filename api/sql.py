"""POST /api/sql  {question, schema}  ->  {sql, tables, conditions, metrics}
AI에는 질문과 테이블 설명(schema.json)만 보낸다. 데이터 행은 받지도 보내지도 않는다."""
import json

try:
    from _common import make_handler
    from _gemini import GeminiError, call_json
except ImportError:  # tools/serve.py 에서 패키지로 불러올 때
    from api._common import make_handler
    from api._gemini import GeminiError, call_json

MAX_Q = 500
MAX_SCHEMA = 60_000  # 바이트. 테이블 설명이 아닌 것이 섞여 오는 것을 막는다

SYSTEM = """당신은 DuckDB SQL 작성자입니다. 사용자의 한국어 질문을 읽고, 주어진 테이블 설명만 근거로 SQL 한 문장을 씁니다.
규칙:
- 가장 중요: «왜/이유/원인» 을 묻는 질문에도 반드시 SQL 을 씁니다. 이유 자체를 SQL 로 단정하려 하지 말고, 이유를 따져 볼 수 있는 숫자(비교 표)를 냅니다. 설명은 다음 단계의 몫입니다.
- SELECT 또는 WITH 로 시작하는 읽기 전용 SQL 한 문장만 씁니다. 세미콜론으로 문장을 나누지 않습니다.
- 테이블 설명에 없는 테이블·컬럼을 쓰지 않습니다.
- 테이블 이름이나 컬럼 이름이 영문·숫자·밑줄이 아니면(한글·공백·점 등) 큰따옴표로 감쌉니다. uploaded 가 true 인 테이블은 사용자가 올린 파일로, 컬럼 뜻이 없으니 컬럼 이름과 타입으로만 판단합니다.
- 지표는 설명의 metrics 정의를 그대로 따릅니다. (예: 출고 매출은 shipments.ship_qty × mall_orders.unit_price 의 합이며 출고일(ship_date) 기준으로 월을 나눕니다. shipments 와 mall_orders 는 order_no + line_no 로 조인합니다.)
- mall_product_name 은 조인 키로 쓰지 않습니다.
- 월 구분은 strftime(날짜, '%Y-%m') 처럼 DuckDB 문법을 씁니다. 기간 조건은 DATE 비교로 씁니다.
- 결과 컬럼 이름은 한국어 별칭으로 붙입니다. 금액은 합계만, 불필요한 상세 행은 내지 않습니다.
- «왜/이유» 를 묻는 질문이라도 거절하지 않습니다. 이유를 숫자로 보여 줄 수 있는 첫 단계(예: 쇼핑몰별 비율 비교)를 SQL 로 씁니다. 이유를 더 쪼개는 일(질문이 말한 «상품별» 같은 기준)은 다음 단계에서 따로 하므로, 첫 SQL 은 쪼개지 말고 비교 대상 전체(예: 모든 쇼핑몰)를 한 표에 냅니다.
- 미출고 수량은 주문 항목(mall_orders)에서 출발해 shipments 를 LEFT JOIN(order_no + line_no)하고 주문 수량 − COALESCE(출고 수량, 0)으로 셉니다. 월은 주문일 기준입니다. «미출고 수량 비율» = 미출고 수량 합 ÷ 주문 수량 합.
- 질문이 주문·출고·정산 데이터로 도저히 답할 수 없을 때만 sql 을 빈 문자열로 두고 note 에 이유를 씁니다.
반드시 아래 JSON 한 개만 돌려줍니다:
{"sql": "...", "tables": ["읽은 테이블 이름"], "conditions": "걸어 둔 조건을 한국어로 한 줄", "metrics": ["사용한 지표 이름(metrics 의 name 그대로)"], "note": ""}"""


def build_user(question, schema):
    return (
        "[테이블 설명]\n"
        + json.dumps(schema, ensure_ascii=False)
        + "\n\n[질문]\n"
        + question
    )


def handle(method, body):
    if method != "POST":
        return 405, {"error": "POST 로 보내 주세요."}
    question = (body.get("question") or "").strip()
    schema = body.get("schema")
    if not question:
        return 400, {"error": "질문을 입력해 주세요."}
    if len(question) > MAX_Q:
        return 400, {"error": f"질문은 {MAX_Q}자 이하로 써 주세요."}
    if not isinstance(schema, dict) or not isinstance(schema.get("tables"), list):
        return 400, {"error": "테이블 설명(schema)이 없습니다."}
    if len(json.dumps(schema, ensure_ascii=False).encode("utf-8")) > MAX_SCHEMA:
        return 400, {"error": "테이블 설명이 너무 큽니다."}
    try:
        out = call_json(SYSTEM, build_user(question, schema))
        if isinstance(out, dict) and not str(out.get("sql") or "").strip():
            # 이유를 묻는 질문에서 AI가 SQL을 거절하는 경우가 있어 한 번 더 요청한다.
            retry = build_user(question, schema) + (
                "\n\n[다시 요청] 방금은 SQL을 쓰지 않았습니다. "
                "이유를 단정하지 말고, 질문의 숫자 부분(비교 표)을 구하는 SQL 을 반드시 쓰세요."
            )
            out = call_json(SYSTEM, retry)
    except GeminiError as e:
        return 502, {"error": str(e)}
    if not isinstance(out, dict):
        return 502, {"error": "AI 응답 형식이 올바르지 않습니다."}
    return 200, {
        "sql": str(out.get("sql") or "").strip(),
        "tables": [str(t) for t in (out.get("tables") or [])][:20],
        "conditions": str(out.get("conditions") or ""),
        "metrics": [str(m) for m in (out.get("metrics") or [])][:20],
        "note": str(out.get("note") or ""),
    }


handler = make_handler(handle)
