'use strict';
const F = require('./dsh-fixture.cjs');
const H = require('./native-helper.cjs');
const {assert,fs,path,runtime}=F;
const {SessionTeams}=require('../lib/adapter.cjs');
const base=fs.mkdtempSync(path.join(runtime,'10-boundaries-'));
const results={version:'0.5.2',scope:'Actual isolated Native services, scripted models only; no live profile or network.',tests:[],modelRequests:0};
let n=0;
const ledger=w=>w.ctx.sessionTeams.runtime.ledger();
const write=(w,a,command)=>F.tool(w,a,{action:'execute',command}).then(F.ok);
async function world(body){const w=await F.createWorld(path.join(base,'10-case-'+(++n)));try{for(const name of ['manager','worker','other'])w[name]=(await F.createAgent(w,'10-boundary-'+name)).agent;await F.admin(w,{type:'save-team',teamId:'10-boundary-team',title:'Boundary checks',description:'',managerId:w.manager.id,memberIds:[w.worker.id,w.other.id]});return await body(w);}finally{results.modelRequests+=w.adapter.calls.length;await w.dispose();}}
async function test(name,fn){try{const evidence=await world(fn);results.tests.push({name,status:'passed',evidence});console.log('PASS '+name);}catch(e){results.tests.push({name,status:'failed',error:e.stack});console.error(e.stack);}}
async function human(w,a,text){const m=F.message(text);w.adapter.script.push({text:'Continuing the user conversation.'});a.followup(m);await F.timeout(a.whenIdle(),'human native turn');await F.drain();return m;}
(async()=>{
await test('Cached status wait stays outside business FIFO and aborts cleanly',async w=>{
 const r=w.ctx.sessionTeams.runtime;
 const original=r.environment.read;r.environment.read=()=>{throw Error('Status must not inspect environment');};
 const first=await F.remote(w,'inspect',{query:{type:'status'}});assert.equal(first.reviewToken,undefined);
 const held=F.remote(w,'inspect',{query:{type:'status',after:first.state.statusVersion}});
 await F.drain();assert.equal(r.statusWaiters.size,1);r.environment.read=original;
 await F.timeout(F.inspect(w),'owner snapshot while status waits');
 await human(w,w.worker,'Please discuss this with me.');
 const second=await F.timeout(held,'focus status event');assert(second.state.statusVersion!==first.state.statusVersion);assert.equal(second.state.statuses[w.worker.id].withUser,true);
 const controller=new AbortController();const stopped=F.remote(w,'inspect',{query:{type:'status',after:second.state.statusVersion}},w.owner,controller.signal);await F.drain();controller.abort();await assert.rejects(stopped);assert.equal(r.statusWaiters.size,0);
 await assert.rejects(F.remote(w,'inspect',{query:{type:'status'}},w.outsider),/owner|access denied/i);
 return {cachedOnly:true,ownerSnapshotNotBlocked:true,actualHumanFocusEvent:true,cancelledWaiters:0};
});
await test('Retired sole-team Session can release only its own retained conversational focus',async w=>{
 const message=await human(w,w.worker,'Stay with me for a question.');
 await F.admin(w,{type:'retire-team',teamId:'10-boundary-team'});
 assert.equal(w.ctx.sessionTeams.runtime.participantIds.has(w.worker.id),false);
 assert.equal(w.ctx.sessionTeams.runtime.statusFacts[w.worker.id],undefined);
 assert.equal(ledger(w).sessions.find(p=>p.id===w.worker.id).focus.withUser,true);
 const own=F.ok(await F.tool(w,w.worker,{action:'read',query:{type:'own-record'}}));assert.equal(own.focus.userMessageId,message.id);
 F.denied(await F.tool(w,w.worker,{action:'execute',command:{type:'set-user-focus',withUser:true,expectedUserMessageId:message.id}}),'FORBIDDEN');
 F.denied(await F.tool(w,w.worker,{action:'execute',command:{type:'message',teamId:'10-boundary-team',messageId:'10-illegal',to:w.other.id,kind:'request',text:'Restart old work'}}),'INACTIVE');
 await write(w,w.worker,{type:'set-user-focus',withUser:false,expectedUserMessageId:message.id});
 assert.equal(ledger(w).sessions.find(p=>p.id===w.worker.id).focus.withUser,false);
 assert.equal(w.ctx.sessionTeams.runtime.statusFacts[w.worker.id],undefined);
 const tools=await F.resolveTool(w,w.worker);try{assert(!w.ctx.tools.schemas(w.worker,tools).some(t=>t.name==='session_teams'));}finally{tools.dispose();}
 assert.equal(ledger(w).teams[0].status,'idle');assert.equal(w.adapter.calls.length,1);
 return {releaseAfterRetirement:true,generalMutationDenied:true,toolRemovedAfterRelease:true,nativeSessionStillExists:w.ctx.agents.get(w.worker.id)===w.worker};
});
await test('Automatic wake burst stops visibly with no retry or extra model run',async w=>{
 assert.equal(SessionTeams.Config.parse(undefined).maxAutomaticWakesPerBurst,24);assert.throws(()=>SessionTeams.Config.parse({maxAutomaticWakesPerBurst:0}));
 const r=w.ctx.sessionTeams.runtime;r.delivery.limit=1;
 await human(w,w.manager,'Stay with me while these workers run.');
 const before=w.adapter.calls.length;w.adapter.script.push({text:'First worker accepted this one automatic turn.'});
 await H.dispatch(w,{assignments:[{targetId:w.worker.id,text:'First bounded outcome',expectedAssignment:null,workStatus:'ready'},{targetId:w.other.id,text:'Second bounded outcome',expectedAssignment:null,workStatus:'ready'}]},{teamId:'10-boundary-team'});
 await F.drain();if(r.delivery.running)await F.timeout(r.delivery.running,'bounded dispatcher');await F.timeout(w.worker.whenIdle(),'one native worker');await F.drain();if(r.delivery.running)await F.timeout(r.delivery.running,'final dispatcher');
 assert.equal(w.adapter.calls.length-before,1);assert.equal(w.adapter.script.length,0);
 const failed=ledger(w).wakeups.filter(x=>x.status==='failed');assert.equal(failed.length,1);assert.match(failed[0].error,/limit reached/);assert.equal(r.statusFacts[w.other.id].needsIntervention,true);
 r.delivery.kick();await F.drain();if(r.delivery.running)await r.delivery.running;assert.equal(w.adapter.calls.length-before,1);
 return {limit:1,automaticModelRequests:1,failedWakes:1,visibleIntervention:true,noBlindRetry:true};
});
assert.deepEqual(F.audit.networkAttempts,[]);assert(F.audit.fileMutations.every(p=>require('./paths.cjs').ownedMutation(p)));results.networkAttempts=F.audit.networkAttempts;results.outsideMutations=[];results.passed=results.tests.filter(t=>t.status==='passed').length;results.failed=results.tests.filter(t=>t.status==='failed').length;F.archiveFiles(base);fs.writeFileSync(require('./paths.cjs').resultPath('boundary'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({passed:results.passed,failed:results.failed,modelRequests:results.modelRequests}));if(results.failed)process.exitCode=1;
})().catch(e=>{console.error(e.stack);process.exitCode=1;});


