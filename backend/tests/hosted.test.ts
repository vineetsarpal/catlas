import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app';
import { monitorBridge } from '../../functions/_monitor';

const token='a'.repeat(64);
const headers={host:'monitor.example.com',authorization:`Bearer ${token}`};
test('the actual Pages bridge authenticates to the hosted HTTP handler without forwarding browser credentials',async()=>{
  const app=createApp({monitorToken:token});
  try{
    const response=await monitorBridge(new Request('https://catlas.test/api/monitor/health',{headers:{origin:'https://catlas.test',cookie:'browser-session=private',authorization:'Bearer browser-token','cf-connecting-ip':'192.0.2.2'}}),{MONITOR_API_ORIGIN:'https://monitor.example.com',MONITOR_API_TOKEN:token},async(input,init)=>{
      const target=new URL(String(input));
      const result=await app.inject({method:'GET',url:target.pathname+target.search,headers:{...Object.fromEntries(new Headers(init?.headers)),host:target.host}});
      return new Response(result.body,{status:result.statusCode,headers:{'content-type':'application/json'}});
    });
    assert.equal(response.status,200);assert.equal((await response.json()).status,'ok');
    assert.equal(response.headers.get('cache-control'),'no-store');
  }finally{await app.close();}
});
test('hosted mode requires authentication even on loopback and refuses browser origins',async()=>{
  assert.throws(()=>createApp({monitorToken:''}),/64 lowercase hexadecimal/);
  const app=createApp({monitorToken:token});
  try{
    for(const authorization of [undefined,'Bearer wrong',`Bearer ${'b'.repeat(64)}`]){
      const result=await app.inject({url:'/api/monitor/health',headers:{host:'localhost:3001',...(authorization?{authorization}:{})}});
      assert.equal(result.statusCode,401);assert.equal(result.headers['cache-control'],'no-store');
      assert.ok(!result.body.includes(token));
    }
    assert.equal((await app.inject({url:'/api/monitor/health',headers})).statusCode,200);
    assert.equal((await app.inject({url:'/api/monitor/health',headers:{...headers,origin:'https://catlas-workbench.pages.dev'}})).statusCode,403);
    assert.equal((await app.inject({url:'/api/monitor/vessels?viewer=fixture&bbox=-10,-10,10,10',headers})).json().status,'unconfigured');
  }finally{await app.close();}
});
test('authenticated bridge client addresses have separate rate limits; local mode ignores forwarded identities',async()=>{
  const app=createApp({monitorToken:token});
  try{
    for(let i=0;i<240;i++)assert.equal((await app.inject({url:'/api/monitor/health',headers:{...headers,'x-catlas-client-ip':'192.0.2.1'}})).statusCode,200);
    assert.equal((await app.inject({url:'/api/monitor/health',headers:{...headers,'x-catlas-client-ip':'192.0.2.1'}})).statusCode,429);
    assert.equal((await app.inject({url:'/api/monitor/health',headers:{...headers,'x-catlas-client-ip':'2001:db8::1'}})).statusCode,200);
  }finally{await app.close();}
  const local=createApp();
  try{
    for(let i=0;i<240;i++)await local.inject({url:'/api/monitor/health',headers:{host:'localhost','x-catlas-client-ip':`192.0.2.${i%250}`}});
    assert.equal((await local.inject({url:'/api/monitor/health',headers:{host:'localhost','x-catlas-client-ip':'198.51.100.1'}})).statusCode,429);
  }finally{await local.close();}
});
