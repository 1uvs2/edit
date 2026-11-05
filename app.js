import * as api from "./api.js?v=7";

const CFG = window.APP_CONFIG;
const P = CFG.PRICES;
const $app = document.getElementById("app");
const state = { user: null, profile: null, editor: false };

const TYPES = {
  short: { label: "숏타입", title: "숏 · 30초 이내", desc: "컷 편집 · 기본보정 · 텍스트" },
  A: { label: "A타입", title: "A · 60초 이내", desc: "컷 편집 · 기본보정 · 텍스트" },
  B: { label: "B타입", title: "B · 60초 이내", desc: "컷 편집 · 기본보정 · 텍스트 · 고난도 모션" },
};
const STAGES = ["요청 확인", "컷 편집", "효과 추가", "후반 작업", "납품"];

// ---------------------------------------------------------
// 도움 함수
// ---------------------------------------------------------
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const won = (n) => `${Number(n || 0).toLocaleString("ko-KR")}원`;
const today = () => new Date(new Date().toDateString());
function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtDate = (s) => { const d = parseDate(s); return d ? `${d.getMonth() + 1}월 ${d.getDate()}일` : "날짜 미정"; };
const fmtDateTime = (s) => { if (!s) return ""; const d = new Date(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
function ddayNum(s) { const d = parseDate(s); return d ? Math.round((d - today()) / 86400000) : null; }
function ddayText(s) { const n = ddayNum(s); if (n === null) return "D-?"; return n === 0 ? "D-day" : n > 0 ? `D-${n}` : `D+${-n}`; }
function nextOccurrence(s) {
  const d = parseDate(s); if (!d) return null;
  const t = today();
  let n = new Date(t.getFullYear(), d.getMonth(), d.getDate());
  if (n < t) n = new Date(t.getFullYear() + 1, d.getMonth(), d.getDate());
  return n;
}
function safeUrl(u) {
  try { const x = new URL(String(u).trim()); return x.protocol === "http:" || x.protocol === "https:" ? x.href : null; } catch { return null; }
}
const titleOf = (r) => `${r.member || "[멤버]"} ${r.occasion || ""} 에딧`.replace(/\s+/g, " ").trim();

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 1800);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch {}
    ta.remove();
  }
  toast("계좌번호를 복사했어요");
}
const go = (h) => { if (location.hash === h) render(); else location.hash = h; };

const ICON = {
  bell: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>',
  chat: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 01-11.8 7L4 20l1.2-4.4A8 8 0 1121 12z"/></svg>',
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  right: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
  user: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  check: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  checkSm: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
};

function calc(d) {
  const base = P[d.edit_type] || 0;
  const secFee = Math.floor((d.extra_sec || 0) / 5) * P.per5sec;
  const privateFee = d.opt_private ? P.private : 0;
  const fastFee = d.opt_fast ? P.fast : 0;
  const subtotal = base + secFee + privateFee + fastFee;
  const total = subtotal * (d.opt_commercial ? P.commercial : 1);
  return { base, secFee, privateFee, fastFee, subtotal, commercialFee: total - subtotal, total, extra: total - base };
}

// 작성 중인 요청서 (새로고침해도 유지)
const DKEY = "ec-draft";
function emptyDraft(useDefaults = true) {
  const p = state.profile || {};
  return {
    occasion: "", member: useDefaults ? p.default_bias || "" : "", song: "",
    sources: [{ time: "", url: "" }], refs: [""], notes: "",
    credit: useDefaults ? p.default_credit || "" : "", ratio: (useDefaults && p.default_ratio) || "4:3",
    deadline: "", upload_date: "",
    edit_type: null, extra_sec: 0, opt_private: false, opt_fast: false, opt_commercial: false,
    depositor: "", agreed: false,
  };
}
function getDraft() { try { return JSON.parse(sessionStorage.getItem(DKEY)) || null; } catch { return null; } }
function setDraft(d) { try { sessionStorage.setItem(DKEY, JSON.stringify(d)); } catch {} }
function clearDraft() { try { sessionStorage.removeItem(DKEY); } catch {} }

// 화면 틀
function layout(body, { title, back, cta = "", wide = false, home = false, bell = false } = {}) {
  $app.className = "app" + (wide ? " wide" : "");
  const bar = api.DEMO ? '<div class="demo-bar">체험 모드 · 이 기기에만 저장돼요 (config.js 에 Supabase 키를 넣으면 실제 서비스로 바뀌어요)</div>' : "";
  const head = home
    ? `<header class="top"><span class="logo"><img src="logo.png?v=7" alt="에딧 커미션" style="height:34px;width:auto;display:block" /></span><a class="icon-btn bell" href="#/messages" aria-label="메시지">${ICON.chat.replace(/18/g, "22")}<span class="noti-badge" data-msg-badge hidden></span></a><a class="icon-btn bell" href="#/notifications" aria-label="알림">${ICON.bell}<span class="noti-badge" data-badge hidden></span></a><a class="icon-btn" href="#/me" aria-label="마이페이지">${ICON.user}</a></header>`
    : `<header class="top">${back !== false ? `<button class="back" data-back aria-label="뒤로">${ICON.back}</button>` : ""}<h1>${esc(title || "")}</h1>${bell ? `<a class="icon-btn bell" href="#/notifications" aria-label="알림">${ICON.bell}<span class="noti-badge" data-badge hidden></span></a>` : ""}</header>`;
  $app.innerHTML = `${bar}${head}<main class="page">${body}</main>${cta ? `<div class="cta">${cta}</div>` : ""}`;
  $app.querySelector("[data-back]")?.addEventListener("click", () => {
    if (typeof back === "string") go(back); else history.length > 1 ? history.back() : go("#/");
  });
  window.scrollTo(0, 0);
  refreshBadge();
}
async function refreshBadge() {
  if (!state.user) return;
  const set = (el, n) => { if (!el) return; el.hidden = !n; el.textContent = n > 9 ? "9+" : String(n); };
  const el = $app.querySelector("[data-badge]");
  if (el) set(el, await api.unreadCount(state.user).catch(() => 0));
  const mel = $app.querySelector("[data-msg-badge]");
  if (mel) {
    const map = await api.unreadMessageMap(state.user, "#/chat/").catch(() => ({}));
    set(mel, Object.values(map).reduce((a, b) => a + b, 0));
  }
}
function on(sel, ev, fn) { $app.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn)); }

function accountBox(amount) {
  const b = CFG.BANK;
  return `<div class="account">
    <div class="row"><span class="muted small">${esc(b.name)} · 예금주 ${esc(b.holder)}</span>${amount != null ? `<span class="bold">${won(amount)}</span>` : ""}</div>
    <div class="row" style="margin-top:6px"><span class="num">${esc(b.number)}</span><button class="btn-mini dark" data-copy>복사</button></div>
  </div>`;
}
function bindCopy() { on("[data-copy]", "click", () => copy(CFG.BANK.number.replace(/[^0-9]/g, "") || CFG.BANK.number)); }

function statusBadge(r) {
  if (r.status === "cancelled") return '<span class="badge red">취소됨</span>';
  if (r.status === "awaiting_payment") return '<span class="badge gray">입금 확인 중</span>';
  if (r.stage >= 5 && r.delivery_url && r.received_at) return '<span class="badge green">받기 완료</span>';
  if (r.stage >= 5) return '<span class="badge green">납품 완료</span>';
  if (r.client_note && r.revision_requested_at) return '<span class="badge">수정 요청</span>';
  return `<span class="badge">${STAGES[Math.max(0, r.stage - 1)]}</span>`;
}

// ---------------------------------------------------------
// 로그인
// ---------------------------------------------------------
function Login() {
  $app.className = "app";
  $app.innerHTML = `
    ${api.DEMO ? '<div class="demo-bar">체험 모드 · 버튼을 누르면 체험 계정으로 들어가요</div>' : ""}
    <div class="login">
      <img src="logo.png?v=7" alt="에딧 커미션" style="height:64px;width:auto;align-self:flex-start" />
      <h1>에딧 커미션,<br/>이제 걱정 없이 맡기세요</h1>
      <p class="muted" style="margin:0;color:#333">맡기는 순간부터 기념일 당일까지<br/>걱정 없이 맡기는 에딧 커미션</p>
      <div style="flex:1"></div>
      <button class="btn btn-kakao" data-kakao>카카오로 계속하기</button>
      <p class="muted small" style="text-align:center;margin-top:14px">로그인하면 요청서와 진행 상황이 계정에 저장돼요</p>
    </div>`;
  on("[data-kakao]", "click", async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api.loginWithKakao();
      if (api.DEMO) { await loadSession(); go("#/"); }
    } catch (err) {
      toast("로그인하지 못했어요: " + err.message);
      e.currentTarget.disabled = false;
    }
  });
}

