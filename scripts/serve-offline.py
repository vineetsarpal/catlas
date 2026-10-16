#!/usr/bin/env python3
"""Serve this extracted distribution on its stable, loopback-only local origin."""
import argparse
import functools
import http.server
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=4178, help='Default 4178; changing port creates a separate browser history origin')
args = parser.parse_args()
root = Path(__file__).resolve().parent / 'dist'
if not (root / 'index.html').is_file():
    parser.error('Missing dist/index.html; extract the complete offline zip first.')
class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js':'text/javascript', '.mjs':'text/javascript', '.geojson':'application/geo+json'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
try:
    with http.server.ThreadingHTTPServer(('127.0.0.1', args.port), functools.partial(Handler, directory=str(root))) as server:
        print(f'Catlas offline: http://127.0.0.1:{args.port}/ (Ctrl+C to stop)', flush=True)
        server.serve_forever()
except KeyboardInterrupt:
    pass
