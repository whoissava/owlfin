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
        const m = location.href.match(/[?&#]id=([^&#]+)/);
        return m ? decodeURIComponent(m[1]) : null;
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

    async function fetchUpcomingEpisodes(base, token, tvdbId, title) {
        try {
            const params = title ? `?title=${encodeURIComponent(title)}` : "";
            const r = await fetch(`${base}/Owlfin/Sonarr/Episodes/${tvdbId || 0}${params}`, {
                headers: { Authorization: `MediaBrowser Token="${token}"` }
            });
            if (!r.ok) {
                console.debug(`[Owlfin] Sonarr Episodes: HTTP ${r.status} per tvdbId=${tvdbId} title="${title}"`);
                return [];
            }
            const j = await r.json();
            return Array.isArray(j.episodes) ? j.episodes : [];
        } catch (e) {
            console.debug("[Owlfin] Sonarr Episodes: errore di rete", e);
            return [];
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

    function episodeLabel(ep) {
        const s = String(ep.season ?? 0).padStart(2, "0");
        const e = String(ep.episode ?? 0).padStart(2, "0");
        return ep.title ? `S${s}E${e} – ${ep.title}` : `S${s}E${e}`;
    }

    function removeBadge() {
        const old = document.getElementById("owlfin-next-episode");
        if (old) old.remove();
    }

    function onEscKey(e) {
        if (e.key === "Escape") closeModal();
    }

    function closeModal() {
        const old = document.getElementById("owlfin-episodes-overlay");
        if (old) old.remove();
        document.removeEventListener("keydown", onEscKey);
    }

    function openModal(episodes) {
        closeModal();

        const overlay = document.createElement("div");
        overlay.id = "owlfin-episodes-overlay";
        overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;";
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closeModal();
        });

        const card = document.createElement("div");
        card.style.cssText = "background:rgba(28,28,30,.55);color:#fff;border-radius:18px;max-width:420px;width:100%;max-height:70vh;overflow-y:auto;padding:20px;box-shadow:0 8px 32px rgba(0,0,0,.35);backdrop-filter:blur(24px) saturate(180%);-webkit-backdrop-filter:blur(24px) saturate(180%);border:1px solid rgba(255,255,255,.15);";

        const header = document.createElement("div");
        header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;";

        const heading = document.createElement("h3");
        heading.textContent = "Prossimi episodi";
        heading.style.cssText = "margin:0;font-size:16px;font-weight:600;";

        const closeBtn = document.createElement("button");
        closeBtn.textContent = "✕";
        closeBtn.setAttribute("aria-label", "Chiudi");
        closeBtn.style.cssText = "background:none;border:none;color:#aaa;font-size:16px;cursor:pointer;line-height:1;padding:4px;";
        closeBtn.addEventListener("click", closeModal);
        closeBtn.addEventListener("mouseenter", () => { closeBtn.style.color = "#fff"; });
        closeBtn.addEventListener("mouseleave", () => { closeBtn.style.color = "#aaa"; });

        header.appendChild(heading);
        header.appendChild(closeBtn);

        const list = document.createElement("ul");
        list.style.cssText = "list-style:none;margin:0;padding:0;";

        episodes.forEach((ep) => {
            const li = document.createElement("li");
            li.style.cssText = "display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:14px;";

            const label = document.createElement("span");
            label.textContent = episodeLabel(ep);
            label.style.cssText = "opacity:.9;";

            const date = document.createElement("span");
            date.textContent = formatDate(ep.airDate);
            date.style.cssText = "opacity:.65;white-space:nowrap;";

            li.appendChild(label);
            li.appendChild(date);
            list.appendChild(li);
        });

        card.appendChild(header);
        card.appendChild(list);
        overlay.appendChild(card);
        document.body.appendChild(overlay);

        document.addEventListener("keydown", onEscKey);
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
        closeModal();

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

        let episodes = await fetchUpcomingEpisodes(base, token, tvdbId, title);
        if (!episodes.length) return;

        // Sulla pagina di una singola stagione mostra solo gli episodi di quella stagione.
        if (item.Type === "Season" && typeof item.IndexNumber === "number") {
            const seasonOnly = episodes.filter((ep) => ep.season === item.IndexNumber);
            if (seasonOnly.length) episodes = seasonOnly;
        }

        // Un'altra vista potrebbe essere già subentrata durante le await sopra.
        if (currentItemId() !== itemId) return;
        removeBadge();

        const next = episodes[0];
        const badge = document.createElement("div");
        badge.id = "owlfin-next-episode";
        badge.textContent = episodes.length > 1
            ? `Prossimo episodio: ${episodeLabel(next)} – ${formatDate(next.airDate)} (+${episodes.length - 1} in arrivo)`
            : `Prossimo episodio: ${episodeLabel(next)} – ${formatDate(next.airDate)}`;
        badge.style.cssText = "margin:6px 0;font-size:14px;opacity:.85;cursor:pointer;text-decoration:underline dotted;width:fit-content;";
        badge.title = "Mostra tutte le date in arrivo";
        badge.addEventListener("click", () => openModal(episodes));

        anchor.appendChild(badge);
    }

    function onNavigate() {
        removeBadge();
        closeModal();
        tryShow(15); // fino a ~4.5s di retry (15 x 300ms)
    }

    document.addEventListener("viewshow", onNavigate);
    window.addEventListener("hashchange", onNavigate);
    window.addEventListener("popstate", onNavigate);

    // Rete di sicurezza 1: polling sull'id item corrente (qualunque sia la
    // parte di URL in cui questo client lo mette: hash, path o query).
    let lastSeenItemId = currentItemId();
    setInterval(() => {
        const id = currentItemId();
        if (id !== lastSeenItemId) {
            lastSeenItemId = id;
            onNavigate();
        }
    }, 800);

    // Rete di sicurezza 2: il <title> della pagina cambia ad ogni item
    // aperto, indipendentemente dal meccanismo di routing usato sotto --
    // copre i client che non toccano affatto l'URL durante la navigazione.
    const titleEl = document.querySelector("title");
    if (titleEl) {
        let lastTitle = document.title;
        new MutationObserver(() => {
            if (document.title !== lastTitle) {
                lastTitle = document.title;
                onNavigate();
            }
        }).observe(titleEl, { childList: true });
    }

    onNavigate();
})();
