#!/usr/bin/env python3
"""Dev server that never caches. Python's default http.server sends no cache
headers, so a browser will happily serve a stale ES module for hours."""

import sys
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))


class NoStoreHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write('%s %s\n' % (self.address_string(), fmt % args))


NoStoreHandler.extensions_map.update({
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.glb': 'model/gltf-binary',
})


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8177
    server = ThreadingHTTPServer(('127.0.0.1', port), NoStoreHandler)
    print('Snack Pack dev server: http://127.0.0.1:%d/  (root %s)' % (port, ROOT))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nstopped')
        server.server_close()


if __name__ == '__main__':
    main()
