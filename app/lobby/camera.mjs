// ロビー画面のカメラ演出。
// 「引き」と「顔のアップ」を交互に切り替える。各シーンはゆっくり動き（パン・ロール）、ときどきピントが背景へ抜ける。
// 望遠（130mm）で遠くから撮る。背景が大きく寄って見え、ぼけも大きくなる。
// シーンは「何を・どの大きさで・どこから・画面のどこに」で書く（カメラの位置は計算で決まる）:
//   at:  写す中心 [x, y, z]（m。キャラは原点、+X が画面の右）。始点 → 終点。head: true なら頭からの相対
//   h:   画面の縦に入る高さ（m）。小さいほどキャラが大きく映る
//   az:  カメラの回り込み（度。0 が正面、プラスで画面の右側から）   el: 見下ろし（プラス）・見上げ（マイナス）
//   off: 中心を画面のどこに置くか [左右, 上下]（画面の幅・高さに対する割合。左と下がマイナス）
//   roll: 傾き（度）, dur: 秒, ap: ぼけの強さ
export const CAM = {
  focal: 130,                     // 焦点距離（mm）。センサー 36mm を画面の横に合わせる
  fadeOut: 0.3, fadeIn: 0.45,     // シーンの切り替え（暗くなりながらぼける → 戻る）
  rackEvery: [7, 12],             // ピントが背景へ抜ける間隔（秒）。引きのシーンだけ
  rackMove: 0.45, rackHold: 0.55, // 抜ける時間・抜けたままの時間（きびきびと。合わせて 1.5 秒ほど）
  rackTo: 60,                     // 抜けた先の距離（m）
  sway: 0.012,                    // 手持ちのような細かいゆれ（m）
  minY: 0.07,                     // カメラが床にもぐらない高さ
};
const W = (o) => ({roll: [0, 0], dur: 12, ap: 4.5, ...o}), F = (o) => ({head: true, at: [[0, -.10, 0], [0, -.09, 0]], dur: 8, ap: 6, roll: [0, 0], ...o});
export const SHOTS = {
  lookback: {
    wide: [W({at: [[0, 1.19, 0], [0, 1.21, 0]], h: [1.12, 1.04], az: [14, 6], el: [-8, -6], off: [[-.17, -.02], [-.15, -.03]], roll: [6, 2.5], dur: 13}),
           W({at: [[0, 0.62, 0], [0, 1.4, 0]], h: [0.6, 0.6], az: [-10, -4], el: [-4, -2], off: [[-.15, 0], [-.14, 0]], roll: [-4, -1], dur: 11}),
           W({at: [[0, 1.3, 0], [0, 1.32, 0]], h: [0.8, 0.72], az: [26, 16], el: [1, 3], off: [[-.17, -.03], [-.15, -.02]], roll: [-3, 1]})],
    face: [F({h: [.74, .68], az: [12, 4], el: [-5, -3], off: [[-.13, .0], [-.11, .0]], roll: [4, 1]}),
           F({h: [.62, .58], az: [-6, 2], el: [2, 0], off: [[-.12, -.04], [-.10, -.03]], roll: [-5, -2]})],
  },
  lean: {
    wide: [W({at: [[0, 1.19, 0.05], [0, 1.21, 0.05]], h: [1.12, 1.04], az: [-8, 2], el: [25, 21], off: [[-.16, .0], [-.14, .0]], roll: [-5, -2], dur: 13}),
           W({at: [[0, 1.3, 0.1], [0, 1.32, 0.1]], h: [0.74, 0.66], az: [14, 6], el: [15, 12], off: [[-.16, -.02], [-.14, -.02]], roll: [3, 0]}),
           W({at: [[0, 0.7, 0.05], [0, 1.4, 0.1]], h: [0.62, 0.62], az: [-4, -10], el: [8, 14], off: [[-.14, 0], [-.14, 0]], roll: [2, -3], dur: 11})],
    face: [F({h: [.74, .68], az: [-4, 4], el: [17, 13], off: [[-.13, .0], [-.11, .0]], roll: [-4, -1]}),
           F({h: [.62, .58], az: [10, 4], el: [8, 10], off: [[-.12, -.03], [-.10, -.03]], roll: [5, 2]})],
  },
  chest: {
    wide: [W({at: [[0, 1.19, 0], [0, 1.21, 0]], h: [1.12, 1.04], az: [32, 22], el: [-5, -3], off: [[-.17, .02], [-.15, .0]], roll: [4, 1], dur: 13}),
           W({at: [[0, 0.66, 0], [0, 1.4, 0]], h: [0.6, 0.6], az: [16, 24], el: [-2, 0], off: [[-.15, 0], [-.14, 0]], roll: [-3, 0], dur: 11}),
           W({at: [[0, 1.3, 0], [0, 1.32, 0]], h: [0.8, 0.72], az: [4, 12], el: [4, 2], off: [[-.16, -.03], [-.14, -.02]], roll: [-4, -1]})],
    face: [F({h: [.74, .68], az: [26, 18], el: [-3, -1], off: [[-.13, .0], [-.11, .0]], roll: [3, 0]}),
           F({h: [.62, .58], az: [8, 14], el: [3, 1], off: [[-.12, -.04], [-.10, -.03]], roll: [-5, -2]})],
  },
  behind: {
    wide: [W({at: [[0, 1.19, 0], [0, 1.21, 0]], h: [1.12, 1.04], az: [-28, -18], el: [-4, -2], off: [[-.15, .02], [-.14, .0]], roll: [-4, -1], dur: 13}),
           W({at: [[0, 1.3, 0], [0, 1.32, 0]], h: [0.8, 0.72], az: [6, -4], el: [5, 3], off: [[-.16, -.03], [-.14, -.02]], roll: [4, 1]}),
           W({at: [[0, 0.66, 0], [0, 1.4, 0]], h: [0.6, 0.6], az: [-12, -20], el: [-2, 1], off: [[-.14, 0], [-.14, 0]], roll: [3, 0], dur: 11})],
    face: [F({h: [.74, .68], az: [-20, -12], el: [-2, 0], off: [[-.13, .0], [-.11, .0]], roll: [-3, 0]}),
           F({h: [.62, .58], az: [-2, -8], el: [4, 2], off: [[-.12, -.04], [-.10, -.03]], roll: [5, 2]})],
  },
};

