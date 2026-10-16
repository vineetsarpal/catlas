#!/usr/bin/env python3
"""Package already built local assets, measured integrity metadata and dependency notices."""
import hashlib
import json
import re
import shutil
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
OUT = ROOT / 'release'
if not (DIST / 'index.html').exists():
    raise SystemExit('Run npm run build first.')

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

# Include all installed runtime dependencies and transitive dependencies from the
# pinned lockfile, conservatively including packages a bundler might tree-shake.
notices = ['# Third-party notices\n\nVerbatim installed runtime license and notice texts. Generated from package-lock.json and the installed packages.\n']
lock = json.loads((ROOT / 'package-lock.json').read_text())
for name, package in sorted(lock['packages'].items()):
    if not name or package.get('dev'):
        continue
    directory = ROOT / name
    licenses = sorted(f for f in directory.iterdir() if f.is_file() and re.match(r'^(license|licence|copying|notice)(\.|$)', f.name, re.I))
    if not licenses and name.endswith('/murmurhash-js'):
        licenses = [directory / 'README.md'] # Contains the complete MIT notice.
    if not licenses:
        raise SystemExit(f'License text missing: {name}')
    notices.append(f'\n## {name.removeprefix("node_modules/")} {package["version"]} — {package.get("license", "see notice")}\n')
    for file in licenses:
        notices.extend([f'\n### {file.name}\n\n', file.read_text(), '\n'])
(DIST / 'THIRD_PARTY_NOTICES.md').write_text(''.join(notices))
manifest = json.loads((ROOT / 'src/data/evidence-manifest.json').read_text())
(DIST / 'evidence/capture-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
for file in manifest['files']:
    path = DIST / 'evidence' / file['file']
    if sha(path) != file['sha256']:
        raise SystemExit(f'Captured evidence digest mismatch: {path}')
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
