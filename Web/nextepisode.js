(function () {
    "use strict";

    // ============ OWLFIN DEBUG BANNER -- RIMUOVERE A DIAGNOSI CONCLUSA ============
    const dbgBox = document.createElement("div");
    dbgBox.id = "owlfin-debug-banner";
    dbgBox.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:999999;background:#000;color:#0f0;font-size:10px;font-family:monospace;padding:6px;max-height:34vh;overflow-y:auto;opacity:.95;white-space:pre-wrap;word-break:break-all;";
    document.body.appendChild(dbgBox);
    const dbgLines = [];
    function dbg(msg) {
        const t = new Date().toISOString().substr(11, 12);
        dbgLines.push(`${t} ${msg}`);
        if (dbgLines.length > 60) dbgLines.shift();
        dbgBox.textContent = dbgLines.join("\n");
    }
    dbg("script avviato (versione: intercetta fetch, non usa più l'URL)");
    // ================================================================================

    let currentId = null;
    if (!window.__owlfinFetchPatched) {
        window.__owlfinFetchPatched = true;
        const _fetch = window.fetch;
        window.fetch = function (input, init) {
            try {
                const url = typeof input === "string" ? input : (input && input.url) || "";
                const m = url.match(/\/Items\/([a-f0-9]{32})(?:[/?]|$)/i);
                if (m) {
                    const isImages = /\/Images(\/|$)/i.test(url);
                    const isSimilar = /\/Similar/i.test(url);
                    if (!isImages && !isSimilar) {
                        dbg(`fetch intercettato -> id=${m[1]} (${url.replace(/^https?:\/\/[^/]+/, "")})`);
                        window.dispatchEvent(new CustomEvent("owlfin:itemseen", { detail: m[1] }));
                    } else {
                        dbg(`fetch ignorato (images/similar): ${url.replace(/^https?:\/\/[^/]+/, "")}`);
                    }
                }
            } catch (e) {
                dbg("errore nel patch fetch: " + e);
            }
            return _fetch.apply(this, arguments);
        };
        dbg("patch window.fetch installata");
    } else {
        dbg("patch window.fetch già presente");
    }

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
            if (!r.ok) { dbg(`fetchUpcomingEpisodes: HTTP ${r.status}`); return []; }
            const j = await r.json();
            return Array.isArray(j.episodes) ? j.episodes : [];
        } catch (e) {
            dbg("fetchUpcomingEpisodes: errore di rete " + e);
            return [];
        }
    }

    function formatDate(iso) {
        try {
            return new Date(iso).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
        } catch {
            return iso;
        }
    }

    function episodeLabel(ep) {
        const s = String(ep.season).padStart(2, "0");
        const e = String(ep.episode).padStart(2, "0");
        return `S${s}E${e}${ep.title ? " – " + ep.title : ""}`;
    }

    function removeBadge() {
        const old = document.getElementById("owlfin-next-episode");
        if (old) old.remove();
    }

    function onEscKey(e) { if (e.key === "Escape") closeModal(); }

    function closeModal() {
        const old = document.getElementById("owlfin-modal-overlay");
        if (old) old.remove();
        document.removeEventListener("keydown", onEscKey);
    }

    function openModal(episodes) {
        closeModal();
        const overlay = document.createElement("div");
        overlay.id = "owlfin-modal-overlay";
        overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;";
        overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

        const card = document.createElement("div");
        card.style.cssText = "background:rgba(28,28,30,.55);color:#fff;border-radius:18px;max-width:420px;width:100%;max-height:70vh;overflow-y:auto;padding:20px;box-shadow:0 8px 32px rgba(0,0,0,.35);backdrop-filter:blur(24px) saturate(180%);-webkit-backdrop-filter:blur(24px) saturate(180%);border:1px solid rgba(255,255,255,.15);";

        const header = document.createElement("div");
        header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;";
        const h = document.createElement("h3");
        h.textContent = "Prossimi episodi";
        h.style.cssText = "margin:0;font-size:16px;font-weight:600;color:#fff;";
        const closeBtn = document.createElement("button");
        closeBtn.textContent = "×";
        closeBtn.setAttribute("aria-label", "Chiudi");
        closeBtn.style.cssText = "background:none;border:none;color:#aaa;font-size:16px;cursor:pointer;line-height:1;padding:4px;";
        closeBtn.addEventListener("click", closeModal);
        header.appendChild(h);
        header.appendChild(closeBtn);

        const list = document.createElement("ul");
        list.style.cssText = "list-style:none;margin:0;padding:0;";
        episodes.forEach((ep, i) => {
            const li = document.createElement("li");
            li.style.cssText = "display:flex;justify-content:space-between;gap:12px;padding:9px 0;" +
                (i < episodes.length - 1 ? "border-bottom:1px solid rgba(255,255,255,.08);" : "") + "font-size:14px;";
            const label = document.createElement("span");
            label.textContent = episodeLabel(ep);
            label.style.opacity = ".9";
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

    function getAnchor() {
        return document.querySelector(".itemMiscInfo")
            || document.querySelector(".nameContainer")
            || document.querySelector(".detailPagePrimaryContainer")
            || document.querySelector(".detailPageWrapper");
    }

    let navGeneration = 0;

    async function tryShow(itemId, retriesLeft, myGeneration) {
        if (myGeneration !== navGeneration) return;

        const { token, userId, base } = gc();
        if (!token || !userId) {
            if (retriesLeft > 0) setTimeout(() => tryShow(itemId, retriesLeft - 1, myGeneration), 300);
            return;
        }
        if (!getAnchor()) {
            dbg(`tryShow: anchor non trovato (retries=${retriesLeft})`);
            if (retriesLeft > 0) setTimeout(() => tryShow(itemId, retriesLeft - 1, myGeneration), 300);
            return;
        }

        const item = await fetchItem(base, userId, token, itemId);
        if (myGeneration !== navGeneration) return;
        if (!item || (item.Type !== "Series" && item.Type !== "Season")) {
            dbg(`tryShow: item non è Series/Season (Type=${item && item.Type}), salto`);
            return;
        }
        dbg(`tryShow: item OK, Type=${item.Type}, Name=${item.Name}`);

        let tvdbId = item.ProviderIds && item.ProviderIds.Tvdb;
        let title = item.SeriesName || item.Name;

        if (!tvdbId && item.Type === "Season" && item.SeriesId) {
            const series = await fetchItem(base, userId, token, item.SeriesId);
            if (myGeneration !== navGeneration) return;
            tvdbId = series && series.ProviderIds && series.ProviderIds.Tvdb;
            title = (series && series.Name) || title;
        }

        let episodes = await fetchUpcomingEpisodes(base, token, tvdbId, title);
        if (myGeneration !== navGeneration) return;
        dbg(`tryShow: Sonarr -> ${episodes.length} episodi per "${title}"`);
        if (!episodes.length) return;

        if (item.Type === "Season" && typeof item.IndexNumber === "number") {
            const seasonOnly = episodes.filter((ep) => ep.season === item.IndexNumber);
            if (seasonOnly.length) episodes = seasonOnly;
        }

        if (myGeneration !== navGeneration || currentId !== itemId) return;
        const anchor = getAnchor();
        if (!anchor || !anchor.parentElement) { dbg("tryShow: anchor o parentElement mancante, esco"); return; }

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

        anchor.parentElement.insertBefore(badge, anchor.nextSibling);
        dbg("tryShow: SUCCESSO, badge inserito come fratello dell'anchor");

        const watchTarget = anchor.parentElement;
        const healer = new MutationObserver(() => {
            if (myGeneration !== navGeneration) { healer.disconnect(); return; }
            if (document.getElementById("owlfin-next-episode")) return;
            const freshAnchor = getAnchor();
            if (freshAnchor && freshAnchor.parentElement) {
                dbg("tryShow: badge rimosso dal framework, lo reinserisco");
                freshAnchor.parentElement.insertBefore(badge, freshAnchor.nextSibling);
            } else {
                healer.disconnect();
            }
        });
        healer.observe(watchTarget, { childList: true });
    }

    window.addEventListener("owlfin:itemseen", (e) => {
        const id = e.detail;
        if (id === currentId) return;
        dbg(`NUOVO ITEM RILEVATO: ${currentId} -> ${id}`);
        currentId = id;

        navGeneration++;
        const myGeneration = navGeneration;
        removeBadge();
        closeModal();
        tryShow(id, 15, myGeneration);
    });
})();
