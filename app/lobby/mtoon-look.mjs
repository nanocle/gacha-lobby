// 標準の描き方: VRM の MToon はそのままにして、ロビーの夜の光に合わせる。
// モデルのファイルは変えない（読み込んだ後のマテリアルの値を、このページの中でだけ変える）。
// 数値は character.json の "mtoon" で上書きできる。書かなければ下の既定値。
import * as THREE from 'three';

export const MTOON_LOOK = {
  key: [0.78, 0.84, 1.0], keyGain: 1.6, keyAz: -35, keyEl: 30,   // 主光（左手前の上から、青白い月明かり）
  fill: [0.55, 0.42, 0.85], fillGain: 0.75,                        // 環境光（街のネオンが溶けた紫）
  rim: [1.0, 0.30, 0.75], rimFresnel: 4.0, rimLift: 0.05, rimMix: 0.6,   // 輪郭の光（ネオンのマゼンタ）。rimMix 0 で消える
  shadeTint: null,                                                // 例: [0.55, 0.5, 0.8] で陰の色を紫寄りに（null ならモデルのまま）
  bloomThreshold: 1.0,
};

export function setupMToonLook(vrm, scene, opt = {}) {
  const o = {...MTOON_LOOK, ...(opt ?? {})}, rad = d => d * Math.PI / 180;
  const root = new THREE.Group(); root.name = 'MToonLookLights'; scene.add(root);
  const key = new THREE.DirectionalLight(new THREE.Color().setRGB(...o.key), o.keyGain);
  key.position.set(Math.sin(rad(o.keyAz)) * Math.cos(rad(o.keyEl)), Math.sin(rad(o.keyEl)), Math.cos(rad(o.keyAz)) * Math.cos(rad(o.keyEl))).multiplyScalar(10);
  key.target.position.set(0, 1, 0); root.add(key, key.target);
  const fill = new THREE.AmbientLight(new THREE.Color().setRGB(...o.fill), o.fillGain); root.add(fill);
  let count = 0;
  vrm.scene.traverse(obj => {
    if (!obj.isMesh) return;
    for (const m of [].concat(obj.material)) {
      if (!m || !('parametricRimColorFactor' in m)) continue;   // MToon 以外（Unlit など）はそのまま
      m.parametricRimColorFactor.setRGB(...o.rim).multiplyScalar(o.rimMix);
      m.parametricRimFresnelPowerFactor = o.rimFresnel; m.parametricRimLiftFactor = o.rimLift;
      if ('rimLightingMixFactor' in m) m.rimLightingMixFactor = 1;
      if (o.shadeTint && m.shadeColorFactor) m.shadeColorFactor.multiply(new THREE.Color().setRGB(...o.shadeTint));
      count++;
    }
  });
  return {
    look: 'mtoon', lights: {key, fill}, materials: count, options: o,
    renderShadows() {},   // セルルックと同じ呼び方にそろえるための空の関数
  };
}
