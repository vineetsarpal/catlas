import { retainPortfolioReports, toggleVesselPortfolio } from './vessel-portfolio';
import { demoFleet, demoPortfolio } from './vessel-demo';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { backendEnabled, backendJSON } from './backend';
import { vesselPortfolio, vesselSnapshot, type Vessel, type VesselIdentity, type VesselSnapshot, inVesselPortfolio } from '@catlas/shared/vessels';
const storage='catlas-vessels-1';
function stored(){try{return vesselPortfolio.parse(JSON.parse(localStorage.getItem(storage)??'[]'));}catch{return [];}}
export function useVessels(active:boolean){
  const [portfolio,setPortfolio]=useState<VesselIdentity[]>(stored),[scope,setScope]=useState<'portfolio'|'all'>('portfolio');
  const [bounds,setBounds]=useState<[number,number,number,number]>([-180,-85,180,85]);
  const [snapshot,setSnapshot]=useState<VesselSnapshot|null>(null),[error,setError]=useState(''),[storageError,setStorageError]=useState('');
  const [demoRows,setDemoRows]=useState<ReturnType<typeof demoFleet>|null>(null);
  const [retained,setRetained]=useState<Vessel[]>([]);
  const [viewer]=useState(()=>crypto.randomUUID());
  useEffect(()=>{try{localStorage.setItem(storage,JSON.stringify(portfolio));setStorageError('');}catch{setStorageError('Vessel list could not be saved; it lasts for this session only.');}},[portfolio]);
  const setViewport=useCallback((value:[number,number,number,number])=>setBounds(old=>old.every((v,i)=>Math.abs(v-value[i])<0.01)?old:value),[]);
  const bbox=bounds.join(',');
  useEffect(()=>{
    if(!active||!backendEnabled||demoRows)return;
    const controller=new AbortController();let busy=false;
    const poll=async()=>{
      if(busy||document.hidden||!navigator.onLine)return;busy=true;
      try{
        const value=vesselSnapshot.parse(await backendJSON(`vessels?${new URLSearchParams({viewer,bbox})}`,AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])));
        if(!controller.signal.aborted){setSnapshot(value);setError('');}
      }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));}finally{busy=false;}
    };
    void poll();const timer=setInterval(()=>void poll(),10000);
    window.addEventListener('online',poll);document.addEventListener('visibilitychange',poll);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener('online',poll);document.removeEventListener('visibilitychange',poll);};
  },[active,viewer,bbox,demoRows]);
  useEffect(()=>{
    if(!active||!backendEnabled||demoRows)return;
    return()=>{void fetch(`/api/monitor/vessels/${viewer}`,{method:'DELETE',keepalive:true}).catch(()=>{});};
  },[active,viewer,demoRows]);
  const togglePortfolio=useCallback((v:Vessel)=>setPortfolio(old=>toggleVesselPortfolio(old,v)),[]);
  useEffect(()=>{
    const update=()=>setRetained(old=>retainPortfolioReports(old,snapshot?.rows??[],portfolio,Date.now()));
    update();const timer=setInterval(update,30000);return()=>clearInterval(timer);
  },[snapshot,portfolio]);
  const displayedPortfolio=useMemo(()=>demoRows?demoPortfolio(demoRows):portfolio,[demoRows,portfolio]);
  const rows=useMemo(()=>{
    if(!active)return [];
    if(demoRows)return demoRows.filter(v=>scope==='all'||inVesselPortfolio(v,displayedPortfolio));
    const latest=new Map((snapshot?.rows??[]).map(v=>[v.mmsi,v]));
    for(const vessel of retained){
      const current=latest.get(vessel.mmsi);
      if(!current||Date.parse(current.reportedAt)<Date.parse(vessel.reportedAt))latest.set(vessel.mmsi,vessel);
    }
    return [...latest.values()].filter(v=>scope==='all'||inVesselPortfolio(v,displayedPortfolio));
  },[active,demoRows,snapshot,retained,scope,displayedPortfolio]);
  return {demo:Boolean(demoRows),loadDemo:()=>{setDemoRows(demoFleet(new Date().toISOString()));setScope('portfolio');},clearDemo:()=>setDemoRows(null),togglePortfolio,configured:backendEnabled,portfolio:displayedPortfolio,setPortfolio,scope,setScope,snapshot,error,storageError,setViewport,rows};
}
