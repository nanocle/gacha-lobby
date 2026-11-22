// 白雪ルナ用のエフェクトを VRM の上に重ねる。
// 元のメッシュと MToon マテリアルは変えず、同じ形状・同じ骨を使う「重ね描き」のメッシュを足す。
// 例外は星だけで、回せるように頭メッシュから三角形を抜いて別メッシュにする。
import * as THREE from 'three';

const HASH = `float fxHash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}`;

const SKIN_VERT = `
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
attribute vec4 fxA;   // gain, solid, halo, phase
attribute vec2 fxB;   // 輪に沿った角度の cos, sin
varying vec2 vUv; varying vec4 vA; varying vec2 vB; varying vec3 vRest;
void main(){
  vUv=uv; vA=fxA; vB=fxB; vRest=position;
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
}`;

const GLOW_FRAG = `
uniform sampler2D map; uniform float uTime,uStrength;
varying vec2 vUv; varying vec4 vA;
vec3 rgb2hsv(vec3 c){vec4 K=vec4(0.,-1./3.,2./3.,-1.);vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));float d=q.x-min(q.w,q.y);return vec3(abs(q.z+(q.w-q.y)/(6.*d+1e-10)),d/(q.x+1e-10),q.x);}
void main(){
  vec3 c=texture2D(map,vUv).rgb; vec3 h=rgb2hsv(c);
  // テクスチャの「鮮やかな水色〜青」だけを光らせる。solid の部品は全体を光らせる
  float mask=(1.-smoothstep(.07,.11,abs(h.x-.57)))*smoothstep(.45,.75,h.y)*smoothstep(.25,.6,h.z);
  mask=max(mask,vA.y);
  float pulse=.78+.22*sin(uTime*2.2+vA.w*6.283);
  float st=mask*vA.x*pulse*uStrength*(1.-step(.5,vA.z));
  if(st<.003)discard;
  float l=dot(c,vec3(.2126,.7152,.0722));
  gl_FragColor=vec4(mix(vec3(l),c,1.35)*1.2*st,1.);
}`;

const HAIR_FRAG = `
uniform sampler2D map; uniform float uTime,uStrength;
varying vec2 vUv; varying vec3 vRest;
void main(){
  vec3 c=texture2D(map,vUv).rgb;
  float mx=max(c.r,max(c.g,c.b)),mn=min(c.r,min(c.g,c.b)),sat=(mx-mn)/(mx+1e-5);
  // 白〜灰の髪は彩度が低い。色の付いた毛先だけを残し、頭の上のほうは光らせない
  float mask=smoothstep(.5,.72,sat)*smoothstep(.2,.5,mx)*(1.-smoothstep(1.36,1.56,vRest.y));
  float wave=.7+.3*sin(uTime*1.6+vRest.y*9.);
  float st=mask*wave*uStrength;
  if(st<.003)discard;
  float l=dot(c,vec3(.2126,.7152,.0722));
  gl_FragColor=vec4(mix(vec3(l),c,1.4)*st,1.);
}`;

const HALO_FRAG = `
uniform float uTime,uStrength;
varying vec4 vA; varying vec2 vB;
vec3 ramp(float t){
  vec3 a=vec3(.05,.75,1.),b=vec3(.25,.35,1.),c=vec3(.75,.3,1.),d=vec3(1.,.45,.85);
  t=fract(t)*4.;
  return t<1.?mix(a,b,t):t<2.?mix(b,c,t-1.):t<3.?mix(c,d,t-2.):mix(d,a,t-3.);
}
void main(){
  if(vA.z<.5)discard;
  float ang=atan(vB.y,vB.x)/6.2832;
  float run=pow(max(0.,sin(ang*12.566-uTime*1.6)),10.);     // 輪を走る明るい点
  float breathe=.85+.15*sin(uTime*1.3);
  gl_FragColor=vec4(ramp(ang+uTime*.12)*uStrength*(breathe+run*1.5),1.);
}`;

