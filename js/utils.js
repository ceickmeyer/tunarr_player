// Configuration — defaults, overridden by loadConfig()
const CONFIG = {
    xmltvUrl:             '',
    m3uUrl:               '',
    guideHours:           4,
    updateInterval:       60000,
    cacheTTL:             5 * 60 * 1000,
    showBackgroundImages: true,
    noctaliaTheme:        true,
};

// Load user config into CONFIG.
// Checks localStorage first (fast), then falls back to server config.json.
// Returns false if no config exists anywhere (triggers redirect to config.html).
async function loadConfig() {
    const local = localStorage.getItem('tunarr_config');
    if (local) {
        const cfg = JSON.parse(local);
        if (cfg.xmltvUrl && cfg.m3uUrl) { _applyConfig(cfg); return true; }
    }
    try {
        const resp = await fetch('/config.json');
        if (!resp.ok) return false;
        const cfg = await resp.json();
        if (!cfg.xmltvUrl || !cfg.m3uUrl) return false;
        localStorage.setItem('tunarr_config', JSON.stringify(cfg)); // cache locally
        _applyConfig(cfg);
        return true;
    } catch (e) {
        return false;
    }
}

function _applyConfig(cfg) {
    CONFIG.xmltvUrl             = cfg.xmltvUrl;
    CONFIG.m3uUrl               = cfg.m3uUrl;
    CONFIG.guideHours           = cfg.guideHours           || 4;
    CONFIG.showBackgroundImages = cfg.showBackgroundImages  !== false;
    CONFIG.noctaliaTheme        = cfg.noctaliaTheme         !== false;
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchXMLTVData() {
    try {
        const cached = localStorage.getItem('tunarr_xmltv');
        if (cached) {
            const { ts, text } = JSON.parse(cached);
            if (Date.now() - ts < CONFIG.cacheTTL) {
                const xmlDoc = new DOMParser().parseFromString(text, 'text/xml');
                if (!xmlDoc.getElementsByTagName('parsererror').length) return xmlDoc;
            }
        }
        const response = await fetch(CONFIG.xmltvUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        localStorage.setItem('tunarr_xmltv', JSON.stringify({ ts: Date.now(), text }));
        const xmlDoc = new DOMParser().parseFromString(text, 'text/xml');
        if (xmlDoc.getElementsByTagName('parsererror').length) throw new Error('XML Parse Error');
        return xmlDoc;
    } catch (error) {
        console.error('XMLTV Fetch Error:', error);
        return null;
    }
}

async function fetchM3UData() {
    try {
        const cached = localStorage.getItem('tunarr_m3u');
        if (cached) {
            const { ts, channels } = JSON.parse(cached);
            if (Date.now() - ts < CONFIG.cacheTTL) return channels;
        }
        const response = await fetch(CONFIG.m3uUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const channels = parseM3U(await response.text());
        localStorage.setItem('tunarr_m3u', JSON.stringify({ ts: Date.now(), channels }));
        return channels;
    } catch (error) {
        console.error('M3U Fetch Error:', error);
        return [];
    }
}

function parseM3U(m3uText) {
    const channels = [];
    const lines = m3uText.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXTINF')) {
            const nextLine = lines[i + 1]?.trim();
            if (nextLine && !nextLine.startsWith('#')) {
                channels.push({
                    id:   (line.match(/tvg-id="([^"]+)"/)   || [])[1] || '',
                    name: (line.match(/tvg-name="([^"]+)"/) || [])[1] || 'Unknown',
                    logo: (line.match(/tvg-logo="([^"]+)"/) || [])[1] || '',
                    url:  nextLine,
                });
                i++;
            }
        }
    }
    return channels;
}

// ── Program lookups ───────────────────────────────────────────────────────────

function getChannelPrograms(xmlDoc, channelId, startTime, endTime) {
    if (!xmlDoc) return [];
    const programs = [];
    for (let prog of xmlDoc.querySelectorAll(`programme[channel="${channelId}"]`)) {
        const progStart = parseXMLTVTime(prog.getAttribute('start'));
        const progStop  = parseXMLTVTime(prog.getAttribute('stop'));
        if (progStart < endTime && progStop > startTime) {
            programs.push({
                title:  prog.querySelector('title')?.textContent  || 'Unknown',
                desc:   prog.querySelector('desc')?.textContent   || '',
                start:  progStart,
                stop:   progStop,
                rating: prog.querySelector('rating value')?.textContent || '',
                image:  prog.querySelector('icon')?.getAttribute('src') || '',
            });
        }
    }
    return programs.sort((a, b) => a.start - b.start);
}

// ── Time helpers ──────────────────────────────────────────────────────────────

function parseXMLTVTime(timeString) {
    const match = timeString.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
    if (!match) return new Date();
    if (match[7]) {
        const sign    = match[7][0] === '+' ? 1 : -1;
        const offsetMs = sign * (parseInt(match[7].slice(1,3)) * 60 + parseInt(match[7].slice(3,5))) * 60000;
        return new Date(Date.UTC(...[match[1], match[2]-1, match[3], match[4], match[5], match[6]].map(Number)) - offsetMs);
    }
    return new Date(...[match[1], match[2]-1, match[3], match[4], match[5], match[6]].map(Number));
}

function formatTime(date) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDuration(start, end) {
    return `${Math.round((end - start) / 60000)} min`;
}

function updateTimeDisplay() {
    const el = document.getElementById('current-time');
    if (el) el.textContent = new Date().toLocaleTimeString();
}

// ── Noctalia theming ──────────────────────────────────────────────────────────

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

async function applyNoctaliaColors() {
    if (!CONFIG.noctaliaTheme) return;
    try {
        const resp = await fetch('/colors.json');
        if (!resp.ok) return;
        const c = await resp.json();
        const r = document.documentElement.style;

        r.setProperty('--bg-primary',             c.mSurface);
        r.setProperty('--bg-secondary',           c.mSurfaceVariant);
        r.setProperty('--text-primary',           c.mOnSurface);
        r.setProperty('--text-secondary',         c.mOnSurfaceVariant);
        r.setProperty('--border-color',           c.mOutline);
        r.setProperty('--program-bg',             c.mSurfaceVariant);
        r.setProperty('--program-hover-bg',       hexToRgba(c.mHover, 0.12));
        r.setProperty('--current-program-bg',     hexToRgba(c.mPrimary, 0.10));
        r.setProperty('--current-program-border', c.mPrimary);
        r.setProperty('--button-bg',              c.mPrimary);
        r.setProperty('--button-hover-bg',        c.mTertiary);
        r.setProperty('--button-text',            c.mOnPrimary);
        r.setProperty('--controls-bg',            c.mSurface);
        r.setProperty('--tooltip-bg',             c.mSurfaceVariant);
        r.setProperty('--tooltip-text',           c.mOnSurface);
        r.setProperty('--error-bg',               hexToRgba(c.mError, 0.15));
        r.setProperty('--error-text',             c.mError);
        r.setProperty('--shadow',                 hexToRgba(c.mShadow, 0.8));
        r.setProperty('--accent-primary',         c.mPrimary);
        r.setProperty('--accent-secondary',       c.mSecondary);
        r.setProperty('--accent-tertiary',        c.mTertiary);
        r.setProperty('--accent-on-primary',      c.mOnPrimary);
    } catch (e) {
        console.warn('Noctalia colors unavailable, using defaults.');
    }
}

// ── Global floating tooltip ───────────────────────────────────────────────────

function attachTooltip(box, program, channelName = '') {
    box.addEventListener('mouseenter', () => {
        const tip = document.getElementById('global-tooltip');
        if (!tip) return;

        tip.innerHTML = `
            <div class="tip-channel">${channelName}</div>
            <h3>${program.title}</h3>
            ${CONFIG.showBackgroundImages && program.image ? `<img src="${program.image}" alt="">` : ''}
            <p>${program.desc || 'No description available.'}</p>
            <div class="tip-meta">
                <span>${formatTime(program.start)} – ${formatTime(program.stop)}</span>
                <span>${formatDuration(program.start, program.stop)}</span>
                ${program.rating ? `<span>${program.rating}</span>` : ''}
            </div>
        `;
        tip.style.display = 'block';
        tip.style.top  = '-9999px';
        tip.style.left = '-9999px';

        requestAnimationFrame(() => {
            const rect = box.getBoundingClientRect();
            const tRect = tip.getBoundingClientRect();
            let top  = rect.top - tRect.height - 10;
            let left = rect.left + rect.width / 2 - tRect.width / 2;
            if (top < 8) top = rect.bottom + 10;
            left = Math.max(8, Math.min(left, window.innerWidth - tRect.width - 8));
            tip.style.top  = `${top}px`;
            tip.style.left = `${left}px`;
        });
    });

    box.addEventListener('mouseleave', () => {
        const tip = document.getElementById('global-tooltip');
        if (tip) tip.style.display = 'none';
    });
}
