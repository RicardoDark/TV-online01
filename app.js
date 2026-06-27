// Constants
const M3U_URL = 'https://raw.githubusercontent.com/RicardoDark/iptv01/refs/heads/main/minhalista.m3u';
const STORAGE_LAST_CHANNEL_KEY = 'iptv_last_played_channel';
const STORAGE_LAST_FOLDER_KEY = 'iptv_last_selected_folder';

// State Management
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
    userInteracted: false,

    touchStartY: 0,
    touchEndY: 0,
    swipeThreshold: 80
};

// DOM Elements
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
    el.splash.classList.add('splash-visible');
    el.splash.classList.remove('hidden');

    // ✅ Ação do botão de clique
    el.btnStart.addEventListener('click', startAppFlow);

    // ✅ NOVA FUNÇÃO: Detecta qualquer tecla/botão para fechar a tela de boas-vindas
    document.addEventListener('keydown', handleSplashKeyPress);

    setupTouchSwipe();
    setupClickOutsideToClose();
});

// ✅ Função centralizada para iniciar o app
function startAppFlow() {
    state.userInteracted = true;
    el.splash.classList.remove('splash-visible');
    el.splash.classList.add('hidden');
    // Remove o evento de tecla depois de iniciar para não atrapalhar o resto do app
    document.removeEventListener('keydown', handleSplashKeyPress);
    startApp();
}

// ✅ Função que responde a qualquer tecla/botão na tela de boas-vindas
function handleSplashKeyPress(e) {
    // Só funciona se a tela de boas-vindas estiver visível
    if (!el.splash.classList.contains('splash-visible')) return;

    // Aceita qualquer tecla: Enter, Espaço, OK do controle, setas, etc.
    e.preventDefault();
    startAppFlow();
}

function startApp() {
    showStatus('Carregando lista de canais...');
    
    fetch(M3U_URL, {
        method: 'GET',
        cache: 'no-cache',
        headers: { 'Accept': 'text/plain, */*' }
    })
    .then(response => {
        if (!response.ok) throw new Error(`Erro: ${response.status}`);
        return response.text();
    })
    .then(data => {
        if (!data.trim()) throw new Error('Lista vazia ou inválida');
        parseM3U(data);
        hideStatus();
        
        if (state.folders.length === 0) {
            showStatus('Nenhum canal encontrado.', true);
            return;
        }
        
        renderFolders();
        loadLastPlayedChannel();
        updateFocusDOM();
        setupKeyboardNavigation();
        setupMouseClickHandlers();
    })
    .catch(err => {
        console.error('Erro:', err);
        showStatus('❌ Verifique sua conexão.', true);
    });
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
            const folderName = groupMatch ? groupMatch[1].trim() : 'Outros';
            currentChannelMeta.folder = folderName;
            const commaIndex = line.lastIndexOf(',');
            currentChannelMeta.name = commaIndex !== -1 ? line.substring(commaIndex + 1).trim() : 'Sem Nome';
        } else if (line.startsWith('http://') || line.startsWith('https://')) {
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
    state.folders.forEach((folderName, index) => {
        const item = document.createElement('div');
        item.className = 'list-item folder-item';
        item.id = `folder-${index}`;
        item.textContent = folderName;
        item.dataset.index = index;
        el.foldersList.appendChild(item);
    });
}

function renderChannels(folderName) {
    el.channelsList.innerHTML = '';
    const folderChannels = state.channelsByFolder[folderName] || [];
    folderChannels.forEach((channel, index) => {
        const item = document.createElement('div');
        item.className = 'list-item channel-item';
        item.id = `channel-${index}`;
        item.textContent = channel.name;
        item.dataset.index = index;
        if (state.playingChannel && state.playingChannel.url === channel.url) {
            item.classList.add('playing');
        }
        el.channelsList.appendChild(item);
    });
}

function selectFolder(index, focusChannels = false) {
    state.selectedFolderIndex = index;
    const folderName = state.folders[index];
    el.currentFolderTitle.textContent = folderName;
    localStorage.setItem(STORAGE_LAST_FOLDER_KEY, folderName);
    document.querySelectorAll('.folder-item').forEach((item, idx) => {
        item.classList.toggle('selected', idx === index);
    });
    renderChannels(folderName);
    if (focusChannels) {
        state.activeColumn = 'channels';
        state.focusedChannelIndex = 0;
    }
}

