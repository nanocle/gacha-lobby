// ロビー画面のステージ: 雨上がりの夜、サイバーパンクな街を見下ろす屋上。
// 座標: キャラは原点に立ち +Z を向く（カメラは +Z 側）。屋上の床が y=0、屋上の縁は z=EDGE_Z、その先（-Z）が街。
//   空 → 遠景の絵 → 街のビル（Tripo 製）とサイネージ → 行き交う車 → フォグの板 → 屋上（縁・床・看板・床の排気口の湯気）
import * as THREE from 'three';
import {GLTFLoader} from '../vendor/GLTFLoader.js';

export const STAGE = {
  seed: 20261114,
  edgeZ: -1.0,                       // 屋上の縁の位置。キャラは縁のすぐ手前に立つ（縁の先は下の街まで落ちている）
  street: -140,                      // 下の道路の高さ
  block: 46, lot: 32,                // 街の区画の間隔と、建物が建つ幅（残りが道路）
  fogLow: [0.105, 0.032, 0.150],     // 低い所のもやの色（ネオンが溶けた紫）
  fogHigh: [0.012, 0.026, 0.060],    // 高い所の空気の色
  fogDensity: 0.0027,
  neon: {magenta: [1.0, 0.10, 0.52], cyan: [0.08, 0.80, 1.0], amber: [1.0, 0.50, 0.10], violet: [0.52, 0.28, 1.0], mint: [0.18, 1.0, 0.66], red: [1.0, 0.08, 0.10]},
};

