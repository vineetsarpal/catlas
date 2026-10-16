#!/usr/bin/env python3
"""Extract and verify the exact zip tested by production-browser acceptance."""
import hashlib
import json
import shutil
import zipfile
from pathlib import Path
root=Path(__file__).resolve().parent.parent
extract=root/'release/verification'
if extract.exists():shutil.rmtree(extract)
with zipfile.ZipFile(root/'release/catlas-offline.zip') as zip:zip.extractall(extract)
stage=extract/'catlas-offline'
for name,digest in json.loads((stage/'release-manifest.json').read_text())['files'].items():
    if hashlib.sha256((stage/name).read_bytes()).hexdigest()!=digest:raise SystemExit(f'Integrity failed: {name}')
print(f'Extracted and verified {stage}')
