// 새 요청서 / 수정 요청이 들어오면 에디터에게 이메일을 보내는 함수
// Supabase 대시보드 > Edge Functions 에서 이 내용 그대로 새 함수를 만드세요.
// 필요한 Secrets: RESEND_API_KEY, EDITOR_EMAIL, WEBHOOK_SECRET, SITE_URL

const TYPE_LABEL: Record<string, string> = { short: "숏타입", A: "A타입", B: "B타입" };

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
const won = (n: number) => `${Number(n || 0).toLocaleString("ko-KR")}원`;

async function nickname(userId: string): Promise<string> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return "의뢰인";
    const res = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}&select=nickname`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const rows = await res.json();
    return rows?.[0]?.nickname || "의뢰인";
  } catch {
    return "의뢰인";
  }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return new Response("forbidden", { status: 403 });
  }

  const payload = await req.json();
  const r = payload.record ?? {};
  const old = payload.old_record ?? {};

  let subject = "";
  let headline = "";
  if (payload.type === "INSERT") {
    subject = `[에딧 커미션] 새 요청서 · ${r.member || ""} ${r.occasion || ""}`.trim();
    headline = "새 요청서가 들어왔어요. 입금을 확인한 뒤 에디터 페이지에서 '입금 확인'을 눌러 주세요.";
  } else if (payload.type === "UPDATE" && (r.revision_count ?? 0) > (old.revision_count ?? 0)) {
    subject = `[에딧 커미션] 수정 요청 · ${r.member || ""} ${r.occasion || ""}`.trim();
    headline = `의뢰인이 수정을 요청했어요 (${r.revision_count}번째).`;
  } else {
    return new Response("skip");
  }

  const who = await nickname(r.user_id);
  const site = (Deno.env.get("SITE_URL") || "").replace(/\/$/, "");
  const link = site ? `${site}/#/editor/${r.id}` : "";

  const opts = [
    r.extra_sec ? `분량 ${r.extra_sec}초 추가` : "",
    r.opt_private ? "포트폴리오 비공개" : "",
    r.opt_fast ? "빠른 마감" : "",
    r.opt_commercial ? "상업적 사용" : "",
  ].filter(Boolean).join(", ") || "없음";

  const row = (k: string, v: unknown) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#8a8a8a;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0">${esc(v)}</td></tr>`;

  const html = `
  <div style="font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;max-width:520px;margin:auto;color:#111">
    <h2 style="margin:0 0 8px">${esc(subject.replace("[에딧 커미션] ", ""))}</h2>
    <p style="margin:0 0 16px;color:#555">${esc(headline)}</p>
    <table style="border-collapse:collapse;font-size:14px">
      ${row("의뢰인", who)}
      ${row("멤버", r.member)}
      ${row("기념일", r.occasion)}
      ${row("곡 · 구간", r.song)}
      ${row("마감일", r.deadline)}
      ${row("예정 업로드일", r.upload_date)}
      ${row("타입", TYPE_LABEL[r.edit_type] || r.edit_type)}
      ${row("추가 옵션", opts)}
      ${row("총 금액", won(r.total))}
      ${row("입금자명", r.depositor)}
      ${payload.type === "UPDATE" ? row("수정 요청 내용", r.client_note) : row("요청사항", r.notes)}
    </table>
    ${link ? `<p style="margin-top:20px"><a href="${esc(link)}" style="display:inline-block;padding:12px 20px;border-radius:40px;background:#f696f6;color:#fff;text-decoration:none;font-weight:600">에디터 페이지에서 보기</a></p>` : ""}
  </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "에딧 커미션 <onboarding@resend.dev>",
      to: [Deno.env.get("EDITOR_EMAIL")],
      subject,
      html,
    }),
  });

  return new Response(await res.text(), { status: res.ok ? 200 : 500 });
});
