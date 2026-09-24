import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const exec = promisify(execFile);
export async function git(root, args) {
  return (await exec('git', ['-c', 'core.quotePath=false', ...args], { cwd: root, windowsHide: true, maxBuffer: 24 * 1024 * 1024, timeout: 30000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })).stdout;
}
const excluded = /(^|\/)(node_modules|\.git|\.codex|\.vscode|\.next[^/]*|bin|obj|artifacts|data|coverage|test-results|playwright-report)(\/|$)/i;
const sensitive = /(^|\/)(\.env[^/]*|appsettings[^/]*\.json|launchSettings\.json|[^/]*(secret|credential|password)[^/]*|id_rsa|id_ed25519|\.npmrc|nuget\.config)$/i;
const extensions = new Set(['.md', '.txt', '.json', '.cs', '.csproj', '.sln', '.slnx', '.props', '.targets', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.html', '.yml', '.yaml', '.ps1', '.sql', '.sh', '.xml', '.toml', '.gitignore', '.gitattributes']);
export function allowed(relative) {
  return typeof relative === 'string' && relative.length < 500 && !relative.includes('\\') && !relative.includes(':') && !relative.includes('\0') && !relative.startsWith('/') && !relative.split('/').some(p => p === '..' || p === '.' || !p) && !excluded.test(relative) && !sensitive.test(relative) && (extensions.has(path.extname(relative).toLowerCase()) || ['.gitignore', '.gitattributes'].includes(path.basename(relative)));
}
export async function readSource(root, relative) {
  if (!allowed(relative)) throw new Error('This path is outside the permitted source files.');
  const base = await fs.realpath(root);
  const target = path.resolve(base, relative);
  const real = await fs.realpath(target);
  const resolved = path.relative(base, real);
  if (resolved.startsWith('..') || path.isAbsolute(resolved) || real !== target) throw new Error('Linked or escaped paths are not permitted.');
  const stat = await fs.stat(real);
  if (!stat.isFile() || stat.size > 750000) throw new Error('File is not readable text or exceeds 750 KB.');
  const content = await fs.readFile(real, 'utf8');
  if (content.includes('\0')) throw new Error('Binary files are not supported.');
  return content;
}
export async function inventory(root) {
  const files = (await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).split('\0').filter(Boolean);
  return [...new Set(files)].filter(allowed).sort();
}
export async function baseline(root) {
  const [commit, branch, changes] = await Promise.all([
    git(root, ['rev-parse', 'HEAD']), git(root, ['branch', '--show-current']), git(root, ['status', '--porcelain=v1', '-uall']),
  ]);
  return { commit: commit.trim(), branch: branch.trim() || '(detached)', dirty: Boolean(changes.trim()), changedFiles: changes.trim() ? changes.trimEnd().split('\n').length : 0 };
}
export async function scanRepository(root) {
  const [base, files] = await Promise.all([baseline(root), inventory(root)]);
  const groups = [
    { name: 'CRM', match: /Nexora\.Modules\.(Crm|Membership)|features\/(crm|membership)/ },
    { name: 'Portal', match: /[Pp]ortal|features\/portal/ },
    { name: 'Website / CMS', match: /Nexora\.Modules\.Content|features\/content|\/site\// },
    { name: 'Platform', match: /BuildingBlocks|Nexora\.Modules\.(Identity|Work)|Nexora\.(Api|Worker)\// },
  ].map(g => ({ name: g.name, files: files.filter(f => g.match.test(f)).length }));
  const docs = files.filter(f => f.endsWith('.md') && (f.startsWith('docs/') || f === 'README.md' || f === 'AGENTS.md'));
  return { ...base, path: root, scannedAt: new Date().toISOString(), fileCount: files.length, groups, docs, files };
}
export async function createSnapshot(source, destination) {
  const initial = await baseline(source);
  const files = await inventory(source);
  await fs.mkdir(destination, { recursive: true });
  const hash = createHash('sha256');
  let count = 0, total = 0;
  const omitted = [];
  for (const file of files) {
    let content;
    try { content = await readSource(source, file); } catch (error) { omitted.push(`${file}: ${error.message}`); continue; }
    total += Buffer.byteLength(content);
    if (total > 120 * 1024 * 1024) throw new Error('Source snapshot exceeds 120 MB.');
    hash.update(file).update('\0').update(content).update('\0');
    await fs.mkdir(path.dirname(path.join(destination, file)), { recursive: true });
    await fs.writeFile(path.join(destination, file), content);
    count++;
  }
  await git(destination, ['init', '-q']);
  await git(destination, ['add', '-A']);
  await git(destination, ['-c', 'user.name=Command Center', '-c', 'user.email=local@command-center.invalid', '-c', 'core.hooksPath=', 'commit', '-qm', 'Isolated source baseline', '--no-verify']);
  return { ...initial, snapshotHash: hash.digest('hex'), capturedFiles: count, omitted, capturedAt: new Date().toISOString(), note: 'Filtered source copy, including current uncommitted source. Secrets, runtime configuration, dependencies and build outputs excluded. Copy is not an atomic filesystem snapshot.' };
}
