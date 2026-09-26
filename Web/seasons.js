(function () {
  'use strict';

  // === CONFIG ===
  const CONFIG = {
    seasonCardSelector: '.card[data-type="Season"]',
    styleId: 'owl-appletv-season-style',
    pollIntervalMs: 400,
    pollTimeoutMs: 10000,
    repositionTimeoutMs: 20000, // per quanto tempo continuare a "sistemare" la posizione (Recensioni & co. caricano in ritardo)
    maxVisiblePopoverItems: 5, // oltre questo numero di stagioni, il menu scrolla in verticale
    hideNextUp: true, // true = nasconde del tutto "Prossimo" nella scheda serie; false = lo sposta prima di Stagione/Episodi
    hideExternalLinks: true, // true = nasconde i chip IMDb / TMDB / Seerr sotto la trama
    autoMarkPrevious: true, // true = quando guardi una puntata, segna come viste quelle PRECEDENTI mai iniziate
    reachedPercent: 10, // ...ma solo se la puntata è finita o l'hai guardata almeno per questa % (evita tocchi accidentali)
    autoMarkMaxEpisodes: 100, // sicurezza: se le puntate da segnare sono di più, non segna nulla
    recentMinutes: 10, // agisce solo se hai guardato qualcosa da meno di N minuti (niente riscritture retroattive all'apertura)
    debug: false, // metti true per vedere in console dove viene agganciata la sezione
  };

  // Titoli (in minuscolo) usati per individuare le sezioni native.
  const CAST_TITLES = ['cast', 'cast e troupe', 'cast & crew', 'cast/troupe'];
  const SIMILAR_TITLES = [
    'contenuti simili',
    'consigliati',
    'titoli simili',
    'altri titoli che potrebbero piacerti',
    'in stile',
    'perché ti piacciono',
  ];
  const NEXTUP_TITLES = ['prossimo', 'prossimi', 'prossima puntata', 'prossimo episodio', 'next up'];
  // "Recensioni (0)", "Reviews (3)", ecc.
  const REVIEWS_RE = /^(recensioni|recensione|reviews?)(\s*\(\d+\))?$/;
  // Etichette della tabella dettagli (Creatore / Studi / Generi ...): usate come ripiego
  // se la sezione Recensioni non esiste.
  const DETAILS_LABELS = [
    'creatore', 'creatori', 'studi', 'studio', 'generi', 'genere', 'registi', 'regista',
    'scrittori', 'autori', 'creator', 'studios', 'genres', 'director', 'writers',
  ];

  function injectStyles() {
    if (document.getElementById(CONFIG.styleId)) return;
    const style = document.createElement('style');
    style.id = CONFIG.styleId;
    style.textContent = `
      .owl-hide-nextup .nextUpSection { display: none !important; }
      .owl-hide-links .itemExternalLinks { display: none !important; }
      .owl-appletv-season-section {
        margin: 1.5em 0; width: 100%; max-width: 100%; min-width: 0;
        overflow: hidden; box-sizing: border-box;
      }
      .owl-season-header { display: flex; align-items: center; margin-bottom: 1em; }
      .owl-season-pill {
        display: inline-flex; align-items: center; gap: 10px;
        background: rgba(255,255,255,0.12); color: #fff; border: 1px solid rgba(255,255,255,0.10);
        border-radius: 999px; padding: 7px 18px; font-size: 1.1em; font-weight: 700;
        cursor: pointer;
        -webkit-backdrop-filter: blur(16px) saturate(1.5); backdrop-filter: blur(16px) saturate(1.5);
      }
      .owl-season-pill:active { background: rgba(255,255,255,0.22); }
      .owl-season-mark {
        display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        margin-left: 10px; padding: 7px 12px; box-sizing: border-box; white-space: nowrap;
        background: rgba(255,255,255,0.12); color: #fff; border: 1px solid rgba(255,255,255,0.10);
        border-radius: 999px; cursor: pointer; font-size: 0.85em; font-weight: 700;
        -webkit-backdrop-filter: blur(16px) saturate(1.5); backdrop-filter: blur(16px) saturate(1.5);
        transition: background 0.15s ease;
      }
      .owl-season-mark[hidden] { display: none; }
      .owl-season-mark:disabled { opacity: 0.5; }
      .owl-season-mark svg { width: 18px; height: 18px; display: block; opacity: 0.8; }
      .owl-season-mark .owl-mark-label { display: none; }
      .owl-season-mark.owl-expanded { background: rgba(255,255,255,0.24); }
      .owl-season-mark.owl-expanded .owl-mark-label { display: inline; }
      .owl-season-mark.owl-done svg { color: #34c759; opacity: 1; }
      .owl-caret {
        width: 0; height: 0; border-style: solid; border-width: 5px 4px 0 4px;
        border-color: currentColor transparent transparent transparent;
        opacity: 0.8; transition: transform 0.15s ease;
      }
      .owl-season-pill.owl-pill-open .owl-caret { transform: rotate(180deg); }
      .owl-season-popover {
        position: fixed; z-index: 10000; min-width: 190px; max-height: 60vh;
        overflow-y: auto; background: rgba(40,40,45,0.85);
        -webkit-backdrop-filter: blur(24px) saturate(1.6); backdrop-filter: blur(24px) saturate(1.6);
        border-radius: 14px; border: 1px solid rgba(255,255,255,0.08);
        box-shadow: 0 12px 40px rgba(0,0,0,0.5); padding: 6px;
        opacity: 0; transform: translateY(-6px) scale(0.97); transform-origin: top left;
        transition: opacity 0.15s ease, transform 0.15s ease; pointer-events: none;
      }
      .owl-season-popover.owl-open { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
      .owl-season-option {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 14px; border-radius: 8px; color: #eee; font-size: 1em; cursor: pointer;
      }
      .owl-season-option:hover, .owl-season-option:active { background: rgba(255,255,255,0.10); }
      .owl-season-option.owl-selected { color: #fff; font-weight: 700; }
      .owl-episode-grid {
        display: flex; gap: 16px; overflow-x: auto; overflow-y: hidden;
        padding: 4px 2px 12px; scroll-snap-type: x proximity; -webkit-overflow-scrolling: touch;
        width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box;
      }
      .owl-episode-card {
        flex: 0 0 auto; width: 260px; scroll-snap-align: start;
        cursor: pointer; border-radius: 14px; overflow: hidden;
        background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08);
        -webkit-backdrop-filter: blur(14px) saturate(1.4); backdrop-filter: blur(14px) saturate(1.4);
        box-shadow: 0 4px 18px rgba(0,0,0,0.35);
      }
      .owl-episode-thumb {
        position: relative;
        width: 100%; aspect-ratio: 16/9; background-size: cover; background-position: center; background-color: #222;
      }
      .owl-episode-check {
        position: absolute; top: 8px; right: 8px; width: 24px; height: 24px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center; color: #fff;
        background: rgba(20,20,24,0.5); border: 1px solid rgba(255,255,255,0.18);
        -webkit-backdrop-filter: blur(10px) saturate(1.4); backdrop-filter: blur(10px) saturate(1.4);
      }
      .owl-episode-check svg { width: 13px; height: 13px; display: block; }
      .owl-episode-progress {
        position: absolute; left: 10px; right: 10px; bottom: 10px; height: 4px; border-radius: 999px;
        background: rgba(255,255,255,0.28); overflow: hidden;
      }
      .owl-episode-progress-fill { height: 100%; border-radius: 999px; background: #fff; }
      .owl-episode-info { padding: 10px 12px 14px; }
      .owl-episode-number { text-transform: uppercase; font-size: 0.75em; opacity: 0.6; letter-spacing: 0.05em; }
      .owl-episode-title { font-weight: 700; font-size: 1.05em; margin: 2px 0 6px; }
      .owl-episode-desc {
        font-size: 0.85em; opacity: 0.75; display: -webkit-box;
        -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
      }
      .owl-episode-duration { font-size: 0.8em; opacity: 0.6; margin-top: 6px; }
    `;
    document.head.appendChild(style);
  }

  function getIdFromHash() {
    const match = location.hash.match(/[?&]id=([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  function ticksToMinutes(ticks) {
    return ticks ? Math.round(ticks / 600000000) : null;
  }

  function normalizeText(s) {
    return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // Jellyfin (SPA) spesso tiene in DOM la pagina precedente, nascosta, per la
  // navigazione avanti/indietro. Con isVisible() consideriamo solo elementi
  // realmente renderizzati nella pagina corrente.
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden') return false;
    if (style.display === 'none') return false;
    if (el.offsetParent === null && style.position !== 'fixed') return false; // display:none su un antenato
    // Scarta elementi spostati fuori dalla larghezza del viewport (pagine "vecchie"
    // mosse lateralmente da una transizione SPA).
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      if (rect.right <= 0 || rect.left >= window.innerWidth) return false;
    }
    return true;
  }

  const CHECK_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  // Stato di visione dell'episodio: visto, oppure percentuale di avanzamento.
  function getWatchState(ep) {
    const ud = ep.UserData || {};
    if (ud.Played) return { watched: true, percent: 0 };
    let pct = 0;
    if (typeof ud.PlayedPercentage === 'number') pct = ud.PlayedPercentage;
    else if (ep.RunTimeTicks && ud.PlaybackPositionTicks) pct = (ud.PlaybackPositionTicks / ep.RunTimeTicks) * 100;
    pct = Math.min(100, Math.max(0, pct));
    // sotto il 4% la barra sarebbe quasi invisibile: la ingrandisco un po'
    return { watched: false, percent: pct > 0 ? Math.max(pct, 4) : 0 };
  }

  function buildEpisodeCard(ep, apiClient) {
    const hasImg = ep.ImageTags && ep.ImageTags.Primary;
    const imgUrl = hasImg
      ? apiClient.getScaledImageUrl(ep.Id, { type: 'Primary', maxWidth: 500, tag: ep.ImageTags.Primary })
      : null;
    const minutes = ticksToMinutes(ep.RunTimeTicks);
    const watch = getWatchState(ep);
    const overlay =
      (watch.watched ? `<div class="owl-episode-check" title="Visto">${CHECK_SVG}</div>` : '') +
      (watch.percent > 0
        ? `<div class="owl-episode-progress"><div class="owl-episode-progress-fill" style="width:${watch.percent.toFixed(1)}%"></div></div>`
        : '');

    const card = document.createElement('div');
    card.className = 'owl-episode-card';
    card.dataset.episodeId = ep.Id;
    card.innerHTML = `
      <div class="owl-episode-thumb"${imgUrl ? ` style="background-image:url('${imgUrl}')"` : ''}>${overlay}</div>
      <div class="owl-episode-info">
        <div class="owl-episode-number">PUNTATA ${ep.IndexNumber != null ? ep.IndexNumber : ''}</div>
        <div class="owl-episode-title">${ep.Name || ''}</div>
        <div class="owl-episode-desc">${ep.Overview || ''}</div>
        ${minutes ? `<div class="owl-episode-duration">${minutes} min</div>` : ''}
      </div>
    `;
    card.addEventListener('click', () => {
      location.hash = '#!/details?id=' + ep.Id + '&serverId=' + apiClient.serverId();
    });
    return card;
  }

  // Trova un'intestazione di sezione il cui testo corrisponde a uno dei titoli
  // forniti, e ne ritorna il contenitore (.verticalSection se presente).
  function findSectionAnchorByTitles(titles, scope) {
    const root = scope || document;
    const headings = root.querySelectorAll('h1,h2,h3,h4,.sectionTitle,.sectionTitle-cards,.verticalSection-title');
    for (const h of headings) {
      if (!isVisible(h)) continue;
      const text = h.textContent && h.textContent.trim().toLowerCase();
      if (text && titles.indexOf(text) !== -1 && h.parentElement) {
        return h.parentElement.closest('.verticalSection') || h.parentElement;
      }
    }
    return null;
  }

  // Risale fino al contenitore dell'intera pagina dettagli, così le ricerche
  // non agganciano residui di pagine precedenti rimasti in DOM.
  function findPageScope(el) {
    let node = el;
    while (node && node !== document.body && node.parentElement) {
      if (node.nodeType === 1 && (
        (node.classList && node.classList.contains('page')) ||
        node.getAttribute('data-role') === 'page' ||
        node.id === 'itemDetailPage'
      )) {
        return node;
      }
      node = node.parentElement;
    }
    return document;
  }

  function findSeasonsSectionAnchor() {
    const headings = document.querySelectorAll('h1,h2,h3,h4,.sectionTitle,.sectionTitle-cards,.verticalSection-title');
    const candidates = [];
    let best = null;
    let bestCount = 0;
    headings.forEach((h) => {
      if (!isVisible(h)) return;
      const text = h.textContent && h.textContent.trim().toLowerCase();
      if (text !== 'stagioni' || !h.parentElement) return;
      const count = h.parentElement.querySelectorAll(CONFIG.seasonCardSelector).length;
      candidates.push({ heading: h, parent: h.parentElement, count: count });
      if (count > bestCount) {
        bestCount = count;
        best = h.parentElement;
      }
    });
    return { anchor: best, count: bestCount, candidates: candidates };
  }

  // ---------------------------------------------------------------------------
  // POSIZIONAMENTO: Trama -> Prossimo -> Stagione/Episodi -> Recensioni -> resto
  // ---------------------------------------------------------------------------

  // Elementi (visibili) il cui testo corrisponde a `matcher` (testo breve, normalizzato).
  function findTextElements(scope, matcher) {
    const root = scope === document ? document.body : scope;
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const raw = n.nodeValue;
      if (!raw || raw.length > 80) continue;
      const t = normalizeText(raw);
      if (!t || !matcher(t)) continue;
      const el = n.parentElement;
      if (!el || /^(SCRIPT|STYLE)$/.test(el.tagName)) continue;
      if (el.closest('.owl-appletv-season-section, .owl-season-popover')) continue;
      if (isVisible(el)) out.push(el);
    }
    return out;
  }

  // Dal nodo `el` risale finché il genitore non contiene uno degli elementi
  // `stops` (trama, sezione Stagioni nativa, Prossimo, la nostra sezione):
  // il nodo raggiunto è il "blocco di sezione" che sta allo stesso livello.
  function blockFor(el, stops) {
    let node = el;
    while (
      node.parentElement &&
      node.parentElement !== document.body &&
      !stops.some((s) => node.parentElement.contains(s))
    ) {
      node = node.parentElement;
    }
    return node;
  }

  // Elemento della trama (overview). Prima per classe nota, poi cercando il
  // testo della trama reale dell'item.
  function findOverview(scope, overviewText) {
    const byClass = scope.querySelectorAll('.overview, .itemOverview, #itemOverview');
    for (const el of byClass) {
      if (isVisible(el) && !el.closest('.owl-appletv-season-section')) return el;
    }
    const needle = normalizeText(overviewText).slice(0, 40);
    if (needle.length < 15) return null;
    const root = scope === document ? document.body : scope;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (!n.nodeValue || n.nodeValue.length < 15) continue;
      if (normalizeText(n.nodeValue).indexOf(needle) === -1) continue;
      const el = n.parentElement;
      if (!el || /^(SCRIPT|STYLE)$/.test(el.tagName)) continue;
      if (el.closest('.owl-appletv-season-section')) continue;
      if (isVisible(el)) return el;
    }
    return null;
  }

  // Sezione nativa "Prossimo" (prossima puntata da guardare).
  function findNextUpBlock(scope, hideEl, section) {
    let el = scope.querySelector('.nextUpSection');
    if (!(el && isVisible(el))) el = findSectionAnchorByTitles(NEXTUP_TITLES, scope);
    if (!el) return null;
    if (el.contains(hideEl) || el.contains(section) || section.contains(el)) return null;
    return el;
  }

  // Nasconde la riga di chip "IMDb / TMDB / Seerr…" sotto la trama. Le individua
  // dai link (href) e nasconde l'intera riga che li contiene, così sparisce
  // anche l'icona Seerr (il cui indirizzo dipende dal tuo server).
  const EXTERNAL_LINK_RE = /(imdb\.com|themoviedb\.org|thetvdb\.com|trakt\.tv|letterboxd\.com|seerr)/i;

  function hideExternalLinkChips(scope) {
    const root = scope === document ? document.body : scope;
    root.querySelectorAll('a[href]').forEach((a) => {
      if (!EXTERNAL_LINK_RE.test(a.getAttribute('href') || '')) return;
      if (a.closest('.owl-appletv-season-section, .owl-season-popover, .overview')) return;
      let node = a;
      // sali attraverso eventuali wrapper con un solo figlio fino alla riga dei chip
      while (node.parentElement && node.parentElement !== root && node.parentElement.children.length === 1) {
        node = node.parentElement;
      }
      const row = node.parentElement;
      // la riga contiene solo chip con poco testo: nascondi tutta la riga
      if (row && row !== root && row.children.length <= 8 && normalizeText(row.textContent).length < 60) {
        node = row;
      }
      node.style.setProperty('display', 'none', 'important');
    });
  }

  function isValidAnchor(el, stops, overview) {
    if (!el || !el.isConnected) return false;
    if (el === document.body || el === document.documentElement) return false;
    if (stops.some((s) => el.contains(s))) return false; // non deve contenere trama/Prossimo/la nostra sezione
    if (overview && !(overview.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) return false; // deve stare DOPO la trama
    return true;
  }

  // Candidati "prima del quale inserire", ordinati per posizione nel documento:
  // vince il primo, cioè quello subito dopo la trama.
  function findAnchorCandidates(scope, stops, overview) {
    const blocks = [];
    const push = (el, reason) => {
      if (el && blocks.every((b) => b.el !== el)) blocks.push({ el: el, reason: reason });
    };

    findTextElements(scope, (t) => REVIEWS_RE.test(t)).forEach((el) => push(blockFor(el, stops), 'recensioni'));
    if (overview) {
      // senza trama individuata questo ripiego sarebbe troppo rischioso
      findTextElements(scope, (t) => DETAILS_LABELS.indexOf(t) !== -1)
        .forEach((el) => push(blockFor(el, stops), 'dettagli'));
    }
    push(findSectionAnchorByTitles(CAST_TITLES, scope), 'cast');
    push(findSectionAnchorByTitles(SIMILAR_TITLES, scope), 'contenuti-simili');

    return blocks
      .filter((b) => isValidAnchor(b.el, stops, overview))
      .sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  }

  function applyPlacement(section, hideEl, scope, overviewText) {
    const overview = findOverview(scope, overviewText);
    const nextUp = findNextUpBlock(scope, hideEl, section);

    // Modalità "rimuovi Prossimo": la classe sulla pagina copre anche i
    // rendering asincroni; il display:none inline copre il caso in cui la
    // sezione non abbia la classe nativa .nextUpSection (trovata dal titolo).
    if (CONFIG.hideNextUp) {
      if (scope !== document) scope.classList.add('owl-hide-nextup');
      if (nextUp) nextUp.style.setProperty('display', 'none', 'important');
    }
    const movableNextUp = CONFIG.hideNextUp ? null : nextUp;

    if (CONFIG.hideExternalLinks) {
      if (scope !== document) scope.classList.add('owl-hide-links');
      hideExternalLinkChips(scope);
    }

    const stops = [hideEl, section, overview, nextUp].filter(Boolean);
    const candidates = findAnchorCandidates(scope, stops, overview);
    const target = candidates.length ? candidates[0] : { el: hideEl, reason: 'fallback-stagioni' };

    const parent = target.el.parentNode;
    if (!parent) return;

    if (CONFIG.debug && section.dataset.owlPlacement !== target.reason) {
      console.log('[owl-season] ancoraggio:', target.reason, target.el, '| Prossimo:', nextUp, '| trama:', overview);
    }
    section.dataset.owlPlacement = target.reason;

    const inPlace =
      target.el.previousElementSibling === section &&
      (!movableNextUp || section.previousElementSibling === movableNextUp);
    if (inPlace) return;

    // Ordine finale: [Prossimo, se non nascosto] -> [Stagione/Episodi] -> ancoraggio
    if (movableNextUp) parent.insertBefore(movableNextUp, target.el);
    parent.insertBefore(section, target.el);
  }

  // Le sezioni come Recensioni e Prossimo vengono renderizzate in modo asincrono:
  // ricontrolliamo per un po' e, se compare un ancoraggio migliore, spostiamo.
  function keepInPlace(section, hideEl, scope, overviewText) {
    const start = Date.now();
    const run = () => {
      try {
        applyPlacement(section, hideEl, scope, overviewText);
      } catch (err) {
        console.error('[owl-season] errore posizionamento', err);
      }
    };
    run();
    const iv = setInterval(() => {
      if (!section.isConnected || Date.now() - start > CONFIG.repositionTimeoutMs) {
        clearInterval(iv);
        return;
      }
      run();
    }, CONFIG.pollIntervalMs);
  }

  // ---------------------------------------------------------------------------
  // AUTO-SEGNA: guardando una puntata, quelle PRECEDENTI mai iniziate diventano "viste".
  // Non tocca le puntate a metà (perdi la posizione) né le viste; agisce solo dopo una
  // visione recente, così aprire una scheda vecchia non riscrive la cronologia.
  // ---------------------------------------------------------------------------

  // Puntate "vere" in ordine di visione: niente speciali (stagione 0) né puntate mancanti.
  function orderedEpisodes(episodes) {
    return (episodes || [])
      .filter((e) => e.ParentIndexNumber !== 0 && e.LocationType !== 'Virtual')
      .sort((a, b) => ((a.ParentIndexNumber || 0) - (b.ParentIndexNumber || 0)) || ((a.IndexNumber || 0) - (b.IndexNumber || 0)));
  }

  function isStarted(ep) {
    const ud = ep.UserData || {};
    return !!(ud.Played || ud.PlaybackPositionTicks > 0);
  }

  function progressPercent(ep) {
    const ud = ep.UserData || {};
    if (ud.Played) return 100;
    let pct = 0;
    if (typeof ud.PlayedPercentage === 'number') pct = ud.PlayedPercentage;
    else if (ep.RunTimeTicks && ud.PlaybackPositionTicks) pct = (ud.PlaybackPositionTicks / ep.RunTimeTicks) * 100;
    return Math.min(100, Math.max(0, pct));
  }

  // "Raggiunta" = finita, oppure guardata almeno per CONFIG.reachedPercent.
  function isReached(ep) {
    return !!(ep.UserData && ep.UserData.Played) || progressPercent(ep) >= CONFIG.reachedPercent;
  }

  function lastPlayedMs(ep) {
    const d = ep.UserData && ep.UserData.LastPlayedDate;
    return d ? Date.parse(d) || 0 : 0;
  }

  // Pausa dell'auto-segna dopo un segno MANUALE di stagione: quelle puntate risultano
  // "guardate ora" e altrimenti farebbero scattare il segno anche sulle stagioni prima.
  let autoMarkPausedUntil = 0;
  function pauseAutoMark() {
    autoMarkPausedUntil = Date.now() + CONFIG.recentMinutes * 60000;
    try { localStorage.setItem('owlAutoMarkPausedUntil', String(autoMarkPausedUntil)); } catch (e) { /* ignora */ }
  }
  function isAutoMarkPaused() {
    let until = autoMarkPausedUntil;
    try { until = Math.max(until, Number(localStorage.getItem('owlAutoMarkPausedUntil')) || 0); } catch (e) { /* ignora */ }
    return Date.now() < until;
  }

  const markingSeries = new Set(); // serie su cui stiamo già segnando (evita doppioni)
  let markUseDate = true;

  function markEpisodePlayed(apiClient, userId, id, date) {
    if (typeof apiClient.markPlayed === 'function') return apiClient.markPlayed(userId, id, date);
    return apiClient.ajax({
      type: 'POST',
      url: apiClient.getUrl('Users/' + userId + '/PlayedItems/' + id, date ? { DatePlayed: date.toISOString() } : {}),
      dataType: 'json',
    });
  }

  // Ritorna quante puntate ha segnato.
  async function markPreviousEpisodes(apiClient, seriesId, episodes) {
    if (!CONFIG.autoMarkPrevious || markingSeries.has(seriesId) || isAutoMarkPaused()) return 0;
    const eps = orderedEpisodes(episodes);

    // "Quella che stai guardando": la puntata raggiunta guardata più di recente (entro recentMinutes).
    const since = Date.now() - CONFIG.recentMinutes * 60000;
    let ref = -1;
    let refTime = -1;
    eps.forEach((e, i) => {
      if (!isReached(e)) return;
      const t = lastPlayedMs(e);
      if (t < since) return;
      if (t > refTime || (t === refTime && i > ref)) { ref = i; refTime = t; }
    });
    if (ref <= 0) return 0;

    const toMark = eps.slice(0, ref).filter((e) => !isStarted(e)); // solo quelle MAI iniziate
    if (!toMark.length) return 0;
    if (toMark.length > CONFIG.autoMarkMaxEpisodes) {
      console.warn('[owl-season] troppe puntate da segnare (' + toMark.length + '), salto per sicurezza');
      return 0;
    }

    markingSeries.add(seriesId);
    const userId = apiClient.getCurrentUserId();
    // Data poco precedente alla visione reale: l'"ultima puntata guardata" di Jellyfin resta quella vera.
    const stamp = new Date(refTime - 60000);
    let done = 0;
    try {
      for (const ep of toMark) {
        try {
          await markEpisodePlayed(apiClient, userId, ep.Id, markUseDate ? stamp : undefined);
        } catch (err) {
          if (!markUseDate) throw err;
          markUseDate = false; // il server non ha accettato la data: riprova senza
          await markEpisodePlayed(apiClient, userId, ep.Id);
        }
        done++;
      }
    } catch (err) {
      console.error('[owl-season] errore nel segnare le puntate precedenti', err);
    } finally {
      markingSeries.delete(seriesId);
    }
    if (CONFIG.debug) console.log('[owl-season] puntate precedenti segnate come viste:', done);
    return done;
  }

  // Dopo una riproduzione (anche se non sei sulla scheda della serie) trova cosa hai
  // guardato per ultimo e applica la stessa logica.
  let lastAutoRun = 0;
  async function autoMarkAfterPlayback() {
    if (!CONFIG.autoMarkPrevious) return;
    const apiClient = window.ApiClient;
    if (!apiClient || !apiClient.getCurrentUserId) return;
    if (Date.now() - lastAutoRun < 45000) return;
    lastAutoRun = Date.now();
    try {
      const userId = apiClient.getCurrentUserId();
      const base = {
        Recursive: true, IncludeItemTypes: 'Episode', SortBy: 'DatePlayed',
        SortOrder: 'Descending', Limit: 1, EnableImages: false,
      };
      const results = await Promise.all([
        apiClient.getItems(userId, Object.assign({}, base, { Filters: 'IsPlayed' })),
        apiClient.getItems(userId, Object.assign({}, base, { Filters: 'IsResumable' })),
      ]);
      const latest = [].concat(results[0].Items || [], results[1].Items || [])
        .filter((e) => e.SeriesId)
        .sort((a, b) => lastPlayedMs(b) - lastPlayedMs(a))[0];
      if (!latest || lastPlayedMs(latest) < Date.now() - CONFIG.recentMinutes * 60000) return;

      const res = await apiClient.getEpisodes(latest.SeriesId, { userId: userId, EnableImages: false });
      const marked = await markPreviousEpisodes(apiClient, latest.SeriesId, res.Items);
      if (marked > 0) refreshVisibleSection();
    } catch (err) {
      console.error('[owl-season] errore controllo post-riproduzione', err);
    }
  }

  function buildSection(seriesId, apiClient, hideEl, scope, overviewText) {
    const section = document.createElement('div');
    section.className = 'owl-appletv-season-section';
    section.dataset.seriesId = seriesId;

    const header = document.createElement('div');
    header.className = 'owl-season-header';
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'owl-season-pill';
    pill.innerHTML = `<span class="owl-pill-label">Stagione…</span><span class="owl-caret"></span>`;
    header.appendChild(pill);

    // Segna l'intera stagione come vista / non vista (un tocco; poi mostra l'esito per qualche secondo).
    const markBtn = document.createElement('button');
    markBtn.type = 'button';
    markBtn.className = 'owl-season-mark';
    markBtn.hidden = true; // compare quando la stagione è caricata
    markBtn.innerHTML = CHECK_SVG + '<span class="owl-mark-label"></span>';
    header.appendChild(markBtn);
    section.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'owl-episode-grid';
    section.appendChild(grid);

    // Inserimento provvisorio nella posizione nativa; subito dopo keepInPlace
    // lo sposta dopo la trama (prima di Recensioni) insieme a "Prossimo".
    hideEl.parentNode.insertBefore(section, hideEl);
    hideEl.style.display = 'none';
    keepInPlace(section, hideEl, scope, overviewText);

    let popover = null;

    function positionPopover() {
      const rect = pill.getBoundingClientRect();
      popover.style.left = rect.left + 'px';
      popover.style.top = (rect.bottom + 8) + 'px';
    }

    function closePop() {
      popover.classList.remove('owl-open');
      pill.classList.remove('owl-pill-open');
      document.removeEventListener('click', popover._h1, true);
      document.removeEventListener('keydown', popover._h2, true);
      document.removeEventListener('scroll', popover._h3, true);
    }

    function togglePopover() {
      if (popover.classList.contains('owl-open')) return closePop();
      positionPopover();
      popover.classList.add('owl-open');
      pill.classList.add('owl-pill-open');
      const onOutside = (ev) => { if (!popover.contains(ev.target) && ev.target !== pill) closePop(); };
      const onEsc = (ev) => { if (ev.key === 'Escape') closePop(); };
      const onScroll = (ev) => {
        if (popover.contains(ev.target)) return; // scroll interno al menu: non chiudere
        closePop();
      };
      popover._h1 = onOutside;
      popover._h2 = onEsc;
      popover._h3 = onScroll;
      setTimeout(() => {
        document.addEventListener('click', onOutside, true);
        document.addEventListener('keydown', onEsc, true);
        document.addEventListener('scroll', onScroll, true);
      }, 0);
    }

    let currentSeason = null;
    let seasonsList = [];
    let resume = null; // { seasonId, seasonIndex, episodeId }: dove ti sei fermato
    let alignedEpisodeId = null; // ultima puntata di ripresa su cui abbiamo allineato lo swipe
    let requestId = 0;
    let lastLoad = 0;
    let seasonAllWatched = false; // tutte le puntate della stagione mostrata sono viste?
    let markBusy = false;
    let markArmedTimer = null;
    let markFeedback = false; // il pulsante è espanso a mostrare l'esito

    // Trova dove ti sei fermato: la puntata iniziata più di recente (in corso),
    // oppure la successiva all'ultima vista. Se non hai visto nulla, la prima.
    function computeResume(episodes) {
      const eps = (episodes || [])
        .filter((e) => e.ParentIndexNumber !== 0 && e.LocationType !== 'Virtual') // niente speciali né puntate "mancanti"
        .sort((a, b) => ((a.ParentIndexNumber || 0) - (b.ParentIndexNumber || 0)) || ((a.IndexNumber || 0) - (b.IndexNumber || 0)));
      if (!eps.length) return null;
      const toResume = (e) => ({ seasonId: e.SeasonId, seasonIndex: e.ParentIndexNumber, episodeId: e.Id });

      let best = null;
      let bestTime = 0;
      let bestPos = -1;
      eps.forEach((e, i) => {
        const ud = e.UserData || {};
        if (!(ud.Played || ud.PlaybackPositionTicks > 0)) return; // mai iniziata
        const t = ud.LastPlayedDate ? Date.parse(ud.LastPlayedDate) || 0 : 0;
        // a parità di data (es. stagione segnata come vista) vince la puntata più avanti
        if (!best || t > bestTime || (t === bestTime && i > bestPos)) {
          best = e; bestTime = t; bestPos = i;
        }
      });

      if (!best) return toResume(eps[0]);                       // serie mai iniziata
      if (!(best.UserData && best.UserData.Played)) return toResume(best); // puntata in corso
      return toResume(eps[bestPos + 1] || best);                // la successiva (o l'ultima, se hai finito tutto)
    }

    function fetchResume(skipAutoMark) {
      return apiClient
        .getEpisodes(seriesId, { userId: apiClient.getCurrentUserId(), EnableImages: false })
        .then((res) => {
          const items = res.Items || [];
          if (!skipAutoMark) {
            // Segna come viste le puntate precedenti a quella che stai guardando e aggiorna i check.
            markPreviousEpisodes(apiClient, seriesId, items).then((marked) => {
              if (marked > 0 && currentSeason) loadEpisodes(currentSeason, true);
            });
          }
          return computeResume(items);
        })
        .catch((err) => {
          console.error('[owl-season] errore calcolo ripresa', err);
          return null;
        });
    }

    function seasonForResume(r) {
      if (!r) return null;
      return (
        seasonsList.find((s) => s.Id === r.seasonId) ||
        seasonsList.find((s) => r.seasonIndex != null && s.IndexNumber === r.seasonIndex) ||
        null
      );
    }

    // Porta la puntata `episodeId` a inizio riga: quelle prima restano raggiungibili
    // con uno swipe a sinistra (lo "storico").
    function scrollToEpisode(episodeId) {
      const card = grid.querySelector('.owl-episode-card[data-episode-id="' + episodeId + '"]');
      if (!card) return false;
      const gridRect = grid.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const padLeft = parseFloat(getComputedStyle(grid).paddingLeft) || 0;
      grid.scrollLeft = grid.scrollLeft + (cardRect.left - gridRect.left) - padLeft;
      return true;
    }

    // isRefresh = false -> stagione appena scelta / primo caricamento:
    //    nella stagione dove sei arrivato lo swipe parte dalla tua puntata, nelle altre dalla prima
    // isRefresh = true  -> aggiornamento (es. dopo la riproduzione): mantiene la posizione,
    //    tranne se la tua puntata di ripresa è cambiata
    function loadEpisodes(season, isRefresh) {
      const myRequest = ++requestId;
      lastLoad = Date.now();
      return apiClient
        .getEpisodes(seriesId, { seasonId: season.Id, userId: apiClient.getCurrentUserId(), Fields: 'Overview,RunTimeTicks' })
        .then((epRes) => {
          if (myRequest !== requestId) return; // risposta superata da una selezione più recente
          const keepScroll = grid.scrollLeft;
          grid.innerHTML = '';
          (epRes.Items || []).forEach((ep) => grid.appendChild(buildEpisodeCard(ep, apiClient)));

          const real = (epRes.Items || []).filter((e) => e.LocationType !== 'Virtual');
          seasonAllWatched = real.length > 0 && real.every((e) => e.UserData && e.UserData.Played);
          updateMarkButton();

          const resumeSeason = seasonForResume(resume);
          const isResumeSeason = resumeSeason && resumeSeason.Id === season.Id;
          if (isResumeSeason && (!isRefresh || resume.episodeId !== alignedEpisodeId)) {
            if (scrollToEpisode(resume.episodeId)) {
              alignedEpisodeId = resume.episodeId;
              return;
            }
          }
          grid.scrollLeft = isRefresh ? keepScroll : 0;
        })
        .catch((err) => console.error('[owl-season] errore caricamento episodi', err));
    }

    function selectSeason(season) {
      currentSeason = season;
      markBtn.hidden = true;
      collapseMark();
      pill.querySelector('.owl-pill-label').textContent = season.Name;
      popover.querySelectorAll('.owl-season-option').forEach((n) => {
        n.classList.toggle('owl-selected', n.dataset.seasonId === season.Id);
      });
      loadEpisodes(season, false);
      closePop();
    }

    function updateMarkButton() {
      markBtn.hidden = !currentSeason;
      markBtn.classList.toggle('owl-done', seasonAllWatched);
      const hint = seasonAllWatched ? 'Stagione vista: tocca per segnarla come non vista' : 'Segna la stagione come vista';
      markBtn.title = hint;
      markBtn.setAttribute('aria-label', hint);
    }

    function collapseMark() {
      clearTimeout(markArmedTimer);
      markFeedback = false;
      markBtn.classList.remove('owl-expanded');
    }

    // Dopo l'azione il pulsante si espande per qualche secondo a mostrare l'esito.
    function showMarkFeedback(text) {
      markBtn.querySelector('.owl-mark-label').textContent = text;
      markBtn.classList.add('owl-expanded');
      markFeedback = true;
      clearTimeout(markArmedTimer);
      markArmedTimer = setTimeout(collapseMark, 3500);
    }

    // Segnare una Stagione come vista/non vista fa la stessa cosa su tutte le sue puntate.
    function setSeasonPlayed(userId, seasonId, played) {
      if (played && typeof apiClient.markPlayed === 'function') return apiClient.markPlayed(userId, seasonId);
      if (!played && typeof apiClient.markUnplayed === 'function') return apiClient.markUnplayed(userId, seasonId);
      return apiClient.ajax({
        type: played ? 'POST' : 'DELETE',
        url: apiClient.getUrl('Users/' + userId + '/PlayedItems/' + seasonId),
        dataType: 'json',
      });
    }

    function toggleSeasonWatched() {
      const season = currentSeason;
      const userId = apiClient.getCurrentUserId();
      const willBeWatched = !seasonAllWatched;
      const stillHere = () => currentSeason && currentSeason.Id === season.Id;
      markBusy = true;
      markBtn.disabled = true;
      pauseAutoMark(); // il segno manuale non deve far scattare l'auto-segna sulle stagioni prima
      Promise.resolve(setSeasonPlayed(userId, season.Id, willBeWatched))
        .then(() => {
          if (stillHere()) showMarkFeedback(willBeWatched ? 'Segnata come vista' : 'Segnata come non vista');
          return fetchResume(true);
        })
        .then((newResume) => {
          if (newResume) resume = newResume;
          // aggiorna check e barre (se nel frattempo non hai cambiato stagione)
          if (stillHere()) return loadEpisodes(season, true);
        })
        .catch((err) => {
          console.error('[owl-season] errore nel segnare la stagione', err);
          if (stillHere()) showMarkFeedback('Non riuscito');
        })
        .then(() => { markBusy = false; markBtn.disabled = false; });
    }

    // Un solo tocco: esegue subito. Mentre mostra l'esito ignora altri tocchi.
    markBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!currentSeason || markBusy || markFeedback) return;
      toggleSeasonWatched();
    });

    // Richiamata quando si torna sulla scheda (es. dopo aver guardato una puntata):
    // ricarica gli episodi così check e barra di avanzamento sono aggiornati e, se
    // hai finito una puntata, lo swipe si sposta su quella successiva.
    section._owlRefresh = () => {
      if (!currentSeason || Date.now() - lastLoad < 1500) return;
      lastLoad = Date.now(); // evita refresh paralleli
      fetchResume().then((newResume) => {
        const prevSeason = seasonForResume(resume);
        if (newResume) resume = newResume;
        const newSeason = seasonForResume(resume);
        // Eri sulla stagione di ripresa e la ripresa è passata alla stagione dopo: seguila.
        if (prevSeason && newSeason && currentSeason.Id === prevSeason.Id && newSeason.Id !== prevSeason.Id) {
          selectSeason(newSeason);
        } else {
          loadEpisodes(currentSeason, true);
        }
      });
    };

    // Stagioni e punto di ripresa vengono caricati in parallelo.
    Promise.all([
      apiClient.getSeasons(seriesId, { userId: apiClient.getCurrentUserId() }),
      fetchResume(),
    ])
      .then(([res, resumeInfo]) => {
        const seasons = res.Items || [];
        if (!seasons.length) return;
        seasonsList = seasons;
        resume = resumeInfo;
        popover = document.createElement('div');
        popover.className = 'owl-season-popover';
        seasons.forEach((s) => {
          const opt = document.createElement('div');
          opt.className = 'owl-season-option';
          opt.dataset.seasonId = s.Id;
          opt.textContent = s.Name;
          opt.addEventListener('click', () => selectSeason(s));
          popover.appendChild(opt);
        });
        document.body.appendChild(popover);

        // Oltre CONFIG.maxVisiblePopoverItems stagioni, il menu mostra solo le
        // prime N e scrolla in verticale per le altre.
        if (seasons.length > CONFIG.maxVisiblePopoverItems) {
          const firstOption = popover.querySelector('.owl-season-option');
          const popStyle = getComputedStyle(popover);
          const paddingV = parseFloat(popStyle.paddingTop) + parseFloat(popStyle.paddingBottom);
          const itemHeight = firstOption.getBoundingClientRect().height;
          popover.style.maxHeight = (itemHeight * CONFIG.maxVisiblePopoverItems + paddingV) + 'px';
        }

        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          togglePopover();
        });

        // Parti dalla stagione dove ti sei fermato (se non lo so, dalla prima).
        selectSeason(seasonForResume(resume) || seasons[0]);
      })
      .catch((err) => console.error('[owl-season] errore caricamento stagioni', err));
  }

  function tryInit() {
    const apiClient = window.ApiClient;
    if (!apiClient) return;

    const id = getIdFromHash();
    if (!id) return;

    // Solo un'istanza VISIBILE conta come "già fatto" (Jellyfin può tenere in
    // DOM, nascosta, la pagina precedente).
    const existing = Array.from(document.querySelectorAll('.owl-appletv-season-section')).find(isVisible);
    if (existing && existing.dataset.seriesId === id) return;

    apiClient
      .getItem(apiClient.getCurrentUserId(), id)
      .then((item) => {
        if (item.Type !== 'Series') return;
        if (getIdFromHash() !== id) return; // nel frattempo l'utente ha navigato altrove
        if (Array.from(document.querySelectorAll('.owl-appletv-season-section[data-series-id="' + id + '"]')).some(isVisible)) return;

        const start = Date.now();
        const check = setInterval(() => {
          if (getIdFromHash() !== id) { clearInterval(check); return; } // navigazione cambiata durante il polling

          const visibleCards = Array.from(document.querySelectorAll(CONFIG.seasonCardSelector)).filter(isVisible);
          const hasAnyCard = visibleCards[0] || null;

          if (hasAnyCard) {
            const { anchor } = findSeasonsSectionAnchor();
            const hideEl = anchor || hasAnyCard.closest('.verticalSection') || hasAnyCard.parentElement.parentElement;
            if (hideEl) {
              clearInterval(check);
              if (getIdFromHash() !== id) return;
              if (Array.from(document.querySelectorAll('.owl-appletv-season-section[data-series-id="' + id + '"]')).some(isVisible)) return;

              // Il blocco nativo "Stagioni" viene nascosto; la nostra sezione (insieme
              // a "Prossimo") viene portata subito dopo la trama, prima di Recensioni.
              buildSection(id, apiClient, hideEl, findPageScope(hideEl), item.Overview || '');
            }
          } else if (Date.now() - start > CONFIG.pollTimeoutMs) {
            clearInterval(check);
          }
        }, CONFIG.pollIntervalMs);
      })
      .catch((err) => console.error('[owl-season] errore getItem', err));
  }

  let lastHash = location.hash; // per capire da quale pagina si arriva (es. dal player)

  // Se la scheda di questa serie è già visibile (es. si torna indietro dalla
  // riproduzione), aggiorna lo stato "visto / in corso" delle puntate.
  function refreshVisibleSection() {
    const id = getIdFromHash();
    if (!id) return;
    const section = Array.from(document.querySelectorAll('.owl-appletv-season-section[data-series-id="' + id + '"]')).find(isVisible);
    if (section && section._owlRefresh) section._owlRefresh();
  }

  function init() {
    injectStyles();
    tryInit();
    new MutationObserver(() => tryInit()).observe(document.body, { childList: true, subtree: true });
    // La navigazione tra pagine di Jellyfin cambia l'hash prima che il nuovo
    // contenuto sia renderizzato: ricontrollare subito rende l'avvio più reattivo.
    window.addEventListener('hashchange', () => {
      const cameFromPlayer = /\/video/.test(lastHash);
      lastHash = location.hash;
      tryInit();
      setTimeout(refreshVisibleSection, 500); // dopo la transizione di pagina
      if (cameFromPlayer) setTimeout(autoMarkAfterPlayback, 2500); // il server ha registrato la fine
    });
    document.addEventListener('viewshow', () => {
      setTimeout(refreshVisibleSection, 200);
      setTimeout(autoMarkAfterPlayback, 1500);
    });
    // Tornando all'app (es. da Jellyfin Expo in background) aggiorna i progressi.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshVisibleSection();
        setTimeout(autoMarkAfterPlayback, 1500);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
