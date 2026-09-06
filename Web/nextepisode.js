(function () {
    "use strict";

    function gc() {
        try {
            const c = JSON.parse(localStorage.getItem("jellyfin_credentials") || "{}");
            const sv = (c.Servers || [])[0] || {};
            return {
                token: sv.AccessToken,
                userId: sv.UserId,
                base: (sv.ManualAddress || sv.LocalAddress || location.origin).replace(/\/+$/, "")
            };
        } catch {
            return {};
        }
    }

    function currentItemId() {
        const m = (location.hash || "").match(/[?&]id=([^&]+)/);
        return m ? m[1] : null;
    }

    async function fetchItem(base, userId, token, itemId) {
        try {
            const r = await fetch(`${base}/Users/${userId}/Items/${itemId}`, {
                headers: { Authorization: `MediaBrowser Token="${token}"` }
            });
            if (!r.ok) return null;
            return await r.json();
        } catch {
            return null;
        }
    }

    async function fetchNextAiring(base, token, tvdbId, title) {
        try {
            const params = title ? `?title=${encodeURIComponent(title)}` : "";
            const r = await fetch(`${base}/Owlfin/Sonarr/NextEpisode/${tvdbId || 0}${params}`, {
                headers: { Authorization: `MediaBrowser Token="${token}"` }
            });
            if (!r.ok) {
                console.debug(`[Owlfin] Sonarr NextEpisode: HTTP ${r.status} per tvdbId=${tvdbId} title="${title}"`);
                return null;
            }
            const j = await r.json();
            return j.nextAiring || null;
        } catch (e) {
            console.debug("[Owlfin] Sonarr NextEpisode: errore di rete", e);
            return null;
        }
    }

    function formatDate(iso) {
        try {
            return new Date(iso).toLocaleDateString("it-IT", {
                day: "numeric",
                month: "long",
                year: "numeric"
            });
        } catch {
            return iso;
        }
    }

    function removeBadge() {
        const old = document.getElementById("owlplugin-next-episode");
        if (old) old.remove();
    }

    // Selettori con più fallback: i temi Jellyfin (incluso ElegantFin) possono
    // usare classi diverse per l'area titolo/info della pagina dettaglio. Se non
    // compare dove vuoi, aggiungi qui il selettore giusto per il tuo tema.
    function getAnchor() {
        return document.querySelector(".itemMiscInfo")
            || document.querySelector(".nameContainer")
            || document.querySelector(".detailPagePrimaryContainer")
            || document.querySelector(".detailPageWrapper");
    }

    async function tryShow(retriesLeft) {
        removeBadge();

        const itemId = currentItemId();
        if (!itemId) return;

        const { token, userId, base } = gc();
        if (!token || !userId) return;

        const anchor = getAnchor();
        if (!anchor) {
            if (retriesLeft > 0) setTimeout(() => tryShow(retriesLeft - 1), 300);
            return;
        }

        const item = await fetchItem(base, userId, token, itemId);
        if (!item || (item.Type !== "Series" && item.Type !== "Season")) {
            console.debug("[Owlfin] nextepisode: item non è Series/Season, salto", item && item.Type);
            return;
        }

        let tvdbId = item.ProviderIds && item.ProviderIds.Tvdb;
        let title = item.SeriesName || item.Name;

        if (!tvdbId && item.Type === "Season" && item.SeriesId) {
            const series = await fetchItem(base, userId, token, item.SeriesId);
            tvdbId = series && series.ProviderIds && series.ProviderIds.Tvdb;
            title = (series && series.Name) || title;
        }

        if (!tvdbId) {
            console.debug(`[Owlfin] nextepisode: nessun TVDB id per "${title}", provo per titolo`);
        }

        const nextAiring = await fetchNextAiring(base, token, tvdbId, title);
        if (!nextAiring) return;

        // Un'altra vista potrebbe essere già subentrata durante le await sopra.
        if (currentItemId() !== itemId) return;
        removeBadge();

        const badge = document.createElement("div");
        badge.id = "owlplugin-next-episode";
        badge.textContent = `Prossimo episodio il ${formatDate(nextAiring)}`;
        badge.style.cssText = "margin:6px 0;font-size:14px;opacity:.85;";

        anchor.appendChild(badge);
    }

    function onNavigate() {
        removeBadge();
        tryShow(15); // fino a ~4.5s di retry (15 x 300ms)
    }

    document.addEventListener("viewshow", onNavigate);
    window.addEventListener("hashchange", onNavigate);
    onNavigate();
})();
