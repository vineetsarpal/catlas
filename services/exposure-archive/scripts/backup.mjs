import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';

const usage=`Private public-archive recovery (Node 24+)
  backup.mjs start --output <new-receipt.json>
  backup.mjs advance --id <backup-id> --output <new-receipt.json>
  backup.mjs inventory --output <new-inventory.json>
  backup.mjs status --id <backup-id> --output <new-receipt.json>
  backup.mjs rotate --output <new-receipt.json> [--confirm ROTATE_RECOVERY_HISTORY]
  backup.mjs restore-start --point <point-id> --output <new-receipt.json> [--confirm <point-id>]
  backup.mjs restore-advance --id <restore-id> --output <new-receipt.json>
  backup.mjs restore-status --id <restore-id> --output <new-receipt.json>
Set ARCHIVE_BASE_URL and ADMIN_TOKEN securely in the operator environment.
Production origin requires HTTPS *.workers.dev; --allow-local permits only disposable HTTP loopback.
One bounded request per command. No automatic retry or restore. Existing files are never overwritten.`;
class OperatorError extends Error {}
const refuse=message=>{throw new OperatorError(message);};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
async function confirm(supplied,expected,description){
 if(supplied!==undefined){if(supplied!==expected)refuse('Confirmation does not match the selected recovery operation.');return;}
 if(!process.stdin.isTTY||!process.stdout.isTTY)refuse('Explicit confirmation is required; inspect the inventory and target, then supply --confirm.');
 const terminal=createInterface({input:process.stdin,output:process.stdout});
 try{if(await terminal.question(`${description}\nType ${expected} to confirm: `)!==expected)refuse('Confirmation declined; no recovery request was sent.');}finally{terminal.close();}
}
async function responseJson(response){
 if(!response.body)refuse('The archive response is incomplete.');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>1048576){await reader.cancel();refuse('The recovery response exceeded its byte limit.');}chunks.push(Buffer.from(next.value));}}finally{reader.releaseLock();}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{refuse('The recovery response is not compatible JSON.');}
}
let output;
async function persist(value){const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');await output.truncate(0);await output.write(bytes,0,bytes.length,0);await output.sync();}
try{
 let parsed;try{parsed=parseArgs({options:{output:{type:'string'},id:{type:'string'},point:{type:'string'},confirm:{type:'string'},'allow-local':{type:'boolean',default:false},help:{type:'boolean'}},allowPositionals:true,strict:true});}catch{refuse(usage);}
 const options=parsed.values,[action]=parsed.positionals;
 if(options.help){console.log(usage);process.exit(0);}
 const allowed={start:['output','allow-local'],advance:['output','id','allow-local'],inventory:['output','allow-local'],status:['output','id','allow-local'],rotate:['output','confirm','allow-local'],'restore-start':['output','point','confirm','allow-local'],'restore-advance':['output','id','allow-local'],'restore-status':['output','id','allow-local']};
 if(parsed.positionals.length!==1||!Object.hasOwn(allowed,action)||!options.output)refuse(usage);
 if(Object.keys(options).some(key=>!allowed[action].includes(key)))refuse('An option does not apply to this recovery action.');
 if(['advance','status','restore-advance','restore-status'].includes(action)&&!uuid(options.id))refuse('Select the exact recovery operation with --id.');
 if(action==='restore-start'&&!uuid(options.point))refuse('Select the complete recovery point with --point.');
 let origin;try{origin=new URL(process.env.ARCHIVE_BASE_URL??'');}catch{refuse('Set ARCHIVE_BASE_URL to the intended archive origin.');}
 if(origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)refuse('Use an archive origin without credentials, query or path.');
 const hosted=origin.protocol==='https:'&&origin.hostname.endsWith('.workers.dev')&&!origin.port;
 const local=options['allow-local']&&origin.protocol==='http:'&&['127.0.0.1','localhost'].includes(origin.hostname);
 if(!hosted&&!local)refuse('Use an HTTPS workers.dev origin, or explicitly allow a disposable loopback fixture.');
 const token=process.env.ADMIN_TOKEN;
 if(typeof token!=='string'||token.length<24||token.length>505||/[\r\n]/.test(token))refuse('Set ADMIN_TOKEN securely in the environment. The public proof token is not used.');
 if(action==='rotate')await confirm(options.confirm,'ROTATE_RECOVERY_HISTORY',`Rotate only eligible recovery history at ${origin.origin}; live cleanup is separate.`);
 if(action==='restore-start')await confirm(options.confirm,options.point,`Restore recovery point ${options.point} into EMPTY archive ${origin.origin}. Verify its backup namespace has been copied and the target is clean.`);
 output=await open(resolve(options.output),'wx',0o600);
 const began=Date.now(),observedAt=new Date(began).toISOString();
 const base={schemaVersion:1,origin:origin.origin,observedAt,action};
 await persist({...base,status:'request-started'});
 const path=action==='start'?'/start':action==='advance'?'/advance':action==='inventory'?'/inventory':action==='status'?`/${options.id}`:action==='rotate'?'/rotate':action==='restore-start'?'/restore/start':action==='restore-advance'?'/restore/advance':`/restore/${options.id}`;
 const body=['status','inventory','restore-status'].includes(action)?undefined:action==='advance'||action==='restore-advance'?{id:options.id}:action==='restore-start'?{pointId:options.point,confirmation:'RESTORE_EMPTY_ARCHIVE'}:{};
 const response=await fetch(new URL(`/api/maintenance/backups${path}`,origin),{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${token}`,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(120000),redirect:'error',cache:'no-store'});
 if(!response.ok){await response.body?.cancel();await persist({...base,status:'request-refused',httpStatus:response.status,elapsedMs:Date.now()-began});refuse(`Archive returned HTTP ${response.status}. No automatic retry occurred; inspect the private recovery inventory.`);}
 const result=await responseJson(response);
 if(!result||typeof result!=='object'||Array.isArray(result))refuse('The recovery response is incompatible.');
 const format=action==='inventory'?'catlas-archive-recovery-inventory':'catlas-archive-recovery-receipt';
 await persist({...base,format,finishedAt:new Date().toISOString(),elapsedMs:Date.now()-began,result});
 if(result.state==='failed')refuse('The recovery operation is failed. The private receipt was retained; no complete point is claimed.');
 console.log(`Private ${action} response saved to ${resolve(options.output)}. No automatic follow-up was scheduled.`);
}catch(error){console.error(error instanceof OperatorError?error.message:'Private recovery command failed. Inspect local configuration or private diagnostics; no automatic retry occurred.');process.exitCode=1;}finally{await output?.close();}
