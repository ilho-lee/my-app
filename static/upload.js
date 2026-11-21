// 내 파일 탭: CSV(UTF-8, BOM 무시) · xlsx(첫 시트, 첫 행이 컬럼 이름)를 읽어 테이블로 올린다.
// 파일은 이 브라우저 안에서만 읽는다. 어디로도 보내지 않는다.
import { replaceTableFromCsv, replaceTableFromObjects, runReadOnly } from "./db.js";
import { el, renderTable } from "./ui.js";
import { fmt } from "./explain.js";

const $ = id => document.getElementById(id);
const SHEETJS = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs"; // 버전 고정, xlsx 를 올릴 때만 불러온다

// ---- CSV 를 직접 읽어 «파일에서 읽은 행 수» 를 센다 (DuckDB 와 따로 세어 서로 대조하기 위함)
function parseCsv(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"' && f === "") q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(f); f = ""; rows.push(row); row = [];
    } else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0].trim() === "")); // 빈 줄은 행이 아니다
}

// 컬럼 이름: 앞뒤 공백 제거 → 안의 공백은 밑줄 → 비면 col_N → 겹치면 _2, _3
function cleanColumns(rawNames) {
  const used = new Set(), names = [], notes = [];
  rawNames.forEach((r, i) => {
    const orig = String(r ?? "");
    let n = orig.trim().replace(/\s+/g, "_");
    if (!n) n = `col_${i + 1}`;
    let u = n, k = 2;
    while (used.has(u.toLowerCase())) u = `${n}_${k++}`;
    used.add(u.toLowerCase());
    names.push(u);
    if (u !== orig) notes.push(`${orig === "" ? "(빈 이름)" : `「${orig}」`} → ${u}`);
  });
  return { names, notes };
}

function toDateString(d) {
  const p = n => String(n).padStart(2, "0");
  const ymd = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return d.getHours() || d.getMinutes() || d.getSeconds() ? `${ymd} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` : ymd;
}

async function readCsv(file) {
  const buf = await file.arrayBuffer();
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch { throw new Error("UTF-8 파일이 아닙니다. 엑셀에서 「CSV UTF-8」로 다시 저장해 올려 주세요."); }
  text = text.replace(/^﻿/, ""); // 앞의 BOM 은 무시
  const recs = parseCsv(text);
  if (!recs.length) throw new Error("파일이 비어 있습니다.");
  const width = recs[0].length;
  const { names, notes } = cleanColumns(recs[0]);
  return { kind: "csv", text, names, notes, fileRows: recs.length - 1, width };
}

async function readXlsx(file) {
  const XLSX = await import(SHEETJS);
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("시트가 없습니다.");
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
  if (!aoa.length) throw new Error("첫 시트가 비어 있습니다.");
  let width = aoa[0].length;
  while (width > 0 && (aoa[0][width - 1] == null || String(aoa[0][width - 1]).trim() === "")) width--; // 뒤쪽 빈 컬럼은 버린다
  if (!width) throw new Error("첫 행에 컬럼 이름이 없습니다.");
  const { names, notes } = cleanColumns(aoa[0].slice(0, width));
  const dataRows = aoa.slice(1).filter(r => r.slice(0, width).some(v => v != null && String(v).trim() !== ""));
  const objects = dataRows.map(r => {
    const o = {};
    names.forEach((n, i) => {
      let v = r[i] ?? null;
      if (v instanceof Date) v = toDateString(v);
      else if (typeof v === "string" && v.trim() === "") v = null;
      o[n] = v;
    });
    return o;
  });
  return { kind: "xlsx", objects, names, notes, fileRows: objects.length, sheet: wb.SheetNames[0], sheets: wb.SheetNames.length };
}

// ---- 한 파일 처리
async function handleFile(file) {
  const m = file.name.match(/^(.*)\.(csv|xlsx)$/i);
  const card = el("div", "card");
  card.append(el("h4", null, file.name));
  $("upload-results").prepend(card);
  const msg = el("p", "muted", "읽는 중…");
  card.append(msg);
  try {
    if (!m) throw new Error("CSV(.csv) 또는 엑셀(.xlsx) 파일만 올릴 수 있습니다.");
    const name = m[1].trim();
    if (!name) throw new Error("파일 이름이 비어 있습니다.");
    const parsed = m[2].toLowerCase() === "csv" ? await readCsv(file) : await readXlsx(file);
    msg.textContent = "테이블로 올리는 중…";
    const up = parsed.kind === "csv"
      ? await replaceTableFromCsv(name, parsed.text, parsed.names)
      : await replaceTableFromObjects(name, parsed.objects);

    card.replaceChildren(el("h4", null, `${file.name} → 테이블 ${name}`));
    if (up.existed) card.append(el("p", "note", `같은 이름의 테이블이 있어 새 파일로 바꿨습니다. (이전 ${up.before.toLocaleString()}행 → 지금 ${up.tableRows.toLocaleString()}행)`));
    else card.append(el("p", "muted", "새 테이블을 만들었습니다."));
    if (parsed.kind === "xlsx" && parsed.sheets > 1) card.append(el("p", "muted", `시트가 ${parsed.sheets}개라 첫 시트(${parsed.sheet})만 읽었습니다.`));
    if (parsed.notes.length) card.append(el("p", "note", "컬럼 이름을 바꿨습니다: " + parsed.notes.join(", ")));

    const same = parsed.fileRows === up.tableRows;
    const cmp = el("div", "cmp " + (same ? "ok" : "bad"));
    cmp.textContent = `파일에서 읽은 행 수 ${fmt(parsed.fileRows)}  |  테이블에 올라간 행 수 ${fmt(up.tableRows)}  ${same ? "✓" : "✕"}`;
    card.append(cmp);
    if (!same) card.append(el("p", "warn", "행 수가 다릅니다. 파일에 줄바꿈이 섞인 칸이나 짝이 맞지 않는 줄이 있는지 확인해 주세요."));

    card.append(el("p", "muted", "컬럼: " + up.columns.map(c => `${c.name} (${c.type})`).join(", ")));
    const prev = await runReadOnly(`SELECT * FROM "${name.replace(/"/g, '""')}" LIMIT 20`);
    card.append(el("p", "muted", "처음 20행 미리보기"));
    const tw = el("div", "tablewrap"); renderTable(tw, prev, 20); card.append(tw);
    card.dataset.state = "done"; card.dataset.fileRows = String(parsed.fileRows); card.dataset.tableRows = String(up.tableRows);
  } catch (e) {
    card.replaceChildren(el("h4", null, file.name), el("p", "warn", "올리지 못했습니다: " + e.message));
    card.dataset.state = "error";
  }
}

async function handleFiles(files) {
  for (const f of [...files]) await handleFile(f); // 차례로 처리한다
}

const zone = $("dropzone"), input = $("file-input");
zone.addEventListener("click", () => input.click());
zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("over"); });
zone.addEventListener("dragleave", () => zone.classList.remove("over"));
zone.addEventListener("drop", e => { e.preventDefault(); zone.classList.remove("over"); handleFiles(e.dataTransfer.files); });
input.addEventListener("change", () => { handleFiles(input.files); input.value = ""; });
