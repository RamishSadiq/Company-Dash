import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { usageParser } from './usage.mjs';

export const now = () => new Date().toISOString();
export const id = prefix => `${prefix}_${randomUUID()}`;
export class Store {
  constructor(directory) {
    fs.mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(path.join(directory, 'command-center.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, agent TEXT NOT NULL, area TEXT NOT NULL, priority TEXT NOT NULL, status TEXT NOT NULL, parent_id TEXT REFERENCES tasks(id), depends_on TEXT REFERENCES tasks(id), workspace TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id), kind TEXT NOT NULL, label TEXT NOT NULL, status TEXT NOT NULL, command TEXT, workspace TEXT, baseline TEXT, exit_code INTEGER, log TEXT NOT NULL DEFAULT '', error TEXT, created_at TEXT NOT NULL, started_at TEXT, ended_at TEXT);
      CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id), run_id TEXT REFERENCES runs(id), name TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, type TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_task_run ON runs(task_id) WHERE status IN ('queued','running');`);
    for (const [column, type] of [['target_task','TEXT'], ['source_hash','TEXT'], ['usage','TEXT']]) {
      if (!this.all('PRAGMA table_info(runs)').some(c => c.name === column)) this.db.exec(`ALTER TABLE runs ADD COLUMN ${column} ${type}`);
    }
    for (const run of this.all("SELECT id,log FROM runs WHERE kind='agent' AND usage IS NULL AND log LIKE '%turn.completed%'")) {
      usageParser(value => this.run('UPDATE runs SET usage=? WHERE id=?', JSON.stringify(value), run.id))(run.log + '\n');
    }
    const interrupted = this.all("SELECT * FROM runs WHERE status IN ('queued','running')");
    for (const run of interrupted) {
      this.run("UPDATE runs SET status='interrupted',error=?,ended_at=? WHERE id=?", 'Server restarted; inspect logs before retrying. This run did not pass.', now(), run.id);
      if (run.task_id) this.run("UPDATE tasks SET status='blocked',updated_at=? WHERE id=?", now(), run.task_id);
    }
    if (interrupted.length) this.event(null, 'recovery', `${interrupted.length} unfinished run(s) marked interrupted; nothing was silently rerun.`);
  }
  all(sql, ...args) { return this.db.prepare(sql).all(...args); }
  get(sql, ...args) { return this.db.prepare(sql).get(...args); }
  run(sql, ...args) { return this.db.prepare(sql).run(...args); }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  event(task, type, detail) { this.run('INSERT INTO events(task_id,type,detail,created_at) VALUES(?,?,?,?)', task, type, detail, now()); }
  message(task, role, content) { this.run('INSERT INTO messages VALUES(?,?,?,?,?)', id('msg'), task, role, content, now()); }
  artifact(task, run, name, kind, content) { const key = id('artifact'); this.run('INSERT INTO artifacts VALUES(?,?,?,?,?,?,?)', key, task, run, name, kind, content, now()); return key; }
  task(data) {
    const key = id('task');
    this.run('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', key, data.title, data.description, data.agent, data.area, data.priority, data.status || 'ready', data.parent_id || null, data.depends_on || null, null, now(), now());
    this.message(key, 'user', data.description);
    this.event(key, 'task.created', `${data.title} assigned to ${data.agent}.`);
    return this.get('SELECT * FROM tasks WHERE id=?', key);
  }
  close() { this.db.close(); }
}
