// Constants
const M3U_URL = 'https://raw.githubusercontent.com/RicardoDark/iptv01/refs/heads/main/minhalista.m3u';
const STORAGE_LAST_CHANNEL_KEY = 'iptv_last_played_channel';
const TV_FAV_KEY = 'iptv_tv_favs';
const LONG_PRESS_MS = 700;
let FAV_FOLDER = 'Favoritos';

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
    selectedCategory: null, // 'tv', 'movies' ou 'series'
    splashFocusIndex: 0, // 0: TV, 1: Filmes, 2: Séries
    splashZone: 'cards', // 'cards' ou 'top' (ícones do canto)
    splashTopIndex: 1, // 0: TV Favoritos, 1: Favoritos (coração), 2: Histórico
    startFavorites: false,
    vodEntryCat: null,
    m3uText: '',
    enterPressed: false,
    enterTimer: null,
    enterChannel: null,
    longDone: false
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
    btnSeries: document.getElementById('btn-series'),
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
    state.splashZone = 'cards';
    state.splashTopIndex = 1;
    updateSplashFocus();
    document.addEventListener('keydown', handleSplashKeys);

    el.btnTv.addEventListener('click', () => selectCategoryAndStart('tv'));
    el.btnMovies.addEventListener('click', () => selectCategoryAndStart('movies'));
    el.btnSeries.addEventListener('click', () => selectCategoryAndStart('series'));

    splashTopButtons().forEach((btn, i) => {
        btn.addEventListener('click', () => splashTopAction(i));
    });
}

function splashTopButtons() {
    return [
        document.getElementById('btn-tvfav'),
        document.getElementById('btn-vodfav'),
        document.getElementById('btn-vodhist')
    ];
}

function splashTopAction(i) {
    if (i === 0) selectCategoryAndStart('tv', { tvFavorites: true });
    else if (i === 1) selectCategoryAndStart('mixed', { vodCat: '__fav' });
    else selectCategoryAndStart('mixed', { vodCat: '__hist' });
}

function updateSplashFocus() {
    const cards = [el.btnTv, el.btnMovies, el.btnSeries];
    cards.forEach(c => c.classList.remove('focused'));
    const tops = splashTopButtons();
    tops.forEach(t => { if (t) t.classList.remove('focused'); });

    if (state.splashZone === 'cards') {
        cards[state.splashFocusIndex].classList.add('focused');
    } else if (tops[state.splashTopIndex]) {
        tops[state.splashTopIndex].classList.add('focused');
    }
}

function handleSplashKeys(e) {
    if (el.splash.classList.contains('hidden')) return;

    if (state.splashZone === 'cards') {
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            state.splashFocusIndex = (state.splashFocusIndex + 1) % 3;
            updateSplashFocus();
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            state.splashFocusIndex = (state.splashFocusIndex - 1 + 3) % 3;
            updateSplashFocus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            state.splashZone = 'top';
            updateSplashFocus();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (state.splashFocusIndex === 0) {
                selectCategoryAndStart('tv');
            } else if (state.splashFocusIndex === 1) {
                selectCategoryAndStart('movies');
            } else {
                selectCategoryAndStart('series');
            }
        }
    } else {
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            state.splashTopIndex = Math.min(2, state.splashTopIndex + 1);
            updateSplashFocus();
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            state.splashTopIndex = Math.max(0, state.splashTopIndex - 1);
            updateSplashFocus();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            state.splashZone = 'cards';
            updateSplashFocus();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            splashTopAction(state.splashTopIndex);
        }
    }
}

function selectCategoryAndStart(category, opts) {
    state.selectedCategory = category;
    state.startFavorites = !!(opts && opts.tvFavorites);
    state.vodEntryCat = (opts && opts.vodCat) || null;
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
            state.m3uText = data;
            if (state.selectedCategory === 'mixed') {
                hideStatus();
                startVodMixed();
                return;
            }
            parseM3U(data);
            hideStatus();
            
            if (state.folders.length === 0) {
                showStatus('Nenhum conteúdo encontrado para esta categoria.', true);
                return;
            }
            
            if (state.selectedCategory === 'movies' || state.selectedCategory === 'series') {
                startVod();
                return;
            }

            buildTvFavFolder();
            renderFolders();
            selectFolder(0, false);
            if (!state.startFavorites) loadLastPlayedChannel();
            
            state.activeColumn = 'folders';
            state.focusedFolderIndex = 0;
            if (state.startFavorites) {
                state.activeColumn = (state.channelsByFolder[FAV_FOLDER] || []).length ? 'channels' : 'folders';
                state.focusedChannelIndex = 0;
                toggleMenu(true);
            }
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
            const logoMatch = line.match(/tvg-logo="([^"]*)"/);
            currentChannelMeta.logo = logoMatch ? logoMatch[1].trim() : '';
            
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
                folderLower.includes('Solty Rei') ||
                folderLower.includes('Steel Angel Kurumi 2') ||
                folderLower.includes('Auto da Compadecida') ||
                folderLower.includes('Barom One') ||
                folderLower.includes('Galaxy Angel') ||
                folderLower.includes('Ikkitousen') ||
                folderLower.includes('Nadja do Amanhã') || folderLower.includes('movie') || folderLower.includes('vod') || 
                folderLower.includes('Thumbelina') || 
                currentChannelMeta.url.endsWith('.mp4') || currentChannelMeta.url.endsWith('.mkv');

                const isSeriesFolder = folderLower.includes('serie') || folderLower.includes('série') || folderLower.includes('season') || folderLower.includes('temporada');
                
                let keep = false;
                if (state.selectedCategory === 'movies' && isMovieFolder && !isSeriesFolder) {
                    keep = true;
                } else if (state.selectedCategory === 'series' && isSeriesFolder) {
                    keep = true;
                } else if (state.selectedCategory === 'tv' && !isMovieFolder && !isSeriesFolder) {
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
        item.textContent = channel.name + ((folderName !== FAV_FOLDER && isTvFav(channel)) ? '  \u2665' : '');
        item.dataset.index = index;
        
        if (state.playingChannel && state.playingChannel.url === channel.url) {
            item.classList.add('selected');
        }
        
        el.channelsList.appendChild(item);
    });

    if (folderName === FAV_FOLDER && folderChannels.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'list-hint';
        hint.textContent = 'Nenhum favorito ainda. Em qualquer canal, segure o OK para adicionar.';
        el.channelsList.appendChild(hint);
    }
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
        let fi = state.folders.findIndex(f => (state.channelsByFolder[f] || []).length > 0);
        if (fi === -1) fi = 0;
        selectFolder(fi, false);
        const firstFolderChannels = state.channelsByFolder[state.folders[fi]];
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
    setupEnterKeyUp();
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
                    startEnterPress(currentFolderChannels[state.focusedChannelIndex]);
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

    el.channelsList.addEventListener('contextmenu', (e) => {
        const item = e.target.closest('.list-item');
        if (!item) return;
        e.preventDefault();
        const index = parseInt(item.dataset.index);
        const list = state.channelsByFolder[state.folders[state.selectedFolderIndex]] || [];
        state.focusedChannelIndex = index;
        state.activeColumn = 'channels';
        toggleTvFav(list[index]);
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
    if (state.vodActive) return vodBack();
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

/* ====================================================================
   FILMES E SÉRIES (VOD)
   Tudo navegável pelo controle remoto: setas, OK (Enter) e Voltar.
   ==================================================================== */

// Opcional: coloque aqui sua chave gratuita do TMDB (themoviedb.org) para
// carregar sinopse e nota automaticamente. Sem chave, a sinopse não aparece.
const TMDB_API_KEY = '';

const LS_PROGRESS = 'iptv_vod_progress';
const LS_LASTEP = 'iptv_vod_lastep';
const GRID_COLS = 4;
const GRID_STEP = 40;
const KB_COLS = 6;
const KB_ROWS = [
    ['A','B','C','D','E','F'],
    ['G','H','I','J','K','L'],
    ['M','N','O','P','Q','R'],
    ['S','T','U','V','W','X'],
    ['Y','Z','1','2','3','4'],
    ['5','6','7','8','9','0'],
    ['ESPAÇO','APAGAR','LIMPAR']
];
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

const vod = {
    kind: 'movies',
    cards: [], byKey: {}, folders: [], cats: [],
    catIndex: 0, catId: '__all', catTimer: null,
    list: [], shown: 0,
    view: 'home', zone: 'cats', idx: 0,
    stack: [],
    card: null, season: 1, epUrl: null, related: [],
    query: '', kbR: 0, kbC: 0,
    metaCache: {},
    fullscreen: false, settingsOpen: false, settingsRow: 0,
    speedIdx: 1, fitCover: false,
    uiTimer: null, iconTimer: null, lastSave: 0, seekRepeat: 0, resumeAt: 0, playUrl: null
};

const ICON_SEARCH = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.5" y2="16.5"></line></svg>';
const ICON_CLOCK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
const ICON_FS = '<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"></path></svg>';
const ICON_HEART = '<svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5"></circle><line x1="9.5" y1="8" x2="9.5" y2="16"></line><line x1="14.5" y1="8" x2="14.5" y2="16"></line></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>';

/* ---------- utilidades ---------- */
function $v(id) { return document.getElementById(id); }
function lsGet(k, d) {
    try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; }
}
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function favKey() { return 'iptv_vod_favs'; }
function histKey() { return 'iptv_vod_hist'; }
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}
function norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const p = function (n) { return String(n).padStart(2, '0'); };
    return h > 0 ? (p(h) + ':' + p(m) + ':' + p(s)) : (p(m) + ':' + p(s));
}
function isFav(card) { return lsGet(favKey(), []).indexOf(card.key) !== -1; }
function toggleFav(card) {
    let f = lsGet(favKey(), []);
    const i = f.indexOf(card.key);
    if (i === -1) f.unshift(card.key); else f.splice(i, 1);
    lsSet(favKey(), f);
}
function addHistory(card) {
    let h = lsGet(histKey(), []).filter(function (k) { return k !== card.key; });
    h.unshift(card.key);
    lsSet(histKey(), h.slice(0, 60));
}

