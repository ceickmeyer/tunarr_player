#!/usr/bin/env python3
"""Simple dev server with proxy for Tunarr API to avoid CORS issues."""

import http.server
import urllib.request
import urllib.error
import json
import os
import sys

TUNARR_BASE = 'http://192.168.0.26:8001'
PROXY_PREFIX = '/proxy'
PORT = 8002


class TunarrHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/config.json':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                json.loads(body)  # validate
                config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')
                with open(config_path, 'wb') as f:
                    f.write(body)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
            except (json.JSONDecodeError, IOError) as e:
                self.send_error(400, str(e))
        else:
            self.send_error(404)

    def do_GET(self):
        if self.path == '/config.json':
            config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')
            try:
                with open(config_path, 'rb') as f:
                    data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except FileNotFoundError:
                self.send_error(404, 'Not configured yet')
        elif self.path == '/colors.json':
            colors_path = os.path.expanduser('~/.config/noctalia/colors.json')
            try:
                with open(colors_path, 'rb') as f:
                    data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except FileNotFoundError:
                self.send_error(404, 'colors.json not found')
        elif self.path.startswith(PROXY_PREFIX):
            # Strip /proxy prefix and forward to Tunarr
            upstream_path = self.path[len(PROXY_PREFIX):]
            upstream_url = TUNARR_BASE + upstream_path
            try:
                with urllib.request.urlopen(upstream_url) as resp:
                    data = resp.read()
                    content_type = resp.headers.get('Content-Type', 'application/octet-stream')
                    self.send_response(200)
                    self.send_header('Content-Type', content_type)
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
            except urllib.error.URLError as e:
                self.send_error(502, f'Upstream error: {e}')
        else:
            # Serve static files normally
            super().do_GET()

    def log_message(self, fmt, *args):
        print(f'  {self.address_string()} - {fmt % args}')


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    with http.server.HTTPServer(('', PORT), TunarrHandler) as httpd:
        print(f'Tunarr player running at http://localhost:{PORT}')
        print(f'Proxying Tunarr API from {TUNARR_BASE}')
        print('Press Ctrl+C to stop.')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nStopped.')
