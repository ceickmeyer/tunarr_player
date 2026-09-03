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

    // sessionStorage can hold a stale channel (e.g. an old stream URL) from
    // before a config/proxy change — always prefer the freshly fetched copy.
    const fresh = m3uChannels.find(ch => ch.id === currentChannel.id);
    if (fresh) currentChannel = fresh;

    videoElement = document.getElementById('video-player');
    setupVideoPlayer(currentChannel.url);

    document.getElementById('reload-stream').addEventListener('click', reloadStream);
    setupPiP();
    setupPanelToggle();
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
    if (isMobile()) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
        const inner = document.querySelector('.info-panel-inner');
        if (inner) inner.scrollTop = 0;
    }
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

    renderInfoPanel();
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
    if (!isMobile()) return; // desktop uses the info panel instead

    const container = document.getElementById('guide-container');
    container.innerHTML = '';
    renderFullGuideMobile(container);
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

// ── Desktop info panel ────────────────────────────────────────────────────────

function renderInfoPanel() {
    if (isMobile() || !xmltvData) return;

    const now      = new Date();
    const lookahead = new Date(now.getTime() + 8 * 3600000);

    // Now Playing + Up Next for the active channel
    const programs = getChannelPrograms(xmltvData, currentChannel.id, now, lookahead);
    const current  = programs[0];
    const next     = programs[1];

    const nowEl = document.getElementById('info-now');
    if (nowEl) {
        if (current) {
            const elapsed  = now - current.start;
            const duration = current.stop - current.start;
            const pct      = Math.min(100, Math.max(0, (elapsed / duration) * 100));
            const minsLeft = Math.round((current.stop - now) / 60000);
            nowEl.innerHTML = `
                <div class="info-label">Now Playing</div>
                <div class="info-now-layout">
                    ${current.image ? `<img class="info-poster" src="${current.image}" alt="" loading="lazy">` : ''}
                    <div class="info-now-text">
                        <div class="info-prog-title">${current.title}</div>
                        <div class="info-prog-time">${formatTime(current.start)} – ${formatTime(current.stop)}</div>
                        <div class="info-progress"><div class="info-progress-fill" style="width:${pct}%"></div></div>
                        <div class="info-mins-left">${minsLeft} min left</div>
                        ${next ? `<div class="info-upnext-row">
                            <span class="info-upnext-label">Up Next</span>
                            <span class="info-upnext-title">${next.title}</span>
                        </div>` : ''}
                    </div>
                </div>
            `;
        } else {
            nowEl.innerHTML = `
                <div class="info-label">Now Playing</div>
                <div class="info-prog-title">${currentChannel.name}</div>
            `;
        }
    }

    const nextEl = document.getElementById('info-next');
    if (nextEl) nextEl.innerHTML = '';

    // Channel list — active channel floated to top
    const channelsEl = document.getElementById('info-channels');
    if (!channelsEl || !m3uChannels.length) return;

    const ordered = [
        ...m3uChannels.filter(ch => ch.id === currentChannel.id),
        ...m3uChannels.filter(ch => ch.id !== currentChannel.id),
    ];

    channelsEl.innerHTML = '<div class="info-channels-label">Channels</div>';

    for (const ch of ordered) {
        const chProgs  = getChannelPrograms(xmltvData, ch.id, now, new Date(now.getTime() + 6 * 3600000));
        const prog     = chProgs[0];
        const nextProg = chProgs[1];
        const isActive = ch.id === currentChannel.id;

        let pct = 0;
        if (prog) {
            const elapsed  = now - prog.start;
            const duration = prog.stop - prog.start;
            pct = Math.min(100, Math.max(0, (elapsed / duration) * 100));
        }

        const thumbHtml = (CONFIG.showSidebarPosters && prog && prog.image)
            ? `<img class="info-ch-thumb" src="${prog.image}" alt="" loading="lazy">`
            : '';

        let iconHtml = '';
        if (CONFIG.showChannelIcons) {
            const iconContent = ch.logo
                ? `<img class="info-ch-icon" src="${ch.logo}" alt="">`
                : DEFAULT_CHANNEL_ICON_SVG;
            iconHtml = `<div class="info-ch-icon-wrap">${iconContent}</div>`;
        }

        const item = document.createElement('div');
        item.className = 'info-channel-item' + (isActive ? ' active' : '');
        item.innerHTML = `
            ${thumbHtml}
            ${iconHtml}
            <div class="info-ch-details">
                <div class="info-ch-name">${ch.name}</div>
                ${prog ? `<div class="info-ch-prog">${prog.title}</div>` : ''}
                ${prog ? `<div class="info-ch-progress"><div class="info-ch-progress-fill" style="width:${pct}%"></div></div>` : ''}
            </div>
        `;
        if (!isActive) item.addEventListener('click', () => switchChannel(ch));
        attachChannelTooltip(item, ch, prog, nextProg);
        channelsEl.appendChild(item);
    }
}

