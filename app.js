// Constants
const M3U_URL = 'https://raw.githubusercontent.com/RicardoDark/iptv01/refs/heads/main/minhalista.m3u';
const STORAGE_LAST_CHANNEL_KEY = 'iptv_last_played_channel';

// State
let state = {
    channels: [],
    folders: [],
    channelsByFolder: {},
    activeColumn: 'folders',
    focusedFolderIndex: 0,
    focusedChannelIndex: 0,
    selectedFolderIndex: 0,
    playingChannel: null,
    isMenuVisible: false,
    hls: null,
    isAndroid: false,
    appStarted: false,
    touchStartY: 0,
    swipeThreshold: 80
};

// Elementos
const el = {
    video: document.getElementById('video-player'),
    overlay: document.getElementById('overlay-menu'),
    foldersList: document.getElementById('folders-list'),
    channelsList: document.getElementById('channels-list'),
    currentFolderTitle: document.getElementById('current-folder-title'),
    splash: document.getElementById('splash-screen'),
    btnStart: document.getElementById('btn-start'),
    status: document.getElementById('status-container'),
    statusMsg: document.getElementById('status-message'),
    toast: document.getElementById('toast-info'),
    toastName: document.getElementById('toast-channel-name'),
    toastGroup: document.getElementById('toast-channel-group')
};

const urlParams = new URLSearchParams(window.location.search);
state.isAndroid = navigator.userAgent.toLowerCase().includes('android') || urlParams.get('platform') === 'android';

window.addEventListener('DOMContentLoaded', () => {
    // Botão da tela inicial + OK do controle
    el.btnStart.focus();
    el.btnStart.classList.add('focused');
    el.btnStart.addEventListener('click', startApp);
    document.addEventListener('keydown', (e) => {
        if (el.splash.classList.contains('splash-visible') && (e.key === 'Enter' || e.key === 'NumpadEnter')) {
            e.preventDefault();
            startApp();
        }
    });
});

function startApp() {
    if (state.appStarted) return;
    state.appStarted = true;

    // Esconde a tela de boas-vindas
    el.splash.classList.remove('splash-visible');
    el.splash.classList.add('hidden');

    showStatus('Carregando lista de canais...');
    fetch(M3U_URL)
        .then(res => { if (!res.ok) throw new Error('Erro na lista'); return res.text(); })
        .then(data => {
            parseM3U(data);
            hideStatus();
            if (state.folders.length === 0) { showStatus('Nenhum canal encontrado', true); return; }
            renderFolders();
            selectFolder(0, false);
            loadLastPlayedChannel(); // ✅ Garante último canal
            updateFocusDOM();
            setupKeyboardNavigation();
            setupMouseClickHandlers(); // ✅ Reativado corretamente
            setupTouchSwipe();
            setupClickOutsideToClose();
        })
        .catch(err => { console.error(err); showStatus('Erro de conexão', true); });
}

function parseM3U(m3uContent) {
    const lines = m3uContent.split('\n');
    let currentChannelMeta = null;
    state.channels = [];
    const allFolder = 'Todos os Canais';
    state.folders = [allFolder];
    state.channelsByFolder = { [allFolder]: [] };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (line.startsWith('#EXTINF:')) {
            currentChannelMeta = {};
            const groupMatch = line.match(/group-title="([^"]+)"/);
            currentChannelMeta.folder = groupMatch ? groupMatch[1].trim() : 'Outros';
            const commaIndex = line.lastIndexOf(',');
            currentChannelMeta.name = commaIndex > -1 ? line.substring(commaIndex + 1).trim() : 'Sem Nome';
        } else if (line.startsWith('http')) {
            if (currentChannelMeta) {
                currentChannelMeta.url = line;
                currentChannelMeta.id = `ch_${state.channels.length}`;
                state.channels.push(currentChannelMeta);
                state.channelsByFolder[allFolder].push(currentChannelMeta);
                if (!state.folders.includes(currentChannelMeta.folder)) {
                    state.folders.push(currentChannelMeta.folder);
                    state.channelsByFolder[currentChannelMeta.folder] = [];
                }
                state.channelsByFolder[currentChannelMeta.folder].push(currentChannelMeta);
                currentChannelMeta = null;
            }
        }
    }
}

function renderFolders() {
    el.foldersList.innerHTML = '';
    state.folders.forEach((name, i) => {
        const item = document.createElement('div');
        item.className = 'list-item folder-item';
        item.id = `folder-${i}`;
        item.textContent = name;
        item.dataset.index = i;
        el.foldersList.appendChild(item);
    });
}

function renderChannels(folderName) {
    el.channelsList.innerHTML = '';
    const list = state.channelsByFolder[folderName] || [];
    list.forEach((ch, i) => {
        const item = document.createElement('div');
        item.className = 'list-item channel-item';
        item.id = `channel-${i}`;
        item.textContent = ch.name;
        item.dataset.index = i;
        if (state.playingChannel && ch.url === state.playingChannel.url) item.classList.add('playing');
        el.channelsList.appendChild(item);
    });
}

