#!/usr/bin/env python3
"""Simple dev server with proxy for Tunarr API to avoid CORS issues."""

import http.server
import urllib.request
import urllib.error
import json
import os
import sys

TUNARR_BASE_DEFAULT = 'http://192.168.0.26:8001'
PROXY_PREFIX = '/proxy'
PORT = 8002


def get_tunarr_base():
    """Read the configured Tunarr server URL from config.json, falling back to the default."""
    config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')
    try:
        with open(config_path, 'rb') as f:
            cfg = json.load(f)
        server_url = cfg.get('serverUrl', '').rstrip('/')
        if server_url:
            return server_url
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return TUNARR_BASE_DEFAULT


SYNC_STATE = os.path.expanduser('~/docker/kometa/tunarr-sync.json')


def tunarr_json(path, body=None, method='GET'):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(get_tunarr_base() + path, data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
    return json.loads(raw) if raw else None


def channel_list():
    """Every Tunarr channel, flagged with whether tunarr-sync.py made it (and from which collection)."""
    try:
        with open(SYNC_STATE) as f:
            generated = {v['id'] if isinstance(v, dict) else v: k for k, v in json.load(f).items()}
    except (FileNotFoundError, json.JSONDecodeError):
        generated = {}
    return [{
        'id': c['id'], 'number': c['number'], 'name': c['name'],
        'hidden': bool(c.get('stealth')),
        'programCount': c.get('programCount', 0), 'duration': c.get('duration', 0),
        'collection': generated.get(c['id']),
    } for c in sorted(tunarr_json('/api/channels'), key=lambda c: c['number'])]


class TunarrHandler(http.server.SimpleHTTPRequestHandler):
    def send_json(self, obj, status=200):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path == '/channels-data':
            # {"ids": [...], "hidden": bool} — flips Tunarr's "stealth" flag, which drops
            # the channel from the M3U/XMLTV (so the guide and Plex) without deleting it.
            try:
                req = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
                failed = []
                for cid in req['ids']:
                    try:
                        full = tunarr_json(f'/api/channels/{cid}')
                        if bool(full.get('stealth')) != bool(req['hidden']):
                            full['stealth'] = bool(req['hidden'])
                            tunarr_json(f'/api/channels/{cid}', full, 'PUT')
                    except urllib.error.URLError:
                        failed.append(cid)
                self.send_json({'failed': failed, 'channels': channel_list()})
            except (json.JSONDecodeError, KeyError, TypeError) as e:
                self.send_error(400, str(e))
            except urllib.error.URLError as e:
                self.send_error(502, f'Upstream error: {e}')
        elif self.path == '/config.json':
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
        if self.path == '/channels-data':
            try:
                self.send_json({'channels': channel_list()})
            except urllib.error.URLError as e:
                self.send_error(502, f'Upstream error: {e}')
        elif self.path == '/config.json':
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
            upstream_url = get_tunarr_base() + upstream_path
            try:
                with urllib.request.urlopen(upstream_url) as resp:
                    data = resp.read()
                    content_type = resp.headers.get('Content-Type', 'application/octet-stream')
                    if 'mpegurl' in content_type.lower() or upstream_path.endswith('.m3u8'):
                        # Tunarr's HLS playlists reference sub-playlists/segments by
                        # absolute path (e.g. /stream/channels/...). Left as-is, the
                        # browser resolves those against our own origin and loses the
                        # /proxy prefix, so rewrite them to keep routing through it.
                        text = data.decode('utf-8')
                        text = '\n'.join(
                            PROXY_PREFIX + line if line.startswith('/') else line
                            for line in text.split('\n')
                        )
                        data = text.encode('utf-8')
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
    with http.server.ThreadingHTTPServer(('', PORT), TunarrHandler) as httpd:
        print(f'Tunarr player running at http://localhost:{PORT}')
        print(f'Proxying Tunarr API from {get_tunarr_base()}')
        print('Press Ctrl+C to stop.')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nStopped.')
