import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.mjs';
import { git, readSource, createSnapshot, prepareAgentGuides } from '../server/repository.mjs';
import { Store } from '../server/store.mjs';
import { execute, Runner } from '../server/runner.mjs';
import { root } from '../server/config.mjs';

async function fixture(t) {
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'nexora-center-test-'));
  const repo=path.join(base,'repo');await fs.mkdir(path.join(repo,'docs'),{recursive:true});
  await fs.writeFile(path.join(repo,'README.md'),'# Fixture repository\n');
  await fs.writeFile(path.join(repo,'docs','guide.md'),'# Architecture\n');
  await fs.writeFile(path.join(repo,'.gitignore'),'node_modules/\n');
  await git(repo,['init','-q']);await git(repo,['add','.']);
  await git(repo,['-c','user.name=Test','-c','user.email=test@example.invalid','-c','core.hooksPath=','commit','-qm','Baseline']);
  // All cleanup targets are verified descendants of the newly-created temporary directory.
  const cleanup=[];
  t.after(async()=>{for(const close of cleanup) await close();const resolved=path.resolve(base);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(resolved).startsWith('nexora-center-test-'));await fs.rm(resolved,{recursive:true,force:true});});
  return {base,repo,cleanup};
}
async function application(t) {
  const {base,repo,cleanup}=await fixture(t);
  const app=createApp({root,repoPath:repo,dataDir:path.join(base,'data'),codexPath:'nonexistent-test-codex',dotnetPath:'nonexistent-test-dotnet',sqlServer:'.\\SQLEXPRESS',agentTimeoutMinutes:1});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));await app.ready;
  cleanup.push(()=>app.close());
  const url=`http://127.0.0.1:${app.server.address().port}`;
  const {token}=await (await fetch(`${url}/api/session`)).json();
  async function request(route,body,headers={}) {
    const response=await fetch(url+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Command-Token':token,...headers},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  }
  return {app,request,url,base,repo};
}
const requestData={title:'Investigate portal permissions',description:'Verify revocable company access.',agent:'pm',area:'Portal',priority:'high',workflow:true};

test('source snapshot includes current dirty source and excludes secrets and linked paths',async t=>{
  const {base,repo}=await fixture(t);
  await fs.writeFile(path.join(repo,'README.md'),'Changed and uncommitted');
  await fs.writeFile(path.join(repo,'new.ts'),'export const local = true;');
  await fs.writeFile(path.join(repo,'.env'),'API_KEY=private');
  await fs.writeFile(path.join(repo,'appsettings.Development.json'),'private');
  const snapshot=path.join(base,'snapshot');const evidence=await createSnapshot(repo,snapshot);
  assert.equal(await fs.readFile(path.join(snapshot,'README.md'),'utf8'),'Changed and uncommitted');
  assert.equal(await fs.readFile(path.join(snapshot,'new.ts'),'utf8'),'export const local = true;');
  assert.equal(evidence.dirty,true);assert.equal(evidence.snapshotHash.length,64);
  assert.equal(await fs.stat(path.join(snapshot,'.env')).catch(()=>null),null);
  assert.equal(await fs.stat(path.join(snapshot,'appsettings.Development.json')).catch(()=>null),null);
  for(const file of ['../README.md','docs/../../README.md','.env','appsettings.Development.json','C:/secrets.txt','docs\\guide.md']) await assert.rejects(readSource(repo,file));
  const outside=path.join(base,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'escape.md'),'outside');
  await fs.symlink(outside,path.join(repo,'linked'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(readSource(repo,'linked/escape.md'));
  assert.equal(await fs.readFile(path.join(repo,'README.md'),'utf8'),'Changed and uncommitted');
});

test('agent guidance is independently copied only for matching packages and confined links',async t=>{
  const {base,repo}=await fixture(t),draft=path.join(base,'draft');
  const web=directory=>path.join(directory,'apps','web');
  const guides=path.join(web(repo),'node_modules','next','dist','docs');
  await fs.mkdir(guides,{recursive:true});await fs.mkdir(web(draft),{recursive:true});
  for(const name of ['package.json','package-lock.json']) {
    await fs.writeFile(path.join(web(repo),name),'{}');await fs.writeFile(path.join(web(draft),name),'{}');
  }
  await fs.writeFile(path.join(guides,'guide.md'),'Required Next guidance');
  await fs.writeFile(path.join(web(repo),'node_modules','next','runtime.js'),'Runtime must not be copied');
  assert.equal(await prepareAgentGuides(repo,draft),true);
  assert.equal(await fs.readFile(path.join(web(draft),'node_modules','next','dist','docs','guide.md'),'utf8'),'Required Next guidance');
  assert.equal(await fs.stat(path.join(web(draft),'node_modules','next','runtime.js')).catch(()=>null),null);
  await fs.writeFile(path.join(web(draft),'package-lock.json'),'changed');
  assert.equal(await prepareAgentGuides(repo,draft),false);
  await fs.writeFile(path.join(web(draft),'package-lock.json'),'{}');
  const outside=path.join(base,'external-guidance');await fs.mkdir(outside);
  await fs.symlink(outside,path.join(guides,'linked'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(prepareAgentGuides(repo,draft),/escapes/);
});

test('API rejects cross-origin, missing token and invalid payloads',async t=>{
  const {request,url}=await application(t);
  assert.equal((await fetch(`${url}/api/state`)).status,401);
  assert.equal((await request('/api/tasks',requestData,{Origin:'https://evil.example'})).status,403);
  assert.equal((await request('/api/tasks',{...requestData,agent:'shell'})).status,400);
  assert.equal((await request('/api/tasks',{...requestData,description:' '})).status,400);
  assert.equal((await request('/api/qa/run',{suite:'arbitrary-command'})).status,400);
  assert.equal((await request('/api/repository/file?path=../README.md')).status,400);
  const index=await fetch(url);assert.equal(index.status,200);assert.match(index.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});

test('maintenance workflow persists, gates execution and advances only on review',async t=>{
  const {app,request}=await application(t);
  const created=await request('/api/tasks',requestData);assert.equal(created.status,201);
  let state=(await request('/api/state')).body;
  assert.equal(state.tasks.length,4);
  const root=state.tasks.find(task=>!task.parent_id),ba=state.tasks.find(task=>task.agent==='ba'),dev=state.tasks.find(task=>task.agent==='portal_dev');
  assert.equal(root.status,'ready');assert.equal(ba.depends_on,root.id);assert.equal(dev.depends_on,ba.id);
  assert.equal((await request(`/api/tasks/${root.id}/accept`,{})).status,400);
  assert.throws(()=>app.runner.enqueue({task:ba}),/preceding handoff/);
  assert.equal((await request(`/api/tasks/${root.id}/messages`,{content:'Keep tenant isolation.'})).status,201);
  assert.equal((await request(`/api/tasks/${root.id}`)).body.messages.length,2);
  app.store.run("UPDATE tasks SET status='review' WHERE id=?",root.id);
  assert.equal((await request(`/api/tasks/${root.id}/accept`,{})).status,200);
  state=(await request('/api/state')).body;assert.equal(state.tasks.find(task=>task.id===ba.id).status,'ready');
  assert.equal(state.tasks.find(task=>task.id===dev.id).status,'blocked');
  assert.equal((await request(`/api/tasks/${root.id}/messages`,{content:'Change accepted work'})).status,400);
});

test('support can triage alone or hand off through BA and the product developer',async t=>{
  const {app,request}=await application(t);
  const standalone=await request('/api/tasks',{...requestData,agent:'support',workflow:false});
  assert.equal(standalone.status,201);
  assert.equal((await request('/api/state')).body.tasks.length,1);
  for (const [area,developer] of [['CRM','crm_dev'],['Portal','portal_dev'],['Website / CMS','portal_dev']]) {
    const created=await request('/api/tasks',{...requestData,agent:'support',area});
    assert.equal(created.status,201);
    const state=(await request('/api/state')).body;
    const children=state.tasks.filter(task=>task.parent_id===created.body.id);
    assert.equal(children.length,3);
    const ba=children.find(task=>task.agent==='ba'),dev=children.find(task=>task.agent===developer),qa=children.find(task=>task.agent==='qa');
    assert.equal(ba.depends_on,created.body.id);
    assert.equal(dev.depends_on,ba.id);assert.equal(qa.depends_on,dev.id);
    assert.throws(()=>app.runner.enqueue({task:ba}),/preceding handoff/);
    app.store.run("UPDATE tasks SET status='review' WHERE id=?",created.body.id);
    assert.equal((await request(`/api/tasks/${created.body.id}/accept`,{})).status,200);
    assert.equal((await request(`/api/tasks/${ba.id}`)).body.status,'ready');
    assert.equal((await request(`/api/tasks/${dev.id}`)).body.status,'blocked');
  }
});

test('restart preserves records and marks unfinished runs interrupted',async t=>{
  const {base,cleanup}=await fixture(t),data=path.join(base,'db');const store=new Store(data);
  const task=store.task(requestData);
  store.run("INSERT INTO runs(id,task_id,kind,label,status,created_at) VALUES('run_test',?,'agent','pm','running',?)",task.id,new Date().toISOString());
  store.close();const reopened=new Store(data);cleanup.push(()=>reopened.close());
  assert.equal(reopened.get("SELECT status FROM runs WHERE id='run_test'").status,'interrupted');
  assert.equal(reopened.get('SELECT status FROM tasks WHERE id=?',task.id).status,'blocked');
  assert.equal(reopened.get('SELECT content FROM messages WHERE task_id=?',task.id).content,requestData.description);
});

test('queued cancellation cannot produce success or unlock descendants',async t=>{
  const {app,request}=await application(t);app.runner.stopping=true;
  const root=(await request('/api/tasks',requestData)).body;
  const run=app.runner.enqueue({task:root});
  assert.throws(()=>app.runner.enqueue({task:root}));
  app.runner.cancel(run.id);
  assert.equal(app.store.get('SELECT status FROM runs WHERE id=?',run.id).status,'cancelled');
  assert.equal(app.store.get('SELECT status FROM tasks WHERE id=?',root.id).status,'blocked');
  assert.equal(app.store.get('SELECT status FROM tasks WHERE depends_on=?',root.id).status,'blocked');
});

test('process execution captures real exit codes, redacts common secrets and stops children',async()=>{
  const result=await execute(process.execPath,['-e','console.log("password=example-secret"); process.exitCode=7;'],{timeout:10000}).done;
  assert.equal(result.code,7);assert.ok(!result.output.includes('example-secret'));assert.match(result.output,/redacted/);
  const pending=execute(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:10000});
  pending.stop();const cancelled=await pending.done;assert.equal(cancelled.cancelled,true);assert.notEqual(cancelled.code,0);
});

test('agent report contract distinguishes blocked output and preserves cumulative draft changes',async t=>{
  const {base,repo,cleanup}=await fixture(t),dataDir=path.join(base,'agent-data');
  const store=new Store(dataDir);let attempt=0;
  const fakeExecutor=(command,args,options)=>({stop(){},done:(async()=>{
    assert.equal(args[args.indexOf('--sandbox')+1],'workspace-write');
    assert.ok(args.includes('--ignore-user-config'));assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
    assert.match(options.input,/Accepted BA inventory/);assert.match(options.input,/Accepted developer report/);
    attempt++;
    await fs.writeFile(path.join(options.cwd,'new.ts'),`export const revision = ${attempt};`);
    await fs.writeFile(args[args.indexOf('-o')+1],JSON.stringify({status:attempt===3?'blocked':'complete',report:attempt===3?'Blocked by missing test dependency.':'Draft prepared; not deployed.'}));
    options.onOutput('Fixture process completed\n');
    return {code:0,output:'Fixture process completed',error:null};
  })()});
  const runner=new Runner(store,{root,repoPath:repo,dataDir,codexPath:'fixture-only',agentTimeoutMinutes:1},fakeExecutor);
  cleanup.push(async()=>{await runner.shutdown();store.close();});
  const analyst=store.task({...requestData,agent:'ba',status:'completed'});
  store.artifact(analyst.id,null,'BA report','report','Accepted BA inventory');
  const developer=store.task({...requestData,agent:'crm_dev',status:'completed',depends_on:analyst.id});
  store.artifact(developer.id,null,'Developer report','report','Accepted developer report');
  const task=store.task({...requestData,agent:'crm_dev',depends_on:developer.id});
  async function runAndWait(){const run=runner.enqueue({task:store.get('SELECT * FROM tasks WHERE id=?',task.id)});const deadline=Date.now()+15000;while(['queued','running'].includes(store.get('SELECT status FROM runs WHERE id=?',run.id).status)){assert.ok(Date.now()<deadline,'Run should settle');await new Promise(r=>setTimeout(r,25));}while(runner.active)await new Promise(r=>setTimeout(r,10));return store.get('SELECT * FROM runs WHERE id=?',run.id);}
  const first=await runAndWait();assert.equal(first.status,'succeeded');
  assert.equal(store.get('SELECT status FROM tasks WHERE id=?',task.id).status,'review');
  store.run("UPDATE tasks SET status='ready' WHERE id=?",task.id);
  const second=await runAndWait();assert.equal(second.workspace,first.workspace);
  const patch=store.get("SELECT content FROM artifacts WHERE run_id=? AND kind='patch'",second.id).content;
  assert.match(patch,/new file mode/);assert.match(patch,/revision = 2/);
  assert.equal(await fs.stat(path.join(repo,'new.ts')).catch(()=>null),null,'Original checkout remains unchanged');
  store.run("UPDATE tasks SET status='ready' WHERE id=?",task.id);
  const third=await runAndWait();assert.equal(third.status,'blocked');
  assert.equal(store.get('SELECT status FROM tasks WHERE id=?',task.id).status,'blocked');
  assert.match(store.get("SELECT content FROM artifacts WHERE run_id=? AND kind='report'",third.id).content,/Blocked/);
});