/* ---------- montagem dos cartões a partir da lista M3U ---------- */
function buildVodCards(sets) {
    vod.cards = [];
    vod.byKey = {};

    sets.forEach(function (set) {
        if (set.kind === 'movies') {
            set.channels.forEach(function (ch) {
                const c = { key: ch.url, title: ch.name, logo: ch.logo || '', kind: 'movie', group: ch.folder, url: ch.url };
                vod.cards.push(c);
                vod.byKey[c.key] = c;
            });
        } else {
            const map = {};
            const created = [];
            set.channels.forEach(function (ch) {
                const m = ch.name.match(/^(.*?)[\s\-_.]*S(\d{1,2})\s*E(\d{1,4})/i);
                const title = (m && m[1].trim()) ? m[1].trim() : ch.name;
                const season = m ? parseInt(m[2], 10) : 1;
                const ep = m ? parseInt(m[3], 10) : 1;
                const key = 'S:' + ch.folder + '|' + title;
                if (!map[key]) {
                    map[key] = { key: key, title: title, logo: '', kind: 'series', group: ch.folder, eps: [] };
                    created.push(map[key]);
                    vod.cards.push(map[key]);
                    vod.byKey[key] = map[key];
                }
                if (!map[key].logo && ch.logo) map[key].logo = ch.logo;
                map[key].eps.push({ name: ch.name, url: ch.url, season: season, ep: ep });
            });
            created.forEach(function (c) {
                c.eps.sort(function (a, b) { return (a.season - b.season) || (a.ep - b.ep); });
            });
        }
    });

    vod.folders = [];
    vod.cards.forEach(function (c) { if (vod.folders.indexOf(c.group) === -1) vod.folders.push(c.group); });
    vod.cats = [{ id: '__all', label: 'Todos' }, { id: '__fav', label: 'Favoritos' }]
        .concat(vod.folders.map(function (f) { return { id: f, label: f }; }));
}

function getCatList(id) {
    if (id === '__all') return vod.cards;
    if (id === '__fav') return lsGet(favKey(), []).map(function (k) { return vod.byKey[k]; }).filter(Boolean);
    if (id === '__hist') return lsGet(histKey(), []).map(function (k) { return vod.byKey[k]; }).filter(Boolean);
    return vod.cards.filter(function (c) { return c.group === id; });
}

function catLabel() {
    if (vod.view === 'search') return 'Resultados';
    if (vod.catId === '__hist') return 'Histórico';
    const c = vod.cats[vod.catIndex];
    return c ? c.label : '';
}

/* ---------- início ---------- */
function startVodMixed() {
    const sets = [];
    ['movies', 'series'].forEach(function (cat) {
        state.selectedCategory = cat;
        parseM3U(state.m3uText);
        sets.push({ kind: cat, channels: state.channels.slice() });
    });
    state.selectedCategory = 'mixed';
    startVod(sets, state.vodEntryCat);
}

function migrateVodStores() {
    ['favs', 'hist'].forEach(function (t) {
        ['movies', 'series'].forEach(function (k) {
            const old = lsGet('iptv_vod_' + t + '_' + k, null);
            if (old && old.length) {
                const cur = lsGet('iptv_vod_' + t, []);
                lsSet('iptv_vod_' + t, cur.concat(old.filter(function (x) { return cur.indexOf(x) === -1; })));
            }
            try { localStorage.removeItem('iptv_vod_' + t + '_' + k); } catch (e) {}
        });
    });
}

