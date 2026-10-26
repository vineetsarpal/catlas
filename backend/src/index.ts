import { createApp } from './app';
const port=Number(process.env.CATLAS_API_PORT??3001);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid CATLAS_API_PORT');
if(process.env.CATLAS_MONITOR_HOSTED==='true'&&!process.env.CATLAS_MONITOR_TOKEN)throw Error('Hosted Monitor requires CATLAS_MONITOR_TOKEN.');
const app=createApp({apiKey:process.env.AISSTREAM_API_KEY,firmsKey:process.env.FIRMS_MAP_KEY,monitorToken:process.env.CATLAS_MONITOR_TOKEN});
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.close();});
await app.listen({host:'127.0.0.1',port});
console.log(`Catlas Monitor: http://127.0.0.1:${port} (${process.env.CATLAS_MONITOR_TOKEN?'authenticated':'localhost only'}; AIS ${process.env.AISSTREAM_API_KEY?'configured':'not configured'})`);
