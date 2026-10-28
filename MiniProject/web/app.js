// ==========================================================================
// CampusMesh Web Dashboard Application Engine
// Delay-Tolerant Networking (DTN) P2P Cross-Platform Control Center
// Dynamic Online-Only Mesh Topology Radar
// ==========================================================================

const API_BASE = window.location.origin;

const state = {
    activeNodeId: localStorage.getItem("campusmesh_active_node") || null,
    serverLocalPeerId: "LAPTOP_WIN",
    localPeer: { id: "LAPTOP_WIN", ip: "127.0.0.1", port: 5001 },
    strategy: "ADAPTIVE",
    weights: { wP: 0.40, wT: 0.40, wB: 0.20 },
    defaultTokens: 4,
    activeContacts: new Set(),
    peers: [],
    buffer: [],
    evaluation: [],
    events: [],
    selectedNode: null,
    hoveredNode: null,
    animPackets: [],
    theme: localStorage.getItem("campusmesh_theme") || "dark",
    apiToken: null,
    bufferFilter: "inbox"
};

// Dynamic Topology Nodes & Links (Populated strictly from online/discovered peers)
let nodes = {};
let links = [];

// --------------------------------------------------------------------------
// Initialization
// --------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initCanvas();
    initEventListeners();
    updateDynamicTopology();
    startPollingLoop();
});

// --------------------------------------------------------------------------
// Theme Management (Dark & Light)
// --------------------------------------------------------------------------
function initTheme() {
    applyTheme(state.theme);

    const toggleBtn = document.getElementById("themeToggleBtn");
    if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
            const newTheme = document.body.classList.contains("dark-theme") ? "light" : "dark";
            applyTheme(newTheme);
            state.theme = newTheme;
            localStorage.setItem("campusmesh_theme", state.theme);
        });
    }
}

function applyTheme(theme) {
    const icon = document.getElementById("themeIcon");
    if (theme === "light") {
        document.body.classList.remove("dark-theme");
        document.body.classList.add("light-theme");
        if (icon) {
            icon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
        }
    } else {
        document.body.classList.remove("light-theme");
        document.body.classList.add("dark-theme");
        if (icon) {
            icon.innerHTML = `<circle cx="12" cy="12" r="5"></circle><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>`;
        }
    }
}

// --------------------------------------------------------------------------
// Active Node Identity Management
// --------------------------------------------------------------------------
window.promptChangeNodeId = function() {
    const current = state.myNodeId || "MY_NODE";
    const entered = prompt("Enter your local mesh Call-sign / Device Node ID:\n(Letters, numbers, underscores only, max 20 chars)", current);
    if (entered) {
        const cleaned = entered.trim().toUpperCase().replace(/[^A-Z0-9_.-]/g, "_").substring(0, 20);
        if (cleaned) {
            localStorage.setItem("campusmesh_my_node_id", cleaned);
            applyMyNodeId(cleaned);
            fetchData();
            showToast(`Node identity set to: ${cleaned}`, "success");
        }
    }
};

function detectInitialNode(resStatus) {
    const isLocalhost = window.location.hostname === "localhost" || 
                        window.location.hostname === "127.0.0.1" || 
                        window.location.hostname === "0.0.0.0";
    const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

    const stored = localStorage.getItem("campusmesh_my_node_id");
    if (stored && (!isLocalhost || stored !== "PHONE_MOBILE")) {
        applyMyNodeId(stored);
        return;
    }

    let chosen;
    if (isLocalhost || !isMobileUA) {
        chosen = (resStatus && resStatus.localPeerId) ? resStatus.localPeerId : "LAPTOP_WIN";
        localStorage.setItem("campusmesh_my_node_id", chosen);
    } else {
        const rand = Math.floor(100 + Math.random() * 900);
        let prefix = "PHONE";
        if (/iPhone|iPad/i.test(navigator.userAgent)) prefix = "IPHONE";
        else if (/Android/i.test(navigator.userAgent)) prefix = "PHONE_AND";
        chosen = `${prefix}_${rand}`;
        localStorage.setItem("campusmesh_my_node_id", chosen);
    }
    applyMyNodeId(chosen);
}

function applyMyNodeId(nodeId) {
    state.myNodeId = nodeId;
    state.activeNodeId = nodeId;

    const badge = document.getElementById("myNodeIdBadge");
    if (badge) {
        badge.textContent = nodeId;
    }

    const srcInput = document.getElementById("composeSource");
    if (srcInput) {
        srcInput.value = nodeId;
    }

    const destInput = document.getElementById("composeDest");
    if (destInput && (!destInput.value || destInput.value === nodeId)) {
        destInput.value = "BROADCAST";
    }

    updateDynamicTopology();
}