function selectFolder(index, focus = false) {
    state.selectedFolderIndex = index;
    el.currentFolderTitle.textContent = state.folders[index];
    document.querySelectorAll('.folder-item').forEach((el, i) => el.classList.toggle('selected', i === index));
    renderChannels(state.folders[index]);
    if (focus) { state.activeColumn = 'channels'; state.focusedChannelIndex = 0; }
}

function updateFocusDOM() {
    document.querySelectorAll('.list-item.focused').forEach(el => el.classList.remove('focused'));
    if (!state.isMenuVisible) return;
    const focusedEl = state.activeColumn === 'folders' ? document.getElementById(`folder-${state.focusedFolderIndex}`) : document.getElementById(`channel-${state.focusedChannelIndex}`);
    if (focusedEl) { focusedEl.classList.add('focused'); focusedEl.scrollIntoView({ block: 'nearest' }); }
}

function playChannel(channel) {
    if (!channel?.url) return;
    showStatus('Carregando canal...');
    if (state.hls) { state.hls.destroy(); state.hls = null; }

    state.playingChannel = channel;
    localStorage.setItem(STORAGE_LAST_CHANNEL_KEY, JSON.stringify(channel));
    localStorage.setItem('iptv_last_played_folder', state.folders[state.selectedFolderIndex]);
    selectFolder(state.selectedFolderIndex, false);

    if (Hls.isSupported()) {
        const hls = new Hls({ maxBufferSize: 0, liveSyncDuration: 3, enableWorker: true });
        state.hls = hls;
        hls.loadSource(channel.url);
        hls.attachMedia(el.video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            el.video.muted = false;
            el.video.play()
                .then(() => { hideStatus(); showToast(channel.name, channel.folder); })
                .catch(err => {
                    console.error('Erro ao reproduzir:', err);
                    el.video.muted = false;
                    el.video.play().catch(() => showStatus('Não foi possível reproduzir', false));
                });
        });
        hls.on(Hls.Events.ERROR, (e, d) => {
            if (d.fatal) {
                if (d.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
                else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
                else showStatus('Erro no canal', false);
            }
        });
    } else if (el.video.canPlayType('application/vnd.apple.mpegurl')) {
        el.video.src = channel.url;
        el.video.muted = false;
        el.video.addEventListener('loadedmetadata', () => {
            el.video.play()
                .then(() => { hideStatus(); showToast(channel.name, channel.folder); })
                .catch(() => showStatus('Não foi possível reproduzir', false));
        });
    } else {
        showStatus('Formato não suportado', false);
    }
}

// ✅ Função reforçada para SEMPRE carregar o último canal
function loadLastPlayedChannel() {
    const saved = localStorage.getItem(STORAGE_LAST_CHANNEL_KEY);
    const savedFolder = localStorage.getItem('iptv_last_played_folder');
    if (saved) {
        try {
            const ch = JSON.parse(saved);
            const exists = state.channels.some(c => c.url === ch.url);
            if (exists) {
                let folderIdx = state.folders.includes(savedFolder) ? state.folders.indexOf(savedFolder) : state.folders.indexOf(ch.folder);
                if (folderIdx === -1) folderIdx = 0;
                selectFolder(folderIdx, false);
                const list = state.channelsByFolder[state.folders[folderIdx]] || [];
                const idx = list.findIndex(c => c.url === ch.url);
                if (idx > -1) state.focusedChannelIndex = idx;
                setTimeout(() => playChannel(ch), 300);
                return;
            }
        } catch (e) { console.error('Erro ao carregar último canal:', e); }
    }
    // Primeiro canal se não tiver salvo
    if (state.folders.length > 0) {
        selectFolder(0, false);
        const first = state.channelsByFolder[state.folders[0]]?.[0];
        if (first) setTimeout(() => playChannel(first), 300);
    }
}

function toggleMenu(force) {
    state.isMenuVisible = force !== null ? force : !state.isMenuVisible;
    el.overlay.classList.toggle('visible', state.isMenuVisible);
    el.overlay.classList.toggle('hidden', !state.isMenuVisible);
    updateFocusDOM();
}

function zapChannel(direction) {
    const list = state.channelsByFolder[state.folders[state.selectedFolderIndex]] || [];
    if (!list.length) return;
    let idx = state.playingChannel ? list.findIndex(c => c.url === state.playingChannel.url) : -1;
    idx = (idx + direction + list.length) % list.length;
    state.focusedChannelIndex = idx;
    playChannel(list[idx]);
}

