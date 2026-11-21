// 묻기 탭: 질문 → /api/sql → 검사 → 실행 → ① 산출 근거 → ② 원인 한 단계
import { checkSql } from "./guard.js";
import { runReadOnly, listTables, openDb } from "./db.js";
import { checkBasis, biggestChunk, looksAggregated, fmt } from "./explain.js";
import { el, renderTable } from "./ui.js";
import { saveQuestion } from "./saved.js";
import { getSchemaForAi } from "./schema_state.js";

const $ = id => document.getElementById(id);
const MAX_SEND = 50; // AI 에 보내는 결과 행 수 상한
const SHOW_ROWS = 200;
let last = null; // 저장 단추가 쓰는, 가장 최근에 성공한 질문과 SQL

function showVerdict(node, v) {
  node.textContent = v.ok ? "✔ 검사 통과 — 읽기(SELECT · WITH) 한 문장입니다." : "✘ 막았습니다: " + v.reason;
  node.className = "verdict " + (v.ok ? "ok" : "bad");
}

function setBadge(id, ok, text) { const b = $(id); b.textContent = text; b.className = "badge " + (ok ? "ok" : "warn"); }

// ① 산출 근거
function renderBasis(basis, schema) {
  const host = $("ask-basis");
  host.replaceChildren();
  const ul = el("ul", "basis");
  const labels = { tables: "읽은 테이블", conditions: "조건" };
  for (const it of basis.items) {
    const li = el("li");
    li.append(el("span", "k", labels[it.kind]));
    li.append(el("span", null, it.text));
    if (it.kind === "conditions") {
      li.append(el("span", "muted", "  (AI 설명 — 자동 대조 불가)"));
      if (it.literals.length) li.append(el("div", "def", "SQL에 쓰인 값: " + it.literals.join(" · ")));
    }
    if (!it.ok) li.append(el("div", "warn", "⚠ 확인 필요 — " + it.note));
    ul.append(li);
  }
  if (!basis.metrics.length) {
    const li = el("li"); li.append(el("span", "k", "쓴 지표")); li.append(el("span", "muted", "데이터 사전의 지표 정의를 쓰지 않았다고 AI가 답했습니다.")); ul.append(li);
  }
  for (const m of basis.metrics) {
    const li = el("li");
    li.append(el("span", "k", "쓴 지표"));
    li.append(el("span", null, m.name));
    if (m.definition) li.append(el("div", "def", "데이터 사전: " + m.definition)); // 사전 원문 그대로
    if (!m.ok) li.append(el("div", "warn", "⚠ 확인 필요 — " + m.note));
    ul.append(li);
  }
  host.append(ul);
  setBadge("basis-badge", basis.allOk, basis.allOk ? "대조 통과" : "확인 필요");
}

// ② 원인 한 단계. 실패해도 ①과 원래 결과는 그대로 둔다.
async function runCause({ question, schema, sql, res }) {
  const host = $("ask-cause");
  host.replaceChildren(el("p", "muted", "원인을 쪼개는 중…"));
  setBadge("cause-badge", true, "");
  try {
    if (!looksAggregated(sql)) {
      host.replaceChildren(el("p", "muted", "집계 결과가 아니라서(원본 행일 수 있어) AI에 결과를 보내지 않았습니다. 원인 쪼개기를 건너뜁니다."));
      return;
    }
    const sent = { columns: res.columns, rows: res.rows.slice(0, MAX_SEND) };
    $("ask-sent-body").textContent += `\n\n[원인 쪼개기 요청] 질문 + 실행한 SQL + 결과 ${sent.rows.length}행(최대 ${MAX_SEND}행)` +
      (res.rows.length > MAX_SEND ? ` — 전체 ${res.rows.length.toLocaleString()}행 중 앞부분만` : "") + "\n" + JSON.stringify(sent);
    const r = await fetch("/api/cause", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, schema, sql, ...sent }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "서버 오류");
    if (!j.sql) throw new Error("AI가 쪼개는 SQL을 쓰지 못했습니다. " + (j.note || ""));

    const cres = await runReadOnly(j.sql); // 같은 읽기 전용 검사
    host.replaceChildren();
    if (j.title) host.append(el("p", null, j.title));
    const det = el("details"); det.append(el("summary", null, "원인 SQL 보기")); det.append(el("pre", null, cres.sql)); host.append(det);
    const tw = el("div", "tablewrap"); renderTable(tw, cres, MAX_SEND); host.append(tw);

    const big = biggestChunk({ columns: cres.columns, rows: cres.rows, valueColumn: j.value_column, labelColumns: j.label_columns });
    if (big.error) {
      host.append(el("p", "warn", "가장 큰 덩어리를 계산하지 못했습니다: " + big.error));
      setBadge("cause-badge", false, "확인 필요");
    } else {
      host.append(el("div", "chunk",
        `가장 큰 덩어리: ${big.label} — ${big.valueColumn} ${fmt(big.value)} (전체 ${fmt(big.total)} 중 ${(big.share * 100).toFixed(1)}%)`));
      host.append(el("p", "muted", "이 숫자는 AI가 아니라 위 표에서 브라우저가 계산했습니다."));
      setBadge("cause-badge", true, "계산 완료");
      host.dataset.biggest = JSON.stringify({ label: big.label, value: big.value, total: big.total, share: big.share });
    }
  } catch (e) {
    host.replaceChildren(el("p", "warn", "원인 쪼개기에 실패했습니다: " + e.message + " (위 결과와 ① 산출 근거는 그대로입니다)"));
    setBadge("cause-badge", false, "실패");
  } finally {
    $("ask-result").dataset.state = "done";
  }
}