function startVod(sets, entryCat) {
    if (!sets) sets = [{ kind: state.selectedCategory, channels: state.channels }];
    buildVodCards(sets);
    hideStatus();
    if (!vod.cards.length) {
        showStatus('Nenhum conteúdo encontrado para esta categoria.', true);
        return;
    }
    migrateVodStores();
    state.vodActive = true;
    document.body.classList.add('vod-on');
    el.overlay.classList.add('hidden');
    el.overlay.classList.remove('visible');
    $v('vod-root').classList.add('active');

    const v = el.video;
    v.addEventListener('timeupdate', onVodTime);
    v.addEventListener('loadedmetadata', onVodMeta);
    v.addEventListener('waiting', function () { vodSpin(true); });
    v.addEventListener('loadstart', function () { vodSpin(true); });
    v.addEventListener('playing', function () { vodSpin(false); flashIcon(false); });
    v.addEventListener('canplay', function () { vodSpin(false); });
    v.addEventListener('pause', function () { if (vod.fullscreen) flashIcon(true); });
    v.addEventListener('ended', onVodEnded);
    v.addEventListener('error', function () { vodSpin(false); });

    document.addEventListener('keydown', vodKeys);
    document.addEventListener('keyup', function (e) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') vod.seekRepeat = 0;
    });
    window.addEventListener('resize', positionWin);
    setupVodPointer();

    vod.catId = '__all';
    vod.catIndex = 0;
    if (entryCat) {
        vod.catId = entryCat;
        const ci = vod.cats.map(function (c) { return c.id; }).indexOf(entryCat);
        vod.catIndex = ci === -1 ? 0 : ci;
    }
    const startList = getCatList(vod.catId);
    if (entryCat && startList.length) vodShowHome('grid', 0);
    else vodShowHome('cats', vod.catIndex);
}

/* ---------- tela principal (categorias + capas) ---------- */
function vodShowHome(zone, idx) {
    vod.view = 'home';
    vod.list = getCatList(vod.catId);
    vod.shown = (zone === 'grid') ? Math.max(GRID_STEP, Math.ceil((idx + 1) / GRID_STEP) * GRID_STEP + GRID_STEP) : GRID_STEP;

    $v('vod-root').innerHTML =
        '<div class="vod-home">' +
          '<div class="vod-cats" id="vod-cats">' +
            vod.cats.map(function (c, i) {
                return '<div class="vod-cat" data-z="cats" data-i="' + i + '">' + esc(c.label) + '</div>';
            }).join('') +
          '</div>' +
          '<div class="vod-main">' +
            '<div class="vod-top">' +
              '<div class="vod-btn" data-z="top" data-i="0">' + ICON_SEARCH + 'Pesquisar</div>' +
              '<div class="vod-btn" data-z="top" data-i="1">' + ICON_CLOCK + 'Histórico</div>' +
              '<div class="vod-spacer"></div>' +
              '<div class="vod-catlabel" id="vod-catlabel"></div>' +
              '<div class="vod-total" id="vod-total"></div>' +
            '</div>' +
            '<div class="vod-grid" id="vod-grid"></div>' +
          '</div>' +
        '</div>';

    renderGrid();
    markCat();
    vod.zone = zone;
    vod.idx = idx;
    applyFocus();
}

function markCat() {
    const items = document.querySelectorAll('.vod-cat');
    for (let i = 0; i < items.length; i++) {
        items[i].classList.toggle('sel', vod.catId !== '__hist' && i === vod.catIndex);
    }
}

function cardHtml(c, i, z) {
    return '<div class="vod-card" data-z="' + z + '" data-i="' + i + '">' +
        '<div class="vod-poster">' +
          '<span class="vod-ph">' + esc(c.title) + '</span>' +
          (c.logo ? '<img src="' + esc(c.logo) + '" onerror="this.parentNode.removeChild(this)">' : '') +
        '</div>' +
        '<div class="vod-card-title">' + esc(c.title) + '</div>' +
      '</div>';
}

function renderGrid() {
    const g = $v('vod-grid');
    if (!g) return;
    const slice = vod.list.slice(0, vod.shown);
    g.innerHTML = slice.length
        ? slice.map(function (c, i) { return cardHtml(c, i, 'grid'); }).join('')
        : '<div class="vod-empty">' + emptyText() + '</div>';
    g.onscroll = function () { if (g.scrollTop + g.clientHeight > g.scrollHeight - 700) loadMore(); };
    const t = $v('vod-total'); if (t) t.textContent = 'Total: ' + vod.list.length;
    const l = $v('vod-catlabel'); if (l) l.textContent = catLabel();
}

function emptyText() {
    if (vod.view === 'search') return vod.query ? 'Nenhum resultado para essa busca.' : 'Digite no teclado para pesquisar.';
    if (vod.catId === '__fav') return 'Você ainda não tem favoritos. Abra um título e escolha Favorito.';
    if (vod.catId === '__hist') return 'Seu histórico está vazio.';
    return 'Nada por aqui.';
}

function loadMore() {
    if (vod.shown >= vod.list.length) return;
    const g = $v('vod-grid');
    if (!g) return;
    const from = g.children.length;
    vod.shown = Math.min(vod.list.length, vod.shown + GRID_STEP);
    g.insertAdjacentHTML('beforeend', vod.list.slice(from, vod.shown).map(function (c, k) {
        return cardHtml(c, from + k, 'grid');
    }).join(''));
}

function ensureShown(i) {
    if (i >= vod.shown - GRID_COLS * 2) loadMore();
}

function setCat(i) {
    vod.catIndex = i;
    vod.catId = vod.cats[i].id;
    vod.idx = i;
    applyFocus();
    markCat();
    clearTimeout(vod.catTimer);
    vod.catTimer = setTimeout(flushCat, 150);
}
function flushCat() {
    if (vod.catTimer === null) return;
    clearTimeout(vod.catTimer);
    vod.catTimer = null;
    vod.list = getCatList(vod.catId);
    vod.shown = GRID_STEP;
    renderGrid();
}

