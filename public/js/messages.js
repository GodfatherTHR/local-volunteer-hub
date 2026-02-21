import { supabase } from './supabase-client.js';

let currentUser = null;
let currentPartnerId = null;
let realtimeChannel = null; // Track the active realtime channel

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

    // Remove the "No messages yet" placeholder if present
    const placeholder = chatContainer.querySelector('[data-placeholder]');
    if (placeholder) placeholder.remove();

    const time = formatDhakaTime(msg.created_at);
    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${isMe ? 'msg-sent' : 'msg-received'}`;
    bubble.id = msg.id;
    bubble.style.animation = 'msgSlideIn 0.25s ease';
    bubble.innerHTML = `
        ${escapeHtml(msg.body)}
        <span class="msg-time" style="color: ${isMe ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)'}">
            ${time}
        </span>
    `;
    chatContainer.appendChild(bubble);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

/**
 * Updates the sidebar conversation preview for a given partner.
 */
function updateSidebarPreview(partnerId, lastMessage, hasUnread = false) {
    const item = document.getElementById(`user-${partnerId}`);
    if (!item) {
        // New conversation — reload sidebar
        loadConversations();
        return;
    }

    const previewEl = item.querySelector('.user-details p');
    if (previewEl) previewEl.textContent = lastMessage;

    // Add unread dot if not already there
    if (hasUnread && !item.querySelector('.unread-dot')) {
        const dot = document.createElement('div');
        dot.className = 'unread-dot';
        dot.style.cssText = 'width:8px;height:8px;background:var(--primary);border-radius:50%;margin-left:auto;flex-shrink:0;';
        item.appendChild(dot);

        const nameEl = item.querySelector('h4');
        if (nameEl) {
            nameEl.style.fontWeight = '700';
            nameEl.style.color = 'var(--primary)';
        }
    }
}

/**
 * Shows a non-intrusive toast notification for new messages.
 */
function showNewMessageToast(msg) {
    // Remove existing toast if any
    const existing = document.getElementById('msg-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'msg-toast';
    toast.style.cssText = `
        position: fixed; bottom: 2rem; right: 2rem; z-index: 9999;
        background: var(--surface); border: 1px solid var(--primary);
        border-radius: var(--radius-md); padding: 1rem 1.25rem;
        box-shadow: 0 8px 32px rgba(99,102,241,0.3);
        display: flex; align-items: center; gap: 0.75rem;
        animation: toastSlideIn 0.3s ease; max-width: 280px; cursor: pointer;
    `;
    toast.innerHTML = `
        <div style="width:36px;height:36px;background:linear-gradient(135deg,var(--primary),var(--secondary));border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">💬</div>
        <div>
            <div style="font-weight:600;font-size:0.875rem;color:var(--text-main)">New Message</div>
            <div style="font-size:0.8rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;">${escapeHtml(msg.body)}</div>
        </div>
    `;
    toast.onclick = () => {
        openChat(msg.sender_id, document.querySelector(`#user-${msg.sender_id} h4`)?.textContent || 'User');
        toast.remove();
    };
    document.body.appendChild(toast);

    // Auto-dismiss after 4s
    setTimeout(() => toast.remove(), 4000);
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Supabase stores `timestamp without time zone` as UTC but returns it WITHOUT 'Z'.
// Appending 'Z' forces JavaScript to correctly parse it as UTC,
// so the Asia/Dhaka conversion (UTC+6) is accurate.
function parseUTC(ts) {
    if (!ts) return new Date();
    // Already has timezone info (Z or +xx:xx), use as-is
    if (ts.endsWith('Z') || ts.includes('+')) return new Date(ts);
    // No timezone suffix → treat as UTC
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
    list.innerHTML = '<div style="padding: 1.5rem; color: var(--text-muted);">Loading conversations...</div>';

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
        console.error('Error loading messages:', error);
        list.innerHTML = '<div style="padding: 1rem; color: #ef4444;">Error loading chats.</div>';
        return;
    }

    // Process unique partners
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

    // If targetId provided (New Chat), ensure it's in the list
    if (targetId && !partnersMap.has(targetId)) {
        partnersMap.set(targetId, {
            id: targetId,
            name: targetName || 'New Contact',
            lastMessage: 'Start a conversation',
            timestamp: new Date().toISOString(),
            unread: false,
            isNew: true
        });
    }

    const partners = Array.from(partnersMap.values())
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (partners.length === 0) {
        list.innerHTML = '<div style="padding: 1.5rem; color: var(--text-muted);">No conversations yet.</div>';
    } else {
        list.innerHTML = partners.map(p => `
            <div class="user-item ${p.id === targetId ? 'active' : ''}" onclick="openChat('${p.id}', '${escapeHtml(p.name)}')" id="user-${p.id}">
                <div class="user-avatar">${p.name.charAt(0).toUpperCase()}</div>
                <div class="user-details">
                    <h4 style="font-weight: ${p.unread ? '700' : '500'}; color: ${p.unread ? 'var(--primary)' : 'inherit'}">${escapeHtml(p.name)}</h4>
                    <p>${escapeHtml(p.lastMessage)}</p>
                </div>
                ${p.unread ? '<div class="unread-dot" style="width:8px;height:8px;background:var(--primary);border-radius:50%;margin-left:auto;flex-shrink:0;"></div>' : ''}
            </div>
        `).join('');
    }

    // If targetId present, open chat immediately
    if (targetId) {
        openChat(targetId, targetName || partnersMap.get(targetId)?.name);
    }
}

