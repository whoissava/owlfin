// Owlfin - Scopri / Discover (JellyTok)
// Feed verticale a schermo intero di trailer, stile TikTok, per scegliere cosa guardare.
// Titoli casuali da tutta la libreria, caricati a blocchi di 20 (il blocco successivo
// parte quando ci si avvicina al 15° titolo). Voce nel menu laterale, X in alto per chiudere.
(function () {
    'use strict';
    if (window.__owlfinDiscoverLoaded) return;
    window.__owlfinDiscoverLoaded = true;

    var BLOCK = 20;
    var PREFETCH_AT = 5;
    var CACHE_PREFIX = 'owlfin_jellytok_trailer_v3_';
    var NONE = '__NONE__';
    var FIELDS = 'Overview,Genres,ProviderIds,RemoteTrailers';
    var lastErr = '';

    var LANG = ((navigator.language || 'it').split('-')[0] === 'it') ? 'it' : 'en';
    var STR = {
        it: { menu: 'Scopri', title: 'Scopri', watch: 'Guarda', details: 'Dettagli', noTrailer: 'Trailer non disponibile', loading: 'Carico i titoli…', empty: 'Nessun titolo trovato nella libreria.', close: 'Chiudi', sound: 'Audio', movie: 'Film', series: 'Serie TV', section: 'Scopri' },
        en: { menu: 'Discover', title: 'Discover', watch: 'Watch', details: 'Details', noTrailer: 'Trailer not available', loading: 'Loading titles…', empty: 'No titles found in the library.', close: 'Close', sound: 'Sound', movie: 'Movie', series: 'Series', section: 'Discover' }
    };
    function L(k) { return STR[LANG][k] || k; }

    var ids = null;
    var cursor = 0;
    var loading = false;
    var cards = [];
    var active = null;
    var muted = true;
    var observer = null;
    var overlay = null, feed = null;
    var openState = false;
    var sessionToken = 0;

    function api() { return window.ApiClient || null; }
    function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

    function imgUrl(item, type, w) {
        var c = api();
        if (!c) return '';
        var tag = type === 'Backdrop'
            ? (item.BackdropImageTags && item.BackdropImageTags[0])
            : (item.ImageTags && item.ImageTags.Primary);
        if (!tag) return '';
        return c.getUrl('Items/' + item.Id + '/Images/' + type, { maxWidth: w, tag: tag, quality: 80 });
    }

    function fetchAllIds() {
        if (ids) return Promise.resolve(ids);
        var c = api();
        var uid = c.getCurrentUserId();
        function toIds(r) {
            var arr = (r && r.Items) ? r.Items : (Array.isArray(r) ? r : []);
            return arr.map(function (i) { return i.Id; }).filter(Boolean);
        }
        return Promise.resolve(c.getItems(uid, { IncludeItemTypes: 'Movie,Series', Recursive: true, SortBy: 'Random', Limit: 5000 }))
            .then(toIds)
            .catch(function (e) {
                console.warn('[Owlfin JellyTok] richiesta ids fallita, riprovo', e);
                lastErr = 'ids: ' + (e && (e.message || e.status) || e);
                return Promise.resolve(c.getItems(uid, { IncludeItemTypes: 'Movie,Series', Recursive: true })).then(toIds);
            })
            .then(function (list) {
                ids = shuffle(list);
                return ids;
            });
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
                console.warn('[Owlfin JellyTok] richiesta dettagli fallita, riprovo', e);
                lastErr = 'items: ' + (e && (e.message || e.status) || e);
                return Promise.resolve(c.getItems(uid, { Ids: list.join(',') })).then(ordered);
            });
    }

    function ytIdFromUrl(u) {
        if (!u) return null;
        var m = String(u).match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
        return m ? m[1] : null;
    }

    function pickTmdbVideos(results) {
        var yt = (results || []).filter(function (v) { return v.site === 'YouTube' && v.key; });
        function rank(v) { return (v.type === 'Trailer' ? 0 : v.type === 'Teaser' ? 2 : 9) + (v.official ? 0 : 1); }
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

    function tmdbFindId(kind, item) {
        var params = { query: item.Name, language: LANG === 'it' ? 'it-IT' : 'en-US' };
        if (item.ProductionYear) params[kind === 'tv' ? 'first_air_date_year' : 'year'] = item.ProductionYear;
        return tmdbGet('search/' + kind, params).then(function (j) {
            return (j.results && j.results[0]) ? j.results[0].id : null;
        });
    }

    // Restituisce una Promise<string[]> con gli ID YouTube candidati (vuota = nessun trailer).
    // Solo i veri "nessun trailer" vengono messi in cache; gli errori di rete/dati mancanti no.
    var inflight = {};
    function getTrailer(item) {
        var ck = CACHE_PREFIX + item.Id;
        var cached = lsGet(ck);
        if (cached) return Promise.resolve(cached === NONE ? [] : cached.split(','));
        if (inflight[item.Id]) return inflight[item.Id];

        var keys = [];
        (item.RemoteTrailers || []).forEach(function (t) { var k = ytIdFromUrl(t.Url); if (k && keys.indexOf(k) < 0) keys.push(k); });

        var pr;
        if (keys.length) {
            pr = Promise.resolve(keys);
        } else if (!window.__owlfin_tmdb_key__) {
            pr = Promise.resolve(null);
        } else {
            var kind = item.Type === 'Series' ? 'tv' : 'movie';
            var tmdbId = item.ProviderIds && (item.ProviderIds.Tmdb || item.ProviderIds.tmdb);
            pr = (tmdbId ? Promise.resolve(tmdbId) : tmdbFindId(kind, item))
                .then(function (id) { return id ? tmdbVideos(kind, id) : []; })
                .catch(function (e) { lastErr = 'tmdb: ' + (e && e.message || e); return null; });
        }
        inflight[item.Id] = pr.then(function (res) {
            delete inflight[item.Id];
            if (res === null) return [];
            lsSet(ck, res.length ? res.join(',') : NONE);
            return res;
        });
        return inflight[item.Id];
    }

    function injectCSS() {
        if (document.getElementById('owlfin-discover-css')) return;
        var s = document.createElement('style');
        s.id = 'owlfin-discover-css';
        s.textContent = [
            '#owlfin-discover-overlay{position:fixed;inset:0;z-index:100000;background:#000;color:#fff;display:none;font-family:inherit;}',
            '#owlfin-discover-overlay.od-open{display:block;}',
            'html.od-lock,html.od-lock body{overflow:hidden!important;}',
            '#owlfin-discover-feed{height:100%;overflow-y:scroll;scroll-snap-type:y mandatory;overscroll-behavior:contain;scrollbar-width:none;-webkit-overflow-scrolling:touch;}',
            '#owlfin-discover-feed::-webkit-scrollbar{display:none;}',
            '.od-card{position:relative;height:100vh;height:100dvh;scroll-snap-align:start;scroll-snap-stop:always;overflow:hidden;background:#000;}',
            '.od-bg{position:absolute;inset:-30px;background-size:cover;background-position:center;filter:blur(28px) brightness(.45);transform:scale(1.1);}',
            '.od-stage{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);width:100%;aspect-ratio:16/9;background:#000 center/cover no-repeat;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.6);}',
            '.od-stage iframe{position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none;opacity:0;transition:opacity .5s;}',
            '.od-stage iframe.od-ready{opacity:1;}',
            '@media (orientation:landscape){.od-stage{top:0;transform:none;height:100%;aspect-ratio:auto;box-shadow:none;}',
            '.od-stage iframe{width:max(100vw,177.78dvh);height:max(100dvh,56.25vw);left:50%;top:50%;transform:translate(-50%,-50%);inset:auto;}}',
            '.od-tag{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:6px 12px;border-radius:999px;background:rgba(0,0,0,.55);font-size:.8rem;color:rgba(255,255,255,.8);pointer-events:none;backdrop-filter:blur(6px);}',
            '.od-grad{position:absolute;left:0;right:0;bottom:0;height:55%;background:linear-gradient(to top,rgba(0,0,0,.92),rgba(0,0,0,.55) 50%,transparent);pointer-events:none;}',
            '.od-info{position:absolute;left:0;right:0;bottom:0;padding:0 20px max(28px,env(safe-area-inset-bottom));pointer-events:none;}',
            '.od-kind{font-size:.7rem;letter-spacing:1.2px;text-transform:uppercase;color:#00a4dc;font-weight:700;margin-bottom:6px;}',
            '.od-title{font-size:1.6rem;line-height:1.15;font-weight:700;margin:0 0 6px;text-shadow:0 2px 12px rgba(0,0,0,.6);}',
            '.od-meta{font-size:.85rem;color:rgba(255,255,255,.72);margin-bottom:8px;}',
            '.od-ov{font-size:.88rem;line-height:1.4;color:rgba(255,255,255,.8);margin-bottom:14px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;max-width:640px;}',
            '.od-actions{display:flex;gap:10px;pointer-events:auto;}',
            '.od-btn{border:0;border-radius:999px;padding:11px 22px;font-size:.95rem;font-weight:600;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px;}',
            '.od-btn.od-primary{background:#fff;color:#000;}',
            '.od-btn.od-ghost{background:rgba(255,255,255,.16);color:#fff;backdrop-filter:blur(8px);}',
            '.od-btn .material-icons{font-size:1.25rem;}',
            '.od-top{position:absolute;top:0;left:0;right:0;z-index:5;display:flex;align-items:center;justify-content:space-between;padding:max(14px,env(safe-area-inset-top)) 14px 10px 20px;pointer-events:none;}',
            '.od-top-title{font-size:1.05rem;font-weight:700;letter-spacing:.3px;text-shadow:0 1px 8px rgba(0,0,0,.7);}',
            '.od-round{pointer-events:auto;width:42px;height:42px;border-radius:50%;border:0;background:rgba(0,0,0,.5);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;backdrop-filter:blur(8px);padding:0;}',
            '.od-round .material-icons{font-size:1.5rem;}',
            '#owlfin-discover-sound{position:absolute;right:14px;bottom:max(150px,calc(env(safe-area-inset-bottom) + 150px));z-index:5;}',
            '.od-status{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.65);font-size:.95rem;pointer-events:none;}',
            '#owlfin-discover-btn{display:flex;align-items:center;width:100%;padding:0;border:0;background:none;cursor:pointer;color:rgba(255,255,255,.87);font-size:1rem;font-family:inherit;text-align:left;transition:background .15s;}',
            '#owlfin-discover-btn:hover{background:rgba(255,255,255,.05);}',
            '#owlfin-discover-btn .od-di{font-family:"Material Icons";font-size:1.35rem;padding:10px 16px 10px 20px;color:rgba(255,255,255,.55);line-height:1;flex-shrink:0;}',
            '#owlfin-discover-btn .od-dt{padding:10px 0;}'
        ].join('\n');
        document.head.appendChild(s);
    }

    function buildOverlay() {
        if (overlay) return;
        overlay = el('div');
        overlay.id = 'owlfin-discover-overlay';

        var top = el('div', 'od-top');
        top.appendChild(el('div', 'od-top-title', esc(L('title'))));
        var x = el('button', 'od-round', '<span class="material-icons">close</span>');
        x.id = 'owlfin-discover-close';
        x.title = L('close');
        x.addEventListener('click', closeOverlay);
        top.appendChild(x);

        feed = el('div');
        feed.id = 'owlfin-discover-feed';

        var snd = el('button', 'od-round', '<span class="material-icons">volume_off</span>');
        snd.id = 'owlfin-discover-sound';
        snd.title = L('sound');
        snd.addEventListener('click', function () {
            muted = !muted;
            snd.firstChild.textContent = muted ? 'volume_off' : 'volume_up';
            if (active && active.iframe) post(active.iframe, muted ? 'mute' : 'unMute');
        });

        overlay.appendChild(feed);
        overlay.appendChild(top);
        overlay.appendChild(snd);
        document.body.appendChild(overlay);
    }

    function post(iframe, func) {
        try { iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: '' }), '*'); } catch (e) { /* ignore */ }
    }

    function openOverlay() {
        var c = api();
        if (!c || !c.getCurrentUserId || !c.getCurrentUserId()) return;
        injectCSS();
        buildOverlay();
        closeSidebar();
        sessionToken++;
        var token = sessionToken;
        feed.innerHTML = '';
        cards = [];
        active = null;
        cursor = 0;
        ids = null;
        feed.appendChild(el('div', 'od-status', esc(L('loading'))));
        overlay.classList.add('od-open');
        document.documentElement.classList.add('od-lock');
        openState = true;
        setupObserver();

        fetchAllIds().then(function (list) {
            if (token !== sessionToken) return;
            if (!list.length) { feed.innerHTML = ''; feed.appendChild(el('div', 'od-status', esc(L('empty')))); return; }
            feed.innerHTML = '';
            return loadBlock(token).then(function () {
                if (token === sessionToken && !cards.length) {
                    feed.appendChild(el('div', 'od-status', esc(L('empty') + (lastErr ? ' [' + lastErr + ']' : ''))));
                }
            });
        }).catch(function (e) {
            console.warn('[Owlfin JellyTok]', e);
            feed.innerHTML = '';
            feed.appendChild(el('div', 'od-status', esc(L('empty') + ' [' + (e && (e.message || e.status) || e) + ']')));
        });
    }

    function closeOverlay() {
        if (!overlay) return;
        sessionToken++;
        detach(active);
        active = null;
        if (observer) { observer.disconnect(); observer = null; }
        overlay.classList.remove('od-open');
        document.documentElement.classList.remove('od-lock');
        feed.innerHTML = '';
        cards = [];
        openState = false;
    }

    function closeSidebar() {
        var mask = document.querySelector('.tmla-mask.backdrop');
        if (mask) { mask.click(); return; }
        var drawer = document.querySelector('.mainDrawer');
        if (drawer) { drawer.classList.remove('drawer-open'); drawer.classList.remove('touch-menu-la'); }
        var backdrop = document.querySelector('.MuiBackdrop-root');
        if (backdrop) backdrop.click();
    }

    function loadBlock(token) {
        if (loading || !ids || cursor >= ids.length) return Promise.resolve();
        loading = true;
        var slice = ids.slice(cursor, cursor + BLOCK);
        cursor += slice.length;
        return fetchItems(slice).then(function (items) {
            if (token !== sessionToken) return;
            items.forEach(function (it) { addCard(it); });
        }).catch(function (e) { console.warn('[Owlfin JellyTok]', e); lastErr = 'blocco: ' + (e && (e.message || e.status) || e); })
            .then(function () { loading = false; });
    }

    function addCard(item) {
        var card = el('section', 'od-card');
        var bgUrl = imgUrl(item, 'Primary', 400) || imgUrl(item, 'Backdrop', 640);
        var bg = el('div', 'od-bg');
        if (bgUrl) bg.style.backgroundImage = 'url("' + bgUrl + '")';
        var stage = el('div', 'od-stage');
        var stageImg = imgUrl(item, 'Backdrop', 1280) || imgUrl(item, 'Primary', 800);
        if (stageImg) stage.style.backgroundImage = 'url("' + stageImg + '")';

        var meta = [];
        if (item.ProductionYear) meta.push(item.ProductionYear);
        if (item.OfficialRating) meta.push(item.OfficialRating);
        if (item.CommunityRating) meta.push('★ ' + item.CommunityRating.toFixed(1));
        if (item.Genres && item.Genres.length) meta.push(item.Genres.slice(0, 2).join(' · '));

        var info = el('div', 'od-info');
        info.innerHTML =
            '<div class="od-kind">' + esc(item.Type === 'Series' ? L('series') : L('movie')) + '</div>' +
            '<h2 class="od-title">' + esc(item.Name) + '</h2>' +
            '<div class="od-meta">' + esc(meta.join('  ·  ')) + '</div>' +
            (item.Overview ? '<div class="od-ov">' + esc(item.Overview) + '</div>' : '');
        var actions = el('div', 'od-actions');
        var watch = el('button', 'od-btn od-primary', '<span class="material-icons">play_arrow</span>' + esc(L('watch')));
        watch.addEventListener('click', function () { goToItem(item); });
        actions.appendChild(watch);
        info.appendChild(actions);

        card.appendChild(bg);
        card.appendChild(stage);
        card.appendChild(el('div', 'od-grad'));
        card.appendChild(info);

        var rec = { el: card, stage: stage, item: item, iframe: null, tag: null, paused: false, keys: undefined, ki: 0, idx: cards.length };
        card.__od = rec;
        stage.addEventListener('click', function () { togglePause(rec); });
        cards.push(rec);
        feed.appendChild(card);
        if (observer) observer.observe(card);
    }

    function setupObserver() {
        if (observer) observer.disconnect();
        observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (!en.isIntersecting || en.intersectionRatio < 0.65) return;
                var rec = en.target.__od;
                if (rec && rec !== active) activate(rec);
            });
        }, { root: feed, threshold: [0.65] });
    }

    function activate(rec) {
        detach(active);
        active = rec;
        attach(rec);
        for (var i = 1; i <= 2; i++) { var n = cards[rec.idx + i]; if (n) getTrailer(n.item); }
        if (rec.idx >= cards.length - PREFETCH_AT) loadBlock(sessionToken);
    }

    function setTag(rec, text) {
        if (!text) { if (rec.tag) { rec.tag.remove(); rec.tag = null; } return; }
        if (!rec.tag) { rec.tag = el('div', 'od-tag'); rec.stage.appendChild(rec.tag); }
        rec.tag.textContent = text;
    }

    function attach(rec) {
        var token = sessionToken;
        var p = rec.keys !== undefined ? Promise.resolve(rec.keys) : getTrailer(rec.item);
        p.then(function (keys) {
            rec.keys = keys;
            if (token !== sessionToken || active !== rec) return;
            if (!keys.length) { setTag(rec, L('noTrailer')); return; }
            if (rec.iframe) return;
            play(rec);
        });
    }

    function play(rec) {
        var key = rec.keys[rec.ki || 0];
        if (!key) { setTag(rec, L('noTrailer')); return; }
        var f = document.createElement('iframe');
        f.allow = 'autoplay; encrypted-media; picture-in-picture';
        f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        f.src = 'https://www.youtube-nocookie.com/embed/' + key +
            '?autoplay=1&mute=' + (muted ? 1 : 0) +
            '&controls=0&loop=1&playlist=' + key +
            '&playsinline=1&modestbranding=1&rel=0&iv_load_policy=3&disablekb=1&fs=0' +
            '&enablejsapi=1&origin=' + encodeURIComponent(location.origin);
        f.addEventListener('load', function () {
            try { f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'); } catch (e) { /* ignore */ }
            setTimeout(function () { f.classList.add('od-ready'); }, 700);
        });
        rec.iframe = f;
        rec.paused = false;
        rec.stage.appendChild(f);
    }

    function detach(rec) {
        if (!rec) return;
        if (rec.iframe) { rec.iframe.remove(); rec.iframe = null; }
        setTag(rec, null);
        rec.paused = false;
    }

    function togglePause(rec) {
        if (!rec.iframe) return;
        rec.paused = !rec.paused;
        post(rec.iframe, rec.paused ? 'pauseVideo' : 'playVideo');
    }

    window.addEventListener('message', function (e) {
        if (!active || !active.iframe || e.source !== active.iframe.contentWindow) return;
        var d = e.data;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch (x) { return; } }
        if (d && d.event === 'onError') {
            var rec = active;
            rec.iframe.remove();
            rec.iframe = null;
            rec.ki = (rec.ki || 0) + 1;
            if (rec.keys && rec.ki < rec.keys.length) play(rec);
            else setTag(rec, L('noTrailer'));
        }
    });

    function goToItem(item) {
        closeOverlay();
        setTimeout(function () {
            try {
                if (window.require) {
                    window.require(['appRouter'], function (appRouter) { appRouter.showItem(item, item.ServerId); });
                    return;
                }
            } catch (e) { /* fallback sotto */ }
            location.hash = '#/details?id=' + item.Id + '&serverId=' + (item.ServerId || '');
        }, 60);
    }

    document.addEventListener('keydown', function (e) {
        if (!openState) return;
        if (e.key === 'Escape') { closeOverlay(); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            var h = feed.clientHeight;
            feed.scrollBy({ top: e.key === 'ArrowDown' ? h : -h, behavior: 'smooth' });
        }
    });

    function injectMuiEntry(muiDrawer) {
        if (document.getElementById('owlfin-discover-mui')) return;
        var item = el('div', 'MuiListItemButton-root', '<span class="material-icons" style="font-size:1.35rem;opacity:.8;">explore</span><span>' + esc(L('menu')) + '</span>');
        item.id = 'owlfin-discover-mui';
        item.setAttribute('role', 'button');
        item.tabIndex = 0;
        item.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 16px;cursor:pointer;width:85%;margin:3px auto;list-style:none;';
        var go = function (e) { e.preventDefault(); e.stopPropagation(); openOverlay(); };
        item.addEventListener('click', go);
        item.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') go(e); });
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
        btn.addEventListener('click', function (e) { e.preventDefault(); e.stopImmediatePropagation(); openOverlay(); }, true);
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

    window.owlfinDiscoverOpen = openOverlay;
})();
