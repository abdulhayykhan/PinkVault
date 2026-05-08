/**
 * PinkVault Chat Client
 *
 * This script implements a minimal, vanilla-JS WebSocket client for the
 * PinkVault application. It handles user bootstrap, AES message
 * encryption/decryption (CryptoJS), a resilient WebSocket connection with
 * exponential backoff, and rendering of messages received from the server.
 *
 * SECURITY: Do not keep production symmetric keys in source. Use a secure
 * key provisioning mechanism for production deployments.
 */

// ============================================================================
// Configuration
// ============================================================================
let SYMMETRIC_KEY = null; // Initialized at runtime from hash or prompt
let currentUser = "";

// ============================================================================
// State Management
// ============================================================================
let ws = null;
let reconnectAttempt = 0;
let maxReconnectDelay = 30000; // 30 seconds
let isConnected = false;
let reconnectTimerId = null;
let activeMessageId = null;
let touchPressTimerId = null;
// Track last tap for double-tap (300ms) detection
let lastTapTimestamp = 0;
let lastTapMessageId = null;

// ============================================================================
// Encryption Functions
// ============================================================================

/**
 * Initialize the symmetric key from URL hash or user prompt.
 *
 * Checks for `#key=...` in the URL hash. If found, uses that key and clears
 * the hash from the address bar for security. If not found, prompts the user.
 * Throws an error if the user cancels the prompt.
 *
 * @returns {void}
 * @throws {Error} If the user cancels the key prompt or no key is provided.
 */
function setupUser() {
    const storageKey = "username";
    const storedUser = localStorage.getItem(storageKey);
    const normalizedStoredUser = storedUser ? storedUser.trim() : "";

    if (normalizedStoredUser.length > 0) {
        currentUser = normalizedStoredUser.toLowerCase();
        return currentUser;
    }

    return null;
}

/**
 * Encrypt plain text for transport over the WebSocket.
 *
 * @param {string} text The message text to encrypt.
 * @returns {string} The AES ciphertext string.
 */
function encryptMessage(text) {
    try {
        return CryptoJS.AES.encrypt(text, SYMMETRIC_KEY).toString();
    } catch (error) {
        console.error("Encryption error:", error);
        return "";
    }
}

/**
 * Decrypt AES ciphertext from the server or local history.
 *
 * @param {string} ciphertext The encrypted payload to decrypt.
 * @returns {string} The plaintext message, or a fallback error string.
 */
function decryptMessage(ciphertext) {
    try {
        if (!ciphertext || ciphertext.trim().length === 0) {
            console.warn("decryptMessage: empty ciphertext received");
            return "[Empty message]";
        }

        // Log input for debugging
        console.log("[DEBUG] Decrypting ciphertext length:", ciphertext.length);
        console.log("[DEBUG] Using SYMMETRIC_KEY:", SYMMETRIC_KEY.substring(0, 10) + "...");

        const decrypted = CryptoJS.AES.decrypt(ciphertext, SYMMETRIC_KEY);
        const plaintext = decrypted.toString(CryptoJS.enc.Utf8);

        if (!plaintext || plaintext.trim().length === 0) {
            console.error("[DEBUG] Decryption produced empty plaintext. Key mismatch suspected.");
            return "[Decryption Error: Check Key]";
        }

        console.log("[DEBUG] Decryption successful. Plaintext length:", plaintext.length);
        return plaintext;
    } catch (error) {
        console.error("[DEBUG] Decryption exception:", error);
        console.error("[DEBUG] Ciphertext was:", ciphertext.substring(0, 50) + "...");
        return "[Decryption Error: Check Key]";
    }
}

/**
 * Build the WebSocket URL using the current page protocol and host.
 *
 * @returns {string} The absolute WebSocket endpoint URL.
 */
function buildWebSocketUrl() {
    const protocol = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + globalThis.location.host + '/ws';
    return wsUrl;
}

// ============================================================================
// WebSocket Connection & Reconnection
// ============================================================================

/**
 * Establish a WebSocket connection with dynamic protocol and host.
 *
 * The active username is sent as the first frame so the backend can validate
 * the connection before accepting chat traffic.
 *
 * @returns {void}
 */
