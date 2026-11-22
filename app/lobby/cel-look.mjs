// セルルックの描き方（オプション）。VRM の MToon を差し替えて、影がくっきり1段のアニメ調で描く。
// データは characters/<名前>/<cel>/cel-data.json とテクスチャ（見本はルナ）。式は skills/lobby-cel/reference/build_cel.py（Blender のノード）と同じ。
//   基準 = テクスチャ × 環境色 → 主光が当たった所（面の向き × 落ち影）だけ明るく → リム用ライトが当たった面にリムの色を足す
//   顔の正面は主光と無関係に明るい側で、変化は髪（細い毛束を除く）の落ち影だけ
import * as THREE from 'three';

const VERT = `
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
attribute vec4 celB;   // 顔の正面の度合い, 瞳か, 瞳の UV
varying vec2 vUv; varying vec4 vB; varying vec3 vWPos; varying vec3 vWNor;
void main(){
  vUv=uv; vB=celB;
  // 顔の正面は法線を前向きにそろえる（Blender 側のカスタム法線と同じ）
  vec3 objectNormal=normalize(mix(normal,vec3(0.,0.,1.),celB.x));
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  vec4 wp=modelMatrix*vec4(transformed,1.);
  vWPos=wp.xyz; vWNor=mat3(modelMatrix)*objectNormal;
  gl_Position=projectionMatrix*viewMatrix*wp;
}`;

const FRAG = `
uniform sampler2D map,tMask,tIris,tSun,tRim,tFace;
uniform mat4 uSunMat,uRimMat,uFaceMat;
uniform vec3 uLdir,uRdir,uAmbient,uLight,uShadowColor,uRimColor,uSkinFix,uTint,uEyeTint;
uniform vec4 uMapInfo;     // 影の地図: 主光・リムの画素数, 顔用の画素数, 主光・リムの1画素の長さ(m), 顔用の1画素の長さ(m)
uniform float uDepthRange,uRimStrength,uThreshold,uRimThreshold,uRimAmount,uUseMask,uUnlit,uBoost,uAmbAmount,uEyeBoost,uEyeAmbAmount,uHairShadow,uEdge;
varying vec2 vUv; varying vec4 vB; varying vec3 vWPos; varying vec3 vWNor;
float tap(sampler2D t,vec2 uv,float z){return step(z,texture2D(t,uv).r);}
// 影は地図の1画素ぶんだけの補間（アンチエイリアス）。ぼかしは入れない
float vis(sampler2D t,mat4 m,vec3 p,float bias,float size){
  vec4 c=m*vec4(p,1.); vec3 s=c.xyz*.5+.5;
  if(s.x<0.||s.y<0.||s.x>1.||s.y>1.||s.z>1.)return 1.;
  float z=s.z-bias/uDepthRange;
  vec2 f=s.xy*size-.5,i=floor(f),w=f-i,b=(i+.5)/size; float d=1./size;
  return mix(mix(tap(t,b,z),tap(t,b+vec2(d,0.),z),w.x),mix(tap(t,b+vec2(0.,d),z),tap(t,b+vec2(d,d),z),w.x),w.y);
}
void main(){
  vec3 N=normalize(vWNor); if(!gl_FrontFacing)N=-N;
  float flat_=vB.x;
  float ndl=dot(N,uLdir),ndr=dot(N,uRdir);
  // 浅い角度の面ほど深さの余裕を大きく取る（自分の影でザラつかないように）
  float slope=sqrt(max(0.,1.-ndl*ndl))/max(abs(ndl),.08);
  float sunVis=vis(tSun,uSunMat,vWPos+N*uMapInfo.z*1.5,uMapInfo.z*(1.+1.5*slope),uMapInfo.x);
  float face=1.-uHairShadow*(1.-vis(tFace,uFaceMat,vWPos,.0015,uMapInfo.y));
  vec3 col;
  if(vB.y>.5||uUnlit>.5){
    // 瞳・白目: 陰を受けず、落ち影の中だけ色を変える
    bool iris=vB.y>.5;
    vec3 tex=iris?texture2D(tIris,vB.zw).rgb:texture2D(map,vUv).rgb;
    float C=mix(sunVis,face,flat_);
    vec3 base=tex*mix(vec3(1.),uAmbient,iris?uEyeAmbAmount:uAmbAmount);
    col=mix(base*(iris?uEyeTint:uTint),base,C)*(iris?uEyeBoost:uBoost);
  }else{
    vec3 tex=texture2D(map,vUv).rgb;
    float mask=uUseMask*texture2D(tMask,vUv).r;
    vec3 base=tex*mix(vec3(1.),uSkinFix,mask)*uAmbient;
    float facing=smoothstep(uThreshold-uEdge,uThreshold+uEdge,ndl);
    float lit=mix(facing*sunVis,face,flat_);
    col=mix(base*uShadowColor,base*uLight,lit);
    float rslope=sqrt(max(0.,1.-ndr*ndr))/max(abs(ndr),.08);
    float rv=vis(tRim,uRimMat,vWPos+N*uMapInfo.z*1.5,uMapInfo.z*(1.+1.5*rslope),uMapInfo.x);
    float rim=smoothstep(uRimThreshold-uEdge,uRimThreshold+uEdge,max(ndr,0.)*rv);
    col+=uRimColor*(rim*uRimAmount*uRimStrength);
  }
  gl_FragColor=vec4(col,1.);
}`;

