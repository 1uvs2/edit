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
  return { user: null, profiles: {}, requests: [], notifications: [], messages: [] };
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
    status: "pending_review", stage: 0, stage_dates: {}, revision_count: 0, client_approved_stage: 0,
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

// 프로필 사진 올리기: 정사각형 400px JPEG 로 줄여서 저장
export async function uploadAvatar(user, file) {
  const blob = await shrinkImage(file, 400);
  if (DEMO) {
    return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  }
  const path = `${user.id}/avatar-${Date.now()}.jpg`;
  const { error } = await sb.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(error.message);
  return sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

function shrinkImage(file, size) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const c = document.createElement("canvas");
      c.width = c.height = size;
      c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("사진을 처리하지 못했어요"))), "image/jpeg", 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("사진 파일을 열 수 없어요")); };
    img.src = url;
  });
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
    if (s.profiles[user.id]?.blocked) throw new Error("이용이 제한된 계정이에요. 에디터에게 문의해 주세요.");
    const r = {
      ...row, id: uid(), user_id: user.id, created_at: new Date().toISOString(),
      status: "pending_review", stage: 0, stage_dates: {}, revision_count: 0, client_approved_stage: 0,
    };
    r.total = demoTotal(r);
    s.requests.push(r);
    demoNotify(s, user.id, { request_id: r.id, kind: "new_request", title: "새 요청서가 들어왔어요",
      body: `${demoTitle(r)} · ${r.total.toLocaleString("ko-KR")}원 · 입금자 ${r.depositor || "-"}`, link: `#/editor/${r.id}` });
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

export async function confirmReceived(id) {
  if (DEMO) {
    const s = load();
    const r = s.requests.find((x) => x.id === id);
    if (r && r.delivery_url && !r.received_at) {
      r.received_at = new Date().toISOString();
      demoNotify(s, "demo-me", { request_id: r.id, kind: "received", title: "의뢰인이 영상을 받았어요", body: demoTitle(r), link: `#/editor/${r.id}` });
    }
    save(s);
    return;
  }
  check(await sb.rpc("confirm_received", { rid: id }));
}

