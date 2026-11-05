// 데이터 처리: Supabase(실제) 또는 체험 모드(이 기기 저장소)
const CFG = window.APP_CONFIG || {};
export const DEMO = !CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY;

let sb = null;

export async function init() {
  if (DEMO) return;
  let mod;
  try {
    mod = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  } catch {
    mod = await import("https://esm.sh/@supabase/supabase-js@2");
  }
  const { createClient } = mod;
  sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" },
  });
}

function check({ data, error }) {
  if (error) throw new Error(error.message || "요청을 처리하지 못했어요");
  return data;
}

// ---------------------------------------------------------
// 체험 모드 저장소
// ---------------------------------------------------------
const KEY = "edit-commission-demo-v1";
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s) return s;
  } catch {}
  return { user: null, profiles: {}, requests: [], anniversaries: [] };
}
function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}
function demoTotal(r) {
  const P = CFG.PRICES;
  const base = P[r.edit_type] || 0;
  const sum = base + Math.floor((r.extra_sec || 0) / 5) * P.per5sec
    + (r.opt_private ? P.private : 0) + (r.opt_fast ? P.fast : 0);
  return sum * (r.opt_commercial ? P.commercial : 1);
}
function seedOther(s) {
  if (s.requests.some((r) => r.user_id === "demo-other")) return;
  s.profiles["demo-other"] = { id: "demo-other", nickname: "다른 의뢰인" };
  const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const r = {
    id: uid(), user_id: "demo-other", created_at: new Date(Date.now() - 3600e3).toISOString(),
    occasion: "데뷔 기념일", member: "[그룹] 단체", song: "타이틀곡 · 00:30~01:00",
    sources: [{ time: "00:12", url: "https://example.com/source" }], refs: [],
    notes: "밝고 경쾌한 분위기로 부탁드려요", credit: "edit by @other", ratio: "16:9",
    deadline: d(14), upload_date: d(15), edit_type: "A", extra_sec: 10,
    opt_private: false, opt_fast: false, opt_commercial: false, depositor: "김의뢰",
    status: "awaiting_payment", stage: 0, stage_dates: {}, revision_count: 0, client_approved_stage: 0,
  };
  r.total = demoTotal(r);
  s.requests.push(r);
}

