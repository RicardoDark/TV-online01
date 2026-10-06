/* ====================================================================
   TELA FIXA 1280x720
   O app é desenhado sempre em 1280x720 (para mudar o tamanho de tudo, altere só os números abaixo e no style.css) e redimensionado inteiro para caber
   no aparelho (celular, tablet, TV Box). Sobra faixa preta se a proporção for diferente.
   ==================================================================== */
const DESIGN_W = 1280, DESIGN_H = 720;
const stage = { s: 1, x: 0, y: 0 };
function fitStage() {
    const w = window.innerWidth || document.documentElement.clientWidth || DESIGN_W;
    const h = window.innerHeight || document.documentElement.clientHeight || DESIGN_H;
    // escala pelo lado que "encosta" primeiro; o outro lado é esticado para preencher a tela
    let s = Math.min(w / DESIGN_W, h / DESIGN_H);
    // limite do esticamento (telas muito estranhas ainda ganham faixa preta)
    const sw = Math.min(w / s, 1707);
    const sh = Math.min(h / s, 800);
    s = Math.min(w / sw, h / sh);
    stage.s = s;
    stage.x = Math.max(0, (w - sw * s) / 2);
    stage.y = Math.max(0, (h - sh * s) / 2);
    const b = document.body;
    b.style.width = sw + 'px';
    b.style.height = sh + 'px';
    b.style.transformOrigin = '0 0';
    b.style.transform = 'translate(' + stage.x + 'px,' + stage.y + 'px) scale(' + s + ')';
}
fitStage();
window.addEventListener('resize', fitStage);
window.addEventListener('orientationchange', function () { setTimeout(fitStage, 200); });

// Constants
// Lista embutida (botão "TV grátis")
const M3U_URL = 'https://raw.githubusercontent.com/RicardoDark/iptv01/refs/heads/main/minhalista.m3u';

// Dados que já aparecem preenchidos na tela de login (dá para editar na tela)
const DEFAULT_USER = '10203040';
const DEFAULT_PASS = '40506070';
const DEFAULT_SERVER = 'https://cinepulse.rtvplay.workers.dev/';

// Servidores que aparecem na tela de login. A pessoa só vê o NOME; o link fica escondido.
// Para adicionar o Servidor 4 (ou mais), é só colocar o link aqui.
const SERVERS = [
    { name: 'CinePulse', url: 'https://app01.rtvplay.workers.dev/' },
    { name: 'Power', url: 'https://app02.rtvplay.workers.dev/' },
    { name: 'P2 player stremio', url: 'https://app03.rtvplay.workers.dev/' }
    // , { name: 'Servidor 4', url: 'COLOQUE_O_LINK_AQUI' }
].filter(function (s) { return s.url && s.url.indexOf('COLOQUE') === -1; });

// Bloqueio adulto: qualquer pasta/categoria/título com "XXX" fica bloqueado até digitar a senha
const ADULT_PIN = '1010';
const ADULT_FOLDER = 'XXX Adulto';
const LOCK_ICON = ' \uD83D\uDD12';
let adultUnlocked = false;   // volta a bloquear sempre que o app é aberto de novo
const LOGIN_KEY = 'iptv_login_data';     // últimos dados digitados (preenche a tela de login)
const SESSION_KEY = 'iptv_session';       // login ativo: enquanto existir, o app abre direto na tela inicial
const STORAGE_LAST_CHANNEL_KEY = 'iptv_last_played_channel';
const TV_FAV_KEY = 'iptv_tv_favs';
const LONG_PRESS_MS = 500;
let FAV_FOLDER = 'Favoritos';
const ALL_FOLDER = 'Canais de A a Z';
const SEARCH_FOLDER = '\uD83D\uDD0E Pesquisar';

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
    epgMode: false,
    hls: null,
    isAndroid: false,
    menuTimeout: null,
    selectedCategory: null, // 'tv', 'movies' ou 'series'
    splashFocusIndex: 0, // 0: TV, 1: Filmes, 2: Séries
    splashZone: 'cards', // 'cards' ou 'top' (ícones do canto)
    splashTopIndex: 1, // 0: TV Favoritos, 1: Favoritos (coração), 2: Histórico
    startFavorites: false,
    vodEntryCat: null,
    m3uUrl: M3U_URL,
    m3uCache: {},
    parsed: null,
    api: null,
    fatal: false,
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
    setupLogin();
    setupBackTrap();

    // Tela de "Carregando..." demorando: Voltar/Esc cancela e volta ao início
    document.addEventListener('keydown', function (e) {
        if (pin.open) return;
        if (e.key !== 'Escape' && e.key !== 'Backspace' && e.key !== 'GoBack') return;
        if (!state.vodActive && !state.isMenuVisible && el.status && !el.status.classList.contains('hidden')) {
            e.preventDefault();
            handleBackAction();
        }
    });
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
        document.getElementById('btn-vodhist'),
        document.getElementById('btn-logout')
    ];
}

function splashTopAction(i) {
    if (i === 0) selectCategoryAndStart('tv', { tvFavorites: true });
    else if (i === 1) selectCategoryAndStart('mixed', { vodCat: '__fav' });
    else if (i === 2) selectCategoryAndStart('mixed', { vodCat: '__hist' });
    else askAdultPin(logoutApp, null, { force: true, title: 'Sair da conta', sub: 'Digite a senha para sair' });
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
    if (!el.splash.classList.contains('splash-visible')) return;

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
            state.splashTopIndex = Math.min(3, state.splashTopIndex + 1);
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
    const cat = state.selectedCategory;
    const wantsVod = (cat === 'movies' || cat === 'series' || cat === 'mixed');

    // Filmes e séries: API do servidor com cache (abre na hora se já foi carregado antes).
    if (wantsVod && state.api) {
        const kinds = cat === 'mixed' ? ['movies', 'series'] : [cat];
        showStatus(cat === 'series' ? 'Carregando séries...' :
                   cat === 'movies' ? 'Carregando filmes...' : 'Carregando filmes e séries...');
        Promise.all(kinds.map(getApiKind)).then(function (sets) {
            const total = sets.reduce(function (n, x) { return n + x.cards.length; }, 0);
            return { ok: total > 0, sets: sets };
        }, function (err) {
            console.warn('API de filmes/séries falhou, usando a lista M3U:', err);
            return { ok: false };
        }).then(function (res) {
            if (res.ok) {
                hideStatus();
                startVod(res.sets, state.vodEntryCat);
            } else {
                startFromM3U();
            }
        });
        return;
    }
    startFromM3U();
}

function emptyListMessage(label, all) {
    if (!all.total) return 'A lista veio vazia. Confira o usuário, a senha e o link.';
    return 'Nenhum conteúdo de ' + label + ' encontrado.\nA lista tem ' + all.total + ' itens (TV: ' + all.tv.length +
        ', Filmes: ' + all.movies.length + ', Séries: ' + all.series.length + ').';
}

function startFromM3U() {
    showStatus('Carregando lista... (só demora na primeira vez)');
    loadTvSource()
        .then(all => {
            const cat = state.selectedCategory;

            if (cat === 'mixed') {
                hideStatus();
                if (!all.movies.length && !all.series.length) {
                    fatalStatus(emptyListMessage('filmes e séries', all));
                    return;
                }
                startVodMixed();
                return;
            }

            parseM3U(all);
            hideStatus();

            if (state.folders.length === 0) {
                const label = cat === 'movies' ? 'filmes' : cat === 'series' ? 'séries' : 'TV';
                fatalStatus(emptyListMessage(label, all));
                return;
            }

            if (cat === 'movies' || cat === 'series') {
                startVod();
                return;
            }

            buildTvFavFolder();
            renderFolders();
            const favIdx = Math.max(0, state.folders.indexOf(FAV_FOLDER));
            selectFolder(favIdx, false);
            if (!state.startFavorites) loadLastPlayedChannel();

            state.activeColumn = 'folders';
            state.focusedFolderIndex = favIdx;
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
            fatalStatus('Erro ao carregar a lista IPTV. Verifique a conexão, o usuário, a senha e o link.');
        });
}


/* ====================================================================
   CACHE LOCAL (IndexedDB)
   Guarda no aparelho as listas já prontas (TV, filmes, séries).
   - Se existe cache: abre NA HORA e atualiza em segundo plano.
   - Se não existe: baixa uma vez e guarda para as próximas.
   ==================================================================== */
const CACHE_DB = 'iptv_cache_v1';
const CACHE_STORE = 'kv';
const CACHE_FRESH_MS = 30 * 60 * 1000;          // até 30 min: não precisa atualizar
const CACHE_MAX_MS = 14 * 24 * 60 * 60 * 1000;  // mais de 14 dias: ignora e baixa de novo
const memCache = {};                            // reserva caso o IndexedDB não funcione
const inflight = {};                            // evita baixar a mesma coisa duas vezes
let cacheDbPromise = null;

function cacheDb() {
    if (cacheDbPromise) return cacheDbPromise;
    cacheDbPromise = new Promise(function (resolve) {
        try {
            if (!window.indexedDB) { resolve(null); return; }
            const rq = indexedDB.open(CACHE_DB, 1);
            rq.onupgradeneeded = function () { rq.result.createObjectStore(CACHE_STORE); };
            rq.onsuccess = function () { resolve(rq.result); };
            rq.onerror = function () { resolve(null); };
            rq.onblocked = function () { resolve(null); };
        } catch (e) { resolve(null); }
    });
    return cacheDbPromise;
}

function cacheGet(key) {
    if (memCache[key]) return Promise.resolve(memCache[key]);
    return cacheDb().then(function (db) {
        if (!db) return null;
        return new Promise(function (resolve) {
            try {
                const rq = db.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).get(key);
                rq.onsuccess = function () {
                    const v = rq.result;
                    if (v && v.t && (Date.now() - v.t) < CACHE_MAX_MS) { memCache[key] = v; resolve(v); }
                    else resolve(null);
                };
                rq.onerror = function () { resolve(null); };
            } catch (e) { resolve(null); }
        });
    });
}

function cacheSet(key, data) {
    const entry = { t: Date.now(), data: data };
    memCache[key] = entry;
    return cacheDb().then(function (db) {
        if (!db) return;
        return new Promise(function (resolve) {
            try {
                const tx = db.transaction(CACHE_STORE, 'readwrite');
                tx.objectStore(CACHE_STORE).put(entry, key);
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { resolve(); };
                tx.onabort = function () { resolve(); };
            } catch (e) { resolve(); }
        });
    });
}

function cacheIsStale(entry) { return !entry || (Date.now() - entry.t) > CACHE_FRESH_MS; }

// roda a mesma tarefa só uma vez por vez (se já está baixando, reaproveita)
function once(key, fn) {
    if (inflight[key]) return inflight[key];
    const p = fn().then(function (r) { delete inflight[key]; return r; },
                        function (e) { delete inflight[key]; throw e; });
    inflight[key] = p;
    return p;
}

function acctId() { return state.api ? (state.api.base + '|' + state.api.user) : 'free'; }
function apiCacheKey(kind) { return 'api:' + acctId() + ':' + kind; }
function m3uCacheKey(url) { return 'm3u:' + url; }

// ---- Filmes / Séries (API do servidor) ----
function fetchApiKind(kind) {
    return once('fetch:' + apiCacheKey(kind), function () {
        return (kind === 'movies' ? loadMoviesApi() : loadSeriesApi()).then(function (cards) {
            const set = { kind: kind, cards: cards };
            if (cards.length) cacheSet(apiCacheKey(kind), set);
            return set;
        });
    });
}

function getApiKind(kind) {
    return cacheGet(apiCacheKey(kind)).then(function (entry) {
        if (entry && entry.data && entry.data.cards && entry.data.cards.length) {
            if (cacheIsStale(entry)) fetchApiKind(kind).catch(function () {});   // atualiza em segundo plano
            return entry.data;
        }
        return fetchApiKind(kind);
    });
}

// ---- TV ao vivo (API do servidor: traz SÓ canais ao vivo, sem filmes/séries) ----
function liveCacheKey() { return 'api:' + acctId() + ':live'; }

function loadLiveApi() {
    const a = state.api;
    return Promise.all([
        apiJson('get_live_categories', '', 60000).catch(function () { return []; }),
        apiJson('get_live_streams', '', 120000)
    ]).then(function (res) {
        const cats = Array.isArray(res[0]) ? res[0] : [];
        const streams = Array.isArray(res[1]) ? res[1] : [];
        const catName = Object.create(null), catOrder = Object.create(null);
        cats.forEach(function (c, i) { catName[c.category_id] = String(c.category_name || '').trim(); catOrder[c.category_id] = i; });
        const out = [];
        streams.forEach(function (st, i) {
            if (!st || st.stream_id === undefined || st.stream_id === null) return;
            const folder = catName[st.category_id] || 'Outros';
            out.push({
                folder: folder,
                name: String(st.name || 'Sem Nome').trim() || 'Sem Nome',
                logo: st.stream_icon || '',
                url: a.base + '/live/' + enc(a.user) + '/' + enc(a.pass) + '/' + st.stream_id + '.m3u8',
                id: 'live_' + st.stream_id,
                _o: (catOrder[st.category_id] === undefined ? 99999 : catOrder[st.category_id]) * 100000 + i
            });
        });
        out.sort(function (x, y) { return x._o - y._o; });   // mantém a ordem das pastas do servidor
        return out;
    });
}