// ---------------------------------------------------------
// 홈
// ---------------------------------------------------------
async function Home() {
  const [reqs, notices] = await Promise.all([api.listMyRequests(state.user), api.listNotices(2).catch(() => [])]);
  const active = reqs.find((r) => r.status !== "cancelled" && r.stage < 5);
  const p = state.profile || {};

  const activeCard = active ? `
    <a class="card" href="#/request/${esc(active.id)}" style="display:block;text-decoration:none">
      <div class="row"><span class="title-m">진행 중인 의뢰</span>${ICON.right}</div>
      <div style="margin-top:8px" class="ellipsis">${esc(titleOf(active))} · ${fmtDate(active.deadline)}</div>
      <div class="row" style="justify-content:flex-start;gap:10px;margin-top:4px">
        <span class="dday">${ddayText(active.deadline)}</span><span>마감일 0시까지</span>
        <span style="flex:1"></span>${statusBadge(active)}
      </div>
      <div class="pill-date"><span class="small">납품 예정</span><span class="bold">${fmtDate(active.upload_date)}</span></div>
    </a>` : `
    <div class="card"><div class="title-m">진행 중인 의뢰</div><p class="muted" style="margin:8px 0 0">아직 진행 중인 의뢰가 없어요. 아래 버튼으로 첫 에딧을 맡겨 보세요.</p></div>`;

  const delivered = reqs.filter((r) => r.delivery_url && !r.received_at);
  const deliveredCards = delivered.map((r) => `
    <a class="card delivery" href="#/request/${esc(r.id)}" style="display:block;text-decoration:none;margin-bottom:12px">
      <div class="row"><b>🎁 완성된 영상이 도착했어요</b>${ICON.right}</div>
      <div class="muted small ellipsis" style="margin-top:4px">${esc(titleOf(r))} · 눌러서 영상 받기</div>
    </a>`).join("");
  const draftCard = p.draft ? `
    <div class="card" style="margin-top:12px;border:1.5px dashed #f2b9ee;box-shadow:none">
      <div class="row"><b>임시저장한 요청서가 있어요</b><span class="muted small">${fmtDateTime(p.draft_saved_at)}</span></div>
      <div class="muted small ellipsis" style="margin-top:4px">${esc(titleOf(p.draft))}${p.draft.song ? " · " + esc(p.draft.song) : ""}</div>
      <div class="grid-2" style="margin-top:12px">
        <button class="btn-sub" data-draft-continue>이어서 쓰기</button>
        <button class="btn-sub" style="background:#f3f3f3" data-draft-delete>삭제</button>
      </div>
    </div>` : "";

  const noticeCard = notices.length ? `
    <div class="card" style="margin-top:22px;padding-top:16px;padding-bottom:6px">
      <div class="row"><span class="title-m">공지사항</span><a class="link-accent" href="#/notices" style="text-decoration:none">전체 보기</a></div>
      <div class="rows">${notices.map((n) => `
        <a class="row" href="#/notices/${esc(n.id)}" style="text-decoration:none;justify-content:flex-start;gap:8px">
          ${n.pinned ? '<span class="badge">고정</span>' : ""}<span class="ellipsis" style="flex:1">${esc(n.title)}</span><span class="muted small nowrap">${fmtDate(n.created_at.slice(0, 10))}</span>
        </a>`).join("")}</div>
    </div>` : "";

  const priceRows = Object.entries(TYPES).map(([k, t]) => `
    <div class="row"><span><b>${t.label}</b> <span class="small">${esc(t.title.split("· ")[1])} [${esc(t.desc)}]</span></span><b class="nowrap">${won(P[k])}</b></div>`).join("");

  layout(`
    ${deliveredCards}
    ${activeCard}
    ${draftCard}
    ${noticeCard}
    <div class="card" style="margin-top:22px">
      <div class="title-m" style="margin-bottom:4px">가격</div>
      <div class="rows">${priceRows}</div>
      <p class="muted small" style="margin:8px 0 0">옵션 추가 별도</p>
    </div>
    <div class="section-title">내 카드</div>
    <div class="card">
      <div style="margin-bottom:6px">새 요청서에 아래 값이 미리 채워져요</div>
      <div class="rows">
        <div class="row"><span class="muted">최애</span><b>${esc(p.default_bias || "미설정")}</b></div>
        <div class="row"><span class="muted">규격</span><b>${esc(p.default_ratio || "4:3")}</b></div>
        <div class="row"><span class="muted">크레딧</span><b>${esc(p.default_credit || "미설정")}</b></div>
      </div>
      <button class="btn-sub" data-new-default style="margin-top:8px">내 기본값으로 채우기</button>
    </div>`, { home: true, cta: '<button class="btn btn-primary" data-new>새 에딧 맡기기</button>' });

  const startNew = (useDefaults) => {
    if (p.draft && confirm("임시저장한 요청서가 있어요. 이어서 쓸까요?\n취소를 누르면 새로 작성해요.")) setDraft({ ...emptyDraft(true), ...p.draft });
    else setDraft(emptyDraft(useDefaults));
    go("#/new");
  };
  on("[data-new]", "click", () => startNew(false));
  on("[data-new-default]", "click", () => startNew(true));
  on("[data-draft-continue]", "click", () => { setDraft({ ...emptyDraft(true), ...p.draft }); go("#/new"); });
  on("[data-draft-delete]", "click", async () => {
    if (!confirm("임시저장한 요청서를 지울까요?")) return;
    state.profile = await api.clearDraftRemote(state.user);
    toast("임시저장을 지웠어요");
    Home();
  });
}

// 임시저장 + 다음 버튼
const SAVE_NEXT = '<div style="display:grid;grid-template-columns:110px 1fr;gap:10px"><button class="btn btn-outline" data-temp-save>임시저장</button><button class="btn btn-primary" data-next>다음으로</button></div>';
function bindTempSave(d) {
  on("[data-temp-save]", "click", async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const { agreed, ...rest } = d;
      state.profile = await api.saveDraftRemote(state.user, rest);
      toast("임시저장했어요 · 홈에서 이어서 쓸 수 있어요");
    } catch (err) {
      toast("임시저장하지 못했어요: " + err.message);
    } finally { b.disabled = false; }
  });
}