function updateFocusDOM() {
    document.querySelectorAll('.list-item.focused').forEach(item => item.classList.remove('focused'));
    if (!state.isMenuVisible) return;
    const focusedElement = state.activeColumn === 'folders' 
        ? document.getElementById(`folder-${state.focusedFolderIndex}`)
        : document.getElementById(`channel-${state.focusedChannelIndex}`);
    if (focusedElement) {
        focusedElement.classList.add('focused');
        focusedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function playChannel(channel) {
    if (!channel || !channel.url) return;
    if (!state.userInteracted) {
        showStatus('Clique em "Iniciar" ou aperte qualquer botão para liberar o som', false);
        return;
    }

    showStatus('Carregando canal...');
    if (state.hls) {
        state.hls.destroy();
        state.hls = null;
    }

    state.playingChannel = channel;
    localStorage.setItem(STORAGE_LAST_CHANNEL_KEY, JSON.stringify(channel));
    selectFolder(state.selectedFolderIndex, false);

    if (Hls.isSupported()) {
        const hls = new Hls({
            maxBufferSize: 0,
            maxBufferLength: 30,
            liveSyncDuration: 3,
            enableWorker: true,
            startLevel: -1,
            xhrSetup: xhr => { xhr.withCredentials = false; }
        });
        state.hls = hls;
        hls.loadSource(channel.url);
        hls.attachMedia(el.video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            el.video.muted = false;
            el.video.play()
                .then(() => { hideStatus(); showToast(channel.name, channel.folder); })
                .catch(() => { el.video.muted = false; el.video.play().catch(() => {}); });
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) {
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) setTimeout(() => hls.startLoad(), 2500);
                else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
                else showStatus('Não foi possível reproduzir.', false);
            }
        });
    } else if (el.video.canPlayType('application/vnd.apple.mpegurl')) {
        el.video.src = channel.url;
        el.video.muted = false;
        el.video.load();
        el.video.addEventListener('loadedmetadata', () => {
            el.video.play().then(() => { hideStatus(); showToast(channel.name, channel.folder); }).catch(() => {});
        });
    } else {
        showStatus('Formato não suportado.', false);
    }
}

function loadLastPlayedChannel() {
    const rawChannel = localStorage.getItem(STORAGE_LAST_CHANNEL_KEY);
    const lastFolderName = localStorage.getItem(STORAGE_LAST_FOLDER_KEY);

    if (rawChannel) {
        try {
            const lastChannel = JSON.parse(rawChannel);
            const canalExiste = state.channels.some(c => c.url === lastChannel.url);
            
            if (canalExiste) {
                let pastaIndex = state.folders.indexOf(lastFolderName || lastChannel.folder);
                if (pastaIndex === -1) pastaIndex = 0;

                selectFolder(pastaIndex, false);
                const canalIndex = state.channelsByFolder[state.folders[pastaIndex]].findIndex(c => c.url === lastChannel.url);
                if (canalIndex !== -1) state.focusedChannelIndex = canalIndex;

                playChannel(lastChannel);
                return;
            }
        } catch (e) {
            console.warn('Erro ao recuperar último canal:', e);
        }
    }

    if (state.folders.length > 0) {
        selectFolder(0, false);
        const primeiroCanal = state.channelsByFolder[state.folders[0]]?.[0];
        if (primeiroCanal) playChannel(primeiroCanal);
    }
}

function toggleMenu(forceVisible = null) {
    state.isMenuVisible = forceVisible !== null ? forceVisible : !state.isMenuVisible;
    el.overlay.classList.toggle('visible', state.isMenuVisible);
    el.overlay.classList.toggle('hidden', !state.isMenuVisible);
    if (state.isMenuVisible) updateFocusDOM();
}

function zapChannel(direction) {
    const canaisPasta = state.channelsByFolder[state.folders[state.selectedFolderIndex]] || [];
    if (canaisPasta.length === 0) return;
    const idxAtual = state.playingChannel ? canaisPasta.findIndex(c => c.url === state.playingChannel.url) : -1;
    const proximoIdx = (idxAtual + direction + canaisPasta.length) % canaisPasta.length;
    state.focusedChannelIndex = proximoIdx;
    playChannel(canaisPasta[proximoIdx]);
}

