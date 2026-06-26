// Constants
const M3U_URL = 'https://raw.githubusercontent.com/RicardoDark/iptv01/refs/heads/main/minhalista.m3u';
const STORAGE_LAST_CHANNEL_KEY = 'iptv_last_played_channel';

// State Management
let state = {
    channels: [],
    folders: [], // Unique groups in order of appearance
    channelsByFolder: {}, // folderName -> Array of channels
    
    // Navigation State
    activeColumn: 'folders', // 'folders' or 'channels'
    focusedFolderIndex: 0,
    focusedChannelIndex: 0,
    selectedFolderIndex: 0, // Folder currently shown on the right
    playingChannel: null, // Currently playing channel object
    
    isMenuVisible: false, // Inicia com menu OCULTO
    hls: null,
    isAndroid: false,

    // Variáveis para rolagem por toque
    touchStartY: 0,
    touchEndY: 0,
    swipeThreshold: 80 // Sensibilidade do arrasto em pixels
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

// Check if running on Android WebView via User Agent or Query Param
const urlParams = new URLSearchParams(window.location.search);
state.isAndroid = navigator.userAgent.toLowerCase().includes('android') || urlParams.get('platform') === 'android';

// Initialize App
window.addEventListener('DOMContentLoaded', () => {
    // Remove tela de abertura e inicia direto
    if (el.splash) {
        el.splash.classList.add('hidden');
        el.splash.classList.remove('splash-visible');
    }
    startApp();
    setupTouchSwipe(); // Ativa rolagem por toque
    setupClickOutsideToClose(); // Ativa fechar menu ao clicar fora
});

// Main start function
function startApp() {
    showStatus('Carregando lista de canais...');
    fetch(M3U_URL)
        .then(response => {
            if (!response.ok) throw new Error('Não foi possível baixar a lista M3U.');
            return response.text();
        })
        .then(data => {
            parseM3U(data);
            hideStatus();
            
            if (state.folders.length === 0) {
                showStatus('Nenhum canal encontrado na lista.', true);
                return;
            }
            
            // Build UI
            renderFolders();
            selectFolder(0, false);
            
            // Load and play last channel or first channel
            loadLastPlayedChannel();
            
            // Set initial focus
            state.activeColumn = 'folders';
            state.focusedFolderIndex = 0;
            updateFocusDOM();
            
            // Register Events
            setupKeyboardNavigation();
            setupMouseClickHandlers();
        })
        .catch(err => {
            console.error(err);
            showStatus('Erro ao carregar a lista IPTV. Verifique sua conexão.', true);
        });
}

// M3U Playlist Parser
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
            
            // Extract group-title (Folder)
            const groupMatch = line.match(/group-title="([^"]+)"/);
            const folderName = groupMatch ? groupMatch[1].trim() : 'Outros';
            currentChannelMeta.folder = folderName;
            
            // Extract channel name
            const commaIndex = line.lastIndexOf(',');
            if (commaIndex !== -1) {
                currentChannelMeta.name = line.substring(commaIndex + 1).trim();
            } else {
                currentChannelMeta.name = 'Sem Nome';
            }
        } else if (line.startsWith('http://') || line.startsWith('https://')) {
            if (currentChannelMeta) {
                currentChannelMeta.url = line;
                currentChannelMeta.id = `ch_${state.channels.length}`;
                
                state.channels.push(currentChannelMeta);
                
                // Add to general folder
                state.channelsByFolder[allFolder].push(currentChannelMeta);
                
                // Add folder to unique folders list
                const folderName = currentChannelMeta.folder;
                if (!state.folders.includes(folderName)) {
                    state.folders.push(folderName);
                    state.channelsByFolder[folderName] = [];
                }
                
                // Add to specific folder
                state.channelsByFolder[folderName].push(currentChannelMeta);
                
                currentChannelMeta = null;
            }
        }
    }
}

// Render Folders Column
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

// Render Channels Column
function renderChannels(folderName) {
    el.channelsList.innerHTML = '';
    const folderChannels = state.channelsByFolder[folderName] || [];
    
    folderChannels.forEach((channel, index) => {
        const item = document.createElement('div');
        item.className = 'list-item channel-item';
        item.id = `channel-${index}`;
        item.textContent = channel.name;
        item.dataset.index = index;
        
        // Marca o canal que está tocando
        if (state.playingChannel && state.playingChannel.url === channel.url) {
            item.classList.add('playing');
        }
        
        el.channelsList.appendChild(item);
    });
}

// Select a folder and update visual
function selectFolder(index, focusChannels = false) {
    state.selectedFolderIndex = index;
    const folderName = state.folders[index];
    el.currentFolderTitle.textContent = folderName;
    
    // Atualiza marcação da pasta selecionada
    document.querySelectorAll('.folder-item').forEach((item, idx) => {
        item.classList.toggle('selected', idx === index);
    });
    
    renderChannels(folderName);
    
    if (focusChannels) {
        state.activeColumn = 'channels';
        state.focusedChannelIndex = 0;
    }
}

