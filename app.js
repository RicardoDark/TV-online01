// Constants
const M3U_URL = 'https://raw.githubusercontent.com/RicardoDark/iptv01/refs/heads/main/minhalista.m3u';
const STORAGE_LAST_CHANNEL_KEY = 'iptv_last_played_channel';

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
    menuTimeout: null,
    selectedCategory: null, // 'tv' ou 'movies'
    splashFocusIndex: 0 // 0 para TV, 1 para Filmes
};

// DOM Elements
const el = {
    video: document.getElementById('video-player'),
    overlay: document.getElementById('overlay-menu'),
    foldersList: document.getElementById('folders-list'),
    channelsList: document.getElementById('channels-list'),
    currentFolderTitle: document.getElementById('current-folder-title'),
    splash: document.getElementById('splash-screen'),
    btnTv: document.getElementById('btn-tv'),
    btnMovies: document.getElementById('btn-movies'),
    status: document.getElementById('status-container'),
    statusMsg: document.getElementById('status-message'),
    toast: document.getElementById('toast-info'),
    toastName: document.getElementById('toast-channel-name'),
    toastGroup: document.getElementById('toast-channel-group')
};

const urlParams = new URLSearchParams(window.location.search);
state.isAndroid = navigator.userAgent.toLowerCase().includes('android') || urlParams.get('platform') === 'android';

window.addEventListener('DOMContentLoaded', () => {
    el.overlay.classList.remove('visible');
    el.overlay.classList.add('hidden');

    setupSplashNavigation();
});

function setupSplashNavigation() {
    updateSplashFocus();
    document.addEventListener('keydown', handleSplashKeys);
    
    el.btnTv.addEventListener('click', () => selectCategoryAndStart('tv'));
    el.btnMovies.addEventListener('click', () => selectCategoryAndStart('movies'));
}

function updateSplashFocus() {
    if (state.splashFocusIndex === 0) {
        el.btnTv.classList.add('focused');
        el.btnMovies.classList.remove('focused');
    } else {
        el.btnMovies.classList.add('focused');
        el.btnTv.classList.remove('focused');
    }
}

function handleSplashKeys(e) {
    if (!el.splash.classList.contains('hidden')) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            state.splashFocusIndex = state.splashFocusIndex === 0 ? 1 : 0;
            updateSplashFocus();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (state.splashFocusIndex === 0) {
                selectCategoryAndStart('tv');
            } else {
                selectCategoryAndStart('movies');
            }
        }
    }
}

function selectCategoryAndStart(category) {
    state.selectedCategory = category;
    document.removeEventListener('keydown', handleSplashKeys);
    
    el.splash.classList.add('hidden');
    el.splash.classList.remove('splash-visible');
    startApp();
}

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
                showStatus('Nenhum conteúdo encontrado para esta categoria.', true);
                return;
            }
            
            renderFolders();
            selectFolder(0, false);
            loadLastPlayedChannel();
            
            state.activeColumn = 'folders';
            state.focusedFolderIndex = 0;
            updateFocusDOM();
            
            setupKeyboardNavigation();
            setupMouseClickHandlers();
        })
        .catch(err => {
            console.error(err);
            showStatus('Erro ao carregar a lista IPTV. Verifique sua conexão.', true);
        });
}

function parseM3U(m3uContent) {
    const lines = m3uContent.split('\n');
    let currentChannelMeta = null;
    
    state.channels = [];
    state.folders = [];
    state.channelsByFolder = {};

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('#EXTINF:')) {
            currentChannelMeta = {};
            const groupMatch = line.match(/group-title="([^"]+)"/);
            const folderName = groupMatch ? groupMatch[1].trim() : 'Outros';
            currentChannelMeta.folder = folderName;
            
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
                
                const folderLower = currentChannelMeta.folder.toLowerCase();
                const isMovieFolder = folderLower.includes('movie Anime') || 
				folderLower.includes('123456') || 
				folderLower.includes('Barom One') ||
				folderLower.includes('Galaxy Angel') ||
				folderLower.includes('Ikkitousen') ||
				folderLower.includes('Nadja do Amanhã') || folderLower.includes('movie') || folderLower.includes('vod') || 
				folderLower.includes('Thumbelina') || 
				currentChannelMeta.url.endsWith('.mp4') || currentChannelMeta.url.endsWith('.mkv');
                
                let keep = false;
                if (state.selectedCategory === 'movies' && isMovieFolder) {
                    keep = true;
                } else if (state.selectedCategory === 'tv' && !isMovieFolder) {
                    keep = true;
                }

                if (keep) {
                    state.channels.push(currentChannelMeta);
                    const folderName = currentChannelMeta.folder;
                    
                    if (!state.folders.includes(folderName)) {
                        state.folders.push(folderName);
                        state.channelsByFolder[folderName] = [];
                    }
                    
                    state.channelsByFolder[folderName].push(currentChannelMeta);
                }
                currentChannelMeta = null;
            }
        }
    }
}

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

function renderChannels(folderName) {
    el.channelsList.innerHTML = '';
    const folderChannels = state.channelsByFolder[folderName] || [];
    
    folderChannels.forEach((channel, index) => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.id = `channel-${index}`;
        item.textContent = channel.name;
        item.dataset.index = index;
        
        if (state.playingChannel && state.playingChannel.url === channel.url) {
            item.classList.add('selected');
        }
        
        el.channelsList.appendChild(item);
    });
}