// ---------------------------------------------------------
// 요청서 작성
// ---------------------------------------------------------
async function NewForm() {
  const d = getDraft() || emptyDraft(true);
  setDraft(d);
  const p = state.profile || {};

  const srcRows = d.sources.map((s, i) => `
    <div class="src-row">
      <input class="input" placeholder="00:00~00:00" value="${esc(s.time)}" data-src-time="${i}" aria-label="소스 시간" />
      <input class="input" placeholder="링크를 업로드해 주세요" value="${esc(s.url)}" data-src-url="${i}" aria-label="소스 링크" inputmode="url" />
      <button class="x-btn" data-src-del="${i}" aria-label="삭제">×</button>
    </div>`).join("");
  const refRows = d.refs.map((u, i) => `
    <div class="ref-row">
      <input class="input" placeholder="링크를 업로드해 주세요" value="${esc(u)}" data-ref="${i}" aria-label="레퍼런스 링크" inputmode="url" />
      <button class="x-btn" data-ref-del="${i}" aria-label="삭제">×</button>
    </div>`).join("");

  layout(`
    <div class="card">
      <div class="muted bold">내 카드</div>
      <div style="margin:6px 0 12px">${esc(p.default_bias || "[그룹] [멤버]")} · ${esc(p.default_ratio || "4:3")} · ${esc(p.default_credit || "edit by @[계정]")}</div>
      <button class="btn-sub" data-fill-default>내 기본값으로 채우기</button>
    </div>

    <div class="section-title">일정</div>
    <input class="input" placeholder="어떤 날을 위한 에딧인가요? (예: 생일)" value="${esc(d.occasion)}" data-f="occasion" />
    <div class="grid-2" style="margin-top:12px">
      <label class="card date-card"><input type="date" value="${esc(d.deadline)}" data-f="deadline" /><span class="small">마감일</span></label>
      <label class="card date-card" style="margin-top:0"><input type="date" value="${esc(d.upload_date)}" data-f="upload_date" /><span class="small">예정 업로드일</span></label>
    </div>
    <div class="err" data-err="date"></div>

    <div class="section-title">멤버</div>
    <input class="input" placeholder="그룹명 · 멤버 이름" value="${esc(d.member)}" data-f="member" />
    <div class="err" data-err="member"></div>

    <div class="section-title">곡 · 구간</div>
    <input class="input" placeholder="예: 원곡 · 00:00~00:59 까지" value="${esc(d.song)}" data-f="song" />
    <div class="err" data-err="song"></div>

    <div class="section-title">영상 소스</div>
    ${srcRows}
    <button class="add-btn" data-src-add>+ 추가</button>

    <div class="section-title">레퍼런스</div>
    ${refRows}
    <button class="add-btn" data-ref-add>+ 추가</button>

    <div class="section-title">파일 규격</div>
    <div class="chips">${["16:9", "4:3"].map((r) => `<button class="chip ${d.ratio === r ? "on" : ""}" data-ratio="${r}">${r}</button>`).join("")}</div>

    <div class="section-title">요청사항</div>
    <textarea class="textarea" placeholder="요청사항을 작성해 주세요" data-f="notes">${esc(d.notes)}</textarea>

    <div class="section-title">크레딧 표기</div>
    <input class="input" placeholder="예: edit by @내계정" value="${esc(d.credit)}" data-f="credit" />
  `, { title: "에딧 요청서", back: "#/", cta: SAVE_NEXT });

  const save = () => setDraft(d);
  on("[data-f]", "input", (e) => { d[e.target.dataset.f] = e.target.value; save(); });
  on("[data-src-time]", "input", (e) => { d.sources[+e.target.dataset.srcTime].time = e.target.value; save(); });
  on("[data-src-url]", "input", (e) => { d.sources[+e.target.dataset.srcUrl].url = e.target.value; save(); });
  on("[data-ref]", "input", (e) => { d.refs[+e.target.dataset.ref] = e.target.value; save(); });
  const rerender = () => { const y = scrollY; save(); NewForm().then(() => scrollTo(0, y)); };
  on("[data-src-add]", "click", () => { d.sources.push({ time: "", url: "" }); rerender(); });
  on("[data-ref-add]", "click", () => { d.refs.push(""); rerender(); });
  on("[data-src-del]", "click", (e) => { d.sources.splice(+e.currentTarget.dataset.srcDel, 1); if (!d.sources.length) d.sources.push({ time: "", url: "" }); rerender(); });
  on("[data-ref-del]", "click", (e) => { d.refs.splice(+e.currentTarget.dataset.refDel, 1); if (!d.refs.length) d.refs.push(""); rerender(); });
  on("[data-ratio]", "click", (e) => { d.ratio = e.currentTarget.dataset.ratio; rerender(); });
  on("[data-fill-default]", "click", () => {
    d.member = p.default_bias || d.member; d.credit = p.default_credit || d.credit; d.ratio = p.default_ratio || d.ratio;
    toast("내 기본값으로 채웠어요"); rerender();
  });
  bindTempSave(d);
  on("[data-next]", "click", () => {
    $app.querySelectorAll("[data-err]").forEach((el) => (el.textContent = ""));
    let first = null;
    const fail = (k, msg) => { const el = $app.querySelector(`[data-err="${k}"]`); el.textContent = msg; first = first || el; };
    if (!d.deadline) fail("date", "마감일을 골라 주세요");
    else if (ddayNum(d.deadline) < 0) fail("date", "마감일이 이미 지났어요");
    else if (d.upload_date && parseDate(d.upload_date) < parseDate(d.deadline)) fail("date", "예정 업로드일은 마감일과 같거나 뒤여야 해요");
    if (!d.member.trim()) fail("member", "그룹명과 멤버 이름을 적어 주세요");
    if (!d.song.trim()) fail("song", "곡과 구간을 적어 주세요");
    if (first) { first.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    go("#/new/price");
  });
}

// ---------------------------------------------------------
// 가격 선택
// ---------------------------------------------------------
function Price() {
  const d = getDraft();
  if (!d) return go("#/new");
  const c = calc(d);
  const summary = d.edit_type ? `${TYPES[d.edit_type].label}${d.extra_sec ? ` · 분량 ${d.extra_sec}초 추가` : ""}` : "타입 미선택";
  const toggle = (k, label, sub) => `
    <div class="row"><div><div>${label}</div><div class="muted small">${sub}</div></div>
    <button class="toggle" role="switch" aria-checked="${!!d[k]}" aria-label="${label}" data-opt="${k}"></button></div>`;

  layout(`
    <div class="section-title">타입</div>
    ${Object.entries(TYPES).map(([k, t]) => `
      <button class="card pick ${d.edit_type === k ? "on" : ""}" data-type="${k}" aria-pressed="${d.edit_type === k}">
        <div class="row"><b>${t.title}</b><b>${won(P[k])}</b></div>
        <div class="muted small" style="margin-top:6px">${t.desc}</div>
      </button>`).join("")}

    <div class="section-title">추가 옵션</div>
    <div class="card" style="padding-top:4px;padding-bottom:4px">
      <div class="rows">
        <div class="row"><div><div>분량 추가</div><div class="muted small">5초 당 ${won(P.per5sec)} 추가</div></div>
          <div class="stepper">
            <button class="step-btn minus" data-sec="-5" aria-label="5초 빼기">−</button>
            <span class="step-val">${d.extra_sec}초</span>
            <button class="step-btn plus" data-sec="5" aria-label="5초 더하기">+</button>
          </div></div>
        ${toggle("opt_private", "포트폴리오 비공개", `${won(P.private)} 추가`)}
        ${toggle("opt_fast", "빠른 마감", `${won(P.fast)} 추가`)}
        ${toggle("opt_commercial", "상업적 사용", `총 금액의 ${P.commercial}배`)}
      </div>
    </div>

    <div class="card" style="margin-top:22px">
      <div class="row"><span class="title-m">총 금액</span><span class="big accent">${won(c.total)}</span></div>
      <div class="muted small" style="margin-top:2px">${esc(summary)}</div>
      <div class="err" data-err="type"></div>
    </div>`, { title: "가격", back: "#/new", cta: SAVE_NEXT.replace("다음으로", "이 구성으로 결제하기") });

  bindTempSave(d);
  const keep = (fn) => () => { const y = scrollY; fn(); setDraft(d); Price(); scrollTo(0, y); };
  on("[data-type]", "click", (e) => keep(() => { d.edit_type = e.currentTarget.dataset.type; })());
  on("[data-opt]", "click", (e) => keep(() => { const k = e.currentTarget.dataset.opt; d[k] = !d[k]; })());
  on("[data-sec]", "click", (e) => keep(() => { d.extra_sec = Math.min(600, Math.max(0, d.extra_sec + Number(e.currentTarget.dataset.sec))); })());
  on("[data-next]", "click", () => {
    if (!d.edit_type) { $app.querySelector('[data-err="type"]').textContent = "타입을 먼저 골라 주세요"; return; }
    go("#/new/pay");
  });
}

// ---------------------------------------------------------
// 결제 (계좌이체)
// ---------------------------------------------------------
function Pay() {
  const d = getDraft();
  if (!d) return go("#/new");
  if (!d.edit_type) return go("#/new/price");
  const c = calc(d);
  const line = (k, v) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;
  const ready = d.agreed && d.depositor.trim();

  layout(`
    <div class="section-title">맡기는 내용</div>
    <div class="card">
      <div class="row"><b class="title-m ellipsis">${esc(titleOf(d))}</b><span class="badge">${ddayText(d.deadline)}</span></div>
      <div style="margin-top:6px">마감일 ${fmtDate(d.deadline)} · 납품 예정 ${fmtDate(d.upload_date)}</div>
      <div class="ellipsis">${esc(d.song)}</div>
      <a class="link-accent" href="#/new" style="display:inline-block;margin-top:10px">요청서 수정하기</a>
    </div>

    <div class="section-title">결제 금액</div>
    <div class="card" style="padding-top:4px;padding-bottom:4px">
      <div class="rows">
        ${line(TYPES[d.edit_type].label, won(c.base))}
        ${c.secFee ? line(`분량 추가 ${d.extra_sec}초`, won(c.secFee)) : ""}
        ${c.privateFee ? line("포트폴리오 비공개", won(c.privateFee)) : ""}
        ${c.fastFee ? line("빠른 마감", won(c.fastFee)) : ""}
        ${c.commercialFee ? line(`상업적 사용 (×${P.commercial})`, won(c.commercialFee)) : ""}
        <div class="row"><b>총 금액</b><span class="big accent">${won(c.total)}</span></div>
      </div>
    </div>

    <div class="section-title">결제 수단</div>
    <div class="card">
      <div class="row"><b>계좌이체</b><span class="muted small">요청서를 보낸 뒤 입금해 주세요</span></div>
      ${accountBox(c.total)}
      <div class="field">
        <input class="input" placeholder="입금자명 (입금할 때 쓰는 이름)" value="${esc(d.depositor)}" data-depositor aria-label="입금자명" />
      </div>
    </div>

    <div class="section-title">환불 기준</div>
    <div class="card">
      <div class="muted">요청 확인 전 : 전액 환불</div>
      <div class="muted">작업 시작 후 : 환불 불가</div>
      <div class="check-row" data-agree role="checkbox" aria-checked="${d.agreed}" tabindex="0">
        <span class="checkbox ${d.agreed ? "on" : ""}">${d.agreed ? ICON.checkSm : ""}</span>
        <span>환불 기준을 확인했어요 (필수)</span>
      </div>
    </div>`, {
    title: "결제", back: "#/new/price",
    cta: `<button class="btn btn-primary" data-submit ${ready ? "" : "disabled"}>${won(c.total)} 요청 보내기</button>`,
  });

  bindCopy();
  const btn = $app.querySelector("[data-submit]");
  const refresh = () => { btn.disabled = !(d.agreed && d.depositor.trim()); };
  on("[data-depositor]", "input", (e) => { d.depositor = e.target.value; setDraft(d); refresh(); });
  const agree = () => {
    d.agreed = !d.agreed; setDraft(d);
    const box = $app.querySelector("[data-agree]");
    box.setAttribute("aria-checked", d.agreed);
    const cb = box.querySelector(".checkbox");
    cb.classList.toggle("on", d.agreed);
    cb.innerHTML = d.agreed ? ICON.checkSm : "";
    refresh();
  };
  on("[data-agree]", "click", agree);
  on("[data-agree]", "keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); agree(); } });
  btn.addEventListener("click", async () => {
    btn.disabled = true; btn.textContent = "보내는 중…";
    try {
      const clean = {
        ...d,
        sources: d.sources.filter((s) => s.time.trim() || s.url.trim()),
        refs: d.refs.map((u) => u.trim()).filter(Boolean),
      };
      const r = await api.createRequest(state.user, clean);
      clearDraft();
      if (state.profile?.draft) state.profile = await api.clearDraftRemote(state.user).catch(() => state.profile);
      go(`#/done/${r.id}`);
    } catch (err) {
      toast("보내지 못했어요: " + err.message);
      refresh(); btn.textContent = `${won(c.total)} 요청 보내기`;
    }
  });
}

// ---------------------------------------------------------
// 완료
// ---------------------------------------------------------
async function Done(id) {
  const r = await api.getRequest(id);
  $app.className = "app";
  $app.innerHTML = `
    ${api.DEMO ? '<div class="demo-bar">체험 모드 · 이 기기에만 저장돼요</div>' : ""}
    <div class="done-wrap">
      <div class="done-icon">${ICON.check}</div>
      <h1 style="font-size:24px;margin:0 0 10px">요청서를 보냈어요</h1>
      <p class="muted" style="margin:0">아래 계좌로 입금해 주세요.<br/>에디터가 입금을 확인하면 진행판의 첫 단계가 채워져요</p>
      <div style="text-align:left;margin-top:26px">
        ${accountBox(r?.total)}
        ${r ? `<p class="muted small" style="margin:10px 4px 0">입금자명: ${esc(r.depositor)}</p>` : ""}
      </div>
    </div>
    <div class="cta">
      <button class="btn btn-primary" data-progress>진행판 보기</button>
      <button class="btn-text" data-home>홈으로</button>
    </div>`;
  bindCopy();
  on("[data-progress]", "click", () => go(`#/request/${id}`));
  on("[data-home]", "click", () => go("#/"));
}

// ---------------------------------------------------------
// 진행판
// ---------------------------------------------------------
function stepsHtml(r) {
  const sd = r.stage_dates || {};
  return `<ol class="steps">${STAGES.map((name, i) => {
    const k = i + 1;
    const done = r.stage > k || (r.stage === 5 && k === 5);
    const now = r.stage === k && k < 5;
    const dts = sd[k] || {};
    const sub = done && dts.done ? `${fmtDate(dts.done)} 완료` : done ? "완료" : now && dts.plan ? `${fmtDate(dts.plan)}까지` : dts.plan ? `${fmtDate(dts.plan)} 예정` : "예정일 미정";
    return `<li><span class="dot ${done ? "done" : now ? "now" : ""}"></span>
      <div><div class="${done || now ? "bold" : "muted"}">${name}</div><div class="muted small">${sub}</div></div>
      <div>${now ? '<span class="badge">진행 중</span>' : ""}</div></li>`;
  }).join("")}</ol>`;
}

function deliveryCard(r) {
  const url = safeUrl(r.delivery_url);
  if (!url) return "";
  return `<div class="card delivery" style="margin-top:12px">
    <div class="row"><b class="title-m">🎁 완성된 영상이 도착했어요</b><span class="muted small nowrap">${fmtDateTime(r.delivered_at)}</span></div>
    ${r.delivery_note ? `<div class="notice" style="margin-top:10px;white-space:pre-wrap">${esc(r.delivery_note)}</div>` : ""}
    <a class="btn btn-primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer" style="margin-top:14px;text-decoration:none">영상 받기 (구글 드라이브)</a>
    ${r.received_at
      ? `<p class="muted small" style="text-align:center;margin:10px 0 0">${fmtDateTime(r.received_at)}에 받기 완료했어요</p>`
      : `<button class="btn btn-outline" data-received style="margin-top:8px;height:46px;font-size:14px">잘 받았어요</button>
         <p class="muted small" style="text-align:center;margin:8px 0 0">링크가 열리지 않으면 에디터에게 메시지로 알려 주세요</p>`}
  </div>`;
}

async function Progress(id) {
  const r = await api.getRequest(id);
  if (!r) { layout('<div class="empty">요청서를 찾을 수 없어요</div>', { title: "진행 중인 의뢰", back: "#/" }); return; }
  const free = CFG.FREE_REVISIONS;
  const url = safeUrl(r.preview_url);
  const isVideo = url && /\.(mp4|webm|mov)(\?|$)/i.test(url);
  const approved = r.stage > 0 && r.client_approved_stage >= r.stage && !r.client_note;
  const pendingRevision = r.client_note && r.revision_requested_at;

  let banner = "";
  if (r.status === "awaiting_payment") {
    banner = `<div class="card" style="margin-top:12px"><b>입금을 기다리고 있어요</b>
      <p class="muted small" style="margin:4px 0 0">입금자명 <b style="color:#000">${esc(r.depositor)}</b> 으로 ${won(r.total)}을 보내 주세요. 확인되면 첫 단계가 채워져요.</p>
      ${accountBox(r.total)}</div>`;
  } else if (r.status === "cancelled") {
    banner = '<div class="notice" style="margin-top:12px">이 의뢰는 취소되었어요. 궁금한 점은 에디터에게 문의해 주세요.</div>';
  }

  const preview = url ? `
    <div class="section-title">먼저 보내 온 미리보기</div>
    <div class="card">
      <b>${esc(r.preview_label || `${STAGES[Math.max(0, r.stage - 1)]} 단계 미리 보기`)}</b>
      ${isVideo ? `<video src="${esc(url)}" controls playsinline style="width:100%;border-radius:14px;margin-top:12px;background:#111"></video>` : ""}
      <a class="btn btn-outline" href="${esc(url)}" target="_blank" rel="noopener noreferrer" style="margin-top:12px;height:46px;font-size:14px;text-decoration:none">미리보기 열기</a>
      <p class="muted small" style="margin:12px 0 0">수정은 ${free}회까지 무료예요 · 지금까지 ${r.revision_count || 0}회 요청</p>
      ${pendingRevision ? `<div class="notice" style="margin-top:10px">보낸 수정 요청: ${esc(r.client_note)}</div>` : ""}
      ${approved ? '<div class="notice" style="margin-top:10px">이 단계는 "이대로 좋아요"로 확인했어요</div>' : ""}
      ${r.status === "confirmed" ? `
      <div class="grid-2" style="margin-top:12px">
        <button class="btn btn-primary" style="height:46px;font-size:14px" data-approve>이대로 좋아요</button>
        <button class="btn btn-outline" style="height:46px;font-size:14px" data-revise>수정 요청</button>
      </div>
      <div data-revise-box hidden style="margin-top:12px">
        <textarea class="textarea" placeholder="어떤 부분을 바꾸고 싶은지 적어 주세요" data-note maxlength="2000"></textarea>
        ${(r.revision_count || 0) >= free ? `<p class="err">무료 수정 ${free}회를 모두 사용했어요. 추가 수정은 에디터와 상의해 주세요.</p>` : ""}
        <button class="btn btn-primary" style="height:46px;font-size:14px;margin-top:8px" data-send-revise>수정 요청 보내기</button>
      </div>` : ""}
    </div>` : "";

  layout(`
    <div class="card">
      <div class="title-m">${esc(titleOf(r))}</div>
      <div class="muted small" style="margin-top:2px">${esc(r.song || "")}</div>
      <div class="row" style="justify-content:flex-start;gap:10px;margin-top:6px">
        <span class="dday">${ddayText(r.deadline)}</span><span>마감일 0시까지</span><span style="flex:1"></span>${statusBadge(r)}
      </div>
      <div class="pill-date"><span class="small">납품 예정</span><span class="bold">${fmtDate(r.upload_date)}</span></div>
    </div>
    ${deliveryCard(r)}
    ${banner}
    <a class="btn btn-outline" href="#/chat/${esc(r.id)}" style="margin-top:12px;height:48px;font-size:15px;text-decoration:none">${ICON.chat} 에디터에게 메시지 보내기</a>
    <div class="section-title">현재 진행 상황</div>
    <div class="card">${stepsHtml(r)}</div>
    ${preview}
  `, { title: "진행 중인 의뢰", back: "#/", bell: true, cta: '<button class="btn btn-primary" data-home>홈으로 돌아가기</button>' });

  bindCopy();
  on("[data-home]", "click", () => go("#/"));
  on("[data-received]", "click", async () => { await api.confirmReceived(id); toast("받기 완료! 에디터에게 알려 드렸어요"); Progress(id); });
  on("[data-approve]", "click", async () => { await api.approvePreview(id); toast("확인했어요. 다음 단계로 넘어갈게요"); Progress(id); });
  on("[data-revise]", "click", () => { const b = $app.querySelector("[data-revise-box]"); b.hidden = !b.hidden; if (!b.hidden) b.querySelector("textarea").focus(); });
  on("[data-send-revise]", "click", async () => {
    const note = $app.querySelector("[data-note]").value.trim();
    if (!note) { toast("수정할 내용을 적어 주세요"); return; }
    await api.requestRevision(id, note);
    toast("수정 요청을 보냈어요");
    Progress(id);
  });
}

// ---------------------------------------------------------
// 마이페이지
// ---------------------------------------------------------
async function MyPage() {
  const reqs = await api.listMyRequests(state.user);
  const p = state.profile || {};
  const active = reqs.filter((r) => r.status !== "cancelled" && r.stage < 5);
  const ratio = p.default_ratio || "4:3";
  const initial = (p.nickname || "?").slice(0, 1);
  const avatarSrc = p.avatar_url && (p.avatar_url.startsWith("data:image/") ? p.avatar_url : safeUrl(p.avatar_url));

  layout(`
    <div class="row" style="justify-content:flex-start;gap:14px;margin-top:6px">
      <label class="avatar-edit" title="사진 바꾸기">
        <span class="avatar" data-avatar ${avatarSrc ? `style="background-image:url('${esc(avatarSrc)}')"` : ""}>${avatarSrc ? "" : esc(initial)}</span>
        <span class="avatar-cam" aria-hidden="true">📷</span>
        <input type="file" accept="image/*" data-avatar-file class="sr-only" aria-label="프로필 사진 바꾸기" />
      </label>
      <div style="min-width:0;flex:1">
        <div class="title-m ellipsis" data-nick-view>${esc(p.nickname || "의뢰인")}</div>
        <div class="small">카카오 로그인 · 의뢰 ${reqs.length}건</div>
      </div>
      <button class="btn-mini" data-nick-edit>프로필 수정</button>
    </div>
    <div class="card" data-nick-box hidden style="margin-top:14px">
      <div class="bold">닉네임</div>
      <input class="input field" maxlength="20" placeholder="에디터에게 보일 이름" value="${esc(p.nickname || "")}" data-nick />
      <div class="grid-2" style="margin-top:12px">
        <button class="btn-sub" style="background:#f3f3f3" data-avatar-reset>기본 사진으로</button>
        <button class="btn-sub" data-nick-save>저장하기</button>
      </div>
      <p class="muted small" style="margin:8px 0 0;text-align:center">사진은 동그라미를 눌러 바꿀 수 있어요</p>
    </div>

    <div class="section-title">진행 중인 의뢰</div>
    ${active.length ? active.map((r) => `
      <a class="card pick on" href="#/request/${esc(r.id)}" style="text-decoration:none">
        <div class="row"><b class="ellipsis">${esc(titleOf(r))}</b><b class="accent">${ddayText(r.deadline)}</b></div>
        <div class="bar"><i style="width:${Math.round((Math.max(0, r.stage) / 5) * 100)}%"></i></div>
        <div class="muted small">${r.status === "awaiting_payment" ? "입금 확인 중" : `5단계 중 ${r.stage}단계 · ${STAGES[Math.max(0, r.stage - 1)]}`} · 진행판 보기</div>
      </a>`).join("") : '<div class="card empty">진행 중인 의뢰가 없어요</div>'}

    <div class="section-title">내 기본값</div>
    <div class="card">
      <div class="bold">최애</div>
      <input class="input field" placeholder="[그룹] [멤버]" value="${esc(p.default_bias || "")}" data-def="default_bias" />
      <div class="bold" style="margin-top:18px">파일 규격</div>
      <div class="chips field">${["16:9", "4:3"].map((r) => `<button class="chip ${ratio === r ? "on" : ""}" data-def-ratio="${r}">${r}</button>`).join("")}</div>
      <div class="bold" style="margin-top:18px">크레딧 표기</div>
      <input class="input field" placeholder="edit by @[계정]" value="${esc(p.default_credit || "")}" data-def="default_credit" />
      <button class="btn-sub" style="margin-top:16px" data-def-save>저장하기</button>
      <p class="muted small" style="margin:8px 0 0;text-align:center">저장하면 다음 요청서에 채워져요</p>
    </div>

    <div class="section-title">결제 내역</div>
    <div class="card" style="padding-top:4px;padding-bottom:4px">
      <div class="rows">
        ${reqs.length ? reqs.map((r) => `<a class="row" href="#/request/${esc(r.id)}" style="text-decoration:none">
          <div style="min-width:0"><div class="ellipsis bold">${esc(titleOf(r))}</div><div class="muted small">${fmtDateTime(r.created_at)} · ${won(r.total)}</div></div>${statusBadge(r)}</a>`).join("")
        : '<div class="empty">아직 결제 내역이 없어요</div>'}
      </div>
    </div>

    <div class="card" style="margin-top:22px;padding-top:4px;padding-bottom:4px">
      ${state.editor ? `<a class="menu-item" href="#/editor" style="text-decoration:none"><span>에디터 페이지${api.DEMO ? " (체험)" : ""}</span>${ICON.right}</a>` : ""}
      ${api.DEMO ? '<button class="menu-item" data-reset><span>체험 데이터 지우기</span></button>' : ""}
      <button class="menu-item" data-logout><span>로그아웃</span></button>
    </div>
  `, { title: "마이페이지", back: "#/", bell: true });

  on("[data-nick-edit]", "click", () => { const b = $app.querySelector("[data-nick-box]"); b.hidden = !b.hidden; if (!b.hidden) b.querySelector("input").focus(); });
  on("[data-nick-save]", "click", async (e) => {
    const nickname = $app.querySelector("[data-nick]").value.trim();
    if (!nickname) { toast("닉네임을 적어 주세요"); return; }
    e.currentTarget.disabled = true;
    try {
      state.profile = await api.updateProfile(state.user, { nickname });
      toast("닉네임을 바꿨어요");
      MyPage();
    } catch (err) { toast("저장하지 못했어요: " + err.message); e.currentTarget.disabled = false; }
  });
  on("[data-avatar-file]", "change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast("사진 파일만 올릴 수 있어요"); return; }
    if (f.size > 15 * 1024 * 1024) { toast("15MB 이하 사진으로 골라 주세요"); return; }
    toast("사진 올리는 중…");
    try {
      const url = await api.uploadAvatar(state.user, f);
      state.profile = await api.updateProfile(state.user, { avatar_url: url });
      toast("프로필 사진을 바꿨어요");
      MyPage();
    } catch (err) { toast("사진을 올리지 못했어요: " + err.message); }
  });
  on("[data-avatar-reset]", "click", async () => {
    if (!confirm("기본 사진(이름 첫 글자)으로 바꿀까요?")) return;
    state.profile = await api.updateProfile(state.user, { avatar_url: null });
    toast("기본 사진으로 바꿨어요");
    MyPage();
  });
  let defRatio = ratio;
  on("[data-def-ratio]", "click", (e) => {
    defRatio = e.currentTarget.dataset.defRatio;
    $app.querySelectorAll("[data-def-ratio]").forEach((b) => b.classList.toggle("on", b.dataset.defRatio === defRatio));
  });
  on("[data-def-save]", "click", async () => {
    const patch = { default_ratio: defRatio };
    $app.querySelectorAll("[data-def]").forEach((i) => (patch[i.dataset.def] = i.value.trim()));
    state.profile = await api.updateProfile(state.user, patch);
    toast("저장됨 · 다음 요청서에 채워져요");
  });
  on("[data-logout]", "click", async () => { await api.logout(); state.user = null; clearDraft(); go("#/login"); });
  on("[data-reset]", "click", () => { if (confirm("체험 데이터를 모두 지울까요?")) { api.resetDemo(); clearDraft(); state.user = null; go("#/login"); } });
}

// ---------------------------------------------------------
// 알림함
// ---------------------------------------------------------
const NOTI_ICON = { message: "💬", stage: "🎬", confirmed: "✅", preview: "👀", cancelled: "⚠️", new_request: "📩", revision: "✏️", approved: "💗", delivered: "🎁", received: "📦", notice: "📢" };
async function Notifications() {
  const list = await api.listNotifications(state.user);
  layout(`
    ${list.length ? `<div class="card" style="padding-top:4px;padding-bottom:4px"><div class="rows">${list.map((n) => `
      <a class="row noti ${n.read_at ? "" : "unread"}" href="${esc(n.link && n.link.startsWith("#/") ? n.link : "#/")}" style="text-decoration:none;align-items:flex-start;justify-content:flex-start">
        <span class="noti-ic" aria-hidden="true">${NOTI_ICON[n.kind] || "🔔"}</span>
        <span style="min-width:0;flex:1"><b style="display:block">${esc(n.title)}</b>
          ${n.body ? `<span class="muted small" style="display:block;word-break:break-all">${esc(n.body)}</span>` : ""}
          <span class="muted small">${fmtDateTime(n.created_at)}</span></span>
      </a>`).join("")}</div></div>` : '<div class="card empty" style="padding:40px 0">아직 알림이 없어요<br/>진행 상황이 바뀌거나 메시지가 오면 여기에 쌓여요</div>'}
  `, { title: "알림", back: "#/" });
  await api.markAllRead(state.user);
}

// ---------------------------------------------------------
// 메시지
// ---------------------------------------------------------
function bubbles(msgs, mineIsEditor) {
  if (!msgs.length) return '<div class="empty">아직 메시지가 없어요. 궁금한 점이나 요청을 편하게 남겨 주세요.</div>';
  let lastDay = "";
  return msgs.map((m) => {
    const d = new Date(m.created_at);
    const day = `${d.getMonth() + 1}월 ${d.getDate()}일`;
    const sep = day !== lastDay ? `<div class="chat-day">${day}</div>` : "";
    lastDay = day;
    const mine = !!m.from_editor === !!mineIsEditor;
    const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return `${sep}<div class="bubble-row ${mine ? "mine" : ""}"><div class="bubble">${esc(m.body)}</div><span class="muted small">${time}</span></div>`;
  }).join("");
}
let chatUnsub = null;
function mountChat(requestId, { mineIsEditor = false } = {}) {
  const listEl = $app.querySelector("[data-chat-list]");
  const text = $app.querySelector("[data-chat-text]");
  const sendBtn = $app.querySelector("[data-chat-send]");
  if (!listEl) return;
  let msgs = [];
  const paint = (scroll = true) => {
    listEl.innerHTML = bubbles(msgs, mineIsEditor);
    if (scroll) { listEl.scrollTop = listEl.scrollHeight; if (!mineIsEditor) window.scrollTo(0, document.body.scrollHeight); }
  };
  const prefix = mineIsEditor ? "#/editor/chat/" : "#/chat/";
  const markRead = () => api.markMessagesRead(state.user, requestId, prefix).then(refreshBadge).catch(() => {});
  const loadMsgs = async () => { msgs = await api.listMessages(requestId); paint(); markRead(); };
  loadMsgs();
  if (chatUnsub) chatUnsub();
  chatUnsub = api.subscribe(state.user, {
    onMessage: (m) => {
      if (m.request_id !== requestId || msgs.some((x) => x.id === m.id)) return;
      if (!document.body.contains(listEl)) return;
      msgs.push(m); paint(); markRead();
    },
  });
  const send = async () => {
    const body = text.value.trim();
    if (!body) return;
    sendBtn.disabled = true;
    try {
      const m = await api.sendMessage(state.user, requestId, body, mineIsEditor);
      if (!msgs.some((x) => x.id === m.id)) msgs.push(m);
      text.value = ""; paint();
    } catch (e) { toast("보내지 못했어요: " + e.message); }
    finally { sendBtn.disabled = false; text.focus(); }
  };
  sendBtn.addEventListener("click", send);
  text.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
}

async function Chat(id, editorMode = false) {
  const r = await api.getRequest(id);
  const back = editorMode ? "#/editor/messages" : "#/messages";
  if (!r) { layout('<div class="empty">요청서를 찾을 수 없어요</div>', { title: "메시지", back }); return; }
  layout(`
    <a class="card" href="${editorMode ? "#/editor/" : "#/request/"}${esc(r.id)}" style="display:block;text-decoration:none;padding:14px 18px">
      <div class="row"><b class="ellipsis">${esc(titleOf(r))}</b>${statusBadge(r)}</div>
      <div class="muted small">${editorMode ? `${esc(r.profiles?.nickname || "의뢰인")} · 요청서 보기` : "진행판 보기"}</div>
    </a>
    <div class="chat-list page-chat" data-chat-list><div class="empty">불러오는 중…</div></div>
  `, {
    title: editorMode ? `${r.profiles?.nickname || "의뢰인"}님과 메시지` : "에디터와 메시지", back, bell: true, wide: editorMode,
    cta: `<div class="chat-input"><textarea class="textarea" rows="1" placeholder="메시지를 입력하세요" data-chat-text maxlength="2000"></textarea><button class="btn-mini dark" data-chat-send>보내기</button></div>`,
  });
  mountChat(id, { mineIsEditor: editorMode });
}
const EditorChat = (id) => Chat(id, true);

// 대화 목록 (의뢰인: 내 의뢰들 / 에디터: 전체)
async function Inbox(editorMode = false) {
  const reqs = editorMode ? await api.listAllRequests() : await api.listMyRequests(state.user);
  const [last, unread] = await Promise.all([
    api.latestMessages(editorMode ? null : reqs.map((r) => r.id)),
    api.unreadMessageMap(state.user, editorMode ? "#/editor/chat/" : "#/chat/"),
  ]);
  const rows = reqs.filter((r) => editorMode ? last[r.id] : r.status !== "cancelled" || last[r.id])
    .sort((a, b) => ((last[b.id]?.created_at) || b.created_at).localeCompare((last[a.id]?.created_at) || a.created_at));
  const tabs = editorMode ? editorTabs("messages", Object.values(unread).reduce((a, b) => a + b, 0)) : "";
  layout(`
    ${tabs}
    ${rows.length ? rows.map((r) => {
      const m = last[r.id];
      const n = unread[r.id] || 0;
      return `<a class="card inbox-row" href="${editorMode ? "#/editor/chat/" : "#/chat/"}${esc(r.id)}" style="display:block;text-decoration:none">
        <div class="row"><b class="ellipsis">${editorMode ? esc(r.profiles?.nickname || "의뢰인") + " · " : ""}${esc(titleOf(r))}</b>
          ${n ? `<span class="count-pill">${n > 9 ? "9+" : n}</span>` : `<span class="muted small nowrap">${m ? fmtDateTime(m.created_at) : ""}</span>`}</div>
        <div class="muted small ellipsis" style="margin-top:4px">${m ? `${m.from_editor === editorMode ? "나: " : ""}${esc(m.body)}` : "아직 메시지가 없어요 · 눌러서 대화 시작"}</div>
      </a>`;
    }).join("") : `<div class="card empty" style="padding:36px 0">${editorMode ? "아직 받은 메시지가 없어요" : "진행 중인 의뢰가 없어요<br/>의뢰를 맡기면 에디터와 메시지를 주고받을 수 있어요"}</div>`}
  `, { title: editorMode ? "에디터 페이지" : "메시지", back: editorMode ? "#/me" : "#/", bell: true, wide: editorMode });
}
const ClientInbox = () => Inbox(false);
const EditorInbox = () => Inbox(true);

// ---------------------------------------------------------
// 공지사항
// ---------------------------------------------------------
async function Notices() {
  const list = await api.listNotices();
  layout(list.length ? `<div class="card" style="padding-top:4px;padding-bottom:4px"><div class="rows">${list.map((n) => `
      <a class="row" href="#/notices/${esc(n.id)}" style="text-decoration:none;align-items:flex-start">
        <span style="min-width:0;flex:1">${n.pinned ? '<span class="badge" style="margin-right:6px">고정</span>' : ""}<b>${esc(n.title)}</b>
          <span class="muted small" style="display:block;margin-top:2px">${fmtDateTime(n.created_at)}</span></span>${ICON.right}
      </a>`).join("")}</div></div>` : '<div class="card empty" style="padding:40px 0">아직 공지사항이 없어요</div>',
  { title: "공지사항", back: "#/", bell: true });
}

async function NoticeDetail(id) {
  const n = await api.getNotice(id);
  if (!n) { layout('<div class="empty">공지사항을 찾을 수 없어요</div>', { title: "공지사항", back: "#/notices" }); return; }
  layout(`
    <div class="card">
      ${n.pinned ? '<span class="badge">고정</span>' : ""}
      <h2 style="font-size:20px;margin:8px 0 4px;line-height:1.4">${esc(n.title)}</h2>
      <div class="muted small">${fmtDateTime(n.created_at)}${n.updated_at && n.updated_at.slice(0, 16) !== n.created_at.slice(0, 16) ? ` · ${fmtDateTime(n.updated_at)} 수정` : ""}</div>
      <div style="margin-top:18px;white-space:pre-wrap;word-break:break-word;line-height:1.7">${linkify(n.body)}</div>
    </div>`, { title: "공지사항", back: "#/notices", bell: true });
}

// 본문 속 링크를 눌러서 열 수 있게
function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+/g, (u) => {
    const raw = u.replace(/&amp;/g, "&");
    return safeUrl(raw) ? `<a href="${u}" target="_blank" rel="noopener noreferrer" class="link-accent">${u}</a>` : u;
  });
}

