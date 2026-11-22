// ロビー画面の UI（見た目だけ。ゲームの機能はない）。キャラの名前やセリフは character.json の ui から受け取る。
// 左右のパネル群を内側へ折って奥行きを付けた、コックピットの HUD のような並び。
//   左の翼: プレイヤー、六角のメニュー、キャラ名とポーズ切替      右の翼: 通貨、イベント、出撃、縦長のブレード4枚
//   画面に直接乗るもの: 枠の飾り、キャラの頭を追う照準とタグ、セリフ、カメラの数値、足元へ倒したお知らせ帯
const svg = (d, o = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${o}>${d}</svg>`;
const I = {
  mission: svg('<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h3"/>'),
  event: svg('<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.3l6.1-.7z"/>'),
  friend: svg('<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20c.5-4 3-6 6.5-6s6 2 6.5 6M16 4.8a3.4 3.4 0 010 6.6M18 14.2c2.4.8 3.5 2.8 3.9 5.8"/>'),
  news: svg('<path d="M4 10v4h3l6 4V6l-6 4z"/><path d="M16.5 9.5a4 4 0 010 5M19 7a8 8 0 010 10"/>'),
  mail: svg('<path d="M3 6h18v12H3z"/><path d="M3 7l9 7 9-7"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
  team: svg('<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/><path d="M9 12l2 2 4-4"/>'),
  scout: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>'),
  story: svg('<path d="M4 5c3-1 5-1 8 1 3-2 5-2 8-1v14c-3-1-5-1-8 1-3-2-5-2-8-1z"/><path d="M12 6v14"/>'),
  shop: svg('<path d="M4 9h16l-1.5 11h-13z"/><path d="M8 9V7a4 4 0 018 0v2"/>'),
  camera: svg('<path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/>'),
  eye: svg('<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  energy: svg('<path d="M13 2L5 13.5h6L10 22l9-12.5h-6z" fill="currentColor" stroke="none"/>'),
  coin: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.5 10h4a1.6 1.6 0 010 3.2h-3a1.6 1.6 0 000 3.2h4"/>'),
  gem: svg('<path d="M7 4h10l4 5.5L12 21 3 9.5z"/><path d="M3 9.5h18M9 9.5L12 21l3-11.5M7 4l2 5.5M17 4l-2 5.5"/>'),
};
// character.json の ui で上書きできる値（書かなければこの既定値）
const DEFAULT = {name: 'キャラクター', nameEn: 'CHARACTER', tag: 'CHARA', short: 'キャラ',
  lines: ['雨、あがったね。', '今日もおつかれさま。', '夜の屋上、けっこう好き。', '次はどこ行く？', '……見すぎ。'],
  news: ['【開催中】イベント「雨上がりのネオン街」 屋上エリアを期間限定で解放', '【スカウト】{name} ピックアップ 開催中', '【お知らせ】SECTOR 07 定期メンテナンスは明日 04:00 から', '【ログインボーナス】7日目の報酬を受け取れます']};
const esc = v => String(v).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);

export function buildUi(root, {poses, onPose, onCut, onHide, chara = {}}) {
  const C = {...DEFAULT, ...chara}, LINES = C.lines, NEWS = C.news.map(t => t.replaceAll('{name}', C.name));
  const hex = (icon, jp, en, dot) => `<button class="hex"><span class="ico">${I[icon]}</span>${dot ? '<i class="dot"></i>' : ''}<span class="lbl"><b>${jp}</b><small>${en}</small></span></button>`;
  const chip = (icon, cls, val) => `<div class="chip ${cls}"><span class="ico">${I[icon]}</span><b>${val}</b><i class="plus">+</i></div>`;
  const blade = (n, icon, jp, en, dot) => `<button class="blade" style="--i:${n}"><span><span class="ico">${I[icon]}</span><b>${jp}</b><small>${en}</small><em>0${n + 1}</em>${dot ? '<i class="dot"></i>' : ''}</span></button>`;
  const ring = `<svg class="ring" viewBox="0 0 100 100" fill="none" stroke="currentColor"><circle class="r1" cx="50" cy="50" r="45" stroke-width="1.2" stroke-dasharray="3 5"/><circle class="r2" cx="50" cy="50" r="37" stroke-width="3" stroke-dasharray="70 28 12 28"/><circle class="r3" cx="50" cy="50" r="28" stroke-width="1" stroke-dasharray="40 12"/><path d="M43 35l22 15-22 15z" fill="currentColor" stroke="none"/></svg>`;
  root.innerHTML = `
    <div class="hud">
      <i class="cn tl"></i><i class="cn tr"></i><i class="cn bl"></i><i class="cn br"></i><i class="sweep"></i>
      <div class="toptag"><i class="live"></i><b>LIVE</b><span>SECTOR 07 ／ ROOFTOP-A</span><span class="dim">雨上がり 12℃</span></div>
      <div class="ruler"></div>
      <div class="readout"><span>FL <b data-r="fl">130</b>mm</span><span>FD <b data-r="fd">0.00</b>m</span><span>CAM <b data-r="cam">WIDE-01</b></span></div>
      <div class="vtext">ROOFTOP UNIT ／ ${esc(C.short)} ／ 07</div>
    </div>
    <div class="wing L">
      <div class="player"><div class="lv"><i></i><span><small>LV</small><b>42</b></span></div><div class="who"><small>COMMANDER ／ ID 0x7A21</small><b>指揮官</b><div class="seg"><i style="--v:.64"></i><em>EXP 64%</em></div></div></div>
      <div class="comb">${hex('mission', 'ミッション', 'MISSION', 1)}${hex('event', 'イベント', 'EVENT', 1)}${hex('friend', 'フレンド', 'FRIEND')}${hex('news', 'お知らせ', 'NEWS')}</div>
      <div class="chara"><div class="name"><small>${esc(C.nameEn)}</small><b data-text="${esc(C.name)}">${esc(C.name)}</b></div><div class="bond"><small>BOND</small><b>Lv.7</b><div class="seg m"><i style="--v:.38"></i></div></div>
        <div class="poses">${poses.map(([k, l], i) => `<button data-pose="${k}"><em>${i + 1}</em>${l}</button>`).join('')}</div></div>
    </div>
    <div class="wing R">
      <div class="top">${chip('energy', 'en', '142<small>/160</small>')}${chip('coin', 'co', '1,284,500')}${chip('gem', 'ge', '3,260')}<button class="round">${I.mail}<i class="dot"></i></button><button class="round">${I.gear}</button></div>
      <div class="deck">
        <button class="banner"><span class="tag">EVENT</span><b>雨上がりのネオン街</b><small>NEON AFTER THE RAIN ・ 残り 6日 12時間</small><div class="seg w"><i style="--v:.72"></i></div></button>
        <button class="sortie">${ring}<span class="txt"><small>MAIN OPERATION ▸ 3-7</small><b>出撃</b><em>SORTIE</em></span><span class="chev">›››</span><i class="hatch"></i></button>
        <div class="blades">${blade(0, 'team', '編成', 'FORMATION')}${blade(1, 'scout', 'スカウト', 'SCOUT', 1)}${blade(2, 'story', 'ストーリー', 'STORY')}${blade(3, 'shop', 'ショップ', 'SHOP')}</div>
      </div>
      <div class="tools"><button data-act="cut" title="シーン切替 (C)">${I.camera}</button><button data-act="hide" title="UI を隠す (H)">${I.eye}</button></div>
    </div>
    <div class="floor"><div class="ticker"><span class="tk">NEWS</span><div class="run"><p></p></div><span class="clock"></span></div></div>
    <div class="lock"><i class="pin"></i><i class="lead"></i><div class="tag"><b>${esc(C.tag)}</b><span>SYNC <em data-r="sync">98.2</em>%</span></div></div>
    <div class="bubble"><span></span></div>`;
  const $ = s => root.querySelector(s), frame = root.parentElement;
  for (const b of root.querySelectorAll('[data-pose]')) b.onclick = () => onPose(b.dataset.pose);
  $('[data-act=cut]').onclick = onCut; $('[data-act=hide]').onclick = e => { e.stopPropagation(); onHide(); };
  frame.addEventListener('click', e => { if (document.body.classList.contains('noui') && !e.target.closest('button')) onHide(); });
  let tx = 0, ty = 0, mx = 0, my = 0;   // マウスの位置でパネルがわずかに向きを変える
  frame.addEventListener('pointermove', e => { const r = frame.getBoundingClientRect(); tx = (e.clientX - r.left) / r.width * 2 - 1; ty = (e.clientY - r.top) / r.height * 2 - 1; });
  frame.addEventListener('pointerleave', () => { tx = ty = 0; });
  $('.run p').textContent = NEWS.join('　　　◆　　　');
  const R = Object.fromEntries([...root.querySelectorAll('[data-r]')].map(e => [e.dataset.r, e])), lock = $('.lock'), bubble = $('.bubble');
  let t = 0, nextLine = 5, line = 0, slow = 0, hx = .36, hy = .3;
  return {
    setPose(key) { for (const b of root.querySelectorAll('[data-pose]')) b.classList.toggle('on', b.dataset.pose === key); },
    tick(dt, info = {}) {
      t += dt;
      const k = 1 - Math.exp(-6 * dt); mx += (tx - mx) * k; my += (ty - my) * k;
      root.style.setProperty('--mx', mx.toFixed(3)); root.style.setProperty('--my', my.toFixed(3));
      if (info.head?.on) {   // 照準とセリフは頭に付いて回る
        hx += (info.head.x - hx) * (1 - Math.exp(-10 * dt)); hy += (info.head.y - hy) * (1 - Math.exp(-10 * dt));
        lock.style.left = bubble.style.left = (hx * 100).toFixed(2) + '%'; lock.style.top = bubble.style.top = (hy * 100).toFixed(2) + '%';
        lock.classList.toggle('face', info.kind === 'face'); lock.classList.toggle('flip', hy < .16); bubble.classList.toggle('face', info.kind === 'face');   // 頭が画面の上端に近いときはタグを下へ出す
      }
      if (t >= slow) {
        slow = t + .4; const d = new Date();
        $('.clock').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        if (info.focal) { R.fl.textContent = Math.round(info.focal); R.fd.textContent = (info.focus ?? 0).toFixed(2); R.cam.textContent = (info.kind === 'face' ? 'FACE' : 'WIDE') + '-0' + (info.index ?? 1); }
        R.sync.textContent = (97.6 + Math.sin(t * .7) * 1.2 + Math.random() * .4).toFixed(1);
      }
      if (t >= nextLine) { bubble.firstElementChild.textContent = LINES[line++ % LINES.length]; bubble.classList.add('show'); setTimeout(() => bubble.classList.remove('show'), 4200); nextLine = t + 16; }
    },
  };
}