function applyFocus() {
    const old = document.querySelectorAll('.vfocus');
    for (let i = 0; i < old.length; i++) old[i].classList.remove('vfocus');
    el.video.classList.remove('winfocus');

    const t = document.querySelector('#vod-root [data-z="' + vod.zone + '"][data-i="' + vod.idx + '"]');
    if (t) {
        t.classList.add('vfocus');
        if (vod.view === 'detail' && (vod.zone === 'video' || vod.zone === 'act')) {
            const d = document.querySelector('.vod-detail');
            if (d) d.scrollTop = 0;
        } else {
            t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }
    if (vod.view === 'detail') {
        if (vod.zone === 'video') el.video.classList.add('winfocus');
        positionWin();
    }
}

/* ---------- pesquisa com teclado virtual ---------- */
function vodShowSearch(zone, idx) {
    vod.view = 'search';
    vod.shown = GRID_STEP;
    $v('vod-root').innerHTML =
        '<div class="vod-search">' +
          '<div class="vod-kbpanel">' +
            '<div class="vod-input" id="vod-input"></div>' +
            '<div class="vod-kb">' +
              KB_ROWS.map(function (row, r) {
                  return row.map(function (k, c) {
                      return '<div class="vod-key' + (r === KB_ROWS.length - 1 ? ' wide' : '') + '" data-z="kb" data-i="' + (r * KB_COLS + c) + '">' + k + '</div>';
                  }).join('');
              }).join('') +
            '</div>' +
          '</div>' +
          '<div class="vod-main">' +
            '<div class="vod-top">' +
              '<div class="vod-catlabel" id="vod-catlabel"></div>' +
              '<div class="vod-spacer"></div>' +
              '<div class="vod-total" id="vod-total"></div>' +
            '</div>' +
            '<div class="vod-grid" id="vod-grid"></div>' +
          '</div>' +
        '</div>';
    runSearch();
    vod.zone = zone || 'kb';
    vod.idx = (idx == null) ? 0 : idx;
    if (vod.zone === 'kb') { vod.kbR = Math.floor(vod.idx / KB_COLS); vod.kbC = vod.idx % KB_COLS; }
    applyFocus();
}

function runSearch() {
    const inp = $v('vod-input');
    if (inp) {
        inp.innerHTML = ICON_SEARCH.replace('<svg', '<svg style="width:32px;height:32px;margin-right:14px;stroke:#fff;fill:none;stroke-width:2;flex-shrink:0"') +
            (vod.query ? '<span>' + esc(vod.query) + '</span>' : '<span class="ph">Pesquisar</span>');
    }
    const q = norm(vod.query).trim();
    if (!q) {
        vod.list = [];
    } else {
        const words = q.split(/\s+/);
        vod.list = vod.cards.filter(function (c) {
            const t = norm(c.title);
            for (let i = 0; i < words.length; i++) if (t.indexOf(words[i]) === -1) return false;
            return true;
        }).slice(0, 400);
    }
    vod.shown = GRID_STEP;
    renderGrid();
}

function kbPress(label) {
    if (label === 'ESPAÇO') { if (vod.query && vod.query.slice(-1) !== ' ') vod.query += ' '; }
    else if (label === 'APAGAR') vod.query = vod.query.slice(0, -1);
    else if (label === 'LIMPAR') vod.query = '';
    else vod.query += label.toLowerCase();
    runSearch();
    applyFocus();
}

function searchKeys(e) {
    const k = e.key;
    if (k.length === 1 && /[a-z0-9 ]/i.test(k)) { e.preventDefault(); kbPress(k === ' ' ? 'ESPAÇO' : k.toUpperCase()); return; }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].indexOf(k) === -1) return;
    e.preventDefault();

    if (vod.zone === 'kb') {
        let r = vod.kbR, c = vod.kbC;
        const last = KB_ROWS.length - 1;
        if (k === 'ArrowLeft') { if (c > 0) c--; }
        else if (k === 'ArrowRight') {
            if (c < KB_ROWS[r].length - 1) c++;
            else if (vod.list.length) { vod.zone = 'grid'; vod.idx = 0; applyFocus(); return; }
        }
        else if (k === 'ArrowUp') { if (r > 0) { if (r === last) c = Math.min(KB_COLS - 1, c * 2); r--; } }
        else if (k === 'ArrowDown') { if (r < last) { r++; if (r === last) c = Math.min(2, Math.floor(c / 2)); } }
        else if (k === 'Enter') { kbPress(KB_ROWS[r][c]); return; }
        vod.kbR = r; vod.kbC = c; vod.idx = r * KB_COLS + c;
        applyFocus();
    } else {
        gridNav(k, function () { vod.zone = 'kb'; vod.idx = vod.kbR * KB_COLS + vod.kbC; applyFocus(); }, null);
    }
}

/* navegação comum da grade de capas (home e pesquisa) */
function gridNav(k, onLeftEdge, onTopEdge) {
    const n = vod.list.length;
    let i = vod.idx;
    if (k === 'ArrowLeft') {
        if (i % GRID_COLS === 0) { onLeftEdge(); return; }
        i--;
    } else if (k === 'ArrowRight') {
        if (i % GRID_COLS < GRID_COLS - 1 && i + 1 < n) i++;
    } else if (k === 'ArrowUp') {
        if (i < GRID_COLS) { if (onTopEdge) onTopEdge(); return; }
        i -= GRID_COLS;
    } else if (k === 'ArrowDown') {
        ensureShown(i + GRID_COLS);
        if (i + GRID_COLS < n) i += GRID_COLS;
        else if (Math.floor(i / GRID_COLS) < Math.floor((n - 1) / GRID_COLS)) i = n - 1;
    } else if (k === 'Enter') {
        const card = vod.list[i];
        if (card) vodOpenDetail(card, true);
        return;
    }
    vod.idx = i;
    ensureShown(i);
    applyFocus();
}

/* ---------- teclas da tela principal ---------- */
function homeKeys(e) {
    const k = e.key;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].indexOf(k) === -1) return;
    e.preventDefault();
    const nc = vod.cats.length;

    if (vod.zone === 'cats') {
        if (k === 'ArrowUp') setCat((vod.catIndex - 1 + nc) % nc);
        else if (k === 'ArrowDown') setCat((vod.catIndex + 1) % nc);
        else if (k === 'ArrowRight' || k === 'Enter') {
            flushCat();
            if (vod.list.length) { vod.zone = 'grid'; vod.idx = 0; applyFocus(); }
        }
    } else if (vod.zone === 'top') {
        if (k === 'ArrowLeft') {
            if (vod.idx === 0) { vod.zone = 'cats'; vod.idx = vod.catIndex; } else vod.idx = 0;
            applyFocus();
        } else if (k === 'ArrowRight') { vod.idx = 1; applyFocus(); }
        else if (k === 'ArrowDown') {
            flushCat();
            if (vod.list.length) { vod.zone = 'grid'; vod.idx = 0; applyFocus(); }
        } else if (k === 'Enter') {
            if (vod.idx === 0) {
                vod.stack.push(captureView());
                vod.query = '';
                vodShowSearch('kb', 0);
            } else {
                flushCat();
                vod.catId = '__hist';
                vod.list = getCatList('__hist');
                vod.shown = GRID_STEP;
                renderGrid();
                markCat();
                if (vod.list.length) { vod.zone = 'grid'; vod.idx = 0; } else { vod.zone = 'top'; vod.idx = 1; }
                applyFocus();
            }
        }
    } else {
        gridNav(k,
            function () { vod.zone = 'cats'; vod.idx = vod.catIndex; applyFocus(); },
            function () { vod.zone = 'top'; vod.idx = 0; applyFocus(); });
    }
}