function getLiveList() {
    return cacheGet(liveCacheKey()).then(function (entry) {
        if (entry && entry.data && entry.data.length) {
            if (cacheIsStale(entry)) fetchLiveList().catch(function () {});
            return entry.data;
        }
        return fetchLiveList();
    });
}
function fetchLiveList() {
    return once('fetch:' + liveCacheKey(), function () {
        return loadLiveApi().then(function (list) {
            if (list.length) cacheSet(liveCacheKey(), list);
            return list;
        });
    });
}

// Fonte da TV: API (só ao vivo). Se a API falhar, usa a lista M3U como antes.
function loadTvSource() {
    if (state.selectedCategory === 'tv' && state.api) {
        return getLiveList().then(function (list) {
            if (list && list.length) return { tv: list, movies: [], series: [], total: list.length };
            return loadAllParsed();
        }, function (err) {
            console.warn('API de TV falhou, usando a lista M3U:', err);
            return loadAllParsed();
        });
    }
    return loadAllParsed();
}

// ---- TV / lista M3U (já processada) ----
function downloadParseM3U(url, applyNow) {
    return once('m3u:' + url, function () {
        return loadM3U(url).then(function (text) {
            const all = parseM3UAll(text);
            delete state.m3uCache[url];                 // libera a memória do texto gigante
            if (all.total > 0) cacheSet(m3uCacheKey(url), all);
            return all;
        });
    }).then(function (all) {
        if (applyNow) state.parsed = { url: url, all: all };
        return all;
    });
}

function loadAllParsed() {
    const url = state.m3uUrl;
    if (state.parsed && state.parsed.url === url) return Promise.resolve(state.parsed.all);
    return cacheGet(m3uCacheKey(url)).then(function (entry) {
        if (entry && entry.data && entry.data.total > 0) {
            state.parsed = { url: url, all: entry.data };
            if (cacheIsStale(entry)) downloadParseM3U(url, false).catch(function () {});  // atualiza em segundo plano
            return entry.data;
        }
        return downloadParseM3U(url, true);
    });
}

// Pré-carrega tudo em segundo plano enquanto você está na tela inicial
function prefetchAll() {
    const steps = [];
    if (state.api) {
        steps.push(function () { return getLiveList(); });
        steps.push(function () { return getApiKind('movies'); });
        steps.push(function () { return getApiKind('series'); });
    }
    steps.push(function () { return loadAllParsed(); });
    let i = 0;
    (function next() {
        if (i >= steps.length) return;
        steps[i++]().then(next, next);
    })();
}

/* ---------- leitura da lista M3U (uma única vez) e classificação ---------- */
// Pastas da lista embutida que devem ser tratadas como filmes
const MOVIE_FOLDER_HINTS = ['movie anime', '123456', 'solty rei', 'steel angel kurumi 2', 'auto da compadecida',
    'barom one', 'galaxy angel', 'ikkitousen', 'nadja do amanhã', 'thumbelina'];
const RE_EPISODE = /\bS\d{1,2}\s*E\d{1,4}\b/i;
const RE_VIDEO_FILE = /\.(mp4|mkv|avi|mov|wmv|flv|m4v|webm)(\?|#|$)/i;
const RE_LIVE_FILE = /\.(m3u8|ts)(\?|#|$)/i;

function classifyEntry(m) {
    const u = m.url.toLowerCase();
    const g = m.folder.toLowerCase();
    const liveLike = RE_LIVE_FILE.test(u);

    // Servidores IPTV padrão mostram o tipo no próprio link
    if (u.indexOf('/series/') !== -1) return 'series';
    if (u.indexOf('/movie/') !== -1) return 'movie';
    if (u.indexOf('/live/') !== -1) return 'tv';
    // Link no formato servidor/usuario/senha/numero sem pasta de filme ou série = canal ao vivo
    if (/^https?:\/\/[^\/]+\/[^\/]+\/[^\/]+\/\d+(\.[a-z0-9]+)?(\?.*)?$/.test(u) &&
        (liveLike || !/\.[a-z0-9]+(\?.*)?$/.test(u))) return 'tv';

    if (g.indexOf('serie') !== -1 || g.indexOf('série') !== -1 || g.indexOf('season') !== -1 || g.indexOf('temporada') !== -1) return 'series';
    if (!liveLike && (/\b(novela|dorama)s?\b/.test(g) || RE_EPISODE.test(m.name))) return 'series';

    if (g.indexOf('movie') !== -1 || g.indexOf('vod') !== -1) return 'movie';
    for (let i = 0; i < MOVIE_FOLDER_HINTS.length; i++) {
        if (g.indexOf(MOVIE_FOLDER_HINTS[i]) !== -1) return 'movie';
    }
    if (RE_VIDEO_FILE.test(u)) return 'movie';
    if (!liveLike && /filme|cinema|document[aá]rio|locadora|lan[cç]amento/.test(g)) return 'movie';
    return 'tv';
}

function parseM3UAll(text) {
    const out = { tv: [], movies: [], series: [], total: 0 };
    const lines = text.split(/\r?\n/);
    let meta = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('#EXTINF:')) {
            meta = {};
            const groupMatch = line.match(/group-title="([^"]*)"/);
            const folderName = groupMatch ? groupMatch[1].trim() : '';
            meta.folder = folderName || 'Outros';
            const logoMatch = line.match(/tvg-logo="([^"]*)"/);
            meta.logo = logoMatch ? logoMatch[1].trim() : '';

            // o nome vem depois da primeira vírgula que sobra sem os atributos
            const stripped = line.replace(/[\w-]+="[^"]*"/g, '');
            const ci = stripped.indexOf(',');
            const name = ci !== -1 ? stripped.substring(ci + 1).trim() : '';
            meta.name = name || 'Sem Nome';
        } else if (line.charAt(0) !== '#' && /^https?:\/\//i.test(line)) {
            if (meta) {
                meta.url = line;
                meta.id = 'ch_' + out.total;
                out.total++;
                const kind = classifyEntry(meta);
                if (kind === 'movie') out.movies.push(meta);
                else if (kind === 'series') out.series.push(meta);
                else out.tv.push(meta);
                meta = null;
            }
        }
    }
    return out;
}

// Separa os canais da categoria escolhida (tv, movies ou series)
function parseM3U(all) {
    const cat = state.selectedCategory;
    const list = cat === 'movies' ? all.movies : cat === 'series' ? all.series : all.tv;

    state.channels = [];
    state.folders = [];
    state.channelsByFolder = {};
    const seen = Object.create(null);

    list.forEach(function (ch) {
        if (isAdultText(ch.name) && !isAdultText(ch.folder)) ch.folder = ADULT_FOLDER;
        state.channels.push(ch);
        if (!seen[ch.folder]) {
            seen[ch.folder] = true;
            state.folders.push(ch.folder);
            state.channelsByFolder[ch.folder] = [];
        }
        state.channelsByFolder[ch.folder].push(ch);
    });
    // pastas adultas vão para o final da lista
    state.folders = state.folders.filter(function (f) { return !isAdultText(f); })
        .concat(state.folders.filter(function (f) { return isAdultText(f); }));
}

function renderFolders() {
    el.foldersList.innerHTML = '';
    state.folders.forEach((folderName, index) => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.id = `folder-${index}`;
        item.textContent = folderName + (isAdultLocked(folderName) ? LOCK_ICON : '');
        item.dataset.index = index;
        el.foldersList.appendChild(item);
    });
}

function renderChannels(folderName) {
    el.channelsList.innerHTML = '';
    if (isAdultLocked(folderName)) {
        const lockHint = document.createElement('div');
        lockHint.className = 'list-hint';
        lockHint.textContent = 'Conteúdo adulto bloqueado. Aperte OK e digite a senha.';
        el.channelsList.appendChild(lockHint);
        return;
    }
    const folderChannels = state.channelsByFolder[folderName] || [];
    
    folderChannels.forEach((channel, index) => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.id = `channel-${index}`;
        const heart = (folderName !== FAV_FOLDER && isTvFav(channel)) ? '<div class="ch-heart">\u2665</div>' : '';
        item.innerHTML = '<div class="ch-logo">' + (channel.logo ? '<img src="' + esc(channel.logo) + '" referrerpolicy="no-referrer" onerror="this.style.visibility=\'hidden\'">' : '') + '</div>' +
            '<div class="ch-txt"><div class="ch-name">' + esc(channel.name) + '</div><div class="ch-now"></div></div>' + heart;
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
    epgFillNow();
}

function selectFolder(index, focusChannels = false) {
    state.selectedFolderIndex = index;
    const folderName = state.folders[index];
    el.currentFolderTitle.textContent = folderName + ' < ' + ((state.channelsByFolder[folderName] || []).length) + ' >';
    
    const previousSelected = el.foldersList.querySelector('.selected');
    if (previousSelected) previousSelected.classList.remove('selected');
    
    const currentFolderItem = document.getElementById(`folder-${index}`);
    if (currentFolderItem) currentFolderItem.classList.add('selected');
    
    renderChannels(folderName);
    
    if (focusChannels && folderName === SEARCH_FOLDER) { chSearchOpen(); return; }
    if (focusChannels) {
        state.activeColumn = 'channels';
        state.focusedChannelIndex = 0;
    }
}

function updateFocusDOM() {
    const previousFocused = document.querySelectorAll('.list-item.focused, .epg-btn.focused');
    previousFocused.forEach(item => item.classList.remove('focused'));
    
    if (!state.isMenuVisible) return;
    
    let focusedElement = null;
    if (state.activeColumn === 'folders') {
        focusedElement = document.getElementById(`folder-${state.focusedFolderIndex}`);
    } else if (state.activeColumn === 'epgbtn') {
        focusedElement = document.getElementById('epg-btn');
    } else {
        focusedElement = document.getElementById(`channel-${state.focusedChannelIndex}`);
        epgFillNow();
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
        }, state.epgMode ? 30000 : 10000);
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
    try { stopStream(); el.video.pause(); } catch (e) {}
    localStorage.setItem(STORAGE_LAST_CHANNEL_KEY, JSON.stringify(channel));
    localStorage.setItem('iptv_last_played_folder', state.folders[state.selectedFolderIndex]);

    const ytContainer = document.getElementById('youtube-iframe-container');
    if (ytContainer) ytContainer.style.display = 'none';
    el.video.style.display = 'block';
    
    loadStream(toHlsUrl(channel.url), {
        live: true,
        hlsConfig: {
            maxBufferSize: 0,
            liveSyncDuration: 3,
            // --- início rápido ao trocar de canal ---
            startFragPrefetch: true,        // já baixa o 1º pedaço de vídeo junto com a lista
            testBandwidth: false,           // não gasta tempo testando a velocidade antes de começar
            abrEwmaDefaultEstimate: 8000000,
            maxBufferLength: 12,
            maxMaxBufferLength: 20,
            backBufferLength: 5,
            manifestLoadingTimeOut: 5000,   // antes: 10000 (era o "10 segundos" travado)
            manifestLoadingMaxRetry: 2,
            manifestLoadingRetryDelay: 250,
            levelLoadingTimeOut: 5000,
            levelLoadingMaxRetry: 2,
            levelLoadingRetryDelay: 250,
            fragLoadingTimeOut: 8000,
            fragLoadingRetryDelay: 250
        },
        onPlaying: function () {
            hideStatus();
            showToast(channel.name, channel.folder);
        },
        onBlocked: function () {
            showStatus('Pressione OK para reproduzir.', false);
        },
        onFail: function (why) {
            showStatus('Não foi possível abrir este canal' + (why ? ' (' + why + ')' : '') + '. Tente outro.', false);
        }
    });
}

