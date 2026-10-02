import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.mjs';
import { git, createSnapshot, sourceFingerprint } from '../server/repository.mjs';
import { integrationPreview, integrate } from '../server/proposals.mjs';
import { backupData, restoreBackup, retentionPlan, cleanupData } from '../server/maintenance.mjs';
import { usageParser, usageTotal, estimateCost, checkBudget } from '../server/usage.mjs';
import { Runner } from '../server/runner.mjs';
import { root } from '../server/config.mjs';
import { suites } from '../server/catalog.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'company-operations-'));
  const repoPath=path.join(directory,'repo'),dataDir=path.join(directory,'data');
  await fs.mkdir(repoPath);await fs.writeFile(path.join(repoPath,'README.md'),'original\n');
  await git(repoPath,['init','-q']);await git(repoPath,['add','.']);await git(repoPath,['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','baseline']);
  const store=new Store(dataDir),config={root,repoPath,dataDir,codexPath:'fixture',dotnetPath:'fixture',agentTimeoutMinutes:1,sqlServer:'.\\SQLEXPRESS',retentionDays:7};
  t.after(async()=>{store.close();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(directory).startsWith('company-operations-'));await fs.rm(directory,{recursive:true,force:true});});
  const task=store.task({title:'Fix documentation',description:'Clarify documentation',agent:'crm_dev',area:'CRM',priority:'normal'});
  const workspace=path.join(dataDir,'workspaces','run_original');
  const baseline=await createSnapshot(repoPath,workspace);
  store.run("UPDATE tasks SET workspace=?,status='review' WHERE id=?",workspace,task.id);
  store.run("INSERT INTO runs(id,task_id,kind,label,status,baseline,created_at) VALUES('run_original',?,'agent','crm_dev','succeeded',?,?)",task.id,JSON.stringify(baseline),new Date().toISOString());
  await fs.writeFile(path.join(workspace,'README.md'),'improved\n');await git(workspace,['add','-A']);
  const patch=await git(workspace,['diff','--cached','--no-ext-diff','--no-textconv','--binary']);
  store.artifact(task.id,'run_original','Proposed changes.patch','patch',patch);
  return {directory,store,config,task,workspace};
}
async function evidence(f) {
  f.store.run("INSERT INTO runs(id,kind,label,status,target_task,source_hash,created_at) VALUES('run_qa','qa','architecture','succeeded',?,?,?)",f.task.id,await sourceFingerprint(f.workspace),new Date().toISOString());
}
test('integration requires exact proposal QA, rejects stale checkout, and applies only reviewed patch',async t=>{
  const f=await fixture(t);
  await assert.rejects(integrationPreview(f.store,f.config,f.task.id),/exact source/);
  await evidence(f);
  const review=await integrationPreview(f.store,f.config,f.task.id);
  assert.equal(await fs.readFile(path.join(f.config.repoPath,'README.md'),'utf8'),'original\n');
  await fs.writeFile(path.join(f.config.repoPath,'README.md'),'user edit\n');
  await assert.rejects(integrate(f.store,f.config,review.key),/changed since/);
  assert.equal(await fs.readFile(path.join(f.config.repoPath,'README.md'),'utf8'),'user edit\n');
  await fs.writeFile(path.join(f.config.repoPath,'README.md'),'original\n');
  await integrate(f.store,f.config,review.key);
  assert.equal((await fs.readFile(path.join(f.config.repoPath,'README.md'),'utf8')).replaceAll('\r\n','\n'),'improved\n');
  await assert.rejects(integrate(f.store,f.config,review.key),/already applied/);
});
test('handoff source copies retain all earlier changes in their cumulative patch',async t=>{
  const f=await fixture(t),next=path.join(f.config.dataDir,'workspaces','next');
  await createSnapshot(f.workspace,next,true);
  await fs.writeFile(path.join(next,'qa.md'),'QA addition\n');await git(next,['add','-A']);
  const patch=await git(next,['diff','--cached']);
  assert.match(patch,/improved/);assert.match(patch,/QA addition/);
});
test('proposal QA runs against an independent source and binds evidence to its fingerprint',async t=>{
  const f=await fixture(t);
  const runner=new Runner(f.store,f.config,(_command,_args,options)=>({stop(){},done:(async()=>{
    assert.notEqual(options.cwd,f.workspace);assert.notEqual(options.cwd,f.config.repoPath);
    assert.equal(await fs.readFile(path.join(options.cwd,'README.md'),'utf8'),'improved\n');
    assert.match(options.env.NEXORA_TEST_SQLSERVER,/Database=master/);
    assert.match(options.env.ConnectionStrings__Nexora,/Database=NexoraCommandCenterFixture_run_/);
    assert.equal(options.env.Identity__Provider__LocalDevelopmentEnabled,'true');
    assert.equal(options.env.Identity__SeedAdminPassword,'');
    return {code:0,output:'fixture check passed',error:null};
  })()}));
  const run=runner.enqueue({suite:suites.find(s=>s.id==='api'),targetTask:f.store.get('SELECT * FROM tasks WHERE id=?',f.task.id)});
  const end=Date.now()+15000;
  while(runner.active){assert.ok(Date.now()<end);await new Promise(r=>setTimeout(r,20));}
  const saved=f.store.get('SELECT * FROM runs WHERE id=?',run.id);
  assert.equal(saved.status,'succeeded');assert.equal(saved.source_hash,await sourceFingerprint(f.workspace));
  assert.equal(f.store.get('SELECT status FROM tasks WHERE id=?',f.task.id).status,'review');
  await fs.writeFile(path.join(f.workspace,'README.md'),'new revision\n');
  await assert.rejects(integrationPreview(f.store,f.config,f.task.id),/exact source/);
});
test('backup restore verifies checksums, preserves history and refuses an existing destination',async t=>{
  const f=await fixture(t);
  for (const relative of ['apps/web/node_modules/package/index.js','apps/web/.next/cache/result','backend/obj/project.assets.json']) {
    const file=path.join(f.workspace,relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'regenerable');
  }
  const backup=await backupData(f.store,f.config),target=path.join(f.directory,'restored');
  const manifest=JSON.parse(await fs.readFile(path.join(backup.directory,'manifest.json'),'utf8'));
  assert.ok(!Object.keys(manifest.files).some(file=>/node_modules|\/\.next\/|\/obj\//.test(file)));
  await restoreBackup(backup.directory,target);
  const restored=new Store(target);
  try { assert.equal(restored.get('SELECT title FROM tasks WHERE id=?',f.task.id).title,f.task.title);assert.ok(restored.get('SELECT workspace FROM tasks WHERE id=?',f.task.id).workspace.startsWith(target)); } finally { restored.close(); }
  assert.equal(await fs.stat(path.join(target,'workspaces','run_original','apps/web/node_modules')).catch(()=>null),null);
  await assert.rejects(restoreBackup(backup.directory,target),/must not exist/);
  await fs.writeFile(path.join(backup.directory,'workspaces','run_original','README.md'),'tampered');
  await assert.rejects(restoreBackup(backup.directory,path.join(f.directory,'bad-restore')),/checksum/);
});
test('retention protects review and dependent work, backs up closed copies and retains history',async t=>{
  const f=await fixture(t);
  f.store.run("UPDATE tasks SET updated_at='2020-01-01T00:00:00Z' WHERE id=?",f.task.id);
  assert.equal((await retentionPlan(f.store,f.config)).length,0);
  f.store.run("UPDATE tasks SET status='completed' WHERE id=?",f.task.id);
  const child=f.store.task({title:'Dependent',description:'Keep source',agent:'qa',area:'CRM',priority:'normal',depends_on:f.task.id,status:'ready'});
  assert.equal((await retentionPlan(f.store,f.config)).length,0);
  f.store.run("UPDATE tasks SET status='cancelled',updated_at='2020-01-01T00:00:00Z' WHERE id=?",child.id);
  const result=await cleanupData(f.store,f.config);assert.equal(result.removed,1);assert.ok(result.backup);
  assert.equal(f.store.get('SELECT workspace FROM tasks WHERE id=?',f.task.id).workspace,null);
  assert.ok(f.store.get('SELECT * FROM artifacts WHERE task_id=?',f.task.id));
});
test('usage parsing tolerates split JSON and budgets distinguish missing usage from zero',async t=>{
  let usage;const parse=usageParser(value=>usage=value);
  parse('{"type":"turn.completed","usage":{"input_tokens":100,');parse('"cached_input_tokens":20,"output_tokens":10}}\n');
  assert.equal(usageTotal(usage),110);assert.equal(estimateCost(usage,{input:2,cached:1,output:10}),.00028);assert.equal(estimateCost(usage,null),null);
  const f=await fixture(t);f.store.run("UPDATE runs SET command='[\"codex\"]' WHERE id='run_original'");assert.throws(()=>checkBudget(f.store,{dailyTokenLimit:1000}),/unknown usage/);
  f.store.run("UPDATE runs SET usage=? WHERE id='run_original'",JSON.stringify(usage));
  assert.throws(()=>checkBudget(f.store,{dailyTokenLimit:100}),/budget reached/);
  assert.doesNotThrow(()=>checkBudget(f.store,{dailyTokenLimit:1000}));
});
