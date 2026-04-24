let hls            = null;
let videoElement   = null;
let xmltvData      = null;
let currentChannel = null;
let m3uChannels    = [];
let visibleHours;
let windowStart;

document.addEventListener('DOMContentLoaded', initializePlayer);

async function initializePlayer() {
    if (!await loadConfig()) { window.location.href = 'config.html'; return; }

    await applyNoctaliaColors();

    const channelJson = sessionStorage.getItem('selectedChannel');
    if (!channelJson) { window.location.href = 'index.html'; return; }
    currentChannel = JSON.parse(channelJson);

    visibleHours = CONFIG.guideHours;
    windowStart  = roundDownTo30(new Date());
    renderTimeRuler();
    updateTimeIndicator();

    [xmltvData, m3uChannels] = await Promise.all([fetchXMLTVData(), fetchM3UData()]);

    videoElement = document.getElementById('video-player');
    setupVideoPlayer(currentChannel.url);

    document.getElementById('reload-stream').addEventListener('click', reloadStream);
    setupPiP();
    document.getElementById('channel-name').textContent = currentChannel.name;

    updateCurrentProgram();
    renderFullGuide();

    setInterval(updateTimeIndicator, 30000);
    setInterval(() => { updateCurrentProgram(); renderFullGuide(); }, CONFIG.updateInterval);
}

// ── Video player ──────────────────────────────────────────────────────────────

function setupVideoPlayer(streamUrl) {
    if (Hls.isSupported()) {
        hls = new Hls({
            debug: false, enableWorker: true,
            maxBufferLength: 30, maxMaxBufferLength: 600,
            maxBufferSize: 60 * 1000 * 1000, maxBufferHole: 0.5,
            lowLatencyMode: false,
        });
        hls.loadSource(streamUrl);
        hls.attachMedia(videoElement);
        hls.on(Hls.Events.ERROR, handleHLSError);
    } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
        videoElement.src = streamUrl;
    } else {
        showError('HLS playback not supported in this browser.');
    }
}

function handleHLSError(event, data) {
    if (!data.fatal) return;
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
    else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
    else console.error('Unrecoverable HLS error:', data);
}

function setupPiP() {
    const btn = document.getElementById('pip-btn');
    if (!document.pictureInPictureEnabled) {
        btn.style.display = 'none';
        return;
    }
    btn.addEventListener('click', async () => {
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else {
                await videoElement.requestPictureInPicture();
            }
        } catch (e) {
            console.warn('PiP error:', e);
        }
    });
    videoElement.addEventListener('enterpictureinpicture', () => {
        btn.textContent = '✕ Exit PiP';
        btn.classList.add('pip-active');
    });
    videoElement.addEventListener('leavepictureinpicture', () => {
        btn.textContent = '⧉ Picture in Picture';
        btn.classList.remove('pip-active');
    });
}

function reloadStream() {
    const btn = document.getElementById('reload-stream');
    btn.disabled = true;
    btn.style.opacity = '0.55';
    if (hls) { hls.destroy(); hls = null; }
    setupVideoPlayer(currentChannel.url);
    setTimeout(() => { btn.disabled = false; btn.style.opacity = ''; }, 2000);
}

function switchChannel(channel) {
    currentChannel = channel;
    document.getElementById('channel-name').textContent = channel.name;
    sessionStorage.setItem('selectedChannel', JSON.stringify(channel));
    if (hls) { hls.destroy(); hls = null; }
    setupVideoPlayer(channel.url);
    updateCurrentProgram();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    renderFullGuide();
}

// ── Current program info ──────────────────────────────────────────────────────

function updateCurrentProgram() {
    if (!xmltvData) return;
    const now      = new Date();
    const programs = getChannelPrograms(xmltvData, currentChannel.id, now, new Date(now.getTime() + 4 * 3600000));
    const prog     = programs[0];
    const next     = programs[1];

    document.getElementById('current-program').textContent = prog
        ? `${prog.title}  ·  ${formatTime(prog.start)} – ${formatTime(prog.stop)}`
        : currentChannel.name;

    const nextEl  = document.getElementById('topbar-next');
    const nextSep = document.querySelector('.topbar-next-sep');
    if (nextEl) {
        nextEl.textContent     = next ? `Up next: ${next.title}` : '';
        if (nextSep) nextSep.style.visibility = next ? '' : 'hidden';
    }
}

