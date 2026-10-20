import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

// Ship the pinned package's browser-capable runtime separately: never load WASM on app startup.
// Adapt CommonJS exports and guard a Node-only Buffer check. No runtime eval or Node polyfills.
export function windDecoderAssets():Plugin {
  const root=resolve('node_modules/@meri-imperiumi/eccodes-wasm');
  const files=()=>{const wasm=readFileSync(`${root}/build/eccodes/eccodes.wasm`);return {
    'runtime.js':Buffer.from(readFileSync(`${root}/build/eccodes/eccodes.js`,'utf8')+'\nexport default createEccodes;\n'),
    'wrapper.js':Buffer.from(readFileSync(`${root}/wasm/eccodes.js`,'utf8').replace('Buffer.isBuffer(data)', "typeof Buffer !== 'undefined' && Buffer.isBuffer(data)").replace('module.exports = { Eccodes, CodesHandle, EccodesError, createEccodes };','export { Eccodes, CodesHandle, EccodesError, createEccodes };')),
    'eccodes.wasm.gz':gzipSync(wasm,{level:9}),
    'manifest.json':Buffer.from(JSON.stringify({length:wasm.length,sha256:createHash('sha256').update(wasm).digest('hex')})),
    'LICENSE.txt':readFileSync(`${root}/LICENSE`),
  };};
  let assets:ReturnType<typeof files>|undefined;
  return {name:'catlas-wind-decoder',configureServer(server){server.middlewares.use('/wind-decoder',(req,res,next)=>{
    const name=req.url?.split('?')[0].replace(/^\//,'');
    if(!name||!['runtime.js','wrapper.js','eccodes.wasm.gz','manifest.json','LICENSE.txt'].includes(name)){next();return;}
    assets??=files();res.setHeader('Content-Type',name.endsWith('.gz')?'application/gzip':name.endsWith('.json')?'application/json':name.endsWith('.js')?'text/javascript':'text/plain');
    res.end(assets[name as keyof typeof assets]);
  });},generateBundle(){for(const [name,source] of Object.entries(files()))this.emitFile({type:'asset',fileName:`wind-decoder/${name}`,source});}};
}
