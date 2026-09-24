import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, 'config.local.json');
const settings = fs.existsSync(local) ? JSON.parse(fs.readFileSync(local, 'utf8')) : {};
export const config = {
  root, repoPath: path.resolve(process.env.NEXORA_REPO_PATH || settings.repoPath || 'D:/Projects new/Nexora'),
  dataDir: path.resolve(process.env.COMMAND_CENTER_DATA || path.join(root, 'data')),
  port: Number(process.env.PORT || settings.port || 8000),
  codexPath: process.env.CODEX_EXECUTABLE || settings.codexPath || 'codex',
  dotnetPath: settings.dotnetPath || 'dotnet',
  sqlServer: settings.sqlServer || '.\\SQLEXPRESS',
  agentTimeoutMinutes: settings.agentTimeoutMinutes || 20,
};
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Invalid port');
if (!Number.isFinite(config.agentTimeoutMinutes) || config.agentTimeoutMinutes < 1 || config.agentTimeoutMinutes > 60) throw new Error('Agent timeout must be 1–60 minutes');
if (/[;\r\n]/.test(config.sqlServer)) throw new Error('Invalid SQL Server instance');