// ---------------------------------------------------------
// 로그인
// ---------------------------------------------------------
export async function getUser() {
  if (DEMO) return load().user;
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

export function onAuthChange(cb) {
  if (DEMO) return;
  sb.auth.onAuthStateChange((_e, session) => cb(session?.user ?? null));
}

export async function loginWithKakao() {
  if (DEMO) {
    const s = load();
    s.user = { id: "demo-me", email: "demo@example.com" };
    s.profiles["demo-me"] = s.profiles["demo-me"] || {
      id: "demo-me", nickname: "체험 사용자", default_ratio: "4:3",
      default_bias: "", default_credit: "",
    };
    if (!s.anniversaries.length) {
      const soon = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
      s.anniversaries.push({ id: uid(), user_id: "demo-me", title: "[멤버] 생일", date: soon, notify: true });
    }
    seedOther(s);
    save(s);
    return;
  }
  const { error } = await sb.auth.signInWithOAuth({
    provider: "kakao",
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) throw new Error(error.message);
}

export async function logout() {
  if (DEMO) {
    const s = load();
    s.user = null;
    save(s);
    return;
  }
  await sb.auth.signOut();
}

export async function isEditor() {
  if (DEMO) return true;
  const { data, error } = await sb.rpc("is_editor");
  if (error) return false;
  return !!data;
}

// ---------------------------------------------------------
// 프로필
// ---------------------------------------------------------
export async function getProfile(user) {
  if (DEMO) return load().profiles[user.id];
  const { data } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (data) return data;
  const meta = user.user_metadata || {};
  return check(await sb.from("profiles").insert({
    id: user.id,
    nickname: meta.nickname || meta.name || meta.full_name || "의뢰인",
    avatar_url: meta.avatar_url || meta.picture || null,
  }).select().single());
}

export async function updateProfile(user, patch) {
  if (DEMO) {
    const s = load();
    s.profiles[user.id] = { ...s.profiles[user.id], ...patch };
    save(s);
    return s.profiles[user.id];
  }
  return check(await sb.from("profiles").update(patch).eq("id", user.id).select().single());
}

// ---------------------------------------------------------
// 요청서
// ---------------------------------------------------------
export async function listMyRequests(user) {
  if (DEMO) {
    return load().requests.filter((r) => r.user_id === user.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  return check(await sb.from("requests").select("*").eq("user_id", user.id)
    .order("created_at", { ascending: false }));
}

export async function getRequest(id) {
  if (DEMO) {
    const s = load();
    const r = s.requests.find((x) => x.id === id);
    return r ? { ...r, profiles: s.profiles[r.user_id] || null } : null;
  }
  return check(await sb.from("requests").select("*, profiles(nickname, avatar_url)").eq("id", id).maybeSingle());
}

const FIELDS = ["occasion", "member", "song", "sources", "refs", "notes", "credit", "ratio",
  "deadline", "upload_date", "edit_type", "extra_sec", "opt_private", "opt_fast", "opt_commercial", "depositor"];

export async function createRequest(user, draft) {
  const row = {};
  for (const k of FIELDS) row[k] = draft[k] ?? null;
  row.deadline = row.deadline || null;
  row.upload_date = row.upload_date || null;
  if (DEMO) {
    const s = load();
    const r = {
      ...row, id: uid(), user_id: user.id, created_at: new Date().toISOString(),
      status: "awaiting_payment", stage: 0, stage_dates: {}, revision_count: 0, client_approved_stage: 0,
    };
    r.total = demoTotal(r);
    s.requests.push(r);
    save(s);
    return r;
  }
  return check(await sb.from("requests").insert(row).select().single());
}

export async function approvePreview(id) {
  if (DEMO) {
    const s = load();
    const r = s.requests.find((x) => x.id === id);
    r.client_approved_stage = r.stage;
    r.client_note = null;
    save(s);
    return;
  }
  check(await sb.rpc("approve_preview", { rid: id }));
}

export async function requestRevision(id, note) {
  if (DEMO) {
    const s = load();
    const r = s.requests.find((x) => x.id === id);
    r.revision_count = (r.revision_count || 0) + 1;
    r.client_note = note;
    r.revision_requested_at = new Date().toISOString();
    save(s);
    return;
  }
  check(await sb.rpc("request_revision", { rid: id, note }));
}

// ---------------------------------------------------------
// 에디터
// ---------------------------------------------------------
export async function listAllRequests() {
  if (DEMO) {
    const s = load();
    return s.requests.map((r) => ({ ...r, profiles: s.profiles[r.user_id] || null }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  return check(await sb.from("requests").select("*, profiles(nickname, avatar_url)")
    .order("created_at", { ascending: false }));
}

export async function editorUpdate(id, patch) {
  if (DEMO) {
    const s = load();
    const i = s.requests.findIndex((x) => x.id === id);
    s.requests[i] = { ...s.requests[i], ...patch };
    s.requests[i].total = demoTotal(s.requests[i]);
    save(s);
    return s.requests[i];
  }
  return check(await sb.from("requests").update(patch).eq("id", id).select().single());
}

// ---------------------------------------------------------
// 기념일
// ---------------------------------------------------------
export async function listAnniversaries(user) {
  if (DEMO) return load().anniversaries.filter((a) => a.user_id === user.id);
  return check(await sb.from("anniversaries").select("*").eq("user_id", user.id).order("date"));
}

export async function addAnniversary(user, a) {
  if (DEMO) {
    const s = load();
    const row = { id: uid(), user_id: user.id, notify: true, ...a };
    s.anniversaries.push(row);
    save(s);
    return row;
  }
  return check(await sb.from("anniversaries").insert({ title: a.title, date: a.date, notify: true }).select().single());
}

export async function updateAnniversary(id, patch) {
  if (DEMO) {
    const s = load();
    const a = s.anniversaries.find((x) => x.id === id);
    Object.assign(a, patch);
    save(s);
    return a;
  }
  return check(await sb.from("anniversaries").update(patch).eq("id", id).select().single());
}

export async function deleteAnniversary(id) {
  if (DEMO) {
    const s = load();
    s.anniversaries = s.anniversaries.filter((x) => x.id !== id);
    save(s);
    return;
  }
  check(await sb.from("anniversaries").delete().eq("id", id));
}

export function resetDemo() {
  try { localStorage.removeItem(KEY); } catch {}
}
