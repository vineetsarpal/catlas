import type { ReactNode } from 'react';
import type { InsuredLocation } from '../exposure/model';

function insuredValue(location: InsuredLocation) {
  if (location.value === null) return `Unknown ${location.currency}`;
  return `${new Intl.NumberFormat('en-US', { style: 'currency', currency: location.currency, maximumFractionDigits: 2 }).format(location.value)} ${location.currency}`;
}

/** Common insured-location identity and inventory facts in both browsing workspaces. */
export function LocationDetails({ location, actions, children }: { location: InsuredLocation; actions?: ReactNode; children?: ReactNode }) {
  return <>
    <header className="exposure-location-heading"><h2>{location.name}</h2><p>{location.id}</p></header>
    <section aria-label="Location details" className="location-common-details">
      <h3>Location details</h3>
      <dl>
        <dt>Location ID</dt><dd>{location.id}</dd>
        <dt>Coordinates</dt><dd>{location.latitude}, {location.longitude}</dd>
        <dt>Insured value</dt><dd>{insuredValue(location)}</dd>
        <dt>Region</dt><dd>{location.region || 'Not supplied'}</dd>
        <dt>Business line</dt><dd>{location.businessLine || 'Not supplied'}</dd>
      </dl>
    </section>
    {actions && <div className="location-detail-actions">{actions}</div>}
    {children}
  </>;
}
