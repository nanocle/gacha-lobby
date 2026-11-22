// ロビー画面を動画に書き出す。ヘッドレスの Chrome でページを開き、1コマずつ進めて撮り、ffmpeg で mp4 にする。
// 3D は __frame(1/30) で、UI の CSS アニメーションは時刻を直接指定して進めるので、実時間に関係なくコマ落ちしない。
// 使い方: node record.mjs [ポーズ] [秒数] [出力.mp4] [幅] [高さ]
//   例: node record.mjs lookback 60 out/lobby_lookback.mp4 1920 1080
// 先に serve.mjs（ロビーを開く.bat）でサーバーを起動しておく。開いた URL は自動で読む（LOBBY_URL で指定もできる）。
// キャラはロビーの設定どおり。別のキャラにするなら環境変数 CHARA=<フォルダ名>。ffmpeg と Google Chrome が必要（CHROME で場所を指定できる）。
// 顔アップは引きのあと（約13秒後）に始まるので、顔まで見るなら 15 秒以上撮る。
import {spawn} from 'node:child_process';
import {mkdirSync, rmSync, readFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';

const [pose = 'lookback', secs = '60', out = 'out/lobby_' + pose + '.mp4', W = '1920', H = '1080'] = process.argv.slice(2);
const FPS = 30, N = Math.round(+secs * FPS);
const PORT = await new Promise(ok => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });   // 空いている番号（同時に何本撮っても衝突しない）
const CHROME = process.env.CHROME ?? {win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe', darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}[process.platform] ?? 'google-chrome';
const serverInfo = (() => { try { return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.server.json'), 'utf8')); } catch { return null; } })();
const BASE = process.env.LOBBY_URL ?? serverInfo?.url ?? 'http://127.0.0.1:8777/';
const URL_ = `${BASE}lobby.html?rec=1&pose=${pose}&dpr=1` + (process.env.CHARA ? `&chara=${encodeURIComponent(process.env.CHARA)}` : '');
const profile = resolve(tmpdir(), `lobby-rec-${process.pid}`);
rmSync(profile, {recursive: true, force: true});

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`,
  '--hide-scrollbars', '--mute-audio', '--no-first-run', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), '--enable-gpu', '--ignore-gpu-blocklist', 'about:blank'], {stdio: 'ignore'});
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) { await sleep(200); try { const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = t.find(x => x.type === 'page'); if (p) ws = p.webSocketDebuggerUrl; } catch {} }
if (!ws) { chrome.kill(); throw new Error('Chrome に接続できません'); }
const sock = new WebSocket(ws); await new Promise(r => sock.addEventListener('open', r));
let id = 0; const wait = new Map();
sock.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { const [ok, ng] = wait.get(m.id); wait.delete(m.id); m.error ? ng(new Error(m.error.message)) : ok(m.result); } });
const cdp = (method, params = {}) => new Promise((ok, ng) => { const i = ++id; wait.set(i, [ok, ng]); sock.send(JSON.stringify({id: i, method, params})); });
const js = async (expr) => { const r = await cdp('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true}); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };

try {
  await cdp('Emulation.setDeviceMetricsOverride', {width: +W, height: +H, deviceScaleFactor: 1, mobile: false});
  await cdp('Page.navigate', {url: URL_});
  for (let i = 0; i < 600; i++) { await sleep(250); const s = await js('({ready: !!window.__ready, err: window.__error ?? null})').catch(() => ({})); if (s.err) throw new Error(s.err); if (s.ready) break; if (i === 599) throw new Error('読み込みが終わりません'); }
  console.log('GPU:', await js(`(() => { const g = document.getElementById('view').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })()`));
  console.log('assets:', JSON.stringify(await js('window.__assets')));
  // 読み込み画面を消し、CSS アニメーションを録画の時刻で動かす準備
  await js(`(() => { document.getElementById('loading').style.display = 'none'; window.__recT = 0; const seen = new Map();
    window.__recStep = () => { __frame(1 / ${FPS}); __recT += 1 / ${FPS};
      for (const a of document.getAnimations()) { if (!seen.has(a)) seen.set(a, __recT - (a.currentTime ?? 0) / 1000); a.pause(); a.currentTime = Math.max(0, (__recT - seen.get(a)) * 1000); } };
    __setPose(${JSON.stringify(pose)}, true); for (let i = 0; i < 3; i++) __recStep(); __recT = 0; return 1; })()`);
  mkdirSync(dirname(resolve(out)), {recursive: true});
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', resolve(out)], {stdio: ['pipe', 'inherit', 'inherit']});
  const t0 = Date.now();
  for (let f = 0; f < N; f++) {
    await js('__recStep(), 1');
    const {data} = await cdp('Page.captureScreenshot', {format: 'jpeg', quality: 95, captureBeyondViewport: false});
    if (!ff.stdin.write(Buffer.from(data, 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 150 === 0) console.log(`${f}/${N} コマ（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r));
  console.log('書き出し:', resolve(out), `${N} コマ、${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
} finally { sock.close(); chrome.kill(); setTimeout(() => rmSync(profile, {recursive: true, force: true}), 1500); }
