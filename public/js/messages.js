import { supabase, signOut } from './supabase-client.js';

let currentUser = null;
let currentPartnerId = null;

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

    // Auto-focus input if starting chat
    if (recipientId) {
        document.getElementById('message-input').focus();
    }
});

async function loadConversations(targetId = null, targetName = null) {
    const list = document.getElementById('conversations-list');
    list.innerHTML = '<div style="padding: 1.5rem; color: var(--text-muted);">Loading conversations...</div>';

    // 1. Fetch all messages involving me
    // (This is inefficient for scale, but standard for simple Supabase client-only apps without backend functions)
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

    // 2. Process unique partners
    const partnersMap = new Map();

    messages.forEach(msg => {
        const isMeSender = msg.sender_id === currentUser.id;
        const partnerId = isMeSender ? msg.recipient_id : msg.sender_id;
        const partnerData = isMeSender ? msg.recipient : msg.sender;

        // If partner is null (e.g. deleted user), skip
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

    // 3. If targetId provided (New Chat), ensure it's in the list
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

    // Convert map to array and sort
    const partners = Array.from(partnersMap.values())
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (partners.length === 0) {
        list.innerHTML = '<div style="padding: 1.5rem; color: var(--text-muted);">No conversations yet.</div>';
    } else {
        list.innerHTML = partners.map(p => `
            <div class="user-item ${p.id === targetId ? 'active' : ''}" onclick="openChat('${p.id}', '${p.name}')" id="user-${p.id}">
                <div class="user-avatar">${p.name.charAt(0)}</div>
                <div class="user-details">
                    <h4 style="font-weight: ${p.unread ? '700' : '500'}; color: ${p.unread ? 'var(--primary)' : 'inherit'}">${p.name}</h4>
                    <p>${p.lastMessage}</p>
                </div>
                ${p.unread ? '<div style="width:8px; height:8px; background:var(--primary); border-radius:50%; margin-left:auto;"></div>' : ''}
            </div>
        `).join('');
    }

    // If targetId present, open chat immediately
    if (targetId) {
        openChat(targetId, targetName || partnersMap.get(targetId)?.name);
    }
}

// Global scope for onclick
window.openChat = async (partnerId, partnerName) => {
    currentPartnerId = partnerId;

    // UI Updates
    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
    const activeItem = document.getElementById(`user-${partnerId}`);
    if (activeItem) activeItem.classList.add('active');

    const headerName = document.getElementById('chat-header-name');
    const headerAvatar = document.getElementById('chat-header-avatar');

    headerName.textContent = partnerName;
    headerAvatar.style.display = 'flex';
    headerAvatar.textContent = partnerName.charAt(0);

    // Enable Input
    document.getElementById('message-input').disabled = false;
    document.getElementById('send-btn').disabled = false;
    document.getElementById('message-input').focus();

    // Check if new chat (no messages yet)
    // We fetch messages anyway to be sure
    await loadMessages(partnerId);
};

async function loadMessages(partnerId) {
    const chatContainer = document.getElementById('messages-list');
    chatContainer.innerHTML = '<div style="text-align:center; padding:2rem; color:var(--text-muted)">Loading...</div>';

    const { data: messages, error } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.eq.${currentUser.id},recipient_id.eq.${partnerId}),and(sender_id.eq.${partnerId},recipient_id.eq.${currentUser.id})`)
        .order('created_at', { ascending: true });

    if (error) {
        console.error(error);
        chatContainer.innerHTML = '<div style="text-align:center; color:#ef4444">Error loading messages</div>';
        return;
    }

    if (!messages || messages.length === 0) {
        chatContainer.innerHTML = '<div style="text-align:center; margin-top:auto; padding:2rem; color:var(--text-muted); opacity: 0.7;">No messages yet. Say hello! 👋</div>';
        return;
    }

    renderMessages(messages, chatContainer);

    // Scroll to bottom
    chatContainer.scrollTop = chatContainer.scrollHeight;

    // Mark as read (simple async update, don't block)
    const unreadIds = messages.filter(m => m.recipient_id === currentUser.id && !m.is_read).map(m => m.id);
    if (unreadIds.length > 0) {
        supabase.from('messages').update({ is_read: true }).in('id', unreadIds).then(() => {
            // Optional: update sidebar badge
        });
    }
}

function renderMessages(messages, container) {
    container.innerHTML = messages.map(msg => {
        const isMe = msg.sender_id === currentUser.id;
        const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        return `
            <div class="message-bubble ${isMe ? 'msg-sent' : 'msg-received'}">
                ${msg.body}
                <span class="msg-time" style="color: ${isMe ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)'}">${time}</span>
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

    // Optimistic UI - add message immediately
    const tempId = 'temp-' + Date.now();
    const chatContainer = document.getElementById('messages-list');

    // Remove "No messages" if exists
    if (chatContainer.querySelector('.text-align-center')) { // Rough check, better to match specific class
        // Actually better to just append. If it was empty, innerHTML will be overwritten by map in loadMessages, 
        // but here we are appending. 
        // If "No messages" text is present, clear it first.
        if (chatContainer.textContent.includes('No messages yet')) chatContainer.innerHTML = '';
    }

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgHtml = `
        <div class="message-bubble msg-sent" id="${tempId}" style="opacity: 0.7">
            ${text}
            <span class="msg-time" style="color: rgba(255,255,255,0.7)">${time} (Sending...)</span>
        </div>
    `;
    chatContainer.insertAdjacentHTML('beforeend', msgHtml);
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
        document.getElementById(tempId).remove();
        input.value = text; // Restore text
    } else {
        // Success: Update cached message
        const el = document.getElementById(tempId);
        if (el) {
            el.style.opacity = '1';
            el.querySelector('.msg-time').textContent = time;
            el.id = data.id;
        }
    }
}