// --------------------------------------------------------------------------
// Dynamic Mesh Radar Topology
// --------------------------------------------------------------------------
function updateDynamicTopology() {
    const localId = state.myNodeId || state.activeNodeId || state.localPeer.id || "LAPTOP_WIN";
    const newNodes = {};
    const newLinks = [];

    // Center Local Operating Node (This Device)
    let localPlatform = "LOCAL";
    let localLabel = `This Device (${localId})`;
    if (localId.includes("DOCKER") || localId.includes("WIN")) { localPlatform = "WINDOWS"; }
    else if (localId.includes("UBU") || localId.includes("LINUX")) { localPlatform = "UBUNTU"; }
    else if (localId.includes("AND")) { localPlatform = "ANDROID"; }
    else if (localId.includes("IOS") || localId.includes("IPHONE")) { localPlatform = "IOS"; }
    else if (localId.includes("MOBILE") || localId.includes("PHONE")) { localPlatform = "MOBILE"; }

    newNodes[localId] = {
        id: localId,
        x: 300,
        y: 190,
        label: localLabel,
        platform: localPlatform,
        isLocal: true,
        inContact: false
    };

    // Online non-expired peers only
    const onlinePeers = (state.peers || []).filter(p => !p.isExpired && p.peerId !== localId);
    const sortedPeers = [...onlinePeers].sort((a, b) => a.peerId.localeCompare(b.peerId));

    const totalPeers = sortedPeers.length;
    const radius = totalPeers <= 3 ? 130 : (totalPeers <= 6 ? 140 : 155);
    const angleStep = totalPeers > 0 ? (2 * Math.PI) / totalPeers : 0;

    sortedPeers.forEach((p, index) => {
        const angle = index * angleStep - (Math.PI / 2);
        const px = 300 + radius * Math.cos(angle);
        const py = 190 + radius * Math.sin(angle);
        const inContact = p.inContact || state.activeContacts.has(p.peerId);

        newNodes[p.peerId] = {
            id: p.peerId,
            x: px,
            y: py,
            label: p.displayName || p.peerId,
            platform: p.platform || "MOBILE",
            isLocal: false,
            inContact: inContact,
            ip: p.ipAddress || "127.0.0.1",
            port: p.port || 5001,
            lastSeen: p.lastSeenSecondsAgo || 0
        };

        newLinks.push({
            from: localId,
            to: p.peerId,
            inContact: inContact,
            type: "WIFI"
        });
    });

    nodes = newNodes;
    links = newLinks;

    renderQuickTargetPills(sortedPeers);
}

function renderQuickTargetPills(onlinePeers) {
    const container = document.getElementById("quickTargetPills");
    if (!container) return;

    let html = "";
    if (onlinePeers && onlinePeers.length > 0) {
        html += onlinePeers.map(p => {
            return `<button type="button" class="target-pill" onclick="setDestination('${escapeHtml(p.peerId)}')">${escapeHtml(p.peerId)}</button>`;
        }).join(" ");
    }
    html += `<button type="button" class="target-pill" onclick="setDestination('BROADCAST')">BROADCAST</button>`;
    container.innerHTML = html;
}

function initEventListeners() {
    // Routing Strategy Selector
    const stratSelect = document.getElementById("strategySelect");
    if (stratSelect) {
        stratSelect.addEventListener("change", (e) => {
            const strat = e.target.value;
            const panel = document.getElementById("adaptiveWeightsPanel");
            const sprayPanel = document.getElementById("sprayTokensPanel");
            if (panel) panel.style.display = strat === "ADAPTIVE" ? "" : "none";
            if (sprayPanel) sprayPanel.style.display = strat === "SPRAY_AND_WAIT" ? "" : "none";
            updateStrategyOnServer(strat, state.weights.wP, state.weights.wT, state.weights.wB);
            renderDecisionTable();
        });
    }

    // Weight sliders (wP, wT, wB)
    const sWp = document.getElementById("sliderWp");
    const sWt = document.getElementById("sliderWt");
    const sWb = document.getElementById("sliderWb");

    function onWeightSliderInput() {
        const wp = parseFloat(sWp ? sWp.value : 0.40);
        const wt = parseFloat(sWt ? sWt.value : 0.40);
        const wb = parseFloat(sWb ? sWb.value : 0.20);
        updateWeightDisplays(wp, wt, wb);
        state.weights = { wP: wp, wT: wt, wB: wb };
    }

    function onWeightSliderChange() {
        onWeightSliderInput();
        updateStrategyOnServer("ADAPTIVE", state.weights.wP, state.weights.wT, state.weights.wB);
    }

    if (sWp) { sWp.addEventListener("input", onWeightSliderInput); sWp.addEventListener("change", onWeightSliderChange); }
    if (sWt) { sWt.addEventListener("input", onWeightSliderInput); sWt.addEventListener("change", onWeightSliderChange); }
    if (sWb) { sWb.addEventListener("input", onWeightSliderInput); sWb.addEventListener("change", onWeightSliderChange); }

    // Spray-and-Wait Token inputs synchronization
    const sliderTokens = document.getElementById("sliderTokens");
    const composeTokens = document.getElementById("composeTokens");

    function onTokenChange(val) {
        const tokens = parseInt(val) || 4;
        const clamped = Math.max(1, Math.min(16, tokens));
        state.defaultTokens = clamped;
        const valBadge = document.getElementById("valTokens");
        if (valBadge) valBadge.textContent = clamped;
        if (sliderTokens && parseInt(sliderTokens.value) !== clamped) sliderTokens.value = clamped;
        if (composeTokens && parseInt(composeTokens.value) !== clamped) composeTokens.value = clamped;
    }

    if (sliderTokens) {
        sliderTokens.addEventListener("input", (e) => onTokenChange(e.target.value));
    }
    if (composeTokens) {
        composeTokens.addEventListener("input", (e) => onTokenChange(e.target.value));
    }

    // TTL slider label update
    const composeTtl = document.getElementById("composeTtl");
    if (composeTtl) {
        composeTtl.addEventListener("input", (e) => {
            const sec = parseInt(e.target.value);
            const min = Math.round(sec / 60);
            const hours = (sec / 3600).toFixed(1);
            const labelEl = document.getElementById("composeTtlVal");
            if (labelEl) {
                labelEl.textContent = sec >= 3600 ? `${hours} hrs` : `${min} min`;
            }
        });
    }

    // Compose Form Submit
    const form = document.getElementById("composeForm");
    if (form) {
        form.addEventListener("submit", (e) => {
            e.preventDefault();
            submitMessage();
        });
    }

    // Shortcut: Ctrl+Enter to send
    const payloadInput = document.getElementById("composePayload");
    if (payloadInput) {
        payloadInput.addEventListener("keydown", (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                submitMessage();
            }
        });
    }

    // Purge Expired Button
    const btnPurge = document.getElementById("btnPurgeExpired");
    if (btnPurge) {
        btnPurge.addEventListener("click", async () => {
            try {
                const headers = {};
                if (state.apiToken) headers["X-CampusMesh-Token"] = state.apiToken;
                await fetch(`${API_BASE}/api/buffer/purge`, { method: "POST", headers });
            } catch (ignored) {}
            await fetchData();
            showToast("Purged expired messages from local store.", "info");
        });
    }

    // Scan & Sync Button
    const btnScan = document.getElementById("btnScanBle");
    if (btnScan) {
        btnScan.addEventListener("click", () => {
            showToast("Scanning for nearby peers...", "info");
            fetchData();
        });
    }
}

