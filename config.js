// =========================================================
// 에딧 커미션 설정 파일
// 이 파일만 고치면 돼요. 안내서(README.md)를 보면서 채워 주세요.
// SUPABASE_URL 이 비어 있으면 "체험 모드"로 열려요 (이 기기에만 저장).
// =========================================================
window.APP_CONFIG = {
  // Supabase > Project Settings > Data API 의 Project URL, API Keys 의 Publishable key (sb_publishable_...)
  SUPABASE_URL: "https://gncbofrvhuqbyewolyxn.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_dBno8Oieh_V22aOLWX1uEA_T6nl-XwC",

  // 입금 계좌는 이제 데이터베이스에 보관해요 (에디터 페이지 → 회원·설정 탭에서 변경).
  // 아래는 체험 모드에서만 보이는 예시 값이에요.
  BANK: {
    name: "체험은행",
    number: "000-0000-0000",
    holder: "에디터",
  },

  // 가격 (supabase/schema.sql 의 compute_total 과 같은 값이어야 해요)
  PRICES: {
    short: 30000,       // 숏 · 30초 이내
    A: 40000,           // A · 60초 이내
    B: 65000,           // B · 60초 이내
    per5sec: 5000,      // 분량 추가 5초당
    private: 30000,     // 포트폴리오 비공개
    fast: 30000,        // 빠른 마감
    commercial: 2,      // 상업적 사용: 총 금액의 몇 배
  },

  // 수정 무료 횟수
  FREE_REVISIONS: 2,
};
