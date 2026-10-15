// 배경 음악: 화면을 옮겨 다녀도 끊기지 않도록 페이지에 하나만 만들어 둬요.
// 브라우저는 사용자가 누르기 전에는 소리를 못 내게 막아서, 기본은 꺼짐이고
// 한 번 켠 사람은 다음 방문 때 첫 터치·클릭에 이어서 재생돼요.
import { config } from './config.js';

export const BGM_SRC = '/assets/audio/bgm.mp3';
export const BGM_TITLE = 'Scent of Success';
const KEY = 'sr-bgm';

let audio = null;
const listeners = new Set();

function el() {
  if (!audio) {
    audio = new Audio(BGM_SRC);
    audio.loop = true;
    audio.preload = 'none';
    audio.volume = 0.35;
    for (const ev of ['play', 'pause', 'ended']) audio.addEventListener(ev, () => listeners.forEach((fn) => fn()));
  }
  return audio;
}

const save = (on) => { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* 무시 */ } };
const saved = () => { try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } };

// 곡 파일이 실제로 있을 때만 버튼을 보여 줘요
let available = false;
export const isAvailable = () => available;
export async function checkAvailable() {
  if (!config.bgm) return (available = false); // 파일을 올리기 전엔 확인 요청도 보내지 않아요
  try {
    const r = await fetch(BGM_SRC, { method: 'HEAD', cache: 'no-store' });
    available = r.ok && /audio|mpeg|octet/i.test(r.headers.get('content-type') || '');
  } catch { available = false; }
  if (available) listeners.forEach((fn) => fn());
  return available;
}

export const isPlaying = () => !!audio && !audio.paused;
export const onChange = (fn) => listeners.add(fn);

export async function toggle() {
  const a = el();
  if (a.paused) {
    try { await a.play(); save(true); } catch { save(false); throw new Error('배경 음악을 재생하지 못했어요.'); }
  } else {
    a.pause();
    save(false);
  }
}

// 지난번에 켜 두었으면 첫 상호작용 때 다시 틀어요
export function resumeIfSaved() {
  if (!saved() || !available) return;
  const start = (e) => {
    if (e?.target?.closest?.('[data-action="toggle-bgm"]')) return; // 음악 버튼을 누른 경우엔 버튼이 처리해요
    window.removeEventListener('pointerdown', start, true);
    window.removeEventListener('keydown', start, true);
    if (saved() && !isPlaying()) el().play().catch(() => {});
  };
  window.addEventListener('pointerdown', start, true);
  window.addEventListener('keydown', start, true);
}
