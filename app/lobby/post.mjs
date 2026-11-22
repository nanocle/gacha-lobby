// ロビー画面用の後処理: 被写界深度（ぼけ）→ にじみ → 周辺減光・粒子・フェード。
// にじみ: しきい値より明るい所だけを段階的にぼかして足す。
import * as THREE from 'three';

const VERT = `varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position.xy,0.,1.);}`;

// ぼけ: 画素ごとに「ピント面からのずれ」を半径にして、まわりを渦巻き状に集める
const DOF = `
uniform sampler2D tSrc,tDepth; uniform vec2 uTexel; uniform float uNear,uFar,uFocus,uAperture,uMaxBlur;
varying vec2 vUv;
float dist(vec2 uv){float z=texture2D(tDepth,uv).r*2.-1.;return 2.*uNear*uFar/(uFar+uNear-z*(uFar-uNear));}
float coc(float d){return clamp((1./uFocus-1./d)*uAperture,-1.,1.)*uMaxBlur;}   // 画素数。マイナスは手前ぼけ
void main(){
  float d0=dist(vUv),c0=coc(d0),r0=abs(c0);
  vec3 sum=texture2D(tSrc,vUv).rgb; float wsum=1.;
  const float N=44.; float ga=2.39996323;
  for(float i=1.;i<=N;i++){
    float r=sqrt(i/N)*uMaxBlur; vec2 o=vec2(cos(i*ga),sin(i*ga))*r*uTexel; vec2 uv=vUv+o;
    float d=dist(uv),c=abs(coc(d));
    if(d>d0)c=min(c,r0*2.);                        // 奥の物は、手前のくっきりした物の上へにじませない
    float w=smoothstep(r-.75,r+.75,c);
    vec3 s=texture2D(tSrc,uv).rgb; w*=1.+dot(s,vec3(.3333))*.6;   // 明るい点ほど玉ぼけとして残す
    sum+=s*w; wsum+=w;
  }
  gl_FragColor=vec4(sum/wsum,1.);
}`;

const FINAL = `
uniform sampler2D tScene,tBloom; uniform float uStrength,uFade,uVignette,uGrain,uTime,uAberration; uniform vec2 uRes; varying vec2 vUv;
float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
void main(){
  vec2 c=vUv-.5; float r2=dot(c,c);
  vec2 ab=c*r2*uAberration;                       // 画面の端だけ色がわずかにずれる
  vec3 col=vec3(texture2D(tScene,vUv+ab).r,texture2D(tScene,vUv).g,texture2D(tScene,vUv-ab).b);
  col+=texture2D(tBloom,vUv).rgb*uStrength;
  col*=1.-uVignette*smoothstep(.12,.75,r2*1.6);
  col=clamp(col,0.,1.);
  col=mix(col*12.92,1.055*pow(col,vec3(1./2.4))-.055,step(.0031308,col));
  col+=(hash(vUv*uRes+fract(uTime)*91.7)-.5)*uGrain;
  gl_FragColor=vec4(col*uFade,1.);
}`;

