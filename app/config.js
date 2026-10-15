// ============================================================
// 셋리뷰 웹앱 설정 — 운영을 시작할 때 이 파일만 고치면 돼요.
// 값이 비어 있으면 브라우저 안에서만 동작하는 "데모 모드"로 실행돼요.
// 자세한 방법: docs/SETUP.md
// ============================================================
window.SETREVIEW_CONFIG = {
  // Supabase → Project Settings → API 에서 복사
  supabaseUrl: 'https://vdqaqksvngecoakpbqvi.supabase.co',        // 예: 'https://abcdxyz.supabase.co'
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkcWFxa3N2bmdlY29ha3BicXZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4NzcxMDcsImV4cCI6MjEwNzQ1MzEwN30.awjhZAJ4VzhzqO4PSrC4uPfIE4seACicgOuIs4A9hTk',    // 'anon public' 키 (공개돼도 괜찮은 키예요)

  // 로그인 버튼으로 보여 줄 소셜 로그인 (Supabase 에서 켠 것만 남기세요)
  loginProviders: ['email'],

  // Spotify 베타 (developer.spotify.com 에서 만든 앱의 Client ID)
  // 개발 모드 앱은 허용 목록에 등록한 최대 5명만 쓸 수 있어요.
  spotifyClientId: '',

  // 토스페이먼츠 "API 개별 연동" 클라이언트 키 (test_ck_... 또는 live_ck_...)
  // 비워 두면 결제 버튼 대신 "무료 베타" 안내가 나와요.
  tossClientKey: '',

  // 멤버십 가격 (원/월) — Edge Function 의 가격과 같게 맞춰 주세요.
  membershipPrice: 4900,

  // 고객 문의 이메일
  supportEmail: '',
};
