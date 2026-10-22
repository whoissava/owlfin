/**
 * OwlHub - Sezione "Di Tendenza Ora"
 * ----------------------------------
 * Trending TMDB filtrato sulla libreria Jellyfin.
 *
 * FUNZIONI:
 * - Sezione sopra "Film aggiunti di recente"
 * - Non dipende da "Prossimo"
 * - Card stile Jellyfin/OwlHub
 * - Tocco/click normale -> SEMPRE dettaglio Jellyfin, anche
 *   se il tocco cade sul video del trailer già in riproduzione
 *   (un overlay trasparente sopra l'iframe intercetta il click
 *   prima che arrivi a YouTube)
 * - Long press -> apre il trailer italiano YouTube della card
 *   premuta, in autoplay, chiudendo un eventuale trailer aperto
 *   su un'altra card. L'autoplay scatta SUBITO al raggiungimento
 *   della soglia, senza aspettare il rilascio del dito
 * - Volume impostato a 100
 * - Nessuna interazione col player YouTube (niente controlli,
 *   niente link a youtube.com)
 * - Click fuori dalla card -> chiude il trailer
 * - Un solo trailer alla volta
 */

(function () {
    // ── i18n ────────────────────────────────────────────────────────
    const _lang = (navigator.language || 'it').split('-')[0];
    const _i18n = {
        it: {
            nextEpisode:       'Prossimo episodio',
            nextEpisodes:      'Prossimi episodi',
            moreUpcoming:      'in arrivo',
            close:             'Chiudi',
            seen:              'Visto',
            episode:           'PUNTATA',
            markSeasonWatched: 'Segna stagione come vista',
            season:            'Stagione',
            chatTitle:         'Chat',
            chatPlaceholder:   'Scrivi un messaggio...',
            trendingTitle:     'Di Tendenza Ora',
            trendingKicker:    'INIZIA A GUARDARE',
            anchorMovies:      ['Film aggiunti di recente','Film recenti'],
            continueWatching:  'Prossimo',
            notAuthenticated:  'Non autenticato',
            noGenres:          'Nessun genere trovato',
            movies:            'Film',
            series:            'Serie TV',
            film:              'FILM',
            serieLabel:        'SERIE',
            loading:           'Caricamento...',
        },
        en: {
            nextEpisode:       'Next episode',
            nextEpisodes:      'Upcoming episodes',
            moreUpcoming:      'upcoming',
            close:             'Close',
            seen:              'Watched',
            episode:           'EPISODE',
            markSeasonWatched: 'Mark season as watched',
            season:            'Season',
            chatTitle:         'Chat',
            chatPlaceholder:   'Write a message...',
            trendingTitle:     'Trending Now',
            trendingKicker:    'START WATCHING',
            anchorMovies:      ['Recently added movies','Recent movies'],
            continueWatching:  'Next Up',
            notAuthenticated:  'Not authenticated',
            noGenres:          'No genres found',
            movies:            'Movies',
            series:            'TV Shows',
            film:              'MOVIE',
            serieLabel:        'SERIES',
            loading:           'Loading...',
        }
    };
    const t = _i18n[_lang] || _i18n['en'];


    'use strict';

    // ====================== CONFIG ======================

    const tmdbKey = () => window.__owlfin_tmdb_key__ || '';
    const TMDB_LANG = 'it-IT';

    const CACHE_KEY = 'owlhub_trending_now_cache_v4';
    const TRAILER_CACHE_PREFIX = 'owlhub_trailer_it_v1_';

    const CACHE_HOURS = 24;

    const SECTION_TITLE = t.trendingTitle;
    const KICKER_TEXT = t.trendingKicker;

    const MAX_ITEMS = 10;

    // La nostra sezione viene inserita PRIMA della prima di queste
    // che trova (i temi possono rinominare l'etichetta nel tempo).
    const ANCHOR_CANDIDATE_TITLES = [
        ...t.anchorMovies,
        'Recently added movies',
        'Latest movies'
    ];

    // Se nessuna delle etichette sopra viene trovata, come ultima
    // spiaggia ci ancoriamo subito dopo questa sezione (di solito
    // la prima riga della home).
    const CONTINUE_WATCHING_TITLE = t.continueWatching;

    // Durata del long press (ridotta per essere più reattivo).
    const LONG_PRESS_MS = 350;

    // Tolleranza di movimento in pixel^2 prima di annullare il long press.
    const MOVE_TOLERANCE_SQ = 144;

    // =====================================================


    function getApiClient() {
        return window.ApiClient;
    }

    // Al primo avvio il client Jellyfin (utente, token) e la rete possono non essere ancora pronti:
    // in quel caso non e' un errore, si riprova al giro successivo.
    function clientReady() {
        const c = getApiClient();
        try {
            return !!(c && c.getCurrentUserId && c.getCurrentUserId() && (!c.accessToken || c.accessToken()));
        } catch (e) {
            return false;
        }
    }

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function withTimeout(promise, ms) {
        let timer;
        const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
        return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
    }

    async function withRetry(fn, tries, delay) {
        let last;
        for (let i = 0; i < tries; i++) {
            try {
                return await fn();
            } catch (e) {
                last = e;
                if (i < tries - 1) await sleep(delay * (i + 1));
            }
        }
        throw last;
    }


    // =====================================================
    // TMDB TRENDING
    // =====================================================

    async function fetchTrendingFromTMDB() {

        const [moviesRes, tvRes] = await Promise.all([
            fetch(`https://api.themoviedb.org/3/trending/movie/week?api_key=${tmdbKey()}&language=${TMDB_LANG}`),
            fetch(`https://api.themoviedb.org/3/trending/tv/week?api_key=${tmdbKey()}&language=${TMDB_LANG}`)
        ]);

        if (!moviesRes.ok || !tvRes.ok) {
            throw new Error('Errore nella richiesta a TMDB');
        }

        const movies = ((await moviesRes.json()).results || []).map((r) => Object.assign({}, r, { _t: 'movie' }));
        const tv = ((await tvRes.json()).results || []).map((r) => Object.assign({}, r, { _t: 'tv' }));

        return [...movies, ...tv].sort(
            (a, b) => (b.popularity || 0) - (a.popularity || 0)
        );
    }


    // =====================================================
    // CACHE
    // =====================================================

    function todayKey() {
        const d = new Date();
        return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    }

    function getCache() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;

            const data = JSON.parse(raw);

            // Invalida se il giorno è cambiato (aggiornamento giornaliero TMDB)
            if (data.day !== todayKey()) return null;

            return data.items;
        } catch (e) {
            return null;
        }
    }


    // Cache scaduta (di ieri): meglio mostrare subito quella e aggiornare in background che niente.
    function getStaleCache() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            return data && data.items && data.items.length ? data.items : null;
        } catch (e) {
            return null;
        }
    }

    function setCache(items) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                day: todayKey(),
                items
            }));
        } catch (e) {
            // Ignora eventuale errore localStorage.
        }
    }


    // =====================================================
    // MATCH CON LIBRERIA JELLYFIN
    // =====================================================

    async function matchLibraryItems(trendingList) {

        const apiClient = getApiClient();
        const userId = apiClient.getCurrentUserId();

        // 1) elenco leggero: solo id e provider, senza immagini ne' dati utente
        const light = await apiClient.getItems(userId, {
            IncludeItemTypes: 'Movie,Series',
            Recursive: true,
            Fields: 'ProviderIds',
            EnableImages: false,
            EnableUserData: false,
            EnableTotalRecordCount: false,
            ImageTypeLimit: 0
        });

        const byKey = {};
        (light.Items || []).forEach((item) => {
            const tmdbId = item.ProviderIds && (item.ProviderIds.Tmdb || item.ProviderIds.tmdb);
            if (tmdbId) {
                byKey[(item.Type === 'Series' ? 'tv' : 'movie') + ':' + tmdbId] = item.Id;
            }
        });

        const ids = [];
        trendingList.forEach((tr) => {
            const id = byKey[(tr._t === 'tv' ? 'tv' : 'movie') + ':' + tr.id];
            if (id && ids.indexOf(id) === -1) ids.push(id);
        });

        const top = ids.slice(0, MAX_ITEMS);
        if (!top.length) return [];

        // 2) dettagli completi solo dei pochi titoli in tendenza
        const full = await apiClient.getItems(userId, {
            Ids: top.join(','),
            Fields: 'ProviderIds,ProductionYear,Genres,OfficialRating,Studios,BackdropImageTags',
            EnableImages: true
        });

        const byId = {};
        (full.Items || []).forEach((it) => { byId[it.Id] = it; });
        return top.map((id) => byId[id]).filter(Boolean);
    }


    // =====================================================
    // COLORE DOMINANTE
    // =====================================================

    function getDominantColorRaw(imgUrl) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';

            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const w = canvas.width = 24;
                    const h = canvas.height = 24;
                    const ctx = canvas.getContext('2d');

                    ctx.drawImage(img, 0, 0, w, h);

                    const data = ctx.getImageData(0, 0, w, h).data;

                    let r = 0, g = 0, b = 0, count = 0;

                    for (let i = 0; i < data.length; i += 4) {
                        r += data[i];
                        g += data[i + 1];
                        b += data[i + 2];
                        count++;
                    }

                    r = Math.round(r / count);
                    g = Math.round(g / count);
                    b = Math.round(b / count);

                    resolve(`rgb(${r},${g},${b})`);
                } catch (e) {
                    resolve('rgb(35,35,40)');
                }
            };

            img.onerror = () => resolve('rgb(35,35,40)');
            img.src = imgUrl;
        });
    }


    // Il colore e' solo un dettaglio estetico: se l'immagine tarda (primo avvio, il server deve ancora
    // ridimensionarla) non si aspetta oltre 3 secondi.
    function getDominantColor(imgUrl) {
        return Promise.race([getDominantColorRaw(imgUrl), sleep(3000).then(() => 'rgb(35,35,40)')]);
    }

    async function enrichWithVisuals(items) {

        const apiClient = getApiClient();

        await Promise.all(items.map(async (item) => {

            const backdropTag = item.BackdropImageTags && item.BackdropImageTags[0];
            const primaryTag = item.ImageTags && item.ImageTags.Primary;
            const logoTag = item.ImageTags && item.ImageTags.Logo;

            const bgTag = backdropTag || primaryTag;
            const bgType = backdropTag ? 'Backdrop' : 'Primary';

            item._bgUrl = bgTag
                ? apiClient.getImageUrl(item.Id, { type: bgType, tag: bgTag, width: 500 })
                : '';

            item._logoUrl = logoTag
                ? apiClient.getImageUrl(item.Id, { type: 'Logo', tag: logoTag, width: 300 })
                : '';

            item._color = item._bgUrl
                ? await getDominantColor(item._bgUrl)
                : 'rgb(35,35,40)';
        }));

        return items;
    }


    // =====================================================
    // NAVIGAZIONE JELLYFIN
    // =====================================================

    function goToItem(item) {

        document.querySelectorAll('video').forEach((v) => {
            try { v.pause(); } catch (e) {}
        });

        const navigate = () => {
            if (window.require) {
                try {
                    require(['appRouter'], function (appRouter) {
                        appRouter.showItem(item, item.ServerId);
                    });
                    return;
                } catch (e) {}
            }

            window.location.hash = `#/details?id=${item.Id}`;
        };

        // Ridotto per essere più reattivo.
        setTimeout(navigate, 30);
    }


    // =====================================================
    // TRAILER ITALIANO
    // =====================================================

    async function getItalianTrailerKey(item) {

        const cacheKey = TRAILER_CACHE_PREFIX + item.Id;

        try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) return cached === '__NONE__' ? null : cached;
        } catch (e) {}

        const tmdbId = item.ProviderIds &&
            (item.ProviderIds.Tmdb || item.ProviderIds.tmdb);

        if (!tmdbId) return null;

        try {
            const type = item.Type === 'Series' ? 'tv' : 'movie';

            const res = await fetch(
                `https://api.themoviedb.org/3/${type}/${encodeURIComponent(tmdbId)}/videos?api_key=${tmdbKey()}&language=${TMDB_LANG}`
            );

            if (!res.ok) throw new Error('TMDB videos HTTP ' + res.status);

            const data = await res.json();
            const videos = Array.isArray(data.results) ? data.results : [];

            // SOLO trailer/teaser italiano.
            const trailer = videos.find(
                v => v.site === 'YouTube' &&
                    v.iso_639_1 === 'it' &&
                    (v.type === 'Trailer' || v.type === 'Teaser') &&
                    v.key
            );

            const key = trailer ? trailer.key : null;

            try {
                localStorage.setItem(cacheKey, key || '__NONE__');
            } catch (e) {}

            return key;
        } catch (e) {
            console.warn('[OwlHub Trailer]', e);
            return null;
        }
    }


    function closeTrailer(card) {
        const iframe = card.querySelector('.owlhub-trailer-iframe');
        const overlay = card.querySelector('.owlhub-trailer-overlay');
        if (iframe) iframe.remove();
        if (overlay) overlay.remove();
        card.classList.remove('owlhub-trailer-playing');
    }


    async function playItalianTrailer(item, card) {

        if (card.classList.contains('owlhub-trailer-playing')) {
            return;
        }

        const key = await getItalianTrailerKey(item);
        if (!key) return;

        // Chiude eventuali altri trailer ancora aperti.
        document.querySelectorAll('.owlhub-trending-card.owlhub-trailer-playing')
            .forEach(other => {
                if (other !== card) closeTrailer(other);
            });

        closeTrailer(card);

        const iframe = document.createElement('iframe');
        iframe.className = 'owlhub-trailer-iframe';
        iframe.title = `Trailer italiano - ${item.Name}`;

        /*
         * autoplay=1 + mute=0: chiediamo a YouTube di partire
         * direttamente con audio. controls=0/fs=0 perché
         * l'interazione con il player YouTube non serve più:
         * ci pensa l'overlay trasparente sopra l'iframe a
         * portare l'utente alla pagina Jellyfin.
         */

        iframe.src =
            `https://www.youtube.com/embed/${encodeURIComponent(key)}` +
            `?autoplay=1&mute=0&playsinline=1&controls=0&fs=0&rel=0` +
            `&disablekb=1&iv_load_policy=3` +
            `&hl=it&cc_lang_pref=it&enablejsapi=1` +
            `&origin=${encodeURIComponent(location.origin)}` +
            `&widget_referrer=${encodeURIComponent(location.href)}`;

        iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
        iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        iframe.setAttribute('tabindex', '-1');

        card.appendChild(iframe);

        /*
         * Overlay trasparente SOPRA l'iframe (z-index più alto).
         * Un iframe cross-origin intercetta da solo ogni click/tap
         * al suo interno, quindi senza questo layer un tocco sul
         * video finiva dentro YouTube invece che su Jellyfin. Il
         * click sull'overlay risale (bubbling) al click handler
         * della card, che porta alla pagina del film.
         *
         * Niente più copertura col poster: rallentava la partenza
         * e sembrava un blocco. Titolo/watermark di YouTube restano
         * visibili per un paio di secondi (li nasconde YouTube da
         * solo) ma il video parte subito, fluido.
         */

        const overlay = document.createElement('div');
        overlay.className = 'owlhub-trailer-overlay';
        card.appendChild(overlay);

        card.classList.add('owlhub-trailer-playing');

        const sendPlayerCommand = (func, args = []) => {
            try {
                iframe.contentWindow.postMessage(
                    JSON.stringify({ event: 'command', func, args }),
                    '*'
                );
            } catch (e) {}
        };

        /*
         * Il player YouTube, dopo il "load" dell'iframe, impiega
         * ancora un momento ad agganciare il proprio listener dei
         * postMessage: inviare i comandi troppo presto (o una sola
         * volta) è la causa più comune per cui l'autoplay/l'unmute
         * sembrano "non partire". Riproviamo alcune volte in una
         * finestra breve, così il comando arriva comunque a bersaglio.
         */

        iframe.addEventListener('load', () => {

            let attempts = 0;

            const trySend = () => {
                sendPlayerCommand('playVideo');
                sendPlayerCommand('unMute');
                sendPlayerCommand('setVolume', [100]);

                attempts++;

                if (attempts < 6 && card.classList.contains('owlhub-trailer-playing')) {
                    setTimeout(trySend, 200);
                }
            };

            setTimeout(trySend, 150);

        }, { once: true });
    }


    // =====================================================
    // CARD
    // =====================================================

    function buildCard(item, rank) {

        const rating = item.OfficialRating || '';
        const genres = (item.Genres || []).slice(0, 2).join(', ');
        const year = item.ProductionYear || '';
        const studio = item.Studios && item.Studios[0] ? item.Studios[0].Name : '';

        const metaLine = [rating, genres, year].filter(Boolean).join(' • ');

        const titleHtml = item._logoUrl
            ? `<img class="owlhub-trending-logo" src="${item._logoUrl}" alt="${item.Name}">`
            : `<div class="owlhub-trending-title-text">${item.Name}</div>`;

        const card = document.createElement('div');
        card.className = 'owlhub-trending-card';
        card.setAttribute('data-owlfin-id', item.Id);
        card.style.setProperty('--owlhub-color', item._color || 'rgb(35,35,40)');

        if (item._bgUrl) {
            card.style.backgroundImage = `url('${item._bgUrl}')`;
        }

        card.innerHTML = `
            <div class="owlhub-trending-rank">${rank}</div>
            <div class="owlhub-trending-content">
                <div class="owlhub-trending-kicker">${KICKER_TEXT}</div>
                ${titleHtml}
                <div class="owlhub-trending-meta">${metaLine}</div>
            </div>
            ${studio ? `<div class="owlhub-trending-badge">${studio}</div>` : ''}
        `;

        // =================================================
        // STATO LONG PRESS / CLICK
        // =================================================

        let pressStartX = 0;
        let pressStartY = 0;
        let pressStartTime = 0;
        let longPressTriggered = false;
        let movedTooFar = false;
        let longPressTimer = null;

        // Precarica il trailer in background, così quando l'utente
        // fa il long press la chiave YouTube è già disponibile.
        getItalianTrailerKey(item).catch(() => null);


        // -----------------------------------------------
        // POINTER DOWN — avvia il timer del long press.
        // L'autoplay scatta QUI (via setTimeout), non al
        // rilascio: appena la soglia è raggiunta mentre il
        // dito è ancora premuto, il trailer parte subito.
        // -----------------------------------------------

        card.addEventListener('pointerdown', (event) => {

            if (event.button !== undefined && event.button !== 0) return;
            if (card.classList.contains('owlhub-trailer-playing')) return;

            pressStartX = event.clientX;
            pressStartY = event.clientY;
            pressStartTime = Date.now();
            longPressTriggered = false;
            movedTooFar = false;

            clearTimeout(longPressTimer);

            longPressTimer = setTimeout(() => {
                if (pressStartTime && !movedTooFar) {
                    longPressTriggered = true;
                    playItalianTrailer(item, card);
                }
            }, LONG_PRESS_MS);
        });


        // -----------------------------------------------
        // MOVIMENTO — annulla il long press se è uno scroll.
        // -----------------------------------------------

        card.addEventListener('pointermove', (event) => {

            if (!pressStartTime) return;

            const dx = event.clientX - pressStartX;
            const dy = event.clientY - pressStartY;

            if ((dx * dx + dy * dy) > MOVE_TOLERANCE_SQ) {
                movedTooFar = true;
                clearTimeout(longPressTimer);
            }
        });


        // -----------------------------------------------
        // POINTER UP — ferma solo il timer se non è ancora
        // scattato; se il trailer è già partito, non fa nulla
        // (ci pensa il click subito dopo a non navigare).
        // -----------------------------------------------

        card.addEventListener('pointerup', () => {
            clearTimeout(longPressTimer);
            pressStartTime = 0;
        });


        // -----------------------------------------------
        // POINTER CANCEL
        // -----------------------------------------------

        card.addEventListener('pointercancel', () => {
            clearTimeout(longPressTimer);
            pressStartTime = 0;
            movedTooFar = false;
        });


        // -----------------------------------------------
        // POINTER LEAVE — se il dito scivola via, annulla.
        // -----------------------------------------------

        card.addEventListener('pointerleave', () => {
            if (pressStartTime) {
                clearTimeout(longPressTimer);
                pressStartTime = 0;
                movedTooFar = false;
            }
        });


        // -----------------------------------------------
        // CLICK — tocco normale: porta sempre alla pagina
        // Jellyfin del film. Vale anche per un click sul
        // video del trailer già in riproduzione (l'overlay
        // sopra l'iframe fa risalire il click fin qui).
        // L'unica eccezione è il click generato subito dopo
        // un long press: il trailer è appena partito e non
        // deve essere interrotto dalla navigazione.
        // -----------------------------------------------

        card.addEventListener('click', (event) => {

            if (longPressTriggered) {
                event.preventDefault();
                event.stopPropagation();
                longPressTriggered = false;
                return;
            }

            goToItem(item);
        });

        return card;
    }


    // =====================================================
    // RICERCA SEZIONE JELLYFIN
    // =====================================================

    function findSectionByTitle(titleText, scope) {
        const target = titleText.trim().toLowerCase();
        const sections = (scope || document).querySelectorAll('.homeSectionsContainer .verticalSection');

        for (const sec of sections) {
            const titleEl = sec.querySelector('.sectionTitle');

            if (titleEl && titleEl.textContent.trim().toLowerCase().includes(target)) {
                return sec;
            }
        }

        return null;
    }


    function findAnchorSection(scope) {

        for (const title of ANCHOR_CANDIDATE_TITLES) {
            const found = findSectionByTitle(title, scope);
            if (found) return found;
        }

        // Ultima spiaggia: nessuna etichetta nota trovata (es. il tema
        // l'ha rinominata di nuovo). Usiamo la sezione subito dopo
        // "Prossimo", che nella home è di norma la prima riga di film.
        const continueWatching = findSectionByTitle(CONTINUE_WATCHING_TITLE, scope);

        if (continueWatching) {

            let next = continueWatching.nextElementSibling;

            while (next && (!next.classList.contains('verticalSection') ||
                            next.classList.contains('owlhub-trending-section'))) {
                next = next.nextElementSibling;
            }

            if (next) return next;
        }

        // Diagnostica: elenca i titoli trovati per capire cosa manca.
        const titles = Array.from(
            (scope || document).querySelectorAll('.homeSectionsContainer .verticalSection .sectionTitle')
        ).map(el => el.textContent.trim());

        if (!findAnchorSection.warned) {
            findAnchorSection.warned = true;
            console.warn(
                '[OwlHub Trending Now] Nessuna sezione di ancoraggio trovata. Sezioni disponibili:',
                titles
            );
        }

        return null;
    }


    // =====================================================
    // COSTRUZIONE SEZIONE
    // =====================================================

    function buildSectionFromAnchor(anchor, items) {

        if (!anchor) return null;

        const clone = anchor.cloneNode(true);
        clone.classList.add('owlhub-trending-section');
        clone.removeAttribute('id');

        clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));

        const titleEl = clone.querySelector('.sectionTitle');

        if (titleEl) {
            titleEl.textContent = SECTION_TITLE;
        }

        // Elimina eventuale pulsante/link accanto al titolo.
        if (titleEl && titleEl.parentElement) {
            Array.from(titleEl.parentElement.children).forEach(sibling => {
                if (sibling !== titleEl) sibling.remove();
            });
        }

        const itemsContainer = clone.querySelector('.itemsContainer') ||
            clone.querySelector('.scrollSlider');

        if (!itemsContainer) return null;

        itemsContainer.innerHTML = '';
        itemsContainer.classList.add('owlhub-trending-row');

        items.forEach((item, index) => {
            itemsContainer.appendChild(buildCard(item, index + 1));
        });

        return clone;
    }


    // =====================================================
    // CSS
    // =====================================================

    function ensureStyles() {

        if (document.getElementById('owlhub-trending-styles')) return;

        const style = document.createElement('style');
        style.id = 'owlhub-trending-styles';

        style.textContent = `
            .owlhub-trending-row {
                display: flex;
                overflow-x: auto;
                gap: 1em;
                padding-bottom: .3em;
            }

            .owlhub-trending-card {
                position: relative;
                flex: 0 0 auto;
                width: 300px;
                height: 168px;
                border-radius: 10px;
                overflow: hidden;
                background-size: cover;
                background-position: right center;
                cursor: pointer;
                isolation: isolate;
                touch-action: pan-x;
                user-select: none;
                -webkit-user-select: none;
            }

            @media (max-width: 420px) {
                .owlhub-trending-card {
                    width: 78vw;
                    height: 43.7vw;
                }
            }

            .owlhub-trending-card::before {
                content: '';
                position: absolute;
                inset: 0;
                background: linear-gradient(
                    90deg,
                    color-mix(in srgb, var(--owlhub-color) 65%, transparent) 0%,
                    color-mix(in srgb, var(--owlhub-color) 40%, transparent) 30%,
                    color-mix(in srgb, var(--owlhub-color) 15%, transparent) 60%,
                    transparent 92%
                );
                z-index: 1;
            }

            .owlhub-trending-card::after {
                content: '';
                position: absolute;
                inset: 0;
                background: linear-gradient(0deg, rgba(0,0,0,.6), transparent 55%);
                z-index: 1;
            }

            .owlhub-trending-rank {
                position: absolute;
                top: -.1em;
                left: .05em;
                font-size: 6em;
                font-weight: 900;
                font-style: italic;
                color: rgba(255,255,255,.25);
                line-height: 1;
                z-index: 1;
                pointer-events: none;
                user-select: none;
            }

            .owlhub-trending-content {
                position: absolute;
                left: .9em;
                right: .9em;
                bottom: .75em;
                z-index: 2;
                color: #fff;
            }

            .owlhub-trending-kicker {
                font-size: .65em;
                font-weight: 700;
                letter-spacing: .06em;
                opacity: .85;
                margin-bottom: .25em;
            }

            .owlhub-trending-title-text {
                font-size: 1.2em;
                font-weight: 800;
                line-height: 1.15;
                margin-bottom: .3em;
                text-shadow: 1px 1px 5px rgba(0,0,0,.65);
            }

            .owlhub-trending-logo {
                max-width: 68%;
                max-height: 2.4em;
                object-fit: contain;
                object-position: left;
                display: block;
                margin-bottom: .3em;
                filter: drop-shadow(1px 1px 4px rgba(0,0,0,.6));
            }

            .owlhub-trending-meta {
                font-size: .65em;
                opacity: .85;
            }

            .owlhub-trending-badge {
                position: absolute;
                right: .6em;
                bottom: .6em;
                z-index: 2;
                background: rgba(0,0,0,.55);
                border: 1px solid rgba(255,255,255,.35);
                color: #fff;
                font-size: .58em;
                font-weight: 700;
                letter-spacing: .04em;
                text-transform: uppercase;
                padding: .25em .5em;
                border-radius: 4px;
            }

            .owlfin-trend-wrap {
                margin: 1.6em 0 .6em 0;
            }

            .owlfin-trend-title {
                margin: 0 0 .6em 0;
                padding: 0 3.3%;
                font-size: 1.4em;
                font-weight: 500;
            }

            .owlfin-trend-wrap .owlhub-trending-row {
                padding: 0 3.3% .3em 3.3%;
                scrollbar-width: none;
                -webkit-overflow-scrolling: touch;
            }

            .owlfin-trend-wrap .owlhub-trending-row::-webkit-scrollbar {
                display: none;
            }

            .owlfin-trend-skel {
                position: relative;
                flex: 0 0 auto;
                width: 300px;
                height: 168px;
                border-radius: 10px;
                background: rgba(255,255,255,.07);
                color: rgba(255,255,255,.7);
                font-size: .9em;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            @media (max-width: 420px) {
                .owlfin-trend-skel {
                    width: 78vw;
                    height: 43.7vw;
                }
            }

            .owlhub-trailer-iframe {
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                border: 0;
                margin: 0;
                padding: 0;
                z-index: 20;
                background: #000;
                pointer-events: none;
            }

            .owlhub-trailer-overlay {
                position: absolute;
                inset: 0;
                z-index: 21;
                background: transparent;
                cursor: pointer;
            }

            .owlhub-trailer-playing {
                overflow: hidden;
            }
        `;

        document.head.appendChild(style);
    }


    // =====================================================
    // INIEZIONE
    // =====================================================

    // La home attualmente visibile (le vecchie restano nel DOM nascoste). Se nessuna risulta "misurabile"
    // si usa comunque l'ultima non nascosta: inserire la sezione non costa nulla.
    function getActiveHome() {
        const all = Array.from(document.querySelectorAll('.homeSectionsContainer'));
        let fallback = null;
        for (let i = all.length - 1; i >= 0; i--) {
            const c = all[i];
            if (c.closest('.hide, [hidden]')) continue;
            if (c.getClientRects().length > 0) return c;
            fallback = c;                                   // il giro e' al contrario: resta il primo
        }
        return fallback;
    }

    // ---- Ancoraggio per posizione (non dipende da titoli ne' da righe particolari) ----
    // La sezione si mette dopo la TREND_AFTER-esima riga CON CONTENUTO della home. Si contano solo le righe
    // di Jellyfin visibili e piene: quelle vuote (nessun elemento da mostrare), nascoste, il blocco
    // "I miei media" e le righe nostre (studi, generi, tendenza) non vengono contate.
    const TREND_AFTER = 2;

    function isForeignNode(n, host) {
        for (let e = n; e && e !== host; e = e.parentElement) {
            const cl = typeof e.className === 'string' ? e.className : '';
            if (/owlfin|owlhub|categories-wrapper|custom-rows/i.test((e.id || '') + ' ' + cl)) return true;
        }
        return false;
    }

    function hiddenWithin(n, host) {
        for (let e = n; e && e !== host; e = e.parentElement) {
            if (e.classList && e.classList.contains('hide')) return true;
            if (e.hasAttribute && e.hasAttribute('hidden')) return true;
        }
        return false;
    }

    function rowHasContent(r, host) {
        if (r.querySelector('.verticalSection')) return false;          // contenitore di altre righe, non una riga
        if (hiddenWithin(r, host)) return false;
        if (!r.querySelector('.sectionTitle, .card, .itemsContainer > *')) return false;
        const cards = r.querySelectorAll('.card');
        if (cards.length && Array.prototype.every.call(cards, (c) =>
            /^(CollectionFolder|UserView)$/i.test(c.getAttribute('data-type') || ''))) return false;   // "I miei media"
        return true;
    }

    function contentRows(home) {
        return Array.prototype.filter.call(home.querySelectorAll('.verticalSection'),
            (r) => !isForeignNode(r, home) && rowHasContent(r, home));
    }

    function rowsBefore(home, sec) {
        let n = 0;
        contentRows(home).forEach((r) => {
            if (sec.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_PRECEDING) n++;
        });
        return n;
    }

    // Il nodo dopo cui inserire (a livello della home, non dentro a una riga).
    function placementPoint(home, sec) {
        const rows = contentRows(home);
        if (!rows.length) return null;
        let n = rows[Math.min(TREND_AFTER, rows.length) - 1];
        const nextOf = (x) => {
            let nx = x.nextElementSibling;
            if (sec && nx === sec) nx = sec.nextElementSibling;
            return nx;
        };
        // se la riga e' l'ultima del proprio contenitore (es. gruppo dei "recenti") si sale di un livello
        while (n.parentNode && n.parentNode !== home && !nextOf(n)) n = n.parentNode;
        return n;
    }

    function inPlace(home, sec) {
        if (!sec.parentNode || sec.closest('.verticalSection')) return false;
        const rows = contentRows(home);
        return rowsBefore(home, sec) === Math.min(TREND_AFTER, rows.length);
    }

    function layoutSummary(home) {
        if (!home) return '(home assente)';
        const names = [];
        Array.prototype.forEach.call(home.querySelectorAll('.verticalSection, .owlhub-trending-section'), (r) => {
            if (r.classList.contains('owlhub-trending-section')) { names.push('>>TENDENZA<<'); return; }
            if (isForeignNode(r, home) || !rowHasContent(r, home)) return;
            const e = r.querySelector('.sectionTitle');
            names.push(e ? e.textContent.trim().slice(0, 22) : '(senza titolo)');
        });
        return 'righe: ' + (names.join(' | ') || '-');
    }

    let posMoves = 0;
    let posMovesGen = -1;

    // Sezione con classi SOLO nostre (come righe studi e barra generi): per Jellyfin e' un blocco opaco.
    function buildStandaloneSection(items) {
        const sec = document.createElement('div');
        sec.className = 'owlfin-trend-wrap owlhub-trending-section';

        const title = document.createElement('h2');
        title.className = 'owlfin-trend-title';
        title.textContent = SECTION_TITLE;

        const row = document.createElement('div');
        row.className = 'owlhub-trending-row';
        // come studi e generi: il tocco orizzontale resta alla riga e non arriva alla pagina
        row.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
        row.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
        items.forEach((item, index) => row.appendChild(buildCard(item, index + 1)));

        sec.appendChild(title);
        sec.appendChild(row);
        return sec;
    }

    function placeSection(home, built) {
        const n = placementPoint(home, null);
        if (n && n.parentNode) {
            n.parentNode.insertBefore(built, n.nextSibling);
        } else {
            home.appendChild(built);                            // home ancora vuota: poi fixPosition la sposta
        }
    }

    // Le righe arrivano a pezzi e in ordine qualunque: a ogni controllo la sezione viene riportata
    // dopo la 2a riga con contenuto. Se e' gia' a posto non si tocca nulla (nessuna mutazione).
    function fixPosition(home) {
        const sec = home.querySelector('.owlhub-trending-section');
        if (!sec || inPlace(home, sec)) return false;
        if (posMovesGen !== navGen) { posMovesGen = navGen; posMoves = 0; }
        if (posMoves >= 40) return false;                       // freno: non si litiga all'infinito con altro codice
        const n = placementPoint(home, sec);
        if (!n || !n.parentNode) return false;
        posMoves++;
        n.parentNode.insertBefore(sec, n.nextSibling);
        if (posMoves <= 6) owlLog('posizione corretta, ' + layoutSummary(home));
        return true;
    }

    let fixPending = false;
    function fixSoon() {
        if (fixPending) return;
        fixPending = true;
        requestAnimationFrame(() => {
            fixPending = false;
            try {
                const h = visibleHome();
                if (h) fixPosition(h);
            } catch (e) { /* nessun problema */ }
        });
    }

    function injectSection(items) {

        const homeContainer = getActiveHome();
        if (!homeContainer) return;
        if (homeContainer.querySelector('.owlhub-trending-section')) return;

        ensureStyles();

        let built = null;
        try {
            const anchor = findAnchorSection(homeContainer);
            built = anchor ? buildSectionFromAnchor(anchor, items) : null;
        } catch (e) {
            built = null;
        }
        if (!built) built = buildStandaloneSection(items);

        placeSection(homeContainer, built);
    }

    // Se proprio non si riesce a caricare nulla, la sezione compare lo stesso con il motivo
    // (utile da telefono, dove non c'e' la console) e un tocco per riprovare.
    function injectError(reason) {
        const home = getActiveHome();
        if (!home || home.querySelector('.owlhub-trending-section')) return;
        ensureStyles();

        const sec = buildStandaloneSection([]);
        sec.classList.add('owlhub-trending-error');
        const row = sec.querySelector('.owlhub-trending-row');
        const msg = document.createElement('div');
        msg.style.cssText = 'padding:14px 16px;border-radius:10px;background:rgba(255,255,255,.08);' +
            'font-size:.9em;line-height:1.4;cursor:pointer;max-width:90vw;';
        msg.textContent = (_lang === 'it' ? 'Non disponibile: ' : 'Unavailable: ') + reason +
            (_lang === 'it' ? ' - tocca per riprovare' : ' - tap to retry');
        msg.addEventListener('click', () => { failedAt = 0; failCount = 0; sec.remove(); ensure(); });
        row.appendChild(msg);
        placeSection(home, sec);
    }

    // =====================================================
    // CLICK FUORI DAL PLAYER
    // =====================================================

    document.addEventListener('click', (event) => {

        document.querySelectorAll('.owlhub-trending-card.owlhub-trailer-playing')
            .forEach((card) => {

                if (!card.contains(event.target)) {
                    closeTrailer(card);
                }
            });

    }, true);


    // =====================================================
    // INIT
    // =====================================================

    const OWLFIN_TREND_VER = '1.11.17';
    let memItems = null;
    let memDay = '';
    let inflight = null;
    let failedAt = 0;
    let failCount = 0;

    let inflightAt = 0;
    let shownStale = false;
    let lastReason = '';

    // Riserva: se TMDB non risponde (o non ha titoli in comune con la libreria) si mostrano gli ultimi
    // titoli aggiunti, cosi' la riga c'e' sempre; al prossimo tentativo riuscito viene sostituita.
    async function fallbackFromLibrary() {
        const apiClient = getApiClient();
        const result = await withTimeout(apiClient.getItems(apiClient.getCurrentUserId(), {
            IncludeItemTypes: 'Movie,Series',
            Recursive: true,
            SortBy: 'DateCreated',
            SortOrder: 'Descending',
            Fields: 'ProviderIds,ProductionYear,Genres,OfficialRating,Studios,BackdropImageTags',
            EnableImages: true,
            Limit: MAX_ITEMS
        }), 20000);
        return enrichWithVisuals((result.Items || []).slice(0, MAX_ITEMS));
    }

    async function loadData() {
        if (memItems && memDay === todayKey()) return memItems;

        const cached = getCache();
        if (cached && cached.length) {
            memItems = cached;
            memDay = todayKey();
            return memItems;
        }

        // Ieri / di riserva: si mostra questa subito, mentre sotto si scarica quella di oggi.
        const stale = memItems || getStaleCache();
        const quick = () => { if (stale) shownStale = true; return stale; };

        // Client Jellyfin non ancora pronto (primo avvio): non e' un errore, si riprova al prossimo giro.
        if (!clientReady()) {
            lastReason = 'Jellyfin non ancora pronto';
            return quick();
        }

        // Dopo un errore backoff crescente (5 s, 10 s ... max 30 s; 2 minuti se c'e' gia' qualcosa da mostrare).
        if (Date.now() - failedAt < Math.min(5000 * failCount, stale ? 120000 : 30000)) return quick();

        // Un caricamento rimasto appeso oltre 90 s si abbandona e si ricomincia.
        if (inflight && Date.now() - inflightAt > 90000) inflight = null;

        if (!inflight) {
            inflightAt = Date.now();
            inflight = (async () => {
                let matched = null;
                try {
                    if (!tmdbKey()) throw new Error('chiave TMDB mancante');
                    const tmdbList = await withRetry(() => withTimeout(fetchTrendingFromTMDB(), 12000), 3, 1500);
                    matched = await withRetry(() => withTimeout(matchLibraryItems(tmdbList), 30000), 2, 1500);
                    matched = await enrichWithVisuals(matched);
                } catch (e) {
                    lastReason = 'TMDB: ' + (e && e.message ? e.message : e);
                    console.error('[OwlHub Trending Now]', e);
                    matched = null;
                }

                if (matched && matched.length) {
                    const changed = shownStale && (!stale ||
                        matched.map((m) => m.Id).join() !== stale.map((m) => m.Id).join());
                    setCache(matched);
                    memItems = matched;
                    memDay = todayKey();
                    failCount = 0;
                    lastReason = '';
                    if (changed) {
                        // Quella mostrata era di ieri o di riserva: si sostituisce con quella di oggi.
                        setTimeout(() => { if (typeof owlfinRefresh === 'function') owlfinRefresh(); }, 0);
                    }
                    shownStale = false;
                    return matched;
                }

                if (!lastReason) lastReason = 'nessun titolo di tendenza presente in libreria';
                failedAt = Date.now();
                failCount++;

                if (!memItems) {
                    try {
                        const fb = await fallbackFromLibrary();
                        if (fb.length) {
                            memItems = fb;      // memDay resta vuoto: la prossima volta si riprova con TMDB
                            shownStale = true;
                        }
                    } catch (e) {
                        lastReason = 'libreria: ' + (e && e.message ? e.message : e);
                        console.error('[OwlHub Trending Now] riserva', e);
                    }
                }
                return memItems || null;
            })().finally(() => { inflight = null; });
        }
        return stale ? quick() : inflight;
    }

    // Controllo economico: lavora solo se la home visibile non ha la sezione.
    // Registro eventi + riquadro diagnostico (si vede da telefono, senza console).
    const dbg = { t0: Date.now(), events: [], errors: 0, last: '', hidden: false };
    function note(msg) {
        if (msg === dbg.last) return;
        dbg.last = msg;
        dbg.events.push(Math.round((Date.now() - dbg.t0) / 1000) + 's ' + msg);
        if (dbg.events.length > 12) dbg.events.shift();
    }

    // =====================================================
    // PERSISTENZA (stessa logica delle righe studi e della barra generi)
    // =====================================================
    // A ogni navigazione (viewshow / hashchange) si toglie quello che c'era e si ritenta ogni 250 ms
    // finche' la home esiste. La sezione compare SUBITO come "guscio" (Caricamento...) senza aspettare
    // i dati e si riempie appena arrivano: niente attese sui dati, niente osservatori.

    // =====================================================
    // REGISTRO EVENTI (si conserva anche dopo la ricarica della pagina)
    // =====================================================
    const LOG_KEY = 'owlfin_trending_log_v1';
    const logBuf = [];
    let prevLog = [];
    try {
        prevLog = JSON.parse(localStorage.getItem(LOG_KEY) || '[]').slice(-25);
    } catch (e) { prevLog = []; }

    function owlLog(msg) {
        logBuf.push({ t: Date.now(), m: msg });
        if (logBuf.length > 40) logBuf.shift();
        try { localStorage.setItem(LOG_KEY, JSON.stringify(logBuf)); } catch (e) { /* nessun problema */ }
    }
    owlLog('script avviato v' + OWLFIN_TREND_VER + ' ' + location.pathname + location.hash);

    function neighbours(sec) {
        return layoutSummary((sec && sec.closest && sec.closest('.homeSectionsContainer')) || getActiveHome());
    }

    let navGen = 0;
    let navAt = Date.now();
    let navState = null;
    let loopTimer = null;
    let lastHash = location.href;
    const SHELL_FAIL_MS = 12000;

    function trendingSections() {
        return Array.from(document.querySelectorAll('.owlhub-trending-section'));
    }

    function showShellState(sec, state, text) {
        sec.setAttribute('data-owlfin-state', state);
        const row = sec.querySelector('.owlhub-trending-row');
        if (!row) return;
        row.innerHTML = '';
        const msg = document.createElement('div');
        if (state === 'error') {
            msg.className = 'owlhub-trending-msg';
            msg.style.cssText = 'padding:14px 16px;border-radius:10px;background:rgba(255,255,255,.08);' +
                'font-size:.9em;line-height:1.4;max-width:90vw;opacity:.85;cursor:pointer;';
            msg.addEventListener('click', () => {
                failedAt = 0; failCount = 0;
                sec._owlT0 = Date.now();
                showShellState(sec, 'loading', t.loading);
                restart();
            });
        } else {
            msg.className = 'owlfin-trend-skel';
        }
        msg.textContent = text;
        row.appendChild(msg);
    }

    function buildShell() {
        const sec = buildStandaloneSection([]);
        showShellState(sec, 'loading', t.loading);
        sec._owlStandalone = true;
        return sec;
    }

    // Titoli pronti: si sostituisce il guscio con la sezione vera (con l'aspetto della riga "Film
    // aggiunti di recente" se esiste, altrimenti costruita da zero).
    function applyItems(sec, items) {
        const home = getActiveHome();
        const built = buildStandaloneSection(items);
        built.setAttribute('data-owlfin-state', 'ready');
        built._owlStandalone = false;
        built._owlItems = items;
        sec._owlRemoved = true;
        sec.replaceWith(built);
        if (home) fixPosition(home);
        owlLog('sezione pronta: ' + items.length + ' titoli, ' + neighbours(built));
    }

    function fillSection(sec) {
        if (!sec.isConnected || sec._owlFilling) return;
        if (!sec._owlT0) sec._owlT0 = Date.now();
        sec._owlFilling = true;
        let promise;
        try { promise = Promise.resolve(loadData()); } catch (e) { promise = Promise.reject(e); }
        promise.then((items) => {
            sec._owlFilling = false;
            if (!sec.isConnected) return;
            if (items && items.length) {
                applyItems(sec, items);
            } else if (Date.now() - sec._owlT0 > SHELL_FAIL_MS && sec.getAttribute('data-owlfin-state') !== 'error') {
                showShellState(sec, 'error',
                    (_lang === 'it' ? 'Non disponibile: ' : 'Unavailable: ') +
                    (lastReason || (_lang === 'it' ? 'caricamento in corso' : 'loading')) +
                    (_lang === 'it' ? ' - tocca per riprovare' : ' - tap to retry'));
            }
        }).catch((e) => {
            sec._owlFilling = false;
            dbg.errors++;
            note('ERRORE ' + (e && e.message ? e.message : e));
            console.error('[OwlHub Trending Now] fill', e);
        });
    }

    // Titoli di oggi arrivati dopo quelli di ieri: le sezioni presenti si rifanno.
    function owlfinRefresh() {
        trendingSections().forEach((sec) => {
            if (sec._owlItems && memItems) applyItems(sec, memItems);
        });
    }

    function schedule(st, delay) {
        clearTimeout(loopTimer);
        loopTimer = setTimeout(() => { loopTimer = null; step(st); }, delay);
    }

    function step(st) {
        if (st.gen !== navGen) return;
        const home = getActiveHome();
        let sec = home ? home.querySelector('.owlhub-trending-section') : null;
        let done = false;

        // Prefetch: i titoli iniziano a caricarsi appena il client e' pronto, anche prima della home.
        if (!memItems && clientReady() && tmdbKey()) loadData().catch(() => {});

        if (home) {
            ensureStyles();
            if (!home._owlSeen) home._owlSeen = Date.now();
            // Il guscio compare appena c'e' la riga giusta ("Film aggiunti di recente"); se non arriva
            // entro 3 s dalla comparsa della home si inserisce comunque (e si sposta quando la riga arriva).
            if (!sec && (contentRows(home).length >= TREND_AFTER || Date.now() - home._owlSeen > 3000)) {
                sec = buildShell();
                placeSection(home, sec);
                owlLog('guscio inserito, ' + neighbours(sec));
            }
            if (sec) fixPosition(home);

            const state = sec ? sec.getAttribute('data-owlfin-state') : null;
            if (!sec) {
                // in attesa delle prime righe della home: niente da fare, si ritenta
            } else if (state !== 'ready') {
                fillSection(sec);
            } else {
                if (contentRows(home).length > TREND_AFTER || Date.now() - navAt > 10000) done = true;
                if (shownStale && !inflight) loadData();
            }
        }

        note((home ? 'home ok' : 'home NON trovata') + ' | sezione ' +
            (sec ? sec.getAttribute('data-owlfin-state') : 'assente') +
            ' | client ' + (clientReady() ? 'pronto' : 'NON pronto') + ' | dati ' + (memItems ? memItems.length : 0));

        if (!done) {
            st.tries++;
            if (st.tries > 340) return;                     // 10 s ogni 250 ms, poi ogni secondo fino a ~5 minuti
            schedule(st, st.tries < 40 ? 250 : 1000);
        }
    }

    function restart() {
        owlLog('restart');
        clearTimeout(loopTimer);
        loopTimer = null;
        navState = { gen: navGen, tries: 0 };
        step(navState);
    }

    function onNavigate() {
        navGen++;
        navAt = Date.now();
        owlLog('navigazione (' + location.pathname + location.hash + ')');
        trendingSections().forEach((n) => { n._owlRemoved = true; n.remove(); });      // come removeUI() di studi e generi
        navState = { gen: navGen, tries: 0 };
        clearTimeout(loopTimer);
        loopTimer = null;
        step(navState);
    }

    function ensure() { restart(); }

    function routeChanged() {
        if (location.href !== lastHash) {
            lastHash = location.href;
            onNavigate();
        }
    }

    document.addEventListener('viewshow', onNavigate);
    window.addEventListener('hashchange', routeChanged);
    window.addEventListener('popstate', routeChanged);
    window.addEventListener('pageshow', () => restart());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') restart(); });
    ['pushState', 'replaceState'].forEach((fn) => {
        try {
            const orig = history[fn];
            if (typeof orig !== 'function') return;
            history[fn] = function () {
                const r = orig.apply(this, arguments);
                setTimeout(routeChanged, 0);
                return r;
            };
        } catch (e) { /* nessun problema */ }
    });

    // Registra chi toglie la sezione: se non siamo stati noi, e' un altro codice (utile per capire).
    let removedByOthers = 0;
    new MutationObserver((muts) => {
        for (const m of muts) {
            m.removedNodes.forEach((n) => {
                if (n.nodeType !== 1) return;
                const hit = n.classList && n.classList.contains('owlhub-trending-section') ? n
                    : (n.querySelector ? n.querySelector('.owlhub-trending-section') : null);
                if (hit && !hit._owlRemoved) {
                    removedByOthers++;
                    owlLog('SEZIONE RIMOSSA da altro codice (nodo tolto: ' + (n.className || n.nodeName) + ', padre: ' + ((m.target && m.target.className) || (m.target && m.target.nodeName)) + ')');
                }
            });
        }
    }).observe(document.body || document.documentElement, { childList: true, subtree: true });

    let guardLast = 0;
    let guardCount = 0;
    const owlfinGuard = new MutationObserver(() => {
        if (document.hidden) return;
        const home = visibleHome();
        if (!home) return;
        if (home.querySelector('.owlhub-trending-section')) { fixSoon(); return; }
        const now = Date.now();
        if (now - guardLast < 300) return;
        guardLast = now;
        if (++guardCount > 40) return;                      // freno: oltre, ci pensa il controllo ogni 1,5 s
        owlLog('guardia: home senza sezione, restart');
        restart();
    });
    owlfinGuard.observe(document.body || document.documentElement, { childList: true, subtree: true });
    setInterval(() => { guardCount = 0; }, 60000);

    // Rete di sicurezza: se la home e' presente ma la sezione sparisce (home ridisegnata), si riparte.
    setInterval(() => {
        if (document.hidden) return;
        const home = getActiveHome();
        if (!home) return;
        const sec = home.querySelector('.owlhub-trending-section');
        if (!sec) restart(); else fixPosition(home);
    }, 1500);

    function onHomeRoute() {
        const h = location.hash.toLowerCase();
        return h === '' || h === '#' || h.indexOf('#/home') === 0 || h.indexOf('#!/home') === 0;
    }

    function visibleHome() {
        const h = getActiveHome();
        return h && h.getClientRects().length > 0 && !h.closest('.hide, [hidden]') ? h : null;
    }

    // Targhetta piccola e temporanea (primi 20 s su ogni home): versione e stato a colpo d'occhio.
    // Toccandola si apre il registro degli eventi (anche quello prima della ricarica della pagina).
    function logPanelText() {
        const t0 = dbg.t0;
        const fmt = (e, base) => '+' + (Math.round((e.t - base) / 100) / 10) + 's ' + e.m;
        const home = visibleHome();
        const secs = home ? home.querySelectorAll('.owlhub-trending-section').length : 0;
        const containers = document.querySelectorAll('.homeSectionsContainer').length;
        const lines = [
            'Owlfin Tendenza v' + OWLFIN_TREND_VER + ' - registro (tocca per chiudere)',
            'url: ' + location.pathname + location.search + location.hash,
            'contenitori home: ' + containers + ', visibile: ' + (home ? 'si' : 'no') + ', sezioni nella home: ' + secs,
            'client: ' + (clientReady() ? 'pronto' : 'NON pronto') + ', chiave TMDB: ' + (tmdbKey() ? 'si' : 'NO') +
                ', dati: ' + (memItems ? memItems.length : 0) + (shownStale ? ' (di riserva)' : '') + ', rimossa da altri: ' + removedByOthers,
            'motivo: ' + (lastReason || '-'),
            home ? layoutSummary(home) : 'righe: -',
            '--- questa pagina ---'
        ].concat(logBuf.map((e) => fmt(e, t0)));
        if (prevLog.length) {
            lines.push('--- pagina precedente ---');
            const base = prevLog[0].t;
            prevLog.forEach((e) => lines.push(fmt(e, base)));
        }
        return lines.join('\n');
    }

    function toggleLogPanel() {
        const old = document.getElementById('owlfin-trending-log');
        if (old) { old.remove(); return; }
        const panel = document.createElement('div');
        panel.id = 'owlfin-trending-log';
        panel.style.cssText = 'position:fixed;left:8px;right:8px;bottom:100px;z-index:99999;max-height:55vh;overflow:auto;' +
            'background:rgba(0,0,0,.9);color:#9fe3a0;font:10px/1.35 ui-monospace,Menlo,monospace;padding:8px 10px;' +
            'border-radius:8px;white-space:pre-wrap;word-break:break-word;';
        panel.textContent = logPanelText();
        panel.addEventListener('click', () => panel.remove());
        document.body.appendChild(panel);
    }

    function owlfinBadge() {
        let badge = document.getElementById('owlfin-trending-badge');
        const home = visibleHome();
        let text = '';
        if (home && !document.hidden && !document.getElementById('owlfin-trending-debug')) {
            const seen = home._owlSeen || (home._owlSeen = Date.now());
            const sec = home.querySelector('.owlhub-trending-section');
            const state = sec ? sec.getAttribute('data-owlfin-state') : 'assente';
            const age = Date.now() - seen;
            if (age < 20000 || state !== 'ready') {
                text = 'Tendenza v' + OWLFIN_TREND_VER + ' · ' + state + ' · ' + Math.round(age / 100) / 10 + ' s' +
                    (sec ? ' · dopo ' + rowsBefore(home, sec) + '/' + contentRows(home).length + ' righe' : '') +
                    (removedByOthers ? ' · rimossa x' + removedByOthers : '');
            }
        }
        if (!text) {
            if (badge) badge.remove();
            return;
        }
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'owlfin-trending-badge';
            badge.style.cssText = 'position:fixed;left:8px;bottom:76px;z-index:99998;' +
                'background:rgba(0,0,0,.65);color:#9fe3a0;font:11px/1.2 ui-monospace,Menlo,monospace;' +
                'padding:4px 8px;border-radius:6px;';
            badge.addEventListener('click', (ev) => { ev.stopPropagation(); toggleLogPanel(); });
            document.body.appendChild(badge);
        }
        badge.textContent = text;
    }
    setInterval(owlfinBadge, 500);

    function owlfinDebugChip() {
        let chip = document.getElementById('owlfin-trending-debug');
        const missing = !document.querySelector('.owlhub-trending-section[data-owlfin-state="ready"]');
        const vh = visibleHome();
        if (dbg.hidden || !missing || !vh || Date.now() - (vh._owlSeen || Date.now()) < 9000 || document.hidden) {
            if (chip) chip.remove();
            return;
        }
        if (!chip) {
            chip = document.createElement('div');
            chip.id = 'owlfin-trending-debug';
            chip.style.cssText = 'position:fixed;left:8px;right:8px;bottom:76px;z-index:99999;max-height:42vh;overflow:auto;' +
                'background:rgba(0,0,0,.86);color:#9fe3a0;font:11px/1.35 ui-monospace,Menlo,monospace;padding:8px 10px;' +
                'border-radius:8px;white-space:pre-wrap;word-break:break-word;';
            chip.addEventListener('click', () => { dbg.hidden = true; chip.remove(); });
            document.body.appendChild(chip);
        }
        const containers = document.querySelectorAll('.homeSectionsContainer');
        const visible = Array.from(containers).filter((c) => c.getClientRects().length > 0 && !c.closest('.hide, [hidden]')).length;
        const rows = Array.from(document.querySelectorAll('.homeSectionsContainer .verticalSection .sectionTitle'))
            .map((e) => e.textContent.trim()).slice(0, 8).join(' / ');
        chip.textContent = [
            'Owlfin Tendenza v' + OWLFIN_TREND_VER + ' - sezione non visibile (tocca per chiudere)',
            'url: ' + location.pathname + location.search + location.hash,
            'contenitori home: ' + containers.length + ', visibili: ' + visible,
            'righe: ' + (rows || '(nessuna)'),
            'client: ' + (clientReady() ? 'pronto' : 'NON pronto') + ', chiave TMDB: ' + (tmdbKey() ? 'si' : 'NO'),
            'dati: ' + (memItems ? memItems.length : 0) + (shownStale ? ' (di riserva)' : '') + ', caricamento: ' + (inflight ? 'si' : 'no') + ', errori: ' + dbg.errors,
            'motivo: ' + (lastReason || '-'),
            'eventi:',
            dbg.events.slice(-8).join('\n'),
            'registro:',
            logBuf.slice(-8).map((e) => '+' + (Math.round((e.t - dbg.t0) / 100) / 10) + 's ' + e.m).join('\n')
        ].join('\n');
    }
    setInterval(owlfinDebugChip, 1500);

    window.__owlfinTrending = () => ({
        clientReady: clientReady(), tmdbKey: !!tmdbKey(), home: !!getActiveHome(),
        section: !!document.querySelector('.owlhub-trending-section'),
        items: memItems ? memItems.length : 0, staleShown: shownStale, loading: !!inflight, failCount, reason: lastReason
    });

    window.addEventListener('online', () => { failedAt = 0; failCount = 0; restart(); });

    onNavigate();

})();