function loadLastPlayedChannel() {
    const rawChannel = localStorage.getItem(STORAGE_LAST_CHANNEL_KEY);
    const lastFolder = localStorage.getItem('iptv_last_played_folder');
    
    if (rawChannel) {
        try {
            const channel = JSON.parse(rawChannel);
            const exists = state.channels.some(c => c.url === channel.url) && !isAdultLocked(channel.folder);
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
        let fi = state.folders.findIndex(f => !isAdultLocked(f) && (state.channelsByFolder[f] || []).length > 0);
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
        if (state.epgMode) closeEpg();
        if (state.menuTimeout) {
            clearTimeout(state.menuTimeout);
            state.menuTimeout = null;
        }
    }
}

/* ====================================================================
   EPG (guia de programação) - só em listas com servidor IPTV (Xtream)
   - Cada canal mostra "Now: programa" (carrega só os canais da tela)
   - Ícone EPG à direita da lista: OK abre o guia (pastas somem, fica
     canais + dias + programação do canal em foco)
   ==================================================================== */
const epg = { cache: {}, now: {}, pend: {}, days: [], dayIdx: 0, progIdx: 0, zone: 'chan', chId: null, items: [], timer: null };
const EPG_WD = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

function epgDecode(t) {
    t = String(t || '');
    if (t && t.length % 4 === 0 && /^[A-Za-z0-9+\/]+=*$/.test(t)) {
        try { return decodeURIComponent(escape(atob(t))); } catch (e) { try { return atob(t); } catch (e2) {} }
    }
    return t;
}
function epgSid(ch) { const m = ch && ch.id && String(ch.id).match(/^live_(\d+)$/); return m ? m[1] : null; }
function epgChannels() {
    const f = state.folders[state.selectedFolderIndex];
    return (f && !isAdultLocked(f)) ? (state.channelsByFolder[f] || []) : [];
}
function epgFetch(sid, full) {
    const key = (full ? 'f' : 's') + sid;
    if (epg.cache[key]) return Promise.resolve(epg.cache[key]);
    return apiJson(full ? 'get_simple_data_table' : 'get_short_epg', '&stream_id=' + enc(sid) + (full ? '' : '&limit=2'), 20000).then(function (d) {
        const items = asArray(d && d.epg_listings).map(function (l) {
            return { start: parseInt(l.start_timestamp, 10) || 0, end: parseInt(l.stop_timestamp || l.end_timestamp, 10) || 0,
                     title: epgDecode(l.title), desc: epgDecode(l.description) };
        }).filter(function (x) { return x.start; }).sort(function (a, b) { return a.start - b.start; });
        epg.cache[key] = items;
        return items;
    });
}
function epgFillNow() {
    if (!state.api || state.epgMode) return;
    const list = epgChannels();
    const f = state.activeColumn === 'channels' ? state.focusedChannelIndex : 0;
    for (let i = Math.max(0, f - 2); i <= Math.min(list.length - 1, f + 7); i++) epgLoadNow(list[i], i);
}
function epgLoadNow(ch, i) {
    const sid = epgSid(ch);
    if (!sid) return;
    function show() {
        const row = document.getElementById('channel-' + i);
        if (row && epgChannels()[i] === ch) { const n = row.querySelector('.ch-now'); if (n) n.textContent = 'Now: ' + epg.now[sid]; }
    }
    if (epg.now[sid] !== undefined) { show(); return; }
    if (epg.pend[sid]) return;
    epg.pend[sid] = 1;
    epgFetch(sid, false).then(function (items) {
        const t = Date.now() / 1000;
        const cur = items.filter(function (x) { return x.start <= t && t < x.end; })[0] || items[0];
        epg.now[sid] = cur ? cur.title : 'No information';
    }).catch(function () { epg.now[sid] = 'No information'; }).then(function () { delete epg.pend[sid]; show(); });
}

function openEpg() {
    const list = epgChannels(), ch = list[state.focusedChannelIndex];
    if (!state.api || !epgSid(ch)) { vodMsg('O guia (EPG) só funciona com a lista do servidor IPTV.', 3500); return; }
    state.epgMode = true;
    state.activeColumn = 'channels';
    epg.zone = 'chan';
    el.overlay.classList.add('epg-on');
    updateFocusDOM();
    epgLoadFor(ch);
}
function closeEpg() {
    if (!state.epgMode) return;
    state.epgMode = false;
    el.overlay.classList.remove('epg-on');
    state.activeColumn = 'channels';
    updateFocusDOM();
    epgFillNow();
}
function epgLoadFor(ch) {
    const sid = epgSid(ch);
    epg.chId = sid;
    $v('epg-days').innerHTML = '';
    $v('epg-progs').innerHTML = '<div class="epg-empty">Carregando...</div>';
    $v('epg-desc').textContent = 'Desc:';
    epgFetch(sid, true).then(function (items) {
        if (epg.chId !== sid || !state.epgMode) return;
        epg.items = items;
        const keys = [], map = {};
        items.forEach(function (x) {
            const d = new Date(x.start * 1000), k = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
            if (!map[k]) { map[k] = { k: k, date: d, items: [] }; keys.push(k); }
            map[k].items.push(x);
        });
        epg.days = keys.sort().map(function (k) { return map[k]; });
        const n = new Date(), nk = n.getFullYear() * 10000 + (n.getMonth() + 1) * 100 + n.getDate();
        epg.dayIdx = Math.max(0, epg.days.map(function (d) { return d.k; }).indexOf(nk));
        epgRender();
    }).catch(function () {
        if (epg.chId === sid) $v('epg-progs').innerHTML = '<div class="epg-empty">Sem informações de programação para este canal.</div>';
    });
}
function p2(n) { return (n < 10 ? '0' : '') + n; }
function epgRender() {
    $v('epg-days').innerHTML = epg.days.map(function (d, i) {
        return '<div class="epg-day' + (i === epg.dayIdx ? ' sel' : '') + (epg.zone === 'days' && i === epg.dayIdx ? ' focus' : '') + '" data-i="' + i + '">' +
               EPG_WD[d.date.getDay()] + '<br><span>' + p2(d.date.getMonth() + 1) + '.' + p2(d.date.getDate()) + '</span></div>';
    }).join('');
    const day = epg.days[epg.dayIdx];
    if (!day) { $v('epg-progs').innerHTML = '<div class="epg-empty">Sem informações de programação para este canal.</div>'; return; }
    const t = Date.now() / 1000;
    let live = -1;
    day.items.forEach(function (x, i) { if (x.start <= t && t < x.end) live = i; });
    if (epg.progIdx >= day.items.length || epg.progIdx < 0) epg.progIdx = 0;
    $v('epg-progs').innerHTML = day.items.map(function (x, i) {
        const d = new Date(x.start * 1000), past = x.end <= t;
        return '<div class="epg-prog' + (past ? ' past' : '') + (epg.zone === 'progs' && i === epg.progIdx ? ' focus' : '') + '" data-i="' + i + '">' +
               p2(d.getHours()) + ':' + p2(d.getMinutes()) + ' ' + esc(x.title) + (i === live ? ' <em>&bull; Live</em>' : '') + '</div>';
    }).join('');
    const shown = day.items[epg.zone === 'progs' ? epg.progIdx : (live >= 0 ? live : 0)];
    $v('epg-desc').textContent = 'Desc: ' + ((shown && shown.desc) || '');
    const target = $v('epg-progs').querySelector(epg.zone === 'progs' ? '.focus' : (live >= 0 ? '.epg-prog:nth-child(' + (live + 1) + ')' : '.epg-prog'));
    if (target && target.scrollIntoView) target.scrollIntoView({ block: 'center' });
}
function epgKeys(e) {
    const k = e.key;
    if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); closeEpg(); return; }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].indexOf(k) === -1) return;
    e.preventDefault();
    const dir = k === 'ArrowDown' ? 1 : k === 'ArrowUp' ? -1 : 0;
    if (epg.zone === 'chan') {
        const list = epgChannels();
        if (dir) {
            state.focusedChannelIndex = Math.max(0, Math.min(list.length - 1, state.focusedChannelIndex + dir));
            updateFocusDOM();
            clearTimeout(epg.timer);
            epg.timer = setTimeout(function () { if (state.epgMode) epgLoadFor(list[state.focusedChannelIndex]); }, 350);
        } else if (k === 'ArrowRight' && epg.days.length) { epg.zone = 'days'; epgRender(); }
        else if (k === 'ArrowLeft') closeEpg();
        else if (k === 'Enter' && list[state.focusedChannelIndex]) startEnterPress(list[state.focusedChannelIndex]);
    } else if (epg.zone === 'days') {
        if (dir) { epg.dayIdx = Math.max(0, Math.min(epg.days.length - 1, epg.dayIdx + dir)); epg.progIdx = 0; epgRender(); }
        else if (k === 'ArrowRight' || k === 'Enter') { epg.zone = 'progs'; epg.progIdx = 0; epgRender(); }
        else if (k === 'ArrowLeft') { epg.zone = 'chan'; epgRender(); }
    } else {
        const n = (epg.days[epg.dayIdx] || { items: [] }).items.length;
        if (dir) { epg.progIdx = Math.max(0, Math.min(n - 1, epg.progIdx + dir)); epgRender(); }
        else if (k === 'ArrowLeft') { epg.zone = 'days'; epgRender(); }
    }
}