function connect() {
    if (!currentUser) {
        const u = setupUser();
        if (!u) {
            console.error('[ERROR] Cannot connect: username not set');
            return;
        }
    }

    const protocol = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + globalThis.location.host + '/ws';

    try {
        ws = new WebSocket(wsUrl);

        ws.onopen = handleWebSocketOpen;
        ws.onmessage = handleWebSocketMessage;
        ws.onerror = handleWebSocketError;
        ws.onclose = handleWebSocketClose;
    } catch (error) {
        console.error("Failed to create WebSocket:", error);
        scheduleReconnect();
    }
}

/**
 * Handle the WebSocket open event and send the username first.
 *
 * @returns {void}
 */
function handleWebSocketOpen() {
    console.log("WebSocket connected");
    isConnected = true;
    reconnectAttempt = 0;
    updateConnectionStatus(true);

    if (ws !== null && ws.readyState === WebSocket.OPEN) {
        ws.send(currentUser);
    }
}

/**
 * Handle incoming WebSocket messages from the backend.
 *
 * Pings are ignored; all other payloads are decrypted and rendered.
 *
 * @param {MessageEvent<string>} event The WebSocket message event.
 * @returns {void}
 */
function handleWebSocketMessage(event) {
    try {
        const data = JSON.parse(event.data);
        console.log("[WS RECV]", data);

        if (data.type === "ping") {
            return;
        }

        if (data.type === "like") {
            const bubble = document.querySelector(`.message-bubble[data-id="${data.message_id}"]`);
            if (!bubble) {
                console.error('Bubble not found for ID:', data.message_id);
                return;
            }

            const emojis = Object.values(data.reactions || {}).join('');
            let badge = bubble.querySelector('.reaction-badge');

            if (!emojis) {
                if (badge) {
                    badge.remove();
                }
                return;
            }

            if (!badge) {
                badge = document.createElement('div');
                badge.className = 'reaction-badge';
                bubble.appendChild(badge);
            }

            badge.textContent = emojis;
            return;
        }

        const sender = data.sender || "unknown";
        const encryptedText = data.text || "";
        const messageId = data.id;
        const reactions = data.reactions || {};

        console.log("[DEBUG] WebSocket message received - sender:", sender, "encrypted length:", encryptedText.length);

        const decryptedText = decryptMessage(encryptedText);

        console.log("[DEBUG] Decrypted to:", decryptedText.substring(0, 50));

        renderMessage({
            id: messageId,
            sender,
            text: decryptedText,
            reactions,
        });
        scrollToBottom();
    } catch (error) {
        console.error("Error handling message:", error);
    }
}

/**
 * Handle WebSocket errors by updating the connection state.
 *
 * @param {Event} error The WebSocket error event.
 * @returns {void}
 */
function handleWebSocketError(error) {
    console.error("WebSocket error:", error);
    isConnected = false;
    updateConnectionStatus(false);
}

/**
 * Handle socket closure and decide whether to reconnect or re-prompt.
 *
 * @param {CloseEvent} event The WebSocket close event.
 * @returns {void}
 */
function handleWebSocketClose(event) {
    console.log("WebSocket disconnected");
    isConnected = false;
    updateConnectionStatus(false);

    if (event.code === 4403) {
        localStorage.removeItem("username");
        currentUser = setupUser();
        reconnectAttempt = 0;
        connect();
        return;
    }

    scheduleReconnect();
}

/**
 * Schedule a reconnection attempt with exponential backoff.
 *
 * The delay starts at one second and doubles until the 30 second ceiling.
 *
 * @returns {void}
 */
function scheduleReconnect() {
    if (reconnectTimerId !== null) {
        clearTimeout(reconnectTimerId);
    }

    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), maxReconnectDelay);
    reconnectAttempt++;

    console.log(`Reconnecting in ${delay}ms...`);
    reconnectTimerId = setTimeout(() => {
        connect();
    }, delay);
}

