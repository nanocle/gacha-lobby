// ロビー画面のゆるい風。
// VRM の揺れ骨（髪・スカート・ストラップ）は元から物理で動いている。ここでは各関節の「重力」に風の力を足して、
// 向きと強さをゆっくり変える。モデルや Blend の揺れ設定は書き換えない（実行中の値だけ変える）。毎フレーム vrm.update() の前に呼ぶ。
import * as THREE from 'three';

export const WIND = {
  dir: [1, 0.05, 0.3],      // 風下の向き（+X が画面の右、+Z がカメラ側）
  base: 0.10,               // いつも吹いている強さ（揺れ骨の重力と同じ単位）
  gust: 0.16,               // ときどき強まる分
  gustEvery: 5.5,           // 強まる周期の目安（秒）
  swing: 28,                // 風向きが左右へ振れる幅（度）
  flutter: 0.05,            // 関節ごとの細かいばらつき
};

export function setupWind(vrm) {
  const joints = [...(vrm.springBoneManager?.joints ?? [])];
  const rest = joints.map(j => j.settings.gravityDir.clone().multiplyScalar(j.settings.gravityPower));   // 元の重力
  const v = new THREE.Vector3(), w = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let t = 0;
  return {
    joints: joints.length, on: true, strength: 0,
    update(dt) {
      t += dt;
      // ゆっくりした強弱（周期の違う波を重ねる）と、風向きの振れ
      const g = Math.max(0, Math.sin(t * 6.283 / WIND.gustEvery) * .6 + Math.sin(t * 6.283 / (WIND.gustEvery * .37) + 1.3) * .4);
      const s = this.on ? WIND.base + WIND.gust * g * g : 0; this.strength = s;
      w.set(...WIND.dir).normalize().applyAxisAngle(up, Math.sin(t * .23) * WIND.swing * Math.PI / 180);
      joints.forEach((j, i) => {
        const k = s * (1 + Math.sin(t * 2.1 + i * .61) * .35) + (this.on ? Math.sin(t * 5.3 + i * 1.7) * WIND.flutter * s / (WIND.base + WIND.gust) : 0);
        v.copy(rest[i]).addScaledVector(w, k); v.y += Math.sin(t * 3.1 + i * .9) * k * .15;
        const len = v.length(); j.settings.gravityPower = len; if (len > 1e-6) j.settings.gravityDir.copy(v).multiplyScalar(1 / len);
      });
    },
  };
}
