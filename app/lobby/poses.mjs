// ロビー画面の立ちポーズと待機アニメーション。
// VRM の正規化ボーン（T ポーズが基準、+Z が正面、+X が本人の左）へ角度を入れる。角度は度。
//   体幹・頭・脚: [前に倒す(+)／反る(-), 本人の左へ向く(+), 本人の右へ傾く(+)]（Y → X → Z の順に掛かる）
//   腕・指:       [腕の軸でねじる, 前後に振る, 上下]（左腕は 下げる= z マイナス、前へ= y マイナス。右腕は逆）
// 待機アニメーション（呼吸・重心のゆれ・首のゆらぎ）はポーズの上に足す。
import * as THREE from 'three';

const ARM = /Shoulder|Arm|Hand|Thumb|Index|Middle|Ring|Little/;
const D = Math.PI / 180;

// 指: curl=握り具合（0〜1）、spread=開き
function fingers(side, curl, {thumb = curl * .5, index = curl, spread = 0} = {}) {
  const s = side === 'left' ? -1 : 1, o = {};
  for (const [f, k] of [['Index', index], ['Middle', curl], ['Ring', curl * 1.05], ['Little', curl * 1.1]])
    for (const [seg, a] of [['Proximal', 62], ['Intermediate', 78], ['Distal', 50]]) o[side + f + seg] = [0, seg === 'Proximal' ? spread * ({Index: -8, Middle: 0, Ring: 6, Little: 12})[f] * s : 0, s * a * k];
  o[side + 'ThumbMetacarpal'] = [0, -s * 28 * thumb, s * 12 * thumb]; o[side + 'ThumbProximal'] = [0, -s * 22 * thumb, 0]; o[side + 'ThumbDistal'] = [0, -s * 30 * thumb, 0];
  return o;
}

// ---- ポーズ。yaw: キャラ全体の向き（度。0 でカメラ側が正面）
// ik: 腕は「手首をどこへ置くか」で決める。bone=基準の骨, at=その骨から見た位置 [本人の左+, 上+, 前+]（m）,
//     pole=肘を張り出す向き（キャラから見た向き）, twist=前腕のねじり（度）。ik を書いた腕は bones の上腕・前腕より優先
export const POSES = {
  // ① 後ろ姿で振り返る（参考1枚目）。背中を見せて右肩ごしに振り返る。左のこぶしは左肩の前、右のこぶしは腰の横で前へ。
  //    右脚に体重、左脚はひざを曲げて後ろへ流す。カメラは後ろ・低め
  lookback: {
    label: '振り返り', yaw: 172,
    bones: {
      hips: [5, -8, 4], spine: [-2, -16, -3], chest: [-6, -20, -2], upperChest: [-6, -16, 0], neck: [0, -28, 4], head: [-4, -36, 8],
      rightUpperLeg: [-5, 2, -5], rightLowerLeg: [2, 0, 0], rightFoot: [-2, 0, 1],
      leftUpperLeg: [12, 8, 0], leftLowerLeg: [42, 0, 0], leftFoot: [-26, 0, 0],
      leftShoulder: [0, 4, 8], leftHand: [0, -14, 10], rightShoulder: [0, 6, -2], rightHand: [0, 10, -12],
      ...fingers('left', .9, {thumb: .8}), ...fingers('right', .85, {thumb: .8}),
    },
    ik: {left: {bone: 'upperChest', at: [.21, .05, .11], pole: [1, -.9, -.6]}, right: {bone: 'hips', at: [-.21, .10, .21], pole: [-.6, -.3, -1]}},
  },
  // ② 右手を腰、左手は肩の横で人さし指を立てる。前かがみで見上げる（参考2枚目）。足は開いてひざを少し内へ。カメラは上から
  lean: {
    label: 'のぞき込み', yaw: -6,
    bones: {
      hips: [12, 4, -3], spine: [9, 0, 2], chest: [7, -3, 2], upperChest: [4, -3, 0], neck: [-16, 4, -5], head: [-24, 6, -7],
      leftUpperLeg: [-12, -10, 9], leftLowerLeg: [8, 0, 0], leftFoot: [2, 8, -6],
      rightUpperLeg: [-12, 10, -9], rightLowerLeg: [8, 0, 0], rightFoot: [2, -8, 6],
      rightShoulder: [0, 0, -6], rightHand: [0, 24, -20], leftShoulder: [0, -4, 8], leftHand: [0, -8, 6],
      ...fingers('right', .9, {thumb: .6}), ...fingers('left', .95, {index: 0, thumb: .8}),
    },
    ik: {right: {bone: 'hips', at: [-.17, .10, .03], pole: [-1, .15, -.35]}, left: {bone: 'upperChest', at: [.20, .07, .10], pole: [.5, -1, .1]}},
  },
  // ③ 右手を腰、左手は指を開いて胸の上に置く。ひじは横へ張る。胸を張って腰を引く斜め立ち（参考4枚目）
  chest: {
    label: 'すまし', yaw: 34,
    bones: {
      hips: [6, -4, -8], spine: [-6, -4, 5], chest: [-8, -4, 4], upperChest: [-5, -2, 2], neck: [4, -10, -2], head: [2, -18, -6],
      leftUpperLeg: [-8, 2, 6], leftLowerLeg: [4, 0, 0], leftFoot: [0, 0, 2],
      rightUpperLeg: [-14, -6, -3], rightLowerLeg: [14, 0, 0], rightFoot: [-2, 0, 0],
      rightShoulder: [0, 4, -6], rightHand: [0, 24, -20], leftShoulder: [0, -6, 10], leftHand: [0, -6, -14],
      ...fingers('right', .9, {thumb: .6}), ...fingers('left', .12, {spread: 1.6, thumb: 0}),
    },
    ik: {right: {bone: 'hips', at: [-.17, .10, .0], pole: [-1, .2, -.7]}, left: {bone: 'upperChest', at: [.045, .0, .155], pole: [1, -.1, .25]}},
  },
  // ④ 手を後ろで組んで少し首をかしげる
  behind: {
    label: 'うしろ手', yaw: -18,
    bones: {
      hips: [-3, 4, 5], spine: [-4, 2, -3], chest: [-5, 2, -3], upperChest: [-4, 0, -2], neck: [2, 6, 6], head: [4, 10, 9],
      leftUpperLeg: [-6, 6, -4], leftLowerLeg: [6, 0, 0], leftFoot: [0, 0, 2],
      rightUpperLeg: [2, -4, 7], rightLowerLeg: [2, 0, 0], rightFoot: [0, 0, -5],
      leftShoulder: [0, 8, 2], leftHand: [0, 0, 0], rightShoulder: [0, -8, -2], rightHand: [0, 0, 0],
      ...fingers('left', .45), ...fingers('right', .45),
    },
    ik: {left: {bone: 'hips', at: [.05, .03, -.14], pole: [1, 0, -.7]}, right: {bone: 'hips', at: [-.05, .0, -.14], pole: [-1, 0, -.7]}},
  },
};

