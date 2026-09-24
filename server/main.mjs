import { config } from './config.mjs';
import { createApp } from './app.mjs';
import fs from 'node:fs';
import path from 'node:path';
fs.mkdirSync(config.dataDir, { recursive: true });
const lock = path.join(config.dataDir, 'server.lock');
try {
  if (fs.existsSync(lock)) {
    const owner = Number(fs.readFileSync(lock, 'utf8'));
    let alive = false;
    if (Number.isSafeInteger(owner) && owner > 0) { try { process.kill(owner, 0); alive = true; } catch (error) { if (error.code !== 'ESRCH') alive = true; } }
    if (alive) throw new Error(`Another command center owns this data directory (PID ${owner}).`);
    fs.unlinkSync(lock);
  }
  fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
} catch (error) { console.error(error.message); process.exit(1); }
process.on('exit', () => { try { if (fs.readFileSync(lock, 'utf8') === String(process.pid)) fs.unlinkSync(lock); } catch {} });
const app = createApp(config);
app.server.on('error', async error => { console.error(error.message); await app.runner.shutdown(); app.store.close(); process.exit(1); });
app.server.listen(config.port, '127.0.0.1', () => console.log(`Nexora Command Center: http://127.0.0.1:${config.port}`));
let closing = false;
async function shutdown() { if (closing) return; closing = true; await app.close(); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
