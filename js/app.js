let xmltvData  = null;
let m3uChannels = [];

document.addEventListener('DOMContentLoaded', initializeGuide);

async function initializeGuide() {
    if (!loadConfig()) { window.location.href = 'config.html'; return; }

    await applyNoctaliaColors();

    // Set Tunarr admin link from config
    const cfg = JSON.parse(localStorage.getItem('tunarr_config') || '{}');
    const tunarrLink = document.getElementById('tunarr-link');
    if (tunarrLink && cfg.serverUrl) tunarrLink.href = cfg.serverUrl;

    xmltvData   = await fetchXMLTVData();
    m3uChannels = await fetchM3UData();

    if (!xmltvData || m3uChannels.length === 0) {
        showError('Failed to load guide data. Check that Tunarr is reachable.');
        return;
    }

    document.getElementById('shuffle-btn').addEventListener('click', shuffleChannel);

    renderGuide();
    updateTimeDisplay();
    setInterval(() => { updateTimeDisplay(); renderGuide(); }, CONFIG.updateInterval);
}

function renderGuide() {
    const container = document.getElementById('guide-container');
    container.innerHTML = '';

    const now     = new Date();
    const endTime = new Date(now.getTime() + CONFIG.guideHours * 3600000);

    for (const channel of m3uChannels) {
        container.appendChild(createChannelRow(channel, now, endTime));
    }
}

function createChannelRow(channel, startTime, endTime) {
    const row = document.createElement('div');
    row.className = 'guide-row';

    const label = document.createElement('div');
    label.className = 'channel-label';
    label.textContent = channel.name;
    label.title = channel.name;
    row.appendChild(label);

    const timeline = document.createElement('div');
    timeline.className = 'timeline';

    for (const prog of getChannelPrograms(xmltvData, channel.id, startTime, endTime)) {
        timeline.appendChild(createProgramBox(channel, prog));
    }

    row.appendChild(timeline);
    return row;
}

function createProgramBox(channel, program) {
    const box = document.createElement('div');
    box.className = 'program-box';

    const now = new Date();
    if (program.start <= now && now < program.stop) box.classList.add('now-playing');

    box.innerHTML = `
        <div class="program-title">${program.title}</div>
        <div class="program-time">${formatTime(program.start)} – ${formatTime(program.stop)}</div>
    `;

    if (CONFIG.showBackgroundImages && program.image) {
        const bg = document.createElement('div');
        bg.className = 'program-bg-image';
        bg.style.backgroundImage = `url("${program.image}")`;
        box.insertBefore(bg, box.firstChild);
    }

    attachTooltip(box, program, channel.name);

    box.addEventListener('click', () => {
        sessionStorage.setItem('selectedChannel', JSON.stringify({
            id: channel.id, name: channel.name, url: channel.url, logo: channel.logo,
        }));
        window.location.href = 'player.html';
    });

    return box;
}

function shuffleChannel() {
    if (!m3uChannels.length) return;
    const channel = m3uChannels[Math.floor(Math.random() * m3uChannels.length)];
    sessionStorage.setItem('selectedChannel', JSON.stringify({
        id: channel.id, name: channel.name, url: channel.url, logo: channel.logo,
    }));
    window.location.href = 'player.html';
}

function showError(message) {
    document.getElementById('guide-container').innerHTML = `<div class="error">${message}</div>`;
}