const TILE = `
${HASH}
float fxTile(vec2 c,out float r){vec2 f=fract(c);r=fxHash(floor(c));float e=min(min(f.x,1.-f.x),min(f.y,1.-f.y));return step(.09,e);}
vec3 fxColor(float vn,float r){vec3 c=mix(vec3(.05,.85,1.),vec3(.55,.25,1.),pow(clamp(vn,0.,1.),.8));return mix(c,vec3(1.),r*.25);}`;

const SHELL_FRAG = `
uniform float uTime,uStrength,uTop,uBottom; uniform vec3 uHips;
varying vec3 vRest;
${TILE}
void main(){
  float v=uTop-vRest.y; if(v<0.)discard;
  float u=atan(vRest.x-uHips.x,-(vRest.z-uHips.z))*.2;
  float vn=clamp(v/(uTop-uBottom),0.,1.);
  float r; float tile=fxTile(vec2(u/.022,v/.022-uTime*5.),r);
  float band=pow(max(0.,sin(vn*9.-uTime*3.)),4.);
  float on=step(r,pow(vn,1.6)*.85);                           // 先へ行くほど点くタイルが増える
  float inten=tile*on*(.35+band*.9)+(1.-tile)*pow(vn,2.)*.35;
  inten*=smoothstep(.05,.45,vn)*(.88+.12*sin(uTime*9.));
  if(inten<.003)discard;
  gl_FragColor=vec4(fxColor(vn,r)*inten*uStrength,1.);
}`;

