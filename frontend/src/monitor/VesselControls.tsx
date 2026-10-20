import { useState } from 'react';
import type { MonitorState } from './useMonitor';
import { LayerToggle } from './LayerToggle';
import { parseVesselCSV } from '@catlas/shared/vessels';
export function VesselControls({state}:{state:MonitorState}){
  const vessels=state.vessels,[error,setError]=useState('');
  return <section className="monitor-map-layer" aria-label="Vessels display">
    <LayerToggle label="Vessels" checked={state.prefs.vessels} onChange={vessels=>state.setPrefs({vessels})}/>
    {state.prefs.vessels&&<>
      {vessels.demo?<><p role="status"><b>DEMO · Fictional fleet</b><br/>Five simulated vessels near the English Channel. Positions and trails are static examples, not AIS observations. Your saved vessel list is unchanged.</p><button onClick={()=>{vessels.clearDemo();vessels.setScope('all');}}>Exit demo · Show live vessels</button></>:<button onClick={vessels.loadDemo}>Show demo fleet (fictional)</button>}
      {!vessels.demo&&<><p>Green ships are in your vessel watch portfolio; blue ships are other vessels. Select a ship to add or remove it.</p><p>Latest AIS reports in the map area. Portfolio membership does not establish policy coverage. Tracking outside this area is unavailable.</p>
      {!vessels.configured?<p role="status">Enable the local backend to receive vessels. See docs/catlas-backend.md.</p>:<>
        <label>Vessel scope <select value={vessels.scope} onChange={e=>vessels.setScope(e.target.value as 'all'|'portfolio')}><option value="portfolio">Vessel watch portfolio</option><option value="all">All vessels</option></select></label>
        <p role="status">{vessels.error||vessels.snapshot?.message||'Waiting for vessel feed…'}{vessels.snapshot?.lastMessageAt&&` · Last position received ${new Date(vessels.snapshot.lastMessageAt).toLocaleTimeString()}`}</p>
        <p>{vessels.portfolio.length} portfolio vessels · {vessels.rows.length} reports in view{vessels.snapshot?.truncated?' · results capped at 1,000':''}</p>
        <label>Import vessel CSV <input type="file" accept=".csv,text/csv" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>100000)throw Error('Maximum file size is 100 KB');vessels.setPortfolio(parseVesselCSV(await file.text()));setError('');}catch{setError('Import failed. Use name,mmsi,imo columns, with a 9-digit MMSI or 7-digit IMO for each vessel (maximum 200).');}e.target.value='';}}/></label>
        <button onClick={()=>{vessels.setPortfolio([{name:'Example vessel identity — fictional',mmsi:'999999999'}]);setError('');}}>Load fictional sample list</button>
        <button disabled={!vessels.portfolio.length} onClick={()=>vessels.setPortfolio([])}>Clear vessel list</button>
        <p>The sample demonstrates import only; it does not supply live positions. CSV replaces the current list.</p>
        {!!vessels.portfolio.length&&<details><summary>Portfolio reporting</summary>{vessels.portfolio.map((p,i)=>{const found=vessels.snapshot?.rows.find(v=>(p.mmsi&&v.mmsi===p.mmsi)||(p.imo&&v.imo===p.imo));return <p key={i}>{p.name} · {found?`Report ${new Date(found.reportedAt).toLocaleTimeString()}`:'No report in current map area; coverage unavailable or vessel elsewhere'}</p>;})}</details>}
        <p>Recent trails are temporary and reset on backend restart.</p>
      </>}
      </>}
      {(error||vessels.storageError)&&<p role="alert">{error||vessels.storageError}</p>}
    </>}
  </section>;
}
