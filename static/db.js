// DuckDB-WASM: 브라우저 안에서 data/ CSV를 읽고 SQL을 실행한다. 데이터는 이 브라우저를 벗어나지 않는다.
import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm";
import { checkSql, setKnownTables } from "./guard.js";

const BASE_TABLES = ["products", "set_components", "mall_orders", "shipments", "mall_settlements"];
export const MAX_ROWS = 10000; // 한 번에 메모리로 가져올 최대 행 수

// 테이블이 바뀌면(올림 · 교체) 'changed' 를 알린다. 테이블 탭 · 준비된 질문 탭이 듣는다.
export const tableEvents = new EventTarget();
export const quoteIdent = n => '"' + String(n).replace(/"/g, '""') + '"';

let ready = null;
let db = null, conn = null;

export function openDb() {
  return (ready ??= (async () => {
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    const workerUrl = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }));
    db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), new Worker(workerUrl));
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);
    conn = await db.connect();
    for (const t of BASE_TABLES) {
      const text = await (await fetch(`/data/${t}.csv`, { cache: "no-store" })).text();
      await db.registerFileText(`${t}.csv`, text);
      await conn.query(`CREATE OR REPLACE TABLE ${t} AS SELECT * FROM read_csv_auto('${t}.csv')`);
    }
    setKnownTables(BASE_TABLES);
    return true;
  })());
}

function cell(v, typeStr) {
  if (typeof v === "bigint") return Number(v);
  if (typeStr.startsWith("Date") && typeof v === "number") return new Date(v).toISOString().slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // SUM() 등이 돌려주는 큰 정수/DECIMAL 은 객체로 오므로 숫자 모양이면 숫자로 바꾼다
  if (v && typeof v === "object") { const s = String(v); if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s); }
  return v;
}

// 검사를 거치지 않는 내부 실행. 밖에서는 runReadOnly 만 쓴다.
async function query(sql) {
  await openDb();
  const res = await conn.query(sql);
  const fields = res.schema.fields;
  const columns = fields.map(f => f.name);
  const types = fields.map(f => String(f.type));
  const rows = [];
  let truncated = false;
  for (const r of res.toArray()) {
    if (rows.length >= MAX_ROWS) { truncated = true; break; }
    const o = r.toJSON();
    rows.push(columns.map((c, i) => cell(o[c], types[i])));
  }
  return { columns, types, rows, truncated, rowCount: res.numRows };
}

export async function listTables() {
  const r = await query("SELECT table_name FROM information_schema.tables WHERE table_schema='main' ORDER BY 1");
  return r.rows.map(x => x[0]);
}

// SQL 안에서 읽는 테이블(CTE 이름 제외)을 DuckDB 파서로 뽑는다. SELECT 가 아니면 error.
export async function parseSql(sql) {
  await openDb();
  const lit = "'" + sql.replace(/'/g, "''") + "'";
  const r = await query(`SELECT json_serialize_sql(${lit}) AS j`);
  let ast;
  try { ast = JSON.parse(r.rows[0][0]); } catch { return { unknown: true }; }
  if (ast.error) {
    if (/Only SELECT/i.test(ast.error_message || "")) return { error: "SELECT 구문이 아닙니다." };
    return { unknown: true, message: ast.error_message }; // 직렬화 미지원 구문: JS 검사에 맡긴다
  }
  const tables = new Set(), ctes = new Set();
  (function walk(o) {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === "object") {
      if (o.type === "BASE_TABLE" && o.table_name) tables.add(o.table_name);
      if (o.cte_map && Array.isArray(o.cte_map.map)) o.cte_map.map.forEach(e => ctes.add(e.key));
      Object.values(o).forEach(walk);
    }
  })(ast);
  return { tables: [...tables].filter(t => !ctes.has(t)) };
}

// 모든 SQL(AI가 쓴 것 · 내가 쓴 것 · 준비된 것 · 원인 SQL)은 여기서 같은 검사를 거친다.
// 실행 없이 검사만 한다(저장할 때 사용). 통과하면 {sql, tables}, 아니면 Error.
export async function validateReadOnly(sql) {
  const g = checkSql(sql);
  if (!g.ok) throw new Error(g.reason);
  const p = await parseSql(g.sql);
  if (p.error) throw new Error(p.error);
  return { sql: g.sql, tables: p.tables || null };
}

export async function runReadOnly(sql) {
  const v = await validateReadOnly(sql);
  const out = await query(v.sql);
  out.sql = v.sql;
  out.tables = v.tables;
  return out;
}

// ---- 테이블 정보 (이름 · 컬럼 이름 · 타입 · 행 수)
export async function describeTables() {
  const cols = await query("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='main' ORDER BY table_name, ordinal_position");
  const byTable = new Map();
  for (const [t, c, ty] of cols.rows) { if (!byTable.has(t)) byTable.set(t, []); byTable.get(t).push({ name: c, type: ty }); }
  const out = [];
  for (const [name, columns] of byTable) {
    const n = (await query(`SELECT count(*) FROM ${quoteIdent(name)}`)).rows[0][0];
    out.push({ name, rows: Number(n), columns });
  }
  return out;
}

async function afterChange() {
  setKnownTables(await listTables());
  tableEvents.dispatchEvent(new Event("changed"));
}

// ---- 올린 파일을 테이블로 (같은 이름이면 바꾼다). 데이터는 이 브라우저 안에서만 쓰인다.
async function replaceFrom(name, fileName, registerFn, selectSql) {
  await openDb();
  const existed = (await listTables()).includes(name);
  const before = existed ? (await query(`SELECT count(*) FROM ${quoteIdent(name)}`)).rows[0][0] : null;
  await registerFn(fileName);
  try {
    await conn.query(`CREATE OR REPLACE TABLE ${quoteIdent(name)} AS ${selectSql}`);
  } finally {
    try { await db.dropFile(fileName); } catch {}
  }
  const tableRows = Number((await query(`SELECT count(*) FROM ${quoteIdent(name)}`)).rows[0][0]);
  const columns = (await describeTables()).find(t => t.name === name).columns;
  await afterChange();
  return { existed, before: before == null ? null : Number(before), tableRows, columns };
}

const lit = s => "'" + String(s).replace(/'/g, "''") + "'";
let seq = 0;

// CSV: 첫 줄이 컬럼 이름. colNames 는 공백을 밑줄로 바꾼 이름들(upload.js 가 정한다).
export function replaceTableFromCsv(name, text, colNames) {
  const f = `upload_${Date.now()}_${seq++}.csv`;
  return replaceFrom(name, f, x => db.registerFileText(x, text),
    `SELECT * FROM read_csv(${lit(f)}, header=true, delim=',', names=[${colNames.map(lit).join(",")}], sample_size=-1)`);
}

// xlsx: 읽은 행(객체 배열)을 JSON 으로 올린다.
export function replaceTableFromObjects(name, objects) {
  const f = `upload_${Date.now()}_${seq++}.json`;
  return replaceFrom(name, f, x => db.registerFileText(x, JSON.stringify(objects)),
    `SELECT * FROM read_json(${lit(f)}, format='array', auto_detect=true, sample_size=-1)`);
}
