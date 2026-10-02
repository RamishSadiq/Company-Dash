import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Store, now } from './store.mjs';
import { agents, areas, suites } from './catalog.mjs';
import { Runner, providerStatus } from './runner.mjs';
import { readSource, scanRepository } from './repository.mjs';
import { integrationPreview, integrate } from './proposals.mjs';
import { backupData, cleanupData, retentionPlan } from './maintenance.mjs';
import { budgetState } from './usage.mjs';

function text(value, label, max = 12000) { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} is required (maximum ${max} characters).`); return value.trim(); }
function choice(value, list, label) { if (!list.includes(value)) throw new Error(`Invalid ${label}.`); return value; }
async function body(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new Error('JSON content type is required.');
  let value = '';
  for await (const chunk of req) { value += chunk; if (Buffer.byteLength(value) > 64000) throw new Error('Request is too large.'); }
  const result = JSON.parse(value || '{}');
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Expected a JSON object.');
  return result;
}
export function createApp(config) {
  const store = new Store(config.dataDir), runner = new Runner(store, config);
  const token = randomBytes(32).toString('hex');
  let scan = null, scanError = null, scanning = null;
  let provider = { available: false, detail: 'Checking Codex CLI…' };
  let maintenance = false;
  async function exclusive(work) {
    if (maintenance || runner.active || store.get("SELECT id FROM runs WHERE status IN ('queued','running')")) throw new Error('Wait for active/queued runs before maintenance or integration.');
    maintenance = true;
    try { return await work(); } finally { maintenance = false; }
  }
  const retentionTimer = config.retentionDays ? setInterval(() => exclusive(() => cleanupData(store, config)).catch(error => store.event(null,'maintenance.deferred',error.message)), 86400000) : null;
  retentionTimer?.unref();
  const refresh = async () => {
    if (scanning) return scanning;
    scanning = scanRepository(config.repoPath).then(result => { scan = result; scanError = null; return result; }).catch(error => { scanError = error.message; throw error; }).finally(() => { scanning = null; });
    return scanning;
  };
  const ready = Promise.allSettled([refresh(), providerStatus(config).then(value => { provider = value; })]);
  function task(key) { const value = store.get('SELECT * FROM tasks WHERE id=?', key); if (!value) throw new Error('Task not found.'); return value; }
  const server = http.createServer(async (req, res) => {
    const respond = (status, data, type = 'application/json; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type }); res.end(type.startsWith('application/json') ? JSON.stringify(data) : data); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const host = req.headers.host;
      const port = server.address()?.port;
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) return respond(403, { error: 'Local access only.' });
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return respond(403, { error: 'Cross-origin requests are not permitted.' });
      if (req.headers['sec-fetch-site'] === 'cross-site') return respond(403, { error: 'Cross-site requests are not permitted.' });
      const url = new URL(req.url, `http://${host}`), route = url.pathname;
      if (req.method === 'GET' && route === '/api/session') return respond(200, { token });
      if (route.startsWith('/api/')) {
        const supplied = Buffer.from(req.headers['x-command-token'] || '');
        if (supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) return respond(401, { error: 'Refresh the page to reconnect your local session.' });
        if (maintenance && req.method !== 'GET') throw new Error('Maintenance is in progress. Retry shortly.');
        if (req.method === 'GET' && route === '/api/state') return respond(200, {
          agents, areas, suites: suites.map(({ args, kind, timeout, ...suite }) => suite),
          repository: scan ? { ...scan, files: undefined } : null, repositoryError: scanError, provider,
          tasks: store.all('SELECT * FROM tasks ORDER BY created_at DESC'),
          runs: store.all('SELECT id,task_id,target_task,source_hash,usage,kind,label,status,command,baseline,exit_code,error,created_at,started_at,ended_at FROM runs ORDER BY created_at DESC LIMIT 200'),
          events: store.all('SELECT * FROM events ORDER BY id DESC LIMIT 60'),
          artifacts: store.all('SELECT id,task_id,run_id,name,kind,created_at FROM artifacts ORDER BY created_at DESC LIMIT 200'),
          config: { repoPath: config.repoPath, mode: 'Local single-user', agentTimeoutMinutes: config.agentTimeoutMinutes, sqlServer: config.sqlServer, retentionDays: config.retentionDays || 0 },
          usage: budgetState(store, config),
        });
        if (req.method === 'POST' && route === '/api/repository/scan') { const result = await refresh(); store.event(null, 'repository.scanned', `${result.fileCount} source files indexed at ${result.commit.slice(0,7)}.`); return respond(200, result); }
        if (req.method === 'GET' && route === '/api/repository/files') return respond(200, { files: (scan?.files || []).filter(f => f.toLowerCase().includes((url.searchParams.get('q') || '').toLowerCase())).slice(0, 300) });
        if (req.method === 'GET' && route === '/api/repository/file') return respond(200, { path: url.searchParams.get('path'), content: await readSource(config.repoPath, url.searchParams.get('path')) });
        if (req.method === 'POST' && route === '/api/provider/check') { provider = await providerStatus(config); return respond(200, provider); }
        if (req.method === 'POST' && route === '/api/tasks') {
          const data = await body(req);
          const input = { title: text(data.title, 'Title', 160), description: text(data.description, 'Request'), agent: choice(data.agent, agents.map(a => a.id), 'agent'), area: choice(data.area, areas, 'area'), priority: choice(data.priority || 'normal', ['low','normal','high','urgent'], 'priority') };
          const result = store.transaction(() => {
            const root = store.task(input);
            if (data.workflow === true && ['pm', 'ba', 'support'].includes(input.agent)) {
              let previous = root;
              const order = ['pm', 'support'].includes(input.agent) ? ['ba', data.area === 'Portal' || data.area === 'Website / CMS' ? 'portal_dev' : 'crm_dev', 'qa'] : [data.area === 'Portal' || data.area === 'Website / CMS' ? 'portal_dev' : 'crm_dev', 'qa'];
              for (const agent of order) previous = store.task({ ...input, title: `${agent === 'ba' ? 'Specify' : agent === 'qa' ? 'Verify' : 'Implement'}: ${input.title}`, agent, parent_id: root.id, depends_on: previous.id, status: 'blocked' });
              store.event(root.id, 'workflow.created', 'A standard maintenance workflow was created. Each accepted handoff unlocks the next role; execution is started explicitly.');
            }
            return root;
          });
          return respond(201, result);
        }
        const match = route.match(/^\/api\/tasks\/([^/]+)(?:\/(messages|run|accept|cancel))?$/);
        if (match) {
          const current = task(match[1]), action = match[2];
          if (req.method === 'GET' && !action) return respond(200, { ...current, messages: store.all('SELECT * FROM messages WHERE task_id=? ORDER BY created_at', current.id), artifacts: store.all('SELECT * FROM artifacts WHERE task_id=? ORDER BY created_at DESC', current.id), runs: store.all('SELECT * FROM runs WHERE task_id=? OR target_task=? ORDER BY created_at DESC', current.id, current.id) });
          if (req.method === 'POST' && action === 'messages') {
            if (['running','queued','completed','cancelled'].includes(current.status)) throw new Error('Add a follow-up when this task is ready, blocked, or awaiting review.');
            const data = await body(req); store.message(current.id, 'user', text(data.content, 'Message'));
            if (current.status === 'review') store.run("UPDATE tasks SET status='ready',updated_at=? WHERE id=?", now(), current.id);
            store.event(current.id, 'task.message', 'A follow-up was added.'); return respond(201, { ok: true });
          }
          if (req.method === 'POST' && action === 'run') {
            if (!provider.available) throw new Error(provider.detail);
            return respond(202, runner.enqueue({ task: current }));
          }
          if (req.method === 'POST' && action === 'accept') {
            if (current.status !== 'review') throw new Error('Only a task with a successful agent report can be accepted.');
            store.transaction(() => {
              store.run("UPDATE tasks SET status='completed',updated_at=? WHERE id=?", now(), current.id);
              store.run("UPDATE tasks SET status='ready',updated_at=? WHERE depends_on=? AND status='blocked'", now(), current.id);
              store.event(current.id, 'handoff.accepted', 'Report accepted for handoff. This does not merge code, certify QA or deploy Nexora.');
            }); return respond(200, { ok: true });
          }
          if (req.method === 'POST' && action === 'cancel') {
            if (['running','queued'].includes(current.status)) throw new Error('Stop the active run before closing its task.');
            if (current.status === 'completed') throw new Error('An accepted handoff cannot be cancelled.');
            store.run("UPDATE tasks SET status='cancelled',updated_at=? WHERE id=?", now(), current.id);
            store.event(current.id, 'task.cancelled', 'Task cancelled; dependent work stays blocked.'); return respond(200, { ok: true });
          }
        }
        if (req.method === 'POST' && route === '/api/qa/run') {
          const data = await body(req), suite = suites.find(s => s.id === data.suite);
          if (!suite) throw new Error('Unknown QA suite.');
          if (store.get("SELECT id FROM runs WHERE kind='qa' AND label=? AND status IN ('queued','running')", suite.id)) throw new Error('This suite is already queued or running.');
          const targetTask = data.taskId ? task(data.taskId) : null;
          if (targetTask && !['review','completed'].includes(targetTask.status)) throw new Error('Complete the agent proposal before running its QA.');
          return respond(202, runner.enqueue({ suite, targetTask }));
        }
        if (req.method === 'POST' && route === '/api/integration/preview') { const data = await body(req); return respond(200, await exclusive(() => integrationPreview(store, config, text(data.taskId,'Task',100)))); }
        if (req.method === 'POST' && route === '/api/integration/apply') { const data = await body(req); return respond(200, await exclusive(() => integrate(store, config, data.key))); }
        if (req.method === 'POST' && route === '/api/maintenance/backup') return respond(200, await exclusive(() => backupData(store, config)));
        if (req.method === 'GET' && route === '/api/maintenance/preview') return respond(200, { entries: await retentionPlan(store, config) });
        if (req.method === 'POST' && route === '/api/maintenance/cleanup') return respond(200, await exclusive(() => cleanupData(store, config)));
        const runMatch = route.match(/^\/api\/runs\/([^/]+)(\/cancel)?$/);
        if (runMatch) {
          if (req.method === 'POST' && runMatch[2]) return respond(200, runner.cancel(runMatch[1]));
          const result = store.get('SELECT * FROM runs WHERE id=?', runMatch[1]);
          if (req.method === 'GET' && result) return respond(200, result);
        }
        const artifactMatch = route.match(/^\/api\/artifacts\/([^/]+)$/);
        if (req.method === 'GET' && artifactMatch) {
          const result = store.get('SELECT * FROM artifacts WHERE id=?', artifactMatch[1]);
          if (result) return respond(200, result);
        }
        return respond(404, { error: 'Not found.' });
      }
      const assets = { '/': ['index.html','text/html; charset=utf-8'], '/app.js': ['app.js','text/javascript; charset=utf-8'], '/styles.css': ['styles.css','text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg','image/svg+xml'] };
      if (req.method !== 'GET' || !assets[route]) return respond(404, { error: 'Not found.' });
      const [filename, mime] = assets[route]; respond(200, await fs.readFile(path.join(config.root, 'public', filename)), mime);
    } catch (error) { respond(400, { error: error.message }); }
  });
  return { server, store, runner, ready, close: async () => { if (retentionTimer) clearInterval(retentionTimer); await runner.shutdown(); while (maintenance) await new Promise(r => setTimeout(r,50)); await new Promise(resolve => server.close(resolve)); store.close(); } };
}
