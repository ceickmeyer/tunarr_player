# Tunarr Player

A lightweight, dark-mode TV guide and HLS streaming player for [Tunarr](https://github.com/chrisbenincasa/tunarr). No build tools, no frameworks — just HTML, CSS, and vanilla JavaScript. **Made with Claude Code**, edited by a human. Does not have anything that could compromise your system, it just plays video.

**Desktop**
![Desktop guide screenshot](https://github.com/ceickmeyer/tunarr_player/blob/main/screenshot.png?raw=true)

**Mobile**
![Mobile guide screenshot](https://github.com/ceickmeyer/tunarr_player/blob/main/mobile_screenshot.png?raw=true)

## Features

- Time-based TV guide with a sticky time ruler and live current-time indicator
- Click any program to open a player with the full channel guide below
- HLS streaming via [HLS.js](https://github.com/video-dev/hls.js)
- Blurred poster artwork as program tile backgrounds (desktop only)
- Hover tooltips with description, duration, and rating
- Shuffle button to pick a random channel
- Picture-in-Picture button
- Caches guide data locally (5-minute TTL) for instant reloads
- Mobile layout shows current program, progress bar, time remaining, and next up per channel
- [Noctalia](https://noctalia.dev/) wallpaper-based theming (optional) — falls back to Catppuccin Mocha dark theme

## Requirements

- A running [Tunarr](https://github.com/chrisbenincasa/tunarr) instance on your local network
- Python 3 (to serve the app locally)
- A modern browser (Firefox or Chromium-based)

## Setup

**1. Clone the repo**

```bash
git clone https://github.com/ceickmeyer/tunarr_player
cd tunarr_player
```

**2. Start the local server**

```bash
python server.py
```

**3. Open the app and configure it**

Navigate to `http://localhost:8000` in your browser. On first launch you'll be taken to the setup page automatically.

Enter your Tunarr server URL (e.g. `http://192.168.1.x:8001`), click **Auto-fill**, then **Save & Open Guide**.

## Configuration

The setup page (`/config.html`) lets you change:

| Setting | Description |
|---|---|
| Tunarr server URL | Base URL of your Tunarr instance |
| XMLTV URL | Auto-filled — override if using an external guide source |
| M3U URL | Auto-filled — override if using an external channel list |
| Hours to display | How many hours of guide to show (default: 4) |
| Background artwork | Toggle blurred poster images on program tiles |
| Noctalia theming | Auto-apply colors from Noctalia (Linux/Hyprland only) |

Settings are stored in your browser's `localStorage`. Use the **Clear Cache** button after changing your server URL. CTRL+Shift+R after any pull should resolve changes.

## Noctalia Theming (optional)

If you use [Noctalia](https://noctalia.dev/) for wallpaper-based color schemes, the app will automatically read `~/.config/noctalia/colors.json` via the local server and apply your current palette. Enable the toggle in config. If the file isn't present the app falls back to the default Catppuccin Mocha dark theme.

## Project Structure

```
tunarr-player/
├── index.html      # TV guide page
├── player.html     # Player + full channel guide
├── config.html     # Setup page
├── server.py       # Local file server + Noctalia colors proxy
├── css/
│   ├── style.css   # Layout and component styles
│   └── dark.css    # Default Catppuccin Mocha theme (overridden by Noctalia)
└── js/
    ├── utils.js    # Config, data fetching, caching, theming, tooltips
    ├── app.js      # Guide page logic
    ├── player.js   # Player page logic
    └── config.js   # Setup page logic
```

## Credits

- [Tunarr](https://github.com/chrisbenincasa/tunarr) — the IPTV server this is built for
- [HLS.js](https://github.com/video-dev/hls.js) — HLS streaming in the browser (Apache 2.0)