function setupTouchSwipe() {
    el.video.addEventListener('touchstart', e => state.touchStartY = e.touches[0].clientY, { passive: true });
    el.video.addEventListener('touchend', e => {
        const diff = state.touchStartY - e.changedTouches[0].clientY;
        if (Math.abs(diff) > state.swipeThreshold) diff > 0 ? zapChannel(1) : zapChannel(-1);
    }, { passive: true });
}

function setupClickOutsideToClose() {
    el.overlay.addEventListener('click', e => { if (e.target === el.overlay) toggleMenu(false); });
}

function setupKeyboardNavigation() {
    document.addEventListener('keydown', e => {
        if (!state.appStarted || el.splash.classList.contains('splash-visible')) return;
        if (!state.isMenuVisible) {
            if (e.key === 'ArrowUp') { e.preventDefault(); zapChannel(1); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); zapChannel(-1); return; }
            if (!['VolumeUp','VolumeDown','VolumeMute','Mute'].includes(e.key)) { e.preventDefault(); toggleMenu(true); }
            return;
        }
        const folderCount = state.folders.length;
        const channelCount = state.channelsByFolder[state.folders[state.selectedFolderIndex]]?.length || 0;
        switch (e.key) {
            case 'ArrowUp': e.preventDefault(); state.activeColumn === 'folders' ? state.focusedFolderIndex = (state.focusedFolderIndex -1 + folderCount) % folderCount : state.focusedChannelIndex = (state.focusedChannelIndex -1 + channelCount) % channelCount; updateFocusDOM(); break;
            case 'ArrowDown': e.preventDefault(); state.activeColumn === 'folders' ? state.focusedFolderIndex = (state.focusedFolderIndex +1) % folderCount : state.focusedChannelIndex = (state.focusedChannelIndex +1) % channelCount; updateFocusDOM(); break;
            case 'ArrowRight': e.preventDefault(); if (state.activeColumn === 'folders' && channelCount) { state.activeColumn = 'channels'; const idx = state.channelsByFolder[state.folders[state.selectedFolderIndex]].findIndex(c => c.url === state.playingChannel?.url); state.focusedChannelIndex = idx > -1 ? idx : 0; updateFocusDOM(); } break;
            case 'ArrowLeft': e.preventDefault(); if (state.activeColumn === 'channels') { state.activeColumn = 'folders'; state.focusedFolderIndex = state.selectedFolderIndex; updateFocusDOM(); } break;
            case 'Enter': case 'NumpadEnter': e.preventDefault(); if (state.activeColumn === 'folders') { selectFolder(state.focusedFolderIndex, true); updateFocusDOM(); } else { const ch = state.channelsByFolder[state.folders[state.selectedFolderIndex]]?.[state.focusedChannelIndex]; if (ch) state.playingChannel?.url === ch.url ? toggleMenu(false) : playChannel(ch); } break;
            case 'Escape': case 'Backspace': e.preventDefault(); handleBackAction(); break;
        }
    });
}

// ✅ Função de clique corrigida e reforçada
function setupMouseClickHandlers() {
    el.foldersList.addEventListener('click', e => { 
        const item = e.target.closest('.folder-item'); 
        if (!item) return; 
        const i = parseInt(item.dataset.index); 
        state.focusedFolderIndex = i; 
        state.activeColumn = 'folders'; 
        selectFolder(i, false); 
        updateFocusDOM(); 
    });

    el.channelsList.addEventListener('click', e => { 
        const item = e.target.closest('.channel-item'); 
        if (!item) return; 
        const i = parseInt(item.dataset.index); 
        const ch = state.channelsByFolder[state.folders[state.selectedFolderIndex]]?.[i]; 
        if (ch) {
            playChannel(ch); 
            toggleMenu(false);
        }
    });

    // ✅ Clique no vídeo abre/fecha a grade
    el.video.addEventListener('click', e => { 
        e.stopPropagation(); 
        toggleMenu(); 
    });

    // ✅ Toque também funciona no celular
    el.video.addEventListener('touchend', e => { 
        if (Math.abs(state.touchStartY - e.changedTouches[0].clientY) < 10) {
            e.stopPropagation(); 
            toggleMenu(); 
        }
    }, { passive: true });
}

function showStatus(msg) { el.statusMsg.textContent = msg; el.status.classList.remove('hidden'); }
function hideStatus() { el.status.classList.add('hidden'); }

let toastTimer;
function showToast(name, folder) {
    el.toastName.textContent = name; el.toastGroup.textContent = folder; el.toast.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 4000);
}

function handleBackAction() {
    if (!state.isMenuVisible) { toggleMenu(true); return true; }
    if (state.activeColumn === 'channels') { state.activeColumn = 'folders'; state.focusedFolderIndex = state.selectedFolderIndex; updateFocusDOM(); return true; }
    if (state.isAndroid && window.Android?.exitApp) window.Android.exitApp(); else toggleMenu(false);
    return true;
}

window.AndroidInterface = { handleBackButton: () => handleBackAction() };