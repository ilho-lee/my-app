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
// 결과 표 → CSV(엑셀에서 한글이 깨지지 않게 BOM을 붙인다)
function toCsv(res) {
  const cell = v => { if (v == null) return ""; const s = String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return "﻿" + [res.columns, ...res.rows].map(r => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

function downloadCsv(name, res) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([toCsv(res)], { type: "text/csv;charset=utf-8" }));
  a.download = name.replace(/[\\/:*?"<>|]/g, "_") + ".csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

// 카드 하나: 제목 · 연결 테이블 · 산출 공식(사전 원문) · 유의사항 · SQL 보기 · CSV · 다시 계산
function card(q, schema, { deletable = false, index = null } = {}) {
  const c = el("div", "card qcard");
  c.dataset.id = q.id;
  c.dataset.search = [q.name, q.question, (q.metrics || []).join(" "), q.sql].join(" ").toLowerCase();

  const head = el("div", "qhead");
  const title = el("div", "qtitle");
  title.append(el("span", "tag", index != null ? "대사지표 " + String(index + 1).padStart(2, "0") : "저장한 질문"), el("h4", null, q.name));
  head.append(title);
  const tables = q.tables || [];
  if (tables.length) head.append(el("span", "chip", "연결 테이블: " + tables.join(", ")));
  c.append(head);
  if (q.question) c.append(el("p", "q", q.question));

  const defs = (q.metrics || []).map(n => schema.metrics.find(m => m.name === n)).filter(Boolean);
  if (defs.length || q.note) {
    const grid = el("div", "qgrid");
    if (defs.length) {
      const f = el("div", "qbox"); f.append(el("div", "boxtitle", "항목 산출 공식"));
      defs.forEach(m => { const d = el("div", "m"); d.append(el("b", null, m.name), el("div", "def", m.definition)); f.append(d); }); // 사전 원문 그대로
      grid.append(f);
    }
    if (q.note) {
      const n = el("div", "qbox notebox"); n.append(el("div", "boxtitle", "⚠ " + (q.note_title || "유의사항")), el("p", null, q.note));
      grid.append(n);
    }
    c.append(grid);
  }

  const foot = el("div", "qfoot");
  const sqlBox = el("details"); sqlBox.append(el("summary", null, "SQL 보기"), el("pre", null, q.sql));
  const row = el("div", "row");
  const msg = el("span", "muted");
  const csvBtn = el("button", "ghost csv", "결과 내보내기 (CSV)");
  const btn = el("button", "recalc", "◎ 다시 계산");
  if (deletable) {
    const del = el("button", "ghost small", "삭제");
    del.addEventListener("click", () => { writeMine(readMine().filter(x => x.id !== q.id)); renderMine(); });
    row.append(del);
  }
  row.append(msg, csvBtn, btn);
  foot.append(sqlBox, row);
  c.append(foot);

  const stat = el("div", "stat"); stat.hidden = true; c.append(stat);
  const tw = el("div", "tablewrap"); tw.hidden = true; c.append(tw);

  let last = null; // 가장 최근 계산 결과(CSV로 내보낼 것)
  async function calc() {
    btn.disabled = true; msg.textContent = "계산 중… (처음엔 데이터를 올리느라 몇 초 걸립니다)";
    try {
      c.classList.remove("stale"); c.querySelector(".stale-note")?.remove();
      const res = await runReadOnly(q.sql); // 실행 전에 같은 읽기 전용 검사
      last = res;
      const n = res.rowCount ?? res.rows.length;
      const when = new Date().toLocaleString("ko-KR");
      stat.replaceChildren(
        el("span", null, "계산한 시각 " + when),
        el("span", null, "행 수 " + n.toLocaleString() + (res.truncated ? " (이상)" : "")),
        el("span", null, "읽은 테이블 " + (res.tables ? res.tables.join(", ") : "확인 못 함")),
      );
      stat.hidden = false; tw.hidden = false;
      renderTable(tw, res);
      msg.textContent = "";
      $("last-calc").textContent = when;
      // 검산용: 행 수 · 첫 행 · 마지막 행의 원본 값
      c.dataset.rowcount = String(n);
      c.dataset.columns = JSON.stringify(res.columns);
      c.dataset.first = JSON.stringify(res.rows[0] ?? null);
      c.dataset.last = JSON.stringify(res.rows[res.rows.length - 1] ?? null);
      c.dataset.state = "done";
      return res;
    } catch (e) {
      msg.textContent = "계산하지 못했습니다: " + e.message;
      c.dataset.state = "error";
      return null;
    } finally { btn.disabled = false; }
  }
  btn.addEventListener("click", calc);
  csvBtn.addEventListener("click", async () => {
    const res = last || await calc(); // 아직 계산 전이면 먼저 계산한다
    if (res) downloadCsv(q.name, res);
  });
  c.recalc = calc;
  return c;
}

// 위쪽 새로고침 단추: 지금 보이는 질문 카드를 차례로 다시 계산한다.
export async function recalcAll() {
  for (const c of document.querySelectorAll("#tab-saved .qcard")) if (!c.hidden) await c.recalc();
}

// 위쪽 검색: 제목 · 질문 · 지표 · SQL 글자에 들어 있는 카드만 보인다.
export function filterCards(text) {
  const t = text.trim().toLowerCase();
  document.querySelectorAll("#tab-saved .qcard").forEach(c => { c.hidden = !!t && !c.dataset.search.includes(t); });
}

async function renderPresets() {
  const host = $("saved-presets");
  try {
    const [list, schema] = await Promise.all([fetch("/presets/questions.json", { cache: "no-store" }).then(r => r.json()), loadSchema()]);
    host.replaceChildren(...list.map((q, i) => card(q, schema, { index: i })));
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
    c.querySelector(".qfoot").after(el("div", "stale-note", "데이터가 바뀌었습니다. 아래 결과는 이전 데이터 기준입니다 — 「다시 계산」을 눌러 주세요."));
  });
});

$("btn-download").addEventListener("click", download);
renderPresets();
renderMine();