window.openChat = async (partnerId, partnerName) => {
    currentPartnerId = partnerId;

    // UI Updates
    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
    const activeItem = document.getElementById(`user-${partnerId}`);
    if (activeItem) {
        activeItem.classList.add('active');
        // Remove unread dot
        activeItem.querySelector('.unread-dot')?.remove();
        const nameEl = activeItem.querySelector('h4');
        if (nameEl) { nameEl.style.fontWeight = '500'; nameEl.style.color = 'inherit'; }
    }

    const headerName = document.getElementById('chat-header-name');
    const headerAvatar = document.getElementById('chat-header-avatar');
    headerName.textContent = partnerName;
    headerAvatar.style.display = 'flex';
    headerAvatar.textContent = (partnerName || 'U').charAt(0).toUpperCase();

    // Enable Input
    document.getElementById('message-input').disabled = false;
    document.getElementById('send-btn').disabled = false;
    document.getElementById('message-input').focus();

    // Load messages and subscribe to this chat channel
    await loadMessages(partnerId);
    subscribeToCurrentChat(partnerId);
};

async function loadMessages(partnerId) {
    const chatContainer = document.getElementById('messages-list');
    chatContainer.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">Loading...</div>';

    const { data: messages, error } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.eq.${currentUser.id},recipient_id.eq.${partnerId}),and(sender_id.eq.${partnerId},recipient_id.eq.${currentUser.id})`)
        .order('created_at', { ascending: true });

    if (error) {
        console.error(error);
        chatContainer.innerHTML = '<div style="text-align:center;color:#ef4444">Error loading messages</div>';
        return;
    }

    if (!messages || messages.length === 0) {
        chatContainer.innerHTML = '<div data-placeholder="true" style="text-align:center;margin-top:auto;padding:2rem;color:var(--text-muted);opacity:0.7;">No messages yet. Say hello! 👋</div>';
        return;
    }

    renderMessages(messages, chatContainer);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    // Mark as read
    const unreadIds = messages.filter(m => m.recipient_id === currentUser.id && !m.is_read).map(m => m.id);
    if (unreadIds.length > 0) {
        supabase.from('messages').update({ is_read: true }).in('id', unreadIds);
    }
}

function renderMessages(messages, container) {
    container.innerHTML = messages.map(msg => {
        const isMe = msg.sender_id === currentUser.id;
        const time = formatDhakaTime(msg.created_at);
        return `
            <div class="message-bubble ${isMe ? 'msg-sent' : 'msg-received'}" id="${msg.id}">
                ${escapeHtml(msg.body)}
                <span class="msg-time" style="color: ${isMe ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)'}">
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

    // Optimistic UI — append immediately with a temp ID
    const tempId = 'temp-' + Date.now();
    const chatContainer = document.getElementById('messages-list');
    const placeholder = chatContainer.querySelector('[data-placeholder]');
    if (placeholder) placeholder.remove();

    const time = formatDhakaTime(new Date().toISOString());
    const tempBubble = document.createElement('div');
    tempBubble.className = 'message-bubble msg-sent';
    tempBubble.id = tempId;
    tempBubble.style.opacity = '0.6';
    tempBubble.innerHTML = `
        ${escapeHtml(text)}
        <span class="msg-time" style="color:rgba(255,255,255,0.7)">${time} ·sending</span>
    `;
    chatContainer.appendChild(tempBubble);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    input.value = '';

    // Send to DB
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
        console.error('Send error:', error);
        alert('Failed to send message.');
        tempBubble.remove();
        input.value = text;
    } else {
        // Swap temp bubble → confirmed (realtime will NOT duplicate because
        // the subscription only listens to the partner's sender_id, not ours)
        tempBubble.style.opacity = '1';
        tempBubble.id = data.id;
        tempBubble.querySelector('.msg-time').textContent = time;

        // Also update sidebar preview for this contact
        updateSidebarPreview(currentPartnerId, text, false);
    }
}
