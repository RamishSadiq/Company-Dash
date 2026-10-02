import { restoreBackup } from './maintenance.mjs';
const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('Usage: node server/restore.mjs <backup-directory> <new-data-directory>');
console.log(JSON.stringify(await restoreBackup(source, destination), null, 2));
