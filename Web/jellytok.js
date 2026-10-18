// Owlfin - JellyTok
// Feed verticale a schermo intero di trailer, stile TikTok.
//   Libreria  - titoli casuali presenti sul server, a blocchi di 20
//   Richiedi  - titoli di tendenza non ancora presenti, richiedibili via Seerr (se configurato)
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
            all: 'Tutti', movies: 'Film', series: 'Serie TV',
            watch: 'Guarda', request: 'Richiedi', requesting: 'Invio…', requested: 'Richiesto',
            st2: 'Richiesto', st3: 'In lavorazione', st4: 'Parziale',
            loading: 'Carico i titoli…', emptyLib: 'Nessun titolo trovato nella libreria.',
            emptyReq: 'Nessun titolo da richiedere al momento.', noTrailer: 'Trailer non disponibile',
            close: 'Chiudi', sound: 'Audio', fav: 'Aggiungi ai preferiti', unfav: 'Rimuovi dai preferiti',
            swipe: 'Scorri', reqOk: 'Richiesta inviata a Seerr', reqFail: 'Richiesta non riuscita, riprova tra poco',
            audioBlocked: 'Audio bloccato dal browser: tocca il volume'
        },
        en: {
            menu: 'Discover', title: 'Discover', tabLib: 'Library', tabReq: 'Request',
            all: 'All', movies: 'Movies', series: 'Series',
            watch: 'Watch', request: 'Request', requesting: 'Sending…', requested: 'Requested',
            st2: 'Requested', st3: 'Processing', st4: 'Partial',
            loading: 'Loading titles…', emptyLib: 'No titles found in the library.',
            emptyReq: 'Nothing to request right now.', noTrailer: 'Trailer not available',
            close: 'Close', sound: 'Sound', fav: 'Add to favorites', unfav: 'Remove from favorites',
            swipe: 'Swipe', reqOk: 'Request sent to Seerr', reqFail: 'Request failed, try again soon',
            audioBlocked: 'Audio blocked by the browser: tap the volume'
        }
    };
    function L(k) { return STR[LANG][k] || k; }

    // ---------- stato ----------
    var prefs = loadPrefs();            // { mode:'lib'|'req', kind:'all'|'Movie'|'Series', muted, hinted }
    var seerrOk = null;                 // null = non verificato
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
        var p = { mode: 'lib', kind: 'all', muted: true, hinted: false };
        try { var s = JSON.parse(lsGet(PREFS_KEY) || '{}'); for (var k in p) if (s[k] !== undefined) p[k] = s[k]; } catch (e) { /* ignore */ }
        return p;
    }
    function savePrefs() { lsSet(PREFS_KEY, JSON.stringify(prefs)); }
    function errMsg(e) { return (e && (e.message || e.status)) || String(e); }
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
            still: imgUrl(item, 'Backdrop', 780) || imgUrl(item, 'Primary', 500),
            fav: !!(item.UserData && item.UserData.IsFavorite),
            tmdbId: tmdb || null, remote: item.RemoteTrailers || [], status: 0, raw: item
        };
    }

    // ---------- dati: richieste (Seerr) ----------
    function checkSeerr() {
        if (seerrOk !== null) return Promise.resolve(seerrOk);
        return jf('Owlfin/Seerr/Status').then(function (r) { seerrOk = !!(r && r.enabled); return seerrOk; })
            .catch(function () { seerrOk = false; return false; });
    }

    function normalizeReq(x) {
        var year = x.date ? parseInt(String(x.date).slice(0, 4), 10) : null;
        return {
            src: 'req', key: 't-' + x.mediaType + '-' + x.id, itemId: null, serverId: null,
            type: x.mediaType, title: x.title || '', year: year || null,
            rating: x.rating && x.rating > 0 ? x.rating : null, minutes: null, genres: [],
            overview: x.overview || '',
            amb: x.poster ? TMDB_IMG + 'w92' + x.poster : (x.backdrop ? TMDB_IMG + 'w300' + x.backdrop : ''),
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
            '#owlfin-jt{--jt-accent:#00a4dc;--jt-ink:#0c0e11;--jt-text:#f4f1ec;--jt-dim:rgba(244,241,236,.7);--jt-glass:rgba(18,20,25,.66);',
            'position:fixed;inset:0;z-index:100000;background:var(--jt-ink);color:var(--jt-text);display:none;font-family:inherit;-webkit-tap-highlight-color:transparent;}',
            '#owlfin-jt.jt-open{display:block;}',
            'html.jt-lock,html.jt-lock body{overflow:hidden!important;}',
            '#owlfin-jt button{font-family:inherit;color:inherit;cursor:pointer;border:0;background:none;padding:0;}',
            '#owlfin-jt button:focus-visible{outline:2px solid var(--jt-accent);outline-offset:2px;}',
            '#owlfin-jt-feed{height:100%;overflow-y:scroll;scroll-snap-type:y mandatory;overscroll-behavior:contain;scrollbar-width:none;}',
            '#owlfin-jt-feed::-webkit-scrollbar{display:none;}',

            /* barra superiore */
            '.jt-bar{position:absolute;top:0;left:0;right:0;z-index:6;padding:calc(env(safe-area-inset-top) + 10px) 12px 24px;pointer-events:none;background:linear-gradient(to bottom,rgba(12,14,17,.85),rgba(12,14,17,0));}',
            '.jt-row{display:flex;align-items:center;gap:8px;}',
            '.jt-tabs{display:flex;gap:2px;padding:3px;border-radius:999px;background:var(--jt-glass);pointer-events:auto;}',
            '.jt-tab{padding:8px 16px;border-radius:999px;font-size:.92rem;font-weight:600;color:var(--jt-dim);transition:background .2s,color .2s;}',
            '.jt-tab.jt-on{background:var(--jt-text);color:var(--jt-ink);}',
            '.jt-name{font-size:1.05rem;font-weight:700;padding:0 6px;}',
            '.jt-spacer{flex:1;}',
            '.jt-round{pointer-events:auto;width:40px;height:40px;border-radius:50%;background:var(--jt-glass)!important;display:flex;align-items:center;justify-content:center;}',
            '.jt-round .material-icons{font-size:1.4rem;}',
            '.jt-chips{display:flex;gap:6px;margin-top:10px;pointer-events:auto;}',
            '.jt-chip{padding:6px 14px;border-radius:999px;font-size:.8rem;font-weight:600;color:var(--jt-dim);box-shadow:inset 0 0 0 1px rgba(244,241,236,.22);transition:background .2s,color .2s;}',
            '.jt-chip.jt-on{background:rgba(244,241,236,.16);color:var(--jt-text);box-shadow:inset 0 0 0 1px rgba(244,241,236,.5);}',

            /* scheda */
            '.jt-card{position:relative;height:100vh;height:100dvh;scroll-snap-align:start;scroll-snap-stop:always;overflow:hidden;contain:layout paint;}',
            '.jt-amb{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scale(1.15);opacity:.55;}',
            '.jt-scrim{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(12,14,17,.55),rgba(12,14,17,.92));}',
            '.jt-main{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:18px;padding:calc(env(safe-area-inset-top) + 118px) 14px calc(env(safe-area-inset-bottom) + 24px);}',
            '.jt-stage{position:relative;width:100%;aspect-ratio:16/9;border-radius:14px;overflow:hidden;background:#000;box-shadow:0 22px 50px -14px rgba(0,0,0,.85),0 0 0 1px rgba(244,241,236,.1);flex-shrink:0;}',
            '.jt-still{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}',
            '.jt-stage iframe{position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none;opacity:0;transition:opacity .45s;}',
            '.jt-stage iframe.jt-ready{opacity:1;}',
            '.jt-loader{position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;border:2.5px solid rgba(244,241,236,.25);border-top-color:var(--jt-text);animation:jt-spin .8s linear infinite;transition:opacity .3s;}',
            '.jt-loader.jt-off{opacity:0;}',
            '@keyframes jt-spin{to{transform:rotate(360deg);}}',
            '.jt-prog{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(244,241,236,.18);}',
            '.jt-prog i{display:block;height:100%;background:var(--jt-accent);transform:scaleX(0);transform-origin:0 50%;transition:transform .3s linear;}',
            '.jt-note{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);padding:6px 12px;border-radius:999px;background:var(--jt-glass);font-size:.8rem;color:var(--jt-dim);white-space:nowrap;pointer-events:none;}',
            '.jt-burst{position:absolute;width:84px;height:84px;margin:-42px 0 0 -42px;pointer-events:none;color:#ff4d6d;animation:jt-pop .75s ease-out forwards;}',
            '.jt-burst .material-icons{font-size:84px;}',
            '@keyframes jt-pop{0%{transform:scale(.3);opacity:0}25%{transform:scale(1.15);opacity:1}60%{transform:scale(1);opacity:1}100%{transform:scale(1.2) translateY(-24px);opacity:0}}',

            /* informazioni */
            '.jt-info{opacity:0;transform:translateY(12px);transition:opacity .45s ease,transform .45s ease;max-width:640px;}',
            '.jt-card.jt-on .jt-info{opacity:1;transform:none;}',
            '.jt-title{margin:0 0 8px;font-size:clamp(1.5rem,5.6vw,2.5rem);line-height:1.08;font-weight:800;letter-spacing:-.02em;text-wrap:balance;text-shadow:0 2px 14px rgba(0,0,0,.5);}',
            '.jt-facts{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;font-size:.88rem;color:var(--jt-dim);margin-bottom:10px;}',
            '.jt-rate{display:inline-flex;align-items:center;gap:3px;padding:2px 8px 2px 6px;border-radius:6px;background:rgba(244,241,236,.14);color:var(--jt-text);font-weight:700;}',
            '.jt-rate .material-icons{font-size:.95rem;color:#f5c518;}',
            '.jt-gen{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;}',
            '.jt-gen span{padding:3px 10px;border-radius:999px;font-size:.78rem;box-shadow:inset 0 0 0 1px rgba(244,241,236,.28);color:var(--jt-text);}',
            '.jt-ov{margin:0 0 16px;font-size:.92rem;line-height:1.5;color:var(--jt-dim);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;cursor:pointer;}',
            '.jt-ov.jt-more{-webkit-line-clamp:unset;max-height:30vh;overflow-y:auto;}',
            '.jt-actions{display:flex;align-items:center;gap:10px;}',
            '.jt-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:46px;padding:0 26px;border-radius:999px;font-size:1rem;font-weight:700;transition:transform .15s,opacity .2s;}',
            '.jt-btn:active{transform:scale(.96);}',
            '.jt-btn.jt-main-btn{background:var(--jt-text)!important;color:var(--jt-ink)!important;}',
            '.jt-btn.jt-req-btn{background:var(--jt-accent)!important;color:#04141b!important;}',
            '.jt-btn[disabled]{opacity:.6;cursor:default;}',
            '.jt-btn .material-icons{font-size:1.3rem;}',
            '.jt-fav{width:46px;height:46px;border-radius:50%;background:rgba(244,241,236,.14)!important;display:flex;align-items:center;justify-content:center;}',
            '.jt-fav.jt-on{color:#ff4d6d!important;}',

            /* suggerimento + toast */
            '.jt-hint{position:absolute;left:0;right:0;bottom:calc(env(safe-area-inset-bottom) + 6px);display:flex;flex-direction:column;align-items:center;font-size:.72rem;color:var(--jt-dim);pointer-events:none;animation:jt-bob 1.6s ease-in-out infinite;}',
            '.jt-hint .material-icons{font-size:1.4rem;}',
            '@keyframes jt-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}',
            '.jt-status{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:0 24px;text-align:center;color:var(--jt-dim);font-size:.95rem;pointer-events:none;}',
            '.jt-toast{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom) + 28px);transform:translate(-50%,20px);z-index:8;max-width:88vw;padding:11px 18px;border-radius:999px;background:var(--jt-text);color:var(--jt-ink);font-size:.9rem;font-weight:600;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;}',
            '.jt-toast.jt-show{opacity:1;transform:translate(-50%,0);}',

            /* orizzontale / desktop: video a tutto schermo */
            '@media (orientation:landscape){',
            '.jt-main{display:block;padding:0;}',
            '.jt-stage{position:absolute;inset:0;width:auto;aspect-ratio:auto;border-radius:0;box-shadow:none;}',
            '.jt-stage iframe{width:max(100vw,177.78vh);width:max(100vw,177.78dvh);height:max(100vh,56.25vw);height:max(100dvh,56.25vw);left:50%;top:50%;inset:auto;transform:translate(-50%,-50%);}',
            '.jt-card::after{content:"";position:absolute;inset:0;background:linear-gradient(to right,rgba(12,14,17,.88),rgba(12,14,17,.25) 55%,rgba(12,14,17,0)),linear-gradient(to top,rgba(12,14,17,.8),rgba(12,14,17,0) 45%);pointer-events:none;}',
            '.jt-scrim,.jt-amb{display:none;}',
            '.jt-info{position:absolute;z-index:2;left:max(32px,4vw);bottom:max(34px,6vh);width:min(540px,46vw);}',
            '.jt-prog{z-index:2;}',
            '.jt-note{bottom:auto;top:96px;}',
            '}',
            '@media (prefers-reduced-motion:reduce){.jt-info{transition:none;transform:none;}.jt-hint,.jt-loader{animation:none;}.jt-burst{animation-duration:.01s;}}',

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
        // tab: visibili solo se Seerr e' configurato
        tabsEl.innerHTML = '';
        if (seerrOk) {
            [['lib', 'tabLib'], ['req', 'tabReq']].forEach(function (t2) {
                var b = el('button', 'jt-tab' + (prefs.mode === t2[0] ? ' jt-on' : ''), esc(L(t2[1])));
                b.addEventListener('click', function () {
                    if (prefs.mode === t2[0]) return;
                    prefs.mode = t2[0]; savePrefs(); renderChrome(); start();
                });
                tabsEl.appendChild(b);
            });
        } else {
            tabsEl.appendChild(el('div', 'jt-name', esc(L('title'))));
        }
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

    function updateSoundIcon() { if (soundBtn) soundBtn.firstChild.textContent = prefs.muted ? 'volume_off' : 'volume_up'; }

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

    function post(iframe, func) {
        try { iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: '' }), '*'); } catch (e) { /* ignore */ }
    }

    function toggleMute() {
        prefs.muted = !prefs.muted; savePrefs(); updateSoundIcon();
        if (active && active.iframe) post(active.iframe, prefs.muted ? 'mute' : 'unMute');
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
        checkSeerr().then(function (ok) {
            if (!openState) return;
            if (!ok && prefs.mode === 'req') { prefs.mode = 'lib'; }
            renderChrome();
            start();
        });
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
    function setStatus(text) {
        feed.innerHTML = '';
        if (text) feed.appendChild(el('div', 'jt-status', esc(text)));
    }

    function start() {
        sessionToken++;
        var token = sessionToken;
        detach(active);
        active = null;
        cards = [];
        loading = false;
        lastErr = '';
        setStatus(L('loading'));
        feed.scrollTop = 0;
        if (observer) observer.disconnect();
        setupObserver();

        var prep;
        if (prefs.mode === 'req' && seerrOk) {
            reqPage = 0; reqTotal = 1; reqSeen = {};
            prep = Promise.resolve();
        } else {
            prefs.mode = 'lib';
            prep = fetchAllIds().then(buildLibPool);
        }
        prep.then(function () {
            if (token !== sessionToken) return;
            return loadBlock(token);
        }).then(function () {
            if (token !== sessionToken) return;
            if (!cards.length) {
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
        return p.catch(function (e) { lastErr = 'blocco: ' + errMsg(e); console.warn('[Owlfin JellyTok]', e); })
            .then(function () { loading = false; });
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
        var loader = el('div', 'jt-loader jt-off');
        stage.appendChild(loader);
        var prog = el('div', 'jt-prog', '<i></i>');
        stage.appendChild(prog);

        var info = el('div', 'jt-info');
        info.appendChild(el('h2', 'jt-title', esc(e.title)));

        var facts = el('div', 'jt-facts');
        if (e.rating) facts.appendChild(el('span', 'jt-rate', '<span class="material-icons">star</span>' + esc(e.rating.toFixed(1))));
        if (e.year) facts.appendChild(el('span', null, esc(e.year)));
        if (e.minutes) facts.appendChild(el('span', null, esc(fmtRuntime(e.minutes))));
        if (facts.childNodes.length) info.appendChild(facts);

        if (e.genres && e.genres.length) {
            var gen = el('div', 'jt-gen');
            e.genres.forEach(function (g) { gen.appendChild(el('span', null, esc(g))); });
            info.appendChild(gen);
        }
        if (e.overview) {
            var ov = el('p', 'jt-ov', esc(e.overview));
            ov.addEventListener('click', function (ev) { ev.stopPropagation(); ov.classList.toggle('jt-more'); });
            info.appendChild(ov);
        }

        var rec = { el: card, stage: stage, loader: loader, prog: prog.firstChild, e: e, iframe: null, note: null, paused: false, keys: undefined, ki: 0, idx: cards.length, lastTap: 0, tapT: 0, timer: 0, reqState: null };

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

    function play(rec, forceMuted) {
        var key = rec.keys[rec.ki || 0];
        if (!key) { rec.loader.classList.add('jt-off'); setNote(rec, L('noTrailer')); return; }
        var mute = forceMuted || prefs.muted;
        var f = document.createElement('iframe');
        f.allow = 'autoplay; encrypted-media; picture-in-picture';
        f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        f.setAttribute('title', rec.e.title);
        f.src = 'https://www.youtube-nocookie.com/embed/' + key +
            '?autoplay=1&mute=' + (mute ? 1 : 0) +
            '&controls=0&loop=1&playlist=' + key +
            '&playsinline=1&modestbranding=1&rel=0&iv_load_policy=3&disablekb=1&fs=0' +
            '&enablejsapi=1&origin=' + encodeURIComponent(location.origin);
        f.addEventListener('load', function () {
            try { f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'); } catch (e2) { /* ignore */ }
        });
        rec.iframe = f;
        rec.paused = false;
        rec.stage.appendChild(f);
        clearTimeout(rec.timer);
        // Se entro 4s non parte: con audio -> riprova muto (autoplay bloccato); gia' muto -> mostra comunque.
        rec.timer = setTimeout(function () {
            if (rec.iframe !== f || f.classList.contains('jt-ready')) return;
            if (!mute) {
                f.remove(); rec.iframe = null;
                prefs.muted = true; updateSoundIcon();
                toast(L('audioBlocked'));
                play(rec, true);
            } else {
                markReady(rec);
            }
        }, 4000);
    }

    function markReady(rec) {
        clearTimeout(rec.timer);
        if (rec.iframe) rec.iframe.classList.add('jt-ready');
        rec.loader.classList.add('jt-off');
    }

    function detach(rec) {
        if (!rec) return;
        clearTimeout(rec.timer);
        if (rec.iframe) { rec.iframe.remove(); rec.iframe = null; }
        setNote(rec, null);
        rec.loader.classList.add('jt-off');
        rec.prog.style.transform = 'scaleX(0)';
        rec.paused = false;
    }

    function togglePause(rec) {
        if (!rec.iframe) return;
        rec.paused = !rec.paused;
        post(rec.iframe, rec.paused ? 'pauseVideo' : 'playVideo');
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
