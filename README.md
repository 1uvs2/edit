# 에딧 커미션 · 실제 서비스로 여는 방법

이 폴더는 바로 열어 볼 수 있는 웹사이트예요. 아직 키를 넣지 않았기 때문에 지금은 **체험 모드**로 열리고, 데이터는 내 기기에만 저장돼요.
아래 순서대로 설정하면 **진짜 카카오 로그인**이 되고, 의뢰인이 보낸 요청서를 **에디터 페이지와 이메일**로 받을 수 있어요.

전체 30~40분 정도 걸려요. 모두 무료 요금제로 충분해요.

---

## 0. 폴더 구성

| 파일 | 하는 일 |
|---|---|
| `index.html`, `styles.css`, `app.js`, `api.js` | 웹사이트 화면 (고칠 일 거의 없음) |
| `config.js` | **내가 채울 설정** (Supabase 키, 입금 계좌, 가격) |
| `supabase/schema.sql` | 데이터베이스 만드는 코드 (복사해서 붙여넣기만) |
| `supabase/functions/notify-new-request/index.ts` | 새 요청서 이메일 알림 코드 (복사해서 붙여넣기만) |

---

## 1. Supabase 프로젝트 만들기 (로그인 · 데이터 저장)

1. [supabase.com](https://supabase.com) 에 가입하고 **New project** 를 누릅니다.
2. 이름은 `edit-commission`, 지역(Region)은 **Northeast Asia (Seoul)** 을 고르고, 데이터베이스 비밀번호는 아무거나 정해서 메모해 둡니다.
3. 프로젝트가 만들어지면 왼쪽 메뉴 **SQL Editor** → **New query** 를 엽니다.
4. `supabase/schema.sql` 파일 내용을 **전부 복사해서 붙여넣고 Run** 을 누릅니다. "Success" 가 나오면 끝이에요.
5. 왼쪽 아래 **Project Settings → API** (또는 Data API) 에서 두 값을 복사해 둡니다.
   - **Project URL** (예: `https://abcd1234.supabase.co`)
   - **Publishable key** (`sb_publishable_...` 로 시작. 화면에 따라 "anon public" 키로 나오기도 해요)

---

## 2. 카카오 로그인 연결

### 2-1. 카카오 디벨로퍼스에서 앱 만들기
1. [developers.kakao.com](https://developers.kakao.com) 에 로그인하고 **내 애플리케이션 → 애플리케이션 추가하기** 를 누릅니다. 앱 이름은 `에딧 커미션`.
2. **앱 설정 → 앱 → 플랫폼 키** 에서 **REST API 키** 를 복사해 둡니다.
3. Supabase 로 돌아가 **Authentication → Sign In / Providers → Kakao** 를 펼치면 **Callback URL** 이 보여요 (`https://프로젝트주소.supabase.co/auth/v1/callback`). 복사합니다.
4. 카카오의 플랫폼 키 화면에서 REST API 키를 누르고 **카카오 로그인 리다이렉트 URI** 에 방금 복사한 Callback URL 을 붙여넣고 저장합니다.
5. 같은 화면에서 **카카오 로그인 Client Secret** 을 **활성화** 하고, 코드를 복사해 둡니다.
6. **제품 설정 → 카카오 로그인 → 일반** 에서 **상태를 ON** 으로 바꿉니다.
7. **제품 설정 → 카카오 로그인 → 동의항목** 에서
   - **닉네임(profile_nickname)**, **프로필 사진(profile_image)** 을 **필수 동의** 로 설정합니다.
   - **카카오계정(이메일)** 은 "비즈 앱"만 쓸 수 있어요. 비즈 앱이 아니면 건너뛰세요.

### 2-2. Supabase 에 카카오 키 넣기
1. Supabase **Authentication → Sign In / Providers → Kakao** 를 켭니다.
2. **Client ID** 에 카카오 **REST API 키**, **Client Secret** 에 카카오 **Client Secret 코드** 를 넣습니다.
3. 2-1 의 7번에서 이메일을 건너뛰었다면 **Allow users without an email** 을 켭니다.
4. **Save** 를 누릅니다.

> 카카오 화면 메뉴 이름은 가끔 바뀌어요. 막히면 [Supabase 카카오 로그인 안내](https://supabase.com/docs/guides/auth/social-sign-in/auth-kakao)를 보면 같은 순서가 그림과 함께 나와 있어요.

---

## 3. config.js 채우기

`config.js` 를 메모장이나 VS Code 로 열어 아래를 바꾸고 저장합니다.

```js
SUPABASE_URL: "https://abcd1234.supabase.co",   // 1-5 의 Project URL
SUPABASE_ANON_KEY: "sb_publishable_...",        // 1-5 의 Publishable key
BANK: { name: "카카오뱅크", number: "3333-12-3456789", holder: "배서은" },  // 내 계좌
```

anon 키는 웹사이트에 공개돼도 괜찮은 키예요. 보안 규칙(schema.sql)이 다른 사람의 요청서를 못 보게 막아 줘요. 단, **service_role 키는 절대 넣지 마세요.**

---

## 4. 웹사이트 올리기 (인터넷 주소 만들기)

가장 쉬운 방법은 **Netlify Drop** 이에요. 코드 지식 없이 폴더를 끌어다 놓기만 하면 돼요. (Vercel 도 되지만 GitHub 연결이 필요해서 이 방법이 더 간단해요.)

1. [app.netlify.com/drop](https://app.netlify.com/drop) 에 접속합니다.
2. **이 폴더(edit-commission) 전체를 브라우저 창에 끌어다 놓습니다.**
3. 몇 초 뒤 `https://무작위이름.netlify.app` 같은 주소가 생겨요. 무료 가입을 하면 주소가 계속 유지되고 이름도 바꿀 수 있어요.
4. 나중에 파일을 고치면, 사이트 화면의 **Deploys** 탭에 폴더를 다시 끌어다 놓으면 업데이트돼요.

### 로그인 후 돌아올 주소 등록 (꼭 해야 해요)
Supabase **Authentication → URL Configuration** 에서
- **Site URL** 에 내 사이트 주소 (`https://...netlify.app`) 를 넣고
- **Redirect URLs** 에도 같은 주소를 추가하고 저장합니다.

이걸 안 하면 카카오 로그인 후 엉뚱한 주소로 돌아가요.

---

## 5. 나를 에디터로 등록하기

1. 내 사이트에 들어가서 **카카오로 계속하기** 로 한 번 로그인합니다.
2. Supabase **SQL Editor** 에서 아래 한 줄을 실행합니다. (가장 먼저 가입한 계정 = 나를 에디터로 등록)

```sql
insert into public.editors (user_id) select id from auth.users order by created_at limit 1 on conflict do nothing;
```

3. 사이트를 새로고침하면 **마이페이지 → 에디터 페이지** 메뉴가 생겨요. 여기서 모든 요청서를 보고, 입금 확인 · 진행 단계 · 미리보기 링크를 관리해요.

> 다른 사람이 먼저 가입했다면 Supabase **Authentication → Users** 에서 내 계정의 UID 를 복사해서
> `insert into public.editors (user_id) values ('내-UID');` 를 실행하세요.

---

## 6. 새 요청서 이메일 알림 (선택이지만 추천)

### 6-1. Resend 가입 (이메일 발송 서비스)
1. [resend.com](https://resend.com) 에 **알림 받을 이메일 주소로** 가입합니다.
2. **API Keys → Create API Key** 로 키를 만들어 복사해 둡니다.
   - 무료 계정의 기본 발신 주소는 **가입한 내 이메일로만** 보낼 수 있어요. 에디터 알림용으로는 이걸로 충분해요.

### 6-2. 알림 함수 만들기
1. Supabase 왼쪽 메뉴 **Edge Functions → Deploy a new function → Via Editor** 를 고릅니다.
2. 함수 이름을 **`notify-new-request`** 로 정하고, `supabase/functions/notify-new-request/index.ts` 내용을 전부 붙여넣고 **Deploy** 합니다.
3. 만들어진 함수의 **Details(또는 Settings)** 에서 **Enforce JWT verification(JWT 확인)** 을 **끕니다.** (대신 아래 비밀 문구로 보호해요)
4. **Edge Functions → Secrets** 에 아래 4개를 추가합니다.

| 이름 | 값 |
|---|---|
| `RESEND_API_KEY` | 6-1 에서 만든 키 |
| `EDITOR_EMAIL` | 알림 받을 내 이메일 (Resend 가입 주소) |
| `WEBHOOK_SECRET` | 아무 긴 문구 (예: `edit-2026-pink-secret`) 직접 정해서 메모 |
| `SITE_URL` | 내 사이트 주소 (`https://...netlify.app`) |

### 6-3. 요청서가 들어오면 함수가 실행되게 연결
1. Supabase **Database → Webhooks** (또는 **Integrations → Database Webhooks**) 에서 **Create a new hook** 을 누릅니다.
2. 이렇게 설정합니다.
   - Name: `new-request-mail`
   - Table: **requests**
   - Events: **Insert**, **Update** 체크 (Update 는 수정 요청 알림용)
   - Type: **Supabase Edge Functions** → 함수 **notify-new-request** 선택
   - HTTP Headers 에 **`x-webhook-secret`** 이름으로 6-2 의 `WEBHOOK_SECRET` 과 **같은 문구** 추가
3. 저장합니다.

이제 의뢰인이 요청서를 보내거나 수정을 요청하면, 내 이메일로 내용과 "에디터 페이지에서 보기" 버튼이 와요.

---

## 7. 처음부터 끝까지 테스트

1. 휴대폰으로 내 사이트에 들어가 카카오 로그인 → **새 에딧 맡기기**.
2. 요청서 작성 → 가격 선택 → 입금자명 입력 → 환불 기준 체크 → **요청 보내기**.
3. 내 이메일에 알림이 왔는지 확인합니다.
4. 컴퓨터에서 **마이페이지 → 에디터 페이지** → 방금 요청서 → **입금 확인했어요**.
5. 단계와 예정일, 미리보기 링크를 넣고 **저장하기** → 휴대폰 진행판에 반영됐는지 확인합니다.

---

## 8. 2차 업데이트: 알림함 · 메시지 · 임시저장 (꼭 실행)

`supabase/update-2-alerts-messages.sql` 내용을 SQL Editor 에 붙여넣고 **Run** 하세요. 여러 번 실행해도 안전해요.

- **알림함**(종 아이콘): 입금 확인, 진행 단계 변경, 새 미리보기, 메시지가 오면 의뢰인에게 알림이 쌓여요. 새 요청서, 수정 요청, "이대로 좋아요", 의뢰인 메시지는 에디터에게 쌓여요. 사이트를 열어 두면 실시간으로 떠요. (휴대폰 잠금화면 푸시는 아니에요)
- **메시지**: 진행판의 "에디터에게 메시지 보내기" / 에디터 페이지 요청서 화면 아래 "의뢰인과 메시지".
- **임시저장**: 요청서·가격 화면의 임시저장 버튼. 계정에 저장돼서 다른 기기에서도 홈에서 이어서 쓸 수 있어요.

---

## 자주 고치는 것

**입금 계좌 바꾸기** → `config.js` 의 `BANK`.

**가격 바꾸기** → 두 군데를 **같이** 바꿔야 해요.
1. `config.js` 의 `PRICES` (화면에 보이는 가격)
2. `supabase/schema.sql` 의 `compute_total` 부분 숫자를 고친 뒤, 그 함수 부분(`create or replace function public.compute_total` 부터 `$$;` 까지)만 SQL Editor 에서 다시 실행 (실제 저장되는 금액)

서버가 금액을 다시 계산하기 때문에, 화면만 고치면 저장되는 금액은 바뀌지 않아요. 누군가 화면을 조작해서 금액을 낮추는 것도 이 덕분에 막혀요.

**무료 수정 횟수** → `config.js` 의 `FREE_REVISIONS`.

---

## 알아 둘 점

- **결제는 계좌이체만** 지원해요. 의뢰인이 요청서를 보내면 "입금 확인 중" 상태가 되고, 에디터가 입금을 확인해서 버튼을 눌러야 진행판이 시작돼요. 실제 입금 내역은 은행 앱에서 직접 확인해야 해요.
- **기념일 D-30 알림**은 홈 화면 안내로만 보여요. 문자나 카카오톡으로 따로 보내지는 않아요.
- **환불**은 사이트에서 자동으로 되지 않아요. 에디터 페이지에서 "의뢰 취소"로 표시하고 직접 송금해 주세요.
- 실제로 돈을 받는 서비스라면 **이용약관, 개인정보 처리방침, 사업자 등록·통신판매업 신고**가 필요할 수 있어요. 지인 대상 시제품이어도 한 번 확인해 보세요.
