// Spotify 베타: 브라우저에서 바로 로그인(PKCE)해서 플레이리스트를 만들어요.
// Spotify 개발 모드 앱은 대시보드의 허용 목록(User Management)에 등록한 최대 5명만 쓸 수 있어요.
// 2026년 2월 API 변경에 맞춰 POST /me/playlists, POST /playlists/{id}/items 를 써요.
import { config } from './config.js';
import { UserError } from './util.js';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const SCOPES = 'playlist-modify-private playlist-modify-public';
const K = { verifier: 'sr-sp-verifier', state: 'sr-sp-state', ret: 'sr-sp-return', token: 'sr-sp-token', pending: 'sr-sp-pending' };

export const spotifyEnabled = () => !!config.spotifyClientId;
export const redirectUri = () => `${location.origin}/app/spotify-callback.html`;

function b64url(bytes) {
  let s = '';
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomString(n = 64) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return b64url(a).slice(0, n);
}

export function getToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem(K.token) || 'null');
    if (t && t.expiresAt > Date.now() + 30000) return t.accessToken;
  } catch { /* 무시 */ }
  return null;
}
export function clearToken() { sessionStorage.removeItem(K.token); }

// 저장하려던 작업을 기억해 두고 Spotify 로그인으로 이동
export async function connectSpotify(pending) {
  if (!spotifyEnabled()) throw new UserError('Spotify 연동이 아직 설정되지 않았어요.');
  const verifier = randomString(64);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = randomString(16);
  sessionStorage.setItem(K.verifier, verifier);
  sessionStorage.setItem(K.state, state);
  sessionStorage.setItem(K.ret, location.hash || '#/');
  if (pending) sessionStorage.setItem(K.pending, JSON.stringify(pending));
  const params = new URLSearchParams({
    client_id: config.spotifyClientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES,
    state,
  });
  location.href = `${AUTH_URL}?${params}`;
}

// spotify-callback.html 에서 불러요
export async function handleCallback() {
  const sp = new URLSearchParams(location.search);
  const back = sessionStorage.getItem(K.ret) || '#/';
  const go = (msg) => {
    if (msg) sessionStorage.setItem('sr-flash', msg);
    location.replace(`/app/${back}`);
  };
  if (sp.get('error')) return go('Spotify 연결을 취소했어요.');
  if (!sp.get('code') || sp.get('state') !== sessionStorage.getItem(K.state)) return go('Spotify 연결 확인에 실패했어요. 다시 시도해 주세요.');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: sp.get('code'),
      redirect_uri: redirectUri(),
      client_id: config.spotifyClientId,
      code_verifier: sessionStorage.getItem(K.verifier) || '',
    }),
  });
  sessionStorage.removeItem(K.verifier);
  sessionStorage.removeItem(K.state);
  if (!res.ok) return go('Spotify 연결에 실패했어요. 다시 시도해 주세요.');
  const j = await res.json();
  sessionStorage.setItem(K.token, JSON.stringify({ accessToken: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 }));
  go('');
}

export function takePending() {
  const p = sessionStorage.getItem(K.pending);
  sessionStorage.removeItem(K.pending);
  try { return p ? JSON.parse(p) : null; } catch { return null; }
}

async function call(path, init = {}) {
  const token = getToken();
  if (!token) throw new UserError('Spotify 연결이 끊어졌어요. 다시 연결해 주세요.');
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (res.status === 401) { clearToken(); throw new UserError('Spotify 연결이 만료됐어요. 다시 연결해 주세요.'); }
  if (res.status === 403) throw new UserError('Spotify 베타 테스터로 등록된 계정만 저장할 수 있어요. 운영자에게 등록을 요청해 주세요.');
  if (res.status === 429) throw new UserError('Spotify 요청이 많아요. 잠시 후 다시 시도해 주세요.');
  if (!res.ok) throw new UserError(`Spotify 요청에 실패했어요 (${res.status}).`);
  return res.status === 204 ? null : res.json();
}

// tracks: [{ title, artistName, spotifyId }]
export async function savePlaylist({ name, description, tracks }, onProgress = () => {}) {
  const uris = [];
  const missing = [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    onProgress(`곡 찾는 중 ${i + 1}/${tracks.length}`);
    if (t.spotifyId) { uris.push(`spotify:track:${t.spotifyId}`); continue; }
    const q = encodeURIComponent(`track:${t.title} artist:${t.artistName}`);
    const r = await call(`/search?q=${q}&type=track&limit=1&market=KR`);
    const hit = r?.tracks?.items?.[0];
    if (hit) uris.push(hit.uri); else missing.push(t.title);
  }
  if (!uris.length) throw new UserError('Spotify 에서 찾은 곡이 없어요.');
  onProgress('플레이리스트 만드는 중');
  const pl = await call('/me/playlists', { method: 'POST', body: JSON.stringify({ name, description, public: false }) });
  for (let i = 0; i < uris.length; i += 100) {
    await call(`/playlists/${pl.id}/items`, { method: 'POST', body: JSON.stringify({ uris: uris.slice(i, i + 100) }) });
  }
  return { url: pl.external_urls?.spotify || `https://open.spotify.com/playlist/${pl.id}`, added: uris.length, missing };
}
