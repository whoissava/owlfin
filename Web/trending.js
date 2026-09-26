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
    'use strict';

    // ====================== CONFIG ======================

    const TMDB_API_KEY = window.__owlfin_tmdb_key__ || '';
    const TMDB_LANG = 'it-IT';

    const CACHE_KEY = 'owlhub_trending_now_cache_v3';
    const TRAILER_CACHE_PREFIX = 'owlhub_trailer_it_v1_';

    const CACHE_HOURS = 24 * 7;

    const SECTION_TITLE = 'Di Tendenza Ora';
    const KICKER_TEXT = 'INIZIA A GUARDARE';

    const MAX_ITEMS = 10;

    // La nostra sezione viene inserita PRIMA della prima di queste
    // che trova (i temi possono rinominare l'etichetta nel tempo).
    const ANCHOR_CANDIDATE_TITLES = [
        'Film aggiunti di recente',
        'Film recenti',
        'Recently added movies',
        'Latest movies'
    ];

    // Se nessuna delle etichette sopra viene trovata, come ultima
    // spiaggia ci ancoriamo subito dopo questa sezione (di solito
    // la prima riga della home).
    const CONTINUE_WATCHING_TITLE = 'Prossimo';

    // Durata del long press (ridotta per essere più reattivo).
    const LONG_PRESS_MS = 350;

    // Tolleranza di movimento in pixel^2 prima di annullare il long press.
    const MOVE_TOLERANCE_SQ = 144;

    // =====================================================


    function getApiClient() {
        return window.ApiClient;
    }


    // =====================================================
    // TMDB TRENDING
    // =====================================================

    async function fetchTrendingFromTMDB() {

        const [moviesRes, tvRes] = await Promise.all([
            fetch(`https://api.themoviedb.org/3/trending/movie/week?api_key=${TMDB_API_KEY}&language=${TMDB_LANG}`),
            fetch(`https://api.themoviedb.org/3/trending/tv/week?api_key=${TMDB_API_KEY}&language=${TMDB_LANG}`)
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

    function getCache() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;

            const data = JSON.parse(raw);
            const ageHours = (Date.now() - data.timestamp) / 36e5;

            if (ageHours > CACHE_HOURS) return null;

            return data.items;
        } catch (e) {
            return null;
        }
    }


    function setCache(items) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                timestamp: Date.now(),
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

    function getDominantColor(imgUrl) {
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
                `https://api.themoviedb.org/3/${type}/${encodeURIComponent(tmdbId)}/videos?api_key=${TMDB_API_KEY}&language=${TMDB_LANG}`
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

    function findSectionByTitle(titleText) {
        const target = titleText.trim().toLowerCase();
        const sections = document.querySelectorAll('.homeSectionsContainer .verticalSection');

        for (const sec of sections) {
            const titleEl = sec.querySelector('.sectionTitle');

            if (titleEl && titleEl.textContent.trim().toLowerCase().includes(target)) {
                return sec;
            }
        }

        return null;
    }


    function findAnchorSection() {

        for (const title of ANCHOR_CANDIDATE_TITLES) {
            const found = findSectionByTitle(title);
            if (found) return found;
        }

        // Ultima spiaggia: nessuna etichetta nota trovata (es. il tema
        // l'ha rinominata di nuovo). Usiamo la sezione subito dopo
        // "Prossimo", che nella home è di norma la prima riga di film.
        const continueWatching = findSectionByTitle(CONTINUE_WATCHING_TITLE);

        if (continueWatching) {

            let next = continueWatching.nextElementSibling;

            while (next && !next.classList.contains('verticalSection')) {
                next = next.nextElementSibling;
            }

            if (next && !next.classList.contains('owlhub-trending-section')) {
                return next;
            }
        }

        // Diagnostica: elenca i titoli trovati per capire cosa manca.
        const titles = Array.from(
            document.querySelectorAll('.homeSectionsContainer .verticalSection .sectionTitle')
        ).map(el => el.textContent.trim());

        console.warn(
            '[OwlHub Trending Now] Nessuna sezione di ancoraggio trovata. Sezioni disponibili:',
            titles
        );

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

    function injectSection(items) {

        if (document.querySelector('.owlhub-trending-section')) return;

        const homeContainer = document.querySelector('.homeSectionsContainer');
        if (!homeContainer) return;

        ensureStyles();

        const anchor = findAnchorSection();

        // Non usiamo "Prossimo" come ancora diretta. Se non troviamo
        // nemmeno una sezione dopo, il MutationObserver riproverà
        // quando la home finisce di renderizzarsi.
        if (!anchor || !anchor.parentNode) return;

        const built = buildSectionFromAnchor(anchor, items);
        if (!built) return;

        anchor.parentNode.insertBefore(built, anchor);
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

    async function init() {
        try {
            let trending = getCache();

            if (!trending) {
                const tmdbList = await fetchTrendingFromTMDB();
                let matched = await matchLibraryItems(tmdbList);
                matched = await enrichWithVisuals(matched);

                trending = matched;
                setCache(trending);
            }

            if (trending && trending.length) {
                injectSection(trending);
            }
        } catch (e) {
            console.error('[OwlHub Trending Now]', e);
        }
    }


    // =====================================================
    // MUTATION OBSERVER
    // =====================================================

    let debounceTimer = null;

    const observer = new MutationObserver(() => {
        if (!document.querySelector('.homeSectionsContainer')) return;

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(init, 400);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Primo caricamento.
    setTimeout(init, 800);

})();