async function EditorNotices() {
  const list = await api.listNotices();
  const editId = sessionStorage.getItem("ec-notice-edit");
  const cur = list.find((n) => n.id === editId) || { title: "", body: "", pinned: false };
  layout(`
    ${editorTabs("notices")}
    <div class="card">
      <div class="title-m">${cur.id ? "공지 수정" : "새 공지 쓰기"}</div>
      <input class="input field" maxlength="100" placeholder="제목" value="${esc(cur.title)}" data-n-title />
      <textarea class="textarea field" style="height:180px" maxlength="5000" placeholder="내용 (링크를 넣으면 눌러서 열 수 있어요)" data-n-body>${esc(cur.body)}</textarea>
      <div class="check-row" data-n-pin role="checkbox" aria-checked="${!!cur.pinned}" tabindex="0">
        <span class="checkbox ${cur.pinned ? "on" : ""}">${cur.pinned ? ICON.checkSm : ""}</span><span>맨 위에 고정</span>
      </div>
      <div class="check-row" data-n-notify role="checkbox" aria-checked="${!cur.id}" tabindex="0">
        <span class="checkbox ${!cur.id ? "on" : ""}">${!cur.id ? ICON.checkSm : ""}</span><span>모든 회원에게 알림 보내기</span>
      </div>
      <div class="grid-2" style="margin-top:16px">
        <button class="btn-sub" style="background:#f3f3f3" data-n-cancel>${cur.id ? "수정 취소" : "비우기"}</button>
        <button class="btn-sub" data-n-save>${cur.id ? "수정 저장" : "공지 올리기"}</button>
      </div>
    </div>
    <div class="section-title">올린 공지 ${list.length}개</div>
    ${list.length ? `<div class="card" style="padding-top:4px;padding-bottom:4px"><div class="rows">${list.map((n) => `
      <div class="row">
        <a href="#/notices/${esc(n.id)}" style="min-width:0;flex:1;text-decoration:none">${n.pinned ? '<span class="badge" style="margin-right:6px">고정</span>' : ""}<b>${esc(n.title)}</b>
          <span class="muted small" style="display:block">${fmtDateTime(n.created_at)}</span></a>
        <div class="row" style="gap:6px;flex:none">
          <button class="btn-mini" data-n-edit="${esc(n.id)}">수정</button>
          <button class="btn-mini danger" data-n-del="${esc(n.id)}">삭제</button>
        </div>
      </div>`).join("")}</div></div>` : '<div class="card empty">아직 올린 공지가 없어요</div>'}
  `, { title: "에디터 페이지", back: "#/me", wide: true, bell: true });

  const flags = { pinned: !!cur.pinned, notify: !cur.id };
  const toggle = (sel, key) => {
    const el = $app.querySelector(sel);
    const flip = () => {
      flags[key] = !flags[key];
      el.setAttribute("aria-checked", flags[key]);
      const cb = el.querySelector(".checkbox"); cb.classList.toggle("on", flags[key]); cb.innerHTML = flags[key] ? ICON.checkSm : "";
    };
    el.addEventListener("click", flip);
    el.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); flip(); } });
  };
  toggle("[data-n-pin]", "pinned");
  toggle("[data-n-notify]", "notify");
  on("[data-n-cancel]", "click", () => { sessionStorage.removeItem("ec-notice-edit"); EditorNotices(); });
  on("[data-n-edit]", "click", (e) => { sessionStorage.setItem("ec-notice-edit", e.currentTarget.dataset.nEdit); EditorNotices(); });
  on("[data-n-del]", "click", async (e) => {
    if (!confirm("이 공지를 삭제할까요?")) return;
    await api.deleteNotice(e.currentTarget.dataset.nDel);
    sessionStorage.removeItem("ec-notice-edit");
    toast("공지를 삭제했어요"); EditorNotices();
  });
  on("[data-n-save]", "click", async (e) => {
    const title = $app.querySelector("[data-n-title]").value.trim();
    const body = $app.querySelector("[data-n-body]").value.trim();
    if (!title) { toast("제목을 적어 주세요"); return; }
    e.currentTarget.disabled = true;
    try {
      const saved = await api.saveNotice({ id: cur.id, title, body, pinned: flags.pinned });
      if (flags.notify) await api.broadcastNotice(saved);
      sessionStorage.removeItem("ec-notice-edit");
      toast(flags.notify ? "공지를 올리고 모든 회원에게 알렸어요" : (cur.id ? "공지를 수정했어요" : "공지를 올렸어요"));
      EditorNotices();
    } catch (err) { toast("저장하지 못했어요: " + err.message); e.currentTarget.disabled = false; }
  });
}

