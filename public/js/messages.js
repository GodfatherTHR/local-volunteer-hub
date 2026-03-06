import { supabase } from './supabase-client.js';

let currentUser = null;
let currentPartnerId = null;
let realtimeChannel = null;

const scrollToBottom = () => {
    const container = document.getElementById('messages-list');
    if (container) {
        // Use requestAnimationFrame for smoothness, then setTimeout for DOM update certainty
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
            setTimeout(() => {
                container.scrollTop = container.scrollHeight;
            }, 50);
        });
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Auth Check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        window.location.href = 'login.html';
        return;
    }
    currentUser = user;

    // 2. Parse URL Query for Partner (e.g., ?recipient_id=UID&name=OrgName)
    const urlParams = new URLSearchParams(window.location.search);
    const recipientId = urlParams.get('recipient_id');
    const recipientName = urlParams.get('name');

    // 3. Load Conversations
    await loadConversations(recipientId, recipientName);

    // 4. Input Listener
    document.getElementById('message-form').addEventListener('submit', sendMessage);

    // 5. Subscribe to ALL incoming messages for sidebar updates
    subscribeToIncomingMessages();

    // Auto-focus input if starting chat
    if (recipientId) {
        document.getElementById('message-input').focus();
    }
});

// ─── REALTIME SUBSCRIPTION ─────────────────────────────────────────────────

/**
 * Subscribes to all new messages where current user is the recipient.
 * Updates the conversation sidebar bubble/preview in real time.
 */
function subscribeToIncomingMessages() {
    supabase
        .channel('inbox-listener')
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `recipient_id=eq.${currentUser.id}`
            },
            (payload) => {
                const newMsg = payload.new;

                // If the open chat is already subscribed via subscribeToCurrentChat,
                // do NOT append here — that would cause duplicates.
                // Only handle sidebar update + toast for OTHER conversations.
                if (newMsg.sender_id === currentPartnerId) {
                    // The per-chat channel handles rendering; just update sidebar preview
                    updateSidebarPreview(newMsg.sender_id, newMsg.body, false);
                } else {
                    // Message from a different conversation → show unread indicator + toast
                    updateSidebarPreview(newMsg.sender_id, newMsg.body, true);
                    showNewMessageToast(newMsg);
                }
            }
        )
        .subscribe();
}

/**
 * Subscribes to messages in the currently open conversation for both sides.
 * This ensures sent messages from other sessions/tabs also appear.
 */
function subscribeToCurrentChat(partnerId) {
    // Unsubscribe from any previous chat channel
    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }

    realtimeChannel = supabase
        .channel(`chat-${currentUser.id}-${partnerId}`)
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `sender_id=eq.${partnerId}`
            },
            (payload) => {
                const newMsg = payload.new;
                // Only render if it's part of THIS conversation
                if (
                    (newMsg.sender_id === partnerId && newMsg.recipient_id === currentUser.id) ||
                    (newMsg.sender_id === currentUser.id && newMsg.recipient_id === partnerId)
                ) {
                    appendMessageBubble(newMsg, newMsg.sender_id === currentUser.id);
                    scrollToBottom();
                    // Auto-mark as read
                    if (newMsg.recipient_id === currentUser.id) {
                        supabase.from('messages').update({ is_read: true }).eq('id', newMsg.id);
                    }
                }
            }
        )
        .subscribe();
}

// ─── UI HELPERS ────────────────────────────────────────────────────────────

/**
 * Appends a single message bubble to the chat container without re-rendering all.
 */
