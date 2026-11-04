import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { backendEnabled } from './backend';
import { useVessels } from './useVessels';
import { HAZARD_BACKEND_REQUIRED, reconcileAlertWatches, latestAlertKey } from './hazard-feeds';
import type { MonitorFeed, Remote } from './query';
import { MonitorSession, monitorFeedLoaders, type MonitorData } from './session';
export type { Remote } from './query';

export const monitorPreferencesSchema=z.object({fires:z.boolean().default(true),perimeters:z.boolean().default(true),alerts:z.boolean().default(true),fireDistanceKm:z.number().min(0).max(100).default(10),earthquakes:z.boolean(),cyclones:z.boolean(),wind:z.boolean(),windShading:z.boolean().default(false),windPaused:z.boolean().default(false),vessels:z.boolean().default(false),locations:z.boolean(),nearPortfolio:z.boolean(),watchedOnly:z.boolean(),watchlist:z.array(z.object({key:z.string().max(512),name:z.string().max(200),references:z.array(z.string().max(512)).max(200).optional(),updatedAt:z.string().datetime().optional()})).max(100)});
export type MonitorPreferences=z.infer<typeof monitorPreferencesSchema>;
const defaults:MonitorPreferences={fires:true,perimeters:true,alerts:true,fireDistanceKm:10,earthquakes:true,cyclones:true,wind:false,windShading:false,windPaused:false,vessels:false,locations:true,nearPortfolio:false,watchedOnly:false,watchlist:[]};
export const MONITOR_STORAGE='catlas-monitor-1';
function loadPreferences(){try{return monitorPreferencesSchema.parse(JSON.parse(localStorage.getItem(MONITOR_STORAGE)??'null'));}catch{return defaults;}}
export function useMonitor(active:boolean) {
  const [prefs,setPreferences]=useState(loadPreferences),[storageError,setStorageError]=useState('');
  const client=useQueryClient();
  const session=useMemo(()=>new MonitorSession<MonitorData>(client,monitorFeedLoaders),[client]);
  const {earthquakes,cyclones,wind,fires:fireRemote,perimeters:perimeterRemote,alerts:alertRemote,now,online}=useSyncExternalStore(session.subscribe,session.getSnapshot);
  useEffect(()=>session.connect(),[session]);
  const [forecastTime,setForecastTime]=useState(''),[selected,setSelected]=useState(''),[focus,setFocus]=useState(0);
  useEffect(()=>{try{localStorage.setItem(MONITOR_STORAGE,JSON.stringify(prefs));setStorageError('');}catch{setStorageError('Browser storage is unavailable. Watchlist and preferences will last only for this session.');}},[prefs]);
  useEffect(()=>{
    const enabled:MonitorFeed[]=[];
    if(active){
      if(prefs.earthquakes)enabled.push('earthquakes');
      if(prefs.cyclones)enabled.push('cyclones');
      if(prefs.wind&&backendEnabled)enabled.push('wind');
      if(prefs.fires&&backendEnabled)enabled.push('fires');
      if(prefs.perimeters&&backendEnabled)enabled.push('perimeters');
      if(prefs.alerts&&backendEnabled)enabled.push('alerts');
    }
    session.configure(enabled);
  },[session,active,prefs.earthquakes,prefs.cyclones,prefs.wind,prefs.fires,prefs.perimeters,prefs.alerts]);
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
  return {fires,perimeters,alerts,vessels,prefs,setPrefs,storageError,earthquakes,cyclones,wind,now,online,validTime,setForecastTime,selected,select,focus,toggleWatch,refresh:session.refresh};
}
export type MonitorState=ReturnType<typeof useMonitor>;
