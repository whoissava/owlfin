/^    let currentId = null;$/a\
    let lastBadge = null;\
    let badgeObserver = null;
/^    function removeBadge() {$/,/^    }$/c\
    function disconnectBadgeObserver() {\
        if (badgeObserver) { badgeObserver.disconnect(); badgeObserver = null; }\
    }\
\
    function removeBadge() {\
        disconnectBadgeObserver();\
        lastBadge = null;\
        const old = document.getElementById("owlfin-next-episode");\
        if (old) old.remove();\
    }\
\
    function reinsertBadge() {\
        if (!lastBadge) return;\
        if (document.getElementById("owlfin-next-episode")) return;\
        const anchor = getAnchor();\
        if (!anchor || !anchor.parentElement) return;\
        anchor.parentElement.insertBefore(lastBadge, anchor.nextSibling);\
        dbg("auto-guarigione: badge reinserito dopo rimozione da React");\
    }\
\
    function watchBadge(itemId, myGeneration) {\
        disconnectBadgeObserver();\
        const anchor = getAnchor();\
        if (!anchor || !anchor.parentElement) return;\
        badgeObserver = new MutationObserver(() => {\
            if (myGeneration !== navGeneration || currentId !== itemId) { disconnectBadgeObserver(); return; }\
            if (!document.getElementById("owlfin-next-episode")) reinsertBadge();\
        });\
        badgeObserver.observe(anchor.parentElement, { childList: true, subtree: true });\
    }
/^        if (!anchor) return;$/,/^        dbg("tryShow: SUCCESSO, badge appeso");$/c\
        if (!anchor || !anchor.parentElement) return;\
\
        removeBadge();\
        const next = episodes[0];\
        const badge = document.createElement("div");\
        badge.id = "owlfin-next-episode";\
        badge.textContent = episodes.length > 1\
            ? `Prossimo episodio: ${episodeLabel(next)} – ${formatDate(next.airDate)} (+${episodes.length - 1} in arrivo)`\
            : `Prossimo episodio: ${episodeLabel(next)} – ${formatDate(next.airDate)}`;\
        badge.style.cssText = "margin:6px 0;font-size:14px;opacity:.85;cursor:pointer;text-decoration:underline dotted;width:fit-content;";\
        badge.title = "Mostra tutte le date in arrivo";\
        badge.addEventListener("click", () => openModal(episodes));\
        lastBadge = badge;\
        anchor.parentElement.insertBefore(badge, anchor.nextSibling);\
        watchBadge(itemId, myGeneration);\
        dbg("tryShow: SUCCESSO, badge inserito come fratello dell'anchor (fuori dal territorio React) + osservatore auto-guarigione attivo");
