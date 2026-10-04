import fs from 'node:fs';
import path from 'node:path';

// Desktop updates replace the version directory underneath the managed bin root.
// Keep working configured paths, and never substitute an arbitrary executable.
export function resolveCodexPath(configured) {
  if (typeof configured !== 'string' || fs.existsSync(configured)) return configured;
  if (!/[\\/]OpenAI[\\/]Codex[\\/]bin[\\/][a-f0-9]{8,}[\\/]codex\.exe$/i.test(configured)) return configured;
  const directory = path.dirname(path.dirname(configured));
  try {
    const candidates = fs.readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && /^[a-f0-9]{8,}$/i.test(entry.name))
      .map(entry => path.join(directory, entry.name, 'codex.exe'))
      .map(candidate => ({ candidate, stat: fs.lstatSync(candidate, { throwIfNoEntry: false }) }))
      .filter(item => item.stat?.isFile() && !item.stat.isSymbolicLink())
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    return candidates[0]?.candidate || configured;
  } catch {
    return configured;
  }
}
