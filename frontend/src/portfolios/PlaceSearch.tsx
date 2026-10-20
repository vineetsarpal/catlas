import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { searchPlaces, type PlaceResult } from './geocoding';

export function PlaceSearch({ inputRef, active, disabled, onChoose }: {
  inputRef: RefObject<HTMLInputElement | null>; active: boolean; disabled: boolean; onChoose: (place: PlaceResult) => void;
}) {
  const [query,setQuery]=useState(''),[results,setResults]=useState<PlaceResult[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [searched,setSearched]=useState(false),[online,setOnline]=useState(navigator.onLine),[open,setOpen]=useState(false),[highlight,setHighlight]=useState(-1),[composing,setComposing]=useState(false);
  const controller=useRef<AbortController|null>(null),sequence=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),list=useRef<HTMLDivElement>(null);
  const listId=useId(),helpId=useId();
  const cancel=useCallback(()=>{clearTimeout(timer.current);sequence.current++;controller.current?.abort();},[]);
  const search=useCallback((text:string)=>{
    cancel();const request=new AbortController();controller.current=request;const token=sequence.current;
    setLoading(true);setError('');setResults([]);setSearched(false);setHighlight(-1);setOpen(true);
    void searchPlaces(text,request.signal).then(value=>{if(token===sequence.current){setResults(value);setSearched(true);}})
      .catch(e=>{if(token===sequence.current&&!request.signal.aborted)setError(e instanceof Error&&e.name==='TimeoutError'?'Search timed out. Try again or drop a pin.':'Place search unavailable. Try again or drop a pin.');})
      .finally(()=>{if(token===sequence.current)setLoading(false);});
  },[cancel]);
  useEffect(()=>{
    const update=()=>setOnline(navigator.onLine);
    window.addEventListener('online',update);window.addEventListener('offline',update);
    return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};
  },[]);
  useEffect(()=>{
    cancel();setLoading(false);
    if(!active||disabled||!online||composing||query.trim().length<3)return;
    timer.current=setTimeout(()=>{if(document.activeElement===inputRef.current)search(query);},450);
    return cancel;
  },[query,active,disabled,online,composing,inputRef,search,cancel]);
  useEffect(()=>{if(highlight>=0)list.current?.children[highlight]?.scrollIntoView({block:'nearest'});},[highlight]);
  function choose(place:PlaceResult){cancel();setOpen(false);setResults([]);setSearched(false);setHighlight(-1);onChoose(place);}
  function edit(value:string){cancel();setQuery(value);setLoading(false);setResults([]);setSearched(false);setError('');setHighlight(-1);setOpen(value.trim().length>=3);}
  const expanded=active&&online&&open&&(loading||Boolean(error)||searched);
  return <section className="portfolio-place-search" aria-label="Find a place" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget)){setOpen(false);setHighlight(-1);}}}>
    <form onSubmit={event=>{event.preventDefault();if(!disabled&&online&&query.trim().length>=3){inputRef.current?.focus();search(query);}}}>
      <label>Search places or addresses<input ref={inputRef} type="search" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={expanded&&results.length>0} aria-controls={listId} aria-activedescendant={expanded&&highlight>=0?`${listId}-${highlight}`:undefined} aria-describedby={helpId} autoComplete="off" placeholder="Search a building, address or place" value={query} maxLength={200} disabled={disabled||!online}
        onChange={event=>edit(event.target.value)} onFocus={()=>setOpen(true)} onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)}
        onKeyDown={event=>{
          if(event.nativeEvent.isComposing)return;
          if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel();setLoading(false);setOpen(false);setHighlight(-1);}
          if((event.key==='ArrowDown'||event.key==='ArrowUp')&&results.length){event.preventDefault();setOpen(true);setHighlight(index=>event.key==='ArrowDown'?(index+1)%results.length:(index<=0?results.length-1:index-1));}
          if(event.key==='Enter'&&expanded&&highlight>=0&&results[highlight]){event.preventDefault();choose(results[highlight]);}
        }} /></label>
      <button aria-label="Search places" disabled={disabled||!online||loading||query.trim().length<3}>{loading?'Searching…':'Search'}</button>
    </form>
    <p id={helpId}>{online ? <>Typed text is sent to <a href="https://photon.komoot.io" target="_blank" rel="noreferrer">Photon</a> for suggestions · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a></> : 'Offline · Drop a pin or enter coordinates instead.'}</p>
    {expanded&&<div className="portfolio-place-dropdown">
      {loading&&<p role="status">Finding places…</p>}{error&&<p role="alert">{error}</p>}{searched&&!results.length&&<p role="status">No places found. Try a fuller address or drop a pin.</p>}
      {!!results.length&&<div ref={list} id={listId} className="portfolio-place-results" role="listbox" aria-label="Place suggestions">{results.map((place,index)=><button id={`${listId}-${index}`} type="button" role="option" aria-selected={highlight===index} tabIndex={-1} key={place.id} onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setHighlight(index)} onClick={()=>choose(place)}>
        <span className="place-option-icon" aria-hidden="true">⌖</span><span className="place-option-copy"><strong>{place.name}</strong><span className="place-option-address">{place.label.startsWith(`${place.name}, `)?place.label.slice(place.name.length+2):place.label}</span></span>
      </button>)}</div>}
    </div>}
  </section>;
}
