// Channel manager — show/hide Tunarr channels via the server's /channels-data endpoint.
// "Hidden" is Tunarr's stealth flag: the channel keeps its lineup (and tunarr-sync.py
// keeps tracking it) but drops out of the M3U/XMLTV, so it's gone from the guide and Plex.

const MOVIE_START = 100;   // tunarr-sync.py numbers TV channels from 1 and movies from 100

let channels = [];
const filters = { state: 'all', kind: 'all', origin: 'all' };
let lastChange = null;     // { ids, hidden } for undo
let toastTimer = null;

const $ = id => document.getElementById(id);

function kindOf(ch)   { return ch.number >= MOVIE_START ? 'movie' : 'tv'; }

function hours(ms) {
    const h = ms / 3.6e6;
    return h >= 48 ? `${Math.round(h / 24)} days` : `${Math.round(h)}h`;
}

function visible() {
    const q = $('search').value.trim().toLowerCase();
    return channels.filter(ch =>
        (filters.state  === 'all' || (filters.state === 'hidden') === ch.hidden) &&
        (filters.kind   === 'all' || kindOf(ch) === filters.kind) &&
        (filters.origin === 'all' || (filters.origin === 'auto') === !!ch.collection) &&
        (!q || ch.name.toLowerCase().includes(q) || String(ch.number) === q)
    );
}

function render() {
    const rows = visible();
    const list = $('list');
    list.replaceChildren(...rows.map(ch => {
        const li = document.createElement('li');
        li.className = 'ch-row' + (ch.hidden ? ' hidden' : '');
        li.dataset.id = ch.id;
        li.title = ch.hidden ? 'Hidden — click to show' : 'Shown — click to hide';

        const num = document.createElement('span');
        num.className = 'ch-num';
        num.textContent = ch.number;

        const name = document.createElement('div');
        name.className = 'ch-name';
        name.textContent = ch.name;
        const tag = document.createElement('span');
        tag.className = 'ch-tag';
        tag.textContent = ch.collection ? 'auto' : 'mine';
        name.appendChild(tag);
        const meta = document.createElement('span');
        meta.className = 'ch-meta';
        meta.textContent = `${kindOf(ch) === 'tv' ? 'TV' : 'Movies'} · ${ch.programCount} items · ${hours(ch.duration)}`;
        name.appendChild(meta);

        const sw = document.createElement('span');
        sw.className = 'ch-switch';

        li.append(num, name, sw);
        li.addEventListener('click', () => setHidden([ch.id], !ch.hidden));
        return li;
    }));

    const shown = channels.filter(c => !c.hidden).length;
    $('summary').textContent =
        `${shown} shown · ${channels.length - shown} hidden` +
        (rows.length !== channels.length ? ` — ${rows.length} match` : '');
    $('hide-all').textContent = `Hide these ${rows.filter(c => !c.hidden).length}`;
    $('show-all').textContent = `Show these ${rows.filter(c => c.hidden).length}`;
    $('hide-all').disabled = !rows.some(c => !c.hidden);
    $('show-all').disabled = !rows.some(c => c.hidden);
    $('status').textContent = rows.length ? '' : 'No channels match.';
    $('status').className = 'ch-status';
}

async function setHidden(ids, hidden, isUndo = false) {
    ids = ids.filter(id => channels.find(c => c.id === id)?.hidden !== hidden);
    if (!ids.length) return;
    ids.forEach(id => document.querySelector(`.ch-row[data-id="${id}"]`)?.classList.add('busy'));
    try {
        const resp = await fetch('/channels-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, hidden }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        channels = data.channels;
        // The guide caches the M3U/XMLTV for 5 min; drop it so changes show up right away.
        localStorage.removeItem('tunarr_m3u');
        localStorage.removeItem('tunarr_xmltv');
        render();
        const done = ids.length - data.failed.length;
        let msg = isUndo ? `Undone` : `${hidden ? 'Hid' : 'Showed'} ${done} channel${done === 1 ? '' : 's'}`;
        if (data.failed.length) msg += ` (${data.failed.length} failed)`;
        lastChange = isUndo ? null : { ids, hidden };
        toast(msg, !isUndo);
    } catch (e) {
        render();
        toast(`Couldn't reach Tunarr: ${e.message}`, false);
    }
}

function toast(msg, undoable) {
    $('toast-msg').textContent = msg;
    $('toast-undo').style.display = undoable ? '' : 'none';
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 6000);
}

document.querySelectorAll('.ch-seg').forEach(seg => {
    seg.addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
        filters[seg.dataset.filter] = btn.dataset.v;
        render();
    });
});
$('search').addEventListener('input', render);
$('hide-all').addEventListener('click', () => {
    const ids = visible().filter(c => !c.hidden).map(c => c.id);
    if (ids.length > 10 && !confirm(`Hide ${ids.length} channels?`)) return;
    setHidden(ids, true);
});
$('show-all').addEventListener('click', () => {
    const ids = visible().filter(c => c.hidden).map(c => c.id);
    if (ids.length > 10 && !confirm(`Show ${ids.length} channels?`)) return;
    setHidden(ids, false);
});
$('toast-undo').addEventListener('click', () => {
    if (lastChange) setHidden(lastChange.ids, !lastChange.hidden, true);
});

(async () => {
    try {
        const resp = await fetch('/channels-data');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        channels = (await resp.json()).channels;
        render();
    } catch (e) {
        $('status').textContent = `Couldn't load channels: ${e.message}`;
        $('status').className = 'ch-status error';
    }
})();
