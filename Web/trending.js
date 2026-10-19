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

        const movies = (await moviesRes.json()).results || [];
        const tv = (await tvRes.json()).results || [];

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

        const result = await apiClient.getItems(userId, {
            IncludeItemTypes: 'Movie,Series',
            Recursive: true,
            Fields: 'ProviderIds,ProductionYear,Genres,OfficialRating,Studios,BackdropImageTags',
            EnableImages: true,
            Limit: 10000
        });

        const libraryByTmdbId = {};

        (result.Items || []).forEach((item) => {
            const tmdbId = item.ProviderIds &&
                (item.ProviderIds.Tmdb || item.ProviderIds.tmdb);

            if (tmdbId) {
                libraryByTmdbId[String(tmdbId)] = item;
            }
        });

        const matched = [];

        trendingList.forEach((t) => {
            const local = libraryByTmdbId[String(t.id)];

            if (local && !matched.find(m => m.Id === local.Id)) {
                matched.push(local);
            }
        });

        return matched.slice(0, MAX_ITEMS);
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
        card.setAttribute('data-id', item.Id);
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
            if (!fallback) fallback = c;
        }
        return fallback;
    }

    // Ancora di riserva: una qualunque riga della home (la seconda, cosi' resta sotto "Continua a guardare").
    function fallbackAnchor(scope) {
        const rows = Array.from(scope.querySelectorAll('.verticalSection'))
            .filter((n) => !n.classList.contains('owlhub-trending-section'));
        return rows[1] || rows[0] || null;
    }

    // Sezione costruita da zero: non dipende da nessuna riga esistente della home.
    function buildStandaloneSection(items) {
        const sec = document.createElement('div');
        sec.className = 'verticalSection owlhub-trending-section';

        const titleBox = document.createElement('div');
        titleBox.className = 'sectionTitleContainer sectionTitleContainer-cards padded-left';
        const title = document.createElement('h2');
        title.className = 'sectionTitle sectionTitle-cards';
        title.textContent = SECTION_TITLE;
        titleBox.appendChild(title);

        const row = document.createElement('div');
        row.className = 'itemsContainer scrollSlider padded-left padded-right owlhub-trending-row';
        items.forEach((item, index) => row.appendChild(buildCard(item, index + 1)));

        sec.appendChild(titleBox);
        sec.appendChild(row);
        return sec;
    }

    function placeSection(home, built) {
        const anchor = findAnchorSection(home) || fallbackAnchor(home);
        if (anchor && anchor.parentNode) {
            anchor.parentNode.insertBefore(built, anchor);
        } else {
            home.insertBefore(built, home.children[1] || null);
        }
    }

    // Se la riga giusta compare dopo (la home si carica a pezzi) o cambia, la sezione la raggiunge:
    // deve stare subito prima di "Film aggiunti di recente", non dove e' capitata.
    function fixPosition(home) {
        const sec = home.querySelector('.owlhub-trending-section');
        if (!sec) return;
        const anchor = findAnchorSection(home);
        if (!anchor || anchor === sec || !anchor.parentNode) return;

        let n = sec.nextElementSibling;
        while (n && !n.classList.contains('verticalSection')) n = n.nextElementSibling;
        if (n !== anchor || sec.parentNode !== anchor.parentNode) {
            anchor.parentNode.insertBefore(sec, anchor);
        }
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
                        document.querySelectorAll('.owlhub-trending-section').forEach((n) => n.remove());
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
    async function ensure() {
        const home = getActiveHome();
        if (!home) return;
        if (!home._owlSeen) home._owlSeen = Date.now();

        const existing = home.querySelector('.owlhub-trending-section');
        const isError = !!existing && existing.classList.contains('owlhub-trending-error');
        if (existing && !isError) {
            fixPosition(home);
            if (shownStale) loadData();
            return;
        }

        const items = await loadData();
        if (items && items.length) {
            // La home si carica a pezzi: per qualche secondo si aspetta la riga giusta invece di
            // mettere la sezione a caso. Se non arriva, si ripiega e poi la si sposta quando compare.
            if (!findAnchorSection(home) && Date.now() - home._owlSeen < 4000) return;
            if (isError) existing.remove();
            injectSection(items);
        } else if (!existing && Date.now() - home._owlSeen > 12000) {
            injectError(lastReason || (_lang === 'it' ? 'caricamento in corso' : 'loading'));
        }
    }

    let debounceTimer = null;
    function schedule(delay) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(ensure, delay);
    }

    // Home che si (ri)costruisce: osserva il DOM, ma agisce solo se manca la sezione.
    const observer = new MutationObserver(() => {
        const home = getActiveHome();
        if (home) schedule(home.querySelector('.owlhub-trending-section') ? 700 : 250);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Eventi di navigazione / ritorno in foreground: piu' tentativi ravvicinati,
    // perche' la home carica le sue righe in modo asincrono.
    function burst() {
        [100, 600, 1500, 3500].forEach((ms) => setTimeout(ensure, ms));
    }
    document.addEventListener('viewshow', burst);
    window.addEventListener('pageshow', burst);
    window.addEventListener('hashchange', burst);
    window.addEventListener('popstate', burst);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') burst();
    });

    // Rete di sicurezza: se qualcosa sfugge, entro pochi secondi ricompare.
    setInterval(() => { if (!document.hidden) ensure(); }, 3000);

    window.__owlfinTrending = () => ({
        clientReady: clientReady(), tmdbKey: !!tmdbKey(), home: !!getActiveHome(),
        section: !!document.querySelector('.owlhub-trending-section'),
        items: memItems ? memItems.length : 0, staleShown: shownStale, loading: !!inflight, failCount, reason: lastReason
    });

    window.addEventListener('online', () => { failedAt = 0; failCount = 0; burst(); });

    setTimeout(ensure, 800);

})();