function zapChannel(direction) {
    const currentFolder = state.folders[state.selectedFolderIndex];
    if (isAdultLocked(currentFolder)) return;
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

        // segurar o OK: se o controle manda a tecla repetida, conta o tempo aqui também
        if (e.key === 'Enter' && e.repeat && state.enterPressed && !state.longDone && state.enterChannel &&
            Date.now() - (state.enterAt || 0) >= LONG_PRESS_MS) {
            clearTimeout(state.enterTimer);
            state.longDone = true;
            toggleTvFav(state.enterChannel);
            return;
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
        const currentFolderChannels = isAdultLocked(state.folders[state.selectedFolderIndex]) ? [] : (state.channelsByFolder[state.folders[state.selectedFolderIndex]] || []);
        const channelCount = currentFolderChannels.length;

        // Pasta adulta bloqueada: OK ou seta para a direita pede a senha
        if (state.activeColumn === 'folders' && (e.key === 'Enter' || e.key === 'ArrowRight') &&
            isAdultLocked(state.folders[state.focusedFolderIndex])) {
            e.preventDefault();
            const fi = state.focusedFolderIndex;
            askAdultPin(function () {
                if (state.channelsByFolder[FAV_FOLDER]) refreshTvFavList();
                renderFolders();
                selectFolder(fi, true);
                updateFocusDOM();
            });
            return;
        }

        if (state.epgMode) { epgKeys(e); return; }
        if (state.activeColumn === 'folders' && e.key === 'Enter' && state.folders[state.focusedFolderIndex] === SEARCH_FOLDER) {
            e.preventDefault();
            if (e.repeat) return;
            selectFolder(state.focusedFolderIndex, false);
            chSearchOpen();
            return;
        }
        if (state.activeColumn === 'epgbtn') {
            if (e.key === 'ArrowLeft') { e.preventDefault(); state.activeColumn = 'channels'; updateFocusDOM(); }
            else if (e.key === 'Enter') { e.preventDefault(); if (e.repeat) return; clearTimeout(state.enterTimer); state.enterPressed = false; openEpg(); }
            else if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); handleBackAction(); }
            else e.preventDefault();
            return;
        }

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
                } else if (state.activeColumn === 'channels' && state.api) {
                    state.activeColumn = 'epgbtn';
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
    // Botão "Voltar" na TV (aparece com mouse/toque, some quando usa o teclado ou controle)
    document.body.classList.add('tv-on');
    ['mousemove', 'mousedown', 'touchstart'].forEach(function (ev) {
        document.addEventListener(ev, function () { document.body.classList.add('use-pointer'); }, { passive: true });
    });
    document.addEventListener('keydown', function () { document.body.classList.remove('use-pointer'); });
    document.getElementById('vod-backbtn').addEventListener('click', function () { handleBackAction(); });

    el.foldersList.addEventListener('click', (e) => {
        resetMenuInactivityTimer();
        const item = e.target.closest('.list-item');
        if (!item) return;
        const index = parseInt(item.dataset.index);
        state.focusedFolderIndex = index;
        state.activeColumn = 'folders';
        selectFolder(index, false);
        updateFocusDOM();
        if (isAdultLocked(state.folders[index])) {
            askAdultPin(function () {
                if (state.channelsByFolder[FAV_FOLDER]) refreshTvFavList();
                renderFolders();
                selectFolder(index, false);
                updateFocusDOM();
            });
        }
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

    const epgBtn = document.getElementById('epg-btn');
    if (epgBtn) epgBtn.addEventListener('click', function () { resetMenuInactivityTimer(); openEpg(); });

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

/* ====================================================================
   BOTÃO VOLTAR DO APARELHO (celular, controle da TV Box, LDPlayer)
   O app instalado (APK) fecha quando não há "página anterior". Aqui o app cria
   uma página anterior de mentira; ao apertar Voltar o aparelho "volta" nela e o
   app usa esse toque para voltar de tela (filme -> lista -> início).
   Na tela inicial/login, o 1º Voltar só avisa; o 2º Voltar sai do app.
   ==================================================================== */
const backTrap = { lastPush: 0, lastKey: 0, exitAt: 0, exiting: false };

function isBackKey(e) {
    return e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.key === 'BrowserBack';
}

// O Chrome/WebView IGNORA ao voltar as páginas criadas sem toque/tecla do usuário e,
// quando acaba o histórico, o Android mostra "Deseja sair agora?".
// Solução: a cada toque/tecla REAL do usuário criamos uma página falsa nova (válida).
// O histórico do navegador guarda até ~50, então sempre sobram páginas para o Voltar.
function backTrapPush() {
    if (backTrap.exiting) return;
    const now = Date.now();
    if (now - backTrap.lastPush < 120) return;   // evita encher à toa ao segurar uma tecla
    backTrap.lastPush = now;
    try { history.pushState({ iptvTrap: 1 }, '', location.href); } catch (e) {}
}

function setupBackTrap() {
    if (!window.history || !history.pushState) return;
    window.addEventListener('popstate', function () {
        if (backTrap.exiting) return;   // já confirmou sair: deixa o aparelho fechar
        // se a tecla Voltar já foi tratada agora há pouco, não trata de novo
        if (Date.now() - backTrap.lastKey >= 500) {
            handleBackAction();
            backTrap.exitAt = 0;
        }
    });
    // marca quando o Voltar chegou como tecla (controle) para não tratar em dobro
    document.addEventListener('keydown', function (e) {
        if (isBackKey(e)) backTrap.lastKey = Date.now();
    }, true);
    // cada toque/tecla (que não seja Voltar) cria uma página falsa COM gesto do usuário
    ['keydown', 'click', 'mousedown', 'pointerdown', 'touchend'].forEach(function (ev) {
        document.addEventListener(ev, function (e) {
            if (e.type === 'keydown' && isBackKey(e)) return;
            backTrap.exitAt = 0;
            backTrap.exiting = false;
            backTrapPush();
        }, true);
    });
}


function handleBackAction() {
    if (lk.open) { lkClose(); return true; }
    if (pin.open) { pinClose(false); return true; }
    if (state.epgMode) { closeEpg(); return true; }
    if (state.isMenuVisible && state.activeColumn === 'epgbtn') { state.activeColumn = 'channels'; updateFocusDOM(); return true; }
    // Tela de login ou tela inicial: sem pergunta própria. O 1º Voltar só avisa e deixa o
    // histórico vazio; o 2º Voltar é tratado pelo próprio aparelho (sair do app).
    if (loginVisible() || el.splash.classList.contains('splash-visible')) {
        if (backTrap.exitAt && Date.now() - backTrap.exitAt < 4000) return true;
        backTrap.exitAt = Date.now();
        backTrap.exiting = true;
        vodMsg('Aperte Voltar de novo para sair', 3500);
        try { history.go(-Math.max(1, history.length - 1)); } catch (e) {}
        return true;
    }
    // Tela de erro: volta para o início
    if (state.fatal) { window.location.reload(); return true; }
    // Carregando e travou? Voltar recarrega o app (volta para a tela inicial)
    if (!state.vodActive && !state.isMenuVisible && el.status && !el.status.classList.contains('hidden')) {
        window.location.reload();
        return true;
    }
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
        // volta para a tela inicial (o login continua salvo)
        window.location.reload();
        return true;
    }
}

/* ====================================================================
   LOGIN, SESSÃO SALVA E VENCIMENTO DA LISTA
   - Depois de entrar uma vez, o app lembra e abre direto na tela inicial.
   - Para trocar de conta, use o botão "Sair" no canto superior direito.
   ==================================================================== */
const login = { items: [], idx: 0, busy: false, server: 0 };

function loginVisible() {
    const s = document.getElementById('login-screen');
    return !!s && s.classList.contains('login-visible');
}

function enc(s) { return encodeURIComponent(s); }

function readSession() {
    try {
        const s = JSON.parse(localStorage.getItem(SESSION_KEY));
        if (s && (s.mode === 'free' || (s.mode === 'xtream' && s.user && s.pass && s.link))) return s;
    } catch (e) {}
    return null;
}
function saveSession(s) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {} }

function logoutApp() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    window.location.reload();
}

function normalizeServer(link) {
    let s = String(link || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    s = s.replace(/\/(get|player_api|panel_api)\.php.*$/i, '');
    return s.replace(/\/+$/, '');
}

function m3uUrlFor(base, user, pass) {
    return base + '/get.php?username=' + enc(user) + '&password=' + enc(pass) + '&type=m3u_plus&output=m3u8';
}

// fetch com tempo limite (funciona mesmo em WebView antigo, sem AbortController)
function fetchTimeout(url, ms) {
    return new Promise(function (resolve, reject) {
        let done = false;
        const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timer = setTimeout(function () {
            if (done) return;
            done = true;
            if (ctrl) { try { ctrl.abort(); } catch (e) {} }
            reject(new Error('timeout'));
        }, ms);
        fetch(url, ctrl ? { signal: ctrl.signal } : undefined).then(function (r) {
            if (done) return;
            done = true; clearTimeout(timer); resolve(r);
        }, function (err) {
            if (done) return;
            done = true; clearTimeout(timer); reject(err);
        });
    });
}

function loadM3U(url) {
    if (state.m3uCache[url]) return Promise.resolve(state.m3uCache[url]);
    return fetchTimeout(url, 120000)
        .then(function (response) {
            if (!response.ok) throw new Error('Não foi possível baixar a lista M3U.');
            return response.text();
        })
        .then(function (text) {
            state.m3uCache[url] = text;
            return text;
        });
}


/* ====================================================================
   BLOQUEIO ADULTO (senha numérica na tela, funciona com o controle remoto)
   ==================================================================== */
const pin = { open: false, value: '', idx: 4, onOk: null, onCancel: null, box: null, keys: [], force: false };
const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'APAGAR', '0', 'SAIR'];

// Palavras que bloqueiam (pode editar a lista). Ignora acentos e maiúsculas.
// Ex.: "Canais | Adultos", "XXX", "Pornô", "Filme com sexo no nome"
const ADULT_RE = /xxx|18\+|\+18|(^|[^a-z0-9])(porn[a-z]*|sexo|sexy|sex|adultos?|erotic[a-z]*|hentai|playboy|putaria|safada[s]?)($|[^a-z0-9])/;
function isAdultText(s) {
    const t = String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return ADULT_RE.test(t);
}
function isAdultLocked(name) { return !adultUnlocked && isAdultText(name); }

function askAdultPin(onOk, onCancel, opts) {
    const force = !!(opts && opts.force);   // force = sempre pede a senha (ex.: botão Sair)
    if (adultUnlocked && !force) { if (onOk) onOk(); return; }
    if (pin.open) return;
    pin.open = true;
    pin.force = force;
    pin.value = '';
    pin.idx = 4;
    pin.onOk = onOk || null;
    pin.onCancel = onCancel || null;

    const box = document.createElement('div');
    box.id = 'pin-modal';
    box.innerHTML =
        '<div class="pin-box">' +
          '<div class="pin-title">' + ((opts && opts.title) || 'Conteúdo adulto') + '</div>' +
          '<div class="pin-sub">' + ((opts && opts.sub) || 'Digite a senha para desbloquear') + '</div>' +
          '<div class="pin-dots" id="pin-dots"></div>' +
          '<div class="pin-error" id="pin-error"></div>' +
          '<div class="pin-pad">' +
            PIN_KEYS.map(function (k, i) {
                return '<div class="pin-key' + (k.length > 1 ? ' small' : '') + '" data-i="' + i + '">' + k + '</div>';
            }).join('') +
          '</div>' +
        '</div>';
    document.body.appendChild(box);
    pin.box = box;
    pin.keys = box.querySelectorAll('.pin-key');
    box.addEventListener('click', function (e) {
        const t = e.target.closest ? e.target.closest('.pin-key') : null;
        if (!t) return;
        pin.idx = parseInt(t.getAttribute('data-i'), 10);
        pinFocus();
        pinPress(PIN_KEYS[pin.idx]);
    });
    window.addEventListener('keydown', pinKeys, true);   // captura: bloqueia o resto do app enquanto aberto
    pinDots();
    pinFocus();
}

function pinClose(ok) {
    if (!pin.open) return;
    window.removeEventListener('keydown', pinKeys, true);
    if (pin.box && pin.box.parentNode) pin.box.parentNode.removeChild(pin.box);
    pin.open = false;
    pin.box = null;
    const cb = ok ? pin.onOk : pin.onCancel;
    if (ok && !pin.force) adultUnlocked = true;
    pin.onOk = pin.onCancel = null;
    if (cb) cb();
}

function pinDots() {
    const d = document.getElementById('pin-dots');
    if (!d) return;
    let s = '';
    for (let i = 0; i < 4; i++) s += '<span class="pin-dot' + (i < pin.value.length ? ' on' : '') + '"></span>';
    d.innerHTML = s;
}

function pinFocus() {
    for (let i = 0; i < pin.keys.length; i++) pin.keys[i].classList.toggle('pfocus', i === pin.idx);
}

function pinPress(k) {
    const err = document.getElementById('pin-error');
    if (k === 'SAIR') { pinClose(false); return; }
    if (k === 'APAGAR') { pin.value = pin.value.slice(0, -1); if (err) err.textContent = ''; pinDots(); return; }
    if (pin.value.length >= 4) return;
    pin.value += k;
    if (err) err.textContent = '';
    pinDots();
    if (pin.value.length === 4) {
        setTimeout(function () {
            if (!pin.open) return;
            if (pin.value === ADULT_PIN) { pinClose(true); return; }
            pin.value = '';
            pinDots();
            if (err) err.textContent = 'Senha incorreta';
        }, 150);
    }
}

function pinKeys(e) {
    if (!pin.open) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.repeat) return;
    const k = e.key;
    if (/^[0-9]$/.test(k)) { pinPress(k); return; }
    if (k === 'Escape' || k === 'GoBack' || k === 'BrowserBack') { pinClose(false); return; }
    if (k === 'Backspace') { if (pin.value.length) pinPress('APAGAR'); else pinClose(false); return; }
    if (k === 'Enter') { pinPress(PIN_KEYS[pin.idx]); return; }
    let r = Math.floor(pin.idx / 3), c = pin.idx % 3;
    if (k === 'ArrowLeft') c = (c + 2) % 3;
    else if (k === 'ArrowRight') c = (c + 1) % 3;
    else if (k === 'ArrowUp') r = (r + 3) % 4;
    else if (k === 'ArrowDown') r = (r + 1) % 4;
    else return;
    pin.idx = r * 3 + c;
    pinFocus();
}

/* ---------- tela de login ---------- */
function setupLogin() {
    const fUser = document.getElementById('login-user');
    const fPass = document.getElementById('login-pass');
    const fLink = document.getElementById('login-link');
    const fCustom = document.getElementById('login-custom');
    const btnLogin = document.getElementById('btn-login');
    const btnFree = document.getElementById('btn-free');

    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LOGIN_KEY)); } catch (e) {}
    fUser.value = (saved && saved.user) || DEFAULT_USER;
    fPass.value = (saved && saved.pass) || DEFAULT_PASS;
    let sIdx = 0;
    if (saved && saved.link) {
        for (let i = 0; i < SERVERS.length; i++) {
            if (normalizeServer(SERVERS[i].url) === normalizeServer(saved.link)) { sIdx = i; break; }
        }
    }
    login.server = sIdx;
    renderServerPick();
    fCustom.value = (saved && saved.custom) || '';

    // ordem: 0 usuário, 1 senha, 2 servidor, 3 link manual, 4 Entrar, 5 TV grátis
    login.items = [fUser, fPass, fLink, fCustom, btnLogin, btnFree];
    login.idx = 4; // começa no botão Entrar

    login.items.forEach(function (it, i) {
        it.addEventListener('focus', function () { login.idx = i; });
    });

    // Campos ficam "somente leitura" até tocar ou apertar OK, assim o teclado
    // do TV Box não abre sozinho enquanto navega com o controle.
    fLink.addEventListener('click', function () { changeServer(1); });

    // Toque/clique no campo abre o teclado virtual do próprio app
    // (o teclado do aparelho nunca abre, então a tela não é empurrada).
    [fUser, fPass, fCustom].forEach(function (inp) {
        inp.addEventListener('click', function () { lkOpen(inp); });
    });

    btnLogin.addEventListener('click', doLogin);
    btnFree.addEventListener('click', enterFree);

    const sess = readSession();
    if (sess) {
        resumeSession(sess);   // já logado: vai direto para a tela inicial
        return;
    }
    document.documentElement.classList.remove('has-session');
    document.addEventListener('keydown', handleLoginKeys);
    loginFocus(4);
}

