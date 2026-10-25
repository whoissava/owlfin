/**
 * Sfoglia Generi — pagina a generi con banner e carosello (Owlfin)
 *
 * Per ogni genere presente sul server: titolo, banner (immagine a sinistra, trama a destra)
 * e sotto un carosello dei titoli del genere. Il carosello scorre da solo e a mano, e il banner
 * segue il titolo in primo piano. Toggle via Configuration.GenresEnabled.
 * Con Configuration.GenresOnHome le stesse sezioni compaiono anche in fondo alla home.
 *
 * @version 2.3.0
 * @license GPL-3.0
 */
(function () {
    'use strict';

    if (window.__owlfinGenresLoaded) return;
    window.__owlfinGenresLoaded = true;

    // ── i18n ────────────────────────────────────────────────────────
    var LANG = (navigator.language || 'it').split('-')[0];
    var I18N = {
        it: { menu: 'Sfoglia Generi', title: 'Sfoglia generi', all: 'Tutto', movies: 'Film', series: 'Serie TV', film: 'FILM', serie: 'SERIE',
              details: 'Dettagli', viewAll: 'Vedi tutti', back: 'Indietro', noGenres: 'Nessun genere trovato', error: 'Errore nel caricamento', retry: 'Riprova',
              notAuth: 'Non autenticato', prev: 'Precedente', next: 'Successivo' },
        en: { menu: 'Browse Genres', title: 'Browse genres', all: 'All', movies: 'Movies', series: 'TV Shows', film: 'MOVIE', serie: 'SERIES',
              details: 'Details', viewAll: 'See all', back: 'Back', noGenres: 'No genres found', error: 'Loading error', retry: 'Retry',
              notAuth: 'Not authenticated', prev: 'Previous', next: 'Next' }
    };
    var t = I18N[LANG] || I18N.en;

    // Nomi dei generi in italiano: i generi inglesi (es. "Action") si uniscono a quelli italiani ("Azione")
    var GENRE_IT = {
        'action': 'Azione', 'adventure': 'Avventura', 'animation': 'Animazione', 'comedy': 'Commedia', 'crime': 'Crime',
        'documentary': 'Documentario', 'documentaries': 'Documentario', 'documentari': 'Documentario',
        'drama': 'Dramma', 'drammatico': 'Dramma', 'family': 'Famiglia', 'fantasy': 'Fantasy', 'history': 'Storia', 'historical': 'Storia',
        'horror': 'Horror', 'music': 'Musica', 'musical': 'Musical', 'mystery': 'Mistero', 'romance': 'Romantico', 'romantic': 'Romantico',
        'science fiction': 'Fantascienza', 'sci-fi': 'Fantascienza', 'scifi': 'Fantascienza', 'tv movie': 'Film TV',
        'thriller': 'Thriller', 'war': 'Guerra', 'western': 'Western', 'biography': 'Biografico', 'film-noir': 'Noir', 'film noir': 'Noir',
        'sport': 'Sport', 'short': 'Cortometraggio', 'reality': 'Reality', 'reality-tv': 'Reality', 'talk': 'Talk show', 'talk-show': 'Talk show',
        'game-show': 'Game show', 'news': 'Notizie', 'soap': 'Soap opera', 'kids': 'Bambini', 'children': 'Bambini',
        'action & adventure': 'Azione e Avventura', 'sci-fi & fantasy': 'Fantascienza e Fantasy', 'war & politics': 'Guerra e Politica'
    };

    // raggruppa i generi per nome italiano: { Id, Name (italiano), names: [nomi reali sul server] }
    function groupGenres(list) {
        if (LANG !== 'it') {
            return list.map(function (g) { return { Id: g.Id, Name: g.Name, names: [g.Name] }; });
        }
        var map = {}, out = [];
        list.forEach(function (g) {
            var nm = String(g.Name == null ? '' : g.Name);
            if (!nm) return;
            var disp = GENRE_IT[nm.toLowerCase().trim()] || nm;
            var key = disp.toLowerCase();
            var e = map[key];
            if (!e) { e = map[key] = { Id: g.Id, Name: disp, names: [] }; out.push(e); }
            e.names.push(nm);
            if (nm.toLowerCase() === key) e.Id = g.Id;      // il genere gia' in italiano da' l'indirizzo della lista nativa
        });
        out.forEach(function (e) {   // prima il nome italiano, poi gli altri
            var k = e.Name.toLowerCase();
            e.names.sort(function (a, b) { return (a.toLowerCase() === k ? 0 : 1) - (b.toLowerCase() === k ? 0 : 1); });
        });
        out.sort(function (a, b) { return a.Name.localeCompare(b.Name, 'it'); });
        return out;
    }

    function shuffle(a) {
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var x = a[i]; a[i] = a[j]; a[j] = x;
        }
        return a;
    }

    var PAGE_ID = 'owlfin-gp';
    var AUTO_MS = 6500;       // ogni quanto avanza da solo il carosello
    var IDLE_MS = 12000;      // pausa dopo un gesto dell'utente

    // ── util ────────────────────────────────────────────────────────
    function api() { return window.ApiClient || null; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
    function reduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }

    function getCreds() {
        try {
            var c = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
            var sv = (c.Servers || [])[0] || {};
            return { token: sv.AccessToken, userId: sv.UserId, serverId: sv.Id,
                     base: (sv.ManualAddress || sv.LocalAddress || location.origin).replace(/\/+$/, '') };
        } catch (e) { return {}; }
    }
    function userId() { var c = api(); return (c && c.getCurrentUserId && c.getCurrentUserId()) || getCreds().userId || ''; }
    function serverId() { var c = api(); return (c && c.serverId && c.serverId()) || getCreds().serverId || ''; }
    function urlFor(path) {
        var c = api();
        if (c && c.getUrl) return c.getUrl(path);
        return getCreds().base + '/' + path;
    }
    function jf(path) {
        var c = api(), cr = getCreds();
        var tok = (c && c.accessToken && c.accessToken()) || cr.token || '';
        if (!tok) return Promise.reject(new Error('auth'));
        return fetch(urlFor(path), { headers: { 'Authorization': 'MediaBrowser Token="' + tok + '"', 'X-Emby-Token': tok } })
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    }
    function fmtRuntime(ticks) {
        var m = Math.round((ticks || 0) / 600000000);
        if (!m) return '';
        return m >= 60 ? Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '') : m + ' min';
    }

    // ── immagini ────────────────────────────────────────────────────
    function backdropUrl(it) {
        var tag = it.BackdropImageTags && it.BackdropImageTags[0];
        if (tag) return urlFor('Items/' + it.Id + '/Images/Backdrop/0?fillWidth=1280&quality=85&tag=' + encodeURIComponent(tag));
        var p = it.ImageTags && it.ImageTags.Primary;
        if (p) return urlFor('Items/' + it.Id + '/Images/Primary?fillWidth=800&quality=85&tag=' + encodeURIComponent(p));
        return '';
    }
    function posterUrl(it) {
        var p = it.ImageTags && it.ImageTags.Primary;
        if (p) return urlFor('Items/' + it.Id + '/Images/Primary?fillWidth=300&fillHeight=450&quality=90&tag=' + encodeURIComponent(p));
        var tag = it.BackdropImageTags && it.BackdropImageTags[0];
        if (tag) return urlFor('Items/' + it.Id + '/Images/Backdrop/0?fillWidth=400&quality=80&tag=' + encodeURIComponent(tag));
        return '';
    }

    // ── CSS ─────────────────────────────────────────────────────────
    function injectCSS() {
        if (document.getElementById('gb-nf-css')) return;
        var s = document.createElement('style');
        s.id = 'gb-nf-css';
        s.textContent = [
            // pagina: occupa l'area sotto la barra nativa di Jellyfin
            '.og-root{--ac:#22d3ee;--tx:#f3f6fa;--mut:rgba(243,246,250,.62);color:var(--tx);font-family:inherit;-webkit-tap-highlight-color:transparent;}',
            '#owlfin-gp{position:fixed;z-index:1000;display:none;flex-direction:column;}',
            '#owlfin-gp.og-open{display:flex;animation:ogIn .22s ease both;}',
            '@keyframes ogIn{from{opacity:0}to{opacity:1}}',
            '.og-root *{box-sizing:border-box;}',
            ':where(.og-root) button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;}',
            '.og-scroll{flex:1;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;scrollbar-width:thin;}',
            '.og-list{max-width:1500px;margin:0 auto;padding:4px clamp(12px,3vw,40px) 60px;}',
            '.og-g{padding-top:22px;}',
            '.og-gh{display:flex;align-items:center;gap:14px;margin:0 0 12px;min-width:0;}',
            '.og-gt{margin:0;min-width:0;font-size:clamp(1.35rem,3.4vw,2.2rem);font-weight:800;letter-spacing:.05em;text-transform:uppercase;line-height:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '.og-all{flex:none;display:inline-flex;align-items:center;gap:2px;padding:7px 8px 7px 14px;border-radius:999px;font-size:.8rem;font-weight:700;white-space:nowrap;background:rgba(34,211,238,.16);box-shadow:inset 0 0 0 1px rgba(34,211,238,.5);transition:background .15s;}',
            '.og-all:hover{background:rgba(34,211,238,.3);}',
            '.og-all:active{background:rgba(34,211,238,.4);}',
            '.og-skel{height:clamp(230px,30vw,380px);border-radius:18px;background:linear-gradient(100deg,rgba(255,255,255,.04) 30%,rgba(255,255,255,.09) 50%,rgba(255,255,255,.04) 70%);background-size:200% 100%;animation:ogSh 1.4s linear infinite;}',
            '@keyframes ogSh{from{background-position:200% 0}to{background-position:-200% 0}}',
            // banner: 75% immagine, 25% trama
            '.og-b{position:relative;display:grid;grid-template-columns:3fr 1fr;height:clamp(230px,30vw,380px);border-radius:18px;overflow:hidden;background:#0c1118;box-shadow:0 12px 34px rgba(0,0,0,.4);}',
            '.og-bi{position:relative;overflow:hidden;cursor:pointer;background:#0c1118;}',
            '.og-bl{position:absolute;inset:0;background-size:cover;background-position:center 22%;opacity:0;transition:opacity .6s ease;}',
            '.og-bl.on{opacity:1;}',
            '.og-bi:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(12,17,24,0) 55%,#0c1118 100%),linear-gradient(0deg,rgba(12,17,24,.55),rgba(12,17,24,0) 40%);pointer-events:none;}',
            '.og-count{position:absolute;left:14px;bottom:12px;z-index:2;font-size:.72rem;font-weight:700;letter-spacing:.06em;color:#fff;background:rgba(0,0,0,.45);padding:3px 9px;border-radius:999px;}',
            '.og-bt{position:relative;display:flex;flex-direction:column;justify-content:center;gap:8px;padding:clamp(12px,1.6vw,22px);min-width:0;background:linear-gradient(180deg,#0c1118,#10161f);transition:opacity .22s ease;}',
            '.og-bt.fade{opacity:0;}',
            '.og-chips{display:flex;flex-wrap:wrap;gap:5px;}',
            '.og-chip{display:inline-flex;align-items:center;padding:3px 9px;border-radius:999px;font-size:.66rem;font-weight:800;letter-spacing:.06em;background:rgba(34,211,238,.18);color:#67e8f9;}',
            '.og-chip.n{background:rgba(255,255,255,.1);color:var(--mut);}',
            '.og-bn{margin:0;font-size:clamp(1.05rem,1.7vw,1.5rem);font-weight:800;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
            '.og-bm{font-size:.8rem;color:var(--mut);display:flex;flex-wrap:wrap;gap:3px 10px;align-items:center;}',
            '.og-star{color:#fcd34d;font-weight:700;}',
            '.og-bp{margin:0;font-size:clamp(.78rem,1vw,.9rem);line-height:1.5;color:rgba(243,246,250,.82);display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;}',
            '.og-open-btn{align-self:flex-start;margin-top:4px;padding:9px 18px;border-radius:999px;font-weight:700;font-size:.82rem;background:rgba(34,211,238,.22);box-shadow:inset 0 0 0 1px rgba(34,211,238,.6);}',
            '.og-open-btn:hover{background:rgba(34,211,238,.34);}',
            // carosello
            '.og-railw{position:relative;}',
            '.og-rail{position:relative;display:flex;gap:12px;overflow-x:auto;overflow-y:hidden;margin:0 -12px;padding:18px 12px 16px;scroll-padding-inline:12px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;scrollbar-width:none;}',
            '.og-rail::-webkit-scrollbar{display:none;}',
            '.og-c{flex:none;width:clamp(104px,13vw,150px);text-align:left;scroll-snap-align:start;transition:transform .2s ease;}',
            '.og-c .og-p{display:block;width:100%;aspect-ratio:2/3;border-radius:11px;overflow:hidden;background:rgba(255,255,255,.07);box-shadow:0 6px 16px rgba(0,0,0,.35);transition:box-shadow .2s ease;}',
            '.og-c img{width:100%;height:100%;object-fit:cover;display:block;}',
            '.og-c .og-ct{display:block;margin-top:7px;font-size:.76rem;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color .2s;}',
            '.og-c.on{transform:translateY(-4px);}',
            '.og-c.on .og-p{box-shadow:0 0 0 2.5px var(--ac),0 10px 24px rgba(34,211,238,.28);}',
            '.og-c.on .og-ct{color:#fff;font-weight:600;}',
            '.og-arr{position:absolute;top:calc(50% - 22px);width:40px;height:40px;border-radius:50%;display:none;align-items:center;justify-content:center;background:rgba(10,14,20,.78);box-shadow:0 4px 14px rgba(0,0,0,.5);z-index:2;}',
            '.og-arr.l{left:-4px}.og-arr.r{right:-4px}',
            '@media (hover:hover) and (pointer:fine){.og-arr{display:flex;opacity:0;transition:opacity .15s}.og-railw:hover .og-arr{opacity:1}}',
            '.og-msg{padding:60px 20px;text-align:center;color:var(--mut);font-size:.95rem;}',
            '.og-msg button{margin-top:14px;padding:9px 18px;border-radius:999px;background:rgba(255,255,255,.12);font-weight:600;}',
            '.og-spin{width:28px;height:28px;border-radius:50%;border:3px solid rgba(255,255,255,.15);border-top-color:#fff;animation:ogSp .7s linear infinite;margin:50px auto;}',
            '@keyframes ogSp{to{transform:rotate(360deg)}}',
            // telefono: immagine sopra, trama sotto
            '@media (max-width:720px){.og-b{display:block;height:auto;}.og-bi{aspect-ratio:16/9;}.og-bi:after{background:linear-gradient(0deg,#0c1118 0%,rgba(12,17,24,0) 55%);}.og-bt{padding:12px 14px 16px;background:#0c1118;}.og-bp{-webkit-line-clamp:4;}.og-all{padding:6px 6px 6px 12px;font-size:.76rem}}',
            '@media (prefers-reduced-motion:reduce){.og-root *{animation:none!important;transition:none!important;}}',
            // sezione in fondo alla home
            '.og-home{box-sizing:border-box;display:block;width:100%;padding:26px clamp(12px,3.3vw,44px) 56px;}',
            '.og-home .og-list{max-width:none;margin:0;padding:0;}',
            '.og-hh{margin:0 0 2px;font-size:clamp(1.15rem,2.4vw,1.5rem);font-weight:700;line-height:1.2;}',
            // voce nel menu (client classico)
            '#gb-drawer-section { padding: 0 0 4px 0; }',
            '#gb-drawer-section .gb-section-label { font-size: 0.72rem; font-weight: 600; color: rgba(255,255,255,0.35); letter-spacing: 1.2px; text-transform: uppercase; padding: 16px 20px 4px; font-family: inherit; }',
            '#gb-drawer-btn { display: flex; align-items: center; gap: 0; padding: 0; color: rgba(255,255,255,0.85); cursor: pointer; border: none; background: none; width: 100%; text-align: left; font-size: 1rem; font-family: inherit; font-weight: 400; transition: background 0.15s; letter-spacing: normal; }',
            '#gb-drawer-btn:hover { background: rgba(255,255,255,0.05); }',
            '#gb-drawer-btn .gb-di { font-family: "Material Icons"; font-size: 1.35rem; padding: 10px 16px 10px 20px; color: rgba(255,255,255,0.55); font-weight: normal; font-style: normal; line-height: 1; flex-shrink: 0; }',
            '#gb-drawer-btn .gb-dt { padding: 10px 0; color: rgba(255,255,255,0.87); font-size: 1rem; }'
        ].join('\n');
        document.head.appendChild(s);
    }

    // ── stato ───────────────────────────────────────────────────────
    var HOME = window.__owlfin_genres_home__ === true;   // impostazione "generi in fondo alla home"
    var page = null, view = null;
    var type = 'All';   // film e serie insieme
    var views = [];     // tutte le viste vive: pagina intera e sezione in home
    var pushed = false, pendingThen = null, pendingTimer = 0;

    function typeParam() { return type === 'Movie' ? 'Movie' : type === 'Series' ? 'Series' : 'Movie,Series'; }

    // ── posizione sotto l'header nativo (pagina intera) ─────────────
    function layout() {
        if (!page) return;
        var top = 0, left = 0;
        // più elementi possono avere queste classi (anche nascosti): vale il più basso fra quelli visibili in alto
        Array.prototype.forEach.call(document.querySelectorAll('.skinHeader, .MuiAppBar-root, header'), function (h) {
            if (page.contains(h)) return;
            var hr = h.getBoundingClientRect();
            if (hr.height < 1 || hr.top > 8) return;
            if (hr.bottom > top && hr.bottom < window.innerHeight / 2) top = Math.round(hr.bottom);
        });
        // drawer fisso a sinistra (desktop): la pagina parte dopo di lui
        var dk = document.querySelector('.MuiDrawer-docked .MuiDrawer-paper');
        if (dk) { var dr = dk.getBoundingClientRect(); if (dr.right > 1 && dr.width < window.innerWidth / 2) left = Math.round(dr.right); }
        var bg = '';
        try { bg = getComputedStyle(document.body).backgroundColor; } catch (e) { /* ignore */ }
        if (!bg || bg === 'transparent' || /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg)) bg = '#101010';
        page.style.top = top + 'px';
        page.style.left = left + 'px';
        page.style.right = '0';
        page.style.bottom = '0';
        page.style.background = bg;
    }

    // ── vista: generi con banner e carosello ────────────────────────
    // host = elemento che contiene i generi; root = contenitore che scorre (null = la finestra);
    // isOn() = la vista e' visibile e va fatta scorrere da sola.
    function makeView(host, root, isOn) {
        var v = { host: host, isOn: isOn, onEmpty: null };
        var blocks = [], seq = 0, io = null, queue = [], active = 0;

        function setMsg(html) { host.innerHTML = html; }

        function load() {
            var my = ++seq;
            teardownBlocks();
            setMsg('<div class="og-spin"></div>');
            jf('Genres?userId=' + encodeURIComponent(userId()) + '&Recursive=true&SortBy=SortName&SortOrder=Ascending&IncludeItemTypes=' + typeParam())
                .then(function (j) {
                    if (my !== seq) return;
                    var genres = groupGenres((j && j.Items) || []);
                    if (!genres.length) { empty(); return; }
                    host.innerHTML = '';
                    genres.forEach(function (g) { addBlock(g, my); });
                }, function (err) {
                    if (my !== seq) return;
                    var auth = err && err.message === 'auth';
                    setMsg('<div class="og-msg">' + esc(auth ? t.notAuth : t.error) + (auth ? '' : '<br><button type="button" data-act="retry">' + esc(t.retry) + '</button>') + '</div>');
                });
        }

        function empty() {
            if (v.onEmpty) v.onEmpty(); else setMsg('<div class="og-msg">' + esc(t.noGenres) + '</div>');
        }

        function teardownBlocks() {
            if (io) { io.disconnect(); io = null; }
            queue = []; active = 0;
            blocks = [];
        }

        function addBlock(genre, my) {
            var sec = document.createElement('section');
            sec.className = 'og-g';
            sec.innerHTML = '<div class="og-gh"><h2 class="og-gt">' + esc(genre.Name) + '</h2>' +
                '<button type="button" class="og-all" data-act="all" aria-label="' + esc(t.viewAll + ': ' + genre.Name) + '">' + esc(t.viewAll) + chev('r', 18) + '</button></div>' +
                '<div class="og-slot"><div class="og-skel"></div></div>';
            host.appendChild(sec);
            var b = { genre: genre, el: sec, my: my, loaded: false, items: [], idx: 0, visible: false, nextAt: 0, progUntil: 0, scrollT: 0 };
            blocks.push(b);
            observe(b);
        }

        function observe(b) {
            if (!io) {
                io = new IntersectionObserver(function (entries) {
                    entries.forEach(function (en) {
                        var bb = en.target.__og;
                        if (!bb) return;
                        bb.visible = en.isIntersecting;
                        if (en.isIntersecting && !bb.loaded && !bb.loading) { queue.push(bb); pump(); }
                    });
                }, { root: root, rootMargin: '600px 0px', threshold: 0 });
            }
            b.el.__og = b;
            io.observe(b.el);
        }

        function pump() {
            while (active < 2 && queue.length) {
                var b = queue.shift();
                if (b.my !== seq || b.loaded) continue;
                active++;
                loadBlock(b);
            }
        }

        function itemsPath(name) {
            return 'Users/' + encodeURIComponent(userId()) + '/Items?Recursive=true&IncludeItemTypes=' + typeParam() +
                '&Genres=' + encodeURIComponent(name) + '&SortBy=Random' +
                '&Fields=Overview&ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop&EnableUserData=false&EnableTotalRecordCount=false';
        }

        // un genere puo' esistere con piu' nomi (italiano e inglese): una richiesta per nome, poi si uniscono senza doppioni
        function loadBlock(b) {
            b.loading = true;
            var names = b.genre.names || [b.genre.Name];
            var results = new Array(names.length), left = names.length, okAny = false;
            names.forEach(function (nm, i) {
                jf(itemsPath(nm)).then(function (res) { results[i] = (res && res.Items) || []; okAny = true; }, function () { results[i] = null; })
                    .then(function () { if (--left === 0) done(); });
            });
            function done() {
                b.loading = false; b.loaded = true; active--;
                if (b.my !== seq) { pump(); return; }
                if (!okAny) { removeBlock(b); pump(); return; }
                var seen = {}, all = [];
                results.forEach(function (r) {
                    (r || []).forEach(function (it) { if (it && it.Id && !seen[it.Id]) { seen[it.Id] = 1; all.push(it); } });
                });
                if (names.length > 1) shuffle(all);
                b.items = all.filter(function (it) { return (it.ImageTags && it.ImageTags.Primary) || (it.BackdropImageTags && it.BackdropImageTags.length); });
                if (b.items.length < 2) { removeBlock(b); } else renderBlock(b);
                pump();
            }
        }

        function removeBlock(b) {
            if (io) io.unobserve(b.el);
            if (b.el.parentNode) b.el.parentNode.removeChild(b.el);
            blocks = blocks.filter(function (x) { return x !== b; });
            if (!blocks.length && !host.children.length) empty();
        }

        // ── blocco di un genere ─────────────────────────────────────
        function renderBlock(b) {
            var cards = b.items.map(function (it, i) {
                var src = posterUrl(it);
                return '<button type="button" class="og-c" data-i="' + i + '" aria-label="' + esc(it.Name) + '">' +
                    '<span class="og-p">' + (src ? '<img src="' + esc(src) + '" alt="" loading="lazy" decoding="async">' : '') + '</span>' +
                    '<span class="og-ct">' + esc(it.Name) + '</span></button>';
            }).join('');
            b.el.querySelector('.og-slot').innerHTML =
                '<div class="og-b">' +
                '<div class="og-bi" data-act="open"><div class="og-bl"></div><div class="og-bl"></div><span class="og-count"></span></div>' +
                '<div class="og-bt"></div></div>' +
                '<div class="og-railw"><button type="button" class="og-arr l" data-act="prev" aria-label="' + esc(t.prev) + '">' + chev('l') + '</button>' +
                '<div class="og-rail">' + cards + '</div>' +
                '<button type="button" class="og-arr r" data-act="next" aria-label="' + esc(t.next) + '">' + chev('r') + '</button></div>';
            b.rail = b.el.querySelector('.og-rail');
            b.cards = Array.prototype.slice.call(b.el.querySelectorAll('.og-c'));
            b.layers = b.el.querySelectorAll('.og-bl');
            b.layer = 0;
            b.nextAt = Date.now() + AUTO_MS + Math.random() * 1500;
            b.rail.addEventListener('scroll', function () { onRailScroll(b); }, { passive: true });
            ['touchstart', 'pointerdown', 'wheel'].forEach(function (ev) {
                b.rail.addEventListener(ev, function () { b.nextAt = Date.now() + IDLE_MS; }, { passive: true });
            });
            // il tocco orizzontale resta al carosello e non arriva alla pagina (gesti dell'app)
            ['touchstart', 'touchmove'].forEach(function (ev) {
                b.rail.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true });
            });
            setActive(b, 0, 'init');
        }

        function setActive(b, i, src) {
            i = Math.max(0, Math.min(b.items.length - 1, i));
            var changed = i !== b.idx || src === 'init';
            b.idx = i;
            b.cards.forEach(function (c, k) { c.classList.toggle('on', k === i); });
            if (changed) renderBanner(b, b.items[i], src === 'init');
            var cnt = b.el.querySelector('.og-count');
            if (cnt) cnt.textContent = (i + 1) + ' / ' + b.items.length;
            if (src === 'auto' || src === 'step') scrollRailTo(b, i);
        }

        function renderBanner(b, it, instant) {
            var txt = b.el.querySelector('.og-bt');
            var url = backdropUrl(it);
            // immagine: dissolvenza fra due strati
            if (url) {
                var img = new Image();
                img.onload = function () {
                    if (b.items[b.idx] !== it) return;
                    var next = b.layers[1 - b.layer], prev = b.layers[b.layer];
                    next.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
                    next.classList.add('on');
                    prev.classList.remove('on');
                    b.layer = 1 - b.layer;
                };
                img.src = url;
            } else {
                b.layers[0].classList.remove('on'); b.layers[1].classList.remove('on');
            }
            var fill = function () {
                var meta = [];
                if (it.ProductionYear) meta.push('<span>' + esc(it.ProductionYear) + '</span>');
                if (it.CommunityRating) meta.push('<span class="og-star">★ ' + esc(Number(it.CommunityRating).toFixed(1)) + '</span>');
                var rt = fmtRuntime(it.RunTimeTicks);
                if (rt) meta.push('<span>' + esc(rt) + '</span>');
                txt.innerHTML =
                    '<div class="og-chips"><span class="og-chip">' + esc(it.Type === 'Series' ? t.serie : t.film) + '</span>' +
                    (it.OfficialRating ? '<span class="og-chip n">' + esc(it.OfficialRating) + '</span>' : '') + '</div>' +
                    '<h3 class="og-bn">' + esc(it.Name) + '</h3>' +
                    (meta.length ? '<div class="og-bm">' + meta.join('') + '</div>' : '') +
                    (it.Overview ? '<p class="og-bp">' + esc(it.Overview) + '</p>' : '') +
                    '<button type="button" class="og-open-btn" data-act="open">' + esc(t.details) + '</button>';
                txt.classList.remove('fade');
            };
            if (instant || reduced()) { fill(); return; }
            txt.classList.add('fade');
            setTimeout(function () { if (b.items[b.idx] === it) fill(); }, 200);
        }

        function stepOf(b) {
            if (b.cards.length > 1) return b.cards[1].offsetLeft - b.cards[0].offsetLeft;
            return b.cards[0] ? b.cards[0].offsetWidth : 1;
        }

        function scrollRailTo(b, i) {
            if (!b.cards[i]) return;
            b.progUntil = Date.now() + 900;
            var left = b.cards[i].offsetLeft - b.cards[0].offsetLeft;
            try { b.rail.scrollTo({ left: left, behavior: reduced() ? 'auto' : 'smooth' }); } catch (e) { b.rail.scrollLeft = left; }
        }

        function onRailScroll(b) {
            if (Date.now() < b.progUntil) return;
            clearTimeout(b.scrollT);
            b.scrollT = setTimeout(function () {
                var step = stepOf(b) || 1;
                var max = b.rail.scrollWidth - b.rail.clientWidth;
                var i = b.rail.scrollLeft >= max - 2 ? b.items.length - 1 : Math.round(b.rail.scrollLeft / step);
                b.nextAt = Date.now() + IDLE_MS;
                if (i !== b.idx) setActive(b, i, 'manual');
            }, 90);
        }

        // scorrimento automatico dei caroselli visibili di questa vista
        v.tick = function (now) {
            if (document.visibilityState === 'hidden') return;
            var vr = root ? root.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
            blocks.forEach(function (b) {
                if (!b.rail || !b.items.length) return;
                var r = b.el.getBoundingClientRect();
                var vis = r.bottom > vr.top + 60 && r.top < vr.bottom - 60;
                if (!vis || now < b.nextAt) return;
                b.nextAt = now + AUTO_MS;
                setActive(b, (b.idx + 1) % b.items.length, 'auto');
            });
        };

        v.click = function (e) {
            var tg = e.target;
            if (!tg || !tg.closest) return;
            var b;
            if ((b = tg.closest('[data-act]'))) {
                var act = b.getAttribute('data-act');
                if (act === 'retry') return load();
                var sec = b.closest('.og-g');
                var blk = sec && sec.__og;
                if (!blk) return;
                if (act === 'all') return openGenre(blk.genre);
                if (act === 'open') { var it = blk.items[blk.idx]; if (it) openItem(it.Id); return; }
                if (act === 'prev' || act === 'next') {
                    var n = blk.items.length;
                    blk.nextAt = Date.now() + IDLE_MS;
                    setActive(blk, act === 'next' ? Math.min(n - 1, blk.idx + 1) : Math.max(0, blk.idx - 1), 'step');
                    return;
                }
            }
            if ((b = tg.closest('.og-c'))) {
                var sec2 = b.closest('.og-g'), blk2 = sec2 && sec2.__og;
                var it2 = blk2 && blk2.items[+b.getAttribute('data-i')];
                if (it2) openItem(it2.Id);
            }
        };

        v.load = load;
        v.teardown = function () { seq++; teardownBlocks(); };
        views.push(v);
        return v;
    }

    function chev(d, sz) {
        sz = sz || 20;
        return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (d === 'l' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6') + '"/></svg>';
    }

    function dropView(v) {
        if (!v) return;
        v.teardown();
        views = views.filter(function (x) { return x !== v; });
    }

    // un solo ciclo per tutte le viste: scarta quelle sparite dal DOM, fa scorrere quelle visibili
    function globalTick() {
        views = views.filter(function (v) {
            if (v.host.isConnected) return true;
            v.teardown();
            return false;
        });
        var now = Date.now();
        views.forEach(function (v) { if (v.isOn()) v.tick(now); });
    }
    setInterval(globalTick, 1000);

    // ── apertura / chiusura (pagina intera) ─────────────────────────
    function pageOn() { return !!(page && page.classList.contains('og-open')); }

    function buildPage() {
        var old = document.getElementById(PAGE_ID);
        if (old) old.remove();
        dropView(view);
        page = document.createElement('div');
        page.id = PAGE_ID;
        page.className = 'og-root';
        page.setAttribute('role', 'region');
        page.setAttribute('aria-label', t.title);
        page.innerHTML =
            '<div class="og-scroll"><div class="og-list"></div></div>';
        document.body.appendChild(page);
        view = makeView(page.querySelector('.og-list'), page.querySelector('.og-scroll'), pageOn);
        page.addEventListener('click', function (e) { view.click(e); });
    }

    function closeDrawer() {
        var mask = document.querySelector('.tmla-mask.backdrop');
        if (mask) { mask.click(); return; }
        var bd = document.querySelector('.MuiDrawer-modal .MuiBackdrop-root');
        if (bd) bd.click();
        var drawer = document.querySelector('.mainDrawer');
        if (drawer) { drawer.classList.remove('drawer-open'); drawer.classList.remove('touch-menu-la'); }
    }

    function openPage() {
        injectCSS();
        closeDrawer();
        setTimeout(function () {
            buildPage();
            layout();
            page.classList.add('og-open');
            try { history.pushState({ owlfinGenres: true }, '', location.href); pushed = true; } catch (e) { pushed = false; }
            document.addEventListener('keydown', onKey, true);
            setTimeout(layout, 400);
            setTimeout(layout, 1500);
            view.load();
        }, 250);
    }

    function showPage() {
        if (!page || !document.getElementById(PAGE_ID)) return;
        layout();
        page.classList.add('og-open');
        document.addEventListener('keydown', onKey, true);
    }

    // nasconde la pagina senza toccare la cronologia (si puo' riaprire con "indietro")
    function hidePage() {
        if (!page) return;
        page.classList.remove('og-open');
        document.removeEventListener('keydown', onKey, true);
    }

    // chiusura voluta dall'utente: toglie la voce di cronologia che abbiamo aggiunto
    function closePage(then) {
        if (!pageOn()) { if (typeof then === 'function') then(); return; }
        if (pushed && history.state && history.state.owlfinGenres) {
            pushed = false;
            pendingThen = typeof then === 'function' ? then : null;
            hidePage();
            try { history.back(); } catch (e) { /* ignore */ }
            clearTimeout(pendingTimer);
            pendingTimer = setTimeout(runPending, 450);
        } else {
            hidePage();
            if (typeof then === 'function') then();
        }
    }
    function runPending() {
        clearTimeout(pendingTimer);
        var f = pendingThen; pendingThen = null;
        if (f) f();
    }

    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closePage(); } }

    function openItem(id) {
        if (!id) return;
        var sid = serverId();
        // si nasconde senza tornare indietro: con "indietro" da Dettagli si ritrova la pagina com'era
        hidePage();
        location.hash = '#/details?id=' + encodeURIComponent(id) + (sid ? '&serverId=' + encodeURIComponent(sid) : '');
    }

    // lista nativa di Jellyfin con tutti i titoli del genere
    function openGenre(g) {
        if (!g || !g.Id) return;
        var sid = serverId();
        var q = 'list.html?genreId=' + encodeURIComponent(g.Id) + (sid ? '&serverId=' + encodeURIComponent(sid) : '');
        hidePage();
        try {
            if (window.Dashboard && typeof window.Dashboard.navigate === 'function') { window.Dashboard.navigate(q); return; }
        } catch (e) { /* si ripiega sull'indirizzo */ }
        location.hash = '#/' + q;
    }

    // ── in fondo alla home (impostazione del plugin) ────────────────
    function onHomeRoute() {
        var h = location.hash.toLowerCase();
        return h === '' || h === '#' || h.indexOf('#/home') === 0 || h.indexOf('#!/home') === 0;
    }

    // la home visibile: le vecchie restano nel DOM, nascoste
    function visibleHome() {
        var all = document.querySelectorAll('.homeSectionsContainer');
        for (var i = all.length - 1; i >= 0; i--) {
            var c = all[i];
            if (c.closest('.hide, [hidden]')) continue;
            if (c.getClientRects().length > 0) return c;
        }
        return null;
    }

    var homeMoves = 0, homeMovesFor = null;
    function mountHome() {
        if (!HOME || !onHomeRoute()) return;
        var home = visibleHome();
        if (!home || home.__ogOff || !home.querySelector('.verticalSection')) return;
        var sec = home.querySelector('.og-home');
        if (!sec) {
            // le sezioni rimaste in altre home (nascoste) si buttano via
            Array.prototype.forEach.call(document.querySelectorAll('.og-home'), function (o) { if (o.parentNode) o.parentNode.removeChild(o); });
            injectCSS();
            sec = document.createElement('section');
            sec.id = 'owlfin-gh';
            sec.className = 'og-root og-home';
            sec.innerHTML = '<h2 class="og-hh">' + esc(t.title) + '</h2><div class="og-list"></div>';
            home.appendChild(sec);
            var hv = makeView(sec.querySelector('.og-list'), null, function () {
                return !pageOn() && sec.getClientRects().length > 0 && !sec.closest('.hide, [hidden]');
            });
            // nessun genere o nessun titolo: la sezione sparisce e questa home non viene piu' riprovata
            hv.onEmpty = function () { home.__ogOff = true; if (sec.parentNode) sec.parentNode.removeChild(sec); };
            sec.addEventListener('click', hv.click);
            hv.load();
            return;
        }
        // deve restare l'ultimo elemento della home (altre righe arrivano a pezzi)
        if (home.lastElementChild !== sec) {
            if (homeMovesFor !== home) { homeMovesFor = home; homeMoves = 0; }
            if (homeMoves < 40) { homeMoves++; home.appendChild(sec); }
        }
    }

    if (HOME) {
        setInterval(mountHome, 1500);
        window.addEventListener('hashchange', function () { setTimeout(mountHome, 400); });
        document.addEventListener('viewshow', function () { setTimeout(mountHome, 600); });
        setTimeout(mountHome, 1200);
    }

    // cronologia: "indietro" nasconde, "avanti/indietro" da Dettagli la ripristina
    function sync() {
        var want = !!(history.state && history.state.owlfinGenres);
        if (want) {
            if (page && document.getElementById(PAGE_ID)) { pushed = true; showPage(); }
        } else {
            hidePage();
        }
        if (pendingThen) runPending();
    }
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    window.addEventListener('resize', function () { layout(); });

    // un tocco su una voce del menu laterale (non nostra) chiude la pagina anche se l'indirizzo non cambia
    document.addEventListener('click', function (e) {
        if (!page || !page.classList.contains('og-open')) return;
        var tg = e.target;
        if (!tg || !tg.closest) return;
        var nav = tg.closest('.MuiDrawer-paper, .mainDrawer');
        if (!nav || tg.closest('[data-owlfin-order], #gb-drawer-section')) return;
        if (tg.closest('a, .MuiListItemButton-root')) setTimeout(hidePage, 0);
    }, true);

    // ── voce nel menu laterale ──────────────────────────────────────
    // Jellyfin 12 (MUI): sezione "Owlfin" con voci che clonano quelle native del menu.
    function owlfinMenuAdd(paper, id, order, icn, label, onClick) {
        if (document.getElementById(id)) return;
        var all = Array.prototype.slice.call(paper.querySelectorAll('.MuiListItemButton-root'));
        var natives = all.filter(function (n) { return !n.closest('[data-owlfin-order]'); });
        var ref = natives[1] || natives[0] || null;
        var anchor = ref ? (ref.closest('li') || ref) : null;

        var head = document.getElementById('owlfin-menu-head');
        if (!head) {
            var sub = Array.prototype.slice.call(paper.querySelectorAll('.MuiListSubheader-root'))
                .filter(function (n) { return n.id !== 'owlfin-menu-head' && n.id !== 'gb-mui-subheader'; })[0];
            head = sub ? sub.cloneNode(false) : document.createElement('div');
            head.removeAttribute('id');
            if (!sub) {
                head.className = 'MuiListSubheader-root';
                head.style.cssText = 'padding:16px 20px 4px;list-style:none;';
            }
            head.id = 'owlfin-menu-head';
            head.textContent = 'Owlfin';
            if (anchor) anchor.insertAdjacentElement('afterend', head); else paper.appendChild(head);
        }

        var unit = null, btn = null;
        if (ref) {
            unit = (ref.parentElement && ref.parentElement.tagName === 'LI') ? ref.parentElement : ref;
            unit = unit.cloneNode(true);
            btn = unit.matches('.MuiListItemButton-root') ? unit : unit.querySelector('.MuiListItemButton-root');
        }
        var textEl = btn && (btn.querySelector('.MuiListItemText-primary') || btn.querySelector('.MuiListItemText-root'));
        if (!unit || !btn || !textEl) {
            unit = document.createElement('div');
            unit.className = 'MuiListItemButton-root';
            unit.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 16px;cursor:pointer;width:85%;margin:3px auto;list-style:none;';
            unit.innerHTML = '<span class="material-icons" style="font-size:1.35rem;opacity:.8;">' + icn + '</span><span>' + esc(label) + '</span>';
            btn = unit;
        } else {
            Array.prototype.forEach.call(unit.querySelectorAll('[id]'), function (n) { n.removeAttribute('id'); });
            btn.removeAttribute('href');
            btn.removeAttribute('aria-current');
            btn.classList.remove('Mui-selected', 'active');
            var ic = btn.querySelector('.MuiListItemIcon-root');
            var span = '<span class="material-icons" style="font-size:1.5rem;">' + icn + '</span>';
            if (ic) ic.innerHTML = span; else btn.insertAdjacentHTML('afterbegin', span);
            textEl.textContent = label;
        }
        unit.id = id;
        unit.setAttribute('data-owlfin-order', String(order));
        btn.setAttribute('role', 'button');
        btn.tabIndex = 0;
        btn.style.cursor = 'pointer';
        var go = function (ev) { ev.preventDefault(); ev.stopPropagation(); onClick(); };
        btn.addEventListener('click', go);
        btn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') go(ev); });

        var mine = Array.prototype.slice.call(paper.querySelectorAll('[data-owlfin-order]'));
        var next = mine.filter(function (n) { return Number(n.getAttribute('data-owlfin-order')) > order; })[0];
        if (next) next.insertAdjacentElement('beforebegin', unit);
        else (mine[mine.length - 1] || head).insertAdjacentElement('afterend', unit);
    }

    // Client classico (10.11 e precedenti): struttura legacy con .mainDrawer.
    function injectLegacyMenuEntry(drawer) {
        if (document.getElementById('gb-drawer-section')) return;
        var homeLink = Array.prototype.slice.call(drawer.children).filter(function (el) {
            return el.tagName === 'A' && el.textContent.trim().toLowerCase() === 'home';
        })[0];
        if (!homeLink) return;
        var section = document.createElement('div');
        section.id = 'gb-drawer-section';
        var label = document.createElement('div');
        label.className = 'gb-section-label';
        label.textContent = 'Owlfin';
        var btn = document.createElement('button');
        btn.id = 'gb-drawer-btn';
        btn.innerHTML = '<span class="gb-di">theaters</span><span class="gb-dt">' + esc(t.menu) + '</span>';
        btn.addEventListener('click', function (e) { e.preventDefault(); e.stopImmediatePropagation(); openPage(); }, true);
        section.appendChild(label);
        section.appendChild(btn);
        drawer.insertBefore(section, homeLink.nextSibling);
    }

    function injectMenuEntry() {
        if (document.getElementById('gb-drawer-section') || document.getElementById('gb-mui-drawer-item')) return;
        var mui = document.querySelector('.MuiDrawer-paper');
        if (mui) { owlfinMenuAdd(mui, 'gb-mui-drawer-item', 1, 'theaters', t.menu, openPage); return; }
        var drawer = document.querySelector('.mainDrawer-scrollContainer') || document.querySelector('.mainDrawer');
        if (drawer) injectLegacyMenuEntry(drawer);
    }

    injectCSS();
    document.addEventListener('viewshow', function () { setTimeout(injectMenuEntry, 400); });
    setTimeout(injectMenuEntry, 1000);
    setTimeout(injectMenuEntry, 2500);
    setTimeout(injectMenuEntry, 4000);

    // Il drawer di Jellyfin 12 viene montato/smontato: appena compare lo si riempie.
    try {
        var obsT = 0;
        new MutationObserver(function () { clearTimeout(obsT); obsT = setTimeout(injectMenuEntry, 150); })
            .observe(document.body, { childList: true });
    } catch (e) { /* restano i timer */ }

    window.OwlfinGenres = { open: openPage, close: closePage };
})();