/**
 * Update the connection status indicator in the UI.
 *
 * @param {boolean} connected Whether the connection is active.
 * @returns {void}
 */
function updateConnectionStatus(connected) {
    const statusEl = document.getElementById("connectionStatus");
    if (!statusEl) return;

    if (connected) {
        statusEl.textContent = "Online";
        statusEl.classList.add("online");
    } else {
        statusEl.textContent = "Connecting...";
        statusEl.classList.remove("online");
    }
}

// ============================================================================
// DOM Interaction & Rendering
// ============================================================================

/**
 * Format a message by escaping HTML and converting URLs to clickable links.
 *
 * @param {string} text The raw message text.
 * @returns {string} HTML-safe formatted text with clickable links.
 */
function formatMessage(text) {
    if (!text || typeof text !== 'string') return '';

    // Escape HTML to prevent XSS
    let escaped = text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');

    // Convert URLs to clickable links using regex matches.
    const urlRegex = /(https?:\/\/[^\s<>"]+)/g;
    let formatted = "";
    let lastIndex = 0;

    for (const match of escaped.matchAll(urlRegex)) {
        const url = match[0];
        const matchIndex = match.index ?? 0;
        formatted += escaped.slice(lastIndex, matchIndex);
        formatted += `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        lastIndex = matchIndex + url.length;
    }

    formatted += escaped.slice(lastIndex);
    return formatted;
}

/**
 * Render or clear the reaction badge inside a message bubble.
 *
 * @param {HTMLElement} bubbleDiv The bubble element to update.
 * @param {Record<string, string>} reactions The reactions map for the message.
 * @returns {void}
 */
function syncReactionBadge(bubbleDiv, reactions) {
    const existingBadge = bubbleDiv.querySelector(".reaction-badge");
    const reactionValues = reactions && typeof reactions === "object" ? Object.values(reactions) : [];
    const primaryReaction = reactionValues.length > 0 ? reactionValues[0] : "";
    const hasReactions = primaryReaction.length > 0;

    if (!hasReactions) {
        if (existingBadge) {
            existingBadge.remove();
        }
        return;
    }

    if (existingBadge) {
        existingBadge.textContent = primaryReaction;
        return;
    }

    const badge = document.createElement("span");
    badge.className = "reaction-badge";
    badge.textContent = primaryReaction;
    bubbleDiv.appendChild(badge);
}

/**
 * Update a rendered message bubble's reaction badge in place.
 *
 * @param {number|string} messageId The message id from Supabase.
 * @param {Record<string, string>} reactions The updated reactions map.
 * @returns {void}
 */
function updateReactionBadge(messageId, reactions) {
    if (messageId === undefined || messageId === null) {
        return;
    }

    const bubbleDiv = document.querySelector(`[data-id="${messageId}"]`);
    if (!bubbleDiv) {
        return;
    }

    bubbleDiv.dataset.reactions = JSON.stringify(reactions || {});
    syncReactionBadge(bubbleDiv, reactions || {});
}

/**
 * Send a like reaction for a specific message id.
 *
 * @param {number|string} messageId The message id to react to.
 * @returns {void}
 */
function sendLikeReaction(messageId) {
    sendReaction(messageId, "❤️");
}

/**
 * Send an emoji reaction for a specific message id.
 *
 * @param {number|string} messageId The message id to react to.
 * @param {string} emoji The emoji to send.
 * @returns {void}
 */
function sendReaction(messageId, emoji) {
    const numericMessageId = Number(messageId);
    if (ws?.readyState !== WebSocket.OPEN || Number.isNaN(numericMessageId)) {
        return;
    }

    ws.send(JSON.stringify({
        type: "like",
        message_id: numericMessageId,
        sender: currentUser,
        emoji: emoji || "❤️",
    }));
}

/**
 * Hide the emoji picker.
 *
 * @returns {void}
 */
function hideEmojiPicker() {
    const picker = document.getElementById("emoji-picker");
    if (!picker) {
        return;
    }

    picker.classList.remove("visible");
    picker.classList.add("hidden");
    activeMessageId = null;
}

/**
 * Show the emoji picker near the pointer or touch position.
 *
 * @param {number} x The x position.
 * @param {number} y The y position.
 * @param {number|string} messageId The message id to react to.
 * @returns {void}
 */
function showEmojiPicker(x, y, messageId) {
    const picker = document.getElementById("emoji-picker");
    if (!picker) {
        return;
    }

    const pickerWidthEstimate = 280;
    const pickerHeightEstimate = 56;
    const left = Math.max(8, Math.min(x - pickerWidthEstimate / 2, globalThis.innerWidth - pickerWidthEstimate - 8));
    const top = Math.max(8, y - pickerHeightEstimate - 12);

    picker.style.left = `${left}px`;
    picker.style.top = `${top}px`;
    picker.classList.remove("hidden");
    picker.classList.add("visible");
    activeMessageId = messageId;
}

/**
 * Extract the message bubble from an event target.
 *
 * @param {EventTarget | null} target The event target.
 * @returns {HTMLElement | null}
 */
function getMessageBubbleFromTarget(target) {
    if (!(target instanceof HTMLElement)) {
        return null;
    }

    return target.closest(".message-bubble");
}

/**
 * Register the emoji picker interactions.
 *
 * @returns {void}
 */
function bindReactionPickerInteractions() {
    const chatContainer = document.getElementById("chat-container");
    const picker = document.getElementById("emoji-picker");
    if (!chatContainer || !picker) {
        return;
    }

    chatContainer.addEventListener("contextmenu", (event) => {
        const bubbleDiv = getMessageBubbleFromTarget(event.target);
        const messageId = bubbleDiv?.dataset?.id;
        if (!messageId) {
            return;
        }

        event.preventDefault();
        hideEmojiPicker();
        showEmojiPicker(event.clientX, event.clientY, messageId);
    });

    chatContainer.addEventListener("touchstart", (event) => {
        const bubbleDiv = getMessageBubbleFromTarget(event.target);
        const touch = event.touches[0];
        const messageId = bubbleDiv?.dataset?.id;

        if (!messageId || !touch) {
            return;
        }

        clearTimeout(touchPressTimerId);
        touchPressTimerId = globalThis.setTimeout(() => {
            hideEmojiPicker();
            showEmojiPicker(touch.clientX, touch.clientY, messageId);
            try { if (navigator.vibrate) navigator.vibrate(50); } catch(e) {}
        }, 500);
    }, { passive: true });

    chatContainer.addEventListener("touchend", () => {
        clearTimeout(touchPressTimerId);
    });

    chatContainer.addEventListener("touchmove", () => {
        clearTimeout(touchPressTimerId);
    });

    chatContainer.addEventListener("touchcancel", () => {
        clearTimeout(touchPressTimerId);
    });

    // Pointer-based double-tap detector (works for mouse and touch via pointer events).
    // If the same message bubble is tapped twice within 300ms, send a heart like
    // and prevent the long-press emoji picker from appearing.
    chatContainer.addEventListener('pointerup', (event) => {
        const bubbleDiv = getMessageBubbleFromTarget(event.target);
        const messageId = bubbleDiv?.dataset?.id;
        if (!messageId) return;

        const now = Date.now();
        if (lastTapMessageId === messageId && (now - lastTapTimestamp) <= 300) {
            // Double-tap detected
            clearTimeout(touchPressTimerId);
            hideEmojiPicker();
            try {
                sendReaction(messageId, '❤️');
            } catch (e) {
                console.error('Failed to send double-tap reaction', e);
            }
            // Reset last tap tracking to avoid triple-tap triggering
            lastTapTimestamp = 0;
            lastTapMessageId = null;
            event.preventDefault();
            return;
        }

        // Record this tap for potential double-tap
        lastTapTimestamp = now;
        lastTapMessageId = messageId;
    }, { passive: false });

    picker.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement) || target.tagName !== "SPAN") {
            return;
        }

        if (activeMessageId === null) {
            return;
        }

        const selectedEmoji = target.textContent || "❤️";
        sendReaction(activeMessageId, selectedEmoji);
        hideEmojiPicker();
    });

    document.addEventListener("click", (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest("#emoji-picker")) {
            return;
        }

        hideEmojiPicker();
    });
}

/**
 * Render a message bubble in the messages container.
 *
 * @param {object} msg The message payload.
 * @returns {void}
 */
function renderMessage(msg) {
    console.log("[RENDER MSG]", msg);
    const container = document.getElementById("messagesContainer");
    if (!container) return;

    const sender = (msg && msg.sender ? String(msg.sender) : "unknown").toLowerCase();
    const messageId = msg ? msg.id : null;
    const text = msg && typeof msg.text === "string" ? msg.text : "[Invalid message]";
    const reactions = msg && msg.reactions && typeof msg.reactions === "object" ? msg.reactions : {};
    const isSent = sender === currentUser;

    // Validate and clean the text
    const cleanText = text;
    console.log("[DEBUG] renderMessage called - sender:", sender, "text:", cleanText.substring(0, 50));

    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${isSent ? "sent" : "received"}`;

    const bubbleDiv = document.createElement("div");
    bubbleDiv.className = "message-bubble";
    // Always set a data-id attribute so DOM lookups are reliable later
    bubbleDiv.setAttribute('data-id', String(messageId ?? ""));
    bubbleDiv.setAttribute('data-reactions', JSON.stringify(reactions || {}));
    bubbleDiv.innerHTML = formatMessage(cleanText);

    // Apply badge immediately if reactions exist
    if (reactions && typeof reactions === 'object' && Object.keys(reactions).length > 0) {
        const emojis = Object.values(reactions).join('');
        if (emojis) {
            const badge = document.createElement('div');
            badge.className = 'reaction-badge';
            badge.textContent = emojis;
            bubbleDiv.appendChild(badge);
        }
    }

    messageDiv.appendChild(bubbleDiv);

    container.appendChild(messageDiv);
}

/**
 * Automatically scroll the messages container to the bottom.
 *
 * @returns {void}
 */
function scrollToBottom() {
    const container = document.getElementById("messagesContainer");
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

/**
 * Send a message via WebSocket.
 *
 * The plaintext is encrypted client-side before being sent to the backend.
 *
 * @returns {void}
 */
function sendMessage() {
    const input = document.getElementById("messageInput");
    if (input === null) {
        return;
    }

    const messageText = input.value.trim();
    if (messageText.length === 0 || ws === null || ws.readyState !== WebSocket.OPEN) {
        return;
    }

    const encryptedText = encryptMessage(messageText);

    // Send via WebSocket
    const payload = JSON.stringify({
        type: "message",
        sender: currentUser,
        text: encryptedText
    });
    ws.send(payload);

    // Clear input
    input.value = "";
}

/**
 * Fetch chat history from the server and render it.
 *
 * @returns {Promise<void>}
 */
async function loadChatHistory() {
    try {
        const response = await fetch('/history');
        if (!response.ok) {
            console.error("Failed to fetch chat history");
            return;
        }

        const messages = await response.json();
        console.log("[DEBUG] Loaded", messages.length, "messages from history");

        // Render each message
        messages.forEach((msg, index) => {
            const sender = msg.sender || "unknown";
            const encryptedText = msg.encrypted_text || "";

            console.log("[DEBUG] History message", index, ": sender=", sender, "encryptedText length=", encryptedText.length);

            const decryptedText = decryptMessage(encryptedText);

            if (!decryptedText || decryptedText.includes("Error")) {
                console.warn("[DEBUG] Decryption failed for message", index);
            }

            renderMessage({
                id: msg.id,
                sender,
                text: decryptedText,
                reactions: msg.reactions || {},
            });
        });

        // Scroll to bottom after rendering history
        scrollToBottom();
    } catch (error) {
        console.error("Error loading chat history:", error);
    }
}

/**
 * Update the header with the current chat partner.
 *
 * @param {string} username The authenticated username.
 * @returns {void}
 */
function updatePartnerName(username) {
    const partner = username.toLowerCase() === 'abdi' ? 'Alysha' : 'Abdi';
    const partnerNameElement = document.getElementById('partner-name');
    if (partnerNameElement) {
        partnerNameElement.textContent = partner;
    }
}

/**
 * Wire the login controls.
 *
 * @returns {void}
 */
function wireLoginControls() {
    const unlockButton = document.getElementById('unlock-button');
    if (unlockButton) {
        unlockButton.addEventListener('click', handleUnlock);
    }

    const vaultKeyInput = document.getElementById('vault-key-input');
    if (vaultKeyInput) {
        vaultKeyInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleUnlock(e);
            }
        });
    }
}

/**
 * Restore a saved chat session if one exists.
 *
 * @returns {boolean} True when chat was restored, otherwise false.
 */
function restoreSavedSession() {
    const savedKey = sessionStorage.getItem('vaultKey');
    const savedUser = localStorage.getItem('username');

    const loginContainer = document.getElementById('login-container');
    const chatContainer = document.getElementById('chat-container');

    if (savedKey && savedUser) {
        SYMMETRIC_KEY = savedKey;
        currentUser = savedUser.trim().toLowerCase();
        updatePartnerName(currentUser);

        if (loginContainer) loginContainer.style.display = 'none';
        if (chatContainer) chatContainer.style.display = '';

        setupUser();
        loadChatHistory();
        connect();
        return true;
    }

    if (loginContainer) loginContainer.style.display = '';
    if (chatContainer) chatContainer.style.display = 'none';
    return false;
}

/**
 * Wire the composer controls.
 *
 * @returns {void}
 */
function wireComposerControls() {
    const sendButton = document.getElementById('sendButton');
    if (sendButton) {
        sendButton.addEventListener('click', handleSendButtonClick);
    }

    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.addEventListener('keypress', handleMessageInputKeyPress);
    }
}

