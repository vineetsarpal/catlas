import type { Map } from 'maplibre-gl';

export const REPORTED_FIRE_COLOR = '#b85a2b';
export const REPORTED_FIRE_PATH = 'M12 2C13 9 21 10 21 19C21 26 17 30 12 30C6 30 2 26 3 19C3 15 6 12 6 9C8 11 9 14 9 15C12 12 14 8 12 2Z';
export const REPORTED_FIRE_INNER_PATH = 'M12 17C16 21 17 25 13 27C9 29 6 25 9 21C10 20 11 19 12 17Z';

// A local sprite keeps reported incident points distinct from earthquake circles offline.
export function addReportedFireIcon(map: Map) {
  const canvas = document.createElement('canvas');
  canvas.width = 48; canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Reported fire icons could not be initialized.');
  context.scale(2, 2);
  context.fillStyle = REPORTED_FIRE_COLOR;
  context.strokeStyle = '#fff'; context.lineWidth = 1.5; context.lineJoin = 'round';
  const outer = new Path2D(REPORTED_FIRE_PATH);
  context.fill(outer); context.stroke(outer);
  context.fillStyle = '#fff1d0'; context.fill(new Path2D(REPORTED_FIRE_INNER_PATH));
  map.addImage('monitor-reported-fire', context.getImageData(0, 0, 48, 64), { pixelRatio: 2 });
}
