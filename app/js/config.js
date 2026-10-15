const raw = window.SETREVIEW_CONFIG || {};

export const config = {
  supabaseUrl: (raw.supabaseUrl || '').trim().replace(/\/$/, ''),
  supabaseAnonKey: (raw.supabaseAnonKey || '').trim(),
  loginProviders: Array.isArray(raw.loginProviders) ? raw.loginProviders : ['email'],
  spotifyClientId: (raw.spotifyClientId || '').trim(),
  tossClientKey: (raw.tossClientKey || '').trim(),
  membershipPrice: Number(raw.membershipPrice) || 4900,
  supportEmail: (raw.supportEmail || '').trim(),
  // 배경 음악 파일(assets/audio/bgm.mp3)을 올린 뒤 true 로 바꿔 주세요
  bgm: raw.bgm === true,
};

// Supabase 설정이 없으면 데모 모드
export const isDemo = !(config.supabaseUrl && config.supabaseAnonKey);
