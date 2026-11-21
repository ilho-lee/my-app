// 테이블 탭: 올라와 있는 테이블의 이름 · 컬럼 이름 · 타입 · 행 수 (올린 파일 포함)
import { describeTables, runReadOnly, tableEvents, openDb, quoteIdent } from "./db.js";
import { loadBaseSchema } from "./schema_state.js";
import { el, renderTable } from "./ui.js";
import { fmt } from "./explain.js";

const $ = id => document.getElementById(id);

async function render() {
  const host = $("tables-list");
  host.replaceChildren(el("p", "muted", "테이블을 읽는 중…"));
  try {
    await openDb();
    const [live, base] = await Promise.all([describeTables(), loadBaseSchema()]);
    const baseNames = new Set(base.tables.map(t => t.name));
    host.replaceChildren(...live.map(t => {
      const b = base.tables.find(x => x.name === t.name);
      const sameCols = b && b.columns.length === t.columns.length && b.columns.every((c, i) => c.name === t.columns[i].name);
      const card = el("div", "card");
      card.dataset.name = t.name; card.dataset.rows = String(t.rows);
      const h = el("h4", null, t.name);
      h.append(el("span", "badge " + (baseNames.has(t.name) ? "ok" : "warn"), baseNames.has(t.name) ? "기본 데이터" : "내 파일"));
      card.append(h);
      card.append(el("p", "stat", `행 수 ${fmt(t.rows)} · 컬럼 ${t.columns.length}개` + (b ? ` · 한 행 = ${b.grain}` : "")));
      const tb = el("table", "data");
      const head = el("tr"); ["컬럼", "타입", "뜻"].forEach(x => head.append(el("th", null, x))); tb.append(head);
      t.columns.forEach((c, i) => {
        const tr = el("tr");
        tr.append(el("td", null, c.name), el("td", null, c.type), el("td", null, sameCols ? b.columns[i].meaning : ""));
        tb.append(tr);
      });
      const tw = el("div", "tablewrap"); tw.append(tb); card.append(tw);

      const det = el("details"); det.append(el("summary", null, "처음 5행"));
      const pre = el("div", "tablewrap");
      det.append(pre);
      det.addEventListener("toggle", async () => {
        if (!det.open || pre.dataset.done) return;
        pre.dataset.done = "1";
        try { renderTable(pre, await runReadOnly(`SELECT * FROM ${quoteIdent(t.name)} LIMIT 5`), 5); }
        catch (e) { pre.textContent = "읽지 못했습니다: " + e.message; }
      });
      card.append(det);
      return card;
    }));
    host.dataset.state = "done";
  } catch (e) { host.replaceChildren(el("p", "warn", "테이블을 읽지 못했습니다: " + e.message)); }
}

tableEvents.addEventListener("changed", render);
render();
