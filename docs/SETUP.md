# 셋리뷰 운영 시작 가이드

이 문서는 셋리뷰를 **데모 → 베타 → 유료 출시** 순서로 여는 방법을 정리한 거예요. 단계마다 필요한 것만 하면 되고, 앞 단계만 해도 서비스는 동작해요.

| 단계 | 하는 일 | 결과 |
|---|---|---|
| 0. 데모 | 아무 설정 없이 Vercel 배포 | 누구나 데모 계정으로 체험 (데이터는 각자 브라우저에만 저장) |
| 1. 베타 | Supabase 연결 | 카카오·구글 로그인, 공용 데이터, 실시간 셋리스트, 출시 알림 수집 |
| 2. Spotify 베타 | Spotify 앱 등록 | 테스터 5명까지 플레이리스트 자동 저장 |
| 3. 유료 출시 | 토스페이먼츠 + 결제 함수 배포 | 월 12,000원 멤버십 자동결제 |

---

## 0. 데모 모드로 배포하기

`app/config.js`가 비어 있으면 자동으로 데모 모드예요. GitHub 저장소를 Vercel에 연결하면 그대로 열려요.

- 랜딩 페이지: `https://내주소/`
- 웹앱: `https://내주소/app/`

Vercel 설정은 Framework Preset **Other**, Build Command와 Output Directory는 **비워 두기**예요.

---

## 1. Supabase 연결 (로그인 · 데이터베이스 · 실시간)

> **현재 상태:** Supabase 프로젝트 `setreview`(서울 리전, `vdqaqksvngecoakpbqvi`)에 스키마·권한 규칙·샘플 데이터가 이미 들어가 있고, `app/config.js`에도 주소와 anon 키가 채워져 있어요. 아래 1-1, 1-2는 건너뛰고 **1-3부터** 하면 돼요.

