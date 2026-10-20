#!/usr/bin/env python3
"""Reduce pinned Natural Earth sources for offline contextual maps.

Usage: python3 scripts/prepare-map-geography.py /path/to/source-directory
The directory contains the original files and sources.json with pinned URLs.
"""
import hashlib
import json
from pathlib import Path
import shutil
import sys

source = Path(sys.argv[1])
out = Path(__file__).resolve().parent.parent / 'frontend/public/map'
manifest = json.loads((source / 'sources.json').read_text())

def read(name):
    return json.loads((source / name).read_text())['features']

def simplify(points, tolerance=.005):
    # Iterative Douglas-Peucker, retaining both endpoints of every source line.
    keep = {0, len(points) - 1}
    pending = [(0, len(points) - 1)]
    while pending:
        first, last = pending.pop()
        a, b = points[first], points[last]
        dx, dy = b[0] - a[0], b[1] - a[1]
        denominator = dx * dx + dy * dy
        farthest, distance = first, tolerance * tolerance
        for i in range(first + 1, last):
            p = points[i]
            t = max(0, min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/denominator)) if denominator else 0
            d = (p[0]-a[0]-t*dx)**2 + (p[1]-a[1]-t*dy)**2
            if d > distance:
                farthest, distance = i, d
        if farthest != first:
            keep.add(farthest)
            pending.extend([(first, farthest), (farthest, last)])
    return [[round(value, 5) for value in points[i][:2]] for i in sorted(keep)]

def feature(geometry, properties=None):
    return {'type':'Feature', 'properties':properties or {}, 'geometry':geometry}

def point(coordinates, name, rank):
    return feature({'type':'Point','coordinates':coordinates}, {'name':name, 'rank':rank})

def lines(name):
    result = []
    for f in read(name):
        g = f['geometry']
        if g is None:  # Source includes empty records with no drawable geometry.
            continue
        if g['type'] not in ('LineString','MultiLineString'):
            raise ValueError(f'Unexpected boundary type: {g["type"]}')
        coordinates = simplify(g['coordinates']) if g['type']=='LineString' else [simplify(line) for line in g['coordinates']]
        result.append(feature({'type':g['type'],'coordinates':coordinates}))
    return result

def save(name, features):
    path = out / name
    path.write_text(json.dumps({'type':'FeatureCollection','features':features}, separators=(',',':'), ensure_ascii=False)+'\n')
    print(name, len(features), path.stat().st_size)

# Keep the original land filename so both workbenches use the finer coastline.
save('land.geojson', [feature(f['geometry']) for f in read('ne_50m_land.geojson')])
save('country-boundaries.geojson', lines('ne_50m_admin_0_boundary_lines_land.geojson'))
save('state-boundaries.geojson', lines('ne_10m_admin_1_states_provinces_lines.geojson'))
save('country-labels.geojson', [point([p['LABEL_X'],p['LABEL_Y']],p.get('NAME_EN') or p['NAME'],p['LABELRANK']) for f in read('ne_50m_admin_0_countries.geojson') for p in [f['properties']]])
# Islands have additional label candidates. Use the principal candidate per admin-1 code.
states = {}
for f in sorted(read('ne_10m_admin_1_label_points.geojson'), key=lambda f:(f['properties']['adm0_sr'],f['properties']['scalerank'])):
    p = f['properties']
    if p['name']:
        states.setdefault(p['adm1_code'], point(f['geometry']['coordinates'],p['name'],p['scalerank']))
save('state-labels.geojson', list(states.values()))
save('city-labels.geojson', [point(f['geometry']['coordinates'],p.get('NAME_EN') or p['NAME'],p['SCALERANK']) for f in read('ne_50m_populated_places.geojson') for p in [f['properties']]])
for name in ['NotoSans-Regular.ttf','NotoSans-LICENSE.txt']:
    shutil.copyfile(source/name,out/name)
manifest['processing'] = 'scripts/prepare-map-geography.py; boundary lines simplified at 0.005 degrees, rounded to five decimals; principal admin-1 label candidate selected by adm0_sr then scalerank. Context only.'
for item in manifest['sources']:
    item['sourceSha256'] = hashlib.sha256((source/item['file']).read_bytes()).hexdigest()
manifest['files'] = {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.iterdir()) if p.is_file() and p.name!='geography-manifest.json'}
(out/'geography-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