function attachChannelTooltip(item, ch, nowProg, nextProg) {
    item.addEventListener('mouseenter', () => {
        const tip = document.getElementById('global-tooltip');
        if (!tip) return;

        const imageHtml = (CONFIG.showBackgroundImages && nowProg && nowProg.image)
            ? `<img src="${nowProg.image}" alt="">`
            : '';

        const metaHtml = nowProg
            ? `<div class="tip-meta">
                   <span>${formatTime(nowProg.start)} – ${formatTime(nowProg.stop)}</span>
                   <span>${formatDuration(nowProg.start, nowProg.stop)}</span>
                   ${nowProg.rating ? `<span>${nowProg.rating}</span>` : ''}
               </div>`
            : '';

        const upNextHtml = nextProg
            ? `<div class="tip-upnext">
                   <span class="tip-upnext-label">Up Next</span>
                   <span class="tip-upnext-title">${nextProg.title}</span>
                   <span class="tip-upnext-time">${formatTime(nextProg.start)}</span>
               </div>`
            : '';

        tip.innerHTML = `
            <div class="tip-channel">${ch.name}</div>
            <h3>${nowProg ? nowProg.title : ch.name}</h3>
            ${imageHtml}
            ${nowProg && nowProg.desc ? `<p>${nowProg.desc}</p>` : ''}
            ${metaHtml}
            ${upNextHtml}
        `;

        tip.style.display = 'block';
        tip.style.top  = '-9999px';
        tip.style.left = '-9999px';

        requestAnimationFrame(() => {
            const rect  = item.getBoundingClientRect();
            const tRect = tip.getBoundingClientRect();
            // Open to the left of the panel
            let left = rect.left - tRect.width - 12;
            let top  = rect.top;
            if (left < 8) left = rect.right + 12; // fallback: right side
            top = Math.max(8, Math.min(top, window.innerHeight - tRect.height - 8));
            tip.style.top  = `${top}px`;
            tip.style.left = `${left}px`;
        });
    });

    item.addEventListener('mouseleave', () => {
        const tip = document.getElementById('global-tooltip');
        if (tip) tip.style.display = 'none';
    });
}

function setupPanelToggle() {
    const btn = document.getElementById('panel-toggle-btn');
    if (!btn) return;

    if (localStorage.getItem('tunarr_panel_collapsed') === 'true') {
        document.body.classList.add('panel-collapsed');
    }
    syncPanelToggleLabel(btn);

    btn.addEventListener('click', () => {
        document.body.classList.toggle('panel-collapsed');
        localStorage.setItem('tunarr_panel_collapsed', document.body.classList.contains('panel-collapsed'));
        syncPanelToggleLabel(btn);
    });
}

const PANEL_TOGGLE_EXPAND_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" role="presentation"><path d="M21.414 5h-2v14h2V5Z"></path><path fill-rule="evenodd" d="M8.707 5.293 2 12l6.707 6.707 1.414-1.414L5.828 13h11.586v-2H5.828l4.293-4.293-1.414-1.414Z" clip-rule="evenodd"></path></svg>';
const PANEL_TOGGLE_COLLAPSE_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" role="presentation"><path d="M3 5h2v14H3V5Zm19.414 7-6.707-6.707-1.414 1.414L18.586 11H7v2h11.586l-4.293 4.293 1.414 1.414L22.414 12Z"></path></svg>';

function syncPanelToggleLabel(btn) {
    const collapsed = document.body.classList.contains('panel-collapsed');
    btn.innerHTML = collapsed ? PANEL_TOGGLE_EXPAND_ICON : PANEL_TOGGLE_COLLAPSE_ICON;
    btn.title       = collapsed ? 'Show info panel' : 'Hide info panel';
    btn.setAttribute('aria-label', btn.title);
}