// --------------------------------------------------------------------------
// Routing Strategy & Weight Management
// --------------------------------------------------------------------------
function updateWeightDisplays(wp, wt, wb) {
    const elWp = document.getElementById("valWp");
    const elWt = document.getElementById("valWt");
    const elWb = document.getElementById("valWb");
    if (elWp) elWp.textContent = (typeof wp === "number" ? wp : 0.40).toFixed(2);
    if (elWt) elWt.textContent = (typeof wt === "number" ? wt : 0.40).toFixed(2);
    if (elWb) elWb.textContent = (typeof wb === "number" ? wb : 0.20).toFixed(2);
}

window.applyTokenPreset = function(tokens) {
    const clamped = Math.max(1, Math.min(16, parseInt(tokens) || 4));
    state.defaultTokens = clamped;
    const valBadge = document.getElementById("valTokens");
    if (valBadge) valBadge.textContent = clamped;
    const sTokens = document.getElementById("sliderTokens");
    if (sTokens) sTokens.value = clamped;
    const cTokens = document.getElementById("composeTokens");
    if (cTokens) cTokens.value = clamped;

    const stratSelect = document.getElementById("strategySelect");
    if (stratSelect && stratSelect.value !== "SPRAY_AND_WAIT") {
        stratSelect.value = "SPRAY_AND_WAIT";
        const adaptPanel = document.getElementById("adaptiveWeightsPanel");
        const sprayPanel = document.getElementById("sprayTokensPanel");
        if (adaptPanel) adaptPanel.style.display = "none";
        if (sprayPanel) sprayPanel.style.display = "";
        updateStrategyOnServer("SPRAY_AND_WAIT");
    }
    showToast(`Spray-and-Wait tokens set to: L=${clamped}`);
    renderDecisionTable();
};

window.applyPresetWeights = function(wp, wt, wb) {
    const sWp = document.getElementById("sliderWp");
    const sWt = document.getElementById("sliderWt");
    const sWb = document.getElementById("sliderWb");

    if (sWp) sWp.value = wp;
    if (sWt) sWt.value = wt;
    if (sWb) sWb.value = wb;

    updateWeightDisplays(wp, wt, wb);
    state.weights = { wP: wp, wT: wt, wB: wb };

    const stratSelect = document.getElementById("strategySelect");
    if (stratSelect) stratSelect.value = "ADAPTIVE";
    const panel = document.getElementById("adaptiveWeightsPanel");
    if (panel) panel.style.display = "";

    updateStrategyOnServer("ADAPTIVE", wp, wt, wb);
    showToast(`Preset applied: wP=${wp.toFixed(2)}, wT=${wt.toFixed(2)}, wB=${wb.toFixed(2)}`);
};

async function updateStrategyOnServer(strategy, wp, wt, wb) {
    const strat = strategy || state.strategy || "ADAPTIVE";
    const curWp = (typeof wp === "number") ? wp : (state.weights.wP || 0.40);
    const curWt = (typeof wt === "number") ? wt : (state.weights.wT || 0.40);
    const curWb = (typeof wb === "number") ? wb : (state.weights.wB || 0.20);

    try {
        const headers = { "Content-Type": "application/json" };
        if (state.apiToken) headers["X-CampusMesh-Token"] = state.apiToken;

        const res = await fetch(`${API_BASE}/api/strategy`, {
            method: "POST",
            headers,
            body: JSON.stringify({ strategy: strat, wP: curWp, wT: curWt, wB: curWb })
        });
        if (res.ok) {
            state.strategy = strat;
            state.weights = { wP: curWp, wT: curWt, wB: curWb };
            showToast(`Routing strategy set to: ${strat}`, "success");

            // Refresh evaluation table immediately
            fetch(`${API_BASE}/api/evaluation`).then(r => r.json()).then(data => {
                state.evaluation = data || [];
                renderDecisionTable();
            }).catch(() => {});
        }
    } catch (err) {
        console.error("Strategy update failed:", err);
    }
}

