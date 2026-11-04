// One command to run the whole project: the model server (Python, port 8765) and the website (Vite).
//   npm run dev:all
// If a model server is already answering on 8765 it is reused, not started twice.
import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const python = process.env.PYTHON || (isWin ? 'python' : 'python3');
const children = [];

const alive = async () => {
  try { return (await fetch('http://127.0.0.1:8765/api/health', { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
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

if (await alive()) {
  console.log('[model] server already running on http://127.0.0.1:8765, reusing it');
} else {
  console.log(`[model] starting: ${python} -m server.model_api  (needs: pip install -r requirements.txt -r requirements-advanced.txt)`);
  start(python, ['-m', 'server.model_api'], 'model');
}
start('npx', ['vite', '--host', '0.0.0.0'], 'site');