function editorTabs(active, unreadMsgs = 0) {
  return `<div class="seg">
    <a class="seg-btn ${active === "requests" ? "on" : ""}" href="#/editor">요청서</a>
    <a class="seg-btn ${active === "messages" ? "on" : ""}" href="#/editor/messages">메시지${unreadMsgs ? ` <span class="count-pill">${unreadMsgs > 9 ? "9+" : unreadMsgs}</span>` : ""}</a>
    <a class="seg-btn ${active === "notices" ? "on" : ""}" href="#/editor/notices">공지</a>
  </div>`;
}

// ---------------------------------------------------------
// 에디터 페이지
// ---------------------------------------------------------
const FILTERS = [
  ["all", "전체", () => true],
  ["pay", "입금 확인 중", (r) => r.status === "awaiting_payment"],
  ["work", "진행 중", (r) => r.status === "confirmed" && r.stage < 5],
  ["revise", "수정 요청", (r) => r.status === "confirmed" && r.client_note && r.revision_requested_at],
  ["done", "납품 완료", (r) => r.stage >= 5],
  ["cancel", "취소", (r) => r.status === "cancelled"],
];

async function EditorList() {
  const all = await api.listAllRequests();
  const f = sessionStorage.getItem("ec-filter") || "pay";
  const [, , fn] = FILTERS.find((x) => x[0] === f) || FILTERS[0];
  const list = all.filter(fn);
  const unreadMsgs = Object.values(await api.unreadMessageMap(state.user, "#/editor/chat/")).reduce((a, b) => a + b, 0);
  layout(`
    ${editorTabs("requests", unreadMsgs)}
    <div class="tabs">${FILTERS.map(([k, label, ff]) => `<button class="tab ${k === f ? "on" : ""}" data-filter="${k}">${label} ${all.filter(ff).length}</button>`).join("")}</div>
    <div style="margin-top:16px">
      ${list.length ? list.map((r) => `
        <a class="card" href="#/editor/${esc(r.id)}" style="display:block;text-decoration:none">
          <div class="row"><b class="ellipsis">${esc(titleOf(r))}</b>${statusBadge(r)}</div>
          <div class="muted small" style="margin-top:4px">${esc(r.profiles?.nickname || "의뢰인")} · 접수 ${fmtDateTime(r.created_at)} · 입금자 ${esc(r.depositor || "-")}</div>
          <div class="row" style="margin-top:8px"><span>마감 ${fmtDate(r.deadline)} <b class="accent">${ddayText(r.deadline)}</b></span><b>${won(r.total)}</b></div>
        </a>`).join("") : '<div class="card empty">해당하는 요청서가 없어요</div>'}
    </div>`, { title: "에디터 페이지", back: "#/me", wide: true, bell: true });
  on("[data-filter]", "click", (e) => { sessionStorage.setItem("ec-filter", e.currentTarget.dataset.filter); EditorList(); });
}