export async function requestRevision(id, note) {
  if (DEMO) {
    const s = load();
    const r = s.requests.find((x) => x.id === id);
    r.revision_count = (r.revision_count || 0) + 1;
    r.client_note = note;
    r.revision_requested_at = new Date().toISOString();
    r.revision_history = [...(r.revision_history || []), { n: r.revision_count, note, at: r.revision_requested_at, resolved_at: null }];
    demoNotify(s, r.user_id, { request_id: r.id, kind: "revision", title: "수정 요청이 왔어요",
      body: `${demoTitle(r)} · ${note.slice(0, 80)}`, link: `#/editor/${r.id}` });
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

export async function deleteRequest(id) {
  if (DEMO) {
    const s = load();
    s.requests = s.requests.filter((r) => r.id !== id);
    s.messages = (s.messages || []).filter((m) => m.request_id !== id);
    s.notifications = (s.notifications || []).filter((n) => n.request_id !== id);
    save(s);
    return;
  }
  const { data, error } = await sb.from("requests").delete().eq("id", id).select("id");
  if (error) throw new Error(error.message);
  if (!data || !data.length) throw new Error("삭제 권한이 없거나 이미 지워졌어요. 9차 SQL을 실행했는지 확인해 주세요.");
}

export async function editorUpdate(id, patch) {
  if (DEMO) {
    const s = load();
    const i = s.requests.findIndex((x) => x.id === id);
    const old = s.requests[i];
    const r = { ...old, ...patch };
    r.total = demoTotal(r);
    s.requests[i] = r;
    const ttl = demoTitle(r), link = `#/request/${r.id}`;
    const deliveredNow = r.delivery_url && r.delivery_url !== old.delivery_url;
    if (old.status === "pending_review" && r.status === "awaiting_payment") demoNotify(s, r.user_id, { request_id: r.id, kind: "approved_request", title: "요청서가 승인됐어요", body: `${ttl} · 진행판에서 입금 계좌를 확인해 주세요`, link });
    if (deliveredNow) demoNotify(s, r.user_id, { request_id: r.id, kind: "delivered", title: "완성된 영상이 도착했어요", body: `${ttl} · 진행판에서 영상을 받아 주세요`, link });
    if (old.status !== "confirmed" && r.status === "confirmed") demoNotify(s, r.user_id, { request_id: r.id, kind: "confirmed", title: "입금이 확인됐어요", body: `${ttl} 작업을 시작할게요`, link });
    else if (r.stage !== old.stage && r.stage > 0 && !(deliveredNow && r.stage === 5)) demoNotify(s, r.user_id, { request_id: r.id, kind: "stage", title: r.stage === 5 ? "에딧이 납품됐어요" : "진행 상황이 바뀌었어요", body: `${ttl} · ${STAGE_NAMES[r.stage]}${r.stage === 5 ? " 완료" : " 단계 진행 중"}`, link });
    if (r.preview_url && r.preview_url !== old.preview_url) demoNotify(s, r.user_id, { request_id: r.id, kind: "preview", title: "새 미리보기가 도착했어요", body: r.preview_label || ttl, link });
    if (r.status === "cancelled" && old.status !== "cancelled") demoNotify(s, r.user_id, { request_id: r.id, kind: "cancelled", title: old.status === "pending_review" ? "요청서가 반려되었어요" : "의뢰가 취소되었어요", body: ttl + (r.cancel_reason ? " · " + r.cancel_reason : ""), link });
    save(s);
    return s.requests[i];
  }
  return check(await sb.from("requests").update(patch).eq("id", id).select().single());
}

// ---------------------------------------------------------
// 임시저장 (계정에 저장)
// ---------------------------------------------------------
export async function saveDraftRemote(user, draft) {
  const patch = { draft, draft_saved_at: new Date().toISOString() };
  if (DEMO) {
    const s = load();
    s.profiles[user.id] = { ...s.profiles[user.id], ...patch };
    save(s);
    return s.profiles[user.id];
  }
  return check(await sb.from("profiles").update(patch).eq("id", user.id).select().single());
}

export async function clearDraftRemote(user) {
  const patch = { draft: null, draft_saved_at: null };
  if (DEMO) {
    const s = load();
    s.profiles[user.id] = { ...s.profiles[user.id], ...patch };
    save(s);
    return s.profiles[user.id];
  }
  return check(await sb.from("profiles").update(patch).eq("id", user.id).select().single());
}

// ---------------------------------------------------------
// 알림
// ---------------------------------------------------------
function demoNotify(s, userId, n) {
  s.notifications = s.notifications || [];
  s.notifications.push({ id: uid(), user_id: userId, created_at: new Date().toISOString(), read_at: null, ...n });
}
const STAGE_NAMES = ["시작 전", "요청 확인", "컷 편집", "효과 추가", "후반 작업", "납품"];
const demoTitle = (r) => `${r.member || "[멤버]"} ${r.occasion || ""} 에딧`.replace(/\s+/g, " ").trim();

export async function listNotifications(user) {
  if (DEMO) {
    return (load().notifications || []).filter((n) => n.user_id === user.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100);
  }
  return check(await sb.from("notifications").select("*").eq("user_id", user.id)
    .order("created_at", { ascending: false }).limit(100));
}

export async function unreadCount(user) {
  if (DEMO) return (load().notifications || []).filter((n) => n.user_id === user.id && !n.read_at).length;
  const { count, error } = await sb.from("notifications").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).is("read_at", null);
  if (error) return 0;
  return count || 0;
}

export async function markAllRead(user) {
  const now = new Date().toISOString();
  if (DEMO) {
    const s = load();
    (s.notifications || []).forEach((n) => { if (n.user_id === user.id && !n.read_at) n.read_at = now; });
    save(s);
    return;
  }
  await sb.from("notifications").update({ read_at: now }).eq("user_id", user.id).is("read_at", null);
}

// 새 알림/메시지가 생기면 cb 실행 (실제 서비스: 실시간, 체험 모드: 없음)
let channels = [];
export function subscribe(user, { onNotification, onMessage } = {}) {
  if (DEMO || !user) return () => {};
  const ch = sb.channel("live-" + user.id + "-" + Math.random().toString(36).slice(2));
  if (onNotification) {
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
      (p) => onNotification(p.new));
  }
  if (onMessage) {
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => onMessage(p.new));
  }
  ch.subscribe();
  channels.push(ch);
  return () => { sb.removeChannel(ch); channels = channels.filter((c) => c !== ch); };
}

