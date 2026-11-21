// 준비된 질문 탭: presets/questions.json + 내가 저장한 질문(localStorage). 단추 하나로 지금 올라온 데이터로 다시 계산한다.
import { runReadOnly, validateReadOnly, tableEvents } from "./db.js";
import { el, renderTable } from "./ui.js";

const $ = id => document.getElementById(id);
const KEY = "saved_questions_v1";

const loadSchema = (() => { let p; return () => (p ??= fetch("/schema.json", { cache: "no-store" }).then(r => r.json())); })();

// ---- 내가 저장한 질문 (이 브라우저 localStorage)
const readMine = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
const writeMine = list => localStorage.setItem(KEY, JSON.stringify(list));

// 저장 전에 읽기 전용 검사를 같은 함수로 거친다. 통과한 SQL만 남는다.
export async function saveQuestion({ name, question, sql }) {
  if (!name) throw new Error("저장할 이름을 써 주세요.");
  const v = await validateReadOnly(sql);
  const list = readMine();
  const item = { id: "u" + Date.now().toString(36), name, question: question || "", sql: v.sql, tables: v.tables, saved_at: new Date().toISOString() };
  const i = list.findIndex(x => x.name === name); // 같은 이름이면 덮어쓴다
  if (i >= 0) list[i] = { ...item, id: list[i].id }; else list.push(item);
  writeMine(list);
  renderMine();
  return item;
}

function download() {
  const blob = new Blob([JSON.stringify(readMine(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "saved_questions.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---- 카드: 질문 하나
function card(q, schema, { deletable = false } = {}) {
  const c = el("div", "card");
  c.dataset.id = q.id;
  c.append(el("h4", null, q.name));
  if (q.question) c.append(el("p", "q", q.question));

  const defs = (q.metrics || []).map(n => schema.metrics.find(m => m.name === n)).filter(Boolean);
  if (defs.length) {
    const d = el("div", "defs");
    defs.forEach(m => { const p = el("div"); const b = el("b", null, m.name + ": "); p.append(b, document.createTextNode(m.definition)); d.append(p); }); // 사전 원문 그대로
    c.append(d);
  }
  if (q.note) c.append(el("div", "note", q.note));

  const sqlBox = el("details"); sqlBox.append(el("summary", null, "SQL 보기"), el("pre", null, q.sql)); c.append(sqlBox);

  const row = el("div", "row");
  const btn = el("button", null, "다시 계산");
  row.append(btn);
  if (deletable) {
    const del = el("button", "ghost small", "삭제");
    del.addEventListener("click", () => { writeMine(readMine().filter(x => x.id !== q.id)); renderMine(); });
    row.append(del);
  }
  const msg = el("span", "muted"); row.append(msg);
  c.append(row);

  const stat = el("div", "stat"); stat.hidden = true; c.append(stat);
  const tw = el("div", "tablewrap"); tw.hidden = true; c.append(tw);

  btn.addEventListener("click", async () => {
    btn.disabled = true; msg.textContent = "계산 중… (처음엔 데이터를 올리느라 몇 초 걸립니다)";
    try {
      c.classList.remove("stale"); c.querySelector(".stale-note")?.remove();
      const res = await runReadOnly(q.sql); // 실행 전에 같은 읽기 전용 검사
      const n = res.rowCount ?? res.rows.length;
      stat.replaceChildren(
        el("span", null, "계산한 시각 " + new Date().toLocaleString("ko-KR")),
        el("span", null, "행 수 " + n.toLocaleString() + (res.truncated ? " (이상)" : "")),
        el("span", null, "읽은 테이블 " + (res.tables ? res.tables.join(", ") : "확인 못 함")),
      );
      stat.hidden = false; tw.hidden = false;
      renderTable(tw, res);
      msg.textContent = "";
      // 검산용: 행 수 · 첫 행 · 마지막 행의 원본 값
      c.dataset.rowcount = String(n);
      c.dataset.columns = JSON.stringify(res.columns);
      c.dataset.first = JSON.stringify(res.rows[0] ?? null);
      c.dataset.last = JSON.stringify(res.rows[res.rows.length - 1] ?? null);
      c.dataset.state = "done";
    } catch (e) {
      msg.textContent = "계산하지 못했습니다: " + e.message;
      c.dataset.state = "error";
    } finally { btn.disabled = false; }
  });
  return c;
}

async function renderPresets() {
  const host = $("saved-presets");
  try {
    const [list, schema] = await Promise.all([fetch("/presets/questions.json", { cache: "no-store" }).then(r => r.json()), loadSchema()]);
    host.replaceChildren(...list.map(q => card(q, schema)));
  } catch (e) { host.replaceChildren(el("p", "warn", "준비된 질문을 읽지 못했습니다: " + e.message)); }
}

async function renderMine() {
  const host = $("saved-mine");
  const list = readMine();
  $("saved-note").textContent = list.length ? `${list.length}개 저장됨` : "";
  if (!list.length) { host.replaceChildren(el("p", "muted", "아직 없습니다. 묻기 탭의 결과 아래 「이 SQL 저장」으로 남길 수 있습니다.")); return; }
  const schema = await loadSchema();
  host.replaceChildren(...list.map(q => card(q, schema, { deletable: true })));
}

// 올린 파일로 테이블이 바뀌어도 자동으로 다시 계산하지 않는다. 이미 계산한 카드에는 안내만 붙이고, 사용자가 「다시 계산」을 누른다.
tableEvents.addEventListener("changed", () => {
  document.querySelectorAll("#tab-saved .card").forEach(c => {
    if (c.dataset.state !== "done" || c.querySelector(".stale-note")) return;
    c.classList.add("stale");
    c.querySelector(".row").after(el("div", "stale-note", "데이터가 바뀌었습니다. 아래 결과는 이전 데이터 기준입니다 — 「다시 계산」을 눌러 주세요."));
  });
});

$("btn-download").addEventListener("click", download);
renderPresets();
renderMine();
