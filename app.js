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
    
    isMenuVisible: true,
    hls: null,
    isAndroid: false
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
    // If Android WebView, we can skip the splash screen because autoplay with sound is unlocked natively
    if (state.isAndroid) {
        el.splash.classList.add('hidden');
        el.splash.classList.remove('splash-visible');
        startApp();
    } else {
        // Desktop Browser: Wait for user gesture to unlock audio
        el.btnStart.focus();
        el.btnStart.classList.add('focused');
        
        el.btnStart.addEventListener('click', () => {
            el.splash.classList.add('hidden');
            el.splash.classList.remove('splash-visible');
            startApp();
        });
    }
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
            selectFolder(0, false); // Select first folder but don't focus channels
            
            // Load and play last channel or first channel
            loadLastPlayedChannel();
            
            // Set initial focus
            state.activeColumn = 'folders';
            state.focusedFolderIndex = 0;
            updateFocusDOM();
            
            // Register Keyboard / Remote Control Events
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
            // Default group if not present
            const folderName = groupMatch ? groupMatch[1].trim() : 'Outros';
            currentChannelMeta.folder = folderName;
            
            // Extract channel name (everything after the last comma)
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
                
                // Add folder to unique folders list in order of appearance
                const folderName = currentChannelMeta.folder;
                if (!state.folders.includes(folderName)) {
                    state.folders.push(folderName);
                    state.channelsByFolder[folderName] = [];
                }
                
                // Add to specific folder
                state.channelsByFolder[folderName].push(currentChannelMeta);
                
                currentChannelMeta = null; // Reset for next channel
            }
        }
    }
}

// Render Folders Column
function renderFolders() {
    el.foldersList.innerHTML = '';
    state.folders.forEach((folderName, index) => {
        const item = document.createElement('div');
        item.className = 'list-item';
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
        item.className = 'list-item';
        item.id = `channel-${index}`;
        item.textContent = channel.name;
        item.dataset.index = index;
        
        // Add playing class if this is the active playing channel
        if (state.playingChannel && state.playingChannel.url === channel.url) {
            item.classList.add('selected');
        }
        
        el.channelsList.appendChild(item);
    });
}

// Select a folder and optionally move focus to channels
function selectFolder(index, focusChannels = false) {
    state.selectedFolderIndex = index;
    const folderName = state.folders[index];
    el.currentFolderTitle.textContent = folderName;
    
    // Update folder selected style
    const previousSelected = el.foldersList.querySelector('.selected');
    if (previousSelected) previousSelected.classList.remove('selected');
    
    const currentFolderItem = document.getElementById(`folder-${index}`);
    if (currentFolderItem) currentFolderItem.classList.add('selected');
    
    renderChannels(folderName);
    
    if (focusChannels) {
        state.activeColumn = 'channels';
        state.focusedChannelIndex = 0;
    }
}

// Update focused element visual styles in the DOM
function updateFocusDOM() {
    // Remove previous focus classes
    const previousFocused = document.querySelectorAll('.list-item.focused');
    previousFocused.forEach(item => item.classList.remove('focused'));
    
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
    
    // Show loading spinner
    showStatus('Carregando streaming...');
    
    // Clean up previous HLS instance
    if (state.hls) {
        state.hls.destroy();
        state.hls = null;
    }
    
    state.playingChannel = channel;
    localStorage.setItem(STORAGE_LAST_CHANNEL_KEY, JSON.stringify(channel));
    localStorage.setItem('iptv_last_played_folder', state.folders[state.selectedFolderIndex]);
    
    // Update channels UI selected state
    const currentSelected = el.channelsList.querySelector('.selected');
    if (currentSelected) currentSelected.classList.remove('selected');
    
    // If the played channel is in the currently shown folder, mark it selected
    const currentFolder = state.folders[state.selectedFolderIndex];
    const folderChannels = state.channelsByFolder[currentFolder] || [];
    const channelIndex = folderChannels.findIndex(c => c.url === channel.url);
    
    if (channelIndex !== -1) {
        const item = document.getElementById(`channel-${channelIndex}`);
        if (item) item.classList.add('selected');
    }
    
    // Play video
    if (Hls.isSupported()) {
        const hls = new Hls({
            maxBufferSize: 0, // Minimize latency
            liveSyncDuration: 3,
            enableWorker: true
        });
        state.hls = hls;
        hls.loadSource(channel.url);
        hls.attachMedia(el.video);
        
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            el.video.play()
                .then(() => {
                    hideStatus();
                    showToast(channel.name, channel.folder);
                })
                .catch(err => {
                    console.warn("Autoplay failed:", err);
                    showStatus("Pressione OK para reproduzir.", false);
                });
        });
        
        hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        console.error("HLS network error:", data);
                        hls.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        console.error("HLS media error:", data);
                        hls.recoverMediaError();
                        break;
                    default:
                        showStatus('Erro ao carregar canal. Tente novamente.', false);
                        break;
                }
            }
        });
    } else if (el.video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS support (Safari / Android WebView natively)
        el.video.src = channel.url;
        el.video.addEventListener('loadedmetadata', () => {
            el.video.play()
                .then(() => {
                    hideStatus();
                    showToast(channel.name, channel.folder);
                })
                .catch(err => {
                    console.warn("Autoplay failed:", err);
                    showStatus("Pressione OK para reproduzir.", false);
                });
        });
    } else {
        showStatus('Formato de streaming não suportado por este dispositivo.', false);
    }
}