/* ---------- navegação entre telas ---------- */
function captureView() {
    return { view: vod.view, catId: vod.catId, catIndex: vod.catIndex, zone: vod.zone, idx: vod.idx,
             query: vod.query, kbR: vod.kbR, kbC: vod.kbC, card: vod.card };
}
function restoreView(s) {
    vod.query = s.query || '';
    vod.kbR = s.kbR || 0; vod.kbC = s.kbC || 0;
    if (s.view === 'home') {
        vod.catId = s.catId; vod.catIndex = s.catIndex;
        vodShowHome(s.zone, s.idx);
    } else if (s.view === 'search') {
        vodShowSearch(s.zone, s.idx);
    } else if (s.view === 'detail') {
        vodOpenDetail(s.card, false);
    }
}

function vodBack() {
    if (vod.fullscreen) {
        if (vod.settingsOpen) closeSettings(); else exitFullscreen();
        return true;
    }
    if (vod.view === 'detail') {
        vodStop();
        setWinMode(false);
        const s = vod.stack.pop();
        if (s) restoreView(s); else { vod.catId = '__all'; vod.catIndex = 0; vodShowHome('cats', 0); }
        return true;
    }
    if (vod.view === 'search') {
        const s = vod.stack.pop();
        if (s) restoreView(s); else vodShowHome('cats', 0);
        return true;
    }
    if (vod.zone !== 'cats') {
        vod.zone = 'cats'; vod.idx = vod.catIndex; applyFocus();
        return true;
    }
    window.location.reload();
    return true;
}

function vodKeys(e) {
    if (!state.vodActive) return;
    document.body.classList.remove('use-pointer');
    if (vod.fullscreen) { playerKeys(e); return; }
    if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'BrowserBack') {
        e.preventDefault();
        vodBack();
        return;
    }
    if (vod.view === 'home') homeKeys(e);
    else if (vod.view === 'search') searchKeys(e);
    else if (vod.view === 'detail') detailKeys(e);
}

/* ---------- tela do filme / série ---------- */
function seasonsList() {
    const s = [];
    vod.card.eps.forEach(function (e) { if (s.indexOf(e.season) === -1) s.push(e.season); });
    return s;
}
function epsOfSeason() {
    return vod.card.eps.filter(function (e) { return e.season === vod.season; });
}
function currentEp() {
    return vod.card.eps.filter(function (e) { return e.url === vod.epUrl; })[0];
}

function computeRelated(card) {
    const grp = vod.cards.filter(function (c) { return c.group === card.group; });
    const i = grp.indexOf(card);
    const out = [];
    for (let k = 1; k < grp.length && out.length < 14; k++) out.push(grp[(i + k) % grp.length]);
    return out;
}

function vodOpenDetail(card, pushCurrent) {
    if (pushCurrent) {
        vod.stack.push(captureView());
        if (vod.stack.length > 25) vod.stack.shift();
    }
    if (vod.view === 'detail') { vodStop(); }
    vod.card = card;
    addHistory(card);
    if (card.kind === 'series') {
        const lastUrl = lsGet(LS_LASTEP, {})[card.key];
        const ep = card.eps.filter(function (e) { return e.url === lastUrl; })[0] || card.eps[0];
        vod.epUrl = ep.url;
        vod.season = ep.season;
    }
    vod.related = computeRelated(card);
    vod.view = 'detail';
    renderDetail();
    vod.zone = 'video';
    vod.idx = 0;
    applyFocus();
    startPreview();
    fetchMeta(card);
}

function favButtonHtml() {
    return ICON_HEART + (isFav(vod.card) ? 'Favoritado' : 'Favorito');
}

function renderDetail() {
    const c = vod.card;
    const isSeries = c.kind === 'series';
    let info = '<p><span>Categoria:</span>' + esc(c.group) + '</p>' +
               '<p><span>Tipo:</span>' + (isSeries ? 'Série' : 'Filme') + '</p>';
    if (isSeries) {
        info += '<p><span>Temporadas:</span>' + seasonsList().length + '</p>' +
                '<p><span>Episódios:</span>' + c.eps.length + '</p>' +
                '<p><span>Assistindo:</span><b id="vod-now"></b></p>';
    }
    info += '<p id="vod-nota" style="display:none"></p><p id="vod-data" style="display:none"></p>';

    $v('vod-root').innerHTML =
        '<div class="vod-detail-bg" style="background-image:url(\'' + esc(c.logo) + '\')"></div>' +
        '<div class="vod-detail" id="vod-detail">' +
          '<div class="vod-toprow">' +
            '<div class="vod-win" data-z="video" data-i="0"></div>' +
            '<div class="vod-info">' +
              '<h1>' + esc(c.title) + '</h1>' + info +
              '<div class="vod-actions">' +
                '<div class="vod-act" data-z="act" data-i="0">' + ICON_FS + 'Tela Cheia</div>' +
                '<div class="vod-act' + (isFav(c) ? ' isfav' : '') + '" id="vod-favbtn" data-z="act" data-i="1">' + favButtonHtml() + '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          (isSeries ?
            '<div class="vod-h">Temporadas</div><div class="vod-row" id="vod-seasons"></div>' +
            '<div class="vod-h">Episódios</div><div class="vod-row" id="vod-eps"></div>' : '') +
          '<div class="vod-h">Sinopse</div>' +
          '<div class="vod-syn" id="vod-syn">Carregando...</div>' +
          (vod.related.length ? '<div class="vod-h">Relacionados</div><div class="vod-rel" id="vod-rel">' +
            vod.related.map(function (r, i) { return cardHtml(r, i, 'rel'); }).join('') + '</div>' : '') +
        '</div>';

    if (isSeries) { renderSeasons(); renderEps(); updateNow(); }
    const d = $v('vod-detail');
    if (d) d.addEventListener('scroll', positionWin);
}

function renderSeasons() {
    $v('vod-seasons').innerHTML = seasonsList().map(function (s, i) {
        return '<div class="vod-chip' + (s === vod.season ? ' sel' : '') + '" data-z="seasons" data-i="' + i + '">Temporada ' + s + '</div>';
    }).join('');
}
function renderEps() {
    $v('vod-eps').innerHTML = epsOfSeason().map(function (e, i) {
        return '<div class="vod-chip' + (e.url === vod.epUrl ? ' sel' : '') + '" data-z="eps" data-i="' + i + '">Ep. ' + e.ep + '</div>';
    }).join('');
}
function updateNow() {
    const n = $v('vod-now'), ep = currentEp();
    if (n && ep) n.textContent = 'T' + ep.season + ' E' + ep.ep;
}

function zoneCount(z) {
    if (z === 'video') return 1;
    if (z === 'act') return 2;
    if (z === 'seasons') return seasonsList().length;
    if (z === 'eps') return epsOfSeason().length;
    if (z === 'rel') return vod.related.length;
    return 0;
}
function detailZones() {
    const z = ['video', 'act'];
    if (vod.card.kind === 'series') z.push('seasons', 'eps');
    if (vod.related.length) z.push('rel');
    return z;
}

