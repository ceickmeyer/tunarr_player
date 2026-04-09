document.addEventListener('DOMContentLoaded', () => {
    // Populate form from saved config
    const saved = localStorage.getItem('tunarr_config');
    const savedTheme = saved ? (JSON.parse(saved).colorTheme || 'mocha') : 'mocha';
    if (saved) {
        const cfg = JSON.parse(saved);
        setVal('server-url',     cfg.serverUrl   || '');
        setVal('xmltv-url',      cfg.xmltvUrl    || '');
        setVal('m3u-url',        cfg.m3uUrl      || '');
        setVal('guide-hours',    cfg.guideHours  || 4);
        document.getElementById('show-bg-images').checked      = cfg.showBackgroundImages !== false;
        document.getElementById('show-channel-names').checked   = cfg.showChannelNames     !== false;
        document.getElementById('show-channel-icons').checked   = cfg.showChannelIcons     === true;
        document.getElementById('noctalia-theme').checked       = cfg.noctaliaTheme        !== false;
    }

    // Theme picker — mark active button and handle live preview
    setActiveThemeBtn(savedTheme);
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setActiveThemeBtn(btn.dataset.theme);
            applyColorTheme(btn.dataset.theme);
        });
    });

    function setActiveThemeBtn(theme) {
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
        const active = document.querySelector(`.theme-btn[data-theme="${theme}"]`);
        if (active) active.classList.add('active');
    }

    // Auto-fill XMLTV + M3U from server URL
    document.getElementById('auto-fill-btn').addEventListener('click', () => {
        const server = document.getElementById('server-url').value.trim().replace(/\/$/, '');
        if (!server) { setStatus('Enter a server URL first', 'error'); return; }
        setVal('xmltv-url', `${server}/api/xmltv.xml`);
        setVal('m3u-url',   `${server}/api/channels.m3u`);
        setStatus('URLs filled — save when ready', '');
    });

    // Test connection
    document.getElementById('test-btn').addEventListener('click', async () => {
        const xmltvUrl = document.getElementById('xmltv-url').value.trim();
        const m3uUrl   = document.getElementById('m3u-url').value.trim();
        if (!xmltvUrl || !m3uUrl) { setStatus('Fill in URLs first', 'error'); return; }

        setStatus('Testing…', '');
        try {
            const [xr, mr] = await Promise.all([fetch(xmltvUrl), fetch(m3uUrl)]);
            if (xr.ok && mr.ok) {
                setStatus('Connection successful ✓', 'ok');
            } else {
                setStatus(`Failed — XMLTV: ${xr.status}, M3U: ${mr.status}`, 'error');
            }
        } catch (e) {
            setStatus(`Connection failed: ${e.message}`, 'error');
        }
    });

    // Clear cache
    document.getElementById('clear-cache-btn').addEventListener('click', () => {
        localStorage.removeItem('tunarr_xmltv');
        localStorage.removeItem('tunarr_m3u');
        setStatus('Cache cleared', 'ok');
    });

    // Save
    document.getElementById('config-form').addEventListener('submit', async e => {
        e.preventDefault();
        const xmltvUrl = document.getElementById('xmltv-url').value.trim();
        const m3uUrl   = document.getElementById('m3u-url').value.trim();
        if (!xmltvUrl || !m3uUrl) {
            setStatus('XMLTV and M3U URLs are required', 'error');
            return;
        }
        const config = {
            serverUrl:            document.getElementById('server-url').value.trim().replace(/\/$/, ''),
            xmltvUrl,
            m3uUrl,
            guideHours:           parseInt(document.getElementById('guide-hours').value) || 4,
            showBackgroundImages: document.getElementById('show-bg-images').checked,
            showChannelNames:     document.getElementById('show-channel-names').checked,
            showChannelIcons:     document.getElementById('show-channel-icons').checked,
            noctaliaTheme:        document.getElementById('noctalia-theme').checked,
            colorTheme:           document.querySelector('.theme-btn.active')?.dataset.theme || 'mocha',
        };
        localStorage.setItem('tunarr_config', JSON.stringify(config));
        localStorage.removeItem('tunarr_xmltv');
        localStorage.removeItem('tunarr_m3u');
        // Persist to server so other devices pick it up automatically
        try {
            await fetch('/config.json', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config),
            });
        } catch (e) {
            console.warn('Could not save config to server:', e);
        }
        window.location.href = 'index.html';
    });

    function setVal(id, val) { document.getElementById(id).value = val; }

    function setStatus(msg, type) {
        const el = document.getElementById('connection-status');
        el.textContent = msg;
        el.className = 'connection-status' + (type ? ` ${type}` : '');
    }
});
