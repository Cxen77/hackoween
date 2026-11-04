// One command to run the whole project: the model server (Python, port 8765) and the website (Vite).
//   npm run dev:all
// If a model server is already answering on 8765 it is reused, not started twice.
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const isWin = process.platform === 'win32';
const python = process.env.PYTHON || (isWin ? 'python' : 'python3');
const children = [];

const health = async () => {
  try {
    const r = await fetch('http://127.0.0.1:8765/api/health', { signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
};
// The newest model file the server would load if started fresh (mirrors server/model_api.py).
const wantedModel = existsSync('data/experiments/basinshift_model/models_daily.joblib') ? 'models_daily.joblib' : 'models_caravan.joblib';
const stopOldServer = () => {
  try {
    if (isWin) execSync('powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8765 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"', { stdio: 'ignore' });
    else execSync("lsof -ti tcp:8765 | xargs -r kill", { stdio: 'ignore', shell: '/bin/sh' });
  } catch { /* nothing to stop, or not allowed */ }
};
const start = (cmd, args, label) => {
  const p = spawn(cmd, args, { stdio: 'inherit', shell: isWin });
  p.on('error', e => console.error(`[${label}] could not start: ${e.message}`));
  p.on('exit', code => { if (code) console.error(`[${label}] exited with code ${code}`); });
  children.push(p);
  return p;
};
const stopAll = () => { for (const c of children) { try { c.kill(); } catch { /* already gone */ } } process.exit(0); };
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

let h = await health();
if (h && h.model !== wantedModel) {
  console.log(`[model] a server on 8765 is serving ${h.model} but ${wantedModel} is newer; restarting it`);
  stopOldServer();
  await new Promise(r => setTimeout(r, 1500));
  h = await health();
  if (h) {
    console.error(`[model] could not stop the old server (it still serves ${h.model}). Stop it yourself (close its terminal) and run this again.`);
    process.exit(1);
  }
}
if (h) {
  console.log(`[model] server already running on http://127.0.0.1:8765 (${h.model}), reusing it`);
} else {
  console.log(`[model] starting: ${python} -m server.model_api  (needs: pip install -r requirements.txt -r requirements-advanced.txt)`);
  start(python, ['-m', 'server.model_api'], 'model');
}
start('npx', ['vite', '--host', '0.0.0.0'], 'site');