export class LobbyPost {
  constructor(renderer, {levels = 7} = {}) {
    this.r = renderer;
    this.bloomThreshold = 1.0; this.bloomStrength = 0.14;
    this.focus = 3; this.aperture = 0.6; this.maxBlur = 14; this.dof = true;   // aperture: 大きいほどピントの合う幅が狭い
    this.fade = 1; this.vignette = 0.38; this.grain = 0.035; this.aberration = 0.012; this.time = 0;
    const half = {type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false};
    this.scene = new THREE.WebGLRenderTarget(4, 4, {type: THREE.HalfFloatType, samples: 4});
    this.scene.depthTexture = new THREE.DepthTexture(4, 4, THREE.UnsignedIntType);
    this.scene.depthTexture.minFilter = this.scene.depthTexture.magFilter = THREE.NearestFilter;
    this.sharp = new THREE.WebGLRenderTarget(4, 4, half);
    this.mips = Array.from({length: levels}, () => new THREE.WebGLRenderTarget(4, 4, half));
    const mk = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, ...extra});
    const taps = `vec3 taps(float o){vec2 d=uTexel*o;return (texture2D(tSrc,vUv+d).rgb+texture2D(tSrc,vUv-d).rgb+texture2D(tSrc,vUv+vec2(d.x,-d.y)).rgb+texture2D(tSrc,vUv+vec2(-d.x,d.y)).rgb)*.25;}`;
    const head = `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv; ${taps}`;
    const tu = () => ({tSrc: {value: null}, uTexel: {value: new THREE.Vector2()}});
    this.mDof = mk(DOF, {...tu(), tDepth: {value: this.scene.depthTexture}, uNear: {value: .1}, uFar: {value: 100}, uFocus: {value: 3}, uAperture: {value: 1}, uMaxBlur: {value: 14}});
    this.mPre = mk(`${head} uniform float uThreshold; void main(){vec3 c=clamp(taps(.5),0.,40.);float b=max(c.r,max(c.g,c.b));vec3 o=c*max(b-uThreshold,0.)/max(b,1e-4);if(!(o.r+o.g+o.b<1e6))o=vec3(0.);gl_FragColor=vec4(o,1.);}`, {...tu(), uThreshold: {value: 1}});
    this.mDown = mk(`${head} void main(){gl_FragColor=vec4(taps(1.),1.);}`, tu());
    this.mUp = mk(`${head} void main(){gl_FragColor=vec4(taps(.75),1.);}`, tu(), {blending: THREE.AdditiveBlending, transparent: true});
    this.mFinal = mk(FINAL, {tScene: {value: null}, tBloom: {value: null}, uStrength: {value: 0}, uFade: {value: 1}, uVignette: {value: 0}, uGrain: {value: 0}, uTime: {value: 0}, uAberration: {value: 0}, uRes: {value: new THREE.Vector2()}});
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mPre); this.quad.frustumCulled = false;
    this.qs = new THREE.Scene(); this.qs.add(this.quad); this.qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  setSize() {
    const s = this.r.getDrawingBufferSize(new THREE.Vector2());
    this.scene.setSize(s.x, s.y); this.sharp.setSize(s.x, s.y); this.mFinal.uniforms.uRes.value.copy(s);
    let w = s.x, h = s.y;
    for (const m of this.mips) { w = Math.max(2, w >> 1); h = Math.max(2, h >> 1); m.setSize(w, h); }
  }
  pass(mat, src, dst) {
    mat.uniforms.tSrc.value = src.texture; mat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
    this.quad.material = mat; this.r.setRenderTarget(dst); this.r.render(this.qs, this.qc);
  }
  render(scene, camera) {
    const r = this.r;
    r.setRenderTarget(this.scene); r.autoClear = true; r.render(scene, camera);
    let src = this.scene;
    if (this.dof && this.maxBlur > 0.5) {
      const u = this.mDof.uniforms; u.uNear.value = camera.near; u.uFar.value = camera.far; u.uFocus.value = this.focus; u.uAperture.value = this.aperture;
      u.uMaxBlur.value = this.maxBlur * this.scene.height / 1080;
      this.pass(this.mDof, this.scene, this.sharp); src = this.sharp;
    }
    this.mPre.uniforms.uThreshold.value = this.bloomThreshold;
    this.pass(this.mPre, src, this.mips[0]);
    for (let i = 1; i < this.mips.length; i++) this.pass(this.mDown, this.mips[i - 1], this.mips[i]);
    r.autoClear = false;
    for (let i = this.mips.length - 2; i >= 0; i--) this.pass(this.mUp, this.mips[i + 1], this.mips[i]);
    r.autoClear = true;
    const f = this.mFinal.uniforms;
    f.tScene.value = src.texture; f.tBloom.value = this.mips[0].texture; f.uStrength.value = this.bloomStrength; f.uFade.value = this.fade;
    f.uVignette.value = this.vignette; f.uGrain.value = this.grain; f.uTime.value = this.time; f.uAberration.value = this.aberration;
    this.quad.material = this.mFinal; r.setRenderTarget(null); r.render(this.qs, this.qc);
  }
}