function appendMessageBubble(msg, isMe) {
    const chatContainer = document.getElementById('messages-list');

    // Remove the "Pick up where you left off" empty state if present
    const emptyState = chatContainer.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const time = formatDhakaTime(msg.created_at);
    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${isMe ? 'msg-sent' : 'msg-received'}`;
    bubble.id = msg.id;
    bubble.innerHTML = `
        ${escapeHtml(msg.body)}
        <span class="msg-meta">
            ${time}
        </span>
    `;
    chatContainer.appendChild(bubble);
    scrollToBottom();
}

/**
 * Updates the sidebar conversation preview for a given partner.
 */
function updateSidebarPreview(partnerId, lastMessage) {
    const item = document.getElementById(`user-${partnerId}`);
    if (!item) {
        loadConversations();
        return;
    }

    const previewEl = item.querySelector('.user-info p');
    if (previewEl) previewEl.textContent = lastMessage;
}

/**
 * Shows a non-intrusive toast notification for new messages.
 */
function showNewMessageToast(msg) {
    const existing = document.getElementById('msg-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'msg-toast';
    toast.style.cssText = `
        position: fixed; bottom: 2rem; right: 2rem; z-index: 9999;
        background: rgba(15, 23, 42, 0.9); backdrop-filter: blur(12px);
        border: 1px solid var(--primary); border-radius: var(--radius-lg); padding: 1rem 1.25rem;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5); display: flex; align-items: center; gap: 1rem;
        animation: toastSlideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1); max-width: 320px; cursor: pointer;
    `;
    toast.innerHTML = `
        <div class="user-avatar" style="width:40px;height:40px;font-size:1rem;">💬</div>
        <div style="flex:1; min-width:0;">
            <div style="font-weight:700;font-size:0.9rem;color:white">New Message</div>
            <div style="font-size:0.8rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(msg.body)}</div>
        </div>
    `;
    toast.onclick = () => {
        openChat(msg.sender_id, document.querySelector(`#user-${msg.sender_id} h4`)?.textContent || 'User');
        toast.remove();
    };
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function parseUTC(ts) {
    if (!ts) return new Date();
    if (ts.endsWith('Z') || ts.includes('+')) return new Date(ts);
    return new Date(ts + 'Z');
}

function formatDhakaTime(ts) {
    return parseUTC(ts).toLocaleTimeString('en-BD', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Dhaka'
    });
}

// ─── CORE FUNCTIONS ────────────────────────────────────────────────────────

async function loadConversations(targetId = null, targetName = null) {
    const list = document.getElementById('conversations-list');
    list.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-muted);">Loading conversations...</div>';

    const { data: messages, error } = await supabase
        .from('messages')
        .select(`
            *,
            sender:sender_id(full_name, email),
            recipient:recipient_id(full_name, email)
        `)
        .or(`sender_id.eq.${currentUser.id},recipient_id.eq.${currentUser.id}`)
        .order('created_at', { ascending: false });

    if (error) {
        list.innerHTML = '<div style="padding: 2rem; color: #ef4444; text-align:center;">Error loading chats.</div>';
        return;
    }

    const partnersMap = new Map();
    messages.forEach(msg => {
        const isMeSender = msg.sender_id === currentUser.id;
        const partnerId = isMeSender ? msg.recipient_id : msg.sender_id;
        const partnerData = isMeSender ? msg.recipient : msg.sender;

        if (!partnerData) return;

        if (!partnersMap.has(partnerId)) {
            partnersMap.set(partnerId, {
                id: partnerId,
                name: partnerData.full_name || partnerData.email || 'Unknown User',
                lastMessage: msg.body,
                timestamp: msg.created_at,
                unread: !msg.is_read && !isMeSender
            });
        }
    });

    if (targetId && !partnersMap.has(targetId)) {
        partnersMap.set(targetId, {
            id: targetId,
            name: targetName || 'New Chat',
            lastMessage: 'Start a new conversation',
            timestamp: new Date().toISOString(),
            unread: false
        });
    }

    const partners = Array.from(partnersMap.values())
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (partners.length === 0) {
        list.innerHTML = '<div style="padding: 3rem; text-align: center; color: var(--text-muted); opacity: 0.6;"><h3>No messages yet</h3><p>Your chat history will appear here.</p></div>';
    } else {
        list.innerHTML = partners.map(p => `
            <div class="user-item ${p.id === targetId ? 'active' : ''}" onclick="openChat('${p.id}', '${escapeHtml(p.name)}')" id="user-${p.id}">
                <div class="user-avatar">${p.name.charAt(0).toUpperCase()}</div>
                <div class="user-info">
                    <h4 style="color: ${p.unread ? 'var(--primary)' : 'white'}; font-weight: ${p.unread ? '700' : '500'}">${escapeHtml(p.name)}</h4>
                    <p>${escapeHtml(p.lastMessage)}</p>
                </div>
                ${p.unread ? '<div style="width:8px;height:8px;background:var(--primary);border-radius:50%;box-shadow: 0 0 8px var(--primary);"></div>' : ''}
            </div>
        `).join('');
    }

    if (targetId) openChat(targetId, targetName || partnersMap.get(targetId)?.name);
}