export function setupPoses(vrm) {
  const hum = vrm.humanoid, names = new Set(Object.values(POSES).flatMap(p => Object.keys(p.bones)));
  for (const n of ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm']) names.add(n);
  const bones = [...names].map(n => ({name: n, node: hum.getNormalizedBoneNode(n), arm: ARM.test(n), q: new THREE.Quaternion(), from: new THREE.Quaternion()})).filter(b => b.node);
  const hips = hum.getNormalizedBoneNode('hips'), hipsRest = hips.position.clone();
  const feet = ['leftFoot', 'rightFoot', 'leftToes', 'rightToes'].map(n => hum.getRawBoneNode(n)).filter(Boolean);
  const e = new THREE.Euler(), v = new THREE.Vector3(), qt = new THREE.Quaternion();
  // VRM 0.x は、骨の向きの基準が VRM 1.0 と前後逆（Y 軸まわりに 180°）。角度・位置・向きをすべて 180° 回して合わせる
  const v0 = vrm.meta?.metaVersion === '0', base = v0 ? Math.PI : 0, flip = a => v0 ? [-a[0], a[1], -a[2]] : a;
  const quat = (b, a, out) => { out.setFromEuler(e.set(a[0] * D, a[1] * D, a[2] * D, b.arm ? 'ZYX' : 'YXZ')); if (v0) { out.x = -out.x; out.z = -out.z; } return out; };
  const footY = () => { hum.update(); vrm.scene.updateMatrixWorld(true); return feet.map(f => f.getWorldPosition(v).y); };

  // ポーズごとに、足が床から浮いたり沈んだりしない腰の高さを先に求めておく
  for (const b of bones) b.node.quaternion.identity();
  hips.position.copy(hipsRest); const restY = footY(), built = {};
  // 腕の IK: 肩から手首の目標までを、上腕と前腕の2本で届かせる。肘は pole の向きへ張り出す
  const N = n => hum.getNormalizedBoneNode(n), V3 = () => new THREE.Vector3();
  const REST = {left: [new THREE.Vector3(...flip([1, 0, 0])), new THREE.Vector3(0, -1, 0)], right: [new THREE.Vector3(...flip([-1, 0, 0])), new THREE.Vector3(0, 1, 0)]};
  const basis = (x, y) => new THREE.Matrix4().makeBasis(x, y, V3().crossVectors(x, y));
  const solveArm = (side, spec, target) => {
    const up = N(side + 'UpperArm'), lo = N(side + 'LowerArm'), hand = N(side + 'Hand');
    vrm.scene.updateMatrixWorld(true);
    const S = up.getWorldPosition(V3()), l1 = lo.position.length(), l2 = hand.position.length(), T = N(spec.bone).localToWorld(V3().set(...flip(spec.at)));
    const n = T.sub(S), d = Math.max(Math.abs(l1 - l2) + .01, Math.min(n.length(), (l1 + l2) * .995)); n.normalize();
    const a = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
    const perp = V3().set(...flip(spec.pole)).normalize(); perp.addScaledVector(n, -perp.dot(n)).normalize();
    const E = S.clone().addScaledVector(n, l1 * Math.cos(a)).addScaledVector(perp, l1 * Math.sin(a));
    const u = E.clone().sub(S).normalize(), f = S.clone().addScaledVector(n, d).sub(E).normalize(), h = V3().crossVectors(u, f).normalize();
    const r0 = basis(...REST[side]).transpose();
    const qu = new THREE.Quaternion().setFromRotationMatrix(basis(u, h).multiply(r0)), ql = new THREE.Quaternion().setFromRotationMatrix(basis(f, h).multiply(r0));
    if (spec.twist) ql.premultiply(new THREE.Quaternion().setFromAxisAngle(f, spec.twist * D));
    const lu = up.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(qu), ll = qu.clone().invert().multiply(ql);
    target.set(side + 'UpperArm', lu); target.set(side + 'LowerArm', ll); up.quaternion.copy(lu); lo.quaternion.copy(ll);
  };
  const build = key => {
    const p = POSES[key], target = new Map(bones.map(b => [b.name, quat(b, p.bones[b.name] ?? [0, 0, 0], new THREE.Quaternion())]));
    for (const b of bones) b.node.quaternion.copy(target.get(b.name));
    hips.position.copy(hipsRest); vrm.scene.rotation.y = 0;
    for (const side of ['left', 'right']) if (p.ik?.[side]) solveArm(side, p.ik[side], target);
    const y = footY(), lift = -Math.min(...y.map((yy, i) => yy - restY[i]));
    return built[key] = {target, lift, yaw: (p.yaw ?? 0) * D};
  };
  for (const key of Object.keys(POSES)) build(key);

  let cur = null, blend = 1, time = 0, lift = 0, liftFrom = 0, yaw = 0, yawFrom = 0;
  const api = {
    get current() { return cur; },
    built(key) { return built[key] && {...built[key], hipsRest: hipsRest.clone()}; },   // 書き出し用（lobby/export-pose.mjs）: 待機アニメーションを足す前の姿勢
    rebuild(key) { build(key); if (key === cur) { cur = null; api.set(key, 0); } },   // 調整用: POSES を書き換えたあとに呼ぶ
    set(key, seconds = 0.9) {
      if (!built[key] || key === cur) return;
      for (const b of bones) b.from.copy(b.q); liftFrom = lift; yawFrom = yaw;
      cur = key; blend = seconds > 0 ? 0 : 1; api.duration = seconds;
      if (blend === 1) { for (const b of bones) b.q.copy(built[key].target.get(b.name)); lift = built[key].lift; yaw = built[key].yaw; }
    },
    // 毎フレーム、vrm.update() の前に呼ぶ
    update(dt) {
      if (!cur) return;
      time += dt; const P = built[cur];
      if (blend < 1) {
        blend = Math.min(1, blend + dt / api.duration); const k = blend * blend * (3 - 2 * blend);
        for (const b of bones) b.q.slerpQuaternions(b.from, P.target.get(b.name), k);
        lift = liftFrom + (P.lift - liftFrom) * k; yaw = yawFrom + (P.yaw - yawFrom) * k;
      }
      // ---- 待機アニメーション
      const br = Math.sin(time * 1.55), br2 = Math.sin(time * 1.55 - .9);            // 呼吸（約4秒）
      const sw = Math.sin(time * .52), sw2 = Math.sin(time * .37 + 1.3);              // 重心のゆっくりしたゆれ
      const idle = {
        hips: [sw2 * .5, sw * 1.2, sw * .9], spine: [br * .5 + sw2 * .4, -sw * .5, -sw * .5], chest: [br * .9, -sw * .4, -sw * .3], upperChest: [br2 * .8, 0, 0],
        neck: [-br2 * .5 + Math.sin(time * .43) * .8, Math.sin(time * .31 + 2) * 1.6, sw2 * .7], head: [-br * .3 + Math.sin(time * .29 + 1) * 1.1, Math.sin(time * .23) * 2.2, Math.sin(time * .19 + .5) * 1.2],
        leftShoulder: [0, 0, br * .7], rightShoulder: [0, 0, -br * .7],
        leftUpperArm: [0, sw2 * .6, br * .5 + sw * .4], rightUpperArm: [0, -sw2 * .6, -br * .5 + sw * .4],
        leftLowerArm: [0, Math.sin(time * .7) * .8, 0], rightLowerArm: [0, Math.sin(time * .7 + 1) * .8, 0],
      };
      for (const b of bones) { const a = idle[b.name]; if (a) b.node.quaternion.copy(b.q).multiply(quat(b, a, qt)); else b.node.quaternion.copy(b.q); }
      hips.position.set(hipsRest.x + sw * .006, hipsRest.y + lift + br * .0025, hipsRest.z + sw2 * .004);
      vrm.scene.rotation.y = base + yaw;
    },
  };
  return api;
}
