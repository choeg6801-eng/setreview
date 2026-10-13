// ---------- 안전한 HTML 템플릿 ----------
// html`...` 안의 값은 자동으로 이스케이프돼요. 이미 만든 HTML 은 raw() 로 감싸요.
export class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function fmt(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(fmt).join('');
  return esc(String(v));
}

export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) out += fmt(vals[i]);
  });
  return new Raw(out);
}

// ---------- 날짜 (모두 한국 시간 기준) ----------
const TZ = 'Asia/Seoul';
const DAY = 86400000;
const KST = 9 * 3600000;

export function fmtDate(iso, opts = {}) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: TZ, month: 'long', day: 'numeric', weekday: 'short', ...opts }).format(new Date(iso));
}
export function fmtTime(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
export function fmtDateTime(iso) {
  if (!iso) return '';
  return `${fmtDate(iso)} ${fmtTime(iso)}`;
}
const kstDay = (ms) => Math.floor((ms + KST) / DAY);

// 오늘 기준 며칠 남았는지 (공연 당일 0)
export function daysUntil(iso, now = Date.now()) {
  return kstDay(new Date(iso).getTime()) - kstDay(now);
}
export function dday(iso, now = Date.now()) {
  const d = daysUntil(iso, now);
  if (d === 0) return 'D-DAY';
  return d > 0 ? `D-${d}` : `D+${-d}`;
}

// <input type="datetime-local"> 값 ↔ ISO (한국 시간으로 입력받아요)
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + KST);
  return d.toISOString().slice(0, 16);
}
export function fromLocalInput(v) {
  if (!v) return null;
  return new Date(v + ':00+09:00').toISOString();
}

export function mmss(sec) {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return '';
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
// "3:25" 또는 "205" → 초
export function parseMmss(v) {
  const t = String(v || '').trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(\d+):(\d{1,2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function timeAgo(iso, now = Date.now()) {
  const m = Math.round((now - new Date(iso).getTime()) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return fmtDate(iso);
}

// ---------- 기타 ----------
export function slugify(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item-' + Date.now().toString(36);
}

export function uid(prefix = 'id') {
  const r = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
  return prefix ? `${prefix}-${r}` : r;
}

export function groupBy(arr, key) {
  const m = new Map();
  for (const x of arr) {
    const k = typeof key === 'function' ? key(x) : x[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function won(n) {
  return new Intl.NumberFormat('ko-KR').format(n) + '원';
}

// ---------- 알림 토스트 ----------
let toastTimer;
export function toast(message, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.className = `toast toast-${kind} show`;
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

export function errorMessage(e) {
  if (!e) return '알 수 없는 오류가 났어요.';
  if (typeof e === 'string') return e;
  return e.userMessage || e.message || '알 수 없는 오류가 났어요.';
}

export class UserError extends Error {
  constructor(message) {
    super(message);
    this.userMessage = message;
  }
}
