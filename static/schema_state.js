// AI에 보내는 테이블 설명 = schema.json + 지금 올라와 있는 테이블(올린 파일 포함).
// 올린 테이블은 이름 · 컬럼 이름 · 타입 · 행 수만 보낸다(컬럼 뜻은 없으므로 보내지 않는다). 데이터 행은 보내지 않는다.
import { describeTables } from "./db.js";

let basePromise = null;
export const loadBaseSchema = () => (basePromise ??= fetch("/schema.json", { cache: "no-store" }).then(r => r.json()));

const sameColumns = (a, b) => a.length === b.length && a.every((c, i) => c.name === b[i].name);

export async function getSchemaForAi() {
  const [base, live] = await Promise.all([loadBaseSchema(), describeTables()]);
  const tables = live.map(t => {
    const b = base.tables.find(x => x.name === t.name);
    if (b && sameColumns(b.columns, t.columns)) return { ...b, rows: t.rows }; // 같은 컬럼이면 사전의 뜻을 그대로 쓰고 행 수만 새로
    return { name: t.name, uploaded: true, rows: t.rows, columns: t.columns.map(c => ({ name: c.name, type: c.type })) };
  });
  return { ...base, tables };
}