function loginFocus(i) {
    login.idx = Math.max(0, Math.min(login.items.length - 1, i));
    const it = login.items[login.idx];
    if (it) it.focus({ preventScroll: true });
}

function loginStopEdit(it) {
    if (it && it.tagName === 'INPUT') it.readOnly = true;
}

function loginStartEdit(it) {
    it.readOnly = false;
    it.focus({ preventScroll: true });
    try { const n = it.value.length; it.setSelectionRange(n, n); } catch (e) {}
}

/* ---------- teclado virtual da tela de login ---------- */
function lkK(k, s, t) { return { k: k, s: s || 2, t: t || 'ch' }; }
function lkChars(str) { return str.split(' ').map(function (k) { return lkK(k); }); }
function lkPrep(rows) {
    rows.forEach(function (row) {
        let col = row.off ? 2 : 1;
        row.forEach(function (key) { key.c0 = col; col += key.s; });
    });
    return rows;
}
function lkBottom(first, last) {
    return [lkK(first, 3, 'sym'), lkK(':'), lkK('/'), lkK('Espaço', 6, 'space'), lkK(last), lkK('-'), lkK('OK', 3, 'ok')];
}
const LK_LAYOUT = {
    abc: lkPrep([
        lkChars('1 2 3 4 5 6 7 8 9 0'),
        lkChars('q w e r t y u i o p'),
        (function () { const r = lkChars('a s d f g h j k l'); r.off = true; return r; })(),
        [lkK('Aa', 3, 'shift')].concat(lkChars('z x c v b n m'), [lkK('Apagar', 3, 'back')]),
        lkBottom('?123', '.')
    ]),
    sym: lkPrep([
        lkChars('1 2 3 4 5 6 7 8 9 0'),
        lkChars('@ # $ % & * ( ) _ +'),
        (function () { const r = lkChars('= ! ? " \' ; , ~ ^'); r.off = true; return r; })(),
        [lkK('\\', 3)].concat(lkChars('< > [ ] { } |'), [lkK('Apagar', 3, 'back')]),
        lkBottom('ABC', '.')
    ])
};
const LK_NAMES = { 'login-user': 'Usuário', 'login-pass': 'Senha', 'login-custom': 'Link do servidor' };
const lk = { open: false, inp: null, sym: false, shift: false, r: 1, c: 0, box: null, els: [], bar: false };

function lkRows() { return LK_LAYOUT[lk.sym ? 'sym' : 'abc']; }

function lkOpen(inp) {
    if (lk.open || !inp) return;
    lk.open = true;
    lk.inp = inp;
    lk.sym = false;
    lk.shift = false;
    lk.r = 1;
    lk.c = 0;
    lk.bar = false;
    const box = document.createElement('div');
    box.id = 'lk-modal';
    box.innerHTML =
        '<div class="lk-box">' +
          '<div class="lk-label">' + (LK_NAMES[inp.id] || 'Digite') + '</div>' +
          '<div class="lk-inputrow">' +
            '<div class="lk-input" id="lk-input"></div>' +
            '<div class="lk-pastebtn" id="lk-pastebtn" title="Colar">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>' +
              '<span>Colar</span>' +
            '</div>' +
          '</div>' +
          '<div class="lk-note" id="lk-note"></div>' +
          '<input id="lk-paste" class="lk-pastein" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Toque e segure aqui e escolha Colar">' +
          '<div class="lk-grid" id="lk-grid"></div>' +
        '</div>';
    document.body.appendChild(box);
    lk.box = box;
    box.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('#lk-pastebtn')) { lk.bar = true; lkMark(); lkPaste(); return; }
        const t = e.target.closest ? e.target.closest('.lk-key') : null;
        if (!t) return;
        lk.bar = false;
        lk.r = parseInt(t.getAttribute('data-r'), 10);
        lk.c = parseInt(t.getAttribute('data-c'), 10);
        lkMark();
        lkPress(lkRows()[lk.r][lk.c]);
    });
    window.addEventListener('keydown', lkKeys, true);   // captura: bloqueia o resto do app enquanto aberto
    window.addEventListener('paste', lkOnPaste, true);   // Ctrl+V no teclado do computador
    const pin2 = box.querySelector('#lk-paste');
    pin2.addEventListener('input', function () {
        const t = pin2.value;
        pin2.value = '';
        lkFallbackHide();
        lkInsert(t);
    });
    lkRender();
}

function lkClose() {
    if (!lk.open) return;
    window.removeEventListener('keydown', lkKeys, true);
    window.removeEventListener('paste', lkOnPaste, true);
    if (lk.box && lk.box.parentNode) lk.box.parentNode.removeChild(lk.box);
    const inp = lk.inp;
    lk.open = false;
    lk.box = null;
    lk.inp = null;
    if (inp) { try { inp.focus({ preventScroll: true }); } catch (e) {} }
}

function lkRender() {
    const g = document.getElementById('lk-grid');
    if (!g) return;
    let h = '';
    lkRows().forEach(function (row, r) {
        row.forEach(function (key, c) {
            let label = key.k;
            let cls = 'lk-key';
            if (key.t === 'ch' && !lk.sym && /^[a-z]$/.test(label) && lk.shift) label = label.toUpperCase();
            if (key.t !== 'ch') cls += ' fn';
            if (key.t === 'shift' && lk.shift) cls += ' on';
            if (key.t === 'ok') cls += ' ok';
            h += '<div class="' + cls + '" data-r="' + r + '" data-c="' + c + '" style="grid-column:' + key.c0 + ' / span ' + key.s + '">' + esc(label) + '</div>';
        });
    });
    g.innerHTML = h;
    lk.els = g.querySelectorAll('.lk-key');
    lkMark();
    lkText();
}

function lkMark() {
    for (let i = 0; i < lk.els.length; i++) {
        const e = lk.els[i];
        const on = !lk.bar && parseInt(e.getAttribute('data-r'), 10) === lk.r && parseInt(e.getAttribute('data-c'), 10) === lk.c;
        e.classList.toggle('lfocus', on);
    }
    const pb = document.getElementById('lk-pastebtn');
    if (pb) pb.classList.toggle('lfocus', lk.bar);
}

/* ---- colar texto copiado ---- */
function lkNote(msg) {
    const n = document.getElementById('lk-note');
    if (n) n.textContent = msg || '';
}

function lkInsert(t) {
    t = String(t == null ? '' : t).replace(/[\r\n\t]+/g, '');
    if (!t) { lkNote('Não há nada copiado para colar.'); return; }
    lkNote('');
    lkType(t);
}

function lkOnPaste(e) {
    if (!lk.open) return;
    if (e.target && e.target.id === 'lk-paste') return;   // o campo de reserva trata o próprio colar
    e.preventDefault();
    e.stopPropagation();
    let t = '';
    try { t = (e.clipboardData || window.clipboardData).getData('text'); } catch (err) {}
    lkInsert(t);
}

function lkFallbackShow() {
    const f = document.getElementById('lk-paste');
    if (!f) return;
    f.classList.add('show');
    lkNote('Toque e segure no campo abaixo e escolha Colar.');
    try { f.focus({ preventScroll: true }); } catch (e) {}
}

function lkFallbackHide() {
    const f = document.getElementById('lk-paste');
    if (!f) return;
    f.classList.remove('show');
    try { f.blur(); } catch (e) {}
}

function lkPaste() {
    if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (t) {
            if (!lk.open) return;
            lkInsert(t);
        }, function () {
            if (lk.open) lkFallbackShow();   // o aparelho não deixou ler a área de transferência
        });
    } else {
        lkFallbackShow();
    }
}

function lkText() {
    const d = document.getElementById('lk-input');
    if (d && lk.inp) d.innerHTML = '<span class="lk-txt">' + esc(lk.inp.value) + '</span><span class="lk-cur"></span>';
    if (lk.inp && lk.inp.id === 'ch-search') chSearchApply(lk.inp.value);
}

function lkType(ch) {
    if (!lk.inp) return;
    lk.inp.value += ch;
    lkText();
}

function lkPress(key) {
    if (!key) return;
    if (key.t === 'ch') {
        let ch = key.k;
        if (!lk.sym && lk.shift && /^[a-z]$/.test(ch)) { ch = ch.toUpperCase(); lk.shift = false; lkType(ch); lkRender(); return; }
        lkType(ch);
    } else if (key.t === 'space') {
        lkType(' ');
    } else if (key.t === 'back') {
        if (lk.inp) { lk.inp.value = lk.inp.value.slice(0, -1); lkText(); }
    } else if (key.t === 'shift') {
        lk.shift = !lk.shift;
        lkRender();
    } else if (key.t === 'sym') {
        lk.sym = !lk.sym;
        lk.shift = false;
        lk.r = 4;
        lk.c = 0;
        lkRender();
    } else if (key.t === 'ok') {
        lkClose();
    }
}

function lkMove(dr, dc) {
    const rows = lkRows();
    let r = lk.r, c = lk.c;
    if (dc) {
        c = Math.max(0, Math.min(rows[r].length - 1, c + dc));
    } else {
        const nr = r + dr;
        if (nr < 0) { lk.bar = true; lkMark(); return; }
        if (nr >= rows.length) return;
        const cur = rows[r][c];
        const center = cur.c0 + cur.s / 2;
        let best = 0, bd = 1e9;
        rows[nr].forEach(function (k, i) {
            const d = Math.abs(k.c0 + k.s / 2 - center);
            if (d < bd) { bd = d; best = i; }
        });
        r = nr; c = best;
    }
    lk.r = r; lk.c = c;
    lkMark();
}

function lkKeys(e) {
    if (!lk.open) return;
    e.stopImmediatePropagation();
    const k = e.key;
    const fb = document.getElementById('lk-paste');
    const fbOpen = !!(fb && fb.classList.contains('show'));
    if (k === 'Escape' || k === 'GoBack' || k === 'BrowserBack') { e.preventDefault(); if (fbOpen) { lkFallbackHide(); lkNote(''); } else lkClose(); return; }
    if (k === 'Backspace') {
        e.preventDefault();
        if (e.repeat && lk.inp && !lk.inp.value) return;
        if (lk.inp && lk.inp.value) lkPress({ t: 'back' }); else lkClose();
        return;
    }
    if (lk.bar) {
        if (k === 'Enter') { e.preventDefault(); if (!e.repeat) lkPaste(); return; }
        if (k === 'ArrowDown') { e.preventDefault(); lk.bar = false; lkMark(); return; }
        if (k === 'ArrowUp' || k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); return; }
    }
    if (k === 'Enter') { e.preventDefault(); if (!e.repeat) lkPress(lkRows()[lk.r][lk.c]); return; }
    if (k === 'ArrowLeft') { e.preventDefault(); lkMove(0, -1); return; }
    if (k === 'ArrowRight') { e.preventDefault(); lkMove(0, 1); return; }
    if (k === 'ArrowUp') { e.preventDefault(); lkMove(-1, 0); return; }
    if (k === 'ArrowDown') { e.preventDefault(); lkMove(1, 0); return; }
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); if (!fbOpen) lkType(k); }   // teclado físico (computador)
}

function handleLoginKeys(e) {
    if (!loginVisible()) return;
    const cur = login.items[login.idx];
    const isInput = cur && cur.tagName === 'INPUT';
    const editing = isInput && !cur.readOnly;

    // Campo "Servidor": esquerda/direita/OK trocam entre Servidor 1, 2, 3...
    if (login.idx === 2) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); changeServer(-1); return; }
        if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); changeServer(1); return; }
    }

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        loginStopEdit(cur);
        loginFocus(login.idx + 1);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        loginStopEdit(cur);
        loginFocus(login.idx - 1);
    } else if (e.key === 'ArrowRight' && !isInput) {
        e.preventDefault();
        if (login.idx === 4) loginFocus(5);
    } else if (e.key === 'ArrowLeft' && !isInput) {
        e.preventDefault();
        if (login.idx === 5) loginFocus(4);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (isInput) {
            lkOpen(cur);
        } else if (cur) {
            cur.click();
        }
    }
}

function renderServerPick() {
    const n = document.getElementById('login-server-name');
    if (n && SERVERS.length) n.textContent = SERVERS[login.server].name;
}

function changeServer(dir) {
    if (!SERVERS.length) return;
    login.server = (login.server + dir + SERVERS.length) % SERVERS.length;
    renderServerPick();
}

function loginError(msg) {
    const box = document.getElementById('login-error');
    if (!msg) { box.classList.add('hidden'); box.textContent = ''; return; }
    box.textContent = msg;
    box.classList.remove('hidden');
}

function loginBusy(on) {
    login.busy = on;
    const b = document.getElementById('btn-login');
    b.textContent = on ? 'Entrando...' : 'Entrar';
    b.classList.toggle('busy', on);
}

