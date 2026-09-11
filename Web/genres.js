/**
 * Genre Browser — Netflix-style genre overlay for Jellyfin
 *
 * Parte di Owlfin. Toggle via Configuration.GenresEnabled.
 *
 * @version 1.0.0
 * @license GPL-3.0
 */
(function () {
    "use strict";

    function getCreds() {
        try {
            const c = JSON.parse(localStorage.getItem("jellyfin_credentials") || "{}");
            const sv = (c.Servers || [])[0] || {};
            return {
                token:    sv.AccessToken,
                userId:   sv.UserId,
                serverId: sv.Id,
                base:     (sv.ManualAddress || sv.LocalAddress || location.origin).replace(/\/+$/, "")
            };
        } catch { return {}; }
    }

    function injectCSS() {
        if (document.getElementById("gb-nf-css")) return;
        const s = document.createElement("style");
        s.id = "gb-nf-css";
        s.textContent = `
        #gb-nf-overlay {
            display: none;
            position: fixed;
            inset: 0;
            z-index: 99999;
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
            overflow: hidden;
        }
        #gb-nf-overlay.gb-nf-open {
            display: flex;
            animation: gb-nf-in 0.22s ease forwards;
        }
        @keyframes gb-nf-in { from { opacity: 0; } to { opacity: 1; } }

        #gb-nf-tabs {
            display: flex;
            gap: 10px;
            padding: 18px 20px 10px;
            flex-shrink: 0;
            align-self: flex-start;
        }
        .gb-nf-tab {
            padding: 6px 18px;
            border-radius: 4px;
            border: 1px solid rgba(255,255,255,0.3);
            background: transparent;
            color: rgba(255,255,255,0.7);
            font-size: 0.82rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s;
        }
        .gb-nf-tab:hover { border-color: #fff; color: #fff; }
        .gb-nf-tab.active { background: #fff; color: #000; border-color: #fff; }

        #gb-nf-list {
            flex: 1;
            width: 100%;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 10px 0 20px;
            scrollbar-width: none;
        }
        #gb-nf-list::-webkit-scrollbar { display: none; }

        .gb-nf-genre-item {
            width: 100%;
            max-width: 360px;
            text-align: center;
            padding: 14px 20px;
            color: rgba(255,255,255,0.75);
            font-size: 1.1rem;
            font-weight: 500;
            cursor: pointer;
            transition: color 0.12s, transform 0.12s;
            border: none;
            background: none;
        }
        .gb-nf-genre-item:hover { color: #fff; transform: scale(1.05); }
        .gb-nf-genre-item.gb-nf-selected { color: #fff; font-weight: 700; }

        #gb-nf-close-wrap {
            flex-shrink: 0;
            padding: 16px 0 28px;
            display: flex;
            justify-content: center;
        }
        #gb-nf-close {
            width: 44px;
            height: 44px;
            border-radius: 50%;
            border: 2px solid rgba(255,255,255,0.5);
            background: rgba(255,255,255,0.08);
            color: #fff;
            font-size: 1.1rem;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s;
        }
        #gb-nf-close:hover { border-color: #fff; background: rgba(255,255,255,0.2); }

        .gb-nf-spinner {
            width: 28px; height: 28px;
            border: 3px solid rgba(255,255,255,0.15);
            border-top-color: #fff;
            border-radius: 50%;
            animation: gb-nf-spin 0.7s linear infinite;
            margin: 40px auto;
        }
        @keyframes gb-nf-spin { to { transform: rotate(360deg); } }
        .gb-nf-error { color: rgba(255,255,255,0.5); text-align: center; padding: 40px 20px; font-size: 0.9rem; }

        #gb-drawer-section { padding: 0 0 4px 0; }
        #gb-drawer-section .gb-section-label {
            font-size: 0.72rem;
            font-weight: 600;
            color: rgba(255,255,255,0.35);
            letter-spacing: 1.2px;
            text-transform: uppercase;
            padding: 16px 20px 4px;
            font-family: inherit;
        }
        #gb-drawer-btn {
            display: flex;
            align-items: center;
            gap: 0;
            padding: 0;
            color: rgba(255,255,255,0.85);
            cursor: pointer;
            border: none;
            background: none;
            width: 100%;
            text-align: left;
            font-size: 1rem;
            font-family: inherit;
            font-weight: 400;
            transition: background 0.15s;
            letter-spacing: normal;
        }
        #gb-drawer-btn:hover { background: rgba(255,255,255,0.05); }
        #gb-drawer-btn .gb-di {
            font-family: "Material Icons";
            font-size: 1.35rem;
            padding: 10px 16px 10px 20px;
            color: rgba(255,255,255,0.55);
            font-weight: normal;
            font-style: normal;
            line-height: 1;
            flex-shrink: 0;
        }
        #gb-drawer-btn .gb-dt { padding: 10px 0; color: rgba(255,255,255,0.87); font-size: 1rem; }
        `;
        document.head.appendChild(s);
    }

    function closeSidebar() {
        const mask = document.querySelector(".tmla-mask.backdrop");
        if (mask) { mask.click(); return; }
        const drawer = document.querySelector(".mainDrawer");
        if (drawer) {
            drawer.classList.remove("drawer-open");
            drawer.classList.remove("touch-menu-la");
        }
    }

    function buildOverlay() {
        if (document.getElementById("gb-nf-overlay")) return;
        const overlay = document.createElement("div");
        overlay.id = "gb-nf-overlay";
        overlay.innerHTML = `
            <div id="gb-nf-tabs">
                <button class="gb-nf-tab active" data-type="All">Tutto</button>
                <button class="gb-nf-tab" data-type="Movie">Film</button>
                <button class="gb-nf-tab" data-type="Series">Serie TV</button>
            </div>
            <div id="gb-nf-list"><div class="gb-nf-spinner"></div></div>
            <div id="gb-nf-close-wrap"><button id="gb-nf-close">✕</button></div>
        `;
        document.body.appendChild(overlay);

        overlay.addEventListener("click", e => { if (e.target === overlay) closeOverlay(); });
        document.getElementById("gb-nf-close").onclick = closeOverlay;
        document.addEventListener("keydown", e => { if (e.key === "Escape") closeOverlay(); });

        overlay.querySelectorAll(".gb-nf-tab").forEach(tab => {
            tab.onclick = e => {
                e.stopPropagation();
                overlay.querySelectorAll(".gb-nf-tab").forEach(t => t.classList.remove("active"));
                tab.classList.add("active");
                loadGenres(tab.dataset.type);
            };
        });
    }

    let _currentType = "All";

    function openOverlay() {
        injectCSS();
        buildOverlay();
        closeSidebar();
        setTimeout(() => {
            document.getElementById("gb-nf-overlay").classList.add("gb-nf-open");
            loadGenres(_currentType);
        }, 250);
    }

    function closeOverlay() {
        const el = document.getElementById("gb-nf-overlay");
        if (el) el.classList.remove("gb-nf-open");
    }

    async function loadGenres(mediaType) {
        _currentType = mediaType;
        const list = document.getElementById("gb-nf-list");
        if (!list) return;
        list.innerHTML = '<div class="gb-nf-spinner"></div>';

        const creds = getCreds();
        if (!creds.token) {
            list.innerHTML = '<p class="gb-nf-error">Non autenticato</p>';
            return;
        }

        try {
            let url = `${creds.base}/Genres?userId=${creds.userId}&Recursive=true&SortBy=SortName&SortOrder=Ascending`;
            if (mediaType === "Movie")       url += "&IncludeItemTypes=Movie";
            else if (mediaType === "Series") url += "&IncludeItemTypes=Series";
            else                             url += "&IncludeItemTypes=Movie,Series";

            const r = await fetch(url, {
                headers: { Authorization: `MediaBrowser Token="${creds.token}"` }
            });
            const j = await r.json();
            const genres = j.Items || [];

            if (!genres.length) {
                list.innerHTML = '<p class="gb-nf-error">Nessun genere trovato</p>';
                return;
            }

            list.innerHTML = "";
            genres.forEach(genre => {
                const btn = document.createElement("button");
                btn.className = "gb-nf-genre-item";
                btn.textContent = genre.Name;
                btn.onclick = e => {
                    e.stopPropagation();
                    list.querySelectorAll(".gb-nf-genre-item").forEach(b => b.classList.remove("gb-nf-selected"));
                    btn.classList.add("gb-nf-selected");
                    setTimeout(() => {
                        closeOverlay();
                        let hash = `#!/list.html?genreId=${genre.Id}&serverId=${creds.serverId}`;
                        if (mediaType === "Movie")       hash += "&type=Movie";
                        else if (mediaType === "Series") hash += "&type=Series";
                        location.hash = hash;
                    }, 180);
                };
                list.appendChild(btn);
            });
        } catch (e) {
            list.innerHTML = '<p class="gb-nf-error">Errore nel caricamento</p>';
        }
    }

    function injectMenuEntry() {
        if (document.getElementById("gb-drawer-section")) return;

        const drawer = document.querySelector(".mainDrawer-scrollContainer") ||
                       document.querySelector(".mainDrawer");
        if (!drawer) return;

        const homeLink = Array.from(drawer.children).find(el =>
            el.tagName === "A" && el.textContent.trim().toLowerCase() === "home"
        );
        if (!homeLink) return;

        const section = document.createElement("div");
        section.id = "gb-drawer-section";

        const label = document.createElement("div");
        label.className = "gb-section-label";
        label.textContent = "Generi";

        const btn = document.createElement("button");
        btn.id = "gb-drawer-btn";
        btn.innerHTML = '<span class="gb-di">theaters</span><span class="gb-dt">Sfoglia Generi</span>';
        btn.addEventListener("click", e => {
            e.preventDefault();
            e.stopImmediatePropagation();
            openOverlay();
        }, true);

        section.appendChild(label);
        section.appendChild(btn);

        drawer.insertBefore(section, homeLink.nextSibling);

        document.querySelectorAll("a.navMenuOption, a[class*='navMenu']").forEach(el => {
            if (el.href && el.href.includes("GenreBrowser")) {
                el.style.display = "none";
            }
        });
    }

    injectCSS();
    document.addEventListener("viewshow", () => setTimeout(injectMenuEntry, 400));
    setTimeout(injectMenuEntry, 1000);
    setTimeout(injectMenuEntry, 2500);
    setTimeout(injectMenuEntry, 4000);

    window.addEventListener("hashchange", e => {
        if (location.hash.toLowerCase().includes("genrebrowser")) {
            history.back();
            setTimeout(openOverlay, 100);
        }
    }, true);

})();
