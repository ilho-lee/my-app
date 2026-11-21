// 화면 공통 조각: 요소 만들기, 결과 표 그리기
import { fmt } from "./explain.js";

export const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function renderTable(host, res, limit = 200) {
  host.replaceChildren();
  const t = el("table", "data");
  const head = el("tr");
  res.columns.forEach(c => head.append(el("th", null, c)));
  t.append(head);
  res.rows.slice(0, limit).forEach(r => {
    const tr = el("tr");
    r.forEach(v => tr.append(el("td", typeof v === "number" ? "num" : null, typeof v === "number" ? fmt(v) : (v ?? ""))));
    t.append(tr);
  });
  host.append(t);
  const total = res.rowCount ?? res.rows.length;
  if (total > limit) host.append(el("p", "muted", `  ${total.toLocaleString()}행 중 위 ${limit}행만 표시합니다.`));
}
