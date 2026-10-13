// 음악 앱 링크 — 계정 연동 없이 누구나 바로 열 수 있어요.
export function musicLinks({ title, artistName = '', spotifyId = null }) {
  const q = encodeURIComponent(`${title} ${artistName}`.trim());
  return [
    { id: 'spotify', label: 'Spotify', url: spotifyId ? `https://open.spotify.com/track/${encodeURIComponent(spotifyId)}` : `https://open.spotify.com/search/${q}` },
    { id: 'apple', label: 'Apple Music', url: `https://music.apple.com/kr/search?term=${q}` },
    { id: 'ytm', label: 'YouTube Music', url: `https://music.youtube.com/search?q=${q}` },
    { id: 'melon', label: '멜론', url: `https://www.melon.com/search/total/index.htm?q=${q}` },
    { id: 'live', label: '라이브 영상', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} ${artistName} live`)}` },
  ];
}
