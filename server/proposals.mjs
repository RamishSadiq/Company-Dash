import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { allowed, git, createSnapshot, sourceFingerprint } from './repository.mjs';

export async function workspace(config, task) {
  if (!task?.workspace) throw new Error('This task has no proposal workspace.');
  const base = await fs.realpath(path.join(config.dataDir, 'workspaces'));
  const actual = await fs.realpath(task.workspace);
  if (path.dirname(actual) !== base || path.resolve(task.workspace) !== actual) throw new Error('Proposal workspace is outside the managed directory.');
  return actual;
}

export async function proposalReview(store, config, taskId) {
  const task = store.get('SELECT * FROM tasks WHERE id=?', taskId);
  if (!task || !['review','completed'].includes(task.status)) throw new Error('Finish and review the agent proposal first.');
  const cwd = await workspace(config, task);
  const latest = store.get("SELECT * FROM runs WHERE task_id=? AND kind='agent' ORDER BY created_at DESC,id DESC LIMIT 1", taskId);
  if (latest?.status !== 'succeeded') throw new Error('The latest agent run has not succeeded.');
  const artifact = store.get("SELECT * FROM artifacts WHERE run_id=? AND kind='patch'", latest.id);
  if (!artifact) throw new Error('There is no proposed patch to integrate.');
  const changed = (await git(cwd, ['diff','--name-only','-z','HEAD'])).split('\0').filter(Boolean);
  if (!changed.length || changed.some(f => !allowed(f))) throw new Error('Proposal contains excluded paths or no changes.');
  const fingerprint = await sourceFingerprint(cwd);
  const evidence = store.all("SELECT id,label,source_hash FROM runs WHERE kind='qa' AND target_task=? AND status='succeeded' ORDER BY created_at DESC", taskId).filter(r => r.source_hash === fingerprint);
  if (!evidence.length) throw new Error('Run proposal QA on this exact source before integration.');
  const currentPatch = await git(cwd, ['diff','HEAD','--no-ext-diff','--no-textconv','--binary']);
  if (currentPatch !== artifact.content) throw new Error('Proposal changed after its report. Run the agent and review its new patch.');
  let first = task;
  while (first.depends_on) {
    first = store.get('SELECT * FROM tasks WHERE id=?', first.depends_on);
    if (!first || first.status !== 'completed') throw new Error('Accept all preceding handoffs first.');
  }
  const original = store.get('SELECT baseline FROM runs WHERE task_id=? AND baseline IS NOT NULL ORDER BY created_at,id LIMIT 1', first.id);
  const origin = original && JSON.parse(original.baseline).snapshotHash;
  const checkoutHash = await sourceFingerprint(config.repoPath);
  if (!origin || checkoutHash !== origin) throw new Error('Nexora source changed since this workflow began. Refresh the proposal against the new checkout before integration.');
  return { taskId, changed, fingerprint, checkoutHash, patchHash: createHash('sha256').update(currentPatch).digest('hex'), evidence, patch: currentPatch };
}

export async function integrationPreview(store, config, taskId) {
  const review = await proposalReview(store, config, taskId);
  const key = randomUUID();
  const candidate = path.join(config.dataDir, 'integration', key);
  await createSnapshot(config.repoPath, candidate);
  const patchFile = path.join(config.dataDir, 'integration', `${key}.patch`);
  await fs.writeFile(patchFile, review.patch);
  await git(candidate, ['apply','--check',patchFile]);
  await git(candidate, ['apply',patchFile]);
  const value = { ...review, patch: undefined, key, candidate, patchFile, expires: Date.now() + 15 * 60000 };
  store.run('INSERT INTO meta(key,value) VALUES(?,?)', `integration:${key}`, JSON.stringify(value));
  store.event(taskId, 'integration.preview', `Prepared a review copy with ${review.changed.length} changed file(s). Original checkout unchanged.`);
  return { ...value, patch: review.patch };
}

export async function integrate(store, config, key) {
  if (typeof key !== 'string' || !/^[0-9a-f-]{36}$/.test(key)) throw new Error('Invalid integration review.');
  const saved = store.get('SELECT value FROM meta WHERE key=?', `integration:${key}`);
  if (!saved) throw new Error('Review missing or already applied.');
  const preview = JSON.parse(saved.value);
  if (Date.now() > preview.expires) throw new Error('Review expired. Prepare a new preview.');
  const fresh = await proposalReview(store, config, preview.taskId);
  if (fresh.patchHash !== preview.patchHash || fresh.fingerprint !== preview.fingerprint || fresh.checkoutHash !== preview.checkoutHash) throw new Error('Source changed after review. Prepare a new preview.');
  // Rewrite from the immutable database artifact, never trust a file edited by another local process.
  await fs.writeFile(preview.patchFile, fresh.patch);
  await git(config.repoPath, ['apply','--check',preview.patchFile]);
  await git(config.repoPath, ['apply',preview.patchFile]);
  store.run('DELETE FROM meta WHERE key=?', `integration:${key}`);
  store.event(preview.taskId, 'integration.applied', `${fresh.changed.length} reviewed file(s) applied locally. No commit, push or deployment.`);
  return { applied: fresh.changed, note: 'Changes are uncommitted. Run checkout QA to verify the integrated checkout.' };
}