function setupTouchSwipe() {
    el.video.addEventListener('touchstart', e => { state.touchStartY = e.touches[0].clientY; }, { passive: true });
    el.video.addEventListener('touchend', e => {
        state.touchEndY = e.changedTouches[0].clientY;
        const diffY = state.touchStartY - state.touchEndY;
        if (Math.abs(diffY) > state.swipeThreshold) diffY > 0 ? zapChannel(1) : zapChannel(-1);
    }, { passive: true });
}

function setupClickOutsideToClose() {
    el.overlay.addEventListener('click', e => { if (e.target === el.overlay) toggleMenu(false); });
}

function setupKeyboardNavigation() {
    document.addEventListener('keydown', e => {
        if (!state.isMenuVisible) {
            if (e.key === 'ArrowUp') { e.preventDefault(); zapChannel(1); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); zapChannel(-1); return; }
            if (!['VolumeUp','VolumeDown','VolumeMute'].includes(e.key)) { e.preventDefault(); toggleMenu(true); }
            return;
        }
        const qtdPastas = state.folders.length;
        const qtdCanais = state.channelsByFolder[state.folders[state.selectedFolderIndex]]?.length || 0;
        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                if (state.activeColumn === 'folders') {
                    state.focusedFolderIndex = (state.focusedFolderIndex - 1 + qtdPastas) % qtdPastas;
                    selectFolder(state.focusedFolderIndex, false);
                } else {
                    state.focusedChannelIndex = (state.focusedChannelIndex - 1 + qtdCanais) % qtdCanais;
                }
                updateFocusDOM();
                break;
            case 'ArrowDown':
                e.preventDefault();
                if (state.activeColumn === 'folders') {
                    state.focusedFolderIndex = (state.focusedFolderIndex + 1) % qtdPastas;
                    selectFolder(state.focusedFolderIndex, false);
                } else {
                    state.focusedChannelIndex = (state.focusedChannelIndex + 1) % qtdCanais;
                }
                updateFocusDOM();
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (state.activeColumn === 'folders' && qtdCanais > 0) {
                    state.activeColumn = 'channels';
                    state.focusedChannelIndex = state.playingChannel ? qtdCanais.findIndex(c => c.url === state.playingChannel.url) || 0 : 0;
                    updateFocusDOM();
                }
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (state.activeColumn === 'channels') {
                    state.activeColumn = 'folders';
                    state.focusedFolderIndex = state.selectedFolderIndex;
                    updateFocusDOM();
                }
                break;
            case 'Enter':
                e.preventDefault();
                if (state.activeColumn === 'folders') selectFolder(state.focusedFolderIndex, true);
                else {
                    const canal = state.channelsByFolder[state.folders[state.selectedFolderIndex]]?.[state.focusedChannelIndex];
                    if (canal) state.playingChannel?.url === canal.url ? toggleMenu(false) : playChannel(canal);
                }
                updateFocusDOM();
                break;
            case 'Escape':
            case 'Backspace':
                e.preventDefault();
                if (!state.isMenuVisible) toggleMenu(true);
                else if (state.activeColumn === 'channels') { state.activeColumn = 'folders'; updateFocusDOM(); }
                else toggleMenu(false);
                break;
        }
    });
}

function setupMouseClickHandlers() {
    el.foldersList.addEventListener('click', e => {
        const item = e.target.closest('.folder-item');
        if (!item) return;
        const idx = parseInt(item.dataset.index);
        state.focusedFolderIndex = idx;
        state.activeColumn = 'folders';
        selectFolder(idx, false);
        updateFocusDOM();
    });
    el.channelsList.addEventListener('click', e => {
        const item = e.target.closest('.channel-item');
        if (!item) return;
        const idx = parseInt(item.dataset.index);
        state.focusedChannelIndex = idx;
        state.activeColumn = 'channels';
        updateFocusDOM();
        const canal = state.channelsByFolder[state.folders[state.selectedFolderIndex]]?.[idx];
        if (canal) state.playingChannel?.url === canal.url ? toggleMenu(false) : playChannel(canal);
    });
    el.video.addEventListener('click', () => toggleMenu());
}

function showStatus(msg) { el.statusMsg.textContent = msg; el.status.classList.remove('hidden'); }
function hideStatus() { el.status.classList.add('hidden'); }

let toastTimer;
function showToast(nome, grupo) {
    el.toastName.textContent = nome;
    el.toastGroup.textContent = grupo;
    el.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 4000);
}

window.AndroidInterface = { handleBackButton: () => { toggleMenu(!state.isMenuVisible); return true; } };