function detailKeys(e) {
    const k = e.key;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].indexOf(k) === -1) return;
    e.preventDefault();
    const zones = detailZones();
    const zi = zones.indexOf(vod.zone);

    if (k === 'ArrowUp' || k === 'ArrowDown') {
        const nz = zones[zi + (k === 'ArrowDown' ? 1 : -1)];
        if (!nz) return;
        let ni = Math.min(vod.idx, Math.max(0, zoneCount(nz) - 1));
        if (nz === 'seasons') ni = Math.max(0, seasonsList().indexOf(vod.season));
        if (nz === 'eps') {
            const li = epsOfSeason().map(function (x) { return x.url; }).indexOf(vod.epUrl);
            ni = li === -1 ? 0 : li;
        }
        vod.zone = nz; vod.idx = ni;
        applyFocus();
    } else if (k === 'ArrowLeft') {
        if (vod.idx > 0) { vod.idx--; applyFocus(); }
    } else if (k === 'ArrowRight') {
        if (vod.idx < zoneCount(vod.zone) - 1) { vod.idx++; applyFocus(); }
    } else if (k === 'Enter') {
        detailEnter();
    }
}

function detailEnter() {
    if (vod.zone === 'video') { enterFullscreen(); }
    else if (vod.zone === 'act') {
        if (vod.idx === 0) enterFullscreen();
        else {
            toggleFav(vod.card);
            const b = $v('vod-favbtn');
            b.innerHTML = favButtonHtml();
            b.classList.toggle('isfav', isFav(vod.card));
        }
    } else if (vod.zone === 'seasons') {
        vod.season = seasonsList()[vod.idx];
        renderSeasons(); renderEps();
        applyFocus();
    } else if (vod.zone === 'eps') {
        const ep = epsOfSeason()[vod.idx];
        if (ep) { playEpisode(ep); enterFullscreen(); }
    } else if (vod.zone === 'rel') {
        vodOpenDetail(vod.related[vod.idx], true);
    }
}

function playEpisode(ep) {
    vod.epUrl = ep.url;
    vod.season = ep.season;
    const l = lsGet(LS_LASTEP, {}); l[vod.card.key] = ep.url; lsSet(LS_LASTEP, l);
    vodStopKeepWindow();
    vodPlayUrl(ep.url);
    if ($v('vod-eps')) { renderSeasons(); renderEps(); updateNow(); }
    if (vod.fullscreen) fillPlayerMeta();
}

/* ---------- sinopse / nota (TMDB, opcional) ---------- */
function fetchMeta(card) {
    const syn = $v('vod-syn');
    if (!TMDB_API_KEY) { syn.textContent = 'Sinopse não disponível para este título.'; return; }
    if (vod.metaCache[card.key]) { fillMeta(card, vod.metaCache[card.key]); return; }
    const q = card.title.replace(/\[[^\]]*\]|\([^)]*\)/g, '').trim();
    const ym = card.title.match(/\((\d{4})\)/);
    const type = card.kind === 'series' ? 'tv' : 'movie';
    let u = 'https://api.themoviedb.org/3/search/' + type + '?api_key=' + TMDB_API_KEY + '&language=pt-BR&query=' + encodeURIComponent(q);
    if (ym) u += (type === 'movie' ? '&year=' : '&first_air_date_year=') + ym[1];
    fetch(u).then(function (r) { return r.json(); }).then(function (d) {
        const r0 = d.results && d.results[0];
        const m = r0 ? { overview: r0.overview, nota: r0.vote_average, data: r0.release_date || r0.first_air_date } : {};
        vod.metaCache[card.key] = m;
        if (vod.card === card) fillMeta(card, m);
    }).catch(function () {
        if (vod.card === card && $v('vod-syn')) $v('vod-syn').textContent = 'Sinopse não disponível para este título.';
    });
}
function fillMeta(card, m) {
    if (!$v('vod-syn')) return;
    $v('vod-syn').textContent = m.overview || 'Sinopse não disponível para este título.';
    if (m.nota) { const n = $v('vod-nota'); n.innerHTML = '<span>Nota:</span>' + Number(m.nota).toFixed(1); n.style.display = ''; }
    if (m.data) { const d = $v('vod-data'); d.innerHTML = '<span>Lançamento:</span>' + esc(m.data); d.style.display = ''; }
}

/* ---------- vídeo: janela, reprodução e progresso ---------- */
function vodSpin(on) { const s = $v('vod-spin'); if (s) s.classList.toggle('hidden', !on); }

function setWinMode(on) {
    el.video.classList.toggle('vod-window', on);
    if (!on) { el.video.style.cssText = ''; $v('vod-spin').style.cssText = ''; el.video.classList.remove('winfocus'); }
    positionWin();
}

function positionWin() {
    const v = el.video, sp = $v('vod-spin');
    if (vod.fullscreen) { sp.style.cssText = 'left:0;top:0;width:100%;height:100%;'; return; }
    if (!v.classList.contains('vod-window')) return;
    const w = document.querySelector('.vod-win');
    if (!w) return;
    const r = w.getBoundingClientRect();
    const vis = r.bottom > 0 && r.top < window.innerHeight;
    const css = 'left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;' + (vis ? '' : 'visibility:hidden;');
    v.style.cssText = css;
    sp.style.cssText = css;
}

function startPreview() {
    setWinMode(true);
    vodPlayUrl(vod.card.kind === 'series' ? vod.epUrl : vod.card.url);
    setTimeout(positionWin, 60);
}

function vodPlayUrl(url) {
    vod.playUrl = url;
    const p = lsGet(LS_PROGRESS, {})[url];
    vodLoad(url, p ? p.t : 0);
}

function vodLoad(url, startAt) {
    vod.resumeAt = startAt || 0;
    if (state.hls) { state.hls.destroy(); state.hls = null; }
    const v = el.video;
    vodSpin(true);
    if (/\.m3u8(\?|$)/i.test(url) && window.Hls && Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true });
        state.hls = hls;
        hls.loadSource(url);
        hls.attachMedia(v);
        hls.on(Hls.Events.MANIFEST_PARSED, function () { v.play().catch(function () {}); });
        hls.on(Hls.Events.ERROR, function (ev, d) {
            if (d.fatal) {
                if (d.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
                else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
            }
        });
    } else {
        v.src = url;
        v.load();
        const pr = v.play();
        if (pr && pr.catch) pr.catch(function () {});
    }
}

function onVodMeta() {
    const v = el.video;
    if (vod.resumeAt > 5 && isFinite(v.duration) && vod.resumeAt < v.duration - 20) v.currentTime = vod.resumeAt;
    vod.resumeAt = 0;
}