const KEY = {Material_head: 'head', Material_accessories: 'acc', Material_hair: 'hair', Material_upper_body: 'upper', Material_lower_body: 'lower', Material_sclera: 'sclera'};
const rad = d => d * Math.PI / 180;
// 0° が正面、プラスで本人の左（画面の右）。three.js の座標（Y が上、+Z が正面）
const dirFromAzEl = (az, el, out = new THREE.Vector3()) => out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));

function grid(points, cellSize = 0.001) {
  const cell = v => Math.round(v / cellSize), map = new Map();
  points.forEach((p, n) => { const k = cell(p[0]) + ',' + cell(p[1]) + ',' + cell(p[2]); (map.get(k) ?? map.set(k, []).get(k)).push(n); });
  return (x, y, z, tol2 = 2.5e-7) => {
    let best = -1, bd = tol2;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++)
      for (const n of map.get((cell(x) + i) + ',' + (cell(y) + j) + ',' + (cell(z) + k)) ?? []) {
        const p = points[n], d = (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2;
        if (d < bd) { bd = d; best = n; }
      }
    return best;
  };
}

export async function setupCelLook(vrm, dir, fx = null) {
  const data = await (await fetch(dir + 'cel-data.json')).json(), st = data.state, log = {};
  const loader = new THREE.TextureLoader();
  const tex = async (name, color) => {
    const t = await loader.loadAsync(dir + name + '.png');
    t.flipY = false; t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    return t;
  };
  const T = {};
  await Promise.all([
    ...['head', 'acc', 'hair', 'upper', 'lower'].map(async k => { T[k] = await tex('LunaCel_tex_' + k, true); }),
    ...['head', 'upper', 'lower'].map(async k => { T['mask_' + k] = await tex('LunaCel_skinmask_' + k, false); }),
    (async () => { T.iris = await tex('LunaCel_iris', true); })(), (async () => { T.sclera = await tex('tex_sclera', true); })(),
  ]);

  // ---- 影の地図（主光・リム・顔用） ----
  const SIZE = 4096, FSIZE = 2048, HALF = 1.2, FHALF = 0.26, NEAR = 0.1, FAR = 8.1;
  const mkTarget = s => { const t = new THREE.WebGLRenderTarget(s, s, {depthBuffer: true}); t.depthTexture = new THREE.DepthTexture(s, s, THREE.UnsignedIntType); t.depthTexture.minFilter = t.depthTexture.magFilter = THREE.NearestFilter; return t; };
  const mkCam = (h, layer) => { const c = new THREE.OrthographicCamera(-h, h, h, -h, NEAR, FAR); c.layers.set(layer); return c; };
  const sh = {
    sun: {rt: mkTarget(SIZE), cam: mkCam(HALF, 1), mat: new THREE.Matrix4(), dir: new THREE.Vector3(), center: new THREE.Vector3(0, 0.9, 0)},
    rim: {rt: mkTarget(SIZE), cam: mkCam(HALF, 1), mat: new THREE.Matrix4(), dir: new THREE.Vector3(), center: new THREE.Vector3(0, 0.9, 0)},
    face: {rt: mkTarget(FSIZE), cam: mkCam(FHALF, 2), mat: new THREE.Matrix4(), dir: new THREE.Vector3(), center: new THREE.Vector3()},
  };
  const depthMat = new THREE.MeshBasicMaterial({colorWrite: false, side: THREE.DoubleSide});

  const c3 = v => new THREE.Vector3(...v), G = k => st['LunaCel_Global.' + k];
  const U = {
    tSun: {value: sh.sun.rt.depthTexture}, tRim: {value: sh.rim.rt.depthTexture}, tFace: {value: sh.face.rt.depthTexture},
    uSunMat: {value: sh.sun.mat}, uRimMat: {value: sh.rim.mat}, uFaceMat: {value: sh.face.mat},
    uLdir: {value: sh.sun.dir}, uRdir: {value: sh.rim.dir},
    uMapInfo: {value: new THREE.Vector4(SIZE, FSIZE, 2 * HALF / SIZE, 2 * FHALF / FSIZE)}, uDepthRange: {value: FAR - NEAR},
    uAmbient: {value: c3(G('G_Ambient'))}, uLight: {value: new THREE.Vector3()}, uShadowColor: {value: c3(G('G_ShadowColor'))},
    uRimColor: {value: c3(G('G_RimColor'))}, uRimStrength: {value: G('G_RimStrength')},
    uHairShadow: {value: st['LunaCel_FaceLight.LC_HS_Strength']}, uEdge: {value: 0.008}, tIris: {value: T.iris},
    uEyeTint: {value: c3(st['LunaCel_Eye.P_ShadowTint'])}, uEyeBoost: {value: st['LunaCel_Eye.P_Boost']}, uEyeAmbAmount: {value: st['LunaCel_Eye.P_AmbientAmount']},
  };
  // 触れる値。主光の色 × 強さが uLight
  const P = {
    lightColor: c3(G('G_LightColor')), lightGain: G('G_LightGain'),
    sunAz: rad(st.LunaCel_Sun.az_deg), sunEl: rad(st.LunaCel_Sun.el_deg), rimAz: rad(st.LunaCel_RimSun.az_deg), rimEl: rad(st.LunaCel_RimSun.el_deg),
    faceEl: st.face_light.lc_el, faceFollow: st.face_light.lc_follow, faceLimit: st.face_light.lc_limit,
  };

  const mats = {};
  const material = key => mats[key] ??= (() => {
    const grp = key === 'hair' ? 'LunaCel_Hair' : 'LunaCel_Cloth', info = data.materials['LunaCel_' + key] ?? {}, unlit = key === 'sclera';
    const m = new THREE.ShaderMaterial({
      uniforms: {...U, map: {value: unlit ? T.sclera : T[key]}, tMask: {value: T['mask_' + key] ?? T.iris}, uUseMask: {value: T['mask_' + key] ? 1 : 0},
        uSkinFix: {value: c3(info.skinFix ?? [1, 1, 1])}, uUnlit: {value: unlit ? 1 : 0},
        uThreshold: {value: st[grp + '.P_Threshold']}, uRimThreshold: {value: st[grp + '.P_RimThreshold']}, uRimAmount: {value: st[grp + '.P_Rim']},
        uTint: {value: c3(st['LunaCel_Sclera.P_ShadowTint'])}, uBoost: {value: st['LunaCel_Sclera.P_Boost']}, uAmbAmount: {value: st['LunaCel_Sclera.P_AmbientAmount']}},
      vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide});
    m.name = 'LunaCel_' + key; return m;
  })();

  // ---- マテリアルの差し替えと、頭の頂点ごとの値 ----
  const root = vrm.scene; root.updateMatrixWorld(true);
  const headLookup = grid(data.head), texSwap = new Map(), casters = [];
  let hairMesh = null;
  root.traverse(o => {
    if (!o.isMesh) return;
    const old = [].concat(o.material)[0], key = KEY[old?.name];
    if (!key || !old.isMToonMaterial) return;
    const g = o.geometry, pos = g.attributes.position, n = pos.count;
    if (!g.attributes.celB) {
      const B = new Float32Array(n * 4);
      if (o.isSkinnedMesh && o.parent.name === 'Head') {
        const missing = new Uint8Array(n); let miss = 0, iris = 0;
        const fxA = g.attributes.fxA, fxB = g.attributes.fxB;
        for (let i = 0; i < n; i++) {
          const r = headLookup(pos.getX(i), pos.getY(i), pos.getZ(i));
          if (r < 0) { missing[i] = 1; miss++; continue; }
          const row = data.head[r]; B.set([row[3], row[4], row[5], row[6]], i * 4); iris += row[4];
          // 発光の頂点ごとの値も Blend のセルルック版のものに合わせる
          if (fxA && row.length > 7) { fxA.setXYZW(i, row[7], row[8], row[9], row[12]); fxB.setXY(i, row[10], row[11]); }
        }
        // Blend 側で消してある部品（瞳の上の小片）は、三角形ごと外す
        if (miss && miss < n * 0.2 && g.index) {
          const idx = g.index.array, keep = [];
          for (let t = 0; t < idx.length; t += 3) if (!(missing[idx[t]] || missing[idx[t + 1]] || missing[idx[t + 2]])) keep.push(idx[t], idx[t + 1], idx[t + 2]);
          g.setIndex(keep);
        }
        if (fxA) { fxA.needsUpdate = true; fxB.needsUpdate = true; }
        log[key] = `${n - miss}/${n}` + (iris ? ` 瞳 ${iris}` : '');
      }
      g.setAttribute('celB', new THREE.BufferAttribute(B, 4));
    }
    if (old.map) texSwap.set(old.map, key === 'sclera' ? T.sclera : T[key]);
    o.material = material(key); o.layers.enable(1); casters.push(o);
    if (key === 'hair' && o.isSkinnedMesh) hairMesh = o;
  });
  // エフェクトの重ね描きは、色の判定にセルルック用のテクスチャを使う（Blend 側と同じ）
  if (fx) for (const list of Object.values(fx.groups)) for (const m of list) { const u = m.material.uniforms?.map; if (u && texSwap.has(u.value)) u.value = texSwap.get(u.value); }

  // ---- 顔へ影を落とす髪（細い毛束を除いたもの）。画面には映さず、顔用の影の地図にだけ描く ----
  let caster = null;
  if (hairMesh && data.faceCaster.length) {
    const look = grid(data.faceCaster), g0 = hairMesh.geometry, pos = g0.attributes.position, keepV = new Uint8Array(pos.count);
    for (let i = 0; i < pos.count; i++) keepV[i] = look(pos.getX(i), pos.getY(i), pos.getZ(i)) >= 0 ? 1 : 0;
    const idx = g0.index.array, keep = [];
    for (let t = 0; t < idx.length; t += 3) if (keepV[idx[t]] && keepV[idx[t + 1]] && keepV[idx[t + 2]]) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    const g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(g0.attributes)) g.setAttribute(k, a);
    g.setIndex(keep);
    caster = new THREE.SkinnedMesh(g, depthMat); caster.bind(hairMesh.skeleton, hairMesh.bindMatrix);
    caster.name = 'LunaCel_FaceCaster'; caster.frustumCulled = false; caster.layers.set(2); hairMesh.parent.add(caster);
    log.faceCaster = `${keep.length / 3}/${idx.length / 3} 面`;
  }

  // 顔用のライトは頭の骨に付いて回る
  const head = vrm.humanoid.getRawBoneNode('head'), q = new THREE.Quaternion(), restInv = head.getWorldQuaternion(new THREE.Quaternion()).invert();
  const place = (s, dist = 4) => {
    s.cam.position.copy(s.center).addScaledVector(s.dir, dist); s.cam.up.set(0, 1, 0); s.cam.lookAt(s.center); s.cam.updateMatrixWorld(true);
    s.mat.multiplyMatrices(s.cam.projectionMatrix, s.cam.matrixWorldInverse);
  };
  const tmp = new THREE.Vector2();
  return {
    uniforms: U, params: P, log, data, textures: T, casters,
    apply() {
      U.uLight.value.copy(P.lightColor).multiplyScalar(P.lightGain);
      dirFromAzEl(P.sunAz, P.sunEl, sh.sun.dir); dirFromAzEl(P.rimAz, P.rimEl, sh.rim.dir);
    },
    // 毎フレーム、描画の前に呼ぶ
    renderShadows(renderer, scene) {
      this.apply();
      const az = Math.max(-P.faceLimit, Math.min(P.faceLimit, P.sunAz * P.faceFollow));
      dirFromAzEl(az, P.faceEl, sh.face.dir).applyQuaternion(head.getWorldQuaternion(q).multiply(restInv));
      head.getWorldPosition(sh.face.center);
      const bg = scene.background, om = scene.overrideMaterial, ac = renderer.autoClear;
      scene.background = null; scene.overrideMaterial = depthMat; renderer.autoClear = true;
      for (const s of [sh.sun, sh.rim, sh.face]) { place(s); renderer.setRenderTarget(s.rt); renderer.render(scene, s.cam); }
      scene.background = bg; scene.overrideMaterial = om; renderer.autoClear = ac; renderer.setRenderTarget(null);
      renderer.getSize(tmp);
    },
  };
}
