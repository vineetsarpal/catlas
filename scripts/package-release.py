#!/usr/bin/env python3
"""Package already built local assets, measured integrity metadata and dependency notices."""
import hashlib
import gzip
import json
import re
import shutil
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'frontend/dist'
OUT = ROOT / 'release'
if not (DIST / 'index.html').exists():
    raise SystemExit('Run npm run build first.')

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

# Follow the frontend's declared runtime dependency graph. Backend tooling is
# installed in the same workspace but is not redistributed in the static ZIP.
notices = ['# Third-party notices\n\nVerbatim frontend/runtime license and notice texts. Generated from package-lock.json, installed packages and explicitly identified supplemental upstream notices.\n']
supplemental_notices = {
    ('react-remove-scroll-bar', '2.3.8'): (
        ROOT / 'scripts/licenses/react-remove-scroll-bar-2.3.8.LICENSE',
        'https://github.com/theKashey/react-remove-scroll-bar/blob/8ca9ba5ea52de03308fe8ced94f7b159a44d28ff/LICENSE',
    ),
}
lock = json.loads((ROOT / 'package-lock.json').read_text())
packages = lock['packages']
visited = set()
redistributed = set()
def visit(name):
    if name in visited:
        return
    visited.add(name)
    package = packages[name]
    if package.get('link'):
        visit(package['resolved'])
        return
    if name not in ('frontend', 'shared'):
        redistributed.add(name)
    for dep in dict(package.get('dependencies', {}), **package.get('optionalDependencies', {})):
        candidates = [str(parent / 'node_modules' / dep) for parent in (Path(name), *Path(name).parents)]
        target = next((candidate for candidate in candidates if candidate in packages), None)
        optional = dep in package.get('optionalDependencies', {})
        if target is None:
            if optional:
                continue
            raise SystemExit(f'Runtime dependency missing from lockfile: {name} -> {dep}')
        if optional and not (ROOT / target).exists():
            continue
        visit(target)
visit('frontend')
for name in sorted(redistributed):
    package = packages[name]
    directory = ROOT / name
    licenses = sorted(f for f in directory.iterdir() if f.is_file() and re.match(r'^(license|licence|copying|notice)(\.|$)', f.name, re.I))
    if not licenses and name.endswith('/murmurhash-js'):
        licenses = [directory / 'README.md'] # Contains the complete MIT notice.
    supplemental = supplemental_notices.get((name.removeprefix('node_modules/'), package['version'])) if not licenses else None
    if supplemental:
        licenses = [supplemental[0]]
    if not licenses:
        raise SystemExit(f'License text missing: {name}')
    notices.append(f'\n## {name.removeprefix("node_modules/")} {package["version"]} — {package.get("license", "see notice")}\n')
    if supplemental:
        notices.append(f'\nSupplemental upstream notice (omitted from the npm tarball): {supplemental[1]}\n')
    for file in licenses:
        notices.extend([f'\n### {file.name}\n\n', file.read_text(), '\n'])
(DIST / 'THIRD_PARTY_NOTICES.md').write_text(''.join(notices))
manifest = json.loads((ROOT / 'frontend/src/data/evidence-manifest.json').read_text())
(DIST / 'evidence/capture-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
for file in manifest['files']:
    path = DIST / 'evidence' / file['file']
    if sha(path) != file['sha256']:
        raise SystemExit(f'Captured evidence digest mismatch: {path}')
shaking = DIST / 'evidence/shaking/ridgecrest-grid.xml.gz'
if hashlib.sha256(gzip.decompress(shaking.read_bytes())).hexdigest() != 'f4fbcf36e9098963ddc2ea82656974c268b50df5dfdb49b9bf9ffae72ea8e306':
    raise SystemExit('Captured Ridgecrest numeric shaking grid digest mismatch.')
(DIST / 'EXPOSURE.md').write_text((ROOT / 'docs/catlas-exposure.md').read_text())
(DIST / 'PRESENTER.md').write_text((ROOT / 'docs/catlas-presenter.md').read_text())
OUT.mkdir(exist_ok=True)
stage = OUT / 'catlas-offline'
if stage.exists():
    shutil.rmtree(stage)
stage.mkdir()
shutil.copytree(DIST, stage / 'dist')
shutil.copyfile(ROOT / 'scripts/serve-offline.py', stage / 'serve.py')
shutil.copyfile(ROOT / 'docs/catlas-offline.md', stage / 'README.md')
metadata = {
 'schemaVersion':1,
 'packagedAt':datetime.now(timezone.utc).isoformat(),
 'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
 'workingTreeDirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()),
 'declaration':'Packaging observation, not evidence capture or historical revision metadata. ZIP entry timestamps are normalized container metadata (1980-01-01).',
 'files':{str(p.relative_to(stage)):sha(p) for p in sorted(stage.rglob('*')) if p.is_file()},
}
(stage / 'release-manifest.json').write_text(json.dumps(metadata,indent=2)+'\n')
archive = OUT / 'catlas-offline.zip'
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as zip:
    for path in sorted(stage.rglob('*')):
        if path.is_file():
            info=zipfile.ZipInfo('catlas-offline/'+str(path.relative_to(stage)), date_time=(1980,1,1,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED
            info.external_attr=0o100644 << 16
            zip.writestr(info,path.read_bytes())
(OUT / 'catlas-offline.zip.sha256').write_text(f'{sha(archive)}  catlas-offline.zip\n')
pages = OUT / 'pages'
if pages.exists():
    shutil.rmtree(pages)
shutil.copytree(DIST, pages)
shutil.copyfile(archive, pages / archive.name)
shutil.copyfile(OUT / 'catlas-offline.zip.sha256', pages / 'catlas-offline.zip.sha256')
print(json.dumps({'pagesDirectory':str(pages),'archive':str(archive),'bytes':archive.stat().st_size,'sha256':sha(archive),'packagedAt':metadata['packagedAt']},indent=2))
