import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { discoverEarthquakes } from '../exposure/live';
import { discoverCyclones } from './feeds';
import { backendEnabled, discoverBackendWind } from './backend';
import { useVessels } from './useVessels';

const preferences=z.object({earthquakes:z.boolean(),cyclones:z.boolean(),wind:z.boolean(),windShading:z.boolean().default(false),windPaused:z.boolean().default(false),vessels:z.boolean().default(false),locations:z.boolean(),nearPortfolio:z.boolean(),watchedOnly:z.boolean(),watchlist:z.array(z.object({key:z.string().max(150),name:z.string().max(200)})).max(100)});
export type MonitorPreferences=z.infer<typeof preferences>;
const defaults:MonitorPreferences={earthquakes:true,cyclones:true,wind:false,windShading:false,windPaused:false,vessels:false,locations:true,nearPortfolio:false,watchedOnly:false,watchlist:[]};
export const MONITOR_STORAGE='catlas-monitor-1';
function loadPreferences(){try{return preferences.parse(JSON.parse(localStorage.getItem(MONITOR_STORAGE)??'null'));}catch{return defaults;}}
export type Remote<T>={data:T|null;checkedAt:string;error:string;loading:boolean};
function useRemote<T>(enabled:boolean,load:(signal:AbortSignal)=>Promise<T>,interval:number,refreshToken:number) {
  const [state,setState]=useState<Remote<T>>({data:null,checkedAt:'',error:'',loading:false});
  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController();let inFlight=false;
    const refresh=async()=>{
      if(inFlight||document.visibilityState!=='visible'||!navigator.onLine)return;
      inFlight=true;setState(old=>({...old,loading:true}));
      try{const data=await load(AbortSignal.any([controller.signal,AbortSignal.timeout(25000)]));if(!controller.signal.aborted)setState({data,checkedAt:new Date().toISOString(),loading:false,error:''});}
      catch(e){if(!controller.signal.aborted)setState(old=>({...old,loading:false,error:e instanceof Error?e.message:String(e)}));}
      finally{inFlight=false;}
    };
    void refresh();const timer=setInterval(()=>void refresh(),interval);
    window.addEventListener('online',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',refresh);setState(old=>({...old,loading:false}));};
  },[enabled,load,interval,refreshToken]);
  return state;
}
export function useMonitor(active:boolean) {
  const [prefs,setPreferences]=useState(loadPreferences),[storageError,setStorageError]=useState('');
  const [refreshToken,setRefreshToken]=useState(0),[now,setNow]=useState(Date.now()),[online,setOnline]=useState(navigator.onLine);
  const [forecastTime,setForecastTime]=useState(''),[selected,setSelected]=useState(''),[focus,setFocus]=useState(0);
  useEffect(()=>{try{localStorage.setItem(MONITOR_STORAGE,JSON.stringify(prefs));setStorageError('');}catch{setStorageError('Browser storage is unavailable. Watchlist and preferences will last only for this session.');}},[prefs]);
  useEffect(()=>{const tick=()=>{setNow(Date.now());setOnline(navigator.onLine);};const timer=setInterval(tick,30000);window.addEventListener('online',tick);window.addEventListener('offline',tick);return()=>{clearInterval(timer);window.removeEventListener('online',tick);window.removeEventListener('offline',tick);};},[]);
  const earthquakes=useRemote(active&&prefs.earthquakes,discoverEarthquakes,60000,refreshToken);
  const cyclones=useRemote(active&&prefs.cyclones,discoverCyclones,300000,refreshToken);
  const wind=useRemote(active&&prefs.wind&&backendEnabled,discoverBackendWind,1800000,refreshToken);
  const vessels=useVessels(active&&prefs.vessels);
  const validTime=wind.data?.times.includes(forecastTime)?forecastTime:wind.data?.defaultTime??'';
  const setPrefs=useCallback((patch:Partial<MonitorPreferences>)=>setPreferences(old=>({...old,...patch})),[]);
  const select=useCallback((key:string)=>{setSelected(key);setFocus(v=>v+1);},[]);
  function toggleWatch(key:string,name:string){setPreferences(old=>({...old,watchlist:old.watchlist.some(w=>w.key===key)?old.watchlist.filter(w=>w.key!==key):old.watchlist.length<100?[...old.watchlist,{key,name}]:old.watchlist}));}
  return {vessels,prefs,setPrefs,storageError,earthquakes,cyclones,wind,now,online,validTime,setForecastTime,selected,select,focus,toggleWatch,refresh:()=>setRefreshToken(v=>v+1)};
}
export type MonitorState=ReturnType<typeof useMonitor>;