function showSplashAfterLogin() {
    const ls = document.getElementById('login-screen');
    ls.classList.remove('login-visible');
    setTimeout(function () { ls.style.display = 'none'; }, 450);
    document.removeEventListener('keydown', handleLoginKeys);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    el.splash.classList.add('splash-visible');
    state.splashZone = 'cards';
    state.splashFocusIndex = 0;
    updateSplashFocus();
    setTimeout(prefetchAll, 800);   // baixa/atualiza as listas em segundo plano
}

// Abre direto na tela inicial usando o último login que deu certo
function resumeSession(s) {
    document.getElementById('login-screen').classList.add('instant');
    if (s.mode === 'free') {
        state.api = null;
        state.m3uUrl = M3U_URL;
        renderExpiry(null);
        showSplashAfterLogin();
        return;
    }
    const base = normalizeServer(s.link);
    state.m3uUrl = m3uUrlFor(base, s.user, s.pass);
    state.api = s.api ? { base: base, user: s.user, pass: s.pass } : null;
    if (s.api) renderExpiry({ exp_date: s.exp });
    showSplashAfterLogin();
    if (s.api) refreshExpiry(s);   // atualiza a data em segundo plano, sem atrapalhar
}

function refreshExpiry(s) {
    fetchTimeout(apiUrl(), 15000)
        .then(function (r) { return r.json(); })
        .then(function (d) {
            const info = d && d.user_info;
            if (!info) return;
            if (String(info.auth) === '0') { renderExpiry({ invalid: true }); return; }
            s.exp = (info.exp_date === undefined) ? null : info.exp_date;
            saveSession(s);
            renderExpiry(info);
        })
        .catch(function () {});
}

// Botão "TV grátis": usa a lista que já vem embutida no app
function enterFree() {
    if (login.busy) return;
    state.api = null;
    state.m3uUrl = M3U_URL;
    saveSession({ mode: 'free' });
    renderExpiry(null);
    showSplashAfterLogin();
}

// Aceita link colado inteiro (ex.: http://site.com:8080/get.php?username=X&password=Y...)
// e extrai o usuário e a senha que vierem dentro dele.
function parseCustomLink(txt) {
    const out = { link: String(txt || '').trim(), user: '', pass: '' };
    const mu = /[?&]username=([^&\s]+)/i.exec(out.link);
    const mp = /[?&]password=([^&\s]+)/i.exec(out.link);
    try { if (mu) out.user = decodeURIComponent(mu[1]); if (mp) out.pass = decodeURIComponent(mp[1]); } catch (e) {}
    return out;
}

// Endereços que o app tenta, na ordem, para o mesmo link digitado.
// Página https não consegue abrir link http direto, então também tenta a versão https.
function loginBases(link) {
    let b = normalizeServer(link);
    b = b.replace(/\/c$/i, '');            // alguns painéis usam .../c
    const list = [];
    const add = function (x) { if (x && list.indexOf(x) === -1) list.push(x); };
    if (/^http:\/\//i.test(b) && location.protocol === 'https:') {
        add(b.replace(/^http:/i, 'https:'));
        add(b);
    } else {
        add(b);
        if (/^https:\/\//i.test(b)) add(b.replace(/^https:/i, 'http:'));
        else add(b.replace(/^http:/i, 'https:'));
    }
    return list;
}

async function doLogin() {
    if (login.busy) return;
    let user = document.getElementById('login-user').value.trim();
    let pass = document.getElementById('login-pass').value.trim();
    // Se digitou um link manual, ele vale no lugar do Servidor 1/2/3
    const custom = document.getElementById('login-custom').value.trim();
    let link = custom || (SERVERS.length ? SERVERS[login.server].url : '');

    // Link colado com usuário e senha dentro: usa os dados do próprio link
    if (custom) {
        const pc = parseCustomLink(custom);
        if (pc.user && pc.pass) {
            user = pc.user; pass = pc.pass;
            document.getElementById('login-user').value = user;
            document.getElementById('login-pass').value = pass;
        }
    }

    if (!user || !pass) { loginError('Preencha usuário e senha.'); return; }
    if (!link) { loginError('Nenhum servidor configurado.'); return; }

    loginError('');
    loginBusy(true);

    const bases = loginBases(link);
    let authFail = false;
    let ok = null;

    try {
        for (let i = 0; i < bases.length && !ok; i++) {
            const base = bases[i];
            const tryApi = { base: base, user: user, pass: pass };
            const m3uUrl = m3uUrlFor(base, user, pass);
            let info = null;

            // 1) Valida pelo login do servidor (traz também a data de vencimento)
            try {
                const old = state.api;
                state.api = tryApi;
                const r = await fetchTimeout(apiUrl(), 15000);
                state.api = old;
                if (r.ok) {
                    const d = await r.json();
                    if (d && d.user_info) info = d.user_info;
                }
            } catch (e) { info = null; state.api = null; }

            if (info && String(info.auth) === '0') { authFail = true; continue; }
            if (info) { ok = { base: base, info: info, m3uUrl: m3uUrl }; break; }

            // 2) Se o servidor não respondeu ao login, valida baixando a lista
            try {
                const r = await fetchTimeout(m3uUrl, 60000);
                if (!r.ok) throw new Error('http ' + r.status);
                const txt = await r.text();
                if (txt.indexOf('#EXTM3U') === -1) throw new Error('lista inválida');
                state.m3uCache[m3uUrl] = txt;
                ok = { base: base, info: null, m3uUrl: m3uUrl };
            } catch (e) { console.error(e); }
        }

        if (!ok) {
            state.api = null;
            if (authFail) loginError('Usuário ou senha inválidos para este link.');
            else if (custom) loginError('Não consegui conectar a esse link. Confira o endereço (e a porta, se tiver) e tente também com https://');
            else loginError('Não foi possível entrar. Confira o link, o usuário e a senha.');
            return;
        }

        const info = ok.info;
        try { localStorage.setItem(LOGIN_KEY, JSON.stringify({ user: user, pass: pass, link: link, custom: custom })); } catch (e) {}
        state.m3uUrl = ok.m3uUrl;
        state.api = info ? { base: ok.base, user: user, pass: pass } : null;
        saveSession({
            mode: 'xtream', user: user, pass: pass, link: ok.base,
            api: !!info, exp: info ? (info.exp_date === undefined ? null : info.exp_date) : null
        });
        renderExpiry(info);
        showSplashAfterLogin();
    } catch (err) {
        console.error(err);
        loginError('Não foi possível entrar. Confira o link, o usuário e a senha.');
    } finally {
        loginBusy(false);
    }
}

function fmtDateBR(d) {
    const p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
}

// Mostra a data de vencimento no canto superior esquerdo da tela inicial
function renderExpiry(info) {
    const box = document.getElementById('splash-expiry');
    const main = document.getElementById('splash-expiry-main');
    const sub = document.getElementById('splash-expiry-sub');
    box.classList.remove('warn', 'expired');

    if (!info) { box.classList.add('hidden'); return; }

    if (info.invalid) {
        main.textContent = 'Login inválido';
        sub.textContent = 'Use o botão Sair e entre de novo';
        box.classList.add('expired');
        box.classList.remove('hidden');
        return;
    }

    const raw = info.exp_date;
    const secs = Number(raw);
    if (raw === null || raw === undefined || raw === '' || !isFinite(secs) || secs === 0) {
        main.textContent = 'Sem data de vencimento';
        sub.textContent = '';
        box.classList.remove('hidden');
        return;
    }

    const d = new Date(secs * 1000);
    const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
    main.textContent = 'Vencimento: ' + fmtDateBR(d);
    if (days < 0) { sub.textContent = 'Lista vencida'; box.classList.add('expired'); }
    else if (days === 0) { sub.textContent = 'Vence hoje'; box.classList.add('warn'); }
    else {
        sub.textContent = days === 1 ? 'Falta 1 dia' : 'Faltam ' + days + ' dias';
        if (days <= 7) box.classList.add('warn');
    }
    box.classList.remove('hidden');
}

/* ====================================================================
   API DO SERVIDOR (Filmes e Séries)
   Filmes e séries são carregados pela API do servidor (leve e rápida).
   Se a API não responder, o app usa a lista M3U como alternativa.
   ==================================================================== */
function apiUrl(action, extra) {
    const a = state.api;
    return a.base + '/player_api.php?username=' + enc(a.user) + '&password=' + enc(a.pass) +
        (action ? '&action=' + action : '') + (extra || '');
}

function apiJson(action, extra, ms) {
    return fetchTimeout(apiUrl(action, extra), ms || 90000).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
    });
}

function asArray(x) {
    if (Array.isArray(x)) return x;
    if (x && typeof x === 'object') return Object.keys(x).map(function (k) { return x[k]; });
    return [];
}

function catMapOf(list) {
    const m = Object.create(null);
    asArray(list).forEach(function (c) {
        if (c && c.category_id != null) m[String(c.category_id)] = String(c.category_name || '').trim();
    });
    return m;
}

function streamUrl(kind, id, ext) {
    const a = state.api;
    return a.base + '/' + kind + '/' + enc(a.user) + '/' + enc(a.pass) + '/' + id + '.' + (ext || 'mp4');
}

function loadMoviesApi() {
    return Promise.all([
        apiJson('get_vod_categories', '', 30000).catch(function () { return []; }),
        apiJson('get_vod_streams')
    ]).then(function (r) {
        const cm = catMapOf(r[0]);
        return asArray(r[1]).filter(function (s) { return s && s.stream_id != null; }).map(function (s) {
            return {
                key: 'M:' + s.stream_id,
                title: String(s.name || 'Sem nome').trim(),
                logo: s.stream_icon || s.cover || s.movie_image || '',
                kind: 'movie',
                group: cm[String(s.category_id)] || 'Outros',
                url: streamUrl('movie', s.stream_id, s.container_extension),
                vodId: s.stream_id
            };
        });
    });
}

function loadSeriesApi() {
    return Promise.all([
        apiJson('get_series_categories', '', 30000).catch(function () { return []; }),
        apiJson('get_series')
    ]).then(function (r) {
        const cm = catMapOf(r[0]);
        return asArray(r[1]).filter(function (s) { return s && s.series_id != null; }).map(function (s) {
            return {
                key: 'S:' + s.series_id,
                title: String(s.name || 'Sem nome').trim(),
                logo: s.cover || (Array.isArray(s.backdrop_path) ? s.backdrop_path[0] : '') || s.stream_icon || '',
                kind: 'series',
                group: cm[String(s.category_id)] || 'Outros',
                eps: [], lazy: true, loaded: false,
                seriesId: s.series_id,
                plot: s.plot || '',
                rating: s.rating || '',
                releaseDate: s.releaseDate || s.release_date || '',
                director: s.director || '',
                cast: s.cast || '',
                genre: s.genre || ''
            };
        });
    });
}

function loadVodFromApi(cat) {
    const jobs = [];
    if (cat === 'movies' || cat === 'mixed') {
        jobs.push(loadMoviesApi().then(function (cards) { return { kind: 'movies', cards: cards }; }));
    }
    if (cat === 'series' || cat === 'mixed') {
        jobs.push(loadSeriesApi().then(function (cards) { return { kind: 'series', cards: cards }; }));
    }
    return Promise.all(jobs);
}

// Episódios da série são carregados só quando você abre a série
function loadSeriesEpisodes(card) {
    return apiJson('get_series_info', '&series_id=' + enc(card.seriesId), 60000).then(function (d) {
        const eps = [];

        function pushEp(e, hint) {
            if (!e || e.id == null) return;
            const sRaw = (e.season != null && e.season !== '') ? e.season : hint;
            const season = parseInt(sRaw, 10) || 1;
            const num = parseInt(e.episode_num, 10) || (eps.length + 1);
            eps.push({
                name: e.title || ('Episódio ' + num),
                url: streamUrl('series', e.id, e.container_extension),
                season: season,
                ep: num
            });
        }
        function walk(node, hint) {
            if (Array.isArray(node)) {
                node.forEach(function (x, i) {
                    if (Array.isArray(x)) walk(x, String(i + 1));
                    else if (x && typeof x === 'object') pushEp(x, hint);
                });
            } else if (node && typeof node === 'object') {
                Object.keys(node).forEach(function (k) { walk(node[k], k); });
            }
        }
        walk(d && d.episodes, null);

        eps.sort(function (a, b) { return (a.season - b.season) || (a.ep - b.ep); });
        const info = (d && d.info) || {};
        if (info.plot) card.plot = info.plot;
        if (!card.logo && (info.cover || info.movie_image)) card.logo = info.cover || info.movie_image;
        if (info.rating) card.rating = info.rating;
        if (info.releaseDate || info.release_date) card.releaseDate = info.releaseDate || info.release_date;
        if (info.director) card.director = info.director;
        if (info.cast) card.cast = info.cast;
        if (info.genre) card.genre = info.genre;
        card.eps = eps;
        card.loaded = eps.length > 0;
        return eps.length > 0;
    });
}

