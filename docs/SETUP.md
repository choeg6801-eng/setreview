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

### 1-4. 카카오 로그인
1. [Kakao Developers](https://developers.kakao.com)에서 애플리케이션을 추가해요.
2. **카카오 로그인 → 활성화**를 켜고, Redirect URI에 `https://vdqaqksvngecoakpbqvi.supabase.co/auth/v1/callback`을 넣어요.
3. **보안 → Client Secret**을 만들고 활성화해요.
4. **동의항목**에서 닉네임·프로필 사진, 카카오계정(이메일)을 설정해요. 이메일 동의항목은 **비즈 앱 전환**이 필요할 수 있어요.
5. Supabase **Authentication → Providers → Kakao**를 켜고 REST API 키(Client ID)와 Client Secret을 넣어요.

### 1-5. 구글 로그인
[Google Cloud Console](https://console.cloud.google.com) → API 및 서비스 → 사용자 인증 정보 → OAuth 클라이언트 ID(웹 애플리케이션)를 만들어요. 승인된 리디렉션 URI에 `https://vdqaqksvngecoakpbqvi.supabase.co/auth/v1/callback`을 넣고, Client ID와 Secret을 Supabase **Providers → Google**에 넣어요.

`app/config.js`의 `loginProviders`에는 실제로 켠 것만 남겨 두세요.

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