function saveProgress(force) {
    const v = el.video;
    if (!vod.playUrl || !isFinite(v.duration) || v.duration < 1 || v.currentTime < 1) return;
    const now = Date.now();
    if (!force && now - vod.lastSave < 5000) return;
    vod.lastSave = now;
    const p = lsGet(LS_PROGRESS, {});
    if (v.currentTime > v.duration - 30) delete p[vod.playUrl];
    else p[vod.playUrl] = { t: Math.floor(v.currentTime), d: Math.floor(v.duration) };
    lsSet(LS_PROGRESS, p);
}

function vodStopKeepWindow() {
    saveProgress(true);
    el.video.pause();
}
function vodStop() {
    saveProgress(true);
    const v = el.video;
    v.pause();
    if (state.hls) { state.hls.destroy(); state.hls = null; }
    v.removeAttribute('src');
    v.load();
    vod.playUrl = null;
    vodSpin(false);
}

function onVodTime() {
    if (!vod.playUrl) return;
    saveProgress(false);
    if (vod.fullscreen) updateBar();
}

function onVodEnded() {
    saveProgress(true);
    if (vod.card && vod.card.kind === 'series') {
        const i = vod.card.eps.map(function (e) { return e.url; }).indexOf(vod.epUrl);
        if (i >= 0 && i < vod.card.eps.length - 1) { playEpisode(vod.card.eps[i + 1]); return; }
    }
    if (vod.fullscreen) exitFullscreen();
}

/* ---------- player em tela cheia ---------- */
function enterFullscreen() {
    vod.fullscreen = true;
    document.body.classList.add('vod-fs');
    $v('vod-root').classList.add('fs');
    el.video.classList.remove('vod-window', 'winfocus');
    el.video.style.cssText = '';
    el.video.style.objectFit = vod.fitCover ? 'cover' : 'contain';
    el.video.playbackRate = SPEEDS[vod.speedIdx];
    positionWin();
    $v('vod-player-ui').classList.add('on');
    fillPlayerMeta();
    updateBar();
    showPlayerUI();
    const pr = el.video.play();
    if (pr && pr.catch) pr.catch(function () {});
}

function exitFullscreen() {
    saveProgress(true);
    vod.fullscreen = false;
    document.body.classList.remove('vod-fs');
    closeSettings();
    clearTimeout(vod.uiTimer);
    $v('vod-root').classList.remove('fs');
    $v('vod-player-ui').classList.remove('on');
    el.video.style.objectFit = '';
    el.video.style.cssText = '';
    $v('vod-spin').style.cssText = '';
    if (vod.view === 'detail') { setWinMode(true); applyFocus(); }
}

function fillPlayerMeta() {
    const c = vod.card;
    let title = c.title;
    if (c.kind === 'series') {
        const ep = currentEp();
        if (ep) title += '  -  T' + ep.season + ' E' + ep.ep;
    }
    $v('vod-pui-title').textContent = title;
    const th = $v('vod-pui-thumb');
    th.style.visibility = c.logo ? 'visible' : 'hidden';
    if (c.logo) th.src = c.logo;
}

function updateBar() {
    const v = el.video;
    $v('vod-pui-cur').textContent = fmtTime(v.currentTime);
    $v('vod-pui-dur').textContent = fmtTime(v.duration);
    const pct = (isFinite(v.duration) && v.duration > 0) ? (v.currentTime / v.duration) * 100 : 0;
    $v('vod-pui-fill').style.width = Math.min(100, pct) + '%';
}

function showPlayerUI() {
    const ui = $v('vod-player-ui');
    ui.classList.remove('idle');
    clearTimeout(vod.uiTimer);
    vod.uiTimer = setTimeout(function () {
        if (!el.video.paused && !vod.settingsOpen) ui.classList.add('idle');
    }, 4000);
}

function flashIcon(paused) {
    const c = $v('vod-pui-center');
    if (!vod.fullscreen) return;
    c.innerHTML = paused ? ICON_PAUSE : ICON_PLAY;
    c.classList.add('show');
    clearTimeout(vod.iconTimer);
    if (!paused) vod.iconTimer = setTimeout(function () { c.classList.remove('show'); }, 900);
}

function vodSeek(dir) {
    const v = el.video;
    if (!isFinite(v.duration)) return;
    vod.seekRepeat++;
    const step = Math.min(120, 10 * (1 + Math.floor(vod.seekRepeat / 4)));
    v.currentTime = Math.max(0, Math.min(v.duration - 1, v.currentTime + dir * step));
    updateBar();
    showPlayerUI();
}

function togglePlay() {
    const v = el.video;
    if (v.paused) { const pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); } else v.pause();
    showPlayerUI();
}

function playerKeys(e) {
    const k = e.key;
    if (vod.settingsOpen) { settingsKeys(e); return; }
    switch (k) {
        case 'ArrowLeft': case 'MediaRewind':
            e.preventDefault(); vodSeek(-1); break;
        case 'ArrowRight': case 'MediaFastForward':
            e.preventDefault(); vodSeek(1); break;
        case 'Enter': case ' ': case 'MediaPlayPause':
            e.preventDefault(); togglePlay(); break;
        case 'ArrowDown':
            e.preventDefault(); openSettings(); break;
        case 'ArrowUp':
            e.preventDefault(); showPlayerUI(); break;
        case 'Escape': case 'Backspace': case 'BrowserBack':
            e.preventDefault(); exitFullscreen(); break;
        default:
            showPlayerUI();
    }
}

/* Configurações: velocidade e ajuste da imagem */
function renderSettings() {
    $v('vod-settings').innerHTML =
        '<div class="vod-set-row' + (vod.settingsRow === 0 ? ' on' : '') + '" data-a="speed"><span>Velocidade</span><b>' + SPEEDS[vod.speedIdx] + 'x</b></div>' +
        '<div class="vod-set-row' + (vod.settingsRow === 1 ? ' on' : '') + '" data-a="fit"><span>Imagem</span><b>' + (vod.fitCover ? 'Preencher' : 'Ajustar') + '</b></div>';
}
function openSettings() {
    vod.settingsOpen = true;
    vod.settingsRow = 0;
    $v('vod-settings').classList.remove('hidden');
    renderSettings();
    showPlayerUI();
}
function closeSettings() {
    vod.settingsOpen = false;
    const s = $v('vod-settings'); if (s) s.classList.add('hidden');
    if (vod.fullscreen) showPlayerUI();
}
function settingsKeys(e) {
    const k = e.key;
    if (k === 'Escape' || k === 'Backspace' || k === 'BrowserBack' || k === 'Enter') { e.preventDefault(); closeSettings(); return; }
    if (k === 'ArrowUp') { e.preventDefault(); vod.settingsRow = 0; }
    else if (k === 'ArrowDown') { e.preventDefault(); vod.settingsRow = 1; }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') {
        e.preventDefault();
        const d = k === 'ArrowRight' ? 1 : -1;
        if (vod.settingsRow === 0) {
            vod.speedIdx = Math.max(0, Math.min(SPEEDS.length - 1, vod.speedIdx + d));
            el.video.playbackRate = SPEEDS[vod.speedIdx];
        } else {
            vod.fitCover = !vod.fitCover;
            el.video.style.objectFit = vod.fitCover ? 'cover' : 'contain';
        }
    }
    renderSettings();
    showPlayerUI();
}