async function EditorDetail(id) {
  const r = await api.getRequest(id);
  if (!r) { layout('<div class="empty">요청서를 찾을 수 없어요</div>', { title: "요청서", back: "#/editor", wide: true }); return; }
  const c = calc(r);
  const sd = JSON.parse(JSON.stringify(r.stage_dates || {}));
  const opts = [r.extra_sec ? `분량 ${r.extra_sec}초 추가 (${won(c.secFee)})` : "", r.opt_private ? `포트폴리오 비공개 (${won(c.privateFee)})` : "",
    r.opt_fast ? `빠른 마감 (${won(c.fastFee)})` : "", r.opt_commercial ? `상업적 사용 ×${P.commercial} (${won(c.commercialFee)})` : ""].filter(Boolean).join("\n") || "없음";
  const link = (u) => { const s = safeUrl(u); return s ? `<a href="${esc(s)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>` : esc(u); };
  const sources = (r.sources || []).map((s) => `${esc(s.time || "-")}  ${link(s.url || "")}`).join("<br/>") || "없음";
  const refs = (r.refs || []).map(link).join("<br/>") || "없음";

  layout(`
    <div class="card">
      <div class="row"><span class="title-m">${esc(titleOf(r))}</span>${statusBadge(r)}</div>
      <div class="muted small" style="margin:4px 0 14px">${esc(r.profiles?.nickname || "의뢰인")} · 접수 ${fmtDateTime(r.created_at)}</div>
      <dl class="kv">
        <dt>기념일</dt><dd>${esc(r.occasion || "-")}</dd>
        <dt>멤버</dt><dd>${esc(r.member || "-")}</dd>
        <dt>곡 · 구간</dt><dd>${esc(r.song || "-")}</dd>
        <dt>마감일</dt><dd>${fmtDate(r.deadline)} (${ddayText(r.deadline)})</dd>
        <dt>예정 업로드일</dt><dd>${fmtDate(r.upload_date)}</dd>
        <dt>영상 소스</dt><dd>${sources}</dd>
        <dt>레퍼런스</dt><dd>${refs}</dd>
        <dt>파일 규격</dt><dd>${esc(r.ratio || "-")}</dd>
        <dt>요청사항</dt><dd>${esc(r.notes || "-")}</dd>
        <dt>크레딧</dt><dd>${esc(r.credit || "-")}</dd>
      </dl>
    </div>

    <div class="section-title">결제</div>
    <div class="card">
      <dl class="kv">
        <dt>타입</dt><dd>${TYPES[r.edit_type]?.label || "-"} (${won(c.base)})</dd>
        <dt>추가 옵션</dt><dd>${esc(opts)}</dd>
        <dt>총 금액</dt><dd><b class="accent">${won(r.total)}</b></dd>
        <dt>입금자명</dt><dd><b>${esc(r.depositor || "-")}</b></dd>
      </dl>
      <div class="row" style="margin-top:14px;justify-content:flex-start;gap:8px;flex-wrap:wrap">
        ${r.status === "awaiting_payment" ? '<button class="btn-mini dark" data-confirm>입금 확인했어요</button>' : ""}
        ${r.status !== "cancelled" ? '<button class="btn-mini danger" data-cancel>의뢰 취소</button>' : '<button class="btn-mini" data-restore>취소 되돌리기</button>'}
      </div>
    </div>

    <div class="section-title">진행판 관리</div>
    <div class="card">
      <label class="bold">현재 단계</label>
      <select class="select field" data-stage>
        <option value="0" ${r.stage === 0 ? "selected" : ""}>시작 전</option>
        ${STAGES.map((n, i) => `<option value="${i + 1}" ${r.stage === i + 1 ? "selected" : ""}>${i + 1}. ${n}${i === 4 ? " (완료)" : " 진행 중"}</option>`).join("")}
      </select>
      <p class="muted small" style="margin:8px 0 12px">단계를 올리면 이전 단계에 오늘 날짜로 완료가 찍혀요. 예정일은 의뢰인 진행판에 보여요.</p>
      ${STAGES.map((n, i) => `<div class="stage-edit"><span>${i + 1}. ${n}${sd[i + 1]?.done ? ` <span class="muted small">· ${fmtDate(sd[i + 1].done)} 완료</span>` : ""}</span>
        <input type="date" value="${esc(sd[i + 1]?.plan || "")}" data-plan="${i + 1}" aria-label="${n} 예정일" /></div>`).join("")}
    </div>

    <div class="section-title">납품하기</div>
    <div class="card">
      ${r.delivery_url ? `<div class="notice" style="margin-bottom:12px">
          <b>${fmtDateTime(r.delivered_at)} 납품 완료</b> · ${r.received_at ? `의뢰인이 ${fmtDateTime(r.received_at)}에 받았어요` : "의뢰인이 아직 확인 전이에요"}
        </div>` : ""}
      <input class="input" placeholder="완성본 구글 드라이브 링크" value="${esc(r.delivery_url || "")}" data-dv-url inputmode="url" />
      <textarea class="textarea field" style="height:80px" placeholder="의뢰인에게 남길 말 (예: 4K 원본과 자막 없는 버전도 함께 넣었어요)" data-dv-note>${esc(r.delivery_note || "")}</textarea>
      <p class="muted small" style="margin:8px 0 0">드라이브 공유 설정을 <b>"링크가 있는 모든 사용자"</b>로 바꿔야 의뢰인이 열 수 있어요.</p>
      <button class="btn btn-primary" style="margin-top:12px;height:48px;font-size:15px" data-deliver>${r.delivery_url ? "납품 링크 다시 보내기" : "납품하기"}</button>
    </div>

    <div class="section-title">미리보기 보내기</div>
    <div class="card">
      <input class="input" placeholder="제목 (예: 효과 추가 단계 미리 보기)" value="${esc(r.preview_label || "")}" data-pv-label />
      <input class="input field" placeholder="미리보기 링크 (구글 드라이브, 유튜브 일부공개 등)" value="${esc(r.preview_url || "")}" data-pv-url inputmode="url" />
      <p class="muted small" style="margin:8px 0 0">링크를 저장하면 의뢰인이 진행판에서 보고 "이대로 좋아요 / 수정 요청"을 누를 수 있어요.</p>
    </div>

    <div class="section-title">의뢰인 피드백</div>
    <div class="card">
      <div>수정 요청 ${r.revision_count || 0}회 (무료 ${CFG.FREE_REVISIONS}회)</div>
      ${r.client_note ? `<div class="notice" style="margin-top:10px"><b>수정 요청</b> · ${fmtDateTime(r.revision_requested_at)}<br/>${esc(r.client_note)}</div>
        <button class="btn-mini" style="margin-top:10px" data-clear-note>반영했어요 (요청 닫기)</button>` : ""}
      ${r.stage > 0 && r.client_approved_stage >= r.stage && !r.client_note ? '<div class="notice" style="margin-top:10px">의뢰인이 현재 단계를 "이대로 좋아요"로 확인했어요</div>' : ""}
    </div>

    <div class="section-title">의뢰인과 메시지</div>
    <div class="card">
      <div class="chat-list" data-chat-list><div class="empty">불러오는 중…</div></div>
      <div class="chat-input">
        <textarea class="textarea" rows="1" placeholder="의뢰인에게 보낼 메시지" data-chat-text maxlength="2000"></textarea>
        <button class="btn-mini dark" data-chat-send>보내기</button>
      </div>
    </div>

    <div class="section-title">메모 (나만 보기)</div>
    <textarea class="textarea" placeholder="작업 메모" data-memo>${esc(r.editor_memo || "")}</textarea>
  `, { title: "요청서", back: "#/editor", wide: true, bell: true, cta: '<button class="btn btn-primary" data-save>저장하기</button>' });
  mountChat(id, { mineIsEditor: true });

  const upd = async (patch, msg) => {
    try { await api.editorUpdate(id, patch); toast(msg); EditorDetail(id); }
    catch (e) { toast("저장하지 못했어요: " + e.message); }
  };
  on("[data-confirm]", "click", () => {
    const t = isoDay(today());
    sd[1] = { ...(sd[1] || {}), plan: sd[1]?.plan || t };
    upd({ status: "confirmed", stage: Math.max(1, r.stage), stage_dates: sd }, "입금 확인 완료 · 1단계(요청 확인)로 시작했어요");
  });
  on("[data-cancel]", "click", () => { if (confirm("이 의뢰를 취소 처리할까요? 환불은 직접 해 주세요.")) upd({ status: "cancelled" }, "취소 처리했어요"); });
  on("[data-restore]", "click", () => upd({ status: r.stage > 0 ? "confirmed" : "awaiting_payment" }, "취소를 되돌렸어요"));
  on("[data-deliver]", "click", () => {
    const url = $app.querySelector("[data-dv-url]").value.trim();
    const note = $app.querySelector("[data-dv-note]").value.trim();
    if (!safeUrl(url)) { toast("https:// 로 시작하는 드라이브 링크를 넣어 주세요"); return; }
    if (!confirm("이 링크로 납품할까요? 의뢰인에게 알림이 가요.")) return;
    const t = isoDay(today());
    for (let k = 1; k <= 5; k++) { sd[k] = { ...(sd[k] || {}) }; if (!sd[k].done) sd[k].done = t; }
    upd({ delivery_url: url, delivery_note: note || null, delivered_at: new Date().toISOString(), received_at: url === r.delivery_url ? r.received_at : null,
      stage: 5, stage_dates: sd, status: "confirmed" }, "납품했어요 · 의뢰인에게 알림이 갔어요");
  });
  on("[data-clear-note]", "click", () => upd({ client_note: null, revision_requested_at: null }, "수정 요청을 닫았어요"));
  on("[data-save]", "click", () => {
    const stage = Number($app.querySelector("[data-stage]").value);
    const t = isoDay(today());
    $app.querySelectorAll("[data-plan]").forEach((i) => {
      const k = i.dataset.plan; sd[k] = { ...(sd[k] || {}) };
      if (i.value) sd[k].plan = i.value; else delete sd[k].plan;
    });
    for (let k = 1; k <= 5; k++) {
      sd[k] = sd[k] || {};
      const finished = stage > k || (stage === 5 && k === 5);
      if (finished && !sd[k].done) sd[k].done = t;
      if (!finished) delete sd[k].done;
    }
    const patch = {
      stage, stage_dates: sd,
      preview_label: $app.querySelector("[data-pv-label]").value.trim() || null,
      preview_url: $app.querySelector("[data-pv-url]").value.trim() || null,
      editor_memo: $app.querySelector("[data-memo]").value,
    };
    if (stage > 0 && r.status === "awaiting_payment") patch.status = "confirmed";
    upd(patch, "저장했어요");
  });
}

