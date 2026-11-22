// VRM を読み込んで、毎コマ動かす係（ロビー専用）。中身は three-vrm の機能を呼んでいるだけ。
//   読み込み: VRM を開いてシーンに置く。古い形式（VRM 0.x）は向きを直す。服の裏側も描く。目線は life.mjs が動かす。
//   毎コマ: 揺れ物（髪・スカート）と目線などを、1秒に60回の一定間隔で更新する（描画の速さで揺れ方が変わらないように）。
import * as THREE from 'three';
import {GLTFLoader} from '../vendor/GLTFLoader.js';
import {VRMLoaderPlugin, VRMUtils} from '../vendor/three-vrm.module.js';
import {VRMLookAtQuaternionProxy} from '../vendor/three-vrm-animation.module.js';

const STEP = 1 / 60;

export class LobbyAvatar {
  constructor({scene}) { this.scene = scene; this.vrm = null; this.springManager = null; this.active = true; this.rest = 0; }
  setActive(active) { this.active = active; }

  // file: File か ArrayBuffer
  async loadVRM(file) {
    const buffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
    const loader = new GLTFLoader(); loader.register(parser => new VRMLoaderPlugin(parser));
    const gltf = await loader.parseAsync(buffer, '');
    const vrm = gltf.userData.vrm;
    if (!vrm?.humanoid) throw new Error('VRM として読み込めませんでした（Humanoid がありません）');
    VRMUtils.rotateVRM0(vrm);                                                      // VRM 0.x は後ろ向きなので、正面（+Z）へ向け直す
    vrm.scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m && m.side !== THREE.DoubleSide) { m.side = THREE.DoubleSide; m.needsUpdate = true; } });
    if (vrm.lookAt) { vrm.lookAt.autoUpdate = false; const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt); proxy.name = 'LookAtProxy'; vrm.scene.add(proxy); }
    this.vrm = vrm; this.springManager = vrm.springBoneManager ?? null;
    this.scene.add(vrm.scene); vrm.update(0); this.springManager?.reset();
    return true;
  }

  tick(delta) {
    if (!this.active || !this.vrm || !Number.isFinite(delta) || delta <= 0) return;
    this.rest += Math.min(delta, .1);                                              // 長く止まった後に一気に進めない
    const steps = Math.floor((this.rest + 1e-12) / STEP); this.rest = Math.max(0, this.rest - steps * STEP);
    for (let i = 0; i < steps; i++) this.vrm.update(STEP);
  }
}