/* ====================================================================
   TV AO VIVO: FAVORITOS (segure o OK sobre um canal para favoritar)
   ==================================================================== */
function getTvFavs() {
    try { return JSON.parse(localStorage.getItem(TV_FAV_KEY)) || []; } catch (e) { return []; }
}
function isTvFav(ch) { return getTvFavs().indexOf(ch.url) !== -1; }

function refreshTvFavList() {
    const list = [];
    getTvFavs().forEach(u => {
        const ch = state.channels.find(c => c.url === u);
        if (ch) list.push(ch);
    });
    state.channelsByFolder[FAV_FOLDER] = list;
}

function buildTvFavFolder() {
    if (state.selectedCategory !== 'tv') return;
    FAV_FOLDER = state.folders.indexOf('Favoritos') !== -1 ? 'Meus Favoritos' : 'Favoritos';
    state.folders.unshift(FAV_FOLDER);
    refreshTvFavList();
}

function toggleTvFav(ch) {
    if (!ch) return;
    const f = getTvFavs();
    const i = f.indexOf(ch.url);
    const added = i === -1;
    if (added) f.unshift(ch.url); else f.splice(i, 1);
    try { localStorage.setItem(TV_FAV_KEY, JSON.stringify(f)); } catch (e) {}
    refreshTvFavList();

    const folderName = state.folders[state.selectedFolderIndex];
    const list = state.channelsByFolder[folderName] || [];
    if (list.length === 0) {
        state.activeColumn = 'folders';
        state.focusedFolderIndex = state.selectedFolderIndex;
    } else if (state.focusedChannelIndex >= list.length) {
        state.focusedChannelIndex = list.length - 1;
    }
    renderChannels(folderName);
    updateFocusDOM();
    showToast(ch.name, added ? 'Adicionado aos favoritos' : 'Removido dos favoritos');
}

function startEnterPress(ch) {
    if (!ch || state.enterPressed) return;
    state.enterPressed = true;
    state.longDone = false;
    state.enterChannel = ch;
    state.enterTimer = setTimeout(() => {
        state.longDone = true;
        toggleTvFav(ch);
    }, LONG_PRESS_MS);
}

function setupEnterKeyUp() {
    document.addEventListener('keyup', (e) => {
        if (e.key !== 'Enter' || !state.enterPressed) return;
        clearTimeout(state.enterTimer);
        state.enterPressed = false;
        if (state.longDone) { state.longDone = false; return; }
        const ch = state.enterChannel;
        if (!ch) return;
        const isAlreadyPlaying = state.playingChannel && state.playingChannel.url === ch.url;
        if (isAlreadyPlaying) toggleMenu(false);
        else playChannel(ch);
    });
}



/* ====================================================================
   MOUSE E TOQUE (computador e celular) para Filmes e Séries
   ==================================================================== */
const FAKE_ENTER = { key: 'Enter', preventDefault: function () {} };

function setupVodPointer() {
    const setPointer = function () { document.body.classList.add('use-pointer'); };
    ['mousemove', 'mousedown', 'touchstart'].forEach(function (ev) {
        document.addEventListener(ev, setPointer, { passive: true });
    });

    // cliques nas categorias, capas, botões, teclado virtual, episódios...
    $v('vod-root').addEventListener('click', vodClick);

    // clique no vídeo: na janela abre a tela cheia; em tela cheia pausa/continua
    el.video.addEventListener('click', function () {
        if (!state.vodActive) return;
        if (vod.fullscreen) {
            if ($v('vod-player-ui').classList.contains('idle')) showPlayerUI(); else togglePlay();
        } else if (vod.view === 'detail') {
            enterFullscreen();
        }
    });

    // botão Voltar para mouse/toque
    $v('vod-backbtn').addEventListener('click', function () {
        if (vod.fullscreen) { vodBack(); return; }
        if (vod.view === 'home') { window.location.reload(); return; }
        vodBack();
    });

    // controles do player em tela cheia
    $v('vod-player-ui').addEventListener('click', vodPlayerClick);
}

function vodClick(e) {
    if (!state.vodActive || vod.fullscreen) return;
    let t = e.target;
    const root = $v('vod-root');
    while (t && t !== root && !(t.getAttribute && t.getAttribute('data-z'))) t = t.parentNode;
    if (!t || t === root) return;
    const z = t.getAttribute('data-z');
    const i = parseInt(t.getAttribute('data-i'), 10);

    if (vod.view === 'home') {
        vod.zone = z; vod.idx = i;
        if (z === 'cats') { setCat(i); flushCat(); }
        else { applyFocus(); homeKeys(FAKE_ENTER); }
    } else if (vod.view === 'search') {
        vod.zone = z; vod.idx = i;
        if (z === 'kb') { vod.kbR = Math.floor(i / KB_COLS); vod.kbC = i % KB_COLS; }
        applyFocus();
        searchKeys(FAKE_ENTER);
    } else if (vod.view === 'detail') {
        vod.zone = z; vod.idx = i;
        applyFocus();
        detailEnter();
    }
}

function vodPlayerClick(e) {
    if (!vod.fullscreen) return;
    let t = e.target;
    const ui = $v('vod-player-ui');
    while (t && t !== ui && !(t.getAttribute && t.getAttribute('data-a'))) t = t.parentNode;
    if (!t || t === ui) return;
    const a = t.getAttribute('data-a');
    showPlayerUI();

    if (a === 'rew') { vod.seekRepeat = 0; vodSeek(-1); }
    else if (a === 'ff') { vod.seekRepeat = 0; vodSeek(1); }
    else if (a === 'play') { togglePlay(); }
    else if (a === 'set') { if (vod.settingsOpen) closeSettings(); else openSettings(); }
    else if (a === 'close') { exitFullscreen(); }
    else if (a === 'speed') {
        vod.speedIdx = (vod.speedIdx + 1) % SPEEDS.length;
        el.video.playbackRate = SPEEDS[vod.speedIdx];
        renderSettings();
    } else if (a === 'fit') {
        vod.fitCover = !vod.fitCover;
        el.video.style.objectFit = vod.fitCover ? 'cover' : 'contain';
        renderSettings();
    } else if (a === 'track') {
        const r = t.getBoundingClientRect();
        const v = el.video;
        if (isFinite(v.duration) && r.width > 0) {
            v.currentTime = Math.max(0, Math.min(v.duration - 1, ((e.clientX - r.left) / r.width) * v.duration));
            updateBar();
        }
    }
}