function parseRating(r) {
    const n = parseFloat(r);
    return (isFinite(n) && n > 0) ? n : 0;
}

/* ---------- mensagens e erros na tela ---------- */
function fatalStatus(msg) {
    state.fatal = true;
    showStatus(msg + '\n\nPressione OK ou toque na tela para voltar ao início.', true);
    const ignore = ['VolumeUp', 'VolumeDown', 'VolumeMute', 'Mute'];
    const back = function (e) {
        if (e && e.type === 'keydown' && ignore.indexOf(e.key) !== -1) return;
        document.removeEventListener('keydown', back, true);
        el.status.removeEventListener('click', back);
        if (e && e.preventDefault) e.preventDefault();
        window.location.reload();
    };
    document.addEventListener('keydown', back, true);
    el.status.addEventListener('click', back);
}

let vodMsgTimer = null;
function vodMsg(text, ms) {
    const m = document.getElementById('vod-msg');
    if (!m) return;
    m.textContent = text;
    m.classList.remove('hidden');
    clearTimeout(vodMsgTimer);
    vodMsgTimer = setTimeout(function () { m.classList.add('hidden'); }, ms || 5000);
}

/* ====================================================================
   REPRODUÇÃO ROBUSTA: hls.js -> (se falhar) player nativo do aparelho
   Corrige canais/filmes que ficavam "carregando" no Android / LDPlayer.
   ==================================================================== */
const HLS_CDNS = [
    'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.17/hls.min.js'
];
let hlsQueue = null;
let hlsGaveUp = false;

// Garante que o hls.js existe; se o arquivo local hls.min.js não foi carregado, baixa de um CDN
function ensureHls(cb) {
    if (window.Hls || hlsGaveUp) { cb(); return; }
    if (hlsQueue) { hlsQueue.push(cb); return; }
    hlsQueue = [cb];
    let i = 0;
    function done() {
        if (!window.Hls) hlsGaveUp = true;
        const q = hlsQueue; hlsQueue = null;
        q.forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
    }
    function next() {
        if (window.Hls || i >= HLS_CDNS.length) { done(); return; }
        const sc = document.createElement('script');
        sc.src = HLS_CDNS[i++];
        sc.onload = function () { if (window.Hls) done(); else next(); };
        sc.onerror = next;
        document.head.appendChild(sc);
    }
    next();
}

// Testa se o aparelho consegue ao menos alcançar o endereço do vídeo (mostra BLOQUEADA se o Android barrou)
function probeUrl(url, cb) {
    if (typeof fetch !== 'function') { cb('?'); return; }
    let done = false, t = null;
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    function fin(r) {
        if (done) return;
        done = true; clearTimeout(t);
        if (ctrl) { try { ctrl.abort(); } catch (e) {} }
        cb(r);
    }
    t = setTimeout(function () { fin('lenta'); }, 7000);
    const sig = ctrl ? ctrl.signal : undefined;
    try {
        // 1) pedido normal: se o servidor libera o acesso (CORS), dá para ver o status e o começo da resposta
        fetch(url, { mode: 'cors', cache: 'no-store', signal: sig }).then(function (r) {
            const ct = String(r.headers.get('content-type') || '').split(';')[0];
            const base = 'ok HTTP' + r.status + ' ' + (ct || '?');
            if (/mpegurl|text|json|html|xml/i.test(ct)) {
                return r.text().then(function (tx) {
                    fin(base + ' «' + String(tx).slice(0, 70).replace(/\s+/g, ' ') + '»');
                }, function () { fin(base); });
            }
            fin(base);
        }, function () {
            // 2) sem CORS: só testa se o aparelho consegue alcançar o endereço
            fetch(url, { mode: 'no-cors', cache: 'no-store', signal: sig })
                .then(function () { fin('ok-sem-CORS'); }, function () { fin('BLOQUEADA'); });
        });
    } catch (e) { fin('?'); }
}

function hostInfo(url) {
    const m = /^https?:\/\/([^\/:]+)(?::(\d+))?/i.exec(url);
    if (!m) return '';
    const h = m[1].toLowerCase();
    const igual = SERVERS.some(function (sv) { return String(sv.url).toLowerCase().indexOf('//' + h) !== -1; });
    return 'host:' + (igual ? 'do-servidor' : 'outro') + (m[2] ? ' porta:' + m[2] : ' sem-porta');
}

let streamToken = 0;
let streamWatch = null;

function destroyHls() {
    if (state.hls) { try { state.hls.destroy(); } catch (e) {} state.hls = null; }
}

function stopStream() {
    streamToken++;
    clearTimeout(streamWatch);
    destroyHls();
}

// Abre uma mídia. opts: live, hlsConfig, onPlaying, onBlocked, onFail
function loadStreamOne(url, opts) {
    const o = opts || {};
    const v = el.video;
    const token = ++streamToken;
    clearTimeout(streamWatch);
    destroyHls();

    let usingNative = false, finished = false, failed = false, blocked = false, lastErr = '', hlsErr = '';
    const stale = function () { return token !== streamToken; };

    const hlsLike = o.live
        ? !/\.(mp4|mkv|webm|avi|mov)(\?|$)/i.test(url)
        : /\.m3u8(\?|$)/i.test(url);

    function ok() {
        if (stale() || finished) return;
        finished = true;
        clearTimeout(streamWatch);
        if (o.onPlaying) o.onPlaying();
    }
    function fail(why) {
        if (stale() || finished || failed) return;
        failed = true;
        clearTimeout(streamWatch);
        console.warn('Falha ao reproduzir:', url, why);
        if (o.quick) { if (o.onFail) o.onFail(why || lastErr); return; }
        // Diagnóstico: mostra na tela o motivo real para descobrir o problema no Android
        probeUrl(url, function (rede) {
            if (stale()) return;
            const m = /^(https?):/i.exec(url);
            const diag = (why || lastErr || '?') +
                ' | pág:' + String(location.protocol).replace(':', '') +
                ' stream:' + (m ? m[1].toLowerCase() : '?') +
                ' hls:' + (window.Hls ? (Hls.isSupported() ? 'ok' : 'semMSE') : 'ausente') +
                ' net:' + v.networkState + ' rs:' + v.readyState +
                ' rede:' + rede +
                (hlsErr ? ' hlsjs:' + hlsErr : '') +
                ' | v8 ' + hostInfo(url) +
                (o.tried ? ' | tentou: ' + o.tried : '');
            const dica = (rede === 'BLOQUEADA' && location.protocol === 'https:' && /^http:/i.test(url))
                ? 'Provável bloqueio: página https abrindo vídeo http. ' : '';
            if (o.onFail) o.onFail(dica + diag);
        });
    }
    function playNow() {
        try {
            const p = v.play();
            if (p && p.catch) p.catch(function (err) {
                if (stale() || finished) return;
                if (err && err.name === 'NotAllowedError') {
                    blocked = true;
                    clearTimeout(streamWatch);
                    if (o.onBlocked) o.onBlocked();
                }
            });
        } catch (e) {}
    }
    function arm(ms) {
        clearTimeout(streamWatch);
        streamWatch = setTimeout(function () {
            if (stale() || finished || blocked) return;
            if (hlsLike && !usingNative) goNative('tempo esgotado (hls)');
            else fail('tempo esgotado');
        }, ms);
    }
    function goNative(why) {
        if (stale() || finished || failed) return;
        if (why) lastErr = why;
        if (usingNative) { fail(lastErr); return; }
        usingNative = true;
        destroyHls();
        v.src = url;
        v.load();
        playNow();
        arm(o.quick ? 7000 : (hlsLike ? 15000 : 40000));
    }

    v.onplaying = ok;
    v.onerror = function () {
        if (stale() || finished) return;
        lastErr = 'video:' + (v.error ? v.error.code : '?');
        if (usingNative) fail(lastErr); else goNative(lastErr);
    };

    if (!hlsLike) { goNative(); return; }

    ensureHls(function () {
        if (stale()) return;
        if (!(window.Hls && Hls.isSupported())) { goNative('sem hls.js'); return; }
        const cfg = { enableWorker: !state.isAndroid, lowLatencyMode: false, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 2, fragLoadingMaxRetry: 3 };
        if (o.hlsConfig) for (const k in o.hlsConfig) cfg[k] = o.hlsConfig[k];
        const hls = new Hls(cfg);
        state.hls = hls;
        let netTries = 0, mediaTries = 0;
        hls.on(Hls.Events.MANIFEST_PARSED, playNow);
        hls.on(Hls.Events.ERROR, function (ev, d) {
            if (stale()) return;
            lastErr = (d.type || '') + '/' + (d.details || '');
            hlsErr = lastErr + (d.response && d.response.code ? '(' + d.response.code + ')' : '');
            if (!d.fatal) return;
            if (d.type === Hls.ErrorTypes.NETWORK_ERROR) {
                if (finished || netTries++ < 1) { try { hls.startLoad(); } catch (e) {} return; }
            } else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
                if (finished || mediaTries++ < 1) { try { hls.recoverMediaError(); } catch (e) {} return; }
            }
            if (!finished) goNative(lastErr);
        });
        hls.loadSource(url);
        hls.attachMedia(v);
        arm(o.quick ? 6000 : 12000);
    });
}

// Página https não pode abrir vídeo http (o navegador bloqueia). Então, quando o link do
// vídeo é http, tenta antes: (1) o mesmo caminho pelo servidor https do login, (2) o mesmo
// endereço em https. Se nenhum funcionar, mostra o erro com o diagnóstico.
function mixedCandidates(url) {
    if (location.protocol !== 'https:') return [];
    const isHttp = /^http:\/\//i.test(url);
    let base = '';
    if (state.api && state.api.base) base = state.api.base;
    else if (/\/get\.php\?/.test(state.m3uUrl || '')) base = String(state.m3uUrl).replace(/\/get\.php.*$/, '');
    const m = /^https?:\/\/[^\/]+(\/(?:live|movie|series)\/.+)$/i.exec(url);
    const list = [];
    // 1) mesmo caminho pelo servidor https do login (serve para link http E para link https de outro endereço)
    if (m && /^https:\/\//i.test(base)) {
        const viaBase = base.replace(/\/+$/, '') + m[1];
        if (viaBase !== url) list.push({ k: 'servidor', u: viaBase });
    }
    // 2) link http: tenta o mesmo endereço em https
    if (isHttp) list.push({ k: 'https', u: url.replace(/^http:/i, 'https:') });
    if (!state.mixedPref) { try { state.mixedPref = localStorage.getItem('iptv_mixed_pref') || null; } catch (e) {} }
    if (state.mixedPref) list.sort(function (a, b) { return (a.k === state.mixedPref ? -1 : 0) - (b.k === state.mixedPref ? -1 : 0); });
    return list;
}

function loadStream(url, opts) {
    const o = opts || {};
    const cands = mixedCandidates(url);
    if (!cands.length) { loadStreamOne(url, o); return; }
    let i = 0;
    const tried = [];
    function copy(extra) {
        const c = {};
        for (const k in o) c[k] = o[k];
        for (const k in extra) c[k] = extra[k];
        return c;
    }
    function tryNext(why) {
        if (i > 0) tried.push(cands[i - 1].k + '=' + (why || '?'));
        if (i >= cands.length) { loadStreamOne(url, copy({ tried: tried.join(' ') })); return; }   // último: mostra o diagnóstico
        const c = cands[i++];
        loadStreamOne(c.u, copy({
            quick: true,
            onFail: tryNext,
            onPlaying: function () { state.mixedPref = c.k; try { localStorage.setItem('iptv_mixed_pref', c.k); } catch (e) {} if (o.onPlaying) o.onPlaying(); }
        }));
    }
    tryNext();
}


