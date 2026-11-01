export function LocationSearch({ value, onChange, label = 'Find a location' }: { value: string; onChange: (value: string) => void; label?: string }) {
  return <div className="exposure-location-search">
    <input type="search" aria-label={label} placeholder="Find a location" title="Search by name, ID, region or business line. Filters the map and location list." value={value} onChange={event => onChange(event.target.value)}/>
    {value && <button aria-label="Clear location search" onClick={() => onChange('')}>×</button>}
  </div>;
}
