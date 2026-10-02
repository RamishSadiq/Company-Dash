import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';

const regenerable = /(^|[\\/])(node_modules|\.next[^\\/]*|bin|obj|artifacts|coverage|test-results|playwright-report)([\\/]|$)/i;

async function plainTree(directory, internalLinks = false, include = () => true) {
  const items = [];
  async function visit(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const item = path.join(current, entry.name);
      if (!include(item)) continue;
      if ((await fs.lstat(item)).isSymbolicLink()) {
        const actual = await fs.realpath(item);
        if (internalLinks && actual.startsWith(path.resolve(directory) + path.sep)) continue;
        throw new Error('Linked paths are not permitted in backups or cleanup.');
      }
      if (entry.isDirectory()) await visit(item);
      else if (entry.isFile()) items.push(item);
    }
  }
  await visit(directory); return items;
}
export async function backupData(store, config) {
  const backups = path.join(config.dataDir, 'backups');
  await fs.mkdir(backups, { recursive: true });
  if ((await fs.lstat(backups)).isSymbolicLink()) throw new Error('Backup directory must not be linked.');
  const key = `${new Date().toISOString().replaceAll(':','-')}-${randomUUID()}`;
  const destination = path.join(backups, key);
  await fs.mkdir(destination);
  store.db.exec(`VACUUM INTO '${path.join(destination, 'command-center.sqlite').replaceAll("'","''")}'`);
  for (const name of ['workspaces','outputs']) {
    const source = path.join(config.dataDir, name);
    if (!await fs.stat(source).catch(() => null)) continue;
    if ((await fs.lstat(source)).isSymbolicLink()) throw new Error('Managed data directory must not be linked.');
    const include = item => name !== 'workspaces' || !regenerable.test(path.relative(source, item));
    await plainTree(source, false, include);
    await fs.cp(source, path.join(destination, name), { recursive: true, force: false, errorOnExist: true, filter: include });
  }
  const files = {};
  for (const file of await plainTree(destination)) files[path.relative(destination, file).replaceAll('\\','/')] = createHash('sha256').update(await fs.readFile(file)).digest('hex');
  await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), files, note: 'Includes database, agent workspaces and reports. QA dependency copies, integration previews, server locks and other backups are regenerable and excluded.' }, null, 2));
  store.event(null, 'maintenance.backup', `Backup created: ${key}`);
  return { key, directory: destination, files: Object.keys(files).length };
}
export async function retentionPlan(store, config) {
  if (!config.retentionDays) return [];
  const cutoff = new Date(Date.now() - config.retentionDays * 86400000).toISOString();
  const tasks = store.all('SELECT * FROM tasks');
  const closed = t => ['completed','cancelled'].includes(t.status) && t.updated_at < cutoff;
  const descendantsClosed = t => tasks.filter(c => c.depends_on === t.id).every(c => closed(c) && descendantsClosed(c));
  const entries = [];
  for (const task of tasks.filter(t => t.workspace && closed(t) && descendantsClosed(t))) entries.push({ kind: 'workspaces', path: task.workspace, taskId: task.id });
  // Only finished, old QA copies; never remove a running/queued check.
  for (const run of store.all("SELECT id,workspace FROM runs WHERE kind='qa' AND target_task IS NOT NULL AND status NOT IN ('queued','running') AND ended_at < ?", cutoff)) if (run.workspace) entries.push({ kind: 'verification', path: run.workspace, runId: run.id });
  for (const item of entries) {
    const base = path.resolve(config.dataDir, item.kind), target = path.resolve(item.path);
    if (path.dirname(target) !== base) throw new Error('Refusing cleanup outside the managed directory.');
    if (!await fs.stat(target).catch(() => null)) continue;
    if (await fs.realpath(base) !== base || await fs.realpath(target) !== target || (await fs.lstat(target)).isSymbolicLink()) throw new Error('Refusing linked cleanup target.');
    await plainTree(target, item.kind === 'verification');
  }
  return entries;
}
export async function cleanupData(store, config) {
  const plan = await retentionPlan(store, config);
  if (!plan.length) return { removed: 0 };
  const backup = await backupData(store, config);
  for (const entry of plan) {
    // Paths were resolved and constrained above. Never delete history or original source.
    await fs.rm(path.resolve(entry.path), { recursive: true, force: true });
    if (entry.taskId) store.run('UPDATE tasks SET workspace=NULL WHERE id=?', entry.taskId);
    if (entry.runId) store.run('UPDATE runs SET workspace=NULL WHERE id=?', entry.runId);
  }
  store.event(null, 'maintenance.cleanup', `Removed ${plan.length} expired workspace copies after backup ${backup.key}; task/run/report history retained.`);
  return { removed: plan.length, backup };
}
export async function restoreBackup(source, destination) {
  const from = await fs.realpath(source), target = path.resolve(destination);
  if (target === from || target.startsWith(from + path.sep)) throw new Error('Restore target must be outside the backup.');
  if (await fs.stat(target).catch(() => null)) throw new Error('Restore target must not exist.');
  const manifest = JSON.parse(await fs.readFile(path.join(from,'manifest.json'),'utf8'));
  for (const [relative, expected] of Object.entries(manifest.files)) {
    if (relative.includes('\\') || relative.includes(':') || relative.split('/').some(p => !p || p === '.' || p === '..') || path.isAbsolute(relative)) throw new Error('Invalid backup path.');
    const file = path.resolve(from,relative);
    if (await fs.realpath(file) !== file) throw new Error('Linked backup path.');
    if (createHash('sha256').update(await fs.readFile(file)).digest('hex') !== expected) throw new Error(`Backup checksum mismatch: ${relative}`);
  }
  const db = new DatabaseSync(path.join(from,'command-center.sqlite'), { readOnly:true });
  try { if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup database failed integrity check.'); } finally { db.close(); }
  await fs.mkdir(target, { recursive: true });
  for (const relative of Object.keys(manifest.files)) { await fs.mkdir(path.dirname(path.join(target,relative)), { recursive:true }); await fs.copyFile(path.join(from,relative),path.join(target,relative)); }
  const restored = new DatabaseSync(path.join(target,'command-center.sqlite'));
  try {
    for (const task of restored.prepare('SELECT id,workspace FROM tasks WHERE workspace IS NOT NULL').all()) {
      const next = path.join(target,'workspaces',path.basename(task.workspace));
      restored.prepare('UPDATE tasks SET workspace=? WHERE id=?').run(await fs.stat(next).catch(() => null) ? next : null, task.id);
    }
    restored.prepare("DELETE FROM meta WHERE key LIKE 'integration:%'").run();
    restored.prepare("UPDATE runs SET workspace=NULL WHERE target_task IS NOT NULL").run();
  } finally { restored.close(); }
  return { directory:target, verifiedFiles:Object.keys(manifest.files).length };
}