### 1-1. 프로젝트 만들기
1. [supabase.com](https://supabase.com)에서 New project를 만들어요. Region은 **Northeast Asia (Seoul)**을 고르세요.
2. 왼쪽 메뉴 **SQL Editor**에서 `supabase/schema.sql` 내용을 통째로 붙여 넣고 **Run**을 눌러요.
3. 이어서 `supabase/seed.sql`을 실행하면 샘플 공연(Bruno Mars·Maroon 5 예시)이 들어가요. 실제 운영에서는 건너뛰어도 돼요.

### 1-2. 웹앱에 연결
**Project Settings → API**에서 두 값을 복사해 `app/config.js`에 넣어요.

```js
supabaseUrl: 'https://xxxx.supabase.co',
supabaseAnonKey: 'eyJhbGciOi...',   // anon public 키 (공개돼도 괜찮아요)
```

> `service_role` 키는 절대 `config.js`에 넣지 마세요. 그 키는 모든 권한을 가진 서버 전용 키예요.

### 1-3. 로그인 주소 등록
**Authentication → URL Configuration**
- Site URL: `https://내주소`
- Redirect URLs: `https://내주소/app/` (로컬 테스트도 할 거면 `http://localhost:3000/app/`도)

### 1-3-1. 이메일 로그인 (지금 쓰는 방식)
비밀번호 없이 메일로 받은 **로그인 링크** 또는 **6자리 코드**로 로그인해요. 처음 로그인하면 자동으로 가입돼요.

1. **Authentication → Sign In / Providers → Email**이 켜져 있는지 확인해요 (기본으로 켜져 있어요).
2. **Authentication → Emails → Templates**에서 **Magic Link**와 **Confirm signup** 두 템플릿의
   - Subject를 `셋리뷰 로그인 링크`로 바꾸고
   - Body를 `supabase/email-templates/login.html` 내용으로 바꿔요. 이 템플릿에 6자리 코드가 들어 있어서, 휴대폰 메일 앱처럼 다른 브라우저에서 메일을 열어도 코드로 로그인할 수 있어요.
3. **공개 전 필수 — 메일 발송 서버(SMTP)**: Supabase 기본 메일은 **프로젝트 팀원 주소로만**, 그것도 시간당 몇 통만 보내져요. 일반 사용자를 받기 전에 [Resend](https://resend.com) 같은 메일 서비스(무료 월 3,000통)를 만들고 **Authentication → Emails → SMTP Settings**에 넣어요.
   - Host `smtp.resend.com` · Port `465` · Username `resend` · Password는 Resend API 키
   - 보내는 주소는 Resend에서 인증한 도메인 주소 (예: `no-reply@내도메인`)
   - 그다음 **Authentication → Rate Limits**에서 시간당 메일 수를 늘려요.

카카오·구글 로그인을 다시 쓰려면 아래 1-4, 1-5를 마친 뒤 `app/config.js`의 `loginProviders`에 `'kakao'`, `'google'`을 추가해요 (예: `['email', 'kakao']`). 카카오는 **개인 개발자 비즈 앱 전환** 후 동의항목에서 **카카오계정(이메일)**까지 켜야 KOE205 오류가 나지 않아요.

### 1-4. 카카오 로그인
1. [Kakao Developers](https://developers.kakao.com)에서 애플리케이션을 추가해요.
2. **카카오 로그인 → 활성화**를 켜고, Redirect URI에 `https://vdqaqksvngecoakpbqvi.supabase.co/auth/v1/callback`을 넣어요.
3. **보안 → Client Secret**을 만들고 활성화해요.
4. **동의항목**에서 닉네임·프로필 사진, 카카오계정(이메일)을 설정해요. 이메일 동의항목은 **비즈 앱 전환**이 필요할 수 있어요.
5. Supabase **Authentication → Providers → Kakao**를 켜고 REST API 키(Client ID)와 Client Secret을 넣어요.

### 1-5. 구글 로그인
[Google Cloud Console](https://console.cloud.google.com) → API 및 서비스 → 사용자 인증 정보 → OAuth 클라이언트 ID(웹 애플리케이션)를 만들어요. 승인된 리디렉션 URI에 `https://vdqaqksvngecoakpbqvi.supabase.co/auth/v1/callback`을 넣고, Client ID와 Secret을 Supabase **Providers → Google**에 넣어요.

`app/config.js`의 `loginProviders`에는 실제로 켠 것만 남겨 두세요. (`'email'`은 이메일 로그인)

### 1-6. 운영자 지정
웹앱에서 한 번 로그인한 다음 SQL Editor에서 실행해요.

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = '내이메일@example.com');
```

다시 로그인하면 상단 메뉴에 **운영**이 생겨요.

### 1-7. 무료 베타 스위치
처음에는 `free_beta`가 켜져 있어서 모든 사람이 멤버십 기능을 무료로 써요. **운영 → 설정**에서 끄고 켤 수 있어요.

---

## 1-8. 공연 일정 자동 수집 (KOPIS)

국내 페스티벌과 해외 아티스트 내한 공연을 **KOPIS(공연예술통합전산망)** 오픈API에서 매일 자동으로 가져와요. 인터파크·YES24·멜론티켓 같은 예매처의 공연 정보가 모이는 정부 운영 데이터베이스예요.

이미 준비된 것: 수집 함수 `kopis-sync` 배포, 매일 오전 5시 10분 자동 실행 예약, 실행용 비밀값(Vault).
**직접 할 것은 인증키 하나예요.**

1. [kopis.or.kr](https://www.kopis.or.kr)에 회원가입하고 **오픈API** 메뉴에서 인증키를 신청해요 (무료).
2. Supabase → **Edge Functions → Secrets**에서 `KOPIS_API_KEY` 이름으로 인증키를 넣어요.
3. 웹앱 **운영 → 설정 → 공연 일정 자동 수집 → 지금 가져오기**를 눌러 첫 수집을 해요 (1~2분).

동작 방식
- 오늘부터 1년 동안의 **대중음악** 공연 목록을 훑고, 제목·KOPIS의 축제/내한 표시로 **페스티벌**과 **내한 공연**만 골라 넣어요.
- 한 번에 새 공연을 최대 150개까지 확인하고, 나머지는 다음 날 이어서 확인해요. 제외한 공연은 30일 동안 다시 확인하지 않아요.
- 이미 들어간 공연은 매일 날짜·공연장·포스터만 다시 맞춰요. 운영자가 고친 제목·소개·공개 여부·내한 표시는 그대로 둬요.
- 공연 화면에 "일정 정보는 KOPIS에서 가져와요" 안내와 예매처 링크가 표시돼요.
- 잘못 들어간 공연은 **운영 → 공연**에서 비공개로 바꾸거나 지우면 돼요. 지운 공연은 다음 수집 때 다시 들어올 수 있으니 **비공개**를 권해요.

> 출시 전 확인: KOPIS 오픈API 이용약관의 상업적 이용 조건과 출처 표시 방법을 확인해 주세요.

## 1-9. 내 공연 기록
로그인한 사용자는 **기록** 메뉴에서 다녀온 콘서트·페스티벌을 남길 수 있어요. 연도별 요약(공연 수·페스티벌·내한·아티스트·공연장), 월별 막대, 월별 목록으로 보여 줘요. 지난 공연 화면의 **다녀왔어요 · 기록하기** 버튼이나, 담아 둔 공연이 끝나면 나오는 **다녀오셨나요?** 버튼으로 한 번에 기록할 수 있어요. 기록은 본인만 볼 수 있고 무료 기능이에요.

## 1-10. 취향 맞춤 · 아티스트 추천 · 알림

로그인한 사용자는 **내 공연 → 내 취향**에서 좋아하는 아티스트와 장르를 등록해요. 기록에서 본 아티스트 · 장르는 자동으로 모여요.

| 기능 | 동작 |
|---|---|
| 내 취향 공연 | 홈 위쪽에 좋아하는 아티스트 출연 · 본 적 있는 아티스트 · 좋아하는 장르 공연을 골라 보여 줘요 |
| 아티스트 추천 | 같은 무대(페스티벌)에 선 아티스트, 같은 아티스트를 좋아하는 사람들이 함께 고른 아티스트(2명 이상일 때만, 누가 골랐는지는 저장하지 않아요), 같은 장르 아티스트 |
| 알림함 | 매일 오전 5시 40분에 새 공연과 취향을 비교해 알림을 만들어요. 취향을 바꾸거나 앱을 열 때도 바로 갱신돼요. 상단 종 아이콘에 안 읽은 수가 보여요 |
| 메일 알림 | 매일 오전 6시: 좋아하는 아티스트 공연 소식 · 매주 월요일 오전 9시: 이번 주 취향 공연 모음. 사용자가 내 취향 → 알림 설정에서 끌 수 있어요 |

**메일 알림 켜기** (메일 발송 서비스가 있어야 해요. 로그인 메일과 같은 Resend 를 쓰면 돼요)
1. [Resend](https://resend.com)에서 도메인을 인증하고 API 키를 만들어요.
2. Supabase → **Edge Functions → Secrets**에 넣어요.
   - `RESEND_API_KEY` = Resend API 키
   - `MAIL_FROM` = `셋리뷰 <alert@내도메인>`
   - `SITE_URL` = `https://내주소` (메일 속 링크 주소)
3. 다음 날 오전 6시부터 메일이 나가요. 그 전까지는 알림함에만 쌓여요.

**아티스트 추천이 동작하는 방식**
추천은 ① 셋리뷰가 정리한 **비슷한 아티스트** 목록(가장 크게 반영) ② 같은 무대에 선 아티스트 ③ 같은 아티스트를 좋아하는 사람들이 함께 고른 아티스트 ④ 같은 장르 순으로 점수를 매겨요. Spotify · Last.fm 같은 외부 추천 데이터는 이용 조건 때문에 쓰지 않아요. 비슷한 아티스트 목록은 매일 공연 소식 수집 작업이 새로 좋아요가 눌린 아티스트부터 채우고, 운영 → 곡 · 떼창 구간 → 아티스트 정보에서 직접 고칠 수 있어요.

**맞춤 정확도 높이기** (운영자)
- 운영 → 곡 · 떼창 구간에서 아티스트를 고르면 **아티스트 정보**에 한글 이름 · 다른 이름 · 장르를 넣을 수 있어요. 한글 이름을 넣어 두면 KOPIS 출연진이 한글로만 적혀 있어도 알림이 가요.
- 운영 → 공연 편집에서 **출연진**과 **장르**를 고칠 수 있어요. KOPIS 공연은 출연진이 자동으로 들어오고, 장르는 제목으로 짐작해서 넣어요.
- KOPIS 장르는 모두 "대중음악" 하나라서 세부 장르는 제목 · 운영자 입력 · 아티스트 장르로만 정해져요.

## 1-11. 공연 소식 모으기 · 티켓 오픈 알림

KOPIS는 예매처 정보가 늦게 들어오거나 빠질 때가 있어요 (예: 2026년 8월 예매를 연 Maroon 5 2027 공연이 10월에도 KOPIS에 없음). 그래서 세 가지를 함께 써요.

| 경로 | 동작 | 공개 |
|---|---|---|
| **매일 공연 소식 수집** | Claude 예약 작업이 매일 13:41에 기사 · 공식 발표를 검색해, 새로 발표된 내한 공연 · 페스티벌을 날짜 · 장소 · 티켓 오픈 · 예매처 · 출처와 함께 **초안**으로 넣어요. 기존 공연에 티켓 오픈 시간이 없으면 채워요 | 운영자 승인 후 |
| **사용자 공연 제보** | 홈 아래 "공연 제보하기" → 공지 링크 필수 | 운영자 승인 후 |
| **KOPIS 자동 수집** | 1-8 참고 | 자동 |

**운영 → 검토 대기**에서 출처 링크를 열어 확인한 뒤 **공개** 또는 **공연으로 등록**을 눌러요. 공개된 공연은 다음 알림 계산 때 좋아하는 사람들에게 알려요.

**티켓 오픈 알림**
- 공연 편집 화면의 **티켓 오픈 (한국 시간)** 칸에 시간이 있으면, 그 공연을 담아 둔 사람과 출연 아티스트를 좋아하는 사람에게 알려요.
- 하루 전: 매일 05:40에 6~30시간 안에 열리는 티켓을 찾아 알림함 + 06:07 메일
- 1시간 전: 매시 7분에 75분 안에 열리는 티켓을 찾아 알림함 + 메일
- 홈 위쪽 **곧 티켓 오픈**에 30일 안에 열리는 공연이 모여요.

예약 작업은 Claude 계정의 예약 작업 목록에서 이름 "셋리뷰 공연 소식 매일 수집"으로 보고 끄거나 시간을 바꿀 수 있어요. 실행마다 Claude 사용량을 써요.

---

## 2. Spotify 베타 (선택)

> Spotify는 2025년 5월부터 월간 이용자 25만 명 이상인 **등록된 사업자**에게만 일반 공개 승인을 내줘요. 그 전까지는 개발 모드로 **허용 목록에 등록한 최대 5명**만 쓸 수 있고, 앱 소유자 계정은 **Spotify Premium**이어야 해요.

1. [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)에서 Create app을 눌러요.
2. Redirect URI에 `https://내주소/app/spotify-callback.html`을 넣고, API는 **Web API**를 골라요.
3. Client ID를 `app/config.js`의 `spotifyClientId`에 넣어요.
4. **User Management**에 테스터 이름과 Spotify 이메일을 등록해요 (최대 5명).

허용 목록에 없는 사람이 저장을 누르면 "베타 테스터만 저장할 수 있어요"라는 안내가 나와요. 그 외 모든 사람은 곡마다 Spotify·Apple Music·YouTube Music·멜론 링크로 들을 수 있어요.

---

## 3. 유료 멤버십 (토스페이먼츠 자동결제)

### 3-1. 사전 준비
- **사업자 등록**과 **통신판매업 신고**가 필요해요.
- [토스페이먼츠](https://www.tosspayments.com)에 가입하고 **자동결제(빌링) 계약**을 신청해요. 자동결제는 별도 계약이 있어야 실제로 쓸 수 있어요.
- 개발자센터에서 **API 개별 연동 키**를 확인해요. 테스트 키(`test_ck_…`, `test_sk_…`)로 먼저 시험해 보세요.

### 3-2. 결제 함수 배포
컴퓨터에 [Node.js](https://nodejs.org)를 설치한 뒤 이 저장소 폴더에서 실행해요.

```bash
npx supabase login
npx supabase link --project-ref vdqaqksvngecoakpbqvi            # xxxx 는 Supabase 프로젝트 주소의 앞부분
npx supabase secrets set TOSS_SECRET_KEY=test_sk_... CRON_SECRET=아무도모르는긴문자열 ALLOWED_ORIGIN=https://내주소
npx supabase functions deploy toss-billing
npx supabase functions deploy toss-renew --no-verify-jwt
```

### 3-3. 매달 자동결제 예약
Supabase **Database → Extensions**에서 `pg_cron`과 `pg_net`을 켠 뒤 SQL Editor에서 실행해요. 매일 오전 10시(한국 시간)에 결제일이 된 구독을 결제해요.

```sql
select cron.schedule(
  'setreview-renew',
  '0 1 * * *',
  $$
  select net.http_post(
    url := 'https://vdqaqksvngecoakpbqvi.supabase.co/functions/v1/toss-renew',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '위에서 정한 CRON_SECRET'),
    body := '{}'::jsonb
  );
  $$
);
```

### 3-4. 결제 열기
1. `app/config.js`의 `tossClientKey`에 클라이언트 키를 넣어요.
2. **운영 → 설정**에서 무료 베타를 꺼요.
3. 테스트 키로 카드 등록과 첫 결제를 해 보고, Supabase의 `payments` 테이블에 기록이 남는지 확인해요.
4. 문제가 없으면 라이브 키(`live_ck_…`, `live_sk_…`)로 바꿔요.

가격을 바꾸려면 `app/config.js`의 `membershipPrice`와 Supabase secret `MEMBERSHIP_PRICE`를 함께 바꿔 주세요.

---

## 운영 방법

**새 공연 올리기**
1. 운영 → 곡 · 떼창 구간: 아티스트와 곡을 등록하고, 곡마다 하이라이트·떼창 구간을 넣어요.
2. 운영 → 공연 → 새 공연: 공연 정보를 넣고 저장해요.
3. 같은 화면에서 출연 아티스트(무대)를 추가하고 **예상 셋리스트**를 순서대로 채워 저장해요.

**공연 당일 (라이브 진행)**
1. 운영 → 라이브 진행에서 무대를 고르고 상태를 **진행 중**으로 바꿔요.
2. 곡이 시작될 때마다 곡 버튼을 누르거나, 사용자가 보낸 현장 제보를 **셋리스트에 추가**해요.
3. 공연이 끝나면 상태를 **끝**으로 바꿔요. 사용자는 바로 복습 카드를 만들 수 있어요.

**떼창 구간 다듬기**
운영 → 현장 제보 아래에 곡별 떼창 제보가 모여요. **떼창 구간 만들기**로 초안을 만들고 곡 화면에서 시간을 다듬어요.

**출시 알림 신청자**
운영 → 출시 알림에서 확인하고 CSV로 내려받을 수 있어요.

---

## 출시 전 꼭 확인할 것

- [ ] **셋리스트 데이터 권리**: setlist.fm API는 비상업용만 무료예요. 유료 서비스에 쓰려면 setlist.fm에 상업 이용을 문의해야 해요. 지금 구조는 운영자 입력과 사용자 제보만으로 동작하게 만들어 두었어요.
- [ ] **앨범 아트·아티스트 이미지**: 저작권이 각 권리자에게 있어요. 공식 제휴나 권리 확인 없이 쓰지 말고, 받은 요청에는 바로 내릴 수 있게 준비해 두세요.
- [ ] **이용약관·개인정보처리방침**: `app/js/views/legal.js`의 초안을 실제 사업자 정보로 고치고 법률 검토를 받아요.
- [ ] **사업자 정보 표시**: 랜딩 페이지 푸터의 [상호]·[대표]·[사업자등록번호] 등을 채워요.
- [ ] **개인정보 처리 위탁 고지**: Supabase, Vercel, 토스페이먼츠를 위탁 업체로 적어요.
- [ ] **운영자 계정 보안**: 운영자 계정은 2단계 인증이 켜진 구글·카카오 계정을 쓰세요.
- [ ] **샘플 데이터 정리**: 운영 → 공연에서 "(예시)" 공연을 지우거나 비공개로 바꿔요.

## 파일 구조

```
index.html                  랜딩 페이지
app/                        웹앱 (빌드 없이 그대로 배포)
  config.js                 ← 운영 설정 (Supabase · Spotify · 토스 키)
  index.html                웹앱 시작 화면
  spotify-callback.html     Spotify 로그인 후 돌아오는 페이지
  css/app.css               스타일
  js/main.js                시작 · 화면 전환
  js/api/                   데이터 연결 (demo.js = 데모, supabase.js = 실제 서비스)
  js/views/                 화면별 코드 (home · event · me · membership · recap · admin …)
supabase/
  schema.sql                데이터베이스 구조와 권한 규칙
  seed.sql                  샘플 공연 데이터
  functions/                결제 서버 함수 (토스페이먼츠)
scripts/gen-seed-sql.mjs    샘플 데이터로 seed.sql 다시 만들기
```