// ── Time-grid helpers ─────────────────────────────────────────────────────────

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
        marker.className  = 'time-marker';
        marker.style.left = `${frac * 100}%`;
        marker.textContent = formatTime(new Date(t));
        ruler.appendChild(marker);
    }

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
    const container = document.getElementById('guide-container');
    container.querySelectorAll('.guide-grid-line').forEach(el => el.remove());

    const intervalMs  = visibleHours <= 3 ? 30 * 60000 : 60 * 60000;
    const endMs       = windowEnd().getTime();
    const firstMarker = Math.ceil(windowStart.getTime() / intervalMs) * intervalMs;

    for (let t = firstMarker; t < endMs; t += intervalMs) {
        const frac = timeToFrac(new Date(t));
        if (frac < 0 || frac > 1) continue;
        const line = document.createElement('div');
        line.className  = 'guide-grid-line';
        line.style.left = `calc(150px + ${frac.toFixed(6)} * (100% - 150px))`;
        container.appendChild(line);
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

// ── Full channel guide ────────────────────────────────────────────────────────

function isMobile() {
    return window.innerWidth <= 600;
}

function renderFullGuide() {
    if (!xmltvData || !m3uChannels.length) return;

    const container = document.getElementById('guide-container');
    container.innerHTML = '';

    if (isMobile()) {
        renderFullGuideMobile(container);
    } else {
        renderFullGuideDesktop(container);
        renderGridLines();
        updateTimeIndicator();
    }
}

function renderFullGuideDesktop(container) {
    const end = windowEnd();
    const now = new Date();

    const ordered = [
        ...m3uChannels.filter(ch => ch.id === currentChannel.id),
        ...m3uChannels.filter(ch => ch.id !== currentChannel.id),
    ];

    for (const channel of ordered) {
        const row = document.createElement('div');
        row.className = 'guide-row';
        if (channel.id === currentChannel.id) row.classList.add('active-channel');

        const label = buildChannelLabel(channel);
        label.addEventListener('click', () => switchChannel(channel));
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
            box.addEventListener('click', () => switchChannel(channel));
            timeline.appendChild(box);
        }

        row.appendChild(timeline);
        container.appendChild(row);
    }
}

function renderFullGuideMobile(container) {
    const now = new Date();

    const ordered = [
        ...m3uChannels.filter(ch => ch.id === currentChannel.id),
        ...m3uChannels.filter(ch => ch.id !== currentChannel.id),
    ];

    for (const channel of ordered) {
        const row = document.createElement('div');
        row.className = 'guide-row';
        if (channel.id === currentChannel.id) row.classList.add('active-channel');

        const label = buildChannelLabel(channel);
        label.addEventListener('click', () => switchChannel(channel));
        row.appendChild(label);

        const timeline = document.createElement('div');
        timeline.className = 'timeline';

        const lookahead = new Date(now.getTime() + 4 * 3600000);
        const programs  = getChannelPrograms(xmltvData, channel.id, now, lookahead);
        const prog      = programs[0];
        const next      = programs[1];

        if (prog) {
            const elapsed  = now - prog.start;
            const duration = prog.stop - prog.start;
            const pct      = Math.min(100, Math.max(0, (elapsed / duration) * 100));
            const minsLeft = Math.round((prog.stop - now) / 60000);

            const box = document.createElement('div');
            box.className = 'program-box now-playing mobile-program-card';
            box.innerHTML = `
                <div class="mobile-prog-main">
                    <div class="program-title">${prog.title}</div>
                    <div class="mobile-prog-meta">
                        <span class="program-time">${formatTime(prog.start)} – ${formatTime(prog.stop)}</span>
                        <span class="mobile-time-left">${minsLeft} min left</span>
                    </div>
                    <div class="mobile-progress-bar"><div class="mobile-progress-fill" style="width:${pct}%"></div></div>
                </div>
                ${next ? `<div class="mobile-next">Next: <span>${next.title}</span> · ${formatTime(next.start)}</div>` : ''}
            `;
            box.addEventListener('click', () => switchChannel(channel));
            timeline.appendChild(box);
        }

        row.appendChild(timeline);
        container.appendChild(row);
    }
}

function showError(message) {
    const section = document.querySelector('.player-section');
    if (section) section.innerHTML = `<div class="error">${message}</div>`;
}