/**
 * Wire emoji picker interactions.
 *
 * @returns {void}
 */
function wireReactionControls() {
    bindReactionPickerInteractions();
}

// ============================================================================
// Event Listeners & Initialization
// ============================================================================

/**
 * Wire up the application once the DOM is ready.
 *
 * @returns {void}
 */
function initializeApp() {
    wireLoginControls();
    restoreSavedSession();
    wireComposerControls();
    wireReactionControls();
}

/**
 * Handle clicks on the send button.
 *
 * @param {MouseEvent} event The click event.
 * @returns {void}
 */
function handleSendButtonClick(event) {
    event.preventDefault();
    sendMessage();
}

/**
 * Send on Enter keypress without allowing the input to submit a form.
 *
 * @param {KeyboardEvent} event The keyboard event.
 * @returns {void}
 */
function handleMessageInputKeyPress(event) {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

/**
 * Handle Unlock Vault button click: validate inputs, persist username and key,
 * and show the chat UI.
 */
function handleUnlock(event) {
    event.preventDefault();

    const userInput = document.getElementById('username-input');
    const keyInput = document.getElementById('vault-key-input');

    if (!userInput || !keyInput) return;

    const username = userInput.value.trim();
    const key = keyInput.value;

    if (!username) {
        alert('Please enter a username');
        return;
    }
    if (!key) {
        alert('Please enter the Vault Key');
        return;
    }

    // Persist username and key
    localStorage.setItem('username', username);
    sessionStorage.setItem('vaultKey', key);

    SYMMETRIC_KEY = key;
    currentUser = username.toLowerCase();

    updatePartnerName(currentUser);

    // Toggle UI
    const loginContainer = document.getElementById('login-container');
    const chatContainer = document.getElementById('chat-container');
    if (loginContainer) loginContainer.style.display = 'none';
    if (chatContainer) chatContainer.style.display = '';

    setupUser();
    loadChatHistory();
    connect();
}

/**
 * Register the service worker used for the PWA shell.
 *
 * @returns {void}
 */
function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("sw.js")
            .then((registration) => {
                console.log("Service Worker registered:", registration);
            })
            .catch((error) => {
                console.error("Service Worker registration failed:", error);
            });
    }
}

document.addEventListener("DOMContentLoaded", () => {
    initializeApp();
    registerServiceWorker();
});