window.openChat = async (partnerId, partnerName) => {
    currentPartnerId = partnerId;

    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`user-${partnerId}`)?.classList.add('active');

    const headerName = document.getElementById('chat-header-name');
    const headerAvatar = document.getElementById('chat-header-avatar');
    headerName.textContent = partnerName;
    headerAvatar.style.display = 'flex';
    headerAvatar.textContent = (partnerName || 'U').charAt(0).toUpperCase();

    document.getElementById('message-input').disabled = false;
    document.getElementById('send-btn').disabled = false;

    await loadMessages(partnerId);
    subscribeToCurrentChat(partnerId);
};

async function loadMessages(partnerId) {
    const chatContainer = document.getElementById('messages-list');
    chatContainer.innerHTML = '<div style="text-align:center;padding:3rem;"><div class="spinner"></div></div>';

    const { data: messages, error } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.eq.${currentUser.id},recipient_id.eq.${partnerId}),and(sender_id.eq.${partnerId},recipient_id.eq.${currentUser.id})`)
        .order('created_at', { ascending: true });

    if (error) {
        chatContainer.innerHTML = '<div style="text-align:center;color:#ef4444;padding:2rem;">Failed to load messages</div>';
        return;
    }

    if (!messages || messages.length === 0) {
        chatContainer.innerHTML = `
            <div class="empty-state">
                <div style="font-size: 3rem; margin-bottom: 1rem;">👋</div>
                <h3 style="color: white;">Say Hello!</h3>
                <p>Start your conversation with ${document.getElementById('chat-header-name').textContent}</p>
            </div>`;
        return;
    }

    renderMessages(messages, chatContainer);
    scrollToBottom();

    const unreadIds = messages.filter(m => m.recipient_id === currentUser.id && !m.is_read).map(m => m.id);
    if (unreadIds.length > 0) {
        await supabase.from('messages').update({ is_read: true }).in('id', unreadIds);
    }
}

function renderMessages(messages, container) {
    container.innerHTML = messages.map(msg => {
        const isMe = msg.sender_id === currentUser.id;
        const time = formatDhakaTime(msg.created_at);
        return `
            <div class="message-bubble ${isMe ? 'msg-sent' : 'msg-received'}" id="${msg.id}">
                ${escapeHtml(msg.body)}
                <span class="msg-meta">
                    ${time}
                </span>
            </div>
        `;
    }).join('');
}

async function sendMessage(e) {
    e.preventDefault();
    if (!currentPartnerId) return;

    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;

    const chatContainer = document.getElementById('messages-list');
    const emptyState = chatContainer.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const time = formatDhakaTime(new Date().toISOString());
    const tempId = 'temp-' + Date.now();
    const tempBubble = document.createElement('div');
    tempBubble.className = 'message-bubble msg-sent';
    tempBubble.style.opacity = '0.7';
    tempBubble.innerHTML = `${escapeHtml(text)} <span class="msg-meta">${time} · sending...</span>`;
    chatContainer.appendChild(tempBubble);
    scrollToBottom();
    input.value = '';

    const { data, error } = await supabase
        .from('messages')
        .insert([{
            sender_id: currentUser.id,
            recipient_id: currentPartnerId,
            body: text,
            is_read: false
        }])
        .select()
        .single();

    if (error) {
        tempBubble.classList.add('error');
        tempBubble.querySelector('.msg-meta').textContent = 'Failed to send';
        input.value = text;
    } else {
        tempBubble.style.opacity = '1';
        tempBubble.id = data.id;
        tempBubble.querySelector('.msg-meta').textContent = time;
        updateSidebarPreview(currentPartnerId, text);
    }
}
