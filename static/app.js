import "./saved.js";
import "./tables.js";
import "./upload.js";
import "./ask.js";

// 탭 전환 + 상단 상태 줄
const tabs = document.querySelectorAll("#tabs button");
const panels = document.querySelectorAll(".panel");

function showTab(name) {
  tabs.forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  panels.forEach(p => p.classList.toggle("active", p.id === "tab-" + name));
  history.replaceState(null, "", "#" + name);
}
tabs.forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
const first = location.hash.slice(1);
if ([...tabs].some(b => b.dataset.tab === first)) showTab(first);

// 서버 상태: 연결 여부와 AI 키 설정 여부만 표시한다(키 값은 오지 않는다).
export const serverState = { connected: false, keySet: false };

async function checkServer() {
  const el = document.getElementById("status");
  try {
    const r = await fetch("/api/ping", { cache: "no-store" });
    const j = await r.json();
    serverState.connected = true;
    serverState.keySet = !!j.key_set;
    el.textContent = "서버 연결됨 · " + (j.key_set ? "AI 키 설정됨" : "AI 키 없음");
    el.className = "status " + (j.key_set ? "ok" : "warn");
  } catch (e) {
    el.textContent = "서버에 연결할 수 없음 · AI 사용 불가";
    el.className = "status warn";
  }
}
checkServer();
