import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { discoverEarthquakes } from '../exposure/live';
import { discoverCyclones } from './feeds';
import { backendEnabled, discoverBackendWind } from './backend';
import { useVessels } from './useVessels';
import { discoverFires, discoverPerimeters, discoverAlerts, HAZARD_BACKEND_REQUIRED, reconcileAlertWatches, latestAlertKey, startMonitorPolling } from './hazard-feeds';

export const monitorPreferencesSchema=z.object({fires:z.boolean().default(true),perimeters:z.boolean().default(true),alerts:z.boolean().default(true),showFires:z.boolean().default(false),showPerimeters:z.boolean().default(true),showAlerts:z.boolean().default(true),fireDistanceKm:z.number().min(0).max(100).default(10),earthquakes:z.boolean(),cyclones:z.boolean(),wind:z.boolean(),windShading:z.boolean().default(false),windPaused:z.boolean().default(false),vessels:z.boolean().default(false),locations:z.boolean(),nearPortfolio:z.boolean(),watchedOnly:z.boolean(),watchlist:z.array(z.object({key:z.string().max(512),name:z.string().max(200),references:z.array(z.string().max(512)).max(200).optional(),updatedAt:z.string().datetime().optional()})).max(100)});
export type MonitorPreferences=z.infer<typeof monitorPreferencesSchema>;
const defaults:MonitorPreferences={fires:true,perimeters:true,alerts:true,showFires:false,showPerimeters:true,showAlerts:true,fireDistanceKm:10,earthquakes:true,cyclones:true,wind:false,windShading:false,windPaused:false,vessels:false,locations:true,nearPortfolio:false,watchedOnly:false,watchlist:[]};
export const MONITOR_STORAGE='catlas-monitor-1';
function loadPreferences(){try{return monitorPreferencesSchema.parse(JSON.parse(localStorage.getItem(MONITOR_STORAGE)??'null'));}catch{return defaults;}}
export type Remote<T>={data:T|null;checkedAt:string;error:string;loading:boolean};
function useRemote<T>(enabled:boolean,load:(signal:AbortSignal)=>Promise<T>,interval:number,refreshToken:number) {
  const [state,setState]=useState<Remote<T>>({data:null,checkedAt:'',error:'',loading:false});
  useEffect(()=>{
    if(!enabled)return;
    return startMonitorPolling(load,interval,{
      loading:loading=>setState(old=>old.loading===loading?old:{...old,loading}),
      data:data=>setState({data,checkedAt:new Date().toISOString(),loading:false,error:''}),
      error:error=>setState(old=>({...old,loading:false,error})),
    });
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
  const fireRemote=useRemote(active&&prefs.fires&&backendEnabled,discoverFires,600000,refreshToken);
  const perimeterRemote=useRemote(active&&prefs.perimeters&&backendEnabled,discoverPerimeters,300000,refreshToken);
  const alertRemote=useRemote(active&&prefs.alerts&&backendEnabled,discoverAlerts,60000,refreshToken);
  const unavailable=<T,>(remote:Remote<T>,enabled:boolean):Remote<T>=>enabled&&!backendEnabled?{...remote,error:HAZARD_BACKEND_REQUIRED}:remote;
  const fires=unavailable(fireRemote,prefs.fires),perimeters=unavailable(perimeterRemote,prefs.perimeters),alerts=unavailable(alertRemote,prefs.alerts);
  useEffect(()=>{
    if(!alertRemote.data)return;
    setPreferences(old=>{const watchlist=reconcileAlertWatches(old.watchlist,alertRemote.data!.rows);return watchlist===old.watchlist?old:{...old,watchlist};});
    setSelected(key=>latestAlertKey(key,alertRemote.data!.rows));
  },[alertRemote.data]);
  const vessels=useVessels(active&&prefs.vessels);
  const validTime=wind.data?.times.includes(forecastTime)?forecastTime:wind.data?.defaultTime??'';
  const setPrefs=useCallback((patch:Partial<MonitorPreferences>)=>setPreferences(old=>({...old,...patch})),[]);
  const select=useCallback((key:string)=>{setSelected(key);setFocus(v=>v+1);},[]);
  function toggleWatch(key:string,name:string){setPreferences(old=>({...old,watchlist:old.watchlist.some(w=>w.key===key)?old.watchlist.filter(w=>w.key!==key):old.watchlist.length<100?reconcileAlertWatches([...old.watchlist,{key,name}],alertRemote.data?.rows??[]):old.watchlist}));}
  return {fires,perimeters,alerts,vessels,prefs,setPrefs,storageError,earthquakes,cyclones,wind,now,online,validTime,setForecastTime,selected,select,focus,toggleWatch,refresh:()=>setRefreshToken(v=>v+1)};
}
export type MonitorState=ReturnType<typeof useMonitor>;