// Update focused element visual
function updateFocusDOM() {
    document.querySelectorAll('.list-item.focused').forEach(item => item.classList.remove('focused'));
    
    if (!state.isMenuVisible) return;
    
    let focusedElement = null;
    if (state.activeColumn === 'folders') {
        focusedElement = document.getElementById(`folder-${state.focusedFolderIndex}`);
    } else {
        focusedElement = document.getElementById(`channel-${state.focusedChannelIndex}`);
    }
    
    if (focusedElement) {
        focusedElement.classList.add('focused');
        focusedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

// Play Selected Channel
function playChannel(channel) {
    if (!channel || !channel.url) return;
    
    showStatus('Carregando canal...');
    
    if (state.hls) {
        state.hls.destroy();
        state.hls = null;
    }
    
    state.playingChannel = channel;
    localStorage.setItem(STORAGE_LAST_CHANNEL_KEY, JSON.stringify(channel));
    localStorage.setItem('iptv_last_played_folder', state.folders[state.selectedFolderIndex]);
    
    // Atualiza marcação visual
    selectFolder(state.selectedFolderIndex, false);
    
    // Reproduz com som
    if (Hls.isSupported()) {
        const hls = new Hls({
            maxBufferSize: 0,
            liveSyncDuration: 3,
            enableWorker: true
        });
        state.hls = hls;
        hls.loadSource(channel.url);
        hls.attachMedia(el.video);
        
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            el.video.muted = false; // Garante som ligado
            el.video.play()
                .then(() => {
                    hideStatus();
                    showToast(channel.name, channel.folder);
                })
                .catch(err => {
                    console.warn("Autoplay sem som:", err);
                    el.video.muted = false;
                    el.video.play().catch(() => {});
                });
        });
        
        hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        hls.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        hls.recoverMediaError();
                        break;
                    default:
                        showStatus('Erro ao carregar canal.', false);
                        break;
                }
            }
        });
    } else if (el.video.canPlayType('application/vnd.apple.mpegurl')) {
        el.video.src = channel.url;
        el.video.muted = false;
        el.video.addEventListener('loadedmetadata', () => {
            el.video.play()
                .then(() => {
                    hideStatus();
                    showToast(channel.name, channel.folder);
                })
                .catch(() => {
                    el.video.muted = false;
                    el.video.play().catch(() => {});
                });
        });
    } else {
        showStatus('Formato não suportado.', false);
    }
}

// Load Last Played Channel
function loadLastPlayedChannel() {
    const rawChannel = localStorage.getItem(STORAGE_LAST_CHANNEL_KEY);
    const lastFolder = localStorage.getItem('iptv_last_played_folder');
    
    if (rawChannel) {
        try {
            const channel = JSON.parse(rawChannel);
            const exists = state.channels.some(c => c.url === channel.url);
            if (exists) {
                let folderIndex = -1;
                if (lastFolder && state.folders.includes(lastFolder)) {
                    folderIndex = state.folders.indexOf(lastFolder);
                } else {
                    folderIndex = state.folders.indexOf(channel.folder);
                }
                
                if (folderIndex !== -1) {
                    selectFolder(folderIndex, false);
                    const folderChannels = state.channelsByFolder[state.folders[folderIndex]] || [];
                    const chIdx = folderChannels.findIndex(c => c.url === channel.url);
                    if (chIdx !== -1) state.focusedChannelIndex = chIdx;
                }
                playChannel(channel);
                return;
            }
        } catch(e) {
            console.error("Erro ao ler último canal:", e);
        }
    }
    
    // Fallback para primeiro canal
    if (state.folders.length > 0) {
        selectFolder(0, false);
        const firstFolderChannels = state.channelsByFolder[state.folders[0]];
        if (firstFolderChannels?.length > 0) playChannel(firstFolderChannels[0]);
    }
}

// Toggle Menu Visibility
function toggleMenu(forceVisible = null) {
    if (forceVisible !== null) {
        state.isMenuVisible = forceVisible;
    } else {
        state.isMenuVisible = !state.isMenuVisible;
    }
    
    if (state.isMenuVisible) {
        el.overlay.classList.add('visible');
        el.overlay.classList.remove('hidden');
        updateFocusDOM();
    } else {
        el.overlay.classList.remove('visible');
        el.overlay.classList.add('hidden');
    }
}

