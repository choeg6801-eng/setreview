const raw = window.SETREVIEW_CONFIG || {};

export const config = {
  supabaseUrl: (raw.supabaseUrl || '').trim().replace(/\/$/, ''),
  supabaseAnonKey: (raw.supabaseAnonKey || '').trim(),
  loginProviders: Array.isArray(raw.loginProviders) ? raw.loginProviders : ['kakao', 'google'],
  spotifyClientId: (raw.spotifyClientId || '').trim(),
  tossClientKey: (raw.tossClientKey || '').trim(),
  membershipPrice: Number(raw.membershipPrice) || 12000,
  supportEmail: (raw.supportEmail || '').trim(),
};

// Supabase 설정이 없으면 데모 모드
export const isDemo = !(config.supabaseUrl && config.supabaseAnonKey);