async function ask() {
  const question = $("q").value.trim();
  const msg = $("ask-msg");
  if (!question) { msg.textContent = "질문을 써 주세요."; return; }
  $("btn-ask").disabled = true;
  $("ask-result").hidden = true;
  $("ask-result").dataset.state = "";
  $("ask-cause").dataset.biggest = "";
  try {
    msg.textContent = "SQL을 만드는 중…";
    await openDb();
    const schema = await getSchemaForAi(); // schema.json + 지금 올라와 있는 테이블(올린 파일은 이름 · 컬럼 · 타입 · 행 수만)
    // AI에 가는 것은 질문과 테이블 설명(schema.json)뿐이다. 데이터 행은 없다.
    $("ask-sent-body").textContent =
      `[SQL 만들기 요청] 질문: ${question}\n테이블 설명(schema.json): 테이블 ${schema.tables.length}개 — ` +
      schema.tables.map(t => `${t.name}(${t.rows.toLocaleString()}행${t.uploaded ? ", 내 파일: 컬럼 이름·타입만" : ""})`).join(", ") +
      `, 지표 정의 ${schema.metrics.length}개, 회사 규칙 ${schema.rules.length}개. 데이터 행: 없음`;
    const r = await fetch("/api/sql", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, schema }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "서버 오류");
    $("ask-result").hidden = false;
    $("ask-sql").textContent = j.sql || "(SQL 없음)";
    if (!j.sql) throw new Error("AI가 SQL을 쓰지 못했습니다. " + (j.note || ""));
    const g = checkSql(j.sql);
    showVerdict($("ask-guard"), g);
    if (!g.ok) { msg.textContent = ""; return; }

    msg.textContent = "브라우저에서 실행하는 중… (처음엔 데이터를 올리느라 몇 초 걸립니다)";
    const res = await runReadOnly(j.sql);
    msg.textContent = "";
    renderTable($("ask-table"), res, SHOW_ROWS);
    last = { question, sql: res.sql, tables: res.tables };
    $("save-msg").textContent = ""; $("save-name").value = question.slice(0, 40);

    const existing = await listTables();
    renderBasis(checkBasis({ ai: j, sql: res.sql, sqlTables: res.tables, schema, existingTables: existing }), schema);

    await runCause({ question, schema, sql: res.sql, res });
  } catch (e) {
    msg.textContent = "오류: " + e.message;
    $("ask-result").dataset.state = "error";
  } finally {
    $("btn-ask").disabled = false;
  }
}

$("btn-ask").addEventListener("click", ask);
$("btn-save").addEventListener("click", async () => {
  const msg = $("save-msg");
  if (!last) { msg.textContent = "저장할 SQL이 없습니다."; return; }
  try {
    await saveQuestion({ name: $("save-name").value.trim(), question: last.question, sql: last.sql }); // 저장 전에 읽기 전용 검사
    msg.textContent = "저장했습니다. 「준비된 질문」 탭에서 볼 수 있습니다.";
  } catch (e) { msg.textContent = "저장하지 못했습니다: " + e.message; }
});
$("btn-check").addEventListener("click", () => { $("my-result").hidden = true; showVerdict($("my-guard"), checkSql($("mysql").value)); });

// 직접 쓴 SQL 실행: 같은 검사(guard + DuckDB 구문 확인)를 통과해야 돈다.
$("btn-run").addEventListener("click", async () => {
  const sql = $("mysql").value;
  const v = checkSql(sql);
  showVerdict($("my-guard"), v);
  const box = $("my-result");
  box.hidden = true;
  if (!v.ok) return;
  const btn = $("btn-run");
  btn.disabled = true;
  try {
    await openDb();
    const t0 = performance.now();
    const res = await runReadOnly(sql);
    const sec = ((performance.now() - t0) / 1000).toFixed(2);
    const shown = Math.min(res.rows.length, SHOW_ROWS);
    $("my-stat").textContent = `${res.rows.length.toLocaleString()}행 · ${sec}초` + (res.rows.length > shown ? ` (앞 ${shown}행만 표시)` : "");
    renderTable($("my-table"), res, SHOW_ROWS);
    box.hidden = false;
  } catch (e) {
    $("my-guard").textContent = "✘ 실행하지 못했습니다: " + e.message;
    $("my-guard").className = "verdict bad";
  } finally {
    btn.disabled = false;
  }
});

// 주소에 ?q=질문 이 있으면 채워서 바로 실행한다. (같은 질문을 다시 확인할 때 편함)
const preset = new URLSearchParams(location.search).get("q");
if (preset) { $("q").value = preset; document.querySelector('#tabs button[data-tab="ask"]').click(); ask(); }