// --------------------------------------------------------------------------
// Decision Matrix Table Rendering
// --------------------------------------------------------------------------
function renderDecisionTable() {
    const thead = document.getElementById("decisionTableHead");
    const body = document.getElementById("decisionTableBody");
    if (!body) return;

    // 1. Spray-and-Wait Mode: Show token allocation, phase, and binary splitting decisions
    if (state.strategy === "SPRAY_AND_WAIT") {
        if (thead) {
            thead.innerHTML = `
                <tr>
                    <th>#</th>
                    <th>Message ID</th>
                    <th>Priority</th>
                    <th>Tokens (L)</th>
                    <th>Phase</th>
                    <th>Token Split</th>
                    <th>Forwarding Decision</th>
                </tr>
            `;
        }

        const msgs = (state.buffer || []).filter(m => !m.isExpired && (m.remainingTTL === undefined || m.remainingTTL > 0));
        if (msgs.length === 0) {
            body.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding: 24px;">No candidate messages in buffer for Spray-and-Wait evaluation.</td></tr>`;
            return;
        }

        body.innerHTML = msgs.map((m, idx) => {
            const tokens = m.copyTokens !== undefined ? m.copyTokens : 4;
            const isSpray = tokens > 1;
            const pBadge = m.priority === "HIGH" ? "badge-high" : (m.priority === "MEDIUM" ? "badge-medium" : "badge-low");
            const phaseBadge = isSpray
                ? `<span class="badge" style="background: rgba(37, 99, 235, 0.15); color: var(--accent-cyan); font-weight:600;">SPRAY PHASE</span>`
                : `<span class="badge badge-low">WAIT PHASE</span>`;
            const splitText = isSpray
                ? `Sender: ${Math.ceil(tokens / 2)} / Relay: ${Math.floor(tokens / 2)}`
                : `Direct destination only`;
            const decisionBadge = isSpray
                ? `<span class="badge badge-success"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> FORWARD (SPLIT)</span>`
                : `<span class="badge badge-low">HOLD (WAIT)</span>`;

            return `
                <tr class="${isSpray ? 'selected-row' : ''}">
                    <td><strong>#${idx + 1}</strong></td>
                    <td><span class="font-mono font-bold">${escapeHtml(m.messageId)}</span></td>
                    <td><span class="badge ${pBadge}">${escapeHtml(m.priority)}</span></td>
                    <td><strong class="text-accent font-mono">L = ${tokens}</strong></td>
                    <td>${phaseBadge}</td>
                    <td><span class="font-mono" style="font-size:0.75rem;">${splitText}</span></td>
                    <td>${decisionBadge}</td>
                </tr>
            `;
        }).join("");
        return;
    }

    // 2. Adaptive Utility Mode: Standard Multi-Metric Decision Matrix
    if (thead) {
        thead.innerHTML = `
            <tr>
                <th>Rank</th>
                <th>Message ID</th>
                <th>Priority (P)</th>
                <th>Urgency (T)</th>
                <th>Buffer (B)</th>
                <th>Score</th>
                <th>Forwarding Decision</th>
            </tr>
        `;
    }

    if (!state.evaluation || state.evaluation.length === 0) {
        body.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding: 24px;">Awaiting candidate messages in buffer to rank...</td></tr>`;
        return;
    }

    body.innerHTML = state.evaluation.map(sc => {
        const pBadge = sc.priority === "HIGH" ? "badge-high" : (sc.priority === "MEDIUM" ? "badge-medium" : "badge-low");
        const selBadge = sc.selected
            ? `<span class="badge badge-success"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> FORWARD</span>`
            : `<span class="badge badge-low">HOLD</span>`;

        return `
            <tr class="${sc.selected ? 'selected-row' : ''}">
                <td><strong>#${sc.rank}</strong></td>
                <td><span class="font-mono font-bold">${escapeHtml(sc.messageId)}</span></td>
                <td><span class="badge ${pBadge}">${escapeHtml(sc.priority)} (${sc.p})</span></td>
                <td><span class="font-mono">${sc.t}</span></td>
                <td><span class="font-mono">${sc.b}</span></td>
                <td><strong class="text-accent font-mono" style="font-size:0.85rem;">${sc.utility}</strong></td>
                <td>${selBadge}</td>
            </tr>
        `;
    }).join("");
}

// --------------------------------------------------------------------------
// Mobile Modal Helpers
// --------------------------------------------------------------------------
window.openMobileModal = function() {
    const modal = document.getElementById("mobileConnectModal");
    if (modal) modal.style.display = "flex";
};

window.closeMobileModal = function() {
    const modal = document.getElementById("mobileConnectModal");
    if (modal) modal.style.display = "none";
};

window.copyMobileUrl = function() {
    const input = document.getElementById("mobileUrlInput");
    if (input) {
        input.select();
        navigator.clipboard.writeText(input.value).then(() => {
            showToast("Copied mobile URL to clipboard!", "success");
        }).catch(() => {
            document.execCommand("copy");
            showToast("Copied mobile URL!", "success");
        });
    }
};

