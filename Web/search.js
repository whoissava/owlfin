/**
 * Owlfin — Search Suggestions Poster Grid
 */
(function () {
    'use strict';

    const CONFIG = {
        cardWidth: 100,
        gap: 10,
        imageMaxWidth: 300,
        imageQuality: 90,
        suggestionCount: 21,
        includeItemTypes: 'Movie,Series',
        debug: false
    };

    const log = (...a) => CONFIG.debug && console.log('[Owlfin/Search]', ...a);

    const STYLE_ID = 'owlfin-search-grid-style';
    if (!document.getElementById(STYLE_ID)) {
        const s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent = `
            #searchPage .searchSuggestionsList {
                display: flex !important;
                flex-wrap: wrap !important;
                gap: ${CONFIG.gap}px !important;
                justify-content: center !important;
                padding: 8px 4px !important;
            }
            #searchPage .searchSuggestionsList > div { margin: 0 !important; }
            #searchPage.owlfin-search-loading .searchSuggestionsList {
                visibility: hidden !important;
                pointer-events: none !important;
            }
            #searchPage .searchSuggestionsList a.button-link {
                display: block !important;
                width: ${CONFIG.cardWidth}px !important;
                aspect-ratio: 2 / 3 !important;
                padding: 0 !important;
                margin: 0 !important;
                border-radius: 10px !important;
                overflow: hidden !important;
                background-color: rgba(255,255,255,0.07) !important;
                background-size: cover !important;
                background-position: center !important;
                color: transparent !important;
                font-size: 0 !important;
                box-shadow: 0 2px 10px rgba(0,0,0,0.4) !important;
                transition: transform 0.15s ease, box-shadow 0.15s ease !important;
                will-change: transform !important;
            }
            #searchPage .searchSuggestionsList a.button-link:hover,
            #searchPage .searchSuggestionsList a.button-link:active {
                transform: scale(1.04) !important;
                box-shadow: 0 6px 20px rgba(0,0,0,0.6) !important;
            }
            @media (max-width: 400px) {
                #searchPage .searchSuggestionsList a.button-link { width: 85px !important; }
            }
        `;
        document.head.appendChild(s);
    }

    function posterUrl(itemId) {
        const params = { maxWidth: CONFIG.imageMaxWidth, quality: CONFIG.imageQuality };
        if (window.ApiClient?.getUrl) return window.ApiClient.getUrl(`Items/${itemId}/Images/Primary`, params);
        return `${location.origin}/Items/${itemId}/Images/Primary?${new URLSearchParams(params)}`;
    }

    function applyPosters() {
        document.querySelectorAll('#searchPage .searchSuggestionsList a.button-link:not([data-owlfin-done])').forEach((a) => {
            const m = (a.getAttribute('href') || '').match(/id=([a-f0-9]+)/i);
            if (!m) return;
            a.dataset.owlfinDone = '1';
            a.style.backgroundImage = `url("${posterUrl(m[1])}")`;
        });
    }

    async function getRandomItems(limit) {
        if (!window.ApiClient?.getItems) throw new Error('ApiClient non disponibile');
        const result = await window.ApiClient.getItems(window.ApiClient.getCurrentUserId(), {
            SortBy: 'Random', IncludeItemTypes: CONFIG.includeItemTypes,
            Recursive: true, Limit: limit, ImageTypeLimit: 1, EnableImageTypes: 'Primary'
        });
        return result?.Items || [];
    }

    let rebuilding = false;

    function buildSuggestions(list, items) {
        rebuilding = true;
        list.innerHTML = '';
        const fragment = document.createDocumentFragment();
        items.forEach((item) => {
            const div = document.createElement('div');
            const a = document.createElement('a');
            a.className = 'emby-button button-link';
            a.href = `#/details?id=${item.Id}&serverId=${item.ServerId || ''}`;
            a.textContent = item.Name || '';
            div.appendChild(a);
            fragment.appendChild(div);
        });
        list.appendChild(fragment);
        applyPosters();
        const searchPage = document.getElementById('searchPage');
        if (searchPage) searchPage.classList.remove('owlfin-search-loading');
        setTimeout(() => { rebuilding = false; }, 50);
    }

    async function refreshSuggestions() {
        const list = document.querySelector('#searchPage .searchSuggestionsList');
        if (!list || list.dataset.owlfinRefreshing === '1') return;
        list.dataset.owlfinRefreshing = '1';
        try {
            const items = await getRandomItems(CONFIG.suggestionCount);
            if (items.length > 0) buildSuggestions(list, items);
        } catch (err) { log('Errore fetch:', err); }
        finally { list.dataset.owlfinRefreshing = ''; }
    }

    let wasVisible = false;

    function isSearchPageVisible() {
        const el = document.getElementById('searchPage');
        if (!el) return false;
        if (el.offsetParent !== null) return true;
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden';
    }

    function onSearchPageMaybeVisible() {
        const visible = isSearchPageVisible();
        if (visible && !wasVisible) {
            const el = document.getElementById('searchPage');
            if (el) el.classList.add('owlfin-search-loading');
            setTimeout(refreshSuggestions, 50);
        }
        wasVisible = visible;
    }

    let rafPending = false;
    const observer = new MutationObserver(() => {
        if (rebuilding || rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => { rafPending = false; applyPosters(); onSearchPageMaybeVisible(); });
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') onSearchPageMaybeVisible();
    });

    const SEARCH_SELECTORS = [
        '.headerSearchButton','a[href="#/search"]','a[href^="#/search"]',
        'a[href*="search.html"]','[data-testid*="search" i]',
        'button[title="Cerca" i]','button[title="Search" i]',
        '[aria-label="Cerca" i]','[aria-label="Search" i]','.searchTabButton'
    ].join(',');

    document.addEventListener('click', (e) => {
        if (!e.target?.closest?.(SEARCH_SELECTORS)) return;
        wasVisible = false;
    }, true);

    onSearchPageMaybeVisible();
    setTimeout(applyPosters, 300);
    log('Owlfin Search Grid attivo');
})();
