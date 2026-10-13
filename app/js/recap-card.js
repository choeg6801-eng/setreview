// 인스타그램 스토리 크기(1080×1920) 복습 카드를 캔버스에 그려요
const W = 1080;
const H = 1920;
const C = { bg: '#0A0C24', text: '#EEEDFB', muted: '#B9B8E0', accent: '#FF6A1F', peach: '#FFB27A', card: 'rgba(18,22,60,0.82)' };

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function cover(ctx, img, x, y, w, h) {
  const r = Math.max(w / img.width, h / img.height);
  const iw = img.width * r;
  const ih = img.height * r;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

function fit(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// data: { artist, eventTitle, dateText, coverUrl, items:[{ title, isEncore, surprise }], stats:[[value,label]x3] }
export async function drawRecap(canvas, data) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  try {
    await Promise.all([
      document.fonts.load('900 80px "Noto Sans KR"'),
      document.fonts.load('500 40px "Noto Sans KR"'),
      document.fonts.load('italic 64px "Instrument Serif"'),
      document.fonts.load('700 40px "Space Grotesk"'),
    ]);
  } catch { /* 글꼴을 못 불러오면 기본 글꼴로 그려요 */ }
  const sans = '"Noto Sans KR", system-ui, sans-serif';

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const img = await loadImage(data.coverUrl);
  if (img) {
    cover(ctx, img, 0, 0, W, 980);
    const g = ctx.createLinearGradient(0, 0, 0, 1000);
    g.addColorStop(0, 'rgba(10,12,36,0.55)');
    g.addColorStop(0.55, 'rgba(10,12,36,0.55)');
    g.addColorStop(1, C.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, 1000);
  }
  const glow = ctx.createRadialGradient(W * 0.85, H * 0.9, 0, W * 0.85, H * 0.9, 700);
  glow.addColorStop(0, 'rgba(255,106,31,0.28)');
  glow.addColorStop(1, 'rgba(255,106,31,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const X = 84;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.peach;
  ctx.font = 'italic 64px "Instrument Serif", Georgia, serif';
  ctx.fillText('my night', X, 190);

  ctx.fillStyle = C.text;
  ctx.font = `900 96px ${sans}`;
  ctx.fillText(fit(ctx, data.artist, W - X * 2), X, 320);
  ctx.font = `500 40px ${sans}`;
  ctx.fillStyle = C.muted;
  ctx.fillText(fit(ctx, data.eventTitle, W - X * 2), X, 390);
  ctx.fillText(fit(ctx, data.dateText, W - X * 2), X, 444);

  // 셋리스트
  const listTop = 540;
  const maxRows = 14;
  const rows = data.items.slice(0, maxRows);
  roundRect(ctx, X - 24, listTop - 30, W - (X - 24) * 2, 76 + rows.length * 62 + (data.items.length > maxRows ? 50 : 0), 36);
  ctx.fillStyle = C.card;
  ctx.fill();
  ctx.font = `700 30px "Space Grotesk", ${sans}`;
  ctx.fillStyle = C.peach;
  ctx.fillText('TONIGHT’S SETLIST', X + 10, listTop + 22);
  rows.forEach((it, i) => {
    const y = listTop + 92 + i * 62;
    ctx.font = `700 34px "Space Grotesk", ${sans}`;
    ctx.fillStyle = it.isEncore ? C.accent : 'rgba(185,184,224,0.75)';
    ctx.fillText(it.isEncore ? 'EN' : String(i + 1).padStart(2, '0'), X + 10, y);
    ctx.font = `500 40px ${sans}`;
    ctx.fillStyle = it.surprise ? C.peach : C.text;
    const label = it.surprise ? `${it.title} ✦` : it.title;
    ctx.fillText(fit(ctx, label, W - X * 2 - 120), X + 100, y);
  });
  if (data.items.length > maxRows) {
    ctx.font = `500 32px ${sans}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(`+ ${data.items.length - maxRows}곡 더`, X + 100, listTop + 92 + maxRows * 62);
  }

  // 통계
  const statY = 1560;
  const bw = (W - X * 2 - 40) / 3;
  data.stats.forEach(([value, label], i) => {
    const x = X + i * (bw + 20);
    roundRect(ctx, x, statY, bw, 170, 30);
    ctx.fillStyle = i === 1 ? C.accent : 'rgba(28,33,88,0.92)';
    ctx.fill();
    ctx.fillStyle = i === 1 ? C.bg : C.text;
    ctx.font = `700 68px "Space Grotesk", ${sans}`;
    ctx.fillText(String(value), x + 30, statY + 92);
    ctx.font = `500 30px ${sans}`;
    ctx.fillStyle = i === 1 ? C.bg : C.muted;
    ctx.fillText(label, x + 30, statY + 140);
  });

  // 로고
  const ly = 1810;
  roundRect(ctx, X, ly - 44, 56, 56, 16);
  ctx.fillStyle = C.accent;
  ctx.fill();
  ctx.strokeStyle = C.bg;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  [[12, 22, 30], [20, 14, 38], [28, 18, 34], [36, 10, 42], [44, 20, 32]].forEach(([dx, y1, y2]) => {
    ctx.beginPath();
    ctx.moveTo(X + dx, ly - 44 + y1);
    ctx.lineTo(X + dx, ly - 44 + y2);
    ctx.stroke();
  });
  ctx.fillStyle = C.text;
  ctx.font = `900 40px ${sans}`;
  ctx.fillText('셋리뷰', X + 76, ly);
  ctx.font = `500 30px ${sans}`;
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'right';
  ctx.fillText('#페스티벌예습 #떼창포인트', W - X, ly);
  ctx.textAlign = 'left';
}

export function canvasToFile(canvas, name) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(new File([b], name, { type: 'image/png' })), 'image/png'));
}
