let xmltvData   = null;
let m3uChannels = [];
let visibleHours;
let windowStart;


document.addEventListener('DOMContentLoaded', initializeGuide);

async function initializeGuide() {
    if (!await loadConfig()) { window.location.href = 'config.html'; return; }
    await applyNoctaliaColors();

    const cfg = JSON.parse(localStorage.getItem('tunarr_config') || '{}');
    const tunarrLink = document.getElementById('tunarr-link');
    if (tunarrLink && cfg.serverUrl) tunarrLink.href = cfg.serverUrl;

    visibleHours = CONFIG.guideHours;
    windowStart  = roundDownTo30(new Date());
    renderTimeRuler();
    updateTimeIndicator();

    document.getElementById('shuffle-btn').addEventListener('click', shuffleChannel);

    xmltvData   = await fetchXMLTVData();
    m3uChannels = await fetchM3UData();

    if (!xmltvData || m3uChannels.length === 0) {
        showError('Failed to load guide data. Check that Tunarr is reachable.');
        return;
    }

    renderAll();
    updateTimeDisplay();

    setInterval(updateTimeIndicator, 30000);
    setInterval(updateTimeDisplay,   60000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function roundDownTo30(date) {
    const d = new Date(date);
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() >= 30 ? 30 : 0);
    return d;
}

function windowEnd() {
    return new Date(windowStart.getTime() + visibleHours * 3600000);
}

function timeToFrac(time) {
    return (time - windowStart) / (visibleHours * 3600000);
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderAll() {
    renderTimeRuler();
    renderGuide();
    renderGridLines();
    updateTimeIndicator();
}

function renderTimeRuler() {
    const ruler = document.getElementById('time-ruler');
    ruler.innerHTML = '';

    const intervalMs  = visibleHours <= 3 ? 30 * 60000 : 60 * 60000;
    const endMs       = windowEnd().getTime();
    const firstMarker = Math.ceil(windowStart.getTime() / intervalMs) * intervalMs;

    for (let t = firstMarker; t < endMs; t += intervalMs) {
        const frac = timeToFrac(new Date(t));
        if (frac < 0 || frac > 1) continue;

        const marker = document.createElement('div');
        marker.className = 'time-marker';
        marker.style.left = `${frac * 100}%`;
        marker.textContent = formatTime(new Date(t));
        ruler.appendChild(marker);
    }

    // Current time bubble
    const now     = new Date();
    const nowFrac = timeToFrac(now);
    if (nowFrac >= 0 && nowFrac <= 1) {
        const bubble = document.createElement('div');
        bubble.id        = 'current-time-bubble';
        bubble.className = 'current-time-bubble';
        bubble.style.left = `${nowFrac * 100}%`;
        bubble.textContent = formatTime(now);
        ruler.appendChild(bubble);
    }
}

function renderGridLines() {
    const rows = document.getElementById('guide-container');
    rows.querySelectorAll('.guide-grid-line').forEach(el => el.remove());

    const intervalMs  = visibleHours <= 3 ? 30 * 60000 : 60 * 60000;
    const endMs       = windowEnd().getTime();
    const firstMarker = Math.ceil(windowStart.getTime() / intervalMs) * intervalMs;

    for (let t = firstMarker; t < endMs; t += intervalMs) {
        const frac = timeToFrac(new Date(t));
        if (frac < 0 || frac > 1) continue;

        const line = document.createElement('div');
        line.className   = 'guide-grid-line';
        line.style.left  = `calc(150px + ${frac.toFixed(6)} * (100% - 150px))`;
        rows.appendChild(line);
    }
}

function isMobile() {
    return window.innerWidth <= 600;
}

function renderGuide() {
    const container = document.getElementById('guide-container');
    container.innerHTML = '';

    if (isMobile()) {
        renderGuideMobile(container);
    } else {
        renderGuideDesktop(container);
    }
}

function renderGuideDesktop(container) {
    const end = windowEnd();
    const now = new Date();

    for (const channel of m3uChannels) {
        const row = document.createElement('div');
        row.className = 'guide-row';

        const label = document.createElement('div');
        label.className   = 'channel-label';
        label.textContent = channel.name;
        label.title       = channel.name;
        row.appendChild(label);

        const timeline = document.createElement('div');
        timeline.className = 'timeline';

        for (const prog of getChannelPrograms(xmltvData, channel.id, windowStart, end)) {
            const startFrac = Math.max(timeToFrac(prog.start), 0);
            const endFrac   = Math.min(timeToFrac(prog.stop),  1);
            if (startFrac >= 1 || endFrac <= 0) continue;

            const box = document.createElement('div');
            box.className   = 'program-box';
            box.style.left  = `${startFrac * 100}%`;
            box.style.width = `calc(${(endFrac - startFrac) * 100}% - 2px)`;

            if (prog.start <= now && now < prog.stop) box.classList.add('now-playing');

            box.innerHTML = `
                <div class="program-title">${prog.title}</div>
                <div class="program-time">${formatTime(prog.start)} – ${formatTime(prog.stop)}</div>
            `;

            if (CONFIG.showBackgroundImages && prog.image) {
                const bg = document.createElement('div');
                bg.className             = 'program-bg-image';
                bg.style.backgroundImage = `url("${prog.image}")`;
                box.insertBefore(bg, box.firstChild);
            }

            attachTooltip(box, prog, channel.name);
            box.addEventListener('click', () => launchChannel(channel));
            timeline.appendChild(box);
        }

        row.appendChild(timeline);
        container.appendChild(row);
    }
}

function renderGuideMobile(container) {
    const now = new Date();

    for (const channel of m3uChannels) {
        const row = document.createElement('div');
        row.className = 'guide-row';

        const label = document.createElement('div');
        label.className   = 'channel-label';
        label.textContent = channel.name;
        label.title       = channel.name;
        row.appendChild(label);

        const timeline = document.createElement('div');
        timeline.className = 'timeline';

        const prog = getChannelPrograms(xmltvData, channel.id, now, new Date(now.getTime() + 1))[0];
        if (prog) {
            const box = document.createElement('div');
            box.className = 'program-box now-playing';
            box.innerHTML = `
                <div class="program-title">${prog.title}</div>
                <div class="program-time">${formatTime(prog.start)} – ${formatTime(prog.stop)}</div>
            `;
            box.addEventListener('click', () => launchChannel(channel));
            timeline.appendChild(box);
        }

        row.appendChild(timeline);
        container.appendChild(row);
    }
}

function updateTimeIndicator() {
    const now    = new Date();
    const frac   = timeToFrac(now);
    const line   = document.getElementById('current-time-line');
    const bubble = document.getElementById('current-time-bubble');

    if (line) {
        if (frac < 0 || frac > 1) {
            line.style.display = 'none';
        } else {
            line.style.display = 'block';
            line.style.left    = `calc(150px + ${frac.toFixed(6)} * (100% - 150px))`;
        }
    }

    if (bubble) {
        bubble.textContent = formatTime(now);
        bubble.style.left  = `${frac * 100}%`;
    }
}

// ── Actions ───────────────────────────────────────────────────────────────────

function launchChannel(channel) {
    sessionStorage.setItem('selectedChannel', JSON.stringify({
        id: channel.id, name: channel.name, url: channel.url, logo: channel.logo,
    }));
    window.location.href = 'player.html';
}

function shuffleChannel() {
    if (!m3uChannels.length) return;
    launchChannel(m3uChannels[Math.floor(Math.random() * m3uChannels.length)]);
}

function showError(message) {
    document.getElementById('guide-container').innerHTML = `<div class="error">${message}</div>`;
}
