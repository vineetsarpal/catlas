import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readlinkSync, readdirSync, existsSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { deployMonitor } from './deploy-monitor-vps.mjs';

const oldSha='a'.repeat(40),newSha='b'.repeat(40),token='c'.repeat(64);
function fixture(t,{previous=true}={}){
  const root=realpathSync(mkdtempSync(join(tmpdir(),'catlas-vps-deploy-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'incoming'));mkdirSync(join(root,'releases'));
  writeFileSync(join(root,'incoming',`${newSha}.tar.gz`),'fixture archive');
  const configuration=join(root,'private.env');
  writeFileSync(configuration,`CATLAS_MONITOR_HOSTED=true\nCATLAS_API_PORT=3001\nCATLAS_MONITOR_TOKEN=${token}\n`,{mode:0o600});
  if(previous){
    mkdirSync(join(root,'releases',oldSha));writeFileSync(join(root,'releases',oldSha,'.catlas-release'),oldSha);
  }
  const calls=[];
  const run=(name,args)=>{
    calls.push({name,args});
    if(name==='systemctl')return args.includes('--property=WorkingDirectory')?join(root,'current/backend'):userInfo().username;
    if(name==='tar')writeFileSync(join(args[args.indexOf('--directory')+1],'package.json'),'{}');
    return '';
  };
  const options={configuration,run,checkHealth:async supplied=>{assert.equal(supplied,token);return true;},pause:async()=>{},attempts:2};
  return {root,configuration,calls,options};
}
test('installs dependencies before activation, then restarts only Monitor and verifies health',async t=>{
  const f=fixture(t);const before=join(f.root,'releases',oldSha);symlinkSync(before,join(f.root,'current'));
  const run=f.options.run;
  f.options.run=(name,args,options)=>{
    if(name==='npm')assert.equal(readlinkSync(join(f.root,'current')),before);
    return run(name,args,options);
  };
  const result=await deployMonitor(f.root,newSha,f.options);
  assert.equal(result.previous,before);assert.equal(readlinkSync(join(f.root,'current')),join(f.root,'releases',newSha));
  assert.deepEqual(f.calls.filter(c=>c.name==='sudo').map(c=>c.args),[['-n','/usr/bin/systemctl','restart','catlas-monitor.service']]);
  assert.ok(!JSON.stringify(f.calls).includes(token));
});
test('failed health rolls back the symlink and verifies the previous release',async t=>{
  const f=fixture(t);const before=join(f.root,'releases',oldSha);symlinkSync(before,join(f.root,'current'));
  f.options.checkHealth=async()=>readlinkSync(join(f.root,'current'))===before;
  await assert.rejects(deployMonitor(f.root,newSha,f.options),/previous release was restored and passed/);
  assert.equal(readlinkSync(join(f.root,'current')),before);
  assert.equal(f.calls.filter(c=>c.name==='sudo'&&c.args.includes('restart')).length,2);
});
test('failed initial deployment stops the service and removes the failed current pointer',async t=>{
  const f=fixture(t,{previous:false});f.options.checkHealth=async()=>false;
  await assert.rejects(deployMonitor(f.root,newSha,f.options),/Initial deployment failed/);
  assert.equal(existsSync(join(f.root,'current')),false);
  assert.ok(f.calls.some(c=>c.name==='sudo'&&c.args.includes('stop')));
});
test('dependency installation failure leaves the current release running and removes staging files',async t=>{
  const f=fixture(t);const before=join(f.root,'releases',oldSha);symlinkSync(before,join(f.root,'current'));
  const run=f.options.run;f.options.run=(name,args,opts)=>{if(name==='npm')throw Error('installation refused');return run(name,args,opts);};
  await assert.rejects(deployMonitor(f.root,newSha,f.options),/installation refused/);
  assert.equal(readlinkSync(join(f.root,'current')),before);
  assert.equal(f.calls.some(c=>c.name==='sudo'),false);
  assert.deepEqual(readdirSync(join(f.root,'releases')),[oldSha]);
});
test('refuses a service pointing at another checkout before installing or restarting',async t=>{
  const f=fixture(t);f.options.run=()=>'/some/other/backend';
  await assert.rejects(deployMonitor(f.root,newSha,f.options),/release-based Monitor service/);
  assert.equal(readdirSync(join(f.root,'releases')).length,1);
});
test('refuses a non-secret configuration and an incomplete existing release',async t=>{
  const f=fixture(t);
  writeFileSync(f.configuration,'CATLAS_MONITOR_HOSTED=true\nCATLAS_MONITOR_TOKEN=short\n');
  await assert.rejects(deployMonitor(f.root,newSha,f.options),/Configure authenticated Monitor/);
  writeFileSync(f.configuration,`CATLAS_MONITOR_HOSTED=true\nCATLAS_MONITOR_TOKEN=${token}\n`);
  mkdirSync(join(f.root,'releases',newSha));
  await assert.rejects(deployMonitor(f.root,newSha,f.options),/Existing release is incomplete/);
  assert.equal(f.calls.some(c=>c.name==='sudo'),false);
});
test('a repeated successful release reuses installed dependencies and still verifies health',async t=>{
  const f=fixture(t,{previous:false});
  await deployMonitor(f.root,newSha,f.options);
  const installCount=f.calls.filter(c=>c.name==='npm').length;
  await deployMonitor(f.root,newSha,f.options);
  assert.equal(f.calls.filter(c=>c.name==='npm').length,installCount);
});