function selectFolder(index, focusChannels = false) {
    state.selectedFolderIndex = index;
    const folderName = state.folders[index];
    el.currentFolderTitle.textContent = folderName;
    
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

function updateFocusDOM() {
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

function resetMenuInactivityTimer() {
    if (state.menuTimeout) {
        clearTimeout(state.menuTimeout);
        state.menuTimeout = null;
    }

    if (state.isMenuVisible) {
        state.menuTimeout = setTimeout(() => {
            toggleMenu(false);
        }, 10000);
    }
}

function playYouTubeChannel(channel) {
    state.playingChannel = channel;
    localStorage.setItem(STORAGE_LAST_CHANNEL_KEY, JSON.stringify(channel));
    localStorage.setItem('iptv_last_played_folder', state.folders[state.selectedFolderIndex]);

    let videoId = '';
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = channel.url.match(regExp);
    if (match && match[2].length === 11) {
        videoId = match[2];
    }

    hideStatus();
    showToast(`Abrindo YouTube: ${channel.name}`, channel.folder);

    if (state.isAndroid) {
        window.location.href = `vnd.youtube://${videoId}`;
        setTimeout(() => {
            window.location.href = `https://www.youtube.com/watch?v=${videoId}`;
        }, 500);
    } else {
        window.open(`https://www.youtube.com/watch?v=${videoId}`, '_blank');
    }
}

function playChannel(channel) {
    if (!channel || !channel.url) return;
    
    state.playingChannel = channel;
    
    const currentSelected = el.channelsList.querySelector('.selected');
    if (currentSelected) currentSelected.classList.remove('selected');
    
    const currentFolder = state.folders[state.selectedFolderIndex];
    const folderChannels = state.channelsByFolder[currentFolder] || [];
    const channelIndex = folderChannels.findIndex(c => c.url === channel.url);
    
    if (channelIndex !== -1) {
        const item = document.getElementById(`channel-${channelIndex}`);
        if (item) item.classList.add('selected');
    }

    if (channel.url.includes('youtube.com') || channel.url.includes('youtu.be')) {
        playYouTubeChannel(channel);
        return;
    }

    showStatus('Carregando mídia...');
    localStorage.setItem(STORAGE_LAST_CHANNEL_KEY, JSON.stringify(channel));
    localStorage.setItem('iptv_last_played_folder', state.folders[state.selectedFolderIndex]);

    const ytContainer = document.getElementById('youtube-iframe-container');
    if (ytContainer) ytContainer.style.display = 'none';
    el.video.style.display = 'block';
    
    if (state.hls) {
        state.hls.destroy();
        state.hls = null;
    }

    if (channel.url.endsWith('.mp4') || channel.url.endsWith('.mkv') || channel.url.endsWith('.webm') || channel.url.includes('.mp4?')) {
        el.video.src = channel.url;
        el.video.load();
        el.video.play()
            .then(() => {
                hideStatus();
                showToast(channel.name, channel.folder);
            })
            .catch(err => {
                console.warn("Autoplay failed:", err);
                showStatus("Pressione OK para reproduzir.", false);
            });
        return;
    }
    
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
            el.video.play()
                .then(() => {
                    hideStatus();
                    showToast(channel.name, channel.folder);
                })
                .catch(err => {
                    showStatus("Pressione OK para reproduzir.", false);
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
                        showStatus('Erro ao carregar canal. Tente novamente.', false);
                        break;
                }
            }
        });
    } else if (el.video.canPlayType('application/vnd.apple.mpegurl')) {
        el.video.src = channel.url;
        el.video.addEventListener('loadedmetadata', () => {
            el.video.play()
                .then(() => {
                    hideStatus();
                    showToast(channel.name, channel.folder);
                })
                .catch(() => {
                    showStatus("Pressione OK para reproduzir.", false);
                });
        });
    } else {
        showStatus('Formato de mídia não suportado por este dispositivo.', false);
    }
}

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
    
    if (state.folders.length > 0) {
        selectFolder(0, false);
        const firstFolder = state.folders[0];
        const firstFolderChannels = state.channelsByFolder[firstFolder];
        if (firstFolderChannels && firstFolderChannels.length > 0) {
            playChannel(firstFolderChannels[0]);
        }
    }
}

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
        resetMenuInactivityTimer();
    } else {
        el.overlay.classList.remove('visible');
        el.overlay.classList.add('hidden');
        if (state.menuTimeout) {
            clearTimeout(state.menuTimeout);
            state.menuTimeout = null;
        }
    }
}

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
        nextIndex = (currentIndex + direction + folderChannels.length) % folderChannels.length;
    }
    
    state.focusedChannelIndex = nextIndex;
    const targetChannel = folderChannels[nextIndex];
    playChannel(targetChannel);
}

function setupKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
        if (state.isMenuVisible) {
            resetMenuInactivityTimer();
        }

        if (!state.isMenuVisible) {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                zapChannel(1);
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                zapChannel(-1);
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
                    selectFolder(state.focusedFolderIndex, true);
                    updateFocusDOM();
                } else {
                    const targetChannel = currentFolderChannels[state.focusedChannelIndex];
                    if (targetChannel) {
                        const isAlreadyPlaying = state.playingChannel && state.playingChannel.url === targetChannel.url;
                        if (isAlreadyPlaying) {
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

function setupMouseClickHandlers() {
    el.foldersList.addEventListener('click', (e) => {
        resetMenuInactivityTimer();
        const item = e.target.closest('.list-item');
        if (!item) return;
        const index = parseInt(item.dataset.index);
        state.focusedFolderIndex = index;
        state.activeColumn = 'folders';
        selectFolder(index, false);
        updateFocusDOM();
    });

    el.channelsList.addEventListener('click', (e) => {
        resetMenuInactivityTimer();
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

    el.video.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMenu();
    });
}

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
        window.location.reload();
        return true;
    }
}

window.AndroidInterface = {
    handleBackButton: function() {
        return handleBackAction();
    }
};