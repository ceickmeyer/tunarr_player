let hls           = null;
let videoElement  = null;
let xmltvData     = null;
let currentChannel = null;
let m3uChannels   = [];

document.addEventListener('DOMContentLoaded', initializePlayer);

async function initializePlayer() {
    if (!loadConfig()) { window.location.href = 'config.html'; return; }

    await applyNoctaliaColors();

    const channelJson = sessionStorage.getItem('selectedChannel');
    if (!channelJson) { window.location.href = 'index.html'; return; }
    currentChannel = JSON.parse(channelJson);

    [xmltvData, m3uChannels] = await Promise.all([fetchXMLTVData(), fetchM3UData()]);

    videoElement = document.getElementById('video-player');
    setupVideoPlayer(currentChannel.url);

    document.getElementById('reload-stream').addEventListener('click', reloadStream);
    setupPiP();
    document.getElementById('channel-name').textContent = currentChannel.name;

    updateCurrentProgram();
    renderFullGuide();

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
    btn.textContent = '⏳ Reloading...';
    if (hls) { hls.destroy(); hls = null; }
    setupVideoPlayer(currentChannel.url);
    setTimeout(() => { btn.disabled = false; btn.textContent = '🔄 Reload Stream'; }, 2000);
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
    const now  = new Date();
    const prog = getChannelPrograms(xmltvData, currentChannel.id, now, new Date(now.getTime() + 1))[0];
    document.getElementById('current-program').textContent = prog
        ? `${prog.title}  ·  ${formatTime(prog.start)} – ${formatTime(prog.stop)}`
        : currentChannel.name;
}

// ── Full channel guide ────────────────────────────────────────────────────────

function renderFullGuide() {
    if (!xmltvData || !m3uChannels.length) return;

    const container = document.getElementById('player-guide');
    container.innerHTML = '';

    const now     = new Date();
    const endTime = new Date(now.getTime() + CONFIG.guideHours * 3600000);

    for (const channel of m3uChannels) {
        const row = document.createElement('div');
        row.className = 'guide-row';
        if (channel.id === currentChannel.id) row.classList.add('active-channel');

        const label = document.createElement('div');
        label.className = 'channel-label';
        label.textContent = channel.name;
        label.title = channel.name;
        row.appendChild(label);

        const timeline = document.createElement('div');
        timeline.className = 'timeline';

        for (const prog of getChannelPrograms(xmltvData, channel.id, now, endTime)) {
            const box = document.createElement('div');
            box.className = 'program-box';

            if (prog.start <= now && now < prog.stop) box.classList.add('now-playing');

            box.innerHTML = `
                <div class="program-title">${prog.title}</div>
                <div class="program-time">${formatTime(prog.start)} – ${formatTime(prog.stop)}</div>
            `;

            if (CONFIG.showBackgroundImages && prog.image) {
                const bg = document.createElement('div');
                bg.className = 'program-bg-image';
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

function showError(message) {
    const section = document.querySelector('.player-section');
    if (section) section.innerHTML = `<div class="error">${message}</div>`;
}