window.setDestination = function(dest) {
    const destInput = document.getElementById("composeDest");
    if (destInput) {
        destInput.value = dest;
    }
    showToast(`Target set to ${dest}`);
};

// --------------------------------------------------------------------------
// Polling Loop
// --------------------------------------------------------------------------
function startPollingLoop() {
    fetchData();
    setInterval(fetchData, 1500);
}

async function fetchData() {
    try {
        const pollHeaders = {};
        if (state.myNodeId) pollHeaders["X-Node-ID"] = state.myNodeId;

        const [resStatus, resPeers, resBuf, resEval, resEvents] = await Promise.all([
            fetch(`${API_BASE}/api/status`, { headers: pollHeaders }).then(r => r.json()).catch(() => null),
            fetch(`${API_BASE}/api/peers`).then(r => r.json()).catch(() => []),
            fetch(`${API_BASE}/api/buffer`).then(r => r.json()).catch(() => []),
            fetch(`${API_BASE}/api/evaluation`).then(r => r.json()).catch(() => []),
            fetch(`${API_BASE}/api/events`).then(r => r.json()).catch(() => [])
        ]);

        if (resStatus) {
            if (resStatus.apiToken) {
                state.apiToken = resStatus.apiToken;
            } else if (!state.apiToken) {
                const t = new URLSearchParams((location.hash || "").replace(/^#/, "")).get("token");
                if (t) state.apiToken = t;
            }
            state.serverLocalPeerId = resStatus.localPeerId || "LAPTOP_WIN";
            state.localPeer.id = resStatus.localPeerId || "LAPTOP_WIN";
            state.activeContacts = new Set(resStatus.activeContacts || []);

            if (resStatus.strategy) {
                state.strategy = resStatus.strategy;
                const stratSelect = document.getElementById("strategySelect");
                if (stratSelect && stratSelect.value !== state.strategy) {
                    stratSelect.value = state.strategy;
                }
                const panel = document.getElementById("adaptiveWeightsPanel");
                const sprayPanel = document.getElementById("sprayTokensPanel");
                if (panel) panel.style.display = state.strategy === "ADAPTIVE" ? "" : "none";
                if (sprayPanel) sprayPanel.style.display = state.strategy === "SPRAY_AND_WAIT" ? "" : "none";
            }

            if (resStatus.weights) {
                state.weights = resStatus.weights;
                const sWp = document.getElementById("sliderWp");
                const sWt = document.getElementById("sliderWt");
                const sWb = document.getElementById("sliderWb");
                if (sWp && document.activeElement !== sWp) sWp.value = state.weights.wP;
                if (sWt && document.activeElement !== sWt) sWt.value = state.weights.wT;
                if (sWb && document.activeElement !== sWb) sWb.value = state.weights.wB;
                updateWeightDisplays(state.weights.wP, state.weights.wT, state.weights.wB);
            }

            if (!state.myNodeId) {
                detectInitialNode(resStatus);
            } else {
                applyMyNodeId(state.myNodeId);
            }

            if (resStatus.serverLanIp) {
                state.serverLanIp = resStatus.serverLanIp;
                const port = resStatus.serverPort || window.location.port || 8080;
                const mobileUrlInput = document.getElementById("mobileUrlInput");
                if (mobileUrlInput && !mobileUrlInput.dataset.manual) {
                    let displayIp = resStatus.serverLanIp;
                    if (displayIp.startsWith("172.") || displayIp === "127.0.0.1") {
                        const bh = window.location.hostname;
                        if (bh && bh !== "127.0.0.1" && bh !== "localhost" && bh !== "0.0.0.0") {
                            displayIp = bh;
                        }
                    }
                    const tokenHash = state.apiToken ? `/#token=${encodeURIComponent(state.apiToken)}` : "";
                    mobileUrlInput.value = `http://${displayIp}:${port}${tokenHash}`;
                }
            }

            const bCount = document.getElementById("bufCount");
            if (bCount) bCount.textContent = resStatus.bufferSize || 0;

            const rCount = document.getElementById("ribbonMsgCount");
            if (rCount) rCount.textContent = `${resStatus.bufferSize || 0} msgs`;
        }

        if (resPeers) {
            state.peers = resPeers;
            updateDynamicTopology();
            renderPeerChips();

            const onlineCount = state.peers.filter(p => !p.isExpired).length;
            const rPeers = document.getElementById("ribbonPeersCount");
            if (rPeers) rPeers.textContent = `${onlineCount} Online`;
        }

        if (resBuf) {
            state.buffer = resBuf;
            renderBuffer();
        }

        if (resEval) {
            state.evaluation = resEval;
            renderDecisionTable();
        }

        if (resEvents) {
            state.events = resEvents;
            renderEventsLog();
        }

    } catch (err) {
        console.warn("Polling error:", err);
    }
}

// --------------------------------------------------------------------------
// Peer Chips Rendering
// --------------------------------------------------------------------------
function renderPeerChips() {
    const list = document.getElementById("peerChipsList");
    if (!list) return;

    const localId = state.activeNodeId || state.localPeer.id || "LAPTOP_WIN";
    const onlinePeers = (state.peers || []).filter(p => !p.isExpired && p.peerId !== localId);

    if (onlinePeers.length === 0) {
        list.innerHTML = `<span class="text-muted" style="font-size:0.75rem;">No remote peers currently online. Scanning for nearby nodes...</span>`;
        return;
    }

    list.innerHTML = onlinePeers.map(p => {
        const inContact = state.activeContacts.has(p.peerId) || p.inContact;
        return `
            <div class="peer-chip ${inContact ? 'in-contact' : ''}" onclick="selectPeer('${escapeHtml(p.peerId)}')" title="Click to set ${escapeHtml(p.peerId)} as Destination">
                <span><strong>${escapeHtml(p.peerId)}</strong></span>
                <span class="text-muted">(${escapeHtml(p.platform)})</span>
            </div>
        `;
    }).join("");
}

window.selectPeer = function(peerId) {
    if (peerId === state.activeNodeId) {
        showToast(`${peerId} is currently this device's active operating node.`, "info");
        return;
    }
    const destInput = document.getElementById("composeDest");
    if (destInput) {
        destInput.value = peerId;
    }
    showToast(`Target set to ${peerId}`);
};

// --------------------------------------------------------------------------
// Message Buffer Rendering (Inbox / Sent / Node Buffer)
// --------------------------------------------------------------------------
window.setBufferFilter = function(filter) {
    state.bufferFilter = filter;
    document.querySelectorAll(".buffer-tab").forEach(tab => {
        tab.classList.toggle("active", tab.id === `tabBuf${filter.charAt(0).toUpperCase() + filter.slice(1)}`);
    });
    renderBuffer();
};

window.toggleMessageCard = function(el) {
    el.classList.toggle("expanded");
    const hint = el.querySelector(".msg-toggle-hint");
    if (hint) {
        hint.textContent = el.classList.contains("expanded") ? "Details ▲" : "Details ▼";
    }
};

function renderBuffer() {
    const list = document.getElementById("bufferList");
    if (!list) return;

    const allMsgs = state.buffer || [];
    const myId = state.myNodeId || state.activeNodeId || "";

    // Active unexpired messages
    const activeMsgs = allMsgs.filter(m => !m.isExpired && (m.remainingTTL === undefined || m.remainingTTL > 0));

    // 1. Inbox: unexpired messages destined for this node or broadcast (excluding messages sent by this node)
    const inboxMsgs = activeMsgs.filter(m => (m.destinationId === "BROADCAST" || m.destinationId === myId) && m.sourceId !== myId);

    // 2. Sent: messages sent by this node
    const sentMsgs = allMsgs.filter(m => m.sourceId === myId);

    // 3. Node Buffer (Relay): messages stored on this node that are passing through in transit
    const relayMsgs = allMsgs.filter(m => m.sourceId !== myId && m.destinationId !== myId && m.destinationId !== "BROADCAST");

    const cInbox = document.getElementById("bufCountInbox");
    const cSent = document.getElementById("bufCountSent");
    const cRelay = document.getElementById("bufCountRelay");
    if (cInbox) cInbox.textContent = inboxMsgs.length;
    if (cSent) cSent.textContent = sentMsgs.length;
    if (cRelay) cRelay.textContent = relayMsgs.length;

    let filtered = inboxMsgs;
    if (state.bufferFilter === "sent") filtered = sentMsgs;
    else if (state.bufferFilter === "relay") filtered = relayMsgs;

    if (filtered.length === 0) {
        let emptyLabel = "No incoming messages addressed to this device.";
        if (state.bufferFilter === "sent") emptyLabel = "No messages sent from this device yet.";
        else if (state.bufferFilter === "relay") emptyLabel = "No relay messages currently stored in transit.";
        list.innerHTML = `
            <div class="empty-state">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                <span>${emptyLabel}</span>
            </div>`;
        return;
    }

    list.innerHTML = filtered.map(m => {
        const isMine = m.sourceId === myId;
        const isForMe = m.destinationId === myId;
        const isBroadcast = m.destinationId === "BROADCAST";
        const pClass = m.priority === "HIGH" ? "badge-high" : (m.priority === "MEDIUM" ? "badge-medium" : "badge-low");
        const remainingSec = Math.max(0, m.remainingTTL || 0);
        const ttlMin = Math.round(remainingSec / 60);

        let roleBadge = "";
        if (isMine) roleBadge = `<span class="badge" style="background: rgba(37, 99, 235, 0.18); color: var(--accent-cyan); font-size: 0.68rem;">Sent</span>`;
        else if (isForMe) roleBadge = `<span class="badge" style="background: rgba(255, 255, 255, 0.12); color: var(--text-primary); font-size: 0.68rem;">Inbox</span>`;
        else if (isBroadcast) roleBadge = `<span class="badge" style="background: rgba(96, 165, 250, 0.18); color: var(--accent-cyan); font-size: 0.68rem;">Broadcast</span>`;
        else roleBadge = `<span class="badge" style="background: rgba(255, 255, 255, 0.08); color: var(--text-secondary); font-size: 0.68rem;">Relay</span>`;

        let ttlColor = "var(--accent-cyan)";
        if (remainingSec < 300) {
            ttlColor = "var(--accent-red)";
        } else if (remainingSec < 900) {
            ttlColor = "var(--accent-cyan)";
        }

        return `
            <div class="message-card" onclick="toggleMessageCard(this)">
                <div class="message-header">
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span class="msg-id">${escapeHtml(m.messageId)}</span>
                        <span class="msg-path">${escapeHtml(m.sourceId)} ➔ ${escapeHtml(m.destinationId)}</span>
                        ${roleBadge}
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="badge ${pClass}">${escapeHtml(m.priority)}</span>
                        <span class="msg-toggle-hint">Details ▼</span>
                    </div>
                </div>
                <div class="msg-details">
                    <div class="msg-payload">${escapeHtml(m.payload)}</div>
                    <div class="msg-footer">
                        <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
                            <span>Tokens: <strong class="text-accent font-mono">L=${m.copyTokens !== undefined ? m.copyTokens : 4}</strong></span>
                            <span>Expires in: <strong>${ttlMin}m</strong></span>
                        </div>
                        <div class="ttl-bar-wrapper">
                            <div class="ttl-bar" style="width: ${Math.min(100, Math.max(5, (remainingSec / 3600) * 100))}%; background: ${ttlColor};"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join("");
}

// --------------------------------------------------------------------------
// SQLite Event Logs
// --------------------------------------------------------------------------
function renderEventsLog() {
    const stream = document.getElementById("logsStream");
    if (!stream) return;

    if (!state.events || state.events.length === 0) {
        stream.innerHTML = `<div>No events logged yet.</div>`;
        return;
    }

    stream.innerHTML = state.events.slice(0, 20).map(e => {
        const time = (e.timestamp || "").split("T")[1] || e.timestamp;
        let eventColor = "var(--accent-cyan)";
        if (e.eventType.includes("DELIVERED") || e.eventType.includes("SUCCESS")) {
            eventColor = "var(--text-primary)";
        } else if (e.eventType.includes("ERROR") || e.eventType.includes("DROPPED") || e.eventType.includes("EXPIRED")) {
            eventColor = "var(--accent-red)";
        }

        return `<div>
            <span class="text-muted">[${escapeHtml(time)}]</span>
            <strong style="color: ${eventColor};">${escapeHtml(e.eventType)}</strong>:
            Peer=${escapeHtml(e.peerId || '')}
            Msg=${escapeHtml(e.messageId || '-')}
            Remote=${escapeHtml(e.remotePeerId || '-')}
        </div>`;
    }).join("");
}

// --------------------------------------------------------------------------
// Compose & Submit
// --------------------------------------------------------------------------
async function submitMessage() {
    const srcInput = document.getElementById("composeSource");
    const source = (srcInput && srcInput.value.trim()) || state.activeNodeId || "LAPTOP_WIN";
    const dest = document.getElementById("composeDest").value.trim();
    const priority = document.getElementById("composePriority").value;
    const ttlSeconds = parseInt(document.getElementById("composeTtl").value);
    const tokensInput = document.getElementById("composeTokens");
    const copyTokens = tokensInput ? (parseInt(tokensInput.value) || 4) : 4;
    const payload = document.getElementById("composePayload").value.trim();

    if (!dest) {
        showToast("Please enter a destination peer ID", "warning");
        return;
    }
    if (!payload) {
        showToast("Please enter a message", "warning");
        return;
    }

    try {
        const headers = { "Content-Type": "application/json" };
        if (state.apiToken) headers["X-CampusMesh-Token"] = state.apiToken;

        const response = await fetch(`${API_BASE}/api/messages`, {
            method: "POST",
            headers,
            body: JSON.stringify({ sourceId: source, destinationId: dest, priority, ttlSeconds, copyTokens, payload })
        });
        const res = await response.json();

        if (response.ok && res.success) {
            showToast(`Message sent to ${dest}`, "success");
            triggerPacketAnimation(source, dest);
            document.getElementById("composePayload").value = "";
            fetchData();
        } else {
            showToast(res.message || "Error creating message", "danger");
        }
    } catch (err) {
        showToast("Error creating message: " + err.message, "danger");
    }
}

// --------------------------------------------------------------------------
// Canvas Radar Visualization (Black, White & Blue Minimalist)
// --------------------------------------------------------------------------
let canvas, ctx;
let radarAngle = 0;
let animFrameId;

function initCanvas() {
    canvas = document.getElementById("meshCanvas");
    if (!canvas) return;
    ctx = canvas.getContext("2d");

    function renderLoop() {
        drawRadar();
        animFrameId = requestAnimationFrame(renderLoop);
    }
    renderLoop();

    canvas.addEventListener("mousemove", onCanvasMouseMove);
    canvas.addEventListener("mouseleave", () => {
        state.hoveredNode = null;
        canvas.style.cursor = "default";
    });
}

function onCanvasMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    let found = null;
    for (const id in nodes) {
        const n = nodes[id];
        const dist = Math.hypot(n.x - mouseX, n.y - mouseY);
        if (dist <= 26) {
            found = n;
            break;
        }
    }
    state.hoveredNode = found;
    canvas.style.cursor = found ? "pointer" : "default";
}

function drawRadar() {
    if (!ctx) return;
    const isLight = document.body.classList.contains("light-theme");
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Radar Background Rings (Subtle Monochrome)
    ctx.save();
    ctx.strokeStyle = isLight ? "rgba(0, 0, 0, 0.08)" : "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;
    [55, 115, 175, 235].forEach(r => {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.stroke();
    });

    // 2. Crosshair Grid
    ctx.strokeStyle = isLight ? "rgba(0, 0, 0, 0.05)" : "rgba(255, 255, 255, 0.04)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx - 235, cy);
    ctx.lineTo(cx + 235, cy);
    ctx.moveTo(cx, cy - 235);
    ctx.lineTo(cx, cy + 235);
    ctx.stroke();
    ctx.restore();

    // 3. Radar Sweep Beam (Clean Blue)
    radarAngle += 0.015;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, 235, radarAngle, radarAngle + 0.38);
    ctx.closePath();
    const beamGradient = ctx.createRadialGradient(cx, cy, 10, cx, cy, 235);
    beamGradient.addColorStop(0, "rgba(37, 99, 235, 0.22)");
    beamGradient.addColorStop(1, "rgba(37, 99, 235, 0)");
    ctx.fillStyle = beamGradient;
    ctx.fill();
    ctx.restore();

    // 4. Count Online Remote Peers
    const localId = state.activeNodeId || state.localPeer.id || "LAPTOP_WIN";
    const onlinePeerKeys = Object.keys(nodes).filter(k => k !== localId);

    if (onlinePeerKeys.length === 0) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = "600 11px " + getComputedStyle(document.body).fontFamily;
        ctx.fillStyle = isLight ? "#737373" : "#a3a3a3";
        ctx.fillText("SCANNING FOR MESH PEERS...", cx, cy + 72);

        ctx.font = "9px " + getComputedStyle(document.body).fontFamily;
        ctx.fillStyle = isLight ? "#a3a3a3" : "#737373";
        ctx.fillText("0 remote peers online • Wi-Fi active", cx, cy + 86);
        ctx.restore();
    }

    // 5. Draw Dynamic Links (Clean Blue)
    links.forEach(link => {
        const from = nodes[link.from];
        const to = nodes[link.to];
        if (!from || !to) return;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);

        if (link.inContact) {
            ctx.save();
            ctx.strokeStyle = "rgba(37, 99, 235, 0.4)";
            ctx.lineWidth = 5;
            ctx.stroke();
            ctx.restore();
        }

        ctx.strokeStyle = "rgba(59, 130, 246, 0.55)";
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    });

    // 6. Draw Animated Packet Pulses (Electric Blue)
    for (let i = state.animPackets.length - 1; i >= 0; i--) {
        const pkt = state.animPackets[i];
        pkt.progress += 0.025;
        if (pkt.progress >= 1.0) {
            state.animPackets.splice(i, 1);
            continue;
        }
        const curX = pkt.startX + (pkt.endX - pkt.startX) * pkt.progress;
        const curY = pkt.startY + (pkt.endY - pkt.startY) * pkt.progress;

        ctx.save();
        ctx.fillStyle = "#3b82f6";
        ctx.shadowColor = "#3b82f6";
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(curX, curY, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();
    }

    // 7. Draw Nodes (Black, White & Blue Minimalist)
    for (const id in nodes) {
        const n = nodes[id];
        const isHovered = (state.hoveredNode && state.hoveredNode.id === n.id);

        let baseColor = "#3b82f6";
        if (n.isLocal) baseColor = "#ffffff";

        ctx.save();
        if (n.inContact) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, 25, 0, 2 * Math.PI);
            ctx.fillStyle = "rgba(37, 99, 235, 0.22)";
            ctx.fill();
        }

        if (isHovered) {
            ctx.shadowColor = "#3b82f6";
            ctx.shadowBlur = 16;
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, 18, 0, 2 * Math.PI);
        ctx.fillStyle = isLight ? "#ffffff" : "#0a0a0a";
        ctx.fill();
        ctx.lineWidth = isHovered ? 3 : 2;
        ctx.strokeStyle = baseColor;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(n.x, n.y, 6, 0, 2 * Math.PI);
        ctx.fillStyle = baseColor;
        ctx.fill();

        ctx.font = "600 10px " + getComputedStyle(document.body).fontFamily;
        ctx.fillStyle = isLight ? "#000000" : "#ffffff";
        ctx.textAlign = "center";
        const shortName = n.id.length > 15 ? n.id.substring(0, 14) + "…" : n.id;
        ctx.fillText(shortName, n.x, n.y + 32);

        if (n.isLocal) {
            ctx.font = "9px " + getComputedStyle(document.body).fontFamily;
            ctx.fillStyle = "#3b82f6";
            ctx.fillText("(YOU)", n.x, n.y + 44);
        }

        ctx.restore();
    }
}

function triggerPacketAnimation(srcId, destId) {
    const srcNode = nodes[srcId];
    let destNode = nodes[destId];

    if (!srcNode) return;
    if (!destNode) {
        const otherKeys = Object.keys(nodes).filter(k => k !== srcId);
        if (otherKeys.length > 0) {
            destNode = nodes[otherKeys[0]];
        } else {
            return;
        }
    }

    state.animPackets.push({
        startX: srcNode.x,
        startY: srcNode.y,
        endX: destNode.x,
        endY: destNode.y,
        progress: 0
    });
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------
function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type === 'danger' ? 'text-danger' : ''}`;
    toast.innerHTML = `<span class="toast-dot ${type}"></span> <span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add("toast-closing");
        setTimeout(() => toast.remove(), 250);
    }, 3400);
}

function escapeHtml(text) {
    if (!text) return "";
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
