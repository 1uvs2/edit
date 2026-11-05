import * as api from "./api.js";

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
function layout(body, { title, back, cta = "", wide = false, home = false } = {}) {
  $app.className = "app" + (wide ? " wide" : "");
  const bar = api.DEMO ? '<div class="demo-bar">체험 모드 · 이 기기에만 저장돼요 (config.js 에 Supabase 키를 넣으면 실제 서비스로 바뀌어요)</div>' : "";
  const head = home
    ? `<header class="top"><span class="logo" aria-label="에딧 커미션">S2</span><a class="icon-btn" href="#/me" aria-label="마이페이지">${ICON.user}</a></header>`
    : `<header class="top">${back !== false ? `<button class="back" data-back aria-label="뒤로">${ICON.back}</button>` : ""}<h1>${esc(title || "")}</h1></header>`;
  $app.innerHTML = `${bar}${head}<main class="page">${body}</main>${cta ? `<div class="cta">${cta}</div>` : ""}`;
  $app.querySelector("[data-back]")?.addEventListener("click", () => {
    if (typeof back === "string") go(back); else history.length > 1 ? history.back() : go("#/");
  });
  window.scrollTo(0, 0);
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
      <span class="logo" style="font-size:44px;flex:none">S2</span>
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
  const [reqs, annis] = await Promise.all([api.listMyRequests(state.user), api.listAnniversaries(state.user)]);
  const active = reqs.find((r) => r.status !== "cancelled" && r.stage < 5);
  const p = state.profile || {};
  const upcoming = annis.filter((a) => a.notify)
    .map((a) => ({ ...a, next: nextOccurrence(a.date) }))
    .filter((a) => a.next && (a.next - today()) / 86400000 <= 30)
    .sort((a, b) => a.next - b.next)[0];

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

  const priceRows = Object.entries(TYPES).map(([k, t]) => `
    <div class="row"><span><b>${t.label}</b> <span class="small">${esc(t.title.split("· ")[1])} [${esc(t.desc)}]</span></span><b class="nowrap">${won(P[k])}</b></div>`).join("");

  const n = upcoming ? Math.round((upcoming.next - today()) / 86400000) : null;
  layout(`
    ${activeCard}
    <div class="card" style="margin-top:22px">
      <div class="title-m" style="margin-bottom:4px">가격</div>
      <div class="rows">${priceRows}</div>
      <p class="muted small" style="margin:8px 0 0">옵션 추가 별도 · 분량 5초당 ${won(P.per5sec)}</p>
    </div>
    <div class="section-title">내 카드</div>
    <div class="card">
      <div style="margin-bottom:6px">${upcoming ? `${esc(upcoming.title)}까지 ${n === 0 ? "D-day" : "D-" + n}! 새 요청서에 아래 값이 미리 채워져요` : "새 요청서에 아래 값이 미리 채워져요"}</div>
      <div class="rows">
        <div class="row"><span class="muted">최애</span><b>${esc(p.default_bias || "미설정")}</b></div>
        <div class="row"><span class="muted">규격</span><b>${esc(p.default_ratio || "4:3")}</b></div>
        <div class="row"><span class="muted">크레딧</span><b>${esc(p.default_credit || "미설정")}</b></div>
      </div>
      <button class="btn-sub" data-new-default style="margin-top:8px">내 기본값으로 채우기</button>
    </div>`, { home: true, cta: '<button class="btn btn-primary" data-new>새 에딧 맡기기</button>' });
  on("[data-new]", "click", () => { setDraft(emptyDraft(false)); go("#/new"); });
  on("[data-new-default]", "click", () => { setDraft(emptyDraft(true)); go("#/new"); });
}

