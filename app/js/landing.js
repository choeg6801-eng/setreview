// 랜딩 페이지(/) 연결: 검색창 → 웹앱, 출시 알림 폼 → 데이터베이스 저장
import { getApi } from './api/index.js';

const result = document.getElementById('notify-result');
let hideTimer;
function say(msg, ok = true) {
  if (!result) return alert(msg);
  result.textContent = msg;
  result.style.background = ok ? '#CFF7E0' : '#FFD9D9';
  result.style.display = 'block';
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { result.style.display = 'none'; }, 3500);
}

document.getElementById('hero-search-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('fest-search')?.value.trim();
  location.href = q ? `/app/#/?q=${encodeURIComponent(q)}` : '/app/';
});

document.getElementById('notify-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('notify-email')?.value || '';
  const consent = document.getElementById('notify-consent')?.checked;
  const btn = e.target.querySelector('[type="submit"]');
  if (!consent) return say('이메일 수집·이용에 동의해 주세요.', false);
  try {
    btn && (btn.disabled = true);
    const api = await getApi();
    await api.joinWaitlist(email, consent);
    e.target.reset();
    document.getElementById('notify-consent').checked = false;
    say('출시 알림 신청이 완료됐어요. 11월에 가장 먼저 알려드릴게요!');
  } catch (err) {
    say(err.userMessage || '신청에 실패했어요. 잠시 후 다시 시도해 주세요.', false);
  } finally {
    btn && (btn.disabled = false);
  }
});
