// Owlfin - JellyTok
// Feed verticale a schermo intero di trailer, stile TikTok.
//   Libreria  - titoli casuali presenti sul server, a blocchi di 20
//   Richiedi  - titoli di tendenza non ancora presenti, richiedibili via Seerr
// Voce nel menu laterale, X in alto per chiudere.
(function () {
    'use strict';
    if (window.__owlfinJellytokLoaded) return;
    window.__owlfinJellytokLoaded = true;

    var BLOCK = 20;            // titoli per blocco (libreria)
    var PREFETCH_AT = 5;       // con 5 titoli rimasti (cioe' al 15°) parte il blocco successivo
    var CACHE_PREFIX = 'owlfin_jellytok_trailer_v3_';
    var PREFS_KEY = 'owlfin_jellytok_prefs_v1';
    var NONE = '__NONE__';
    var FIELDS = 'Overview,Genres,ProviderIds,RemoteTrailers';
    var TMDB_IMG = 'https://image.tmdb.org/t/p/';

    // ---------- testi ----------
    var LANG = ((navigator.language || 'it').split('-')[0] === 'it') ? 'it' : 'en';
    var STR = {
        it: {
            menu: 'Scopri', title: 'Scopri', tabLib: 'Libreria', tabReq: 'Richiedi',
            all: 'Tutti', movies: 'Film', series: 'Serie TV', typeMovie: 'Film', typeTv: 'Serie TV', notInLib: 'Non sul server',
            watch: 'Guarda', request: 'Richiedi', requesting: 'Invio…', requested: 'Richiesto',
            st2: 'Richiesto', st3: 'In lavorazione', st4: 'Parziale',
            loading: 'Carico i titoli…', emptyLib: 'Nessun titolo trovato nella libreria.',
            emptyReq: 'Nessun titolo da richiedere al momento.', noTrailer: 'Trailer non disponibile',
            close: 'Chiudi', sound: 'Audio', fav: 'Aggiungi ai preferiti', unfav: 'Rimuovi dai preferiti',
            swipe: 'Scorri', reqOk: 'Richiesta inviata a Seerr', reqFail: 'Richiesta non riuscita, riprova tra poco',
            audioBlocked: 'Audio bloccato dal sistema, resta disattivato', tapPlay: 'Tocca per avviare',
            setupTitle: 'Collega Seerr',
            setupBody: 'Per richiedere film e serie che non sono ancora sul server inserisci URL e API key di Seerr in Dashboard → Plugin → Owlfin → Credenziali API.',
            errTitle: 'Seerr non raggiungibile',
            errBody: 'Controlla URL e API key di Seerr nelle impostazioni del plugin e che il server sia acceso.',
            goLib: 'Vai alla libreria'
        },
        en: {
            menu: 'Discover', title: 'Discover', tabLib: 'Library', tabReq: 'Request',
            all: 'All', movies: 'Movies', series: 'Series', typeMovie: 'Movie', typeTv: 'Series', notInLib: 'Not on server',
            watch: 'Watch', request: 'Request', requesting: 'Sending…', requested: 'Requested',
            st2: 'Requested', st3: 'Processing', st4: 'Partial',
            loading: 'Loading titles…', emptyLib: 'No titles found in the library.',
            emptyReq: 'Nothing to request right now.', noTrailer: 'Trailer not available',
            close: 'Close', sound: 'Sound', fav: 'Add to favorites', unfav: 'Remove from favorites',
            swipe: 'Swipe', reqOk: 'Request sent to Seerr', reqFail: 'Request failed, try again soon',
            audioBlocked: 'Sound blocked by the system, staying muted', tapPlay: 'Tap to play',
            setupTitle: 'Connect Seerr',
            setupBody: 'To request movies and shows that are not on the server yet, enter your Seerr URL and API key in Dashboard → Plugins → Owlfin → API credentials.',
            errTitle: 'Seerr unreachable',
            errBody: 'Check the Seerr URL and API key in the plugin settings and that the server is running.',
            goLib: 'Go to library'
        }
    };
    function L(k) { return STR[LANG][k] || k; }

    // ---------- stato ----------
    var prefs = loadPrefs();            // { mode:'lib'|'req', kind:'all'|'Movie'|'Series', hinted }
    var wantSound = false;              // solo per la sessione: si parte sempre muti (l'autoplay con audio e' bloccato su mobile)
    var seerrOk = null;                 // null = non verificato
    var seerrErr = null;                // null oppure testo dell'errore (HTTP xxx / rete)
    var libIds = null, libType = {}, libAt = 0;
    var libPool = [], libCursor = 0, libSeen = {};
    var reqPage = 0, reqTotal = 1, reqSeen = {};
    var loading = false;
    var cards = [];
    var active = null;
    var observer = null;
    var overlay = null, feed = null, tabsEl = null, chipsEl = null, soundBtn = null, toastEl = null;
    var openState = false;
    var sessionToken = 0;
    var lastErr = '';
    var inflight = {};

    // ---------- util ----------
    function api() { return window.ApiClient || null; }
    function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
    function loadPrefs() {
        var p = { mode: 'lib', kind: 'all', hinted: false };
        try { var s = JSON.parse(lsGet(PREFS_KEY) || '{}'); for (var k in p) if (s[k] !== undefined) p[k] = s[k]; } catch (e) { /* ignore */ }
        return p;
    }
    function savePrefs() { lsSet(PREFS_KEY, JSON.stringify(prefs)); }
    function errMsg(e) { return (e && (e.message || e.status)) || String(e); }
    function errCode(e) { return (e && e.status) ? 'HTTP ' + e.status : 'rete'; }
    function preload(url) { if (url) { var i = new Image(); i.decoding = 'async'; i.src = url; } }
    function fmtRuntime(m) { if (!m) return ''; return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60 ? (m % 60) + 'm' : '') : m + ' min'; }

    // Chiamata autenticata verso gli endpoint del plugin (Owlfin/...).
    function jf(path, opts) {
        var c = api();
        opts = opts || {};
        var tok = c && c.accessToken ? c.accessToken() : '';
        var h = { 'Authorization': 'MediaBrowser Token="' + tok + '"', 'X-Emby-Token': tok };
        if (opts.body) h['Content-Type'] = 'application/json';
        return fetch(c.getUrl(path), { method: opts.method || 'GET', headers: h, body: opts.body }).then(function (r) {
            if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
            return r.json();
        });
    }

    function imgUrl(item, type, w) {
        var c = api();
        if (!c) return '';
        var tag = type === 'Backdrop'
            ? (item.BackdropImageTags && item.BackdropImageTags[0])
            : (item.ImageTags && item.ImageTags.Primary);
        if (!tag) return '';
        return c.getUrl('Items/' + item.Id + '/Images/' + type, { maxWidth: w, tag: tag, quality: 80 });
    }

    // ---------- dati: libreria ----------
    function fetchAllIds() {
        if (libIds && Date.now() - libAt < 300000) return Promise.resolve(libIds);
        var c = api();
        var uid = c.getCurrentUserId();
        function take(r) {
            var arr = (r && r.Items) ? r.Items : (Array.isArray(r) ? r : []);
            arr.forEach(function (i) { if (i && i.Id) libType[i.Id] = i.Type; });
            return arr.map(function (i) { return i.Id; }).filter(Boolean);
        }
        return Promise.resolve(c.getItems(uid, { IncludeItemTypes: 'Movie,Series', Recursive: true, SortBy: 'Random', Limit: 5000 }))
            .then(take)
            .catch(function (e) {
                lastErr = 'ids: ' + errMsg(e);
                return Promise.resolve(c.getItems(uid, { IncludeItemTypes: 'Movie,Series', Recursive: true })).then(take);
            })
            .then(function (list) { libIds = list; libAt = Date.now(); return list; });
    }

    function buildLibPool() {
        var want = prefs.kind === 'all' ? null : prefs.kind;
        var list = (libIds || []).filter(function (id) { return !want || libType[id] === want; });
        shuffle(list);
        // prima i titoli non ancora visti in questa sessione
        var fresh = list.filter(function (id) { return !libSeen[id]; });
        var seen = list.filter(function (id) { return libSeen[id]; });
        libPool = fresh.concat(seen);
        libCursor = 0;
    }

    function fetchItems(list) {
        var c = api();
        var uid = c.getCurrentUserId();
        function ordered(r) {
            var map = {};
            ((r && r.Items) || []).forEach(function (i) { map[i.Id] = i; });
            return list.map(function (id) { return map[id]; }).filter(Boolean);
        }
        return Promise.resolve(c.getItems(uid, { Ids: list.join(','), Fields: FIELDS }))
            .then(ordered)
            .catch(function (e) {
                lastErr = 'items: ' + errMsg(e);
                return Promise.resolve(c.getItems(uid, { Ids: list.join(',') })).then(ordered);
            });
    }

    function normalizeLib(item) {
        var tmdb = item.ProviderIds && (item.ProviderIds.Tmdb || item.ProviderIds.tmdb);
        return {
            src: 'lib', key: item.Id, itemId: item.Id, serverId: item.ServerId,
            type: item.Type === 'Series' ? 'tv' : 'movie',
            title: item.Name || '', year: item.ProductionYear || null,
            rating: item.CommunityRating || null,
            minutes: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 600000000) : null,
            genres: (item.Genres || []).slice(0, 3), overview: item.Overview || '',
            amb: imgUrl(item, 'Primary', 64) || imgUrl(item, 'Backdrop', 96),
            poster: imgUrl(item, 'Primary', 240),
            still: imgUrl(item, 'Backdrop', 780) || imgUrl(item, 'Primary', 500),
            fav: !!(item.UserData && item.UserData.IsFavorite),
            tmdbId: tmdb || null, remote: item.RemoteTrailers || [], status: 0, raw: item
        };
    }

    // ---------- dati: richieste (Seerr) ----------
    function checkSeerr() {
        if (seerrOk === true) return Promise.resolve(true);
        return jf('Owlfin/Seerr/Status')
            .then(function (r) { seerrOk = !!(r && r.enabled); seerrErr = null; return seerrOk; })
            .catch(function (e) { seerrOk = false; seerrErr = errCode(e); return false; });
    }

    function normalizeReq(x) {
        var year = x.date ? parseInt(String(x.date).slice(0, 4), 10) : null;
        return {
            src: 'req', key: 't-' + x.mediaType + '-' + x.id, itemId: null, serverId: null,
            type: x.mediaType, title: x.title || '', year: year || null,
            rating: x.rating && x.rating > 0 ? x.rating : null, minutes: null, genres: [],
            overview: x.overview || '',
            amb: x.poster ? TMDB_IMG + 'w92' + x.poster : (x.backdrop ? TMDB_IMG + 'w300' + x.backdrop : ''),
            poster: x.poster ? TMDB_IMG + 'w185' + x.poster : '',
            still: x.backdrop ? TMDB_IMG + 'w780' + x.backdrop : (x.poster ? TMDB_IMG + 'w500' + x.poster : ''),
            fav: false, tmdbId: x.id, remote: [], status: x.status || 0
        };
    }

    // ---------- trailer ----------
    function ytIdFromUrl(u) {
        if (!u) return null;
        var m = String(u).match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
        return m ? m[1] : null;
    }

    function pickTmdbVideos(results) {
        var yt = (results || []).filter(function (v) { return v.site === 'YouTube' && v.key; });
        function rank(v) { return (v.type === 'Trailer' ? 0 : 2) + (v.official ? 0 : 1); }
        return yt.filter(function (v) { return v.type === 'Trailer' || v.type === 'Teaser'; })
            .sort(function (x, y) { return rank(x) - rank(y); })
            .map(function (v) { return v.key; });
    }

    function tmdbGet(path, params) {
        var q = 'api_key=' + encodeURIComponent(window.__owlfin_tmdb_key__);
        Object.keys(params || {}).forEach(function (k) { if (params[k] != null && params[k] !== '') q += '&' + k + '=' + encodeURIComponent(params[k]); });
        return fetch('https://api.themoviedb.org/3/' + path + '?' + q)
            .then(function (r) { if (!r.ok) throw new Error('TMDB ' + r.status); return r.json(); });
    }

    function tmdbVideos(kind, tmdbId) {
        var lang = LANG === 'it' ? 'it-IT' : 'en-US';
        return tmdbGet(kind + '/' + tmdbId + '/videos', { language: lang }).then(function (j) {
            var l = pickTmdbVideos(j.results);
            if (l.length) return l;
            return tmdbGet(kind + '/' + tmdbId + '/videos', {}).then(function (j2) { return pickTmdbVideos(j2.results); });
        });
    }

    function tmdbFindId(kind, e) {
        var params = { query: e.title, language: LANG === 'it' ? 'it-IT' : 'en-US' };
        if (e.year) params[kind === 'tv' ? 'first_air_date_year' : 'year'] = e.year;
        return tmdbGet('search/' + kind, params).then(function (j) { return (j.results && j.results[0]) ? j.results[0].id : null; });
    }

    // Promise<string[]> di ID YouTube candidati; vuota = nessun trailer.
    // Solo i veri "nessun trailer" finiscono in cache, mai gli errori o i dati mancanti.
    function getTrailer(e) {
        var ck = CACHE_PREFIX + e.key;
        var cached = lsGet(ck);
        if (cached) return Promise.resolve(cached === NONE ? [] : cached.split(','));
        if (inflight[e.key]) return inflight[e.key];

        var keys = [];
        (e.remote || []).forEach(function (t) { var k = ytIdFromUrl(t.Url); if (k && keys.indexOf(k) < 0) keys.push(k); });

        var pr;
        if (keys.length) {
            pr = Promise.resolve(keys);
        } else if (window.__owlfin_tmdb_key__) {
            pr = (e.tmdbId ? Promise.resolve(e.tmdbId) : tmdbFindId(e.type, e))
                .then(function (id) { return id ? tmdbVideos(e.type, id) : []; })
                .catch(function (err) { lastErr = 'tmdb: ' + errMsg(err); return null; });
        } else if (e.src === 'req' && e.tmdbId) {
            pr = jf('Owlfin/Seerr/Videos?kind=' + e.type + '&id=' + e.tmdbId + '&lang=' + LANG)
                .then(function (r) { return (r && r.keys) || []; })
                .catch(function (err) { lastErr = 'seerr: ' + errMsg(err); return null; });
        } else {
            pr = Promise.resolve(null);
        }
        inflight[e.key] = pr.then(function (res) {
            delete inflight[e.key];
            if (res === null) return [];
            lsSet(ck, res.length ? res.join(',') : NONE);
            return res;
        });
        return inflight[e.key];
    }

    // ---------- stile ----------
    function injectCSS() {
        if (document.getElementById('owlfin-jt-css')) return;
        var s = document.createElement('style');
        s.id = 'owlfin-jt-css';
        s.textContent = [
            '#owlfin-jt{--jt-accent:#00a4dc;--jt-ink:#0b0d10;--jt-text:#f5f2ed;--jt-dim:rgba(245,242,237,.74);--jt-glass:rgba(20,23,28,.62);--jt-line:rgba(245,242,237,.16);',
            'position:fixed;inset:0;z-index:100000;background:var(--jt-ink);color:var(--jt-text);display:none;font-family:inherit;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent;}',
            '#owlfin-jt.jt-open{display:block;}',
            'html.jt-lock,html.jt-lock body{overflow:hidden!important;}',
            /* reset a specificita' zero: le classi sotto devono poterlo sempre battere */
            ':where(#owlfin-jt) button{font-family:inherit;color:inherit;cursor:pointer;border:0;background:none;padding:0;margin:0;-webkit-appearance:none;appearance:none;}',
            '#owlfin-jt button:focus-visible{outline:2px solid var(--jt-accent);outline-offset:2px;}',
            '#owlfin-jt-feed{height:100%;overflow-y:scroll;scroll-snap-type:y mandatory;overscroll-behavior:contain;scrollbar-width:none;-webkit-overflow-scrolling:touch;}',
            '#owlfin-jt-feed::-webkit-scrollbar{display:none;}',

            /* barra superiore */
            '.jt-bar{position:absolute;top:0;left:0;right:0;z-index:6;padding:calc(env(safe-area-inset-top) + 12px) 14px 30px;pointer-events:none;background:linear-gradient(to bottom,rgba(11,13,16,.92),rgba(11,13,16,.55) 55%,rgba(11,13,16,0));}',
            '.jt-row{display:flex;align-items:center;gap:10px;}',
            '.jt-spacer{flex:1;}',
            '.jt-tabs{display:flex;padding:4px;border-radius:999px;background:var(--jt-glass);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);box-shadow:inset 0 0 0 1px var(--jt-line);pointer-events:auto;}',
            '.jt-tab{padding:10px 19px;border-radius:999px;font-size:.93rem;font-weight:650;line-height:1;letter-spacing:.005em;color:var(--jt-dim);transition:background .25s,color .25s;}',
            '.jt-tab.jt-on{background:var(--jt-text);color:var(--jt-ink);}',
            '.jt-round{pointer-events:auto;width:42px;height:42px;border-radius:50%;background:var(--jt-glass)!important;-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);box-shadow:inset 0 0 0 1px var(--jt-line);display:flex;align-items:center;justify-content:center;transition:transform .15s;}',
            '.jt-round:active{transform:scale(.92);}',
            '.jt-round .material-icons{font-size:1.35rem;}',
            '.jt-chips{display:flex;gap:8px;margin-top:14px;pointer-events:auto;overflow-x:auto;scrollbar-width:none;}',
            '.jt-chips::-webkit-scrollbar{display:none;}',
            '.jt-chip{flex:none;padding:8px 16px;border-radius:999px;font-size:.83rem;font-weight:650;line-height:1;color:var(--jt-dim);background:rgba(245,242,237,.07);box-shadow:inset 0 0 0 1px var(--jt-line);transition:background .2s,color .2s;}',
            '.jt-chip.jt-on{background:var(--jt-accent);color:#031821;box-shadow:none;}',

            /* scheda */
            '.jt-card{position:relative;height:100vh;height:100dvh;scroll-snap-align:start;scroll-snap-stop:always;overflow:hidden;contain:layout paint;}',
            '.jt-amb{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scale(1.2);opacity:.6;filter:saturate(1.5);}',
            '.jt-scrim{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(11,13,16,.5),rgba(11,13,16,.8) 45%,rgba(11,13,16,.96));}',
            '.jt-main{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:22px;padding:calc(env(safe-area-inset-top) + 124px) 16px calc(env(safe-area-inset-bottom) + 28px);}',
            '.jt-stage{position:relative;width:100%;aspect-ratio:16/9;border-radius:18px;overflow:hidden;background:#000;box-shadow:0 30px 60px -22px rgba(0,0,0,.95),0 0 0 1px rgba(245,242,237,.1);flex-shrink:0;}',
            '.jt-still{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}',
            '.jt-stage iframe{position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none;opacity:0;transition:opacity .45s;}',
            '.jt-stage iframe.jt-ready{opacity:1;}',
            '.jt-stage iframe.jt-tap{pointer-events:auto;opacity:1;}',
            '.jt-spin{width:28px;height:28px;border-radius:50%;border:3px solid rgba(245,242,237,.22);border-top-color:var(--jt-text);animation:jt-spin .8s linear infinite;}',
            '.jt-loader{position:absolute;left:50%;top:50%;margin:-14px 0 0 -14px;transition:opacity .3s;}',
            '.jt-loader.jt-off{opacity:0;}',
            '@keyframes jt-spin{to{transform:rotate(360deg);}}',
            '.jt-prog{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(245,242,237,.16);}',
            '.jt-prog i{display:block;height:100%;background:var(--jt-accent);transform:scaleX(0);transform-origin:0 50%;transition:transform .3s linear;}',
            '.jt-note{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);padding:7px 14px;border-radius:999px;background:var(--jt-glass);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);font-size:.8rem;font-weight:600;color:var(--jt-text);white-space:nowrap;pointer-events:none;}',
            '.jt-flash{position:absolute;left:50%;top:50%;width:66px;height:66px;margin:-33px 0 0 -33px;border-radius:50%;background:rgba(11,13,16,.55);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;}',
            '.jt-flash .material-icons{font-size:2rem;}',
            '.jt-flash.jt-go{animation:jt-flash .65s ease-out;}',
            '.jt-flash.jt-hold{opacity:1;}',
            '@keyframes jt-flash{0%{opacity:0;transform:scale(.7)}30%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1.12)}}',
            '.jt-burst{position:absolute;width:84px;height:84px;margin:-42px 0 0 -42px;pointer-events:none;color:#ff4d6d;animation:jt-pop .75s ease-out forwards;}',
            '.jt-burst .material-icons{font-size:84px;}',
            '@keyframes jt-pop{0%{transform:scale(.3);opacity:0}25%{transform:scale(1.15);opacity:1}60%{transform:scale(1);opacity:1}100%{transform:scale(1.2) translateY(-24px);opacity:0}}',

            /* informazioni */
            '.jt-info{max-width:640px;}',
            '.jt-info>*{opacity:0;transform:translateY(14px);transition:opacity .5s ease,transform .55s cubic-bezier(.2,.8,.2,1);}',
            '.jt-card.jt-on .jt-info>*{opacity:1;transform:none;}',
            '.jt-card.jt-on .jt-info>:nth-child(2){transition-delay:.05s;}',
            '.jt-card.jt-on .jt-info>:nth-child(3){transition-delay:.1s;}',
            '.jt-card.jt-on .jt-info>:nth-child(4){transition-delay:.15s;}',
            '.jt-head{display:flex;align-items:flex-end;gap:14px;margin-bottom:14px;}',
            '.jt-poster{flex:none;width:76px;aspect-ratio:2/3;border-radius:10px;object-fit:cover;background:rgba(245,242,237,.08);box-shadow:0 12px 26px -8px rgba(0,0,0,.85),0 0 0 1px rgba(245,242,237,.14);}',
            '.jt-headtxt{min-width:0;flex:1;}',
            '.jt-kicker{margin-bottom:6px;font-size:.72rem;font-weight:750;letter-spacing:.13em;text-transform:uppercase;color:var(--jt-accent);}',
            '.jt-title{margin:0 0 9px;font-size:clamp(1.4rem,5.6vw,2.3rem);line-height:1.1;font-weight:800;letter-spacing:-.02em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-shadow:0 2px 14px rgba(0,0,0,.5);}',
            '.jt-facts{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;font-size:.88rem;color:var(--jt-dim);}',
            '.jt-rate{display:inline-flex;align-items:center;gap:3px;padding:3px 9px 3px 7px;border-radius:7px;background:rgba(245,242,237,.14);color:var(--jt-text);font-weight:700;}',
            '.jt-rate .material-icons{font-size:.95rem;color:#f5c518;}',
            '.jt-gen{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;}',
            '.jt-gen span{padding:4px 11px;border-radius:999px;font-size:.78rem;font-weight:550;box-shadow:inset 0 0 0 1px rgba(245,242,237,.26);color:var(--jt-text);}',
            '.jt-ov{margin:0 0 18px;font-size:.93rem;line-height:1.55;color:var(--jt-dim);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;cursor:pointer;}',
            '.jt-ov.jt-more{-webkit-line-clamp:unset;max-height:28vh;overflow-y:auto;}',
            '.jt-actions{display:flex;align-items:center;gap:10px;}',
            '.jt-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:50px;padding:0 28px;border-radius:999px;font-size:1rem;font-weight:700;line-height:1;white-space:nowrap;transition:transform .15s,opacity .2s;}',
            '.jt-btn:active{transform:scale(.97);}',
            '.jt-btn.jt-main-btn{background:var(--jt-text)!important;color:var(--jt-ink)!important;flex:1;max-width:250px;}',
            '.jt-btn.jt-req-btn{background:var(--jt-accent)!important;color:#031821!important;flex:1;max-width:250px;}',
            '.jt-btn[disabled]{opacity:.62;cursor:default;}',
            '.jt-btn .material-icons{font-size:1.35rem;}',
            '.jt-fav{width:50px;height:50px;border-radius:50%;background:rgba(245,242,237,.14)!important;box-shadow:inset 0 0 0 1px var(--jt-line);display:flex;align-items:center;justify-content:center;transition:transform .15s,color .2s;}',
            '.jt-fav:active{transform:scale(.9);}',
            '.jt-fav .material-icons{font-size:1.45rem;}',
            '.jt-fav.jt-on{color:#ff4d6d!important;}',

            /* suggerimento, stati, toast */
            '.jt-hint{position:absolute;left:0;right:0;bottom:calc(env(safe-area-inset-bottom) + 6px);display:flex;flex-direction:column;align-items:center;font-size:.72rem;color:var(--jt-dim);pointer-events:none;animation:jt-bob 1.6s ease-in-out infinite;}',
            '.jt-hint .material-icons{font-size:1.4rem;}',
            '@keyframes jt-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}',
            '.jt-status{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:0 34px;text-align:center;color:var(--jt-dim);font-size:.95rem;line-height:1.55;pointer-events:none;}',
            '.jt-status .jt-btn{pointer-events:auto;margin-top:6px;flex:none;}',
            '.jt-sicon{width:70px;height:70px;border-radius:50%;background:rgba(0,164,220,.14);color:var(--jt-accent);box-shadow:inset 0 0 0 1px rgba(0,164,220,.38);display:flex;align-items:center;justify-content:center;}',
            '.jt-sicon .material-icons{font-size:2rem;}',
            '.jt-stitle{font-size:1.25rem;font-weight:800;color:var(--jt-text);}',
            '.jt-toast{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom) + 28px);transform:translate(-50%,20px);z-index:8;max-width:88vw;padding:12px 20px;border-radius:999px;background:var(--jt-text);color:var(--jt-ink);font-size:.9rem;font-weight:650;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;}',
            '.jt-toast.jt-show{opacity:1;transform:translate(-50%,0);}',

            /* orizzontale / desktop: video a tutto schermo */
            '@media (orientation:landscape){',
            '.jt-main{display:block;padding:0;}',
            '.jt-stage{position:absolute;inset:0;width:auto;aspect-ratio:auto;border-radius:0;box-shadow:none;}',
            '.jt-stage iframe{width:max(100vw,177.78vh);width:max(100vw,177.78dvh);height:max(100vh,56.25vw);height:max(100dvh,56.25vw);left:50%;top:50%;inset:auto;transform:translate(-50%,-50%);}',
            '.jt-card::after{content:"";position:absolute;inset:0;background:linear-gradient(to right,rgba(11,13,16,.9),rgba(11,13,16,.25) 55%,rgba(11,13,16,0)),linear-gradient(to top,rgba(11,13,16,.8),rgba(11,13,16,0) 45%);pointer-events:none;}',
            '.jt-scrim,.jt-amb{display:none;}',
            '.jt-info{position:absolute;z-index:2;left:max(32px,4vw);bottom:max(34px,6vh);width:min(540px,46vw);}',
            '.jt-poster{display:none;}',
            '.jt-prog{z-index:2;}',
            '.jt-note{bottom:auto;top:96px;}',
            '}',
            '@media (prefers-reduced-motion:reduce){.jt-info>*{transition:none;transform:none;}.jt-hint,.jt-spin{animation:none;}.jt-burst,.jt-flash.jt-go{animation-duration:.01s;}}',

            /* voce nel menu */
            '#owlfin-discover-btn{display:flex;align-items:center;width:100%;padding:0;border:0;background:none;cursor:pointer;color:rgba(255,255,255,.87);font-size:1rem;font-family:inherit;text-align:left;transition:background .15s;}',
            '#owlfin-discover-btn:hover{background:rgba(255,255,255,.05);}',
            '#owlfin-discover-btn .od-di{font-family:"Material Icons";font-size:1.35rem;padding:10px 16px 10px 20px;color:rgba(255,255,255,.55);line-height:1;flex-shrink:0;}',
            '#owlfin-discover-btn .od-dt{padding:10px 0;}'
        ].join('\n');
        document.head.appendChild(s);
    }

    // ---------- struttura overlay ----------
    function buildOverlay() {
        if (overlay) return;
        overlay = el('div');
        overlay.id = 'owlfin-jt';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', L('title'));

        feed = el('div');
        feed.id = 'owlfin-jt-feed';
        feed.addEventListener('scroll', hideHint, { passive: true });

        var bar = el('div', 'jt-bar');
        var row = el('div', 'jt-row');
        tabsEl = el('div', 'jt-tabs');
        row.appendChild(tabsEl);
        row.appendChild(el('div', 'jt-spacer'));

        soundBtn = el('button', 'jt-round', '<span class="material-icons">volume_off</span>');
        soundBtn.title = L('sound');
        soundBtn.setAttribute('aria-label', L('sound'));
        soundBtn.addEventListener('click', toggleMute);
        row.appendChild(soundBtn);

        var x = el('button', 'jt-round', '<span class="material-icons">close</span>');
        x.id = 'owlfin-discover-close';
        x.title = L('close');
        x.setAttribute('aria-label', L('close'));
        x.addEventListener('click', closeOverlay);
        row.appendChild(x);

        chipsEl = el('div', 'jt-chips');
        bar.appendChild(row);
        bar.appendChild(chipsEl);

        toastEl = el('div', 'jt-toast');
        overlay.appendChild(feed);
        overlay.appendChild(bar);
        overlay.appendChild(toastEl);
        document.body.appendChild(overlay);
    }

    function renderChrome() {
        // le due tab ci sono sempre; se Seerr non e' pronto, "Richiedi" spiega come attivarlo
        tabsEl.innerHTML = '';
        [['lib', 'tabLib'], ['req', 'tabReq']].forEach(function (t2) {
            var b = el('button', 'jt-tab' + (prefs.mode === t2[0] ? ' jt-on' : ''), esc(L(t2[1])));
            b.addEventListener('click', function () {
                if (prefs.mode === t2[0]) return;
                prefs.mode = t2[0]; savePrefs(); renderChrome(); start();
            });
            tabsEl.appendChild(b);
        });
        chipsEl.innerHTML = '';
        [['all', 'all'], ['Movie', 'movies'], ['Series', 'series']].forEach(function (c2) {
            var b = el('button', 'jt-chip' + (prefs.kind === c2[0] ? ' jt-on' : ''), esc(L(c2[1])));
            b.addEventListener('click', function () {
                if (prefs.kind === c2[0]) return;
                prefs.kind = c2[0]; savePrefs(); renderChrome(); start();
            });
            chipsEl.appendChild(b);
        });
        updateSoundIcon();
    }

    function updateSoundIcon() { if (soundBtn) soundBtn.firstChild.textContent = wantSound ? 'volume_up' : 'volume_off'; }

    function toast(msg) {
        if (!toastEl) return;
        toastEl.textContent = msg;
        toastEl.classList.add('jt-show');
        clearTimeout(toastEl.__t);
        toastEl.__t = setTimeout(function () { toastEl.classList.remove('jt-show'); }, 2800);
    }

    function hideHint() {
        if (prefs.hinted) return;
        prefs.hinted = true; savePrefs();
        var h = overlay && overlay.querySelector('.jt-hint');
        if (h) h.remove();
    }

    function post(iframe, func, args) {
        try { iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: args || '' }), '*'); } catch (e) { /* ignore */ }
    }

    // Audio: si parte sempre muti (unico modo per avere l'autoplay su mobile); il tasto volume
    // chiede al player di attivare l'audio. Se il sistema lo rifiuta, si torna muti con un avviso.
    function applySound(rec) {
        if (!rec || !rec.iframe) return;
        rec.ytMuted = null;
        if (wantSound) { post(rec.iframe, 'unMute'); post(rec.iframe, 'setVolume', [100]); }
        else post(rec.iframe, 'mute');
        if (wantSound) {
            setTimeout(function () {
                if (active === rec && wantSound && rec.ytMuted === true) {
                    wantSound = false; updateSoundIcon(); toast(L('audioBlocked'));
                }
            }, 1200);
        }
    }

    function toggleMute() {
        wantSound = !wantSound; updateSoundIcon();
        if (active) applySound(active);
    }

    // ---------- apertura / chiusura ----------
    function addHint(rec) {
        if (prefs.hinted || !rec) return;
        rec.el.appendChild(el('div', 'jt-hint', '<span class="material-icons">keyboard_arrow_up</span>' + esc(L('swipe'))));
    }

    function openOverlay() {
        var c = api();
        if (!c || !c.getCurrentUserId || !c.getCurrentUserId()) return;
        injectCSS();
        buildOverlay();
        closeSidebar();
        overlay.classList.add('jt-open');
        document.documentElement.classList.add('jt-lock');
        openState = true;
        renderChrome();
        // preconnect per ridurre l'attesa del primo trailer
        ['https://www.youtube-nocookie.com', 'https://i.ytimg.com'].forEach(function (u) {
            if (!document.querySelector('link[data-jt="' + u + '"]')) {
                var l = document.createElement('link'); l.rel = 'preconnect'; l.href = u; l.setAttribute('data-jt', u); document.head.appendChild(l);
            }
        });
        // in modalita' "Richiedi" serve sapere prima se Seerr risponde; la libreria parte subito
        if (prefs.mode === 'req') {
            checkSeerr().then(function () { if (openState) start(); });
        } else {
            start();
            checkSeerr();
        }
    }

    function closeOverlay() {
        if (!overlay) return;
        sessionToken++;
        detach(active);
        active = null;
        if (observer) { observer.disconnect(); observer = null; }
        overlay.classList.remove('jt-open');
        document.documentElement.classList.remove('jt-lock');
        feed.innerHTML = '';
        cards = [];
        openState = false;
        loading = false;
    }

    function closeSidebar() {
        var mask = document.querySelector('.tmla-mask.backdrop');
        if (mask) { mask.click(); return; }
        var drawer = document.querySelector('.mainDrawer');
        if (drawer) { drawer.classList.remove('drawer-open'); drawer.classList.remove('touch-menu-la'); }
        var backdrop = document.querySelector('.MuiBackdrop-root');
        if (backdrop) backdrop.click();
    }

    // ---------- feed ----------
    function setStatus(text, spin) {
        feed.innerHTML = '';
        if (!text) return;
        var box = el('div', 'jt-status');
        if (spin) box.appendChild(el('div', 'jt-spin'));
        box.appendChild(el('div', null, esc(text)));
        feed.appendChild(box);
    }

    // Seerr non configurato o non raggiungibile: spiega cosa fare invece di mostrare una pagina vuota.
    function showSetup() {
        feed.innerHTML = '';
        var box = el('div', 'jt-status');
        box.appendChild(el('div', 'jt-sicon', '<span class="material-icons">' + (seerrErr ? 'cloud_off' : 'link') + '</span>'));
        box.appendChild(el('div', 'jt-stitle', esc(L(seerrErr ? 'errTitle' : 'setupTitle'))));
        box.appendChild(el('div', null, esc(L(seerrErr ? 'errBody' : 'setupBody')) + (seerrErr ? ' [' + esc(seerrErr) + ']' : '')));
        var b = el('button', 'jt-btn jt-main-btn', esc(L('goLib')));
        b.addEventListener('click', function () { prefs.mode = 'lib'; savePrefs(); renderChrome(); start(); });
        box.appendChild(b);
        feed.appendChild(box);
    }

    function start() {
        sessionToken++;
        var token = sessionToken;
        detach(active);
        active = null;
        cards = [];
        loading = false;
        lastErr = '';
        feed.scrollTop = 0;
        if (observer) observer.disconnect();
        setupObserver();

        if (prefs.mode === 'req' && !seerrOk) { showSetup(); return; }
        setStatus(L('loading'), true);

        var prep;
        if (prefs.mode === 'req') {
            seerrErr = null;
            reqPage = 0; reqTotal = 1; reqSeen = {};
            prep = Promise.resolve();
        } else {
            prep = fetchAllIds().then(buildLibPool);
        }
        prep.then(function () {
            if (token !== sessionToken) return;
            return loadBlock(token);
        }).then(function () {
            if (token !== sessionToken) return;
            if (!cards.length) {
                if (prefs.mode === 'req' && seerrErr) { showSetup(); return; }
                setStatus((prefs.mode === 'req' ? L('emptyReq') : L('emptyLib')) + (lastErr ? ' [' + lastErr + ']' : ''));
            }
        }).catch(function (e) {
            if (token !== sessionToken) return;
            console.warn('[Owlfin JellyTok]', e);
            setStatus(L(prefs.mode === 'req' ? 'emptyReq' : 'emptyLib') + ' [' + errMsg(e) + ']');
        });
    }

    function loadBlock(token) {
        if (loading) return Promise.resolve();
        loading = true;
        var p = prefs.mode === 'req' ? loadReq(token, 0) : loadLib(token);
        return p.catch(function (e) {
            lastErr = 'blocco: ' + errMsg(e);
            if (prefs.mode === 'req') seerrErr = errCode(e);
            console.warn('[Owlfin JellyTok]', e);
        }).then(function () { loading = false; });
    }

    function loadLib(token) {
        if (libCursor >= libPool.length) return Promise.resolve(0);
        var slice = libPool.slice(libCursor, libCursor + BLOCK);
        libCursor += slice.length;
        return fetchItems(slice).then(function (items) {
            if (token !== sessionToken) return 0;
            if (!cards.length) feed.innerHTML = '';
            items.forEach(function (it) { libSeen[it.Id] = 1; addCard(normalizeLib(it)); });
            return items.length;
        });
    }

    function loadReq(token, tries) {
        if (reqPage >= reqTotal) return Promise.resolve(0);
        reqPage++;
        var kind = prefs.kind === 'Movie' ? 'movie' : (prefs.kind === 'Series' ? 'tv' : 'all');
        return jf('Owlfin/Seerr/Discover?kind=' + kind + '&page=' + reqPage + '&lang=' + LANG).then(function (r) {
            if (token !== sessionToken) return 0;
            reqTotal = r.totalPages || reqPage;
            var fresh = (r.results || []).filter(function (x) { return x.status !== 5 && !reqSeen[x.mediaType + x.id]; });
            if (fresh.length && !cards.length) feed.innerHTML = '';
            fresh.forEach(function (x) { reqSeen[x.mediaType + x.id] = 1; addCard(normalizeReq(x)); });
            if (fresh.length < 5 && reqPage < reqTotal && tries < 3) {
                return loadReq(token, tries + 1).then(function (n) { return n + fresh.length; });
            }
            return fresh.length;
        });
    }

    // ---------- scheda ----------
    function addCard(e) {
        var card = el('section', 'jt-card');
        if (e.amb) { var amb = el('img', 'jt-amb'); amb.alt = ''; amb.decoding = 'async'; amb.src = e.amb; card.appendChild(amb); }
        card.appendChild(el('div', 'jt-scrim'));

        var main = el('div', 'jt-main');
        var stage = el('div', 'jt-stage');
        if (e.still) { var still = el('img', 'jt-still'); still.alt = ''; still.decoding = 'async'; still.loading = 'lazy'; still.src = e.still; stage.appendChild(still); }
        var loader = el('div', 'jt-spin jt-loader jt-off');
        stage.appendChild(loader);
        var flash = el('div', 'jt-flash', '<span class="material-icons">pause</span>');
        stage.appendChild(flash);
        var prog = el('div', 'jt-prog', '<i></i>');
        stage.appendChild(prog);

        var info = el('div', 'jt-info');

        // intestazione: locandina + tipo + titolo + dati
        var head = el('div', 'jt-head');
        if (e.poster) { var po = el('img', 'jt-poster'); po.alt = ''; po.decoding = 'async'; po.src = e.poster; head.appendChild(po); }
        var ht = el('div', 'jt-headtxt');
        ht.appendChild(el('div', 'jt-kicker', esc(L(e.type === 'tv' ? 'typeTv' : 'typeMovie')) + (e.src === 'req' ? ' · ' + esc(L('notInLib')) : '')));
        ht.appendChild(el('h2', 'jt-title', esc(e.title)));
        var facts = el('div', 'jt-facts');
        if (e.rating) facts.appendChild(el('span', 'jt-rate', '<span class="material-icons">star</span>' + esc(e.rating.toFixed(1))));
        if (e.year) facts.appendChild(el('span', null, esc(e.year)));
        if (e.minutes) facts.appendChild(el('span', null, esc(fmtRuntime(e.minutes))));
        if (facts.childNodes.length) ht.appendChild(facts);
        head.appendChild(ht);
        info.appendChild(head);

        var gen = el('div', 'jt-gen');
        (e.genres || []).forEach(function (g) { gen.appendChild(el('span', null, esc(g))); });
        info.appendChild(gen);

        var ov = el('p', 'jt-ov', esc(e.overview || ''));
        ov.addEventListener('click', function (ev) { ev.stopPropagation(); ov.classList.toggle('jt-more'); });
        info.appendChild(ov);

        var rec = { el: card, stage: stage, loader: loader, flash: flash, prog: prog.firstChild, e: e, iframe: null, note: null, paused: false, keys: undefined, ki: 0, idx: cards.length, lastTap: 0, tapT: 0, timer: 0, reqState: null, ytMuted: null, synced: false };

        var actions = el('div', 'jt-actions');
        if (e.src === 'lib') {
            var watch = el('button', 'jt-btn jt-main-btn', '<span class="material-icons">play_arrow</span>' + esc(L('watch')));
            watch.addEventListener('click', function () { goToItem(e); });
            actions.appendChild(watch);
            var fav = el('button', 'jt-fav' + (e.fav ? ' jt-on' : ''), '<span class="material-icons">' + (e.fav ? 'favorite' : 'favorite_border') + '</span>');
            fav.setAttribute('aria-label', L(e.fav ? 'unfav' : 'fav'));
            fav.addEventListener('click', function () { setFav(rec, !e.fav); });
            rec.favBtn = fav;
            actions.appendChild(fav);
        } else {
            var rb = el('button', 'jt-btn jt-req-btn');
            rec.reqBtn = rb;
            setReqButton(rec);
            rb.addEventListener('click', function () { doRequest(rec); });
            actions.appendChild(rb);
        }
        info.appendChild(actions);

        main.appendChild(stage);
        main.appendChild(info);
        card.appendChild(main);

        card.__jt = rec;
        card.addEventListener('click', function (ev) {
            if (ev.target.closest('button') || ev.target.closest('.jt-ov')) return;
            var now = Date.now();
            if (now - rec.lastTap < 280) {
                clearTimeout(rec.tapT); rec.lastTap = 0;
                if (e.src === 'lib') { burst(rec, ev); if (!e.fav) setFav(rec, true); }
            } else {
                rec.lastTap = now;
                rec.tapT = setTimeout(function () { togglePause(rec); }, 280);
            }
        });

        if (!cards.length) addHint(rec);
        cards.push(rec);
        feed.appendChild(card);
        if (observer) observer.observe(card);
    }

    function setReqButton(rec) {
        var b = rec.reqBtn, e = rec.e;
        var st = rec.reqState === 'done' ? 'done' : e.status;
        if (rec.reqState === 'busy') {
            b.disabled = true; b.innerHTML = esc(L('requesting'));
        } else if (st === 'done') {
            b.disabled = true; b.innerHTML = '<span class="material-icons">check</span>' + esc(L('requested'));
        } else if (st === 2 || st === 3 || st === 4) {
            b.disabled = true; b.innerHTML = '<span class="material-icons">check</span>' + esc(L('st' + st));
        } else {
            b.disabled = false; b.innerHTML = '<span class="material-icons">add</span>' + esc(L('request'));
        }
    }

    function doRequest(rec) {
        if (rec.reqState) return;
        rec.reqState = 'busy'; setReqButton(rec);
        jf('Owlfin/Seerr/Request', { method: 'POST', body: JSON.stringify({ mediaType: rec.e.type, mediaId: rec.e.tmdbId }) })
            .then(function () { rec.reqState = 'done'; setReqButton(rec); toast(L('reqOk')); })
            .catch(function (err) { console.warn('[Owlfin JellyTok] richiesta', err); rec.reqState = null; setReqButton(rec); toast(L('reqFail')); });
    }

    function setFav(rec, val) {
        var c = api(), e = rec.e;
        e.fav = val;
        if (rec.favBtn) {
            rec.favBtn.classList.toggle('jt-on', val);
            rec.favBtn.firstChild.textContent = val ? 'favorite' : 'favorite_border';
            rec.favBtn.setAttribute('aria-label', L(val ? 'unfav' : 'fav'));
        }
        if (c && c.updateFavoriteStatus) {
            Promise.resolve(c.updateFavoriteStatus(c.getCurrentUserId(), e.itemId, val)).catch(function () { /* silenzioso */ });
        }
    }

    function burst(rec, ev) {
        var r = rec.el.getBoundingClientRect();
        var b = el('div', 'jt-burst', '<span class="material-icons">favorite</span>');
        b.style.left = (ev.clientX - r.left) + 'px';
        b.style.top = (ev.clientY - r.top) + 'px';
        rec.el.appendChild(b);
        setTimeout(function () { b.remove(); }, 800);
    }

    // ---------- osservazione scroll ----------
    function setupObserver() {
        observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                var rec = en.target.__jt;
                if (!rec) return;
                if (en.isIntersecting && en.intersectionRatio >= 0.6) { if (rec !== active) activate(rec); }
            });
        }, { root: feed, threshold: [0.6] });
    }

    function activate(rec) {
        if (active) { active.el.classList.remove('jt-on'); detach(active); }
        active = rec;
        rec.el.classList.add('jt-on');
        attach(rec);
        for (var i = 1; i <= 2; i++) {
            var n = cards[rec.idx + i];
            if (n) { getTrailer(n.e); preload(n.e.still); }
        }
        if (rec.idx >= cards.length - PREFETCH_AT) loadBlock(sessionToken);
    }

    function setNote(rec, text) {
        if (!text) { if (rec.note) { rec.note.remove(); rec.note = null; } return; }
        if (!rec.note) { rec.note = el('div', 'jt-note'); rec.stage.appendChild(rec.note); }
        rec.note.textContent = text;
    }

    // ---------- player ----------
    function attach(rec) {
        var token = sessionToken;
        rec.loader.classList.remove('jt-off');
        var p = rec.keys !== undefined ? Promise.resolve(rec.keys) : getTrailer(rec.e);
        p.then(function (keys) {
            rec.keys = keys;
            if (token !== sessionToken || active !== rec) return;
            if (!keys.length) { rec.loader.classList.add('jt-off'); setNote(rec, L('noTrailer')); return; }
            if (!rec.iframe) play(rec);
        });
    }

    function play(rec) {
        var key = rec.keys[rec.ki || 0];
        if (!key) { rec.loader.classList.add('jt-off'); setNote(rec, L('noTrailer')); return; }
        var f = document.createElement('iframe');
        f.allow = 'autoplay; encrypted-media; picture-in-picture';
        f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        f.setAttribute('title', rec.e.title);
        // sempre muto: e' l'unica condizione in cui iOS/Android lasciano partire il video da solo
        f.src = 'https://www.youtube-nocookie.com/embed/' + key +
            '?autoplay=1&mute=1&controls=0&loop=1&playlist=' + key +
            '&playsinline=1&modestbranding=1&rel=0&iv_load_policy=3&cc_load_policy=0&disablekb=1&fs=0' +
            '&enablejsapi=1&origin=' + encodeURIComponent(location.origin);
        f.addEventListener('load', function () {
            try { f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'); } catch (e2) { /* ignore */ }
            post(f, 'unloadModule', ['captions']);
        });
        rec.iframe = f;
        rec.paused = false;
        rec.synced = false;
        rec.ytMuted = true;
        rec.flash.classList.remove('jt-hold', 'jt-go');
        rec.stage.appendChild(f);
        clearTimeout(rec.timer);
        // Se non parte: tre "spinte" (mute + play) a distanza di 0,9 s; poi si lascia il player
        // cliccabile cosi' un tocco sul suo pulsante play (gesto reale dentro l'iframe) lo avvia sempre.
        (function nudge(n) {
            rec.timer = setTimeout(function () {
                if (rec.iframe !== f || rec.started) return;
                if (n < 3) { post(f, 'mute'); post(f, 'playVideo'); nudge(n + 1); }
                else blocked(rec, f);
            }, n < 3 ? 900 : 1200);
        })(0);
        rec.started = false;
    }

    function blocked(rec, f) {
        if (rec.iframe !== f) return;
        f.classList.add('jt-ready', 'jt-tap');
        rec.loader.classList.add('jt-off');
        setNote(rec, L('tapPlay'));
    }

    function markReady(rec) {
        clearTimeout(rec.timer);
        rec.started = true;
        if (rec.iframe) { rec.iframe.classList.add('jt-ready'); rec.iframe.classList.remove('jt-tap'); }
        rec.loader.classList.add('jt-off');
        setNote(rec, null);
        if (!rec.synced) {
            rec.synced = true;
            if (wantSound) applySound(rec);   // rispetta la scelta "audio acceso" fatta sul video precedente
        }
    }

    function detach(rec) {
        if (!rec) return;
        clearTimeout(rec.timer);
        if (rec.iframe) { rec.iframe.remove(); rec.iframe = null; }
        setNote(rec, null);
        rec.loader.classList.add('jt-off');
        rec.prog.style.transform = 'scaleX(0)';
        rec.paused = false;
        rec.started = false;
        if (rec.flash) rec.flash.classList.remove('jt-hold', 'jt-go');
    }

    function togglePause(rec) {
        if (!rec.iframe) return;
        rec.paused = !rec.paused;
        post(rec.iframe, rec.paused ? 'pauseVideo' : 'playVideo');
        var fl = rec.flash;
        fl.firstChild.textContent = rec.paused ? 'play_arrow' : 'pause';
        fl.classList.remove('jt-go', 'jt-hold');
        if (rec.paused) { fl.classList.add('jt-hold'); }
        else { void fl.offsetWidth; fl.classList.add('jt-go'); }
    }

    // Messaggi dal player YouTube: stato, avanzamento, errori.
    window.addEventListener('message', function (ev) {
        if (!active || !active.iframe || ev.source !== active.iframe.contentWindow) return;
        var d = ev.data;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch (x) { return; } }
        if (!d) return;
        var rec = active;
        if (d.event === 'onError') {
            clearTimeout(rec.timer);
            rec.iframe.remove(); rec.iframe = null;
            rec.ki = (rec.ki || 0) + 1;
            if (rec.keys && rec.ki < rec.keys.length) play(rec);
            else { rec.loader.classList.add('jt-off'); setNote(rec, L('noTrailer')); }
            return;
        }
        var info = d.info;
        if (d.event === 'onStateChange' && info === 1) markReady(rec);
        if (d.event === 'infoDelivery' && info) {
            if (info.playerState === 1) markReady(rec);
            if (typeof info.muted === 'boolean') rec.ytMuted = info.muted;
            if (info.duration && info.currentTime != null) {
                rec.prog.style.transform = 'scaleX(' + Math.min(1, info.currentTime / info.duration).toFixed(3) + ')';
            }
        }
    });

    function goToItem(e) {
        closeOverlay();
        setTimeout(function () {
            try {
                if (window.require) {
                    window.require(['appRouter'], function (appRouter) { appRouter.showItem(e.raw || e.itemId, e.serverId); });
                    return;
                }
            } catch (err) { /* fallback sotto */ }
            location.hash = '#/details?id=' + e.itemId + '&serverId=' + (e.serverId || '');
        }, 60);
    }

    document.addEventListener('keydown', function (ev) {
        if (!openState) return;
        if (ev.key === 'Escape') { closeOverlay(); return; }
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
            ev.preventDefault();
            var h = feed.clientHeight;
            feed.scrollBy({ top: ev.key === 'ArrowDown' ? h : -h, behavior: 'smooth' });
        } else if (ev.key === ' ' && active) {
            ev.preventDefault(); togglePause(active);
        } else if ((ev.key === 'm' || ev.key === 'M')) {
            toggleMute();
        }
    });

    // ---------- voce nel menu laterale ----------
    function injectMuiEntry(muiDrawer) {
        if (document.getElementById('owlfin-discover-mui')) return;
        var item = el('div', 'MuiListItemButton-root', '<span class="material-icons" style="font-size:1.35rem;opacity:.8;">explore</span><span>' + esc(L('menu')) + '</span>');
        item.id = 'owlfin-discover-mui';
        item.setAttribute('role', 'button');
        item.tabIndex = 0;
        item.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 16px;cursor:pointer;width:85%;margin:3px auto;list-style:none;';
        var go = function (ev) { ev.preventDefault(); ev.stopPropagation(); openOverlay(); };
        item.addEventListener('click', go);
        item.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') go(ev); });
        muiDrawer.appendChild(item);
    }

    function injectLegacyEntry(drawer) {
        if (document.getElementById('owlfin-discover-btn')) return;
        var homeLink = Array.prototype.find.call(drawer.children, function (n) {
            return n.tagName === 'A' && n.textContent.trim().toLowerCase() === 'home';
        });
        if (!homeLink) return;
        var btn = el('button', null, '<span class="od-di">explore</span><span class="od-dt">' + esc(L('menu')) + '</span>');
        btn.id = 'owlfin-discover-btn';
        btn.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopImmediatePropagation(); openOverlay(); }, true);
        drawer.insertBefore(btn, homeLink.nextSibling);
    }

    function injectMenuEntry() {
        injectCSS();
        if (document.getElementById('owlfin-discover-btn') || document.getElementById('owlfin-discover-mui')) return;
        var mui = document.querySelector('.MuiDrawer-paper');
        if (mui) { injectMuiEntry(mui); return; }
        var drawer = document.querySelector('.mainDrawer-scrollContainer') || document.querySelector('.mainDrawer');
        if (drawer) injectLegacyEntry(drawer);
    }

    document.addEventListener('viewshow', function () { setTimeout(injectMenuEntry, 400); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(injectMenuEntry, 400); });
    [1000, 2500, 4000, 8000].forEach(function (ms) { setTimeout(injectMenuEntry, ms); });

    window.owlfinJellytokOpen = openOverlay;
})();