// Troca .ts por .m3u8 em links de canal ao vivo (o player só entende HLS)
function toHlsUrl(url) {
    const m = String(url).match(/^(https?:\/\/[^\/]+(?:\/live)?\/[^\/]+\/[^\/]+\/\d+)\.ts(\?.*)?$/i);
    return m ? m[1] + '.m3u8' + (m[2] || '') : url;
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
    uiTimer: null, iconTimer: null, lastSave: 0, seekRepeat: 0, resumeAt: 0, playUrl: null, openToken: 0
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

/* ---------- capas: tenta https, link original e proxy de imagens ---------- */
function imgCandidates(u) {
    u = String(u || '').trim();
    if (!u) return [];
    if (u.indexOf('//') === 0) u = 'https:' + u;
    const out = [];
    const isHttp = /^http:\/\//i.test(u);
    if (isHttp && location.protocol === 'https:') { out.push(u.replace(/^http:/i, 'https:')); out.push(u); }
    else out.push(u);
    out.push('https://images.weserv.nl/?url=' + encodeURIComponent(u.replace(/^https?:\/\//i, '')));
    return out;
}
function imgFirst(u) { const l = imgCandidates(u); return l.length ? l[0] : ''; }
function imgFail(img) {
    const l = imgCandidates(img.getAttribute('data-u'));
    const n = (parseInt(img.getAttribute('data-n'), 10) || 0) + 1;
    if (n < l.length) { img.setAttribute('data-n', n); img.src = l[n]; }
    else if (img.parentNode) img.parentNode.removeChild(img);
}
window.imgFail = imgFail;
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
        if (set.cards) {
            set.cards.forEach(function (c) { vod.cards.push(c); vod.byKey[c.key] = c; });
            return;
        }
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

    vod.cards.forEach(function (c) {
        if (isAdultText(c.title) && !isAdultText(c.group)) c.group = ADULT_FOLDER;
    });
    vod.folders = [];
    vod.cards.forEach(function (c) { if (vod.folders.indexOf(c.group) === -1) vod.folders.push(c.group); });
    vod.folders = vod.folders.filter(function (f) { return !isAdultText(f); })
        .concat(vod.folders.filter(function (f) { return isAdultText(f); }));
    vod.cats = [{ id: '__all', label: 'Todos' }, { id: '__fav', label: 'Favoritos' }]
        .concat(vod.folders.map(function (f) { return { id: f, label: f }; }));
}

function getCatList(id) {
    const open = function (c) { return !isAdultLocked(c.group); };
    if (id === '__all') return adultUnlocked ? vod.cards : vod.cards.filter(open);
    if (id === '__fav') return lsGet(favKey(), []).map(function (k) { return vod.byKey[k]; }).filter(Boolean).filter(open);
    if (id === '__hist') return lsGet(histKey(), []).map(function (k) { return vod.byKey[k]; }).filter(Boolean).filter(open);
    if (isAdultLocked(id)) return [];
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
    const all = state.parsed.all;
    const sets = [
        { kind: 'movies', channels: all.movies },
        { kind: 'series', channels: all.series }
    ];
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
    v.addEventListener('error', function () {
        vodSpin(false);
        if (state.vodActive && vod.playUrl) vodMsg('Não foi possível reproduzir este título. O formato pode não ser compatível com este aparelho.', 6000);
    });

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
                return '<div class="vod-cat" data-z="cats" data-i="' + i + '">' + esc(c.label) + (isAdultLocked(c.id) ? LOCK_ICON : '') + '</div>';
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

function vodUnlockCat() {
    askAdultPin(function () {
        const items = document.querySelectorAll('.vod-cat');
        vod.cats.forEach(function (c, i) {
            if (items[i]) items[i].textContent = c.label + (isAdultLocked(c.id) ? LOCK_ICON : '');
        });
        vod.list = getCatList(vod.catId);
        vod.shown = GRID_STEP;
        renderGrid();
        markCat();
        if (vod.list.length) { vod.zone = 'grid'; vod.idx = 0; } else { vod.zone = 'cats'; vod.idx = vod.catIndex; }
        applyFocus();
    });
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
          (c.logo ? '<img src="' + esc(imgFirst(c.logo)) + '" data-u="' + esc(c.logo) + '" referrerpolicy="no-referrer" onerror="imgFail(this)">' : '') +
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
    if (isAdultLocked(vod.catId)) return 'Conteúdo adulto bloqueado. Aperte OK e digite a senha.';
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
            if (isAdultLocked(c.group)) return false;
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

    // Categoria adulta bloqueada: OK ou seta para a direita pede a senha
    if (vod.zone === 'cats' && (k === 'ArrowRight' || k === 'Enter') && isAdultLocked(vod.catId)) {
        flushCat();
        vodUnlockCat();
        return;
    }

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
    vod.openToken++;
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
    // Lista de filmes/séries (ou categorias): Voltar vai direto para a tela inicial
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
    if (card.kind === 'series' && card.lazy && !card.loaded) {
        const token = ++vod.openToken;
        vodSpin(true);
        loadSeriesEpisodes(card).catch(function () { return false; }).then(function (ok) {
            vodSpin(false);
            if (token !== vod.openToken) return;
            if (!ok) { vodMsg('Não foi possível carregar os episódios desta série.'); return; }
            vodOpenDetail(card, pushCurrent);
        });
        return;
    }
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

function pad2(n) { n = parseInt(n, 10) || 0; return (n < 10 ? '0' : '') + n; }

function metaRowHtml(id, label, val) {
    return '<p id="' + id + '" class="vod-row-meta"' + (val ? '' : ' style="display:none"') + '><span>' + label + ':</span><b>' + esc(val || '') + '</b></p>';
}
function setMetaRow(id, val) {
    const p = $v(id);
    if (!p) return;
    const b = p.querySelector('b');
    if (val) { if (b) b.textContent = String(val); p.style.display = ''; }
    else p.style.display = 'none';
}
function fmtNota(n) {
    const x = Number(n);
    if (!isFinite(x) || x <= 0) return '';
    return String(Math.round(x * 10) / 10);
}

function renderDetail() {
    const c = vod.card;
    const isSeries = c.kind === 'series';
    const nSeasons = isSeries ? seasonsList().length : 0;
    const info =
        metaRowHtml('vod-m-dir', 'Diretor', c.director) +
        metaRowHtml('vod-m-cast', 'Estrelando', c.cast) +
        metaRowHtml('vod-m-tipo', 'Tipo', c.genre || c.group) +
        metaRowHtml('vod-m-nota', 'Avaliação', fmtNota(parseRating(c.rating))) +
        metaRowHtml('vod-m-data', 'Tempo de lançamento', c.releaseDate) +
        metaRowHtml('vod-m-dur', 'Longitude do filme', isSeries ? (nSeasons + (nSeasons === 1 ? ' Temporada' : ' Temporadas')) : (c.duration || ''));

    $v('vod-root').innerHTML =
        '<div class="vod-detail-bg" style="background-image:url(\'' + esc(imgFirst(c.logo)) + '\')"></div>' +
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
            '<div class="vod-row vod-row-seasons" id="vod-seasons"></div>' +
            '<div class="vod-row vod-row-eps" id="vod-eps"></div>' : '') +
          '<div class="vod-h">Introduzir</div>' +
          '<div class="vod-syn" id="vod-syn">Carregando...</div>' +
          (vod.related.length ? '<div class="vod-h">Recomendações relacionadas</div><div class="vod-rel" id="vod-rel">' +
            vod.related.map(function (r, i) { return cardHtml(r, i, 'rel'); }).join('') + '</div>' : '') +
        '</div>';

    if (isSeries) { renderSeasons(); renderEps(); updateNow(); }
    const d = $v('vod-detail');
    if (d) d.addEventListener('scroll', positionWin);
}

function renderSeasons() {
    $v('vod-seasons').innerHTML = seasonsList().map(function (s, i) {
        return '<div class="vod-chip vod-chip-season' + (s === vod.season ? ' sel' : '') + '" data-z="seasons" data-i="' + i + '">S' + pad2(s) + '</div>';
    }).join('');
}
function renderEps() {
    $v('vod-eps').innerHTML = epsOfSeason().map(function (e, i) {
        const playing = e.url === vod.epUrl;
        return '<div class="vod-chip vod-chip-ep' + (playing ? ' sel' : '') + '" data-z="eps" data-i="' + i + '">' +
               (playing ? '<i class="vod-eq"><b></b><b></b><b></b></i>' : '') + 'EP' + pad2(e.ep) + '</div>';
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
    if (card.plot) {
        fillMeta(card, { overview: card.plot, nota: parseRating(card.rating), data: card.releaseDate, director: card.director, cast: card.cast, genre: card.genre });
        return;
    }
    if (state.api && card.kind === 'movie' && card.vodId != null) {
        if (vod.metaCache[card.key]) { fillMeta(card, vod.metaCache[card.key]); return; }
        apiJson('get_vod_info', '&vod_id=' + enc(card.vodId), 20000).then(function (d) {
            const i = (d && d.info) || {};
            const m = {
                overview: i.plot || i.description || '', nota: parseRating(i.rating || i.rating_5based * 2),
                data: i.releasedate || i.release_date || '',
                director: i.director || '', cast: i.cast || i.actors || '', genre: i.genre || '',
                duration: i.duration || (i.episode_run_time ? i.episode_run_time + ' min' : '')
            };
            vod.metaCache[card.key] = m;
            if (vod.card === card) fillMeta(card, m);
        }).catch(function () {
            if (vod.card === card && $v('vod-syn')) $v('vod-syn').textContent = 'Sinopse não disponível para este título.';
        });
        return;
    }
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
    if (m.director) setMetaRow('vod-m-dir', m.director);
    if (m.cast) setMetaRow('vod-m-cast', m.cast);
    if (m.genre) setMetaRow('vod-m-tipo', m.genre);
    if (m.nota) setMetaRow('vod-m-nota', fmtNota(m.nota));
    if (m.data) setMetaRow('vod-m-data', m.data);
    if (card.kind !== 'series' && m.duration) setMetaRow('vod-m-dur', m.duration);
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
    // r vem em pixels da tela real; converte para a tela fixa 1280x720
    const k = stage.s || 1;
    const css = 'left:' + ((r.left - stage.x) / k) + 'px;top:' + ((r.top - stage.y) / k) + 'px;width:' + (r.width / k) + 'px;height:' + (r.height / k) + 'px;' + (vis ? '' : 'visibility:hidden;');
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
    vodSpin(true);
    loadStream(url, {
        live: false,
        onPlaying: function () { vodSpin(false); },
        onBlocked: function () { vodSpin(false); },
        onFail: function (why) {
            vodSpin(false);
            vodMsg('Não foi possível reproduzir este título' + (why ? ' (' + why + ')' : '') + '. O formato pode não ser compatível com este aparelho.', 7000);
        }
    });
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
    stopStream();
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
        case 'ArrowDown': case 'ArrowUp':
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
        if (ch && !isAdultLocked(ch.folder)) list.push(ch);
    });
    state.channelsByFolder[FAV_FOLDER] = list;
}

function buildTvFavFolder() {
    if (state.selectedCategory !== 'tv') return;
    FAV_FOLDER = state.folders.indexOf('Favoritos') !== -1 ? 'Meus Favoritos' : 'Favoritos';
    state.folders.unshift(FAV_FOLDER);
    refreshTvFavList();
    // "Canais de A a Z" (todos os canais em ordem alfabética) e "Pesquisar" no topo
    state.channelsByFolder[ALL_FOLDER] = state.channels.filter(function (c) { return !isAdultLocked(c.folder); })
        .slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'pt', { numeric: true, sensitivity: 'base' }); });
    state.channelsByFolder[SEARCH_FOLDER] = [];
    const fi = state.folders.indexOf(FAV_FOLDER);
    state.folders.splice(fi + 1, 0, ALL_FOLDER);
    state.folders.unshift(SEARCH_FOLDER);
}

/* ---------- pesquisa de canais ---------- */
function chNorm(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
let chSearchInp = null;
function chSearchOpen() {
    if (!chSearchInp) {
        chSearchInp = document.createElement('input');
        chSearchInp.id = 'ch-search';
        LK_NAMES['ch-search'] = 'Pesquisar canal';
    }
    lkOpen(chSearchInp);
    lkText();
}
function chSearchApply(q) {
    q = chNorm(q).trim();
    state.channelsByFolder[SEARCH_FOLDER] = q ? state.channels.filter(function (c) {
        return !isAdultLocked(c.folder) && chNorm(c.name).indexOf(q) !== -1;
    }) : [];
    if (state.folders[state.selectedFolderIndex] === SEARCH_FOLDER) {
        el.currentFolderTitle.textContent = SEARCH_FOLDER + ' < ' + state.channelsByFolder[SEARCH_FOLDER].length + ' >';
        renderChannels(SEARCH_FOLDER);
    }
}
function chSearchDone() {
    if ((state.channelsByFolder[SEARCH_FOLDER] || []).length) {
        state.activeColumn = 'channels';
        state.focusedChannelIndex = 0;
    }
    updateFocusDOM();
}
const _lkCloseOrig = lkClose;
lkClose = function () {
    const was = lk.open && lk.inp && lk.inp.id === 'ch-search';
    _lkCloseOrig();
    if (was) chSearchDone();
};

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
    state.enterAt = Date.now();
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
        // só toca/fecha se o OK foi mesmo em cima de um canal (evita fechar a grade ao abrir o EPG)
        if (!state.isMenuVisible || state.activeColumn !== 'channels') return;
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
        if (z === 'cats') { setCat(i); flushCat(); if (isAdultLocked(vod.catId)) vodUnlockCat(); }
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