// Load Last Played Channel from storage
function loadLastPlayedChannel() {
    const rawChannel = localStorage.getItem(STORAGE_LAST_CHANNEL_KEY);
    const lastFolder = localStorage.getItem('iptv_last_played_folder');
    
    if (rawChannel) {
        try {
            const channel = JSON.parse(rawChannel);
            // Ensure the channel still exists in our current parsed list
            const exists = state.channels.some(c => c.url === channel.url);
            if (exists) {
                // Find folder index using the saved folder if it exists, else channel's folder
                let folderIndex = -1;
                if (lastFolder && state.folders.includes(lastFolder)) {
                    folderIndex = state.folders.indexOf(lastFolder);
                } else {
                    folderIndex = state.folders.indexOf(channel.folder);
                }
                
                if (folderIndex !== -1) {
                    selectFolder(folderIndex, false);
                    
                    // Update focusedChannelIndex in the folder
                    const folderChannels = state.channelsByFolder[state.folders[folderIndex]] || [];
                    const chIdx = folderChannels.findIndex(c => c.url === channel.url);
                    if (chIdx !== -1) {
                        state.focusedChannelIndex = chIdx;
                    }
                }
                playChannel(channel);
                return;
            }
        } catch(e) {
            console.error("Error reading last played channel:", e);
        }
    }
    
    // Fallback: Play first channel of first folder
    if (state.folders.length > 0) {
        selectFolder(0, false);
        const firstFolder = state.folders[0];
        const firstFolderChannels = state.channelsByFolder[firstFolder];
        if (firstFolderChannels && firstFolderChannels.length > 0) {
            playChannel(firstFolderChannels[0]);
        }
    }
}

// Toggle Menu Overlay Visibility
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

// Zap Channel (when menu is hidden)
function zapChannel(direction) {
    const currentFolder = state.folders[state.selectedFolderIndex];
    const folderChannels = state.channelsByFolder[currentFolder] || [];
    if (folderChannels.length === 0) return;
    
    let currentIndex = -1;
    if (state.playingChannel) {
        currentIndex = folderChannels.findIndex(c => c.url === state.playingChannel.url);
    }
    
    let nextIndex;
    if (currentIndex === -1) {
        nextIndex = 0;
    } else {
        // Up Arrow (direction = 1) plays next channel, Down Arrow (direction = -1) plays previous channel
        nextIndex = (currentIndex + direction + folderChannels.length) % folderChannels.length;
    }
    
    state.focusedChannelIndex = nextIndex;
    const targetChannel = folderChannels[nextIndex];
    playChannel(targetChannel);
}

