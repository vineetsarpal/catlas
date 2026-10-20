// ecCodes executes off the UI thread. Runtime assets are generated from the pinned npm package.
// Each task owns its WASM instance and is terminated on completion, cancellation or timeout.
self.onmessage=async({data}:{data:{bytes:ArrayBuffer[];decoderBase:string;runAt:string;time:string}})=>{
  const started=performance.now();
  try{
    const runtime=await import(/* @vite-ignore */ `${data.decoderBase}runtime.js`);
    const wrapper=await import(/* @vite-ignore */ `${data.decoderBase}wrapper.js`);
    const signal=AbortSignal.timeout(45000);
    const manifestResponse=await fetch(`${data.decoderBase}manifest.json`,{signal});
    if(!manifestResponse.ok)throw new Error('Wind decoder metadata is unavailable.');
    const manifest=await manifestResponse.json();
    if(!Number.isInteger(manifest.length)||manifest.length<1||manifest.length>48*1024*1024||!/^([a-f0-9]{64})$/.test(manifest.sha256))throw new Error('Invalid wind decoder metadata.');
    const response=await fetch(`${data.decoderBase}eccodes.wasm.gz`,{signal});
    if(!response.ok||!response.body)throw new Error('Wind decoder download failed.');
    const reader=response.body.pipeThrough(new DecompressionStream('gzip')).getReader();
    const wasm=new Uint8Array(manifest.length);let offset=0;
    while(true){const {done,value}=await reader.read();if(done)break;if(offset+value.length>wasm.length){await reader.cancel();throw new Error('Wind decoder exceeds its expected size.');}wasm.set(value,offset);offset+=value.length;}
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',wasm.buffer)),b=>b.toString(16).padStart(2,'0')).join('');
    if(offset!==wasm.length||hash!==manifest.sha256)throw new Error('Wind decoder integrity check failed.');
    const compiled=await WebAssembly.compile(wasm.buffer);
    const decoder=await wrapper.createEccodes(runtime.default,{instantiateWasm:(imports:WebAssembly.Imports,receive:(instance:WebAssembly.Instance)=>void)=>receive(new WebAssembly.Instance(compiled,imports))});
    const decoded=data.bytes.map((bytes,index)=>{
      const file=`/wind-${index}.grib`;decoder.writeFile(file,new Uint8Array(bytes));const handle=decoder.openGrib(file);
      try{
        const nx=handle.getLong('Ni'),ny=handle.getLong('Nj');
        if(nx!==360||ny!==181||handle.getLong('iScansNegatively')!==0||handle.getLong('jScansPositively')!==0||handle.getLong('jPointsAreConsecutive')!==0||handle.getLong('alternativeRowScanning')!==0)throw new Error('Unsupported GFS wind grid orientation.');
        const name=handle.getString('shortName');if(![index===0?'10u':'10v',index===0?'u':'v'].includes(name)||handle.getLong('level')!==10||handle.getString('units')!=='m s**-1')throw new Error('Unsupported surface wind component.');
        const run=Number(data.runAt.slice(0,10).replaceAll('-','')),runTime=Number(data.runAt.slice(11,13))*100;
        const valid=Number(data.time.slice(0,10).replaceAll('-','')),validTime=Number(data.time.slice(11,13))*100;
        if(handle.getLong('dataDate')!==run||handle.getLong('dataTime')!==runTime||handle.getLong('validityDate')!==valid||handle.getLong('validityTime')!==validTime)throw new Error('Wind components do not match the selected run and forecast time.');
        const values=new Float32Array(handle.getDoubleArray('values'));
        if(values.length!==nx*ny||!values.every(v=>Number.isFinite(v)&&Math.abs(v)<180))throw new Error('Invalid wind vector values.');
        return {nx,ny,lo1:handle.getDouble('longitudeOfFirstGridPointInDegrees'),la1:handle.getDouble('latitudeOfFirstGridPointInDegrees'),dx:handle.getDouble('iDirectionIncrementInDegrees'),dy:handle.getDouble('jDirectionIncrementInDegrees'),values};
      }finally{handle.delete();decoder.writeFile(file,new Uint8Array());}
    });
    const [u,v]=decoded;if(['nx','ny','lo1','la1','dx','dy'].some(key=>u[key as keyof typeof u]!==v[key as keyof typeof v])||u.dx!==1||u.dy!==1||u.la1!==90||u.lo1!==0)throw new Error('Mismatched wind grids.');
    self.postMessage({nx:u.nx,ny:u.ny,lo1:u.lo1,la1:u.la1,dx:u.dx,dy:u.dy,u:u.values,v:v.values,decodeMs:performance.now()-started},{transfer:[u.values.buffer,v.values.buffer]});
  }catch(e){self.postMessage({error:e instanceof Error?e.message:String(e)});}
};
