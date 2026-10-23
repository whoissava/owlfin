/**
 * Calendario uscite — calendario "glass" per Jellyfin
 *
 * Parte di Owlfin. Toggle via Configuration.CalendarEnabled.
 * Dati da /Owlfin/Calendar/* (Radarr, Sonarr e TMDB restano lato server).
 *
 * @version 1.0.0
 * @license GPL-3.0
 */
(function () {
    'use strict';

    if (window.__owlfinCalendarLoaded) return;
    window.__owlfinCalendarLoaded = true;

    // ── i18n ────────────────────────────────────────────────────────
    var LANG = (navigator.language || 'it').split('-')[0];
    var I18N = {
        it: {
            title: 'Calendario', menu: 'Calendario', today: 'Oggi', tomorrow: 'Domani', yesterday: 'Ieri',
            tabCal: 'Calendario', tabAgenda: 'Agenda',
            srcAll: 'Globali', srcArr: 'Richieste',
            kindAll: 'Tutto', kindMovie: 'Film', kindSeries: 'Serie',
            rNext: 'Prossimi 30 giorni', rToday: 'Oggi', rPast: 'Ultimi 30 giorni',
            cinema: 'In sala', digital: 'Digitale', physical: 'Home video', episode: 'Episodio', premiere: 'Debutto serie',
            episodes: 'episodi', movie: 'Film', series: 'Serie TV',
            downloaded: 'Scaricato', waiting: 'In attesa', requested: 'Richiesto', inLibrary: 'In libreria',
            open: 'Apri in Jellyfin', close: 'Chiudi', prev: 'Mese precedente', next: 'Mese successivo',
            releases: 'uscite', release1: 'uscita', noEvents: 'Nessuna uscita in questo giorno', noAgenda: 'Nessuna uscita in questo periodo',
            loading: 'Caricamento…', plot: 'Trama', noPlot: 'Trama non disponibile.',
            setupArr: 'Per vedere le richieste, inserisci URL e API key di Radarr e/o Sonarr nelle impostazioni del plugin Owlfin.',
            setupTmdb: 'Per le uscite globali serve la API key TMDB nelle impostazioni del plugin Owlfin.',
            errSource: 'Fonte non disponibile', errLoad: 'Impossibile caricare il calendario.', errAuth: 'Sessione scaduta: ricarica la pagina.',
            errMissing: 'Il server non ha il calendario: aggiorna il plugin Owlfin e riavvia Jellyfin.',
            retry: 'Riprova', network: 'Rete', min: 'min', filters: 'Filtri'
        },
        en: {
            title: 'Calendar', menu: 'Calendar', today: 'Today', tomorrow: 'Tomorrow', yesterday: 'Yesterday',
            tabCal: 'Calendar', tabAgenda: 'Agenda',
            srcAll: 'Global', srcArr: 'Requested',
            kindAll: 'All', kindMovie: 'Movies', kindSeries: 'Series',
            rNext: 'Next 30 days', rToday: 'Today', rPast: 'Last 30 days',
            cinema: 'In theaters', digital: 'Digital', physical: 'Home video', episode: 'Episode', premiere: 'Series premiere',
            episodes: 'episodes', movie: 'Movie', series: 'TV series',
            downloaded: 'Downloaded', waiting: 'Waiting', requested: 'Requested', inLibrary: 'In library',
            open: 'Open in Jellyfin', close: 'Close', prev: 'Previous month', next: 'Next month',
            releases: 'releases', release1: 'release', noEvents: 'No releases on this day', noAgenda: 'No releases in this period',
            loading: 'Loading…', plot: 'Plot', noPlot: 'No synopsis available.',
            setupArr: 'To see requests, enter the Radarr and/or Sonarr URL and API key in the Owlfin plugin settings.',
            setupTmdb: 'Global releases need the TMDB API key in the Owlfin plugin settings.',
            errSource: 'Source unavailable', errLoad: 'Could not load the calendar.', errAuth: 'Session expired: reload the page.',
            errMissing: 'The server has no calendar: update the Owlfin plugin and restart Jellyfin.',
            retry: 'Retry', network: 'Network', min: 'min', filters: 'Filters'
        }
    };
    var t = I18N[LANG] || I18N.en;
    var LOCALE = LANG === 'it' ? 'it-IT' : (navigator.language || 'en-US');
    var WEEK_START = LANG === 'it' ? 1 : 0;   // lunedi' / domenica

    var PREFS_KEY = 'owlfin_calendar_prefs';
    var OVERLAY_ID = 'owlfin-cal';

    // ── util ────────────────────────────────────────────────────────
    function api() { return window.ApiClient || null; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function parseYmd(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
    function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
    function startOfToday() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
    function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
    function fmt(d, opts) { try { return new Intl.DateTimeFormat(LOCALE, opts).format(d); } catch (e) { return ymd(d); } }
    function fmtRuntime(m) { if (!m) return ''; return m >= 60 ? Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '') : m + ' ' + t.min; }

    function loadPrefs() {
        var p = { source: null, kind: 'all', tab: 'cal' };
        try { var s = JSON.parse(lsGet(PREFS_KEY) || '{}'); for (var k in p) if (s[k] !== undefined) p[k] = s[k]; } catch (e) { /* ignore */ }
        if (p.source !== 'all' && p.source !== 'arr') p.source = null;
        if (p.kind !== 'all' && p.kind !== 'movie' && p.kind !== 'series') p.kind = 'all';
        if (p.tab !== 'cal' && p.tab !== 'agenda') p.tab = 'cal';
        return p;
    }

    // Chiamata autenticata verso gli endpoint del plugin (Owlfin/...).
    function jf(path) {
        var c = api();
        if (!c) return Promise.reject(new Error('no client'));
        var tok = c.accessToken ? c.accessToken() : '';
        var h = { 'Authorization': 'MediaBrowser Token="' + tok + '"', 'X-Emby-Token': tok };
        return fetch(c.getUrl(path), { headers: h }).then(function (r) {
            if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
            return r.json();
        });
    }

    // ── icone (SVG, nessuna dipendenza da font) ─────────────────────
    var ICON = {
        close: '<path d="M18 6 6 18M6 6l12 12"/>',
        left: '<path d="m15 18-6-6 6-6"/>',
        right: '<path d="m9 18 6-6-6-6"/>',
        cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
        list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1" fill="currentColor"/><circle cx="3.5" cy="12" r="1" fill="currentColor"/><circle cx="3.5" cy="18" r="1" fill="currentColor"/>',
        check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
        film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
        tv: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="m8 21 4-3 4 3"/>',
        play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
        star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="currentColor" stroke="none"/>'
    };
    function icon(name, size) {
        size = size || 20;
        return '<svg class="oc-i" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + '</svg>';
    }

    // ── stato ───────────────────────────────────────────────────────
    var prefs = loadPrefs();
    var state = {
        open: false, tab: 'cal', source: 'all', kind: 'all',
        month: null, selected: null, range: 'next',
        raw: [], loading: false, errors: [], sources: null, fatal: '',
        view: [], seq: 0
    };
    var cache = {}, inflight = {};
    var lib = null, libLoading = false;
    var root = null, pushed = false, pendingThen = null, closeTimer = 0, bgIndex = 0, bgUrl = '';

    // ── CSS ─────────────────────────────────────────────────────────
    function injectCSS() {
        if (document.getElementById('owlfin-cal-css')) return;
        var s = document.createElement('style');
        s.id = 'owlfin-cal-css';
        s.textContent = [
            '#owlfin-cal{--ac:#22d3ee;--ac2:#a78bfa;--tx:#f4f7fb;--mut:rgba(244,247,251,.62);position:fixed;inset:0;z-index:99999;display:none;color:var(--tx);font-family:inherit;-webkit-tap-highlight-color:transparent;}',
            '#owlfin-cal.oc-open{display:block;animation:ocIn .25s ease both;}',
            '@keyframes ocIn{from{opacity:0}to{opacity:1}}',
            '#owlfin-cal *{box-sizing:border-box;}',
            ':where(#owlfin-cal) button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;}',
            '#owlfin-cal .oc-i{display:block;flex:none;}',
            // sfondo: base scura + bagliori + immagine sfocata
            '.oc-bg{position:absolute;inset:0;background:#060a13;overflow:hidden;}',
            '.oc-bg:before{content:"";position:absolute;inset:0;background:radial-gradient(60% 45% at 12% 8%,rgba(34,211,238,.38),transparent 70%),radial-gradient(55% 45% at 92% 18%,rgba(167,139,250,.42),transparent 70%),radial-gradient(70% 50% at 55% 100%,rgba(236,72,153,.30),transparent 70%);}',
            '.oc-bg-img{position:absolute;inset:-60px;background-size:cover;background-position:center;filter:blur(46px) saturate(1.7);transform:scale(1.15);opacity:0;transition:opacity .7s ease;}',
            '.oc-bg-img.on{opacity:.5;}',
            '.oc-bg:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,10,19,.15),rgba(6,10,19,.55));}',
            '.oc-wrap{position:absolute;inset:0;display:flex;flex-direction:column;}',
            // vetro
            '.oc-glass{background:linear-gradient(160deg,rgba(255,255,255,.16),rgba(255,255,255,.05));border:1px solid rgba(255,255,255,.17);box-shadow:0 10px 36px rgba(0,0,0,.36),inset 0 1px 0 rgba(255,255,255,.26);backdrop-filter:blur(26px) saturate(1.6);-webkit-backdrop-filter:blur(26px) saturate(1.6);}',
            // testata
            '.oc-top{flex:none;padding:calc(env(safe-area-inset-top,0px) + 12px) 16px 6px;max-width:1080px;width:100%;margin:0 auto;}',
            '.oc-row{display:flex;align-items:center;gap:10px;}',
            '.oc-h{flex:1;font-size:1.35rem;font-weight:700;letter-spacing:-.01em;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '.oc-round{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;}',
            '.oc-pill{height:40px;padding:0 16px;border-radius:999px;font-size:.85rem;font-weight:600;display:flex;align-items:center;gap:6px;}',
            '.oc-filters{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;}',
            '.oc-seg{display:inline-flex;padding:3px;border-radius:999px;gap:2px;}',
            '.oc-seg button{padding:7px 14px;border-radius:999px;font-size:.8rem;font-weight:600;color:var(--mut);transition:background .15s,color .15s;white-space:nowrap;}',
            '.oc-seg button.on{background:rgba(34,211,238,.22);color:#fff;box-shadow:inset 0 0 0 1px rgba(34,211,238,.55);}',
            // scorrimento
            '.oc-scroll{flex:1;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:8px 16px calc(112px + env(safe-area-inset-bottom,0px));}',
            '.oc-body{max-width:1080px;margin:0 auto;display:grid;gap:16px;grid-template-columns:minmax(0,1fr);align-items:start;}',
            '@media (min-width:900px){.oc-body.oc-two{grid-template-columns:420px minmax(0,1fr);}.oc-body.oc-two .oc-month{position:sticky;top:0;}}',
            // mese
            '.oc-month{border-radius:28px;padding:14px 12px 12px;touch-action:pan-y;}',
            '.oc-mh{display:flex;align-items:center;gap:6px;padding:2px 4px 10px;}',
            '.oc-mt{flex:1;text-align:center;font-size:1.05rem;font-weight:700;}',
            '.oc-nav{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.08);}',
            '.oc-nav:active{background:rgba(255,255,255,.2);}',
            '.oc-wd,.oc-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;}',
            '.oc-wd{padding-bottom:4px;}',
            '.oc-wd span{text-align:center;font-size:.68rem;font-weight:600;color:var(--mut);text-transform:uppercase;letter-spacing:.04em;}',
            '.oc-day{position:relative;height:52px;border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;font-size:.95rem;font-weight:600;transition:background .15s;}',
            '.oc-day:hover{background:rgba(255,255,255,.08);}',
            '.oc-day.oc-out{opacity:.38;}',
            '.oc-day.oc-past .oc-n{opacity:.7;}',
            '.oc-day.oc-today .oc-n{color:var(--ac);}',
            '.oc-day.oc-today{box-shadow:inset 0 0 0 1.5px rgba(34,211,238,.7);}',
            '.oc-day.oc-sel{background:linear-gradient(160deg,rgba(34,211,238,.5),rgba(34,211,238,.22));box-shadow:inset 0 0 0 1px rgba(255,255,255,.4),0 6px 18px rgba(34,211,238,.25);}',
            '.oc-day.oc-sel .oc-n{color:#fff;}',
            '.oc-dots{display:flex;gap:3px;height:6px;align-items:center;}',
            '.oc-dot{width:6px;height:6px;border-radius:50%;background:var(--ac);}',
            '.oc-dot.s{background:var(--ac2);}',
            '.oc-past .oc-dot{opacity:.55;}',
            '.oc-more{font-size:.6rem;line-height:6px;color:var(--mut);margin-left:1px;}',
            // elenco
            '.oc-list{display:flex;flex-direction:column;gap:12px;min-width:0;}',
            '.oc-dh{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;padding:2px 4px;}',
            '.oc-dh b{font-size:1.1rem;font-weight:700;}',
            '.oc-dh span{font-size:.8rem;color:var(--mut);}',
            '.oc-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:999px;font-size:.68rem;font-weight:700;letter-spacing:.02em;white-space:nowrap;background:rgba(255,255,255,.12);}',
            '.oc-chip.r-cinema{background:rgba(251,146,60,.22);color:#fdba74;}',
            '.oc-chip.r-digital{background:rgba(34,211,238,.2);color:#67e8f9;}',
            '.oc-chip.r-physical{background:rgba(148,163,184,.25);color:#cbd5e1;}',
            '.oc-chip.r-episode{background:rgba(167,139,250,.24);color:#c4b5fd;}',
            '.oc-chip.r-premiere{background:rgba(244,114,182,.24);color:#f9a8d4;}',
            '.oc-chip.st-ok{background:rgba(52,211,153,.22);color:#6ee7b7;}',
            '.oc-chip.st-warn{background:rgba(251,191,36,.22);color:#fcd34d;}',
            '.oc-chip.st-soon{background:rgba(255,255,255,.14);color:#e2e8f0;}',
            '.oc-chip.lib{background:rgba(34,211,238,.2);color:#67e8f9;}',
            '.oc-card{display:flex;gap:12px;padding:10px;border-radius:20px;text-align:left;width:100%;transition:transform .12s;}',
            '.oc-card:active{transform:scale(.985);}',
            '.oc-card.oc-past{opacity:.72;}',
            '.oc-poster{flex:none;width:76px;height:114px;border-radius:12px;overflow:hidden;background:linear-gradient(160deg,rgba(255,255,255,.14),rgba(255,255,255,.04));display:flex;align-items:center;justify-content:center;color:var(--mut);box-shadow:0 6px 16px rgba(0,0,0,.35);}',
            '.oc-poster img{width:100%;height:100%;object-fit:cover;display:block;}',
            '.oc-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;padding:2px 2px 2px 0;}',
            '.oc-title{font-size:1rem;font-weight:700;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
            '.oc-sub{font-size:.8rem;color:var(--ac);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '.oc-chips{display:flex;flex-wrap:wrap;gap:5px;}',
            '.oc-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;font-size:.76rem;color:var(--mut);}',
            '.oc-meta .oc-star{display:inline-flex;align-items:center;gap:3px;color:#fcd34d;}',
            '.oc-plot{font-size:.8rem;line-height:1.4;color:rgba(244,247,251,.8);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
            '.oc-empty{padding:26px 18px;border-radius:22px;text-align:center;color:var(--mut);font-size:.9rem;line-height:1.5;}',
            '.oc-note{padding:12px 14px;border-radius:18px;font-size:.82rem;line-height:1.45;color:#fde68a;background:linear-gradient(160deg,rgba(251,191,36,.18),rgba(251,191,36,.06));border:1px solid rgba(251,191,36,.3);display:flex;gap:10px;align-items:center;justify-content:space-between;}',
            '.oc-note button{flex:none;padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.14);font-weight:600;font-size:.78rem;}',
            '.oc-spin{width:26px;height:26px;border-radius:50%;border:3px solid rgba(255,255,255,.2);border-top-color:var(--ac);animation:ocSpin .8s linear infinite;margin:0 auto 10px;}',
            '@keyframes ocSpin{to{transform:rotate(360deg)}}',
            // agenda
            '.oc-ranges{display:flex;gap:8px;flex-wrap:wrap;}',
            '.oc-agenda{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:12px;}',
            '.oc-group{display:flex;flex-direction:column;gap:10px;}',
            '.oc-group.oc-past .oc-dh b{opacity:.75;}',
            // barra in basso
            '.oc-tabs{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom,0px));display:flex;gap:4px;padding:6px;border-radius:999px;z-index:3;}',
            '.oc-tabs button{display:flex;align-items:center;gap:8px;padding:11px 22px;border-radius:999px;font-size:.88rem;font-weight:700;color:var(--mut);transition:background .15s,color .15s;}',
            '.oc-tabs button.on{background:rgba(34,211,238,.24);color:#fff;box-shadow:inset 0 0 0 1px rgba(34,211,238,.55);}',
            // scheda dettaglio
            '.oc-sheet-wrap{position:absolute;inset:0;z-index:5;display:flex;align-items:flex-end;justify-content:center;background:rgba(2,6,14,.55);animation:ocIn .2s ease both;}',
            '.oc-sheet{position:relative;width:100%;max-width:640px;max-height:88%;overflow-y:auto;-webkit-overflow-scrolling:touch;border-radius:28px 28px 0 0;padding:0 0 calc(22px + env(safe-area-inset-bottom,0px));animation:ocUp .28s cubic-bezier(.2,.8,.2,1) both;background:linear-gradient(170deg,rgba(40,52,74,.78),rgba(14,20,34,.86));}',
            '@keyframes ocUp{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}',
            '@media (min-width:700px){.oc-sheet-wrap{align-items:center}.oc-sheet{border-radius:28px;}}',
            '.oc-s-hero{position:relative;height:150px;background-size:cover;background-position:center 25%;border-radius:28px 28px 0 0;overflow:hidden;}',
            '.oc-s-hero:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(14,20,34,.1),rgba(14,20,34,.92));}',
            '.oc-s-x{position:absolute;top:12px;right:12px;z-index:2;background:rgba(0,0,0,.35)!important;}',
            '.oc-s-main{display:flex;gap:14px;padding:0 18px;margin-top:-70px;position:relative;z-index:1;}',
            '.oc-s-main .oc-poster{width:104px;height:156px;border-radius:14px;}',
            '.oc-s-ti{flex:1;min-width:0;padding-top:78px;display:flex;flex-direction:column;gap:6px;}',
            '.oc-s-ti h2{margin:0;font-size:1.2rem;line-height:1.2;font-weight:800;}',
            '.oc-s-body{padding:14px 18px 0;display:flex;flex-direction:column;gap:12px;}',
            '.oc-s-date{font-size:.85rem;font-weight:600;color:var(--ac);}',
            '.oc-s-h{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);margin-bottom:4px;}',
            '.oc-s-plot{font-size:.92rem;line-height:1.55;color:rgba(244,247,251,.9);white-space:pre-line;}',
            '.oc-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:13px 16px;border-radius:16px;font-weight:700;font-size:.92rem;}',
            '.oc-btn.main{background:linear-gradient(160deg,rgba(34,211,238,.6),rgba(34,211,238,.32));box-shadow:inset 0 0 0 1px rgba(255,255,255,.35);}',
            // voce del menu (client classico)
            '.oc-drawer-btn{display:flex;align-items:center;gap:14px;width:100%;padding:12px 20px;background:none;border:0;color:inherit;font:inherit;font-size:.95rem;cursor:pointer;text-align:left;}',
            '.oc-drawer-btn:hover{background:rgba(255,255,255,.08);}',
            '.oc-drawer-btn .material-icons{font-size:1.5rem;}',
            '@media (max-width:600px){.oc-day{height:44px;gap:3px}.oc-month{padding:12px 10px 10px}}',
            '@media (max-width:420px){.oc-day{height:44px}.oc-poster{width:68px;height:102px}.oc-tabs button{padding:11px 18px}.oc-seg button{padding:7px 11px}}',
            '@media (prefers-reduced-motion:reduce){#owlfin-cal *{animation:none!important;transition:none!important;}}'
        ].join('\n');
        document.head.appendChild(s);
    }

    // ── dati ────────────────────────────────────────────────────────
    function localDay(ev) {
        // gli episodi con orario cadono nel giorno LOCALE dell'utente, non in quello UTC del server
        if (ev.time) { var d = new Date(ev.time); if (!isNaN(d.getTime())) return ymd(d); }
        return ev.date;
    }
    function isSeriesKind(ev) { return ev.kind === 'episode' || ev.kind === 'series'; }
    function passKind(ev) {
        if (state.kind === 'movie') return ev.kind === 'movie';
        if (state.kind === 'series') return isSeriesKind(ev);
        return true;
    }

    function fetchEvents(from, to) {
        var s = addDays(from, -1), e = addDays(to, 1);   // un giorno di margine per i fusi orari
        var key = state.source + '|' + ymd(s) + '|' + ymd(e);
        var c = cache[key];
        if (c && Date.now() - c.at < 120000) return Promise.resolve(c.data);
        if (inflight[key]) return inflight[key];
        var url = 'Owlfin/Calendar/Events?start=' + ymd(s) + '&end=' + ymd(e) + '&source=' + state.source + '&lang=' + encodeURIComponent(LANG);
        var p = jf(url).then(function (data) {
            delete inflight[key];
            cache[key] = { at: Date.now(), data: data };
            return data;
        }, function (err) { delete inflight[key]; throw err; });
        inflight[key] = p;
        return p;
    }

    function gridRange() {
        var first = new Date(state.month.getFullYear(), state.month.getMonth(), 1);
        var offset = (first.getDay() - WEEK_START + 7) % 7;
        var start = addDays(first, -offset);
        return { start: start, end: addDays(start, 41) };
    }

    function agendaRange() {
        var today = startOfToday();
        if (state.range === 'today') return { start: today, end: today };
        if (state.range === 'past') return { start: addDays(today, -30), end: addDays(today, -1) };
        return { start: today, end: addDays(today, 29) };
    }

    function load() {
        var seq = ++state.seq;
        var r = state.tab === 'cal' ? gridRange() : agendaRange();
        state.loading = true;
        state.fatal = '';
        renderMain();
        fetchEvents(r.start, r.end).then(function (data) {
            if (seq !== state.seq) return;
            state.raw = (data && data.events) || [];
            state.raw.forEach(function (ev) { ev._d = localDay(ev); });
            state.errors = (data && data.errors) || [];
            state.sources = (data && data.sources) || state.sources;
            state.loading = false;
            renderMain();
        }, function (err) {
            if (seq !== state.seq) return;
            state.raw = [];
            state.errors = [];
            state.loading = false;
            state.fatal = err && err.status === 401 ? t.errAuth : (err && err.status === 404 ? t.errMissing : t.errLoad);
            renderMain();
        });
    }

    function loadLibrary() {
        if (lib || libLoading) return;
        var c = api();
        if (!c || !c.getCurrentUserId) return;
        libLoading = true;
        var uid = c.getCurrentUserId();
        jf('Users/' + uid + '/Items?Recursive=true&IncludeItemTypes=Movie,Series&Fields=ProviderIds&EnableImages=false&EnableUserData=false').then(function (res) {
            var m = {};
            ((res && res.Items) || []).forEach(function (it) {
                var p = it.ProviderIds || {};
                var tmdb = p.Tmdb || p.tmdb, tvdb = p.Tvdb || p.tvdb;
                if (tmdb) m[it.Type + ':tmdb:' + tmdb] = it.Id;
                if (tvdb && it.Type === 'Series') m['Series:tvdb:' + tvdb] = it.Id;
            });
            lib = m;
            libLoading = false;
            if (state.open) renderMain();
        }, function () { libLoading = false; lib = {}; });
    }

    function libId(ev) {
        if (!lib) return null;
        if (ev.kind === 'movie') return ev.tmdbId ? lib['Movie:tmdb:' + ev.tmdbId] || null : null;
        return (ev.tmdbId && lib['Series:tmdb:' + ev.tmdbId]) || (ev.tvdbId && lib['Series:tvdb:' + ev.tvdbId]) || null;
    }

    // ── presentazione ───────────────────────────────────────────────
    function relLabel(ev) {
        if (ev.release === 'cinema') return t.cinema;
        if (ev.release === 'digital') return t.digital;
        if (ev.release === 'physical') return t.physical;
        if (ev.release === 'premiere') return t.premiere;
        return t.episode;
    }
    function statusOf(ev) {
        if (ev.source !== 'radarr' && ev.source !== 'sonarr') return null;
        if (ev.hasFile) return { cls: 'st-ok', text: t.downloaded };
        if (!ev.monitored) return null;
        return { cls: ev._d <= ymd(startOfToday()) ? 'st-warn' : 'st-soon', text: ev._d <= ymd(startOfToday()) ? t.waiting : t.requested };
    }
    function subtitleOf(ev) {
        var s = ev.subtitle && isNaN(Number(ev.subtitle)) ? ev.subtitle : '';
        if (ev.count > 1) return (s ? s + ' · ' : '') + ev.count + ' ' + t.episodes;
        return s;
    }
    function timeOf(ev) {
        if (!ev.time) return '';
        var d = new Date(ev.time);
        return isNaN(d.getTime()) ? '' : fmt(d, { hour: '2-digit', minute: '2-digit' });
    }
    function posterHtml(ev) {
        var inner = ev.poster
            ? '<img src="' + esc(ev.poster) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">'
            : icon(isSeriesKind(ev) ? 'tv' : 'film', 28);
        return '<div class="oc-poster">' + inner + '</div>';
    }
    function metaHtml(ev) {
        var parts = [];
        if (ev.year) parts.push('<span>' + esc(ev.year) + '</span>');
        if (ev.runtime) parts.push('<span>' + esc(fmtRuntime(ev.runtime)) + '</span>');
        if (ev.network) parts.push('<span>' + esc(ev.network) + '</span>');
        if (ev.genres && ev.genres.length) parts.push('<span>' + esc(ev.genres.slice(0, 2).join(' · ')) + '</span>');
        if (ev.rating) parts.push('<span class="oc-star">' + icon('star', 12) + esc(ev.rating.toFixed(1)) + '</span>');
        return parts.length ? '<div class="oc-meta">' + parts.join('') + '</div>' : '';
    }
    function chipsHtml(ev, withTime) {
        var h = '<span class="oc-chip r-' + esc(ev.release) + '">' + esc(relLabel(ev)) + '</span>';
        var tm = withTime ? timeOf(ev) : '';
        if (tm) h += '<span class="oc-chip">' + esc(tm) + '</span>';
        var st = statusOf(ev);
        if (st) h += '<span class="oc-chip ' + st.cls + '">' + esc(st.text) + '</span>';
        if (libId(ev)) h += '<span class="oc-chip lib">' + icon('check', 11) + esc(t.inLibrary) + '</span>';
        return h;
    }
    function cardHtml(ev, i) {
        var past = ev._d < ymd(startOfToday());
        var sub = subtitleOf(ev);
        return '<button type="button" class="oc-card oc-glass' + (past ? ' oc-past' : '') + '" data-i="' + i + '">' +
            posterHtml(ev) +
            '<div class="oc-info">' +
            '<div class="oc-title">' + esc(ev.title) + '</div>' +
            (sub ? '<div class="oc-sub">' + esc(sub) + '</div>' : '') +
            '<div class="oc-chips">' + chipsHtml(ev, true) + '</div>' +
            metaHtml(ev) +
            (ev.overview ? '<div class="oc-plot">' + esc(ev.overview) + '</div>' : '') +
            '</div></button>';
    }

    function dayTitle(dstr) {
        var today = startOfToday(), d = parseYmd(dstr);
        var diff = Math.round((d - today) / 86400000);
        var label = cap(fmt(d, { weekday: 'long', day: 'numeric', month: 'long' }));
        var rel = diff === 0 ? t.today : diff === 1 ? t.tomorrow : diff === -1 ? t.yesterday : '';
        return { label: label, rel: rel, diff: diff };
    }

    function notesHtml() {
        var h = '';
        var s = state.sources;
        if (s) {
            if (state.source === 'arr' && !s.radarr && !s.sonarr) h += '<div class="oc-note oc-glass"><span>' + esc(t.setupArr) + '</span></div>';
            if (state.source === 'all' && !s.tmdb) h += '<div class="oc-note oc-glass"><span>' + esc(t.setupTmdb) + '</span></div>';
        }
        (state.errors || []).forEach(function (e) {
            var name = e.source === 'radarr' ? 'Radarr' : e.source === 'sonarr' ? 'Sonarr' : e.source === 'tmdb' ? 'TMDB' : e.source;
            h += '<div class="oc-note oc-glass"><span>' + esc(name) + ': ' + esc(t.errSource) + (e.message ? ' (' + esc(e.message) + ')' : '') + '</span></div>';
        });
        if (state.fatal) h += '<div class="oc-note oc-glass"><span>' + esc(state.fatal) + '</span><button type="button" data-act="retry">' + esc(t.retry) + '</button></div>';
        return h;
    }

    function loadingHtml() { return '<div class="oc-empty oc-glass"><div class="oc-spin"></div>' + esc(t.loading) + '</div>'; }

    // ── render ──────────────────────────────────────────────────────
    function q(sel) { return root ? root.querySelector(sel) : null; }

    function renderFilters() {
        var el = q('.oc-filters');
        if (!el) return;
        function seg(name, cur, items) {
            return '<div class="oc-seg oc-glass" data-seg="' + name + '">' + items.map(function (it) {
                return '<button type="button" data-v="' + it[0] + '" class="' + (cur === it[0] ? 'on' : '') + '">' + esc(it[1]) + '</button>';
            }).join('') + '</div>';
        }
        el.innerHTML =
            seg('source', state.source, [['all', t.srcAll], ['arr', t.srcArr]]) +
            seg('kind', state.kind, [['all', t.kindAll], ['movie', t.kindMovie], ['series', t.kindSeries]]);
        var today = q('.oc-today-btn');
        if (today) today.style.display = state.tab === 'cal' ? '' : 'none';
    }

    function renderTabs() {
        var el = q('.oc-tabs');
        if (!el) return;
        el.innerHTML =
            '<button type="button" data-tab="cal" class="' + (state.tab === 'cal' ? 'on' : '') + '">' + icon('cal', 20) + '<span>' + esc(t.tabCal) + '</span></button>' +
            '<button type="button" data-tab="agenda" class="' + (state.tab === 'agenda' ? 'on' : '') + '">' + icon('list', 20) + '<span>' + esc(t.tabAgenda) + '</span></button>';
    }

    function setBg(list) {
        var ev = null;
        for (var i = 0; i < list.length; i++) { if (list[i].backdrop || list[i].poster) { ev = list[i]; break; } }
        var url = ev ? (ev.backdrop || ev.poster) : '';
        if (url === bgUrl) return;
        bgUrl = url;
        var layers = root.querySelectorAll('.oc-bg-img');
        bgIndex = 1 - bgIndex;
        var next = layers[bgIndex], prev = layers[1 - bgIndex];
        if (prev) prev.classList.remove('on');
        if (!url) return;
        var img = new Image();
        img.onload = function () {
            if (bgUrl !== url) return;
            next.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
            next.classList.add('on');
        };
        img.referrerPolicy = 'no-referrer';
        img.src = url;
    }

    function renderMain() {
        if (!root) return;
        renderFilters();
        renderTabs();
        var host = q('.oc-scroll');
        var keep = host.scrollTop;
        if (state.tab === 'cal') renderCalendarTab(host); else renderAgendaTab(host);
        host.scrollTop = keep;
    }

    function byDay(list) {
        var m = {};
        list.forEach(function (ev) { (m[ev._d] = m[ev._d] || []).push(ev); });
        return m;
    }

    function renderCalendarTab(host) {
        var today = ymd(startOfToday());
        var r = gridRange();
        var map = byDay(state.raw.filter(passKind));
        var month = state.month.getMonth();

        var wd = '';
        for (var w = 0; w < 7; w++) wd += '<span>' + esc(fmt(addDays(r.start, w), { weekday: 'short' }).replace('.', '').slice(0, 3)) + '</span>';

        var cells = '';
        for (var i = 0; i < 42; i++) {
            var d = addDays(r.start, i), key = ymd(d), evs = map[key] || [];
            var cls = 'oc-day';
            if (d.getMonth() !== month) cls += ' oc-out';
            if (key < today) cls += ' oc-past';
            if (key === today) cls += ' oc-today';
            if (key === state.selected) cls += ' oc-sel';
            var dots = '';
            for (var k = 0; k < Math.min(evs.length, 3); k++) dots += '<i class="oc-dot' + (isSeriesKind(evs[k]) ? ' s' : '') + '"></i>';
            if (evs.length > 3) dots += '<span class="oc-more">+</span>';
            cells += '<button type="button" class="' + cls + '" data-day="' + key + '" aria-label="' + esc(dayTitle(key).label + (evs.length ? ', ' + evs.length : '')) + '"' + (key === state.selected ? ' aria-pressed="true"' : '') + '>' +
                '<span class="oc-n">' + d.getDate() + '</span><span class="oc-dots">' + dots + '</span></button>';
        }

        var dayEvs = map[state.selected] || [];
        state.view = dayEvs;
        var dt = dayTitle(state.selected);
        var list;
        if (state.loading && !state.raw.length) list = loadingHtml();
        else if (!dayEvs.length) list = '<div class="oc-empty oc-glass">' + esc(t.noEvents) + '</div>';
        else list = dayEvs.map(cardHtml).join('');

        host.innerHTML = '<div class="oc-body oc-two">' +
            '<section class="oc-month oc-glass">' +
            '<div class="oc-mh">' +
            '<button type="button" class="oc-nav" data-act="prev" aria-label="' + esc(t.prev) + '">' + icon('left') + '</button>' +
            '<div class="oc-mt">' + esc(cap(fmt(state.month, { month: 'long', year: 'numeric' }))) + '</div>' +
            '<button type="button" class="oc-nav" data-act="next" aria-label="' + esc(t.next) + '">' + icon('right') + '</button>' +
            '</div><div class="oc-wd">' + wd + '</div><div class="oc-grid">' + cells + '</div></section>' +
            '<section class="oc-list">' + notesHtml() +
            '<div class="oc-dh"><b>' + esc(dt.label) + '</b>' +
            (dt.rel ? '<span class="oc-chip lib">' + esc(dt.rel) + '</span>' : '') +
            (dayEvs.length ? '<span>' + dayEvs.length + ' ' + esc(dayEvs.length === 1 ? t.release1 : t.releases) + '</span>' : '') +
            '</div>' + list + '</section></div>';
        setBg(dayEvs.length ? dayEvs : state.raw.filter(passKind));
    }

    function renderAgendaTab(host) {
        var today = ymd(startOfToday());
        var r = agendaRange(), from = ymd(r.start), to = ymd(r.end);
        var evs = state.raw.filter(function (ev) { return passKind(ev) && ev._d >= from && ev._d <= to; });
        var map = byDay(evs);
        var days = Object.keys(map).sort();
        if (state.range === 'past') days.reverse();

        var view = [];
        var groups = days.map(function (day) {
            var dt = dayTitle(day);
            var cards = map[day].map(function (ev) { view.push(ev); return cardHtml(ev, view.length - 1); }).join('');
            return '<section class="oc-group' + (day < today ? ' oc-past' : '') + '"><div class="oc-dh"><b>' + esc(dt.label) + '</b>' +
                (dt.rel ? '<span class="oc-chip lib">' + esc(dt.rel) + '</span>' : '') +
                '<span>' + map[day].length + ' ' + esc(map[day].length === 1 ? t.release1 : t.releases) + '</span></div>' + cards + '</section>';
        }).join('');
        state.view = view;

        var body;
        if (state.loading && !state.raw.length) body = loadingHtml();
        else if (!view.length) body = '<div class="oc-empty oc-glass">' + esc(t.noAgenda) + '</div>';
        else body = groups;

        var rg = [['past', t.rPast], ['today', t.rToday], ['next', t.rNext]];
        host.innerHTML = '<div class="oc-agenda">' +
            '<div class="oc-ranges"><div class="oc-seg oc-glass" data-seg="range">' + rg.map(function (r) {
                return '<button type="button" data-v="' + r[0] + '" class="' + (state.range === r[0] ? 'on' : '') + '">' + esc(r[1]) + '</button>';
            }).join('') + '</div></div>' + notesHtml() + body + '</div>';
        setBg(view);
    }

    // ── scheda dettaglio ────────────────────────────────────────────
    function openSheet(ev) {
        closeSheet();
        var wrap = document.createElement('div');
        wrap.className = 'oc-sheet-wrap';
        var id = libId(ev);
        var dt = parseYmd(ev._d);
        var when = cap(fmt(dt, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
        var tm = timeOf(ev);
        var sub = subtitleOf(ev);
        var hero = ev.backdrop || ev.poster;
        wrap.innerHTML =
            '<div class="oc-sheet oc-glass" role="dialog" aria-modal="true" aria-label="' + esc(ev.title) + '">' +
            '<div class="oc-s-hero"' + (hero ? ' style="background-image:url(&quot;' + esc(hero) + '&quot;)"' : '') + '></div>' +
            '<button type="button" class="oc-round oc-glass oc-s-x" data-act="sheet-close" aria-label="' + esc(t.close) + '">' + icon('close') + '</button>' +
            '<div class="oc-s-main">' + posterHtml(ev) +
            '<div class="oc-s-ti"><h2>' + esc(ev.title) + '</h2>' + (sub ? '<div class="oc-sub">' + esc(sub) + '</div>' : '') +
            '<div class="oc-chips">' + chipsHtml(ev, false) + '</div></div></div>' +
            '<div class="oc-s-body">' +
            '<div class="oc-s-date">' + esc(when) + (tm ? ' · ' + esc(tm) : '') + '</div>' +
            metaHtml(ev) +
            '<div><div class="oc-s-h">' + esc(t.plot) + '</div><div class="oc-s-plot">' + esc(ev.overview || t.noPlot) + '</div></div>' +
            (id ? '<button type="button" class="oc-btn main" data-act="open-item" data-id="' + esc(id) + '">' + icon('play', 18) + esc(t.open) + '</button>' : '') +
            '</div></div>';
        wrap.addEventListener('click', function (e) { if (e.target === wrap) closeSheet(); });
        root.appendChild(wrap);
        var x = wrap.querySelector('[data-act="sheet-close"]');
        if (x) x.focus({ preventScroll: true });
    }
    function closeSheet() {
        if (!root) return false;
        var w = root.querySelector('.oc-sheet-wrap');
        if (w) { w.remove(); return true; }
        return false;
    }

    // ── overlay ─────────────────────────────────────────────────────
    function build() {
        if (root) return;
        injectCSS();
        root = document.createElement('div');
        root.id = OVERLAY_ID;
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-label', t.title);
        root.innerHTML =
            '<div class="oc-bg"><div class="oc-bg-img"></div><div class="oc-bg-img"></div></div>' +
            '<div class="oc-wrap">' +
            '<div class="oc-top"><div class="oc-row">' +
            '<button type="button" class="oc-round oc-glass" data-act="close" aria-label="' + esc(t.close) + '">' + icon('close') + '</button>' +
            '<div class="oc-h">' + esc(t.title) + '</div>' +
            '<button type="button" class="oc-pill oc-glass oc-today-btn" data-act="today">' + esc(t.today) + '</button>' +
            '</div><div class="oc-filters"></div></div>' +
            '<div class="oc-scroll"></div>' +
            '<nav class="oc-tabs oc-glass"></nav></div>';
        document.body.appendChild(root);
        root.addEventListener('click', onClick);
        root.addEventListener('error', function (e) {
            var img = e.target;
            if (img && img.tagName === 'IMG') {
                var box = img.parentNode;
                img.remove();
                if (box && box.classList.contains('oc-poster') && !box.firstChild) box.innerHTML = icon('film', 28);
            }
        }, true);
        // scorrimento orizzontale sul mese = cambio mese
        var sx = 0, sy = 0, tracking = false;
        root.addEventListener('touchstart', function (e) {
            tracking = !!(e.target.closest && e.target.closest('.oc-month')) && e.touches.length === 1;
            if (tracking) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }
        }, { passive: true });
        root.addEventListener('touchend', function (e) {
            if (!tracking) return;
            tracking = false;
            var c = e.changedTouches[0], dx = c.clientX - sx, dy = c.clientY - sy;
            if (Math.abs(dx) > 60 && Math.abs(dy) < 40) shiftMonth(dx < 0 ? 1 : -1);
        }, { passive: true });
    }

    function onClick(e) {
        var tg = e.target;
        if (!tg || !tg.closest) return;
        var b;
        if ((b = tg.closest('[data-act]'))) {
            var act = b.getAttribute('data-act');
            if (act === 'close') return closeOverlay();
            if (act === 'sheet-close') return closeSheet();
            if (act === 'prev') return shiftMonth(-1);
            if (act === 'next') return shiftMonth(1);
            if (act === 'today') return goToday();
            if (act === 'retry') return load();
            if (act === 'open-item') return openItem(b.getAttribute('data-id'));
        }
        if ((b = tg.closest('[data-tab]'))) return setTab(b.getAttribute('data-tab'));
        if ((b = tg.closest('[data-seg] [data-v]'))) {
            var seg = b.parentNode.getAttribute('data-seg'), v = b.getAttribute('data-v');
            if (seg === 'source') return setSource(v);
            if (seg === 'kind') return setKind(v);
            if (seg === 'range') { state.range = v; return load(); }
        }
        if ((b = tg.closest('[data-day]'))) return selectDay(b.getAttribute('data-day'));
        if ((b = tg.closest('.oc-card[data-i]'))) {
            var ev = state.view[+b.getAttribute('data-i')];
            if (ev) openSheet(ev);
        }
    }

    function savePrefs() {
        prefs = { source: state.source, kind: state.kind, tab: state.tab };
        lsSet(PREFS_KEY, JSON.stringify(prefs));
    }

    function setTab(tab) {
        if (tab !== 'cal' && tab !== 'agenda') return;
        if (state.tab === tab) return;
        state.tab = tab;
        savePrefs();
        state.raw = [];
        load();
    }
    function setSource(v) { if (state.source === v) return; state.source = v; savePrefs(); state.raw = []; state.errors = []; load(); }
    function setKind(v) { if (state.kind === v) return; state.kind = v; savePrefs(); renderMain(); }

    function selectDay(key) {
        var d = parseYmd(key);
        state.selected = key;
        if (d.getMonth() !== state.month.getMonth() || d.getFullYear() !== state.month.getFullYear()) {
            state.month = new Date(d.getFullYear(), d.getMonth(), 1);
            state.raw = [];
            load();
        } else renderMain();
    }
    function shiftMonth(n) {
        var m = new Date(state.month.getFullYear(), state.month.getMonth() + n, 1);
        state.month = m;
        var t0 = startOfToday();
        state.selected = (m.getFullYear() === t0.getFullYear() && m.getMonth() === t0.getMonth()) ? ymd(t0) : ymd(m);
        state.raw = [];
        load();
    }
    function goToday() {
        var t0 = startOfToday();
        var sameMonth = state.month.getFullYear() === t0.getFullYear() && state.month.getMonth() === t0.getMonth();
        state.month = new Date(t0.getFullYear(), t0.getMonth(), 1);
        state.selected = ymd(t0);
        if (sameMonth) renderMain(); else { state.raw = []; load(); }
    }

    function openItem(id) {
        if (!id) return;
        var c = api();
        var sid = c && c.serverId ? c.serverId() : '';
        closeOverlay(function () { location.hash = '#/details?id=' + encodeURIComponent(id) + (sid ? '&serverId=' + encodeURIComponent(sid) : ''); });
    }

    function openOverlay() {
        if (state.open) return;
        build();
        state.open = true;
        var t0 = startOfToday();
        state.tab = prefs.tab;
        state.kind = prefs.kind;
        state.source = prefs.source || 'all';
        state.month = new Date(t0.getFullYear(), t0.getMonth(), 1);
        state.selected = ymd(t0);
        state.raw = [];
        state.errors = [];
        state.fatal = '';
        root.classList.add('oc-open');
        try { history.pushState({ owlfinCal: true }, '', location.href); pushed = true; } catch (e) { pushed = false; }
        document.addEventListener('keydown', onKey, true);
        loadLibrary();
        if (!prefs.source) {
            // prima apertura: si parte da "Globali" se c'e' TMDB, altrimenti dalle richieste
            jf('Owlfin/Calendar/Status').then(function (s) {
                state.sources = s;
                if (!s.tmdb && (s.radarr || s.sonarr)) state.source = 'arr';
                load();
            }, function () { load(); });
        } else load();
    }

    function hide() {
        if (!state.open) return;
        state.open = false;
        state.seq++;
        closeSheet();
        root.classList.remove('oc-open');
        document.removeEventListener('keydown', onKey, true);
    }

    // then = cosa fare dopo la chiusura (es. aprire un titolo): dopo aver tolto la voce di cronologia
    function closeOverlay(then) {
        if (!state.open) { if (typeof then === 'function') then(); return; }
        if (pushed) {
            pushed = false;
            pendingThen = typeof then === 'function' ? then : null;
            hide();
            try { history.back(); } catch (e) { /* ignore */ }
            clearTimeout(closeTimer);
            closeTimer = setTimeout(function () { runPending(); }, 450);   // se popstate non arriva
        } else {
            hide();
            if (typeof then === 'function') then();
        }
    }
    function runPending() {
        clearTimeout(closeTimer);
        var f = pendingThen;
        pendingThen = null;
        if (f) f();
    }

    function onKey(e) {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        if (!closeSheet()) closeOverlay();
    }

    window.addEventListener('popstate', function () {
        if (state.open) {
            // il tasto "indietro" chiude prima la scheda, poi il calendario
            if (root && root.querySelector('.oc-sheet-wrap')) {
                closeSheet();
                try { history.pushState({ owlfinCal: true }, '', location.href); pushed = true; } catch (e) { /* ignore */ }
                return;
            }
            pushed = false;
            hide();
        }
        if (pendingThen) runPending();
    });

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
        if (document.getElementById('oc-drawer-btn')) return;
        injectCSS();
        var section = document.getElementById('gb-drawer-section');   // creata da genres.js, se attivo
        if (!section) {
            var homeLink = Array.prototype.slice.call(drawer.children).filter(function (el) {
                return el.tagName === 'A' && el.textContent.trim().toLowerCase() === 'home';
            })[0];
            if (!homeLink) return;
            section = document.createElement('div');
            section.id = 'oc-drawer-section';
            var label = document.createElement('div');
            label.textContent = 'Owlfin';
            label.style.cssText = 'padding:14px 20px 4px;font-size:.8rem;font-weight:600;opacity:.6;text-transform:uppercase;letter-spacing:.06em;';
            section.appendChild(label);
            drawer.insertBefore(section, homeLink.nextSibling);
        }
        var btn = document.createElement('button');
        btn.id = 'oc-drawer-btn';
        btn.type = 'button';
        btn.className = 'oc-drawer-btn';
        btn.innerHTML = '<span class="material-icons">calendar_month</span><span>' + esc(t.menu) + '</span>';
        btn.addEventListener('click', function (e) { e.preventDefault(); e.stopImmediatePropagation(); openOverlay(); }, true);
        section.appendChild(btn);
    }

    function injectMenuEntry() {
        if (document.getElementById('oc-drawer-btn') || document.getElementById('oc-mui-item')) return;
        var mui = document.querySelector('.MuiDrawer-paper');
        if (mui) { owlfinMenuAdd(mui, 'oc-mui-item', 3, 'calendar_month', t.menu, openOverlay); return; }
        var drawer = document.querySelector('.mainDrawer-scrollContainer') || document.querySelector('.mainDrawer');
        if (drawer) injectLegacyMenuEntry(drawer);
    }

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

    window.OwlfinCalendar = { open: openOverlay, close: closeOverlay };
})();
