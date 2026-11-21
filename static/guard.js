// SQL 검사: 실행 전에 AI가 쓴 SQL · 내가 쓴 SQL · 준비된 SQL 모두 이 함수 하나를 통과한다.
// 읽기(SELECT · WITH) 한 문장만 허용한다. 통과해도 DuckDB 쪽 이중 확인은 2단계에서 붙인다.

// 문자열 · 주석을 비워서 금지어 검사가 문자열 안의 단어에 속지 않게 한다.
function stripLiteralsAndComments(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i], n = sql[i + 1];
    if (c === "-" && n === "-") { while (i < sql.length && sql[i] !== "\n") i++; out += " "; continue; }
    if (c === "/" && n === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) return null; // 닫히지 않은 주석
      i = end + 2; out += " "; continue;
    }
    if (c === "'" || c === '"') {
      const q = c; i++;
      while (i < sql.length) {
        if (sql[i] === q) { if (sql[i + 1] === q) { i += 2; continue; } break; }
        i++;
      }
      if (i >= sql.length) return null; // 닫히지 않은 따옴표
      i++; out += q === "'" ? " '' " : ' "" ';
      continue;
    }
    out += c; i++;
  }
  return out;
}

// 데이터를 바꾸거나, 파일 · 네트워크 · 확장 기능에 닿는 것들
// (SET · CALL · LOAD · SHOW 같은 단어는 별칭으로 쓰일 수 있어 여기 넣지 않는다 — 첫 단어 검사에서 이미 막힌다)
const FORBIDDEN = [
  "insert", "update", "delete", "drop", "create", "alter", "truncate", "merge", "upsert",
  "copy", "attach", "detach", "install", "pragma", "vacuum", "checkpoint", "grant", "revoke",
  "read_csv", "read_csv_auto", "read_json", "read_json_auto", "read_ndjson", "read_parquet", "read_text", "read_blob",
  "parquet_scan", "parquet_metadata", "csv_scan", "glob", "sniff_csv", "http_get", "httpfs", "read_xlsx",
  "duckdb_settings", "getenv", "current_setting",
];

// 올라와 있는 테이블 이름. 이름이 파일처럼 보여도("2024.07") 실제 테이블이면 막지 않는다.
let known = new Set();
export function setKnownTables(names) { known = new Set(names); }

export function checkSql(sql) {
  const raw = String(sql ?? "");
  if (!raw.trim()) return { ok: false, reason: "SQL이 비어 있습니다." };
  const s = stripLiteralsAndComments(raw);
  if (s === null) return { ok: false, reason: "닫히지 않은 따옴표 또는 주석이 있습니다." };
  let body = s.trim().replace(/;+\s*$/, "").trim();
  if (body.includes(";")) return { ok: false, reason: "한 번에 한 문장만 실행할 수 있습니다." };
  const first = (body.match(/^[a-zA-Z_]+/) || [""])[0].toLowerCase();
  if (first !== "select" && first !== "with")
    return { ok: false, reason: `읽기(SELECT · WITH)만 실행할 수 있습니다. (${first ? first.toUpperCase() : "알 수 없는 문장"} 은(는) 막았습니다)` };
  const words = body.toLowerCase().match(/[a-z_][a-z0-9_]*/g) || [];
  for (const w of words) {
    if (FORBIDDEN.includes(w)) return { ok: false, reason: `허용하지 않는 키워드입니다: ${w.toUpperCase()}` };
  }
  // 파일 경로 · 주소를 테이블처럼 읽는 형태: FROM 'x.csv' , FROM "dir/x.csv" , JOIN 'https://...'
  const re = /\b(?:from|join)\s*(['"])([^'"]*)\1/gi;
  let m;
  while ((m = re.exec(raw))) {
    const looksLikePath = /[\/\\]|:\/\/|\.[a-z0-9]{2,5}$/i.test(m[2]);
    if (m[1] === '"' && known.has(m[2])) continue;
    if (m[1] === "'" || looksLikePath)
      return { ok: false, reason: "파일이나 주소를 직접 읽을 수 없습니다. 올라와 있는 테이블만 읽을 수 있습니다." };
  }
  // 실행할 SQL은 검사용 사본(body)이 아니라 원본에서 끝의 세미콜론만 뗀 것
  return { ok: true, sql: raw.trim().replace(/;+\s*$/, "").trim() };
}