import * as THREE from 'three';
const rad = d => d * Math.PI / 180, lerp = (a, b, k) => a + (b - a) * k, ss = k => k * k * (3 - 2 * k);
const rnd = ([a, b]) => a + Math.random() * (b - a);

export function createDirector(camera, post, {head}) {
  const anchor = new THREE.Vector3(), hp = new THREE.Vector3(), T = new THREE.Vector3(), dir = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3();
  let pose = null, kind = 'wide', idx = {wide: 0, face: 0}, shot = null, t = 0, phase = 'in', pt = 0, pending = null, time = 0;
  let rackAt = rnd(CAM.rackEvery), rack = 0, anchored = false;
  const go = (p, instant) => { pending = p; if (instant) { apply(); phase = 'in'; pt = CAM.fadeIn; } else if (phase !== 'out') { phase = 'out'; pt = 0; } };
  const api = {
    enabled: true, focal: 0, aspect: 16 / 9, focus: 0,
    get kind() { return kind; }, get shot() { return shot; }, get index() { return idx[kind]; },
    setFov() { if (!api.focal) return; camera.fov = 2 * Math.atan(18 / api.focal / api.aspect) * 180 / Math.PI; camera.updateProjectionMatrix(); },
    cut(k = kind === 'wide' ? 'face' : 'wide', instant = false) { go({kind: k}, instant); },   // 次のシーンへ（省くと引きとアップを交互に）
    setPose(key, instant = false) { pose = key; go({kind: 'wide', reset: true}, instant); },
    update(dt) {
      if (!api.enabled || !pose) return;
      time += dt; t += dt;
      let dim = 0;
      if (phase === 'out') { pt += dt; dim = Math.min(1, pt / CAM.fadeOut); if (pt >= CAM.fadeOut) { apply(); phase = 'in'; pt = 0; dim = 1; } }
      else if (phase === 'in') { pt += dt; dim = 1 - Math.min(1, pt / CAM.fadeIn); if (pt >= CAM.fadeIn) phase = 'run'; }
      else if (t >= shot.dur) api.cut();
      if (!shot) return;
      const k = Math.min(1, t / shot.dur), e = k * .6 + ss(k) * .4, L = a => lerp(a[0], a[1], e);
      head.getWorldPosition(hp); if (!anchored) { anchor.copy(hp); anchored = true; } else anchor.lerp(hp, 1 - Math.exp(-3 * dt));
      const focal = shot.focal ?? CAM.focal; if (api.focal !== focal) { api.focal = focal; api.setFov(); }
      const az = rad(L(shot.az)), el = rad(L(shot.el)), h = L(shot.h), w = h * api.aspect, d = h * focal * api.aspect / 36;
      T.set(lerp(shot.at[0][0], shot.at[1][0], e), lerp(shot.at[0][1], shot.at[1][1], e), lerp(shot.at[0][2], shot.at[1][2], e)); if (shot.head) T.add(anchor);
      dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)); right.set(Math.cos(az), 0, -Math.sin(az)); up.crossVectors(dir, right);   // 画面の右・上
      const ox = lerp(shot.off[0][0], shot.off[1][0], e), oy = lerp(shot.off[0][1], shot.off[1][1], e);
      T.addScaledVector(right, -ox * w).addScaledVector(up, -oy * h);
      T.x += Math.sin(time * .43) * CAM.sway; T.y += Math.sin(time * .57 + 1.7) * CAM.sway * .7;
      camera.position.copy(T).addScaledVector(dir, d); if (camera.position.y < CAM.minY) camera.position.y = CAM.minY;
      camera.up.set(0, 1, 0); camera.lookAt(T); camera.rotateZ(rad(L(shot.roll) + Math.sin(time * .31) * .3));
      // ピント: ふだんは顔。引きのシーンでは、ときどき背景へ抜ける
      if (kind === 'wide' && phase === 'run' && time >= rackAt && t < shot.dur - 4.5) { rackAt = Infinity; rack = 1e-6; }
      let r = 0;
      if (rack > 0) { rack += dt; const a = CAM.rackMove, hd = CAM.rackHold; r = rack < a ? ss(rack / a) : rack < a + hd ? 1 : rack < 2 * a + hd ? 1 - ss((rack - a - hd) / a) : 0; if (rack >= 2 * a + hd) { rack = 0; rackAt = time + rnd(CAM.rackEvery); } }
      camera.getWorldDirection(fwd); const subject = Math.max(.3, hp.sub(camera.position).dot(fwd));
      api.focus = post.focus = 1 / lerp(1 / subject, 1 / CAM.rackTo, r);
      post.aperture = shot.ap * (1 + 5 * ss(dim)); post.fade = 1 - .85 * ss(dim);
    },
  };
  function apply() {
    if (pending.reset) idx = {wide: 0, face: 0};
    kind = pending.kind; const list = SHOTS[pose][kind]; shot = list[idx[kind] % list.length]; idx[kind]++; t = 0; rack = 0; rackAt = time + rnd(CAM.rackEvery) * .6; pending = null; anchored = false;
  }
  return api;
}