const NOISE = `
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+1.),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*vnoise(p);p=p*2.03+17.;a*=.5;}return s;}`;
const FOG = `
uniform vec3 uFogLow,uFogHigh; uniform float uFogDensity,uClip,uTime;
vec3 fogColor(float y){return mix(uFogLow,uFogHigh,smoothstep(-90.,130.,y));}
vec3 applyFog(vec3 col,vec3 wp){
  float d=distance(wp,cameraPosition),h=smoothstep(-90.,130.,wp.y);
  float f=1.-exp(-d*uFogDensity*mix(1.25,.5,h));
  return mix(col,fogColor(wp.y),f);
}
void clipBelow(vec3 wp){if(uClip>.5&&wp.y<0.)discard;}   // 床の映り込みを描くときは、床より下を捨てる
`;
const PALETTE = `vec3 neon(float i){i=mod(i,6.);
  if(i<1.)return vec3(1.,.10,.52); if(i<2.)return vec3(.08,.80,1.); if(i<3.)return vec3(1.,.50,.10);
  if(i<4.)return vec3(.52,.28,1.); if(i<5.)return vec3(.18,1.,.66); return vec3(1.,.08,.10);}`;

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- 文字の看板・画面の絵（キャンバスに描く）
const JP = '"Yu Gothic UI","Meiryo",sans-serif', EN = '"Bahnschrift","Segoe UI",sans-serif';
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}
// ネオン管の文字。白で描いて、色は表示側で掛ける。vertical=true で縦書き
function neonText(text, {vertical = false, font = JP, frame = true} = {}) {
  const n = [...text].length, cell = 200, pad = 40;
  const w = vertical ? cell + pad * 2 : cell * n * (font === EN ? 0.62 : 1) + pad * 2, h = vertical ? cell * n + pad * 2 : cell + pad * 2;
  const tex = canvasTex(Math.round(w), Math.round(h), (g, W, H) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 ${cell * 0.8}px ${font}`;
    g.shadowColor = '#fff'; g.shadowBlur = 18;
    if (vertical) [...text].forEach((ch, i) => g.fillText(ch, W / 2, pad + cell * (i + 0.5)));
    else g.fillText(text, W / 2, H / 2 + 6, W - pad * 2);
    if (frame) { g.lineWidth = 7; g.strokeRect(14, 14, W - 28, H - 28); }
  });
  tex.userData.aspect = w / h; return tex;
}
// 大型ビジョンに流す絵。frames 枚を縦に並べた1枚にする（表示側で切り替える）
function screenAtlas(frames, fw, fh) {
  return canvasTex(fw, fh * frames.length, g => frames.forEach((draw, i) => { g.save(); g.translate(0, fh * i); g.beginPath(); g.rect(0, 0, fw, fh); g.clip(); draw(g, fw, fh); g.restore(); }));
}
const grad = (g, w, h, a, b, ang = 0.6) => { const l = g.createLinearGradient(0, 0, w * Math.cos(ang), h); l.addColorStop(0, a); l.addColorStop(1, b); g.fillStyle = l; g.fillRect(0, 0, w, h); };
const label = (g, text, x, y, size, {font = JP, color = '#fff', align = 'center', weight = 800, max} = {}) => { g.fillStyle = color; g.font = `${weight} ${size}px ${font}`; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(text, x, y, max); };
// 街の広告や看板に出すキャラの名前（createStage の chara で差し替える）
const CH = {tag: 'CHARA', name: 'キャラクター', sign: 'ネオン電機'};
const ADS = [
  (g, w, h) => { grad(g, w, h, '#ff2b8a', '#5b1fff'); g.globalAlpha = .25; for (let i = 0; i < 7; i++) { g.beginPath(); g.arc(w * .78, h * .5, h * (.15 + i * .13), 0, 7); g.lineWidth = h * .02; g.strokeStyle = '#fff'; g.stroke(); } g.globalAlpha = 1;
    label(g, CH.tag, w * .36, h * .40, h * .42, {font: EN, max: w * .6}); label(g, CH.name + '  1st LIVE', w * .36, h * .76, h * .13, {max: w * .62}); },
  (g, w, h) => { grad(g, w, h, '#00323a', '#00d0c0'); g.strokeStyle = '#ffffff33'; g.lineWidth = 2; for (let x = 0; x < w; x += w / 14) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } for (let y = 0; y < h; y += h / 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    label(g, 'ネオンFM', w * .5, h * .45, h * .34, {max: w * .86}); label(g, 'NEON FM 88.7', w * .5, h * .78, h * .12, {font: EN, color: '#baffee'}); },
  (g, w, h) => { grad(g, w, h, '#2a1200', '#ff8a1a', 1.2); g.fillStyle = '#000a'; g.fillRect(0, h * .62, w, h * .2);
    label(g, '夜市', w * .3, h * .36, h * .46, {max: w * .5}); label(g, 'NIGHT MARKET', w * .72, h * .30, h * .12, {font: EN, max: w * .44}); label(g, '24H OPEN', w * .72, h * .46, h * .13, {font: EN, color: '#ffe9c0'}); label(g, 'SECTOR 07  ▶▶  屋台 92 店舗', w * .5, h * .72, h * .1, {max: w * .9}); },
  (g, w, h) => { grad(g, w, h, '#050818', '#1b2c6b'); for (let i = 0; i < 40; i++) { g.fillStyle = `hsla(${190 + (i * 37) % 80},90%,65%,.5)`; g.fillRect((i * 97) % w, (i * 53) % h, 3 + (i % 5) * 9, 3); }
    label(g, 'SKYPORT', w * .5, h * .38, h * .30, {font: EN, color: '#7fe9ff', max: w * .86}); label(g, '雨上がり  12℃  視界良好', w * .5, h * .74, h * .12, {max: w * .88}); },
];

// ---------------------------------------------------------------- 本体
export function createStage(scene, {reflection = true, chara = {}} = {}) {
  Object.assign(CH, {tag: chara.tag ?? CH.tag, name: chara.name ?? CH.name, sign: chara.sign ?? (chara.short ? chara.short + '電機' : CH.sign)});
  const rnd = mulberry(STAGE.seed), R = (a, b) => a + rnd() * (b - a), pick = a => a[Math.floor(rnd() * a.length)];
  const G = {uTime: {value: 0}, uClip: {value: 0}, uFogLow: {value: new THREE.Vector3(...STAGE.fogLow)}, uFogHigh: {value: new THREE.Vector3(...STAGE.fogHigh)}, uFogDensity: {value: STAGE.fogDensity}, uPx: {value: 1000}};
  const root = new THREE.Group(); root.name = 'LobbyStage'; scene.add(root);
  const updaters = []; let bldMesh = null, carRef = null;
  const shader = (o) => new THREE.ShaderMaterial({...o, uniforms: {...G, ...(o.uniforms ?? {})}});

  // ---- 空: 地平線ほどネオンで明るく、上は暗い。低い雲が街の光を受ける
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2400, 32, 16), shader({side: THREE.BackSide, depthWrite: false, vertexShader: `varying vec3 vDir; void main(){vDir=position; gl_Position=projectionMatrix*viewMatrix*vec4(position+cameraPosition,1.); gl_Position.z=gl_Position.w*.99999;}`,
    fragmentShader: `${NOISE}${FOG} varying vec3 vDir; void main(){vec3 d=normalize(vDir); float y=d.y;
      vec3 col=mix(uFogLow*1.25,uFogHigh*.5,smoothstep(-.05,.5,y));
      col+=vec3(.20,.05,.16)*exp(-max(y,0.)*9.);                                         // 地平線の光
      vec2 p=d.xz/(abs(y)+.22); float c=fbm(p*1.6+vec2(uTime*.004,0.)); c=smoothstep(.42,.8,c);
      col+=c*mix(vec3(.10,.035,.12),vec3(.02,.06,.09),smoothstep(-1.,1.,d.x))*smoothstep(-.02,.25,y)*(1.-smoothstep(.3,.9,y));
      gl_FragColor=vec4(col,1.);}`}));
  sky.renderOrder = -100; sky.frustumCulled = false; root.add(sky);

  // ---- ビル群（箱を並べ、窓明かりは描画時に作る）
  const blds = [];
  const addB = (x, z, w, d, top, o = {}) => { const b = {x, z, w, d, top, bottom: -140, seed: rnd(), lit: R(.18, .5), style: rnd() < .3 ? 1 : 0, tint: Math.floor(rnd() * 5), ...o}; blds.push(b); return b; };
  const mid = [], BK = STAGE.block, LOT = STAGE.lot;
  // 手前の街: 区画（道路で区切った升目）に沿って建てる。ほとんどは屋上より低く、見下ろすと屋上と谷間の道路が見える。
  // 立った目線の背景になるよう、決めた升目だけ屋上より高くする。'列,行' → 屋上の高さ
  // 箱は置き場所の目安。読み込み後は Tripo のセルルックのビル（assets.json の city）を、升目の縦横比に近い形から選んで建てる。
  // 決めた升目（'列,行'）: [屋上の高さ, 建てるモデル（省くと形で選ぶ）]。c_screen（大型ビジョン付き）は、立った目線のカットで画面が背景に入る位置
  const SITE = {'-1,1': [14, 'c_screen'], '1,1': [18, 'c_screen'], '-2,0': [30], '3,0': [46], '-3,1': [54], '2,1': [24], '4,2': [38], '-4,3': [60],
    '0,1': [-52], '1,0': [-34], '-1,0': [-28], '0,2': [-16], '2,0': [-8], '-3,0': [-20], '-2,2': [4], '3,2': [10]};
  for (let j = 0; j < 6; j++) for (let i = -7; i <= 7; i++) {
    const cx = i * BK, cz = -22 - BK / 2 - j * BK, site = SITE[i + ',' + j], top = site?.[0] ?? (Math.abs(i) < 3 ? Math.max(-128, cz * .5 - R(8, 46)) : R(-110, -14) + j * 5);   // 正面の列は奥ほど低くして、見下ろしたときに谷の奥まで見通せるようにする
    const one = (x, w, t, sign = true) => { const b = addB(x, cz + R(-1, 1), w, LOT - R(0, 6), t, {lit: R(.28, .52)}); if (sign && j < 3 && Math.abs(i) < 5) mid.push(b); return b; };
    if (site) { const bb = one(cx, LOT - 2, top, false); if (site[1]) bb.kind = site[1]; }
    else if (rnd() < .35) { const w = LOT * R(.4, .6); one(cx - LOT / 2 + w / 2, w - 1.5, top); one(cx + w / 2, LOT - w - 1.5, top + R(-28, 28)); }   // 升目を2棟に分ける
    else one(cx, LOT - R(0, 5), top);
  }
  // 遠景: 奥ほど高い
  for (let i = 0; i < 150; i++) { const z = -R(310, 700), x = R(-1, 1) * (140 + -z * .95); addB(x, z, R(20, 52), R(20, 52), R(-40, 30) + -z * R(.05, .15) + Math.abs(x) * .06); }   // セルルックのビルで立った目線の背景を埋める（遠景の絵はその上にのぞく）
  const towers = [];
  for (let i = 0; i < 10; i++) if (i < 3 || i > 6) towers.push(addB(-600 + i * 132 + R(-40, 40), -R(420, 820), R(36, 64), R(36, 64), R(190, 360), {style: 1, lit: R(.25, .45)}));
  {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), shader({
      vertexShader: `attribute vec4 aInfo; varying vec3 vLocal,vSize,vNl,vWPos; varying vec4 vInfo;
        void main(){vec3 sc=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
          vLocal=position*sc; vSize=sc; vNl=normal; vInfo=aInfo; vec4 wp=modelMatrix*instanceMatrix*vec4(position,1.); vWPos=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp;}`,
      fragmentShader: `${NOISE}${FOG}${PALETTE} varying vec3 vLocal,vSize,vNl,vWPos; varying vec4 vInfo;
        void main(){clipBelow(vWPos); float seed=floor(vInfo.x*997.+.5)/997.; vec3 tint=neon(floor(vInfo.w+.5));   // 補間で値がわずかに揺れるので丸める
          float litR=floor(vInfo.z*200.+.5)/200.;
          vec3 col=vec3(.010,.014,.026);
          if(vNl.y>.5){
            // 屋上: 縁の立ち上がり、設備の箱、光る天窓、ヘリポート、縁のネオン（見下ろしたときに映る）
            vec2 p=vLocal.xz,hs=vSize.xz*.5; float edge=min(hs.x-abs(p.x),hs.y-abs(p.y));
            col=vec3(.020,.024,.036)*(.8+.5*vnoise(p*.7+seed*40.));
            col+=vec3(.035,.04,.055)*smoothstep(1.4,1.1,edge);
            vec2 g=p/4.6+seed*7.,c=floor(g),f=fract(g); float r=h21(c+seed*31.);
            float aa=clamp(1.6-fwidth(g.x)*3.2,0.,1.);
            float bx=step(.18,f.x)*step(f.x,.82)*step(.22,f.y)*step(f.y,.78)*step(2.2,edge)*aa;
            if(r<.30)col=mix(col,vec3(.055,.06,.075)+vec3(.03)*step(.5,f.y),bx);
            else if(r<.50)col+=mix(vec3(.5,.8,1.),vec3(1.,.75,.45),step(.40,r))*1.3*bx*(.7+.3*sin(uTime*.6+r*40.));
            else if(r<.58)col+=tint*1.8*bx*(.55+.45*step(.5,fract(uTime*.4+r*9.)));
            if(h21(vec2(seed,3.))>.72&&min(hs.x,hs.y)>11.){float rr=length(p); col+=vec3(1.,.55,.12)*1.4*(smoothstep(.5,.15,abs(rr-7.))+step(abs(p.x),.5)*step(abs(p.y),3.2)+step(abs(p.y),.5)*step(abs(p.x),2.2));}
            if(vInfo.y>.5)col+=tint*1.6*(.75+.25*sin(uTime*(.6+seed)+seed*40.))*smoothstep(.9,.5,edge);
          }else if(abs(vNl.y)<.5){
            bool sx=abs(vNl.x)>.5; float u=sx?vLocal.z:vLocal.x,hw=(sx?vSize.z:vSize.x)*.5,v=vLocal.y+vSize.y*.5;
            vec2 g=vec2(u/2.6+seed*13.,v/3.4),cell=floor(g),f=fract(g);
            float m=step(.16,f.x)*step(f.x,.84)*step(.22,f.y)*step(f.y,.78);
            float r=h21(cell+seed*71.),fl=h21(cell*1.7+floor(uTime*.1+r*9.));
            float row=step(h21(vec2(cell.y,seed*5.)),.10);
            float on=max(step(r,litR)*step(.06,fl),row*step(.2,r));
            vec3 wc=mix(vec3(1.,.74,.42),vec3(.55,.80,1.),step(.6,h21(vec2(cell.y*.37,seed))));
            wc=mix(wc,tint,step(.9,h21(cell.yx+seed*3.))*.8);
            float aa=clamp(1.6-fwidth(g.y)*3.2,0.,1.);                                    // 遠くは窓をつぶして平均の明るさにする
            col+=wc*mix(litR*.16,m*on*mix(.25,1.25,h21(cell+3.3)),aa);
            col+=vec3(.02,.03,.05)*smoothstep(0.,vSize.y,v);                              // 上ほど空の明るさを拾う
            if(vInfo.y>.5){                                                              // 角と屋上の縁に光の線
              float pulse=.75+.25*sin(uTime*(.6+seed)+seed*40.);
              col+=tint*1.7*pulse*(smoothstep(.955,.975,abs(u)/hw)+smoothstep(vSize.y-1.6,vSize.y-1.2,v)*.8);
            }
          }
          gl_FragColor=vec4(applyFog(col,vWPos),1.);}`}), blds.length);
    const info = new Float32Array(blds.length * 4), m4 = new THREE.Matrix4();
    blds.forEach((b, i) => { const h = b.top - b.bottom; m4.makeScale(b.w, h, b.d).setPosition(b.x, b.bottom + h / 2, b.z); mesh.setMatrixAt(i, m4); info.set([b.seed, b.style, b.lit, b.tint], i * 4); });
    mesh.geometry.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4)); mesh.frustumCulled = false; mesh.name = 'Buildings'; root.add(mesh); bldMesh = mesh;
  }

  // ---- サイネージ（ネオン文字の看板と、絵が切り替わる大型ビジョン）
  const SIGN_VERT = `varying vec2 vUv; varying vec3 vWPos; void main(){vUv=uv; vec4 wp=modelMatrix*vec4(position,1.); vWPos=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp;}`;
  const neonMat = (tex, color, {buzz = 0, gain = 2.6, open = false} = {}) => shader({uniforms: {map: {value: tex}, uColor: {value: new THREE.Vector3(...color)}, uSeed: {value: rnd()}, uBuzz: {value: buzz}, uGain: {value: gain}, uOpen: {value: open ? 1 : 0}},
    vertexShader: SIGN_VERT, transparent: open, depthWrite: !open, side: THREE.DoubleSide,
    fragmentShader: `${NOISE}${FOG} uniform sampler2D map; uniform vec3 uColor; uniform float uSeed,uBuzz,uGain,uOpen; varying vec2 vUv; varying vec3 vWPos;
      void main(){clipBelow(vWPos); float a=texture2D(map,vUv).r;
        float fl=.9+.1*sin(uTime*37.+uSeed*90.);
        fl*=mix(1.,step(.16,h21(vec2(floor(uTime*9.),uSeed)))*step(.3,vnoise(vec2(uTime*.7,uSeed*50.))+.35),uBuzz);   // 切れかけの看板
        vec3 col=uColor*a*uGain*fl+mix(vec3(.012,.012,.02),uColor*.05,a);
        gl_FragColor=vec4(applyFog(col,vWPos),mix(1.,smoothstep(.02,.3,a),uOpen));}`});
  const wideAtlas = screenAtlas(ADS, 768, 432), tallAtlas = screenAtlas(ADS.map(d => (g, w, h) => { g.save(); g.translate(0, h * .25); d(g, w, h * .5); g.restore(); const l = g.createLinearGradient(0, 0, 0, h); l.addColorStop(0, '#000c'); l.addColorStop(.25, '#0000'); l.addColorStop(.75, '#0000'); l.addColorStop(1, '#000c'); g.fillStyle = l; g.fillRect(0, 0, w, h); }), 432, 768);
  const screenMat = (atlas, {gain = 1.5, period = 6} = {}) => shader({uniforms: {map: {value: atlas}, uSeed: {value: rnd()}, uGain: {value: gain}, uPeriod: {value: period}, uN: {value: ADS.length}, uLed: {value: new THREE.Vector2(160, 90)}},
    vertexShader: SIGN_VERT,
    fragmentShader: `${NOISE}${FOG} uniform sampler2D map; uniform float uSeed,uGain,uPeriod,uN; uniform vec2 uLed; varying vec2 vUv; varying vec3 vWPos;
      vec3 frame(float i,vec2 uv){return texture2D(map,vec2(uv.x,(uN-1.-mod(i,uN)+uv.y)/uN)).rgb;}
      void main(){clipBelow(vWPos); float t=uTime/uPeriod+uSeed*7.,i=floor(t),k=fract(t);
        vec2 uv=vUv; float tr=smoothstep(.93,1.,k);                                          // 切り替わる直前に横へ乱れる
        uv.x=fract(uv.x+tr*(h21(vec2(floor(uv.y*24.),i))-.5)*.5);
        vec3 col=mix(frame(i,uv),frame(i+1.,uv),step(.5,tr*h21(vec2(floor(uv.y*24.),i+.5))+tr*.5));
        col*=.86+.14*sin((vUv.y*uLed.y*.5+uTime*1.5)*6.283);                                 // 流れる走査線
        vec2 led=fract(vUv*uLed)-.5; float aa=clamp(1.5-fwidth(vUv.y*uLed.y)*2.5,0.,1.);
        col*=mix(.72,smoothstep(.5,.25,max(abs(led.x),abs(led.y)))*1.15,aa);                  // 近くでは LED の粒
        col=col*uGain*(.94+.06*sin(uTime*50.+uSeed*30.))+vec3(.01);
        gl_FragColor=vec4(applyFog(col,vWPos),1.);}`});
  const signs = new THREE.Group(); signs.name = 'Signs'; root.add(signs);
  const plane = (w, h, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.y = ry; signs.add(m); return m; };
  const NC = Object.values(STAGE.neon), VWORDS = ['電脳街', '夜市', '氷菓', '珈琲', '麺処', 'ホテル', '薬局', '酒場', '月光', '星屑', '遊技場', '質'], HWORDS = ['OPEN 24H', 'ARCADE', 'NEON', 'SKYPORT', CH.tag, 'BAR', 'CAPSULE', 'Tripo'];
  // 看板と航空障害灯は、ビルの形が決まってから付ける（読み込み後に呼ぶ）。段々のビルとランドマークには付けない
  const FLAT = new Set([undefined, 'c_shop', 'c_office', 'c_slim', 'c_screen']);
  let decorated = false;
  const decorate = () => { if (decorated) return; decorated = true;
  for (const b of mid) { if (!FLAT.has(b.type) || b.kind) continue;
    const front = b.z + b.d / 2 + .25, n = 1 + Math.floor(rnd() * 3);
    if (rnd() < .62) { const tall = rnd() < .45, h = tall ? R(14, 22) : R(7, 11), w = tall ? h * 9 / 16 : h * 16 / 9, ww = Math.min(w, b.w * .9); plane(ww, h * ww / w, screenMat(tall ? tallAtlas : wideAtlas, {period: R(5, 9)}), b.x + R(-1, 1) * (b.w - ww) / 2, b.top - 3 - h / 2 - R(0, 6), front); }
    for (let i = 0; i < n; i++) {
      const vert = rnd() < .65, tex = neonText(vert ? pick(VWORDS) : pick(HWORDS), {vertical: vert, font: vert ? JP : EN}), h = vert ? R(7, 13) : R(2, 3.4), w = h * tex.userData.aspect;
      plane(w, h, neonMat(tex, pick(NC), {buzz: rnd() < .25 ? 1 : 0}), b.x + (rnd() < .5 ? -1 : 1) * (b.w / 2 + (vert ? w * .6 : -w * .4)), b.top - R(4, 26) - h / 2, front + (vert ? -1 : .1) + i * .05, vert ? R(-.25, .25) : 0);
    }
  }
  for (const b of towers.slice(0, 5)) if (FLAT.has(b.type)) plane(b.w * .8, b.w * .45, screenMat(wideAtlas, {gain: 1.2, period: R(7, 11)}), b.x, b.top - b.w * .5, b.z + b.d / 2 + .5);

  // ---- 光の点（航空障害灯）。屋上のてっぺんに1つ
  {
    const pos = [], col = [], par = [];
    for (const b of blds) if (!b.skip && (b.top > 40 || b.type === 'landmark') && rnd() < .8) { pos.push(b.x, b.top + 1, b.z); col.push(1, .06, .06); par.push(b.type === 'landmark' ? 6 : R(2.5, 4), R(.25, .5), rnd()); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aParam', new THREE.Float32BufferAttribute(par, 3));
    const pts = new THREE.Points(g, shader({transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uPx,uTime; attribute vec3 aColor,aParam; varying vec3 vCol;
        void main(){vec4 mv=viewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv; gl_PointSize=max(2.,aParam.x*uPx/-mv.z);
          float b=smoothstep(.6,1.,sin(uTime*6.283*aParam.y+aParam.z*6.283)); vCol=aColor*(.25+2.2*b)*exp(mv.z*.0012);}`,
      fragmentShader: `varying vec3 vCol; void main(){float r=length(gl_PointCoord-.5); gl_FragColor=vec4(vCol*exp(-r*r*18.),1.);}`}));
    pts.frustumCulled = false; root.add(pts);
  }
  };

  // ---- 空を行き交う車（位置は描画時に時刻から決める）
  {
    const lanes = [];   // 道路の真上を、高さを変えて行き交う。屋上より下の列は見下ろしたときに、上の列は立った目線で見える
    const SX = k => -22 - BK * k, SZ = k => BK * (k + .5);
    for (const [k, y, v] of [[0, -34, 30], [0, -78, 24], [1, -52, 28], [1, 14, 36], [2, -30, 32], [2, -92, 26], [3, 34, 42], [3, -60, 30], [4, -20, 38], [5, 66, 46]]) {
      const dirn = lanes.length % 2 ? 1 : -1, L = 420; lanes.push({a: [-L * dirn, y, SX(k) + dirn * 2.5], b: [L * dirn, y + 4, SX(k) + dirn * 2.5], n: 14, v});
    }
    for (const [k, y, v] of [[0, -44, 32], [0, -96, 26], [-1, -58, 30], [1, -26, 34], [-2, -70, 28], [2, 18, 40], [-3, 8, 38]]) {
      const dirn = lanes.length % 2 ? 1 : -1, x = SZ(k) + dirn * 2.5; lanes.push(dirn > 0 ? {a: [x, y, -560], b: [x, y + 5, 30], n: 13, v} : {a: [x, y, 30], b: [x, y + 5, -560], n: 13, v});
    }
    lanes.push({a: [-600, 112, -360], b: [600, 104, -360], n: 22, v: 60});
    const A = [], D = [], P = [];
    for (const l of lanes) { const a = new THREE.Vector3(...l.a), d = new THREE.Vector3(...l.b).sub(a), len = d.length();
      for (let i = 0; i < l.n; i++) { A.push(a.x + R(-1.5, 1.5), a.y + R(-1.5, 1.5), a.z + R(-1.5, 1.5)); D.push(d.x, d.y, d.z); P.push((i + R(0, .8)) / l.n, l.v * R(.85, 1.15) / len, R(.8, 1.3), Math.floor(rnd() * 6)); } }
    const n = P.length / 4, CAR = `uniform float uTime,uClip; attribute vec3 aStart,aDir; attribute vec4 aCar;
      vec3 carPos(out float f){f=fract(uTime*aCar.y+aCar.x); return aStart+aDir*f;}`;
    const body = new THREE.InstancedBufferGeometry().copy(new THREE.BoxGeometry(4.6, 1.1, 1.9)); body.instanceCount = n;
    body.setAttribute('aStart', new THREE.InstancedBufferAttribute(new Float32Array(A), 3)); body.setAttribute('aDir', new THREE.InstancedBufferAttribute(new Float32Array(D), 3)); body.setAttribute('aCar', new THREE.InstancedBufferAttribute(new Float32Array(P), 4));
    const bodies = new THREE.Mesh(body, shader({
      vertexShader: `${CAR} varying vec3 vWPos,vL; varying float vTint;
        void main(){float f; vec3 c=carPos(f),X=normalize(aDir),Z=normalize(cross(X,vec3(0.,1.,0.))),Y=cross(Z,X);
          vec3 p=position*aCar.z; vL=position; vTint=aCar.w; vWPos=c+X*p.x+Y*p.y+Z*p.z; gl_Position=projectionMatrix*viewMatrix*vec4(vWPos,1.);}`,
      fragmentShader: `${FOG}${PALETTE} varying vec3 vWPos,vL; varying float vTint;
        void main(){clipBelow(vWPos); vec3 col=vec3(.02,.025,.035)+neon(floor(vTint+.5))*1.6*smoothstep(-.3,-.55,vL.y)*step(abs(vL.x),2.1);   // 車体の下の光
          col+=vec3(.5,.7,1.)*.5*step(.25,vL.y)*step(abs(vL.x-.4),.9);                                                               // 窓
          gl_FragColor=vec4(applyFog(col,vWPos),1.);}`}));
    bodies.frustumCulled = false; root.add(bodies); carRef = {A, D, P, n, bodies, CAR};
    // 前照灯と尾灯
    const lp = new Float32Array(n * 2 * 3), la = new Float32Array(n * 2 * 3), ld = new Float32Array(n * 2 * 3), lc = new Float32Array(n * 2 * 4), le = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) for (let k = 0; k < 2; k++) { const j = i * 2 + k; la.set(A.slice(i * 3, i * 3 + 3), j * 3); ld.set(D.slice(i * 3, i * 3 + 3), j * 3); lc.set(P.slice(i * 4, i * 4 + 4), j * 4); le[j] = k ? -1 : 1; }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3)); lg.setAttribute('aStart', new THREE.BufferAttribute(la, 3)); lg.setAttribute('aDir', new THREE.BufferAttribute(ld, 3)); lg.setAttribute('aCar', new THREE.BufferAttribute(lc, 4)); lg.setAttribute('aEnd', new THREE.BufferAttribute(le, 1));
    const lights = new THREE.Points(lg, shader({transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uPx; ${CAR} attribute float aEnd; varying vec3 vCol;
        void main(){float f; vec3 c=carPos(f)+normalize(aDir)*aEnd*2.4*aCar.z; vec4 mv=viewMatrix*vec4(c,1.); gl_Position=projectionMatrix*mv;
          gl_PointSize=max(1.5,3.2*aCar.z*uPx/-mv.z); if(uClip>.5&&c.y<0.)gl_PointSize=0.;
          vCol=(aEnd>0.?vec3(.75,.92,1.)*2.6:vec3(1.,.10,.06)*2.2)*smoothstep(0.,.04,f)*smoothstep(1.,.96,f)*exp(mv.z*.0016);}`,
      fragmentShader: `varying vec3 vCol; void main(){float r=length(gl_PointCoord-.5); gl_FragColor=vec4(vCol*exp(-r*r*22.),1.);}`}));
    lights.frustumCulled = false; root.add(lights);
  }

  // ---- サーチライト
  for (const [x, z, ph] of [[-150, -300, 0], [190, -380, 2.1], [40, -560, 4]]) {
    const g = new THREE.CylinderGeometry(22, .6, 420, 20, 1, true); g.translate(0, 210, 0);
    const m = new THREE.Mesh(g, shader({transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `varying float vH; varying vec3 vN,vV; void main(){vH=position.y/420.; vec4 wp=modelMatrix*vec4(position,1.); vN=normalize(mat3(modelMatrix)*normal); vV=normalize(cameraPosition-wp.xyz); gl_Position=projectionMatrix*viewMatrix*wp;}`,
      fragmentShader: `varying float vH; varying vec3 vN,vV; void main(){float e=pow(abs(dot(normalize(vN),normalize(vV))),2.); gl_FragColor=vec4(vec3(.45,.6,1.)*.07*e*(1.-vH)*(1.-vH),1.);}`}));
    m.position.set(x, -30, z); root.add(m); updaters.push(t => { m.rotation.z = Math.sin(t * .11 + ph) * .5; m.rotation.x = Math.cos(t * .08 + ph * 1.7) * .3 - .15; });
  }

  // ---- フォグの板（ビルの層の間に置く。もやがゆっくり流れる）
  const fogCard = (w, h, x, y, z, alpha, scale, speed, low = 1) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), shader({transparent: true, depthWrite: false, uniforms: {uAlpha: {value: alpha}, uScale: {value: scale}, uSpeed: {value: speed}, uLow: {value: low}},
      vertexShader: `varying vec2 vUv; varying vec3 vWPos; void main(){vUv=uv; vec4 wp=modelMatrix*vec4(position,1.); vWPos=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp;}`,
      fragmentShader: `${NOISE}${FOG} uniform float uAlpha,uScale,uSpeed,uLow; varying vec2 vUv; varying vec3 vWPos;
        void main(){vec2 p=vUv*uScale; float n=fbm(p+vec2(uTime*uSpeed,uTime*uSpeed*.3))*fbm(p*.5-vec2(uTime*uSpeed*.6,0.)+9.);
          float a=smoothstep(.10,.42,n)*uAlpha*smoothstep(0.,.25,vUv.x)*smoothstep(1.,.75,vUv.x)*smoothstep(1.,.35,vUv.y)*mix(1.,smoothstep(0.,.3,vUv.y),1.-uLow);
          gl_FragColor=vec4(fogColor(vWPos.y)*1.5+vec3(.03,.02,.05),a);}`}));
    m.position.set(x, y, z); m.renderOrder = 5; root.add(m); return m;
  };
  for (const [y, a, sc] of [[-52, .42, 5], [-88, .5, 4], [-122, .6, 3]]) { const m = fogCard(900, 700, 0, y, -330, a, new THREE.Vector2(sc * 1.3, sc), .006, 0); m.rotation.x = -Math.PI / 2; m.material.side = THREE.DoubleSide; }   // 谷間に横たわるもや
  {
    const st = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1300), shader({uniforms: {uBlock: {value: STAGE.block}, uHalf: {value: (STAGE.block - STAGE.lot) / 2}},
      vertexShader: `varying vec3 vWPos; void main(){vec4 wp=modelMatrix*vec4(position,1.); vWPos=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp;}`,
      fragmentShader: `${NOISE}${FOG} uniform float uBlock,uHalf; varying vec3 vWPos;
        // 道路1本ぶんの車の光: 進む向きごとに白（前照灯）と赤（尾灯）の点が流れる
        vec3 traffic(float along,float across,float id){vec3 c=vec3(0.);
          for(float s=-1.;s<=1.;s+=2.){float lane=smoothstep(1.3,.5,abs(across-s*2.6)); float q=along/15.+s*uTime*(.9+.4*h21(vec2(id,s)))+id*7.; float n=h21(vec2(floor(q),id+s));
            c+=(s>0.?vec3(1.,.95,.85):vec3(1.,.12,.08))*lane*step(.45,n)*smoothstep(.34,.1,abs(fract(q)-.5))*2.6;}
          return c;}
        void main(){clipBelow(vWPos); vec2 p=vWPos.xz+vec2(0.,22.); vec2 q=p/uBlock,f=fract(q)-.5,id=floor(q);
          vec2 d=(.5-abs(f))*uBlock;                                                        // 道路の中心線までの距離
          vec3 col=vec3(.012,.014,.022);
          float wet=fbm(p*.05); col+=mix(vec3(.30,.05,.22),vec3(.04,.22,.30),smoothstep(.3,.7,fbm(p*.013+5.)))*wet*.5;   // 濡れた路面にネオンが溶ける
          if(d.x<uHalf)col+=traffic(p.y,d.x*sign(f.x),id.x+step(0.,f.x))+vec3(.9,.8,.5)*.25*smoothstep(.25,.05,abs(d.x))*step(.5,fract(p.y/6.));
          if(d.y<uHalf)col+=traffic(p.x,d.y*sign(f.y),id.y+step(0.,f.y)+50.)+vec3(.9,.8,.5)*.25*smoothstep(.25,.05,abs(d.y))*step(.5,fract(p.x/6.));
          gl_FragColor=vec4(applyFog(col,vWPos),1.);}`}));
    st.rotation.x = -Math.PI / 2; st.position.set(0, STAGE.street, -480); st.name = 'Street'; root.add(st);
  }
  fogCard(260, 70, 0, -42, -20, .85, new THREE.Vector2(5, 1.6), .012);
  fogCard(520, 120, 0, -40, -74, .7, new THREE.Vector2(6, 1.6), .008);
  fogCard(1100, 200, 0, -30, -150, .6, new THREE.Vector2(7, 1.5), .006);
  fogCard(2200, 340, 0, -10, -340, .55, new THREE.Vector2(8, 1.5), .004);

  // ---- 屋上（近景）。built-in のマテリアルとライトで描く
  scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(...STAGE.fogLow), 0.012);
  root.add(new THREE.HemisphereLight(0x3a4a7a, 0x2a1030, 1.6));
  const keyL = new THREE.DirectionalLight(0x8fa8ff, 0.9); keyL.position.set(-3, 6, 4); root.add(keyL);
  const pl = (c, i, x, y, z, d = 14) => { const l = new THREE.PointLight(c, i, d, 1.6); l.position.set(x, y, z); root.add(l); return l; };
  pl(0xff2a8a, 30, 4.5, 3.2, -3.4); pl(0x18c8ff, 16, -3.5, .5, -3.6, 10); pl(0xff7a1a, 8, -6, 2.4, -2, 9);
  const M = (color, rough = .7, metal = .2, o = {}) => new THREE.MeshStandardMaterial({color, roughness: rough, metalness: metal, ...o});
  const mConcrete = M(0x3a3d46, .85, 0), mMetal = M(0x7d8791, .45, .7), mDark = M(0x1b1e25, .6, .5), mUnit = M(0xa9b0b6, .55, .3), mRust = M(0x5a4a40, .8, .3);
  const box = (w, h, d, mat, x, y, z, parent = roof) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m; };
  const cyl = (r, len, mat, x, y, z, axis = 'y', parent = roof) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 14), mat); m.position.set(x, y, z); if (axis === 'x') m.rotation.z = Math.PI / 2; if (axis === 'z') m.rotation.x = Math.PI / 2; parent.add(m); return m; };
  const emis = (color, gain = 2.5) => new THREE.MeshBasicMaterial({color: new THREE.Color().setRGB(color[0] * gain, color[1] * gain, color[2] * gain)});
  const roof = new THREE.Group(); roof.name = 'Rooftop'; root.add(roof);
  const E = STAGE.edgeZ;
  // 縁の低い立ち上がりと、足元の光の帯
  box(40, .26, .5, mConcrete, 0, .13, E); box(40, .035, .56, mDark, 0, .275, E);   // 低い立ち上がりだけ。手すりはない
  for (let x = -18; x <= 18; x += 3) box(.5, .012, .5, emis(STAGE.neon.amber, .9), x + .25, .297, E);   // 縁の注意の印
  box(40, .03, .03, emis(STAGE.neon.cyan, 2.2), 0, .06, E + .27);
  // 配管とダクト
  cyl(.07, 20, mRust, 6, .22, E + .42, 'x'); cyl(.045, 20, mMetal, 6, .40, E + .40, 'x'); cyl(.06, 9, mMetal, -9.5, .2, E + .45, 'x');
  box(7, .5, .55, mMetal, 7.2, 1.35, E + 1.1); box(.55, 1.4, .55, mMetal, 3.75, .7, E + 1.1); for (let x = 4.6; x < 10.5; x += 1.4) box(.06, .56, .6, mDark, x, 1.35, E + 1.1);

  // 縁の先は、すぐ下の街
  const emitters = [];
  // 床の排気口（湯気が立つ）
  { box(.9, .1, .9, mDark, 2.3, .05, E + 3.0); for (let i = 0; i < 7; i++) box(.86, .012, .05, mMetal, 2.3, .105, E + 2.64 + i * .12); emitters.push({origin: new THREE.Vector3(2.3, .12, E + 3.0), dir: new THREE.Vector3(0, 1, 0), height: 3.4, size: .6, count: 24}); }
  // 屋上の看板（骨組みに文字だけが付く。向こうの街が透けて見える）
  { const g = new THREE.Group(); g.name = 'roof_sign'; g.position.set(4.9, 0, E - .05); roof.add(g);
    const tex = neonText(CH.sign, {frame: false}), h = 1.25, w = h * tex.userData.aspect;
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), neonMat(tex, STAGE.neon.magenta, {gain: 3.2, open: true})); s.position.y = 3.35; g.add(s);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(2.6, .42), neonMat(neonText('ELECTRIC  SECTOR 07', {font: EN, frame: false}), STAGE.neon.cyan, {gain: 2.4, open: true, buzz: 1})); s2.position.set(-.9, 2.48, 0); g.add(s2);
    for (const x of [-w / 2 - .1, 0, w / 2 + .1]) cyl(.035, 4.1, mDark, x, 2.05, -.12, 'y', g);
    for (const y of [2.2, 2.75, 4.05]) cyl(.022, w + .3, mDark, 0, y, -.12, 'x', g);
    for (let i = 0; i < 4; i++) { const d = cyl(.016, 1.9, mDark, -w / 2 + .6 + i * (w / 4), 3.4, -.12, 'y', g); d.rotation.z = (i % 2 ? 1 : -1) * .75; } }
  // たるんだ電線
  for (const [a, b, sag] of [[[-5, 5.6, E + .55], [-19, 7.5, E - 6], 1.2], [[-5, 5.0, E + .55], [9, 6.5, E - 14], 1.6], [[4.9 - 2.6, 4.1, E - .17], [-5, 4.4, E + .55], .5]]) {
    const pts = []; for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t)); }
    roof.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, .012, 5), mDark));
  }

  // ---- 湯気
  {
    const O = [], S = [], Dv = [];
    for (const e of emitters) for (let i = 0; i < e.count; i++) { O.push(e.origin.x, e.origin.y, e.origin.z); Dv.push(e.dir.x, e.dir.y, e.dir.z); S.push(rnd(), R(.10, .17), e.height * R(.7, 1.2), e.size * R(.7, 1.3)); }
    const g = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1)); g.instanceCount = S.length / 4;
    g.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(new Float32Array(O), 3)); g.setAttribute('aOut', new THREE.InstancedBufferAttribute(new Float32Array(Dv), 3)); g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(S), 4));
    const steam = new THREE.Mesh(g, shader({transparent: true, depthWrite: false, uniforms: {uWind: {value: new THREE.Vector3(.5, 0, .12)}},
      vertexShader: `uniform float uTime; attribute vec3 aOrigin,aOut; attribute vec4 aSeed; uniform vec3 uWind; varying vec2 vUv; varying float vA,vS;
        void main(){float life=fract(uTime*aSeed.y+aSeed.x);
          vec3 p=aOrigin+aOut*(.25+life*.5)*step(abs(aOut.y),.5)+vec3(0.,life*aSeed.z*(.35+.65*life),0.)+uWind*life*life*aSeed.z
            +vec3(sin(life*6.+aSeed.x*40.),0.,cos(life*5.+aSeed.x*17.))*.10*life;
          float size=aSeed.w*(.3+life*1.9); vec4 mv=viewMatrix*vec4(p,1.); mv.xy+=position.xy*size;
          vUv=uv; vS=aSeed.x; vA=smoothstep(0.,.10,life)*pow(1.-life,1.4); gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `${NOISE}${FOG} varying vec2 vUv; varying float vA,vS;
        void main(){vec2 c=vUv-.5; float r=length(c); float n=fbm(vUv*2.6+vS*31.+vec2(0.,-uTime*.25));
          float a=smoothstep(.5,.08,r)*smoothstep(.25,.75,n+.25)*vA*.20;
          gl_FragColor=vec4(mix(vec3(.30,.26,.42),vec3(.42,.50,.66),vUv.y),a);}`}));
    steam.frustumCulled = false; steam.renderOrder = 8; steam.name = 'Steam'; root.add(steam);
  }

  // ---- 濡れた床（水たまりに街とキャラが映る）
  const refl = reflection ? new THREE.WebGLRenderTarget(4, 4, {type: THREE.HalfFloatType, samples: 0}) : null;
  const texMat = new THREE.Matrix4(), vcam = new THREE.PerspectiveCamera();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 26), shader({uniforms: {tRefl: {value: refl?.texture ?? null}, uTexMat: {value: texMat}, uOn: {value: refl ? 1 : 0}, uChar: {value: new THREE.Vector2()}},
    vertexShader: `uniform mat4 uTexMat; varying vec3 vWPos; varying vec4 vR; void main(){vec4 wp=modelMatrix*vec4(position,1.); vWPos=wp.xyz; vR=uTexMat*wp; gl_Position=projectionMatrix*viewMatrix*wp;}`,
    fragmentShader: `${NOISE}${FOG} uniform sampler2D tRefl; uniform float uOn; uniform vec2 uChar; varying vec3 vWPos; varying vec4 vR;
      void main(){vec2 p=vWPos.xz; vec3 V=normalize(cameraPosition-vWPos);
        float puddle=smoothstep(.46,.60,fbm(p*.42+3.7));                                    // 水たまりの形
        vec2 q=abs(fract(p/1.5)-.5); float groove=smoothstep(.485,.497,max(q.x,q.y));          // 床板の目地
        float grain=fbm(p*5.);
        vec3 base=vec3(.030,.034,.044)*(.6+.8*grain)*(1.-.55*groove);
        vec2 rough=(vec2(vnoise(p*14.),vnoise(p*14.+31.))-.5)*mix(.05,.0,puddle);            // 乾きかけの所は映り込みが乱れる
        vec2 ripple=vec2(sin(p.y*9.+uTime*.7),cos(p.x*8.-uTime*.6))*.0015*puddle;
        vec2 uv=vR.xy/vR.w+rough+ripple; vec3 r=vec3(0.);
        if(uOn>.5){float b=mix(.006,.0006,puddle); r=(texture2D(tRefl,uv).rgb*2.+texture2D(tRefl,uv+vec2(b,0.)).rgb+texture2D(tRefl,uv-vec2(b,0.)).rgb+texture2D(tRefl,uv+vec2(0.,b*2.)).rgb+texture2D(tRefl,uv-vec2(0.,b*2.)).rgb)/6.;}
        float fres=mix(.10,1.,pow(1.-max(V.y,0.),3.));
        vec3 col=base*mix(1.,.45,puddle)+min(r,vec3(3.))*fres*mix(.30,.95,puddle)*(1.-.6*groove*(1.-puddle));
        col*=1.-.5*exp(-dot(p-uChar,p-uChar)*5.);                                              // 足元の影
        gl_FragColor=vec4(applyFog(col,vWPos),1.);}`}));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, E + 13 - .2); floor.name = 'Floor'; root.add(floor);
  box(40, 6, 26, mConcrete, 0, -3.02, E + 13 - .2).name = 'RoofBody';   // 屋上の厚み（映り込みに下の街が入らないように）

  // ---- Tripo で作ったビル・車・床と遠景の画像（stage/assets.json に書いたものを読み込む。無ければ箱のまま）
  async function loadAll(dir) {
    let man; try { const r = await fetch(dir + 'assets.json'); if (!r.ok) return {}; man = await r.json(); } catch { return {}; }
    const log = {};
    if (man.skyline) {   // 遠景の絵。ビル群のさらに奥に立てる板
      const tex = await new THREE.TextureLoader().loadAsync(dir + man.skyline.file); tex.colorSpace = THREE.SRGBColorSpace;
      const k = man.skyline, w = k.width ?? 3600, h = w * tex.image.height / tex.image.width;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), shader({transparent: true, depthWrite: false, uniforms: {map: {value: tex}, uGain: {value: k.gain ?? 1}, uHaze: {value: k.haze ?? .3}},
        vertexShader: `varying vec2 vUv; varying vec3 vWPos; void main(){vUv=uv; vec4 wp=modelMatrix*vec4(position,1.); vWPos=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp;}`,
        fragmentShader: `${FOG} uniform sampler2D map; uniform float uGain,uHaze; varying vec2 vUv; varying vec3 vWPos;
          void main(){clipBelow(vWPos); vec3 c=texture2D(map,vUv).rgb*uGain; c=mix(c,fogColor(vWPos.y)*1.2,uHaze);
            float a=smoothstep(0.,.12,vUv.x)*smoothstep(1.,.88,vUv.x)*smoothstep(1.,.7,vUv.y)*smoothstep(0.,.06,vUv.y);
            gl_FragColor=vec4(c,a);}`}));
      m.position.set(k.x ?? 0, (k.horizon ?? -40) + h * (.5 - (k.horizonAt ?? .36)), k.z ?? -1500); m.renderOrder = -50; m.name = 'Skyline'; root.add(m); log.skyline = `${tex.image.width}x${tex.image.height}`;
    }
    const loader = new GLTFLoader(), cache = {};
    // 自前の材質（街のもやに溶ける。テクスチャ自体を光らせて夜景にする）
    const litMat = (map, glow, extraV = '', pos = 'vec4 wp=modelMatrix*vec4(position,1.);', nor = 'mat3(modelMatrix)*normal') => shader({uniforms: {map: {value: map}, uGlow: {value: glow}},
      vertexShader: `${extraV} varying vec2 vUv; varying vec3 vWPos,vN; void main(){vUv=uv; ${pos} vWPos=wp.xyz; vN=normalize(${nor}); gl_Position=projectionMatrix*viewMatrix*wp;}`,
      fragmentShader: `${FOG} uniform sampler2D map; uniform float uGlow; varying vec2 vUv; varying vec3 vWPos,vN;
        void main(){clipBelow(vWPos); vec3 t=texture2D(map,vUv).rgb; float l=.3+.7*clamp(vN.y*.5+.5,0.,1.);
          vec3 col=t*(uGlow*.55+.10*l)+t*t*uGlow*1.5;                         // 明るい所（窓・ネオン）ほど強く光る
          gl_FragColor=vec4(applyFog(col,vWPos),1.);}`});
    // セルルックの材質: テクスチャの色そのまま（ベタ塗り）＋光の当たる面と陰の面の2段だけ。明るい窓とネオンは陰でも光る
    const CEL_L = new THREE.Vector3(-.55, .45, .7).normalize();
    const celMat = (map, def) => shader({uniforms: {map: {value: map}, uL: {value: CEL_L}, uShade: {value: new THREE.Vector3(...(def.shade ?? [.38, .40, .66]))}, uGain: {value: def.gain ?? .85}, uGlow: {value: def.glow ?? 1}, uFogK: {value: def.fog ?? .7}},
      vertexShader: `varying vec2 vUv; varying vec3 vWPos,vN;
        void main(){vUv=uv; mat4 im=mat4(1.);
          #ifdef USE_INSTANCING
          im=instanceMatrix;
          #endif
          vec3 sc=vec3(length(im[0].xyz),length(im[1].xyz),length(im[2].xyz)); mat4 mm=modelMatrix*im;
          vec4 wp=mm*vec4(position,1.); vWPos=wp.xyz; vN=mat3(mm)*(normal/(sc*sc)); gl_Position=projectionMatrix*viewMatrix*wp;}`,
      fragmentShader: `${FOG} uniform sampler2D map; uniform vec3 uL,uShade; uniform float uGain,uGlow,uFogK; varying vec2 vUv; varying vec3 vWPos,vN;
        void main(){clipBelow(vWPos); vec3 t=texture2D(map,vUv).rgb; vec3 N=normalize(vN); if(!gl_FrontFacing)N=-N;
          vec3 col=t*uGain*mix(uShade,vec3(1.),step(0.,dot(N,uL)));
          float hi=max(t.r,max(t.g,t.b)); col=mix(col,t*(1.+uGlow),smoothstep(.55,.8,hi));
          gl_FragColor=vec4(mix(col,applyFog(col,vWPos),uFogK),1.);}`});   // もやは少し控えめにして、ベタ塗りの色を残す
    const normalized = async (def) => {   // 中心を原点、底を y=0 にそろえた入れ物を返す
      const g = (await loader.loadAsync(dir + def.file)).scene; g.rotation.y = (def.rotY ?? 0) * Math.PI / 180; g.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(g), size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
      g.position.set(-c.x, -bb.min.y, -c.z); const w = new THREE.Group(); w.add(g); w.userData.size = size; return w;
    };
    // 大型ディスプレイに流す広告（assets.json の ad。画像か動画。無ければ用意してある絵が切り替わる）
    let adTex = null;
    if (man.ad?.file) try {
      if (/\.(mp4|webm)$/i.test(man.ad.file)) { const v = document.createElement('video'); v.src = dir + man.ad.file; v.loop = v.muted = v.playsInline = true; await v.play(); adTex = new THREE.VideoTexture(v); }
      else adTex = await new THREE.TextureLoader().loadAsync(dir + man.ad.file);
      adTex.colorSpace = THREE.SRGBColorSpace; log.ad = man.ad.file;
    } catch (e) { log.ad = 'error: ' + e.message; }
    const adMat = (tall) => adTex ? shader({uniforms: {map: {value: adTex}, uGain: {value: man.ad.gain ?? 1.5}}, vertexShader: SIGN_VERT,
      fragmentShader: `${FOG} uniform sampler2D map; uniform float uGain; varying vec2 vUv; varying vec3 vWPos;
        void main(){clipBelow(vWPos); vec3 c=texture2D(map,vUv).rgb*uGain*(.9+.1*sin((vUv.y*80.+uTime*1.5)*6.283)); gl_FragColor=vec4(applyFog(c+vec3(.01),vWPos),1.);}`}) : screenMat(tall ? tallAtlas : wideAtlas, {gain: 1.6, period: 7});   // 縦長の画面には縦長の絵
    // ---- 街のビル（Tripo で作ったセルルックのビル）。区画の箱と同じ場所・高さに、縦横比の近い形を選んで建てる
    // assets.json の city: {名前: {file, rotY, glow, fit, landmark, screen}}、landmarks: [{model, x, z, height, rotY}]
    if (man.city && bldMesh) {
      const T = {}, rr = mulberry(STAGE.seed + 7);
      for (const [name, def] of Object.entries(man.city)) try {
        const w = await normalized(def); w.updateMatrixWorld(true); const geos = []; let map = null;
        w.traverse(o => { if (o.isMesh) { geos.push(o.geometry.clone().applyMatrix4(o.matrixWorld)); map ??= o.material.map; } });
        const size = w.userData.size; T[name] = {def, geo: geos[0], map, size, ratio: size.y / Math.max(size.x, size.z), items: []};
        log[name] = `${Math.round((geos[0].index?.count ?? geos[0].attributes.position.count) / 3)} tris` + (geos.length > 1 ? ` (+${geos.length - 1} 部品は未使用)` : '');
      } catch (e) { log[name] = 'error: ' + e.message; }
      const normal = Object.keys(T).filter(k => !T[k].def.landmark);
      const marks = (man.landmarks ?? []).filter(l => T[l.model]);
      if (normal.length) {
        for (const b of blds) {
          if (marks.some(l => Math.hypot(b.x - l.x, b.z - l.z) < (l.clear ?? 70))) { b.skip = true; continue; }   // ランドマークの足元は空ける
          const H = b.top - b.bottom, W = Math.min(b.w, b.d); if (H < 6) { b.skip = true; continue; }   // 道路より低い（見えない）区画
          let name = b.kind && T[b.kind] ? b.kind : null;
          if (!name) { let best = 1e9; for (const k of normal) { const d = Math.log(H / W / T[k].ratio), sc = (d > 0 ? Math.max(0, d - .7) : -d * 1.5) + rr() * .8; /* 区画より細い建物は建てられる（幅を詰める）ので、細長い区画ほど選べる形が多い */ if (sc < best) { best = sc; name = k; } } }
          const t = T[name], foot = Math.max(t.size.x, t.size.z), sy = H / t.size.y;
          let s = W * (t.def.fit ?? .95) / foot; const k = sy / s;   // 縦の伸び縮みは 0.65〜1.5 倍まで。超える分は幅で吸収する
          if (k > 1.5) s = Math.min(sy / 1.5, Math.max(b.w, b.d) * 1.05 / foot); else if (k < .65) s = sy / .65;
          const q = b.kind ? 0 : Math.floor(rr() * 4);   // 向きは 90° 刻みでばらす（大型ビジョンは正面向き）
          t.items.push({b, s, sy, q}); b.w = s * (q % 2 ? t.size.z : t.size.x); b.d = s * (q % 2 ? t.size.x : t.size.z); b.type = name;
        }
        const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), P = new THREE.Vector3(), S = new THREE.Vector3();
        for (const [name, t] of Object.entries(T)) {
          if (t.items.length) {
            const mesh = new THREE.InstancedMesh(t.geo, celMat(t.map, t.def), t.items.length);
            t.items.forEach(({b, s, sy, q}, i) => { m4.compose(P.set(b.x, b.bottom, b.z), qt.setFromAxisAngle(Y, q * Math.PI / 2), S.set(s, sy, s)); mesh.setMatrixAt(i, m4);
              if (t.def.screen) {   // 画面の位置は建物の寸法に対する割合
                const k = t.def.screen, pw = k.w * t.size.x * s, ph = k.h * t.size.y * sy, pl = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), adMat(ph > pw));
                const off = new THREE.Vector3((k.cx - .5) * t.size.x * s, k.cy * t.size.y * sy, t.size.z * s * (.5 + (k.z ?? .01))).applyAxisAngle(Y, q * Math.PI / 2);
                pl.position.set(b.x, b.bottom, b.z).add(off); pl.rotation.y = q * Math.PI / 2; pl.name = 'screen_' + name; root.add(pl);
              } });
            mesh.frustumCulled = false; mesh.name = 'city_' + name; root.add(mesh); log[name] += ` ×${t.items.length}`;
          }
        }
        bldMesh.visible = false;
      }
      for (const l of marks) {   // ランドマーク: 指定の場所に、道路から指定の高さで建てる
        const t = T[l.model], sc = l.height / t.size.y, m = new THREE.Mesh(t.geo, celMat(t.map, t.def));
        m.scale.setScalar(sc); m.position.set(l.x, STAGE.street, l.z); m.rotation.y = (l.rotY ?? 0) * Math.PI / 180; m.name = 'landmark_' + l.model; root.add(m);
        blds.push({x: l.x, z: l.z, w: t.size.x * sc, d: t.size.z * sc, top: STAGE.street + l.height, type: 'landmark'});
      }
    }
    // ---- 空飛ぶ車（位置は今までどおり時刻から決め、形だけ差し替える）
    if (man.cars?.length && carRef) {
      const {A, D, P, n, bodies, CAR} = carRef, K = man.cars.length; let ok = 0;
      for (let k = 0; k < K; k++) try {
        const def = man.cars[k], w = await normalized(def); let mesh = null; w.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
        w.updateMatrixWorld(true); const g0 = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld), size = w.userData.size;
        if (size.z > size.x) g0.rotateY(Math.PI / 2); if (def.flip) g0.rotateY(Math.PI);                                     // 長い方を進行方向へ
        const len = Math.max(size.x, size.z); g0.scale(def.length / len, def.length / len, def.length / len); g0.translate(0, -size.y * def.length / len / 2, 0);
        const ids = []; for (let i = 0; i < n; i++) if (i % K === k) ids.push(i);
        const pick = (arr, w2) => { const o = new Float32Array(ids.length * w2); ids.forEach((id, j) => o.set(arr.slice(id * w2, id * w2 + w2), j * w2)); return o; };
        const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', g0.attributes.position); g.setAttribute('normal', g0.attributes.normal); g.setAttribute('uv', g0.attributes.uv); g.setIndex(g0.index); g.instanceCount = ids.length;
        g.setAttribute('aStart', new THREE.InstancedBufferAttribute(pick(A, 3), 3)); g.setAttribute('aDir', new THREE.InstancedBufferAttribute(pick(D, 3), 3)); g.setAttribute('aCar', new THREE.InstancedBufferAttribute(pick(P, 4), 4));
        const m = new THREE.Mesh(g, litMat(mesh.material.map, def.glow ?? 1.2, CAR,
          'float f; vec3 c=carPos(f),X=normalize(aDir),Z=normalize(cross(X,vec3(0.,1.,0.))),Y=cross(Z,X); vec3 q=position*aCar.z; vec4 wp=vec4(c+X*q.x+Y*q.y+Z*q.z,1.);', 'X*normal.x+Y*normal.y+Z*normal.z'));
        m.frustumCulled = false; m.name = 'tripo_car_' + k; root.add(m); ok++;
      } catch (e) { log['car' + k] = 'error: ' + e.message; }
      if (ok === K) bodies.visible = false; log.cars = ok + ' 種';
    }
    // ---- キャラの立つ床
    if (man.floor) try {
      const def = man.floor, w = await normalized(def), size = w.userData.size, sc = def.size / Math.max(size.x, size.z);
      w.traverse(o => { if (!o.isMesh) return; const m = o.material; m.metalness = Math.min(m.metalness ?? 0, .3); m.roughness = Math.max(m.roughness ?? 1, .5); if (m.map) { m.emissiveMap = m.map; m.emissive = new THREE.Color(1, 1, 1); m.emissiveIntensity = def.glow ?? .25; } });
      w.scale.setScalar(sc); w.position.set(def.x ?? 0, 0, def.z ?? E + def.size / 2 + .3); w.name = 'tripo_floor'; roof.add(w);
      // キャラの足元（原点）で上から当たりを取り、床板の中の面がちょうど y=0 に来る高さへ下げる（縁はその上に出る）
      w.updateMatrixWorld(true); const hit = new THREE.Raycaster(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0)).intersectObject(w, true)[0];
      w.position.y = -(hit ? hit.point.y : size.y * sc * .8) + .004; log.floor = hit ? 'ok ' + hit.point.y.toFixed(3) : 'no hit';
    } catch (e) { log.floor = 'error: ' + e.message; }
    return log;
  }
  async function loadAssets(dir) { try { return await loadAll(dir); } finally { decorate(); } }

  const clipPlane = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)], up = new THREE.Vector3(), fwd = new THREE.Vector3(), size = new THREE.Vector2();
  return {
    root, uniforms: G, floor, loadAssets,
    setSize(renderer) { renderer.getDrawingBufferSize(size); refl?.setSize(Math.max(2, size.x >> 1), Math.max(2, size.y >> 1)); },
    update(dt, camera, renderer) {
      G.uTime.value += dt; const t = G.uTime.value;
      for (const u of updaters) u(t);
      renderer.getDrawingBufferSize(size); G.uPx.value = size.y / (2 * Math.tan(camera.fov * Math.PI / 360));
    },
    // 床の映り込みを描く（本描画の前に呼ぶ）。床の面で折り返したカメラから、床より上だけを描く
    renderReflection(renderer, scene, camera) {
      if (!refl) return;
      camera.updateMatrixWorld(true);
      camera.getWorldDirection(fwd); up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      vcam.position.set(camera.position.x, -camera.position.y, camera.position.z); vcam.up.set(up.x, -up.y, up.z);
      vcam.lookAt(vcam.position.x + fwd.x, vcam.position.y - fwd.y, vcam.position.z + fwd.z);
      vcam.near = camera.near; vcam.far = camera.far; vcam.projectionMatrix.copy(camera.projectionMatrix); vcam.projectionMatrixInverse.copy(camera.projectionMatrixInverse); vcam.updateMatrixWorld(true);
      texMat.set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1).multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse);
      const cp = renderer.clippingPlanes; floor.visible = false; G.uClip.value = 1; renderer.clippingPlanes = clipPlane;
      renderer.setRenderTarget(refl); renderer.autoClear = true; renderer.render(scene, vcam);
      renderer.setRenderTarget(null); floor.visible = true; G.uClip.value = 0; renderer.clippingPlanes = cp;
    },
  };
}