// ---------------------------------------------------------
// 메시지
// ---------------------------------------------------------
export async function listMessages(requestId) {
  if (DEMO) {
    return (load().messages || []).filter((m) => m.request_id === requestId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  return check(await sb.from("messages").select("*").eq("request_id", requestId)
    .order("created_at", { ascending: true }));
}

export async function sendMessage(user, requestId, body, fromEditor = false) {
  if (DEMO) {
    const s = load();
    s.messages = s.messages || [];
    const m = { id: uid(), request_id: requestId, sender_id: user.id, from_editor: !!fromEditor, body, created_at: new Date().toISOString() };
    s.messages.push(m);
    const r = s.requests.find((x) => x.id === requestId);
    if (r) {
      if (fromEditor) demoNotify(s, r.user_id, { request_id: r.id, kind: "message", title: "에디터가 메시지를 보냈어요", body: body.slice(0, 80), link: `#/chat/${r.id}` });
      else demoNotify(s, "demo-me", { request_id: r.id, kind: "message", title: "의뢰인이 메시지를 보냈어요", body: `${demoTitle(r)} · ${body.slice(0, 80)}`, link: `#/editor/chat/${r.id}` });
    }
    save(s);
    return m;
  }
  return check(await sb.from("messages").insert({ request_id: requestId, body, from_editor: !!fromEditor }).select().single());
}

// 대화방 목록용: 요청서별 마지막 메시지
export async function latestMessages(requestIds) {
  let rows;
  if (DEMO) rows = (load().messages || []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  else {
    let q = sb.from("messages").select("*").order("created_at", { ascending: false }).limit(1000);
    if (requestIds) q = q.in("request_id", requestIds.length ? requestIds : ["00000000-0000-0000-0000-000000000000"]);
    rows = check(await q);
  }
  const last = {};
  for (const m of rows) if (!last[m.request_id] && (!requestIds || requestIds.includes(m.request_id))) last[m.request_id] = m;
  return last;
}

// 메시지 알림 중 안 읽은 것 (요청서별)
export async function unreadMessageMap(user, linkPrefix) {
  let rows;
  if (DEMO) rows = (load().notifications || []).filter((n) => n.user_id === user.id && !n.read_at && n.kind === "message");
  else rows = check(await sb.from("notifications").select("request_id, link").eq("user_id", user.id).eq("kind", "message").is("read_at", null));
  const map = {};
  for (const n of rows) if (!linkPrefix || (n.link || "").startsWith(linkPrefix)) map[n.request_id] = (map[n.request_id] || 0) + 1;
  return map;
}

export async function markMessagesRead(user, requestId, linkPrefix) {
  const now = new Date().toISOString();
  if (DEMO) {
    const s = load();
    (s.notifications || []).forEach((n) => {
      if (n.user_id === user.id && n.request_id === requestId && n.kind === "message" && !n.read_at && (n.link || "").startsWith(linkPrefix)) n.read_at = now;
    });
    save(s);
    return;
  }
  await sb.from("notifications").update({ read_at: now }).eq("user_id", user.id).eq("request_id", requestId)
    .eq("kind", "message").is("read_at", null).like("link", linkPrefix + "%");
}

// ---------------------------------------------------------
// 공지사항
// ---------------------------------------------------------
const sortNotices = (a, b) => (b.pinned - a.pinned) || b.created_at.localeCompare(a.created_at);

export async function listNotices(limit = 100) {
  if (DEMO) return (load().notices || []).slice().sort(sortNotices).slice(0, limit);
  return check(await sb.from("notices").select("*").order("pinned", { ascending: false })
    .order("created_at", { ascending: false }).limit(limit));
}

export async function getNotice(id) {
  if (DEMO) return (load().notices || []).find((n) => n.id === id) || null;
  return check(await sb.from("notices").select("*").eq("id", id).maybeSingle());
}

export async function saveNotice(n) {
  const row = { title: n.title, body: n.body || "", pinned: !!n.pinned };
  if (DEMO) {
    const s = load();
    s.notices = s.notices || [];
    const now = new Date().toISOString();
    if (n.id) { Object.assign(s.notices.find((x) => x.id === n.id), row, { updated_at: now }); save(s); return s.notices.find((x) => x.id === n.id); }
    const created = { id: uid(), created_at: now, updated_at: now, ...row };
    s.notices.push(created); save(s); return created;
  }
  if (n.id) return check(await sb.from("notices").update(row).eq("id", n.id).select().single());
  return check(await sb.from("notices").insert(row).select().single());
}

export async function deleteNotice(id) {
  if (DEMO) { const s = load(); s.notices = (s.notices || []).filter((x) => x.id !== id); save(s); return; }
  check(await sb.from("notices").delete().eq("id", id));
}

export async function broadcastNotice(notice) {
  if (DEMO) {
    const s = load();
    Object.keys(s.profiles).forEach((uidv) => demoNotify(s, uidv, { kind: "notice", title: "새 공지사항이 있어요", body: notice.title, link: `#/notices/${notice.id}` }));
    save(s);
    return;
  }
  check(await sb.rpc("broadcast_notice", { nid: notice.id }));
}

// ---------------------------------------------------------
// 입금 계좌 (승인된 요청서에만 공개)
// ---------------------------------------------------------
export async function getBankAccount(requestId) {
  if (DEMO) {
    const s = load();
    const r = s.requests.find((x) => x.id === requestId);
    return r && ["awaiting_payment", "confirmed"].includes(r.status) ? (s.bank || CFG.BANK) : null;
  }
  const { data, error } = await sb.rpc("get_bank_account", { rid: requestId });
  if (error) return null;
  return data;
}

export async function getBankSettings() {
  if (DEMO) return load().bank || CFG.BANK;
  const { data } = await sb.from("app_settings").select("value").eq("key", "bank").maybeSingle();
  return data?.value || null;
}

export async function saveBankSettings(bank) {
  if (DEMO) { const s = load(); s.bank = bank; save(s); return bank; }
  check(await sb.from("app_settings").upsert({ key: "bank", value: bank, updated_at: new Date().toISOString() }));
  return bank;
}

// ---------------------------------------------------------
// 회원 관리 (에디터)
// ---------------------------------------------------------
export async function listMembers() {
  if (DEMO) {
    const s = load();
    return Object.values(s.profiles).map((p) => {
      const mine = s.requests.filter((r) => r.user_id === p.id);
      return { ...p, created_at: p.created_at || new Date().toISOString(), last_sign_in_at: p.id === s.user?.id ? new Date().toISOString() : null,
        blocked: !!p.blocked, is_editor: p.id === "demo-me", request_count: mine.length,
        total_paid: mine.filter((r) => r.status === "confirmed").reduce((a, r) => a + r.total, 0) };
    });
  }
  return check(await sb.rpc("list_members"));
}

export async function updateMember(id, patch) {
  if (DEMO) { const s = load(); s.profiles[id] = { ...s.profiles[id], ...patch }; save(s); return s.profiles[id]; }
  return check(await sb.from("profiles").update(patch).eq("id", id).select().single());
}

export function resetDemo() {
  try { localStorage.removeItem(KEY); } catch {}
}