// Setup Keyboard and TV D-Pad Remote Navigation
function setupKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
        // If splash screen is active, do nothing else
        if (el.splash.classList.contains('splash-visible') && !state.isAndroid) {
            if (e.key === 'Enter') {
                el.btnStart.click();
            }
            return;
        }

        // If menu is hidden, pressing ArrowUp/Down zaps channels, other keys reveal menu
        if (!state.isMenuVisible) {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                zapChannel(1); // Next channel
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                zapChannel(-1); // Previous channel
                return;
            }
            
            const ignoredKeys = ['VolumeUp', 'VolumeDown', 'VolumeMute', 'Mute'];
            if (!ignoredKeys.includes(e.key)) {
                e.preventDefault();
                toggleMenu(true);
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
                    // Focus currently playing channel if it is in this folder, else focus first
                    const playingInThisFolder = state.playingChannel && state.playingChannel.folder === state.folders[state.selectedFolderIndex];
                    if (playingInThisFolder) {
                        const idx = currentFolderChannels.findIndex(c => c.url === state.playingChannel.url);
                        state.focusedChannelIndex = idx !== -1 ? idx : 0;
                    } else {
                        state.focusedChannelIndex = 0;
                    }
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
                    // Enter on a folder moves focus to channels list
                    selectFolder(state.focusedFolderIndex, true);
                    updateFocusDOM();
                } else {
                    // Enter on a channel plays it
                    const targetChannel = currentFolderChannels[state.focusedChannelIndex];
                    if (targetChannel) {
                        const isAlreadyPlaying = state.playingChannel && state.playingChannel.url === targetChannel.url;
                        if (isAlreadyPlaying) {
                            // If same channel, close the menu (toggle)
                            toggleMenu(false);
                        } else {
                            playChannel(targetChannel);
                        }
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

// Setup Mouse click interactions
function setupMouseClickHandlers() {
    // Folders list click
    el.foldersList.addEventListener('click', (e) => {
        const item = e.target.closest('.list-item');
        if (!item) return;
        const index = parseInt(item.dataset.index);
        state.focusedFolderIndex = index;
        state.activeColumn = 'folders';
        selectFolder(index, false);
        updateFocusDOM();
    });

    // Channels list click
    el.channelsList.addEventListener('click', (e) => {
        const item = e.target.closest('.list-item');
        if (!item) return;
        const index = parseInt(item.dataset.index);
        state.focusedChannelIndex = index;
        state.activeColumn = 'channels';
        updateFocusDOM();

        const currentFolderChannels = state.channelsByFolder[state.folders[state.selectedFolderIndex]] || [];
        const targetChannel = currentFolderChannels[index];
        if (targetChannel) {
            const isAlreadyPlaying = state.playingChannel && state.playingChannel.url === targetChannel.url;
            if (isAlreadyPlaying) {
                toggleMenu(false);
            } else {
                playChannel(targetChannel);
            }
        }
    });

    // Tap on background video toggles menu
    el.video.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMenu();
    });
}

// Status Display Helpers
function showStatus(message, showRetry = false) {
    el.statusMsg.textContent = message;
    el.status.classList.remove('hidden');
    const spinner = el.status.querySelector('.spinner');
    if (showRetry) {
        if (spinner) spinner.classList.add('hidden');
    } else {
        if (spinner) spinner.classList.remove('hidden');
    }
}

function hideStatus() {
    el.status.classList.add('hidden');
}

// Toast info banner notification
let toastTimeout = null;
function showToast(name, folder) {
    el.toastName.textContent = name;
    el.toastGroup.textContent = folder;
    el.toast.classList.remove('hidden');
    
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        el.toast.classList.add('hidden');
    }, 4000);
}

// Unified back action handler
function handleBackAction() {
    if (!state.isMenuVisible) {
        toggleMenu(true);
        return true;
    } else if (state.activeColumn === 'channels') {
        state.activeColumn = 'folders';
        state.focusedFolderIndex = state.selectedFolderIndex;
        updateFocusDOM();
        return true;
    } else {
        // We are on folders column and menu is visible
        if (state.isAndroid && window.Android && typeof window.Android.exitApp === 'function') {
            window.Android.exitApp();
            return true;
        } else {
            toggleMenu(false);
            return true;
        }
    }
}

// External command receiver interface (called from Android App wrapper Native side)
window.AndroidInterface = {
    handleBackButton: function() {
        return handleBackAction();
    }
};
