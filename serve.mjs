// ロビー画面を開くための小さなサーバー。app フォルダだけを 127.0.0.1 で配る。
//   node serve.mjs        （PORT で番号を変えられる。NO_OPEN=1 でブラウザを開かない）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {exec} from 'node:child_process';

// 実際に開いた URL をここに書く（tools/record.mjs が読む）。止めると消える
const INFO = path.join(path.dirname(fileURLToPath(import.meta.url)), '.server.json');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'app');
const TYPES = {'.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.vrm': 'model/gltf-binary', '.vrma': 'model/gltf-binary', '.txt': 'text/plain; charset=utf-8', '.glb': 'model/gltf-binary', '.css': 'text/css; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm', '.webp': 'image/webp'};

const server = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (rel === '/') rel = '/lobby.html';
  const file = path.join(ROOT, rel);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }       // フォルダの外は配らない
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache'});
    fs.createReadStream(file).pipe(res);
  });
});

let port = +(process.env.PORT || 8777), tries = 0;
server.on('error', e => {
  if (e.code === 'EADDRINUSE' && !process.env.PORT && tries++ < 20) server.listen(++port, '127.0.0.1');     // 使用中なら次の番号を試す
  else { console.error(e.message); process.exit(1); }
});
server.on('listening', () => {
  const url = `http://127.0.0.1:${port}/`;
  fs.writeFileSync(INFO, JSON.stringify({url, pid: process.pid}));
  if (tries) console.log(`※ 8777 番は使用中だったので ${port} 番で開きました。`);
  console.log('ロビー画面: ' + url + '\nこのウィンドウを閉じると止まります。');
  if (!process.env.NO_OPEN) exec(process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`);
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));
process.on('exit', () => { try { if (JSON.parse(fs.readFileSync(INFO, 'utf8')).pid === process.pid) fs.unlinkSync(INFO); } catch {} });
server.listen(port, '127.0.0.1');
