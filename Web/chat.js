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
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
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
            border-radius: 20px;
            border: none;
            padding: 10px 16px;
            font-size: 0.95rem;
            background: rgba(255,255,255,0.12);
            color: #fff;
            -webkit-user-select: text !important;
            user-select: text !important;
            -webkit-touch-callout: default !important;
            pointer-events: auto !important;
        }
        #owl-chat-input::placeholder { color: rgba(255,255,255,0.5); }
        #owl-chat-send {
            border-radius: 50%;
            width: 42px; height: 42px;
            border: none;
            background: rgba(100,150,255,0.6);
            color: #fff;
            cursor: pointer;
        }
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
            if (messages.length) lastSeenUtc = messages[messages.length - 1].timestampUtc;
            renderMessages(messages, creds.userId);
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
        const hadMuiDrawer = closeMuiDrawerIfOpen();
        closeSidebarLegacy();

        const delay = hadMuiDrawer ? 200 : 0;
        setTimeout(() => {
            injectCSS();
            buildOverlay();
            document.getElementById("owl-chat-overlay").classList.add("owl-chat-open");
            overlayOpen = true;
            const creds = getCreds();
            loadInitialHistory(creds).then(() => poll(creds));

            const input = document.getElementById("owl-chat-input");
            if (input) setTimeout(() => input.focus(), 50);
        }, delay);
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

    // --- Voce in sidebar: stesso doppio aggancio (MUI 12+ / legacy 10.11) di genres.js ---

    function injectMuiMenuEntry(muiDrawer) {
        if (document.getElementById("owl-chat-mui-item")) return;
        const subheader = document.createElement("div");
        subheader.className = "MuiListSubheader-root";
        subheader.textContent = "Community";
        subheader.style.cssText = "padding:16px 20px 4px;list-style:none;";

        const item = document.createElement("div");
        item.id = "owl-chat-mui-item";
        item.className = "MuiListItemButton-root";
        item.setAttribute("role", "button");
        item.tabIndex = 0;
        item.style.cssText = "display:flex;align-items:center;gap:12px;padding:10px 16px;cursor:pointer;width:85%;margin:3px auto;list-style:none;";
        item.innerHTML = '<span class="material-icons" style="font-size:1.35rem;opacity:.8;">chat</span><span>Chat generale</span>';

        const activate = e => { e.preventDefault(); e.stopPropagation(); openChat(); };
        item.addEventListener("click", activate);
        item.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") activate(e); });

        muiDrawer.appendChild(subheader);
        muiDrawer.appendChild(item);
    }

    function injectLegacyMenuEntry(drawer) {
        if (document.getElementById("owl-chat-legacy-section")) return;
        const homeLink = Array.from(drawer.children).find(el =>
            el.tagName === "A" && el.textContent.trim().toLowerCase() === "home"
        );
        if (!homeLink) return;

        const section = document.createElement("div");
        section.id = "owl-chat-legacy-section";
        const label = document.createElement("div");
        label.className = "gb-section-label";
        label.textContent = "Community";
        const btn = document.createElement("button");
        btn.id = "owl-chat-legacy-btn";
        btn.innerHTML = '<span class="gb-di">chat</span><span class="gb-dt">Chat generale</span>';
        btn.addEventListener("click", e => { e.preventDefault(); e.stopImmediatePropagation(); openChat(); }, true);

        section.appendChild(label);
        section.appendChild(btn);
        drawer.insertBefore(section, homeLink.nextSibling);
    }

    function injectMenuEntry() {
        if (document.getElementById("owl-chat-mui-item") || document.getElementById("owl-chat-legacy-section")) return;

        const muiDrawer = document.querySelector(".MuiDrawer-paper");
        if (muiDrawer) { injectMuiMenuEntry(muiDrawer); return; }

        const drawer = document.querySelector(".mainDrawer-scrollContainer") || document.querySelector(".mainDrawer");
        if (drawer) injectLegacyMenuEntry(drawer);
    }

    injectCSS();
    document.addEventListener("viewshow", () => setTimeout(injectMenuEntry, 400));
    setTimeout(injectMenuEntry, 1000);
    setTimeout(injectMenuEntry, 2500);
    setTimeout(injectMenuEntry, 4000);
})();