// ---------------------------------------------------------
// 라우터
// ---------------------------------------------------------
const ROUTES = [
  [/^#\/login$/, Login, false],
  [/^(#\/?)?$/, Home],
  [/^#\/new$/, NewForm],
  [/^#\/new\/price$/, Price],
  [/^#\/new\/pay$/, Pay],
  [/^#\/done\/([\w-]+)$/, Done],
  [/^#\/request\/([\w-]+)$/, Progress],
  [/^#\/me$/, MyPage],
  [/^#\/notifications$/, Notifications],
  [/^#\/chat\/([\w-]+)$/, Chat],
  [/^#\/messages$/, ClientInbox],
  [/^#\/notices$/, Notices],
  [/^#\/notices\/([\w-]+)$/, NoticeDetail],
  [/^#\/editor$/, EditorList, true, true],
  [/^#\/editor\/messages$/, EditorInbox, true, true],
  [/^#\/editor\/notices$/, EditorNotices, true, true],
  [/^#\/editor\/chat\/([\w-]+)$/, EditorChat, true, true],
  [/^#\/editor\/([\w-]+)$/, EditorDetail, true, true],
];

async function render() {
  const h = location.hash;
  const match = ROUTES.find(([re]) => re.test(h)) || ROUTES[1];
  const [re, screen, needAuth = true, needEditor = false] = match;
  if (needAuth && !state.user) return Login();
  if (!needAuth && state.user) return go("#/");
  if (needEditor && !state.editor) return go("#/");
  try {
    await screen(...(h.match(re) || []).slice(1));
  } catch (err) {
    console.error(err);
    layout(`<div class="card"><b>문제가 생겼어요</b><p class="muted small">${esc(err.message)}</p><button class="btn-sub" data-retry>다시 시도</button></div>`, { title: "", back: "#/" });
    on("[data-retry]", "click", render);
  }
}

let liveUnsub = null;
function startLive() {
  if (liveUnsub) liveUnsub();
  liveUnsub = api.subscribe(state.user, {
    onNotification: (n) => {
      toast("🔔 " + n.title);
      refreshBadge();
      if (location.hash === "#/notifications") Notifications();
      if (n.kind === "message" && location.hash === "#/messages") ClientInbox();
      if (n.kind === "message" && location.hash === "#/editor/messages") EditorInbox();
      if (location.hash === "#/editor") EditorList();
    },
  });
}

async function loadSession() {
  state.user = await api.getUser();
  if (state.user) {
    [state.profile, state.editor] = await Promise.all([api.getProfile(state.user), api.isEditor()]);
  } else {
    state.profile = null; state.editor = false;
  }
}

(async function start() {
  try {
    await api.init();
    await loadSession();
    if (location.search.includes("code=")) history.replaceState(null, "", location.pathname + location.hash);
    startLive();
    api.onAuthChange(async (user) => {
      if ((user?.id || null) === (state.user?.id || null)) return;
      await loadSession();
      startLive();
      render();
    });
  } catch (err) {
    console.error(err);
    $app.innerHTML = `<div class="loading">연결하지 못했어요<br/><span class="small">${esc(err.message)}</span></div>`;
    return;
  }
  window.addEventListener("hashchange", render);
  render();
})();