// ---------------------------------------------------------
// 요청서 작성
// ---------------------------------------------------------
async function NewForm() {
  const d = getDraft() || emptyDraft(true);
  setDraft(d);
  const p = state.profile || {};
  const mine = await api.listMyRequests(state.user);
  const last = mine[0];

  const srcRows = d.sources.map((s, i) => `
    <div class="src-row">
      <input class="input" placeholder="00:00" value="${esc(s.time)}" data-src-time="${i}" aria-label="소스 시간" />
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
      ${last ? `<button class="btn-sub" data-fill-last style="margin-top:8px">지난 요청 불러와서 채우기</button>` : ""}
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
  `, { title: "에딧 요청서", back: "#/", cta: '<button class="btn btn-primary" data-next>다음으로</button>' });

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
  on("[data-fill-last]", "click", () => {
    Object.assign(d, {
      member: last.member || "", song: last.song || "", occasion: last.occasion || "",
      sources: last.sources?.length ? last.sources.map((s) => ({ ...s })) : [{ time: "", url: "" }],
      refs: last.refs?.length ? [...last.refs] : [""], notes: last.notes || "", credit: last.credit || "", ratio: last.ratio || d.ratio,
    });
    toast("지난 요청 내용으로 채웠어요 (날짜는 새로 골라 주세요)"); rerender();
  });
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
    </div>`, { title: "가격", back: "#/new", cta: '<button class="btn btn-primary" data-next>이 구성으로 결제하기</button>' });

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
    ${banner}
    <div class="section-title">현재 진행 상황</div>
    <div class="card">${stepsHtml(r)}</div>
    ${preview}
  `, { title: "진행 중인 의뢰", back: "#/", cta: '<button class="btn btn-primary" data-home>홈으로 돌아가기</button>' });

  bindCopy();
  on("[data-home]", "click", () => go("#/"));
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
  const [reqs, annis] = await Promise.all([api.listMyRequests(state.user), api.listAnniversaries(state.user)]);
  const p = state.profile || {};
  const active = reqs.filter((r) => r.status !== "cancelled" && r.stage < 5);
  const ratio = p.default_ratio || "4:3";
  const initial = (p.nickname || "?").slice(0, 1);
  const annSorted = annis.map((a) => ({ ...a, next: nextOccurrence(a.date) })).sort((a, b) => a.next - b.next);

  layout(`
    <div class="row" style="justify-content:flex-start;gap:14px;margin-top:6px">
      <div class="avatar" ${safeUrl(p.avatar_url) ? `style="background-image:url('${esc(safeUrl(p.avatar_url))}')"` : ""}>${safeUrl(p.avatar_url) ? "" : esc(initial)}</div>
      <div><div class="title-m">${esc(p.nickname || "의뢰인")}</div><div class="small">카카오 로그인 · 의뢰 ${reqs.length}건</div></div>
    </div>

    <div class="section-title">진행 중인 의뢰</div>
    ${active.length ? active.map((r) => `
      <a class="card pick on" href="#/request/${esc(r.id)}" style="text-decoration:none">
        <div class="row"><b class="ellipsis">${esc(titleOf(r))}</b><b class="accent">${ddayText(r.deadline)}</b></div>
        <div class="bar"><i style="width:${Math.round((Math.max(0, r.stage) / 5) * 100)}%"></i></div>
        <div class="muted small">${r.status === "awaiting_payment" ? "입금 확인 중" : `5단계 중 ${r.stage}단계 · ${STAGES[Math.max(0, r.stage - 1)]}`} · 진행판 보기</div>
      </a>`).join("") : '<div class="card empty">진행 중인 의뢰가 없어요</div>'}

    <div class="section-title">다가오는 기념일</div>
    <div class="card" style="padding-top:4px;padding-bottom:4px">
      <div class="rows">
        ${annSorted.length ? annSorted.map((a) => {
          const n = Math.round((a.next - today()) / 86400000);
          return `<div class="row"><div style="min-width:0"><b class="ellipsis" style="display:block">${esc(a.title)}</b>
            <div class="muted small">${fmtDate(a.date)} · ${n === 0 ? "D-day" : "D-" + n} ${a.notify ? "· 홈에 D-30 알림 켜짐" : ""}</div></div>
            <div class="row" style="gap:6px;flex:none"><button class="toggle" role="switch" aria-checked="${!!a.notify}" aria-label="${esc(a.title)} 알림" data-ann-toggle="${esc(a.id)}"></button>
            <button class="x-btn" style="height:31px" data-ann-del="${esc(a.id)}" aria-label="삭제">×</button></div></div>`;
        }).join("") : '<div class="empty">등록한 기념일이 없어요</div>'}
      </div>
    </div>
    <div class="card" style="margin-top:12px;border:1.5px dashed #f2b9ee;box-shadow:none" data-ann-form>
      <input class="input" placeholder="예: [멤버] 생일" data-ann-title />
      <div class="grid-2" style="margin-top:10px;grid-template-columns:minmax(0,1fr) auto">
        <input class="input" type="date" data-ann-date aria-label="기념일 날짜" />
        <button class="btn-mini" style="height:50px;padding:0 20px" data-ann-add>+ 추가</button>
      </div>
    </div>

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
  `, { title: "마이페이지", back: "#/" });

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
  on("[data-ann-toggle]", "click", async (e) => {
    const id = e.currentTarget.dataset.annToggle;
    const a = annis.find((x) => x.id === id);
    await api.updateAnniversary(id, { notify: !a.notify });
    MyPage();
  });
  on("[data-ann-del]", "click", async (e) => {
    if (!confirm("이 기념일을 지울까요?")) return;
    await api.deleteAnniversary(e.currentTarget.dataset.annDel);
    MyPage();
  });
  on("[data-ann-add]", "click", async () => {
    const title = $app.querySelector("[data-ann-title]").value.trim();
    const date = $app.querySelector("[data-ann-date]").value;
    if (!title || !date) { toast("기념일 이름과 날짜를 모두 적어 주세요"); return; }
    await api.addAnniversary(state.user, { title, date });
    toast("기념일을 추가했어요");
    MyPage();
  });
  on("[data-logout]", "click", async () => { await api.logout(); state.user = null; clearDraft(); go("#/login"); });
  on("[data-reset]", "click", () => { if (confirm("체험 데이터를 모두 지울까요?")) { api.resetDemo(); clearDraft(); state.user = null; go("#/login"); } });
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
  layout(`
    <div class="tabs">${FILTERS.map(([k, label, ff]) => `<button class="tab ${k === f ? "on" : ""}" data-filter="${k}">${label} ${all.filter(ff).length}</button>`).join("")}</div>
    <div style="margin-top:16px">
      ${list.length ? list.map((r) => `
        <a class="card" href="#/editor/${esc(r.id)}" style="display:block;text-decoration:none">
          <div class="row"><b class="ellipsis">${esc(titleOf(r))}</b>${statusBadge(r)}</div>
          <div class="muted small" style="margin-top:4px">${esc(r.profiles?.nickname || "의뢰인")} · 접수 ${fmtDateTime(r.created_at)} · 입금자 ${esc(r.depositor || "-")}</div>
          <div class="row" style="margin-top:8px"><span>마감 ${fmtDate(r.deadline)} <b class="accent">${ddayText(r.deadline)}</b></span><b>${won(r.total)}</b></div>
        </a>`).join("") : '<div class="card empty">해당하는 요청서가 없어요</div>'}
    </div>`, { title: "에디터 페이지", back: "#/me", wide: true });
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

    <div class="section-title">메모 (나만 보기)</div>
    <textarea class="textarea" placeholder="작업 메모" data-memo>${esc(r.editor_memo || "")}</textarea>
  `, { title: "요청서", back: "#/editor", wide: true, cta: '<button class="btn btn-primary" data-save>저장하기</button>' });

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
  [/^#\/editor$/, EditorList, true, true],
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
    api.onAuthChange(async (user) => {
      if ((user?.id || null) === (state.user?.id || null)) return;
      await loadSession();
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