// Troca de canal
function zapChannel(direction) {
    const currentFolder = state.folders[state.selectedFolderIndex];
    const folderChannels = state.channelsByFolder[currentFolder] || [];
    if (folderChannels.length === 0) return;
    
    let currentIndex = state.playingChannel ? folderChannels.findIndex(c => c.url === state.playingChannel.url) : -1;
    const nextIndex = (currentIndex + direction + folderChannels.length) % folderChannels.length;
    
    state.focusedChannelIndex = nextIndex;
    playChannel(folderChannels[nextIndex]);
}

// Rolagem por toque estilo TikTok
function setupTouchSwipe() {
    el.video.addEventListener('touchstart', e => {
        state.touchStartY = e.touches[0].clientY;
    }, { passive: true });

    el.video.addEventListener('touchend', e => {
        state.touchEndY = e.changedTouches[0].clientY;
        const diffY = state.touchStartY - state.touchEndY;
        if (Math.abs(diffY) > state.swipeThreshold) {
            diffY > 0 ? zapChannel(1) : zapChannel(-1);
        }
    }, { passive: true });
}

// Fechar menu ao clicar fora
function setupClickOutsideToClose() {
    el.overlay.addEventListener('click', (e) => {
        if (e.target === el.overlay) {
            toggleMenu(false);
        }
    });
}

// Navegação por teclado
function setupKeyboardNavigation() {
    document.addEventListener('keydown', e => {
        if (!state.isMenuVisible) {
            if (e.key === 'ArrowUp') { e.preventDefault(); zapChannel(1); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); zapChannel(-1); return; }
            if (!['VolumeUp','VolumeDown','VolumeMute'].includes(e.key)) {
                e.preventDefault(); toggleMenu(true);
            }
            return;
        }

        const folderCount = state.folders.length;
        const currentFolderChannels = state.channelsByFolder[state.folders[state.selectedFolderIndex]] || [];
        const channelCount = currentFolderChannels.length;

        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                if (state.activeColumn === 'folders') {
                    state.focusedFolderIndex = (state.focusedFolderIndex - 1 + folderCount) % folderCount;
                    selectFolder(state.focusedFolderIndex, false);
                } else {
                    state.focusedChannelIndex = (state.focusedChannelIndex - 1 + channelCount) % channelCount;
                }
                updateFocusDOM();
                break;
            case 'ArrowDown':
                e.preventDefault();
                if (state.activeColumn === 'folders') {
                    state.focusedFolderIndex = (state.focusedFolderIndex + 1) % folderCount;
                    selectFolder(state.focusedFolderIndex, false);
                } else {
                    state.focusedChannelIndex = (state.focusedChannelIndex + 1) % channelCount;
                }
                updateFocusDOM();
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (state.activeColumn === 'folders' && channelCount > 0) {
                    state.activeColumn = 'channels';
                    const idx = currentFolderChannels.findIndex(c => c.url === state.playingChannel.url);
                    state.focusedChannelIndex = idx !== -1 ? idx : 0;
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
                if (state.activeColumn === 'folders') {
                    selectFolder(state.focusedFolderIndex, true);
                    updateFocusDOM();
                } else {
                    const ch = currentFolderChannels[state.focusedChannelIndex];
                    if (ch) {
                        if (state.playingChannel?.url === ch.url) toggleMenu(false);
                        else playChannel(ch);
                    }
                }
                break;
            case 'Escape':
            case 'Backspace':
                e.preventDefault();
                handleBackAction();
                break;
        }
    });
}

// Cliques do mouse
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
        const ch = state.channelsByFolder[state.folders[state.selectedFolderIndex]][idx];
        if (ch) {
            state.playingChannel?.url === ch.url ? toggleMenu(false) : playChannel(ch);
        }
    });

    el.video.addEventListener('click', e => {
        e.stopPropagation();
        toggleMenu();
    });
}

// Mostrar status
function showStatus(message, showRetry = false) {
    el.statusMsg.textContent = message;
    el.status.classList.remove('hidden');
    const spinner = el.status.querySelector('.spinner');
    if (spinner) spinner.classList.toggle('hidden', showRetry);
}

function hideStatus() {
    el.status.classList.add('hidden');
}

// Aviso de canal
let toastTimeout = null;
function showToast(name, folder) {
    el.toastName.textContent = name;
    el.toastGroup.textContent = folder;
    el.toast.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => el.toast.classList.add('hidden'), 4000);
}

// Botão voltar
function handleBackAction() {
    if (!state.isMenuVisible) { toggleMenu(true); return true; }
    if (state.activeColumn === 'channels') {
        state.activeColumn = 'folders';
        state.focusedFolderIndex = state.selectedFolderIndex;
        updateFocusDOM();
        return true;
    }
    if (state.isAndroid && window.Android?.exitApp) { window.Android.exitApp(); return true; }
    toggleMenu(false);
    return true;
}

window.AndroidInterface = { handleBackButton: () => handleBackAction() };