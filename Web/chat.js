/**
 * Owlfin — Chat generale tra utenti, storico illimitato.
 */
(function () {
    "use strict";

    let pollTimer = null;
    let lastSeenUtc = null;
    let overlayOpen = false;

    function getCreds() {
        try {
            const c = JSON.parse(localStorage.getItem("jellyfin_credentials") || "{}");
            const sv = (c.Servers || [])[0] || {};
            return {
                token: sv.AccessToken,
                userId: sv.UserId,
                base: (sv.ManualAddress || sv.LocalAddress || location.origin).replace(/\/+$/, "")
            };
        } catch { return {}; }
    }

    function injectCSS() {
        if (document.getElementById("owl-chat-css")) return;
        const s = document.createElement("style");
        s.id = "owl-chat-css";
        s.textContent = `
        #owl-chat-overlay {
            display: none;
            position: fixed;
            inset: 0;
            z-index: 99999;
            background: rgba(15, 15, 18, 0.97);
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
        }
        #owl-chat-overlay.owl-chat-open { display: flex; }
        #owl-chat-header {
            width: 100%;
            max-width: 640px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 18px 20px 10px;
            flex-shrink: 0;
        }
        #owl-chat-header h3 { color: #fff; margin: 0; font-size: 1.1rem; }
        #owl-chat-close {
            width: 40px; height: 40px; border-radius: 50%;
            border: 2px solid rgba(255,255,255,0.5);
            background: rgba(255,255,255,0.08);
            color: #fff; font-size: 1.1rem; cursor: pointer;
        }
        #owl-chat-messages {
            flex: 1;
            width: 100%;
            max-width: 640px;
            overflow-y: auto;
            padding: 10px 20px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .owl-chat-msg {
            background: rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 8px 14px;
            color: #fff;
            max-width: 80%;
            word-break: break-word;
        }
        .owl-chat-msg.owl-chat-own {
            align-self: flex-end;
            background: rgba(100,150,255,0.35);
        }
        .owl-chat-msg .owl-chat-author {
            font-size: 0.72rem;
            opacity: 0.65;
            margin-bottom: 2px;
            font-weight: 600;
        }
        .owl-chat-msg .owl-chat-time {
            font-size: 0.65rem;
            opacity: 0.5;
            margin-top: 4px;
            text-align: right;
        }
        #owl-chat-inputbar {
            width: 100%;
            max-width: 640px;
            display: flex;
            gap: 8px;
            padding: 12px 20px 24px;
            flex-shrink: 0;
        }
        #owl-chat-input {
            flex: 1;
            border-radius: 22px;
            border: 1px solid rgba(255,255,255,0.1);
            padding: 12px 18px;
            font-size: 0.95rem;
            background: rgba(255,255,255,0.10);
            color: #fff;
            outline: none;
            transition: border-color 0.15s, background 0.15s;
            -webkit-user-select: text !important;
            user-select: text !important;
            -webkit-touch-callout: default !important;
            pointer-events: auto !important;
        }
        #owl-chat-input:focus {
            border-color: rgba(120,160,255,0.7);
            background: rgba(255,255,255,0.14);
        }
        #owl-chat-input::placeholder { color: rgba(255,255,255,0.45); }
        #owl-chat-send {
            border-radius: 50%;
            width: 46px; height: 46px;
            border: none;
            background: rgb(88, 130, 240);
            color: #fff;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 8px rgba(88,130,240,0.4);
            transition: transform 0.1s, opacity 0.15s;
            flex-shrink: 0;
        }
        #owl-chat-send:active { transform: scale(0.92); }
        #owl-chat-send:disabled { opacity: 0.4; box-shadow: none; cursor: default; }
        .owl-chat-empty {
            color: rgba(255,255,255,0.45);
            text-align: center;
            padding: 60px 20px;
            font-size: 0.95rem;
        }
        .owl-chat-fab {
            position: fixed;
            right: 18px;
            bottom: 24px;
            z-index: 99998;
            width: 54px;
            height: 54px;
            border-radius: 50%;
            border: none;
            background: rgb(88, 130, 240);
            color: #fff;
            box-shadow: 0 4px 16px rgba(88,130,240,0.5);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transform: scale(0.6);
            pointer-events: none;
            transition: opacity 0.2s ease, transform 0.2s ease;
        }
        .owl-chat-fab-visible { opacity: 1; transform: scale(1); pointer-events: auto; }
        .owl-chat-fab:active { transform: scale(0.9); }
        .owl-chat-fab .material-icons { font-size: 1.5rem; }
        .owl-chat-fab-dot {
            position: absolute;
            top: 4px;
            right: 4px;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #ff5252;
            border: 2px solid rgb(88, 130, 240);
            display: none;
        }
        .owl-chat-fab-dot-visible { display: block; }
        `;
        document.head.appendChild(s);
    }

    function buildOverlay() {
        if (document.getElementById("owl-chat-overlay")) return;
        const overlay = document.createElement("div");
        overlay.id = "owl-chat-overlay";
        overlay.innerHTML = `
            <div id="owl-chat-header">
                <h3>Chat generale</h3>
                <button id="owl-chat-close">✕</button>
            </div>
            <div id="owl-chat-messages"></div>
            <div id="owl-chat-inputbar">
                <input id="owl-chat-input" type="text" placeholder="Scrivi un messaggio..." maxlength="1000" />
                <button id="owl-chat-send">➤</button>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener("click", e => { if (e.target === overlay) closeChat(); });
        document.getElementById("owl-chat-close").onclick = closeChat;

        const input = document.getElementById("owl-chat-input");
        const send = () => sendMessage(input.value);
        document.getElementById("owl-chat-send").onclick = send;
        input.addEventListener("keydown", e => { if (e.key === "Enter") send(); });
    }

    function renderMessages(messages, myUserId) {
        const list = document.getElementById("owl-chat-messages");
        if (!list) return;
        const wasAtBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 40;

        messages.forEach(m => {
            const div = document.createElement("div");
            div.className = "owl-chat-msg" + (m.userId === myUserId ? " owl-chat-own" : "");
            const author = document.createElement("div");
            author.className = "owl-chat-author";
            author.textContent = m.username;
            const text = document.createElement("div");
            text.textContent = m.text;
            const time = document.createElement("div");
            time.className = "owl-chat-time";
            time.textContent = new Date(m.timestampUtc).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
            div.appendChild(author);
            div.appendChild(text);
            div.appendChild(time);
            list.appendChild(div);
        });

        if (wasAtBottom) list.scrollTop = list.scrollHeight;
    }

    async function loadInitialHistory(creds) {
        const list = document.getElementById("owl-chat-messages");
        if (list) list.innerHTML = "";
        try {
            const r = await fetch(`${creds.base}/Owlfin/Chat/Messages`, {
                headers: { Authorization: `MediaBrowser Token="${creds.token}"` }
            });
            if (!r.ok) return;
            const j = await r.json();
            const messages = j.messages || [];
            if (messages.length) {
                lastSeenUtc = messages[messages.length - 1].timestampUtc;
                renderMessages(messages, creds.userId);
            } else if (list) {
                list.innerHTML = '<div class="owl-chat-empty">Nessun messaggio ancora - scrivi il primo!</div>';
            }
            const listEl = document.getElementById("owl-chat-messages");
            if (listEl) listEl.scrollTop = listEl.scrollHeight;
        } catch { /* silenzioso: riproveremo al prossimo poll */ }
    }

    async function poll(creds) {
        if (!overlayOpen) return;
        try {
            const url = lastSeenUtc
                ? `${creds.base}/Owlfin/Chat/Messages?since=${encodeURIComponent(lastSeenUtc)}`
                : `${creds.base}/Owlfin/Chat/Messages`;
            const r = await fetch(url, {
                headers: { Authorization: `MediaBrowser Token="${creds.token}"` }
            });
            if (r.ok) {
                const j = await r.json();
                const messages = j.messages || [];
                if (messages.length) {
                    const empty = document.querySelector(".owl-chat-empty");
                    if (empty) empty.remove();
                    lastSeenUtc = messages[messages.length - 1].timestampUtc;
                    renderMessages(messages, creds.userId);
                }
            }
        } catch { /* silenzioso */ }
        pollTimer = setTimeout(() => poll(creds), 4000);
    }

    async function sendMessage(text) {
        text = (text || "").trim();
        if (!text) return;
        const creds = getCreds();
        if (!creds.token) return;

        const input = document.getElementById("owl-chat-input");
        if (input) input.value = "";

        try {
            await fetch(`${creds.base}/Owlfin/Chat/Messages`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `MediaBrowser Token="${creds.token}"`
                },
                body: JSON.stringify({ userId: creds.userId, text })
            });
        } catch { /* silenzioso, il prossimo poll comunque non la vedrà se è fallita */ }
    }

    // Il Drawer MUI di Jellyfin 12 ha un FocusTrap attivo finché non lo si
    // chiude "per davvero" (via React, non solo nascondendolo via CSS) --
    // altrimenti continua a rubare il focus a qualsiasi input fuori da sé,
    // incluso il nostro overlay.
    function closeMuiDrawerIfOpen() {
        const backdrop = document.querySelector(".MuiBackdrop-root") || document.querySelector(".MuiModal-backdrop");
        if (backdrop) { backdrop.click(); return true; }
        return false;
    }

    function openChat() {
        injectCSS();
        buildOverlay();
        document.getElementById("owl-chat-overlay").classList.add("owl-chat-open");
        overlayOpen = true;
        const creds = getCreds();
        loadInitialHistory(creds).then(() => poll(creds));

        const input = document.getElementById("owl-chat-input");
        if (input) input.focus();
    }

    function closeSidebarLegacy() {
        const mask = document.querySelector(".tmla-mask.backdrop");
        if (mask) { mask.click(); return; }
        const drawer = document.querySelector(".mainDrawer");
        if (drawer) {
            drawer.classList.remove("drawer-open");
            drawer.classList.remove("touch-menu-la");
        }
    }

    function closeChat() {
        const el = document.getElementById("owl-chat-overlay");
        if (el) el.classList.remove("owl-chat-open");
        overlayOpen = false;
        if (pollTimer) clearTimeout(pollTimer);
    }

    // Pulsante flottante fisso, sempre visibile, indipendente dal drawer --
    // Jellyfin Enhanced ha documentato che aprire un pannello dal click
    // dentro il drawer MUI di Jellyfin 12 e' inaffidabile (hanno dovuto
    // spostare il loro "Enhanced Panel" fuori dal drawer per lo stesso
    // motivo), quindi qui evitiamo del tutto quel percorso.
    function isHomePage() {
        // Client legacy: home ha hash vuoto o "#!/home.html", ed esiste
        // il contenitore #indexPage visibile.
        const hash = location.hash || "";
        const legacyHome = hash === "" || hash === "#!/home.html" || hash.startsWith("#!/home.html?");
        const legacyIndexVisible = !!document.querySelector("#indexPage:not(.hide)");

        // Segnali che indicano SICURAMENTE che non siamo in home, su
        // qualsiasi versione del client - pagina di dettaglio item,
        // ricerca, o pagine di libreria/lista.
        const onDetailPage = !!document.querySelector("#itemDetailPage:not(.hide)")
            || !!document.querySelector(".detailPageWrapper")
            || !!document.querySelector(".detailPagePrimaryContainer");
        const onSearchOrList = !!document.querySelector("#searchPage:not(.hide)")
            || !!document.querySelector("#itemListPage:not(.hide)")
            || location.pathname.includes("/search")
            || location.pathname.includes("/list");

        if (onDetailPage || onSearchOrList) return false;

        // Client Jellyfin 12 (MUI, routing via pathname, non hash):
        // consideriamo "home" quando il path e' la radice o termina
        // esplicitamente in /home, e nessuno dei segnali "non home" sopra e' vero.
        const path = location.pathname || "";
        const muiHome = path === "/" || path === "/web/" || path.endsWith("/web/index.html") || path.endsWith("/home");

        return legacyHome || legacyIndexVisible || muiHome;
    }

    function injectFab() {
        if (document.getElementById("owl-chat-fab")) return;
        injectCSS();

        const fab = document.createElement("button");
        fab.id = "owl-chat-fab";
        fab.className = "owl-chat-fab";
        fab.innerHTML = '<span class="material-icons">chat_bubble</span><span class="owl-chat-fab-dot" id="owl-chat-fab-dot"></span>';
        fab.addEventListener("click", openChat);
        document.body.appendChild(fab);
    }

    function updateFabVisibility() {
        const fab = document.getElementById("owl-chat-fab");
        if (!fab) return;
        const shouldShow = isHomePage();
        fab.classList.toggle("owl-chat-fab-visible", shouldShow);
        if (!shouldShow && overlayOpen) closeChat();
    }

    injectFab();
    updateFabVisibility();
    setInterval(updateFabVisibility, 800);
    window.addEventListener("hashchange", updateFabVisibility);
    window.addEventListener("popstate", updateFabVisibility);
    document.addEventListener("viewshow", () => setTimeout(updateFabVisibility, 200));
    injectCSS();
    document.addEventListener("viewshow", () => setTimeout(injectMenuEntry, 400));
    setTimeout(injectMenuEntry, 1000);
    setTimeout(injectMenuEntry, 2500);
    setTimeout(injectMenuEntry, 4000);
})();