const PLUME_VERT = `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const PLUME_FRAG = `
uniform float uTime,uStrength;
varying vec2 vUv;
${TILE}
void main(){
  float u=clamp(vUv.x,0.,1.),v=clamp(vUv.y,0.,1.);
  float r; float tile=fxTile(vec2(u*9.,v*17.-uTime*7.),r);
  float band=pow(max(0.,sin(v*9.-uTime*6.)),4.);
  float on=step(v*1.15-.1,r);                                  // 先へ行くほどタイルが欠ける
  float lr=fxHash(vec2(floor(u*36.),3.));
  float streak=pow(lr,4.)*pow(max(0.,sin(v*14.-uTime*11.+lr*40.)),3.);   // 細い走る線
  float core=pow(1.-v,3.)*.18;
  float inten=tile*on*(.45+band*.8)+streak*1.6+core;
  float across=1.-abs(u*2.-1.);
  inten*=pow(1.-v,1.3)*smoothstep(0.,.12,v)*smoothstep(0.,.45,across)*(.88+.12*sin(uTime*9.));
  if(inten<.003)discard;
  gl_FragColor=vec4(fxColor(v,r)*inten*uStrength,1.);
}`;

const additive = {transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4};

export async function setupFx(vrm, dataUrl) {
  const data = await (await fetch(dataUrl)).json();
  const root = vrm.scene;
  root.updateMatrixWorld(true);
  const U = {time: {value: 0}, glow: {value: 2.0}, halo: {value: 1.6}, boost: {value: 3.0}, hair: {value: 0.9}};
  const added = [], groups = {glow: [], halo: [], boost: [], hair: []}, log = {};

  // 頭の頂点データを位置で引けるようにする
  const cell = v => Math.round(v * 1000), grid = new Map();
  for (const row of data.head) {
    const k = cell(row[0]) + ',' + cell(row[1]) + ',' + cell(row[2]);
    (grid.get(k) ?? grid.set(k, []).get(k)).push(row);
  }
  const lookup = (x, y, z) => {
    let best = null, bd = 2.5e-7;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      for (const r of grid.get((cell(x) + i) + ',' + (cell(y) + j) + ',' + (cell(z) + k)) ?? []) {
        const d = (r[0] - x) ** 2 + (r[1] - y) ** 2 + (r[2] - z) ** 2;
        if (d < bd) { bd = d; best = r; }
      }
    }
    return best;
  };

  const meshes = [];
  root.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
  const overlay = (base, material, order) => {
    const m = new THREE.SkinnedMesh(base.geometry, material);
    m.bind(base.skeleton, base.bindMatrix);
    if (base.morphTargetInfluences) { m.morphTargetInfluences = base.morphTargetInfluences; m.morphTargetDictionary = base.morphTargetDictionary; }
    m.frustumCulled = false; m.renderOrder = order; m.name = 'FX_' + base.name;
    base.parent.add(m); added.push(m); return m;
  };
  const glowMat = map => new THREE.ShaderMaterial({uniforms: {map: {value: map}, uTime: U.time, uStrength: U.glow}, vertexShader: SKIN_VERT, fragmentShader: GLOW_FRAG, side: THREE.DoubleSide, ...additive});

  let star = null;
  for (const base of meshes) {
    const mat = [].concat(base.material)[0], name = mat.name, g = base.geometry, pos = g.attributes.position, n = pos.count;
    const isHead = base.parent.name === 'Head';
    if (name === 'Material_hair') {
      g.setAttribute('fxA', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
      g.setAttribute('fxB', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      groups.hair.push(overlay(base, new THREE.ShaderMaterial({uniforms: {map: {value: mat.map}, uTime: U.time, uStrength: U.hair}, vertexShader: SKIN_VERT, fragmentShader: HAIR_FRAG, side: THREE.DoubleSide, ...additive}), 10));
      continue;
    }
    const defGain = name === 'Material_hair' || name === 'Material_sclera' ? null : isHead ? null : base.name === 'Skirt' ? 0.45 : 1.0;
    if (!isHead && defGain === null) continue;
    if (isHead && name === 'Material_sclera') continue;
    const A = new Float32Array(n * 4), B = new Float32Array(n * 2), starFlag = new Uint8Array(n);
    let miss = 0;
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (isHead) {
        const r = lookup(x, y, z);
        if (!r) { miss++; continue; }
        A.set([r[3], r[4], r[5], r[8]], i * 4); B.set([r[6], r[7]], i * 2); starFlag[i] = r[9];
      } else {
        // 体は 12cm ごとの区画で明滅のタイミングをずらす
        const ph = Math.abs(Math.sin(Math.floor(x * 8) * 12.9898 + Math.floor(y * 8) * 78.233 + Math.floor(z * 8) * 37.719) * 43758.5453) % 1;
        A.set([defGain, 0, 0, ph], i * 4);
      }
    }
    if (isHead) log[base.name] = `${n - miss}/${n}`;
    g.setAttribute('fxA', new THREE.BufferAttribute(A, 4));
    g.setAttribute('fxB', new THREE.BufferAttribute(B, 2));

    if (isHead && name === 'Material_accessories') {
      // 星の三角形を抜いて別メッシュにする
      const idx = g.index.array, keep = [], sp = [], sn = [], su = [];
      const nor = g.attributes.normal, uv = g.attributes.uv, c = data.star.center;
      for (let t = 0; t < idx.length; t += 3) {
        const tri = [idx[t], idx[t + 1], idx[t + 2]];
        if (tri.every(i => starFlag[i])) for (const i of tri) { sp.push(pos.getX(i) - c[0], pos.getY(i) - c[1], pos.getZ(i) - c[2]); sn.push(nor.getX(i), nor.getY(i), nor.getZ(i)); su.push(uv.getX(i), uv.getY(i)); }
        else keep.push(...tri);
      }
      log.starTriangles = sp.length / 9;
      if (sp.length) {
        g.setIndex(keep);
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
        sg.setAttribute('normal', new THREE.Float32BufferAttribute(sn, 3));
        sg.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2));
        const cnt = sp.length / 3, a = new Float32Array(cnt * 4);
        for (let i = 0; i < cnt; i++) a.set([2.2, 1, 0, 0.3], i * 4);
        sg.setAttribute('fxA', new THREE.BufferAttribute(a, 4));
        sg.setAttribute('fxB', new THREE.BufferAttribute(new Float32Array(cnt * 2), 2));
        const head = vrm.humanoid.getRawBoneNode('head');
        // pivot=輪の中心（頭の骨に固定）/ orbit=輪の面に垂直な軸で周回 / spin=星の自転
        const oc = data.star.orbitCenter;
        const pivot = new THREE.Group(); pivot.name = 'FX_StarPivot';
        pivot.matrix.copy(head.matrixWorld).invert().multiply(new THREE.Matrix4().makeTranslation(oc[0], oc[1], oc[2]));
        pivot.matrix.decompose(pivot.position, pivot.quaternion, pivot.scale);
        const orbit = new THREE.Group(); pivot.add(orbit);
        const spin = new THREE.Group(); spin.position.set(c[0] - oc[0], c[1] - oc[1], c[2] - oc[2]); orbit.add(spin);
        const body = new THREE.Mesh(sg, mat); body.frustumCulled = false;
        const glow = new THREE.Mesh(sg, glowMat(mat.map)); glow.renderOrder = 10; glow.frustumCulled = false;
        spin.add(body, glow); head.add(pivot); added.push(pivot); groups.glow.push(glow);
        star = {spin, orbit, axis: new THREE.Vector3(...data.star.orbitAxis).normalize(), base: spin.position.clone(), ring: data.star.ring, radial: new THREE.Vector3(...data.star.ring.radial)};
      }
      const halo = overlay(base, new THREE.ShaderMaterial({uniforms: {uTime: U.time, uStrength: U.halo}, vertexShader: SKIN_VERT, fragmentShader: HALO_FRAG, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4}), 5);
      groups.halo.push(halo);
    }
    if (mat.map) groups.glow.push(overlay(base, glowMat(mat.map), 10));
    if (base.name === 'Skirt') {
      groups.boost.push(overlay(base, new THREE.ShaderMaterial({
        uniforms: {uTime: U.time, uStrength: U.boost, uTop: {value: data.shellTop}, uBottom: {value: data.shellBottom}, uHips: {value: new THREE.Vector3(...data.hips)}},
        vertexShader: SKIN_VERT, fragmentShader: SHELL_FRAG, side: THREE.DoubleSide, ...additive}), 20));
    }
  }

  // 先端から噴き出す面。揺れ骨の先の関節に固定する
  // 布の途中から先端を越えて噴き出す面。腰布と同じ骨で動かす
  const skirt = meshes.find(m => m.name === 'Skirt'), p = data.plume;
  if (skirt && p) {
    const names = skirt.skeleton.bones.map(b => b.name), map = p.bones.map(n => names.indexOf(n));
    log.plumeBones = map.filter(i => i >= 0).length + '/' + map.length;
    const si = new Uint16Array(p.skinIndex.length), sw = Float32Array.from(p.skinWeight);
    for (let i = 0; i < si.length; i++) { const b = map[p.skinIndex[i]]; if (b < 0) sw[i] = 0; else si[i] = b; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    const n = p.pos.length / 3;
    g.setAttribute('fxA', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    g.setAttribute('fxB', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const m = new THREE.SkinnedMesh(g, new THREE.ShaderMaterial({uniforms: {uTime: U.time, uStrength: U.boost}, vertexShader: SKIN_VERT, fragmentShader: PLUME_FRAG, side: THREE.DoubleSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false}));
    m.normalizeSkinWeights(); m.bind(skirt.skeleton, skirt.bindMatrix);
    m.name = 'FX_Plume'; m.frustumCulled = false; m.renderOrder = 21;
    skirt.parent.add(m); added.push(m); groups.boost.push(m);
  }

  return {
    uniforms: U, log, groups,
    setVisible(kind, on) { for (const m of groups[kind]) m.visible = on; },
    update(dt) {
      U.time.value += dt;
      if (star) {
        const phi = U.time.value * Math.PI * 2 / 10, R = star.ring;                           // 10秒で輪を1周
        star.orbit.quaternion.setFromAxisAngle(star.axis, phi);
        // 輪は真円ではないので、角度ごとの半径と高さのずれを足す
        const f = ((((R.theta0 + phi) / (Math.PI * 2)) % 1 + 1) % 1) * R.n, i = Math.floor(f) % R.n, t = f - Math.floor(f), a = R.path[i], b = R.path[(i + 1) % R.n];
        star.spin.position.copy(star.base).addScaledVector(star.radial, a[0] + (b[0] - a[0]) * t - R.rs).addScaledVector(star.axis, a[1] + (b[1] - a[1]) * t - R.hs);
        star.spin.quaternion.setFromAxisAngle(star.axis, U.time.value * Math.PI * 2 / 5);    // 5秒で1回自転
      }
    },
    dispose() { for (const m of added) m.removeFromParent(); },
  };
}
