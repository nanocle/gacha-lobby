// VRM に「生きている感じ」を足す: 自動瞬き、カメラ目線、ときどき視線がちょいっと動く。
// VRM の表情（blink）と LookAt（目の骨）をそのまま使う。毎フレーム、vrm.update() の前に update(dt, camera) を呼ぶ。
import * as THREE from 'three';

// ---- 調整する数値 ----
export const LIFE = {
  blinkEvery: [1.8, 5.5],        // 瞬きの間隔（秒）
  blinkDouble: 0.18,             // 2回続けて瞬く割合
  blinkClose: 0.07, blinkHold: 0.04, blinkOpen: 0.13,   // 閉じる・閉じたまま・開く（秒）
  glanceEvery: [1.2, 4.5],       // 視線が動く間隔（秒）
  glanceHold: [0.25, 0.9],       // 動いた先で止まる時間（秒）
  glanceYaw: 14, glancePitch: 8, // 動く幅（LookAt の角度。目の骨はこの 1/4 ほど回る）
  glanceBlink: 0.3,              // 視線が動くときに瞬きも入る割合
  eyeSpeed: 28,                  // 目の速さ（大きいほど一瞬で動く）
  followSpeed: 10,               // カメラを追う速さ
  maxYaw: 50, maxPitch: 35,      // これより外のカメラは追い切らない
  giveUp: 95,                    // カメラがこれより後ろへ回ったら正面へ戻す（度）
};

const rnd = ([a, b]) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function setupLife(vrm) {
  const em = vrm.expressionManager, look = vrm.lookAt;
  const on = {blink: true, gaze: true, glance: true};
  let blinkAt = rnd(LIFE.blinkEvery), blinkT = -1, blinkAgain = false;
  let glanceAt = rnd(LIFE.glanceEvery), glanceUntil = 0, gy = 0, gp = 0;     // 視線のずれ（目標）
  let baseYaw = 0, basePitch = 0, yaw = 0, pitch = 0, time = 0;
  const camPos = new THREE.Vector3();
  if (look) look.autoUpdate = false;       // 角度はここで決める

  const startBlink = () => { if (blinkT < 0) blinkT = 0; };
  const blinkValue = dt => {
    if (blinkT < 0) return 0;
    blinkT += dt;
    const {blinkClose: c, blinkHold: h, blinkOpen: o} = LIFE;
    if (blinkT < c) return blinkT / c;
    if (blinkT < c + h) return 1;
    if (blinkT < c + h + o) { const t = (blinkT - c - h) / o; return 1 - t * t * (3 - 2 * t); }
    blinkT = -1;
    if (blinkAgain) { blinkAgain = false; blinkT = 0; }
    return 0;
  };

  return {
    on,
    blinkNow: startBlink,
    update(dt, camera) {
      time += dt;
      // ---- 瞬き ----
      if (on.blink && time >= blinkAt) { startBlink(); blinkAgain = Math.random() < LIFE.blinkDouble; blinkAt = time + rnd(LIFE.blinkEvery); }
      if (em?.getExpression('blink')) em.setValue('blink', on.blink || blinkT >= 0 ? blinkValue(dt) : 0);

      if (!look) return;
      // ---- カメラ目線: カメラの方向を角度にして、ゆっくり追う ----
      let ty = 0, tp = 0;
      if (on.gaze && camera) {
        look.lookAt(camera.getWorldPosition(camPos));
        const y = look.yaw, p = look.pitch;
        if (Math.abs(y) < LIFE.giveUp) { ty = clamp(y, -LIFE.maxYaw, LIFE.maxYaw); tp = clamp(p, -LIFE.maxPitch, LIFE.maxPitch); }
      }
      const kf = 1 - Math.exp(-LIFE.followSpeed * dt);
      baseYaw += (ty - baseYaw) * kf; basePitch += (tp - basePitch) * kf;
      // ---- ときどき視線がちょいっと動いて、少しして戻る ----
      if (on.glance) {
        if (time >= glanceAt) {
          const a = Math.random() * Math.PI * 2, r = 0.45 + Math.random() * 0.55;
          gy = Math.cos(a) * r * LIFE.glanceYaw; gp = Math.sin(a) * r * LIFE.glancePitch;
          glanceUntil = time + rnd(LIFE.glanceHold); glanceAt = glanceUntil + rnd(LIFE.glanceEvery);
          if (on.blink && Math.random() < LIFE.glanceBlink) startBlink();
        } else if (time >= glanceUntil) { gy = 0; gp = 0; }
      } else { gy = 0; gp = 0; }
      const ke = 1 - Math.exp(-LIFE.eyeSpeed * dt);
      yaw += (baseYaw + gy - yaw) * ke; pitch += (basePitch + gp - pitch) * ke;
      look.yaw = yaw; look.pitch = pitch;
    },
  };
}
