// 「왜」 붙이기: ① 산출 근거 대조, ② 원인 결과에서 가장 큰 덩어리 계산. DOM 을 건드리지 않는 순수 함수만 둔다.

const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));

// SQL 안의 따옴표 값(날짜 · 쇼핑몰 이름 등). 조건 설명을 눈으로 대조하는 데 쓴다.
export function sqlLiterals(sql) {
  const out = [];
  for (const m of sql.matchAll(/'((?:[^']|'')*)'/g)) out.push(m[1].replace(/''/g, "'"));
  return [...new Set(out)];
}

// ① AI가 말한 테이블 · 지표를 실제 SQL 과 대조한다.
// ai: {tables, conditions, metrics}  sqlTables: DuckDB 파서가 뽑은 테이블(없으면 null)
export function checkBasis({ ai, sql, sqlTables, schema, existingTables }) {
  const items = [];
  const aiTables = (ai.tables || []).map(String);

  // 테이블
  if (!sqlTables) {
    items.push({ kind: "tables", ok: false, text: aiTables.join(", ") || "-", note: "SQL에서 읽는 테이블을 뽑지 못했습니다. 직접 확인하세요." });
  } else {
    const missing = sqlTables.filter(t => !aiTables.includes(t));
    const extra = aiTables.filter(t => !sqlTables.includes(t));
    const unknown = sqlTables.filter(t => !existingTables.includes(t));
    const notes = [];
    if (missing.length) notes.push(`SQL이 읽지만 AI 설명에 없음: ${missing.join(", ")}`);
    if (extra.length) notes.push(`AI 설명에 있지만 SQL은 읽지 않음: ${extra.join(", ")}`);
    if (unknown.length) notes.push(`올라와 있지 않은 테이블: ${unknown.join(", ")}`);
    items.push({ kind: "tables", ok: !notes.length, text: sqlTables.join(", "), note: notes.join(" / ") });
  }

  // 조건: AI 설명은 그대로 보여 주고, SQL 에 실제로 쓰인 값을 나란히 둔다.
  items.push({ kind: "conditions", ok: true, text: ai.conditions || "-", literals: sqlLiterals(sql) });

  // 지표 정의: 이름이 데이터 사전의 지표 표에 있어야 하고, 그 지표가 필요로 하는 테이블을 SQL이 읽어야 한다.
  const metrics = [];
  for (const name of ai.metrics || []) {
    const def = schema.metrics.find(m => m.name === name);
    if (!def) { metrics.push({ name, ok: false, note: "데이터 사전에 없는 지표 이름입니다." }); continue; }
    const lacking = sqlTables ? def.tables.filter(t => !sqlTables.includes(t)) : [];
    metrics.push({
      name, ok: !lacking.length, definition: def.definition,
      note: lacking.length ? `이 지표에 필요한 테이블을 SQL이 읽지 않습니다: ${lacking.join(", ")}` : "",
    });
  }
  const allOk = items.every(i => i.ok) && metrics.every(m => m.ok);
  return { items, metrics, allOk };
}

// ② 쪼갠 결과에서 가장 큰 덩어리와 비중을 계산한다. (AI가 아니라 브라우저가 계산한다)
export function biggestChunk({ columns, rows, valueColumn, labelColumns }) {
  const vi = columns.indexOf(valueColumn);
  if (vi < 0) return { error: `쪼갠 결과에 '${valueColumn}' 컬럼이 없습니다.` };
  let total = 0, best = null, n = 0;
  rows.forEach((r, i) => {
    const v = Number(r[vi]);
    if (!Number.isFinite(v)) return;
    n++; total += v;
    if (!best || v > best.value) best = { value: v, index: i };
  });
  if (!best) return { error: `'${valueColumn}' 컬럼에 숫자가 없습니다.` };
  if (total <= 0) return { error: `'${valueColumn}' 의 합이 0 이하라 비중을 셀 수 없습니다.` };
  let li = (labelColumns || []).map(c => columns.indexOf(c)).filter(i => i >= 0 && i !== vi);
  if (!li.length) li = columns.map((_, i) => i).filter(i => i !== vi && typeof rows[best.index][i] === "string");
  const label = li.map(i => String(rows[best.index][i])).join(" · ") || `${best.index + 1}번째 행`;
  return { label, valueColumn, value: best.value, total, share: best.value / total, count: n };
}

// 집계 결과인지(원본 행이 아닌지) 가볍게 가린다. 집계가 아니면 AI에 결과를 보내지 않는다.
export function looksAggregated(sql) {
  const s = sql.replace(/'(?:[^']|'')*'/g, "''");
  return /\b(sum|count|avg|min|max|median|stddev|group\s+by)\b/i.test(s);
}

export const fmt = n => (Number.isInteger(n) ? n.toLocaleString("ko-KR") : n.toLocaleString("ko-KR", { maximumFractionDigits: 4 }));
