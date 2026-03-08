import { supabase, signOut, getUserProfile } from './supabase-client.js';

// ═══════════════════════════════════════
//  Admin Panel — Main Controller
// ═══════════════════════════════════════

let currentUser = null;
let currentProfile = null;

// Cached data for search/filter
let allUsers = [];
let allOrgs = [];
let allOpps = [];
let allApps = [];
let allNotifs = [];
let allParticipation = [];

// Realtime channel reference
let orgRealtimeChannel = null;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Auth check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        window.location.href = 'login.html';
        return;
    }
    currentUser = user;

    // 2. Verify admin role
    const { data: profile, error } = await getUserProfile(user.id);
    if (error || !profile || profile.role !== 'admin') {
        alert('⛔ Access Denied. Admin role required.');
        window.location.href = 'dashboard.html';
        return;
    }
    currentProfile = profile;

    // 3. Populate sidebar user info
    document.getElementById('admin-name').textContent = profile.full_name;
    document.getElementById('admin-avatar').textContent = profile.full_name.charAt(0).toUpperCase();

    // 4. Navigation
    initNavigation();

    // 5. Load overview data
    await loadOverview();

    // 6. Start Realtime subscription for pending organizations
    initOrgRealtime();

    // 7. Logout
    document.getElementById('admin-logout').addEventListener('click', async () => {
        // Cleanup realtime
        if (orgRealtimeChannel) {
            supabase.removeChannel(orgRealtimeChannel);
        }
        await signOut();
        window.location.href = 'index.html';
    });

    // 8. Close detail modal on backdrop click
    document.getElementById('detail-modal').addEventListener('click', (e) => {
        if (e.target.id === 'detail-modal') closeDetailModal();
    });

    // 9. Set up search & filter listeners
    initSearchFilters();

    console.log('🛡️ Admin Panel Initialized');
});


// ═══════════════════════════════════════
//  Realtime — Pending Organization Approvals
// ═══════════════════════════════════════

function initOrgRealtime() {
    orgRealtimeChannel = supabase
        .channel('admin-org-changes')
        .on(
            'postgres_changes',
            {
                event: '*',          // INSERT, UPDATE, DELETE
                schema: 'public',
                table: 'organizations'
            },
            (payload) => {
                console.log('🔔 Realtime org change:', payload.eventType, payload);
                // Refresh the pending orgs section in overview
                refreshPendingOrgs();
                // Refresh badge count
                refreshOrgBadge();
                // If the organizations section is loaded, refresh it too
                if (loadedSections.has('organizations')) {
                    loadOrganizations();
                }
            }
        )
        .subscribe((status) => {
            console.log('📡 Realtime subscription status:', status);
        });
}

async function refreshPendingOrgs() {
    const { data: pendingOrgs } = await supabase
        .from('organizations')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

    renderPendingOrgsTable(pendingOrgs || []);
}

async function refreshOrgBadge() {
    const { count: pendingCount } = await supabase
        .from('organizations')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
    document.getElementById('badge-orgs').textContent = pendingCount || 0;
}

function renderPendingOrgsTable(pendingOrgs) {
    const pendingList = document.getElementById('overview-pending-orgs');
    if (pendingOrgs && pendingOrgs.length > 0) {
        pendingList.innerHTML = pendingOrgs.map(org => `
            <tr>
                <td>
                    <div style="font-weight:600">${esc(org.organization_name)}</div>
                    <div style="font-size:0.78rem; color:var(--text-muted)">${esc(org.address || 'No address')}</div>
                </td>
                <td>${esc(org.contact_email || 'N/A')}</td>
                <td>${formatDate(org.created_at)}</td>
                <td>
                    <div class="action-group">
                        <button class="btn-action btn-approve" onclick="adminUpdateOrgStatus('${org.id}', 'approved')">✓ Approve</button>
                        <button class="btn-action btn-reject" onclick="adminUpdateOrgStatus('${org.id}', 'rejected')">✕ Reject</button>
                    </div>
                </td>
            </tr>
        `).join('');
    } else {
        pendingList.innerHTML = '<tr><td colspan="4"><div class="empty-state"><div class="icon">✅</div>No pending approvals</div></td></tr>';
    }
}


// ═══════════════════════════════════════
//  Navigation
// ═══════════════════════════════════════

function initNavigation() {
    const navItems = document.querySelectorAll('.sidebar-nav-item[data-section]');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            // Update active nav
            document.querySelectorAll('.sidebar-nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            // Switch section
            const sectionId = item.dataset.section;
            document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
            const target = document.getElementById('section-' + sectionId);
            if (target) target.classList.add('active');

            // Lazy-load section data
            loadSectionData(sectionId);
        });
    });
}

window.switchAdminSection = (sectionId) => {
    const navItem = document.querySelector(`.sidebar-nav-item[data-section="${sectionId}"]`);
    if (navItem) {
        navItem.click();
        // Scroll to top of main content when switching
        document.querySelector('.admin-main').scrollTop = 0;
    }
};

const loadedSections = new Set(['overview']); // overview loaded on init

async function loadSectionData(section) {
    if (loadedSections.has(section)) return;
    loadedSections.add(section);

    switch (section) {
        case 'users': await loadUsers(); break;
        case 'organizations': await loadOrganizations(); break;
        case 'opportunities': await loadOpportunities(); break;
        case 'applications': await loadApplications(); break;
        case 'notifications': await loadNotifications(); break;
        case 'participation': await loadParticipation(); break;
    }
}


// ═══════════════════════════════════════
//  Search & Filter
// ═══════════════════════════════════════

function initSearchFilters() {
    // Users
    const searchUsers = document.getElementById('search-users');
    const filterUsersRole = document.getElementById('filter-users-role');
    if (searchUsers) searchUsers.addEventListener('input', () => renderUsers(filterData('users')));
    if (filterUsersRole) filterUsersRole.addEventListener('change', () => renderUsers(filterData('users')));

    // Organizations
    const searchOrgs = document.getElementById('search-orgs');
    const filterOrgsStatus = document.getElementById('filter-orgs-status');
    if (searchOrgs) searchOrgs.addEventListener('input', () => renderOrganizations(filterData('organizations')));
    if (filterOrgsStatus) filterOrgsStatus.addEventListener('change', () => renderOrganizations(filterData('organizations')));

    // Opportunities
    const searchOpps = document.getElementById('search-opps');
    const filterOppsStatus = document.getElementById('filter-opps-status');
    if (searchOpps) searchOpps.addEventListener('input', () => renderOpportunities(filterData('opportunities')));
    if (filterOppsStatus) filterOppsStatus.addEventListener('change', () => renderOpportunities(filterData('opportunities')));

    // Applications
    const searchApps = document.getElementById('search-apps');
    const filterAppsStatus = document.getElementById('filter-apps-status');
    if (searchApps) searchApps.addEventListener('input', () => renderApplications(filterData('applications')));
    if (filterAppsStatus) filterAppsStatus.addEventListener('change', () => renderApplications(filterData('applications')));


    // Notifications
    const searchNotifs = document.getElementById('search-notifs');
    if (searchNotifs) searchNotifs.addEventListener('input', () => renderNotifications(filterData('notifications')));

    // Participation
    const searchPart = document.getElementById('search-participation');
    if (searchPart) searchPart.addEventListener('input', () => renderParticipation(filterData('participation')));
}

function filterData(type) {
    switch (type) {
        case 'users': {
            const q = document.getElementById('search-users').value.toLowerCase();
            const role = document.getElementById('filter-users-role').value;
            return allUsers.filter(u => {
                const matchQ = !q || u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
                const matchRole = !role || u.role === role;
                return matchQ && matchRole;
            });
        }
        case 'organizations': {
            const q = document.getElementById('search-orgs').value.toLowerCase();
            const status = document.getElementById('filter-orgs-status').value;
            return allOrgs.filter(o => {
                const matchQ = !q || o.organization_name.toLowerCase().includes(q) || (o.contact_email || '').toLowerCase().includes(q);
                const matchS = !status || o.status === status;
                return matchQ && matchS;
            });
        }
        case 'opportunities': {
            const q = document.getElementById('search-opps').value.toLowerCase();
            const status = document.getElementById('filter-opps-status').value;
            return allOpps.filter(o => {
                const matchQ = !q || o.title.toLowerCase().includes(q) || (o.organizations?.organization_name || '').toLowerCase().includes(q);
                const matchS = !status || o.status === status;
                return matchQ && matchS;
            });
        }
        case 'applications': {
            const q = document.getElementById('search-apps').value.toLowerCase();
            const status = document.getElementById('filter-apps-status').value;
            return allApps.filter(a => {
                const matchQ = !q ||
                    (a.users?.full_name || '').toLowerCase().includes(q) ||
                    (a.opportunities?.title || '').toLowerCase().includes(q);
                const matchS = !status || a.status === status;
                return matchQ && matchS;
            });
        }
        case 'notifications': {
            const q = document.getElementById('search-notifs').value.toLowerCase();
            return allNotifs.filter(n => {
                return !q || n.title.toLowerCase().includes(q) || n.message.toLowerCase().includes(q) ||
                    (n.users?.full_name || '').toLowerCase().includes(q);
            });
        }
        case 'participation': {
            const q = document.getElementById('search-participation').value.toLowerCase();
            return allParticipation.filter(p => {
                return !q ||
                    (p.users?.full_name || '').toLowerCase().includes(q) ||
                    (p.opportunities?.title || '').toLowerCase().includes(q);
            });
        }
    }
    return [];
}


// ═══════════════════════════════════════
//  Overview / Dashboard
// ═══════════════════════════════════════

async function loadOverview() {
    // Stats
    const [
        { count: userCount },
        { count: orgCount },
        { count: oppCount },
        { count: appCount },
        { count: notifCount },
    ] = await Promise.all([
        supabase.from('users').select('*', { count: 'exact', head: true }),
        supabase.from('organizations').select('*', { count: 'exact', head: true }),
        supabase.from('opportunities').select('*', { count: 'exact', head: true }),
        supabase.from('applications').select('*', { count: 'exact', head: true }),
        supabase.from('notifications').select('*', { count: 'exact', head: true }),
    ]);

    // Total hours
    const { data: hours } = await supabase.from('participation_records').select('hours_completed');
    const totalHours = hours ? hours.reduce((a, c) => a + (Number(c.hours_completed) || 0), 0) : 0;

    animateCounter('stat-total-users', userCount || 0);
    animateCounter('stat-total-orgs', orgCount || 0);
    animateCounter('stat-total-opps', oppCount || 0);
    animateCounter('stat-total-apps', appCount || 0);
    animateCounter('stat-total-notifs', notifCount || 0);
    animateCounter('stat-total-hours', totalHours);

    // Sidebar badges
    document.getElementById('badge-users').textContent = userCount || 0;

    // Pending orgs — badge + table
    await refreshOrgBadge();
    await refreshPendingOrgs();

    // Recent users
    const { data: recentUsers } = await supabase.from('users').select('*').order('created_at', { ascending: false }).limit(5);
    const recentList = document.getElementById('overview-recent-users');
    if (recentUsers && recentUsers.length > 0) {
        recentList.innerHTML = recentUsers.map(u => `
            <tr>
                <td style="font-weight:500">${esc(u.full_name)}</td>
                <td style="color:var(--text-muted)">${esc(u.email)}</td>
                <td><span class="status-badge status-active" style="text-transform:capitalize">${esc(u.role)}</span></td>
                <td>${formatDate(u.created_at)}</td>
            </tr>
        `).join('');
    } else {
        recentList.innerHTML = '<tr><td colspan="4"><div class="empty-state">No users yet</div></td></tr>';
    }
}


// ═══════════════════════════════════════
//  CASCADING DELETE HELPERS
//  Delete child rows before parent to
//  avoid foreign key constraint errors.
// ═══════════════════════════════════════

async function cascadeDeleteUser(userId) {
    console.log('🚮 Cascading delete for User:', userId);

    // 1) Delete notifications for this user
    const res1 = await supabase.from('notifications').delete().eq('user_id', userId);
    if (res1.error) console.error('Failed delete notifications:', res1.error);


    // 3) Delete participation records
    const res4 = await supabase.from('participation_records').delete().eq('volunteer_id', userId);
    if (res4.error) console.error('Failed delete participation:', res4.error);

    // 4) Delete applications
    const res5 = await supabase.from('applications').delete().eq('volunteer_id', userId);
    if (res5.error) console.error('Failed delete apps:', res5.error);

    // 5) Delete opportunities under this user's orgs, and the orgs
    const { data: userOrgs, error: orgFetchError } = await supabase.from('organizations').select('id').eq('user_id', userId);
    if (orgFetchError) console.error('Failed fetch orgs for user:', orgFetchError);

    if (userOrgs && userOrgs.length > 0) {
        for (const org of userOrgs) {
            await cascadeDeleteOrganization(org.id);
        }
    }

    // 6) Finally delete the user
    const { error } = await supabase.from('users').delete().eq('id', userId);
    return { error };
}

async function cascadeDeleteOrganization(orgId) {
    console.log('🏢 Cascading delete for Org:', orgId);

    // 1) Get all opportunities for this org
    const { data: opps, error: oppFetchError } = await supabase.from('opportunities').select('id').eq('organization_id', orgId);
    if (oppFetchError) console.error('Failed fetch opps for org:', oppFetchError);

    if (opps && opps.length > 0) {
        for (const opp of opps) {
            await cascadeDeleteOpportunity(opp.id);
        }
    }
    // 2) Delete the org itself
    const { error } = await supabase.from('organizations').delete().eq('id', orgId);
    return { error };
}

async function cascadeDeleteOpportunity(oppId) {
    console.log('🎯 Cascading delete for Opp:', oppId);

    // 1) Delete applications for this opportunity
    const res1 = await supabase.from('applications').delete().eq('opportunity_id', oppId);
    if (res1.error) console.error('Failed delete apps for opp:', res1.error);

    // 2) Delete participation records for this opportunity
    const res2 = await supabase.from('participation_records').delete().eq('opportunity_id', oppId);
    if (res2.error) console.error('Failed delete participation for opp:', res2.error);

    // 3) Delete the opportunity
    const { error } = await supabase.from('opportunities').delete().eq('id', oppId);
    return { error };
}


// ═══════════════════════════════════════
//  1. USERS
// ═══════════════════════════════════════

async function loadUsers() {
    console.log('🔄 Loading users...');
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error loading users:', error);
        showToast('Error loading users', 'error');
        return;
    }
    allUsers = data || [];
    renderUsers(allUsers);
}

function renderUsers(users) {
    const tbody = document.getElementById('table-users');
    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="icon">👥</div>No users found</div></td></tr>';
        return;
    }
    tbody.innerHTML = users.map(u => `
        <tr>
            <td>
                <div style="font-weight:600">${esc(u.full_name)}</div>
                ${u.bio ? `<div style="font-size:0.75rem; color:var(--text-muted); max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${esc(u.bio)}</div>` : ''}
            </td>
            <td style="color:var(--text-muted)">${esc(u.email)}</td>
            <td><span class="status-badge status-active" style="text-transform:capitalize">${esc(u.role)}</span></td>
            <td>${esc(u.phone || '—')}</td>
            <td>${esc(u.location || '—')}</td>
            <td>${formatDate(u.created_at)}</td>
            <td>
                <div class="action-group">
                    <button class="btn-action btn-view" onclick="viewUserDetail('${u.id}')">👁 View</button>
                    <button class="btn-action btn-delete" onclick="adminDeleteUser('${u.id}')">🗑 Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

// View User Detail modal
window.viewUserDetail = async (userId) => {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;

    const skillsHtml = user.skills && user.skills.length > 0
        ? user.skills.map(s => `<span class="badge" style="margin-right:0.3rem; margin-bottom:0.3rem">${esc(s)}</span>`).join('')
        : '<span style="color:var(--text-muted)">None</span>';

    const body = document.getElementById('detail-modal-body');
    body.innerHTML = `
        <h2>👤 User Details</h2>
        <div class="detail-row"><div class="label">Full Name</div><div>${esc(user.full_name)}</div></div>
        <div class="detail-row"><div class="label">Email</div><div>${esc(user.email)}</div></div>
        <div class="detail-row"><div class="label">Role</div><div><span class="status-badge status-active" style="text-transform:capitalize">${esc(user.role)}</span></div></div>
        <div class="detail-row"><div class="label">Phone</div><div>${esc(user.phone || '—')}</div></div>
        <div class="detail-row"><div class="label">Location</div><div>${esc(user.location || '—')}</div></div>
        <div class="detail-row"><div class="label">Bio</div><div>${esc(user.bio || 'No bio provided')}</div></div>
        <div class="detail-row"><div class="label">Skills</div><div>${skillsHtml}</div></div>
        <div class="detail-row"><div class="label">Joined</div><div>${formatDate(user.created_at)}</div></div>
        <div class="detail-actions">
            <a href="profile.html?id=${user.id}" class="btn btn-secondary" target="_blank">Open Profile ↗</a>
            <button class="btn btn-secondary" onclick="closeDetailModal()">Close</button>
        </div>
    `;
    openDetailModal();
};

window.adminDeleteUser = async (userId) => {
    if (userId === currentUser.id) {
        showToast('You cannot delete your own account!', 'error');
        return;
    }

    const isConfirmed = await confirmCustom(
        'Delete User',
        '⚠️ Are you sure you want to delete this user and ALL their related data (orgs, opportunities, apps)? This action is permanent.'
    );

    if (!isConfirmed) return;

    showToast('Deleting user and related data...', 'info');

    const { error } = await cascadeDeleteUser(userId);
    if (error) {
        showToast('Error deleting user: ' + error.message, 'error');
    } else {
        showToast('User and all related data deleted successfully', 'success');
        loadedSections.delete('users');
        await loadUsers();
        await loadOverview();
    }
};


// ═══════════════════════════════════════
//  2. ORGANIZATIONS
// ═══════════════════════════════════════

async function loadOrganizations() {
    const { data, error } = await supabase
        .from('organizations')
        .select('*, users:user_id(full_name, email)')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error loading orgs:', error);
        showToast('Error loading organizations', 'error');
        return;
    }
    allOrgs = data || [];
    renderOrganizations(allOrgs);
}

function renderOrganizations(orgs) {
    const tbody = document.getElementById('table-orgs');
    if (!orgs || orgs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="icon">🏢</div>No organizations found</div></td></tr>';
        return;
    }
    tbody.innerHTML = orgs.map(o => {
        const statusClass = o.status === 'approved' ? 'status-approved' : o.status === 'rejected' ? 'status-rejected' : 'status-pending';
        return `
            <tr>
                <td>
                    <div style="font-weight:600">${esc(o.organization_name)}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted)">${esc(o.users?.full_name || 'Unknown owner')}</div>
                </td>
                <td>${esc(o.contact_email || '—')}</td>
                <td>${esc(o.contact_phone || '—')}</td>
                <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${esc(o.address || '—')}</td>
                <td><span class="status-badge ${statusClass}">${esc(o.status)}</span></td>
                <td>${formatDate(o.created_at)}</td>
                <td>
                    <div class="action-group">
                        <button class="btn-action btn-view" onclick="viewOrgDetail('${o.id}')">👁</button>
                        ${o.status === 'pending' ? `
                            <button class="btn-action btn-approve" onclick="adminUpdateOrgStatus('${o.id}', 'approved')">✓</button>
                            <button class="btn-action btn-reject" onclick="adminUpdateOrgStatus('${o.id}', 'rejected')">✕</button>
                        ` : ''}
                        ${o.status === 'rejected' ? `<button class="btn-action btn-approve" onclick="adminUpdateOrgStatus('${o.id}', 'approved')">✓ Approve</button>` : ''}
                        <button class="btn-action btn-delete" onclick="adminDeleteOrg('${o.id}')">🗑</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

window.viewOrgDetail = async (orgId) => {
    const org = allOrgs.find(o => o.id === orgId);
    if (!org) return;

    const body = document.getElementById('detail-modal-body');
    const statusClass = org.status === 'approved' ? 'status-approved' : org.status === 'rejected' ? 'status-rejected' : 'status-pending';
    body.innerHTML = `
        <h2>🏢 Organization Details</h2>
        <div class="detail-row"><div class="label">Name</div><div style="font-weight:600">${esc(org.organization_name)}</div></div>
        <div class="detail-row"><div class="label">Owner</div><div>${esc(org.users?.full_name || '—')} (${esc(org.users?.email || '—')})</div></div>
        <div class="detail-row"><div class="label">Contact Email</div><div>${esc(org.contact_email || '—')}</div></div>
        <div class="detail-row"><div class="label">Contact Phone</div><div>${esc(org.contact_phone || '—')}</div></div>
        <div class="detail-row"><div class="label">Address</div><div>${esc(org.address || '—')}</div></div>
        <div class="detail-row"><div class="label">Description</div><div>${esc(org.description || 'No description provided')}</div></div>
        <div class="detail-row"><div class="label">Status</div><div><span class="status-badge ${statusClass}">${esc(org.status)}</span></div></div>
        <div class="detail-row"><div class="label">Created</div><div>${formatDate(org.created_at)}</div></div>
        <div class="detail-actions">
            ${org.status === 'pending' ? `
                <button class="btn btn-primary" onclick="adminUpdateOrgStatus('${org.id}', 'approved'); closeDetailModal()">Approve</button>
                <button class="btn btn-secondary" style="color:#ef4444" onclick="adminUpdateOrgStatus('${org.id}', 'rejected'); closeDetailModal()">Reject</button>
            ` : ''}
            <button class="btn btn-secondary" onclick="closeDetailModal()">Close</button>
        </div>
    `;
    openDetailModal();
};

window.adminUpdateOrgStatus = async (orgId, status) => {
    const isConfirmed = await confirmCustom(
        'Update Organization Status',
        `Mark this organization as "${status}"?`
    );
    if (!isConfirmed) return;

    const { error } = await supabase.from('organizations').update({ status }).eq('id', orgId);
    if (error) {
        showToast('Error: ' + error.message, 'error');
    } else {
        showToast(`Organization ${status}!`, 'success');

        let org = allOrgs.find(o => o.id === orgId);
        if (!org) {
            const { data } = await supabase.from('organizations').select('user_id, organization_name').eq('id', orgId).single();
            org = data;
        }
        if (org && org.user_id) {
            await supabase.from('notifications').insert([{
                user_id: org.user_id,
                title: 'Organization ' + status.charAt(0).toUpperCase() + status.slice(1),
                message: `Your organization "${org.organization_name}" has been ${status} by an admin.`,
                is_read: false
            }]);
        }

        loadedSections.delete('organizations');
        if (document.getElementById('section-organizations').classList.contains('active')) {
            await loadOrganizations();
        }
        await loadOverview();
    }
};

window.adminDeleteOrg = async (orgId) => {
    const isConfirmed = await confirmCustom(
        'Delete Organization',
        '⚠️ Delete this organization and ALL its opportunities, applications, and records?'
    );
    if (!isConfirmed) return;

    showToast('Deleting organization and related data...', 'info');

    const { error } = await cascadeDeleteOrganization(orgId);
    if (error) {
        showToast('Error: ' + error.message, 'error');
    } else {
        showToast('Organization deleted', 'success');
        loadedSections.delete('organizations');
        await loadOrganizations();
        await loadOverview();
    }
};


// ═══════════════════════════════════════
//  3. OPPORTUNITIES
// ═══════════════════════════════════════

async function loadOpportunities() {
    const { data, error } = await supabase
        .from('opportunities')
        .select('*, organizations(organization_name)')
        .order('created_at', { ascending: false });

    if (error) { showToast('Error loading opportunities', 'error'); return; }
    allOpps = data || [];
    renderOpportunities(allOpps);
}

function renderOpportunities(opps) {
    const tbody = document.getElementById('table-opps');
    if (!opps || opps.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="icon">🎯</div>No opportunities found</div></td></tr>';
        return;
    }
    tbody.innerHTML = opps.map(o => {
        const statusClass = o.status === 'active' ? 'status-active' : 'status-closed';
        return `
            <tr>
                <td style="font-weight:500">${esc(o.title)}</td>
                <td>${esc(o.organizations?.organization_name || '—')}</td>
                <td>${esc(o.location || '—')}</td>
                <td>${o.date ? formatDate(o.date) : '—'}</td>
                <td>${o.slots_available ?? '—'}</td>
                <td><span class="status-badge ${statusClass}">${esc(o.status)}</span></td>
                <td>
                    <div class="action-group">
                        <button class="btn-action btn-view" onclick="viewOppDetail('${o.id}')">👁</button>
                        ${o.status === 'active'
                ? `<button class="btn-action btn-warn" onclick="adminCloseOpp('${o.id}')">Close</button>`
                : `<button class="btn-action btn-approve" onclick="adminActivateOpp('${o.id}')">Activate</button>`
            }
                        <button class="btn-action btn-delete" onclick="adminDeleteOpp('${o.id}')">🗑</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

window.viewOppDetail = async (oppId) => {
    const opp = allOpps.find(o => o.id === oppId);
    if (!opp) return;

    const body = document.getElementById('detail-modal-body');
    body.innerHTML = `
        <h2>🎯 Opportunity Details</h2>
        <div class="detail-row"><div class="label">Title</div><div style="font-weight:600">${esc(opp.title)}</div></div>
        <div class="detail-row"><div class="label">Organization</div><div>${esc(opp.organizations?.organization_name || '—')}</div></div>
        <div class="detail-row"><div class="label">Description</div><div>${esc(opp.description || '—')}</div></div>
        <div class="detail-row"><div class="label">Location</div><div>${esc(opp.location || '—')}</div></div>
        <div class="detail-row"><div class="label">Date</div><div>${opp.date ? formatDate(opp.date) : '—'}</div></div>
        <div class="detail-row"><div class="label">Time</div><div>${opp.start_time || '—'} → ${opp.end_time || '—'}</div></div>
        <div class="detail-row"><div class="label">Slots</div><div>${opp.slots_available ?? '—'}</div></div>
        <div class="detail-row"><div class="label">Status</div><div><span class="status-badge status-${opp.status}">${esc(opp.status)}</span></div></div>
        <div class="detail-row"><div class="label">Created</div><div>${formatDate(opp.created_at)}</div></div>
        <div class="detail-actions">
            <button class="btn btn-secondary" onclick="closeDetailModal()">Close</button>
        </div>
    `;
    openDetailModal();
};

window.adminCloseOpp = async (oppId) => {
    const isConfirmed = await confirmCustom('Update Opportunity', 'Close this opportunity?');
    if (!isConfirmed) return;
    const { error } = await supabase.from('opportunities').update({ status: 'closed' }).eq('id', oppId);
    if (error) { showToast('Error: ' + error.message, 'error'); }
    else { showToast('Opportunity closed', 'success'); loadedSections.delete('opportunities'); await loadOpportunities(); }
};

window.adminActivateOpp = async (oppId) => {
    const { error } = await supabase.from('opportunities').update({ status: 'active' }).eq('id', oppId);
    if (error) { showToast('Error: ' + error.message, 'error'); }
    else { showToast('Opportunity activated', 'success'); loadedSections.delete('opportunities'); await loadOpportunities(); }
};

window.adminDeleteOpp = async (oppId) => {
    const isConfirmed = await confirmCustom('Delete Opportunity', '⚠️ Delete this opportunity and its applications/records?');
    if (!isConfirmed) return;

    showToast('Deleting opportunity and related data...', 'info');

    const { error } = await cascadeDeleteOpportunity(oppId);
    if (error) { showToast('Error: ' + error.message, 'error'); }
    else { showToast('Opportunity deleted', 'success'); loadedSections.delete('opportunities'); await loadOpportunities(); await loadOverview(); }
};


// ═══════════════════════════════════════
//  4. APPLICATIONS
// ═══════════════════════════════════════

async function loadApplications() {
    const { data, error } = await supabase
        .from('applications')
        .select(`
            *,
            users:volunteer_id(full_name, email),
            opportunities:opportunity_id(title)
        `)
        .order('applied_at', { ascending: false });

    if (error) { showToast('Error loading applications', 'error'); return; }
    allApps = data || [];
    renderApplications(allApps);
}

function renderApplications(apps) {
    const tbody = document.getElementById('table-apps');
    if (!apps || apps.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="icon">📋</div>No applications found</div></td></tr>';
        return;
    }
    tbody.innerHTML = apps.map(a => {
        const statusClass = a.status === 'approved' ? 'status-approved' : a.status === 'rejected' ? 'status-rejected' : 'status-pending';
        return `
            <tr>
                <td>
                    <div style="font-weight:500">${esc(a.users?.full_name || 'Unknown')}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted)">${esc(a.users?.email || '')}</div>
                </td>
                <td>${esc(a.opportunities?.title || 'Unknown')}</td>
                <td><span class="status-badge ${statusClass}">${esc(a.status)}</span></td>
                <td>${formatDate(a.applied_at)}</td>
                <td>
                    <div class="action-group">
                        ${a.status === 'pending' ? `
                            <button class="btn-action btn-approve" onclick="adminUpdateAppStatus('${a.id}', 'approved')">✓ Approve</button>
                            <button class="btn-action btn-reject" onclick="adminUpdateAppStatus('${a.id}', 'rejected')">✕ Reject</button>
                        ` : ''}
                        <button class="btn-action btn-delete" onclick="adminDeleteApp('${a.id}')">🗑</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

window.adminUpdateAppStatus = async (appId, status) => {
    const { error } = await supabase.from('applications').update({ status }).eq('id', appId);
    if (error) {
        showToast('Error: ' + error.message, 'error');
    } else {
        showToast(`Application ${status}`, 'success');

        const app = allApps.find(a => a.id === appId);
        if (app) {
            await supabase.from('notifications').insert([{
                user_id: app.volunteer_id,
                title: 'Application ' + status.charAt(0).toUpperCase() + status.slice(1),
                message: `Your application for "${app.opportunities?.title || 'an opportunity'}" has been ${status}.`,
                is_read: false
            }]);
        }

        loadedSections.delete('applications');
        await loadApplications();
    }
};

window.adminDeleteApp = async (appId) => {
    const isConfirmed = await confirmCustom('Delete Application', 'Delete this application?');
    if (!isConfirmed) return;
    const { error } = await supabase.from('applications').delete().eq('id', appId);
    if (error) { showToast('Error: ' + error.message, 'error'); }
    else { showToast('Application deleted', 'success'); loadedSections.delete('applications'); await loadApplications(); await loadOverview(); }
};




// ═══════════════════════════════════════
//  6. NOTIFICATIONS
// ═══════════════════════════════════════

async function loadNotifications() {
    const { data, error } = await supabase
        .from('notifications')
        .select(`
            *,
            users:user_id(full_name, email)
        `)
        .order('created_at', { ascending: false });

    if (error) { showToast('Error loading notifications', 'error'); return; }
    allNotifs = data || [];
    renderNotifications(allNotifs);
}

function renderNotifications(notifs) {
    const tbody = document.getElementById('table-notifs');
    if (!notifs || notifs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="icon">🔔</div>No notifications found</div></td></tr>';
        return;
    }
    tbody.innerHTML = notifs.map(n => `
        <tr>
            <td>
                <div style="font-weight:500">${esc(n.users?.full_name || '—')}</div>
                <div style="font-size:0.75rem; color:var(--text-muted)">${esc(n.users?.email || '')}</div>
            </td>
            <td style="font-weight:500">${esc(n.title)}</td>
            <td style="max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-muted)">${esc(n.message)}</td>
            <td>${n.is_read ? '<span style="color:#4ade80">✓</span>' : '<span style="color:var(--text-muted)">—</span>'}</td>
            <td>${formatDate(n.created_at)}</td>
            <td>
                <div class="action-group">
                    <button class="btn-action btn-delete" onclick="adminDeleteNotif('${n.id}')">🗑</button>
                </div>
            </td>
        </tr>
    `).join('');
}

window.adminDeleteNotif = async (notifId) => {
    const isConfirmed = await confirmCustom('Delete Notification', 'Delete this notification?');
    if (!isConfirmed) return;
    const { error } = await supabase.from('notifications').delete().eq('id', notifId);
    if (error) { showToast('Error: ' + error.message, 'error'); }
    else { showToast('Notification deleted', 'success'); loadedSections.delete('notifications'); await loadNotifications(); }
};


// ═══════════════════════════════════════
//  7. PARTICIPATION RECORDS
// ═══════════════════════════════════════

async function loadParticipation() {
    const { data, error } = await supabase
        .from('participation_records')
        .select(`
            *,
            users:volunteer_id(full_name, email),
            opportunities:opportunity_id(title)
        `)
        .order('created_at', { ascending: false });

    if (error) { showToast('Error loading participation records', 'error'); return; }
    allParticipation = data || [];
    renderParticipation(allParticipation);
}

function renderParticipation(records) {
    const tbody = document.getElementById('table-participation');
    if (!records || records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="icon">📈</div>No participation records found</div></td></tr>';
        return;
    }
    tbody.innerHTML = records.map(r => `
        <tr>
            <td>
                <div style="font-weight:500">${esc(r.users?.full_name || '—')}</div>
                <div style="font-size:0.75rem; color:var(--text-muted)">${esc(r.users?.email || '')}</div>
            </td>
            <td>${esc(r.opportunities?.title || '—')}</td>
            <td style="font-weight:700; color:var(--primary-light)">${r.hours_completed ?? '—'} hrs</td>
            <td>${r.participation_date ? formatDate(r.participation_date) : '—'}</td>
            <td>
                <div class="action-group">
                    <button class="btn-action btn-delete" onclick="adminDeleteParticipation('${r.id}')">🗑</button>
                </div>
            </td>
        </tr>
    `).join('');
}

window.adminDeleteParticipation = async (recordId) => {
    const isConfirmed = await confirmCustom('Delete Record', 'Delete this participation record?');
    if (!isConfirmed) return;
    const { error } = await supabase.from('participation_records').delete().eq('id', recordId);
    if (error) { showToast('Error: ' + error.message, 'error'); }
    else { showToast('Record deleted', 'success'); loadedSections.delete('participation'); await loadParticipation(); await loadOverview(); }
};


// ═══════════════════════════════════════
//  Utilities & UI Helpers
// ═══════════════════════════════════════

function formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
    });
}

// Escape HTML to prevent XSS
function esc(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

// Custom Non-Blocking Confirmation Modal
async function confirmCustom(title, message) {
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-title');
    const msgEl = document.getElementById('confirm-message');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    titleEl.textContent = title;
    msgEl.textContent = message;

    modal.classList.add('open');

    return new Promise((resolve) => {
        const handleCancel = () => {
            modal.classList.remove('open');
            cleanup();
            resolve(false);
        };
        const handleOk = () => {
            modal.classList.remove('open');
            cleanup();
            resolve(true);
        };
        const cleanup = () => {
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
        };

        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);
    });
}

function animateCounter(elementId, target) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const duration = 800;
    const start = performance.now();
    const from = 0;

    function step(timestamp) {
        const progress = Math.min((timestamp - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        el.textContent = Math.floor(from + (target - from) * eased);
        if (progress < 1) requestAnimationFrame(step);
        else el.textContent = target;
    }

    requestAnimationFrame(step);
}

// Toast system
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) {
        console.warn('Toast container missing. Message:', message);
        return;
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    // Stringify if object
    const displayMsg = typeof message === 'object' ? JSON.stringify(message) : String(message);
    toast.innerHTML = `<span>${icon}</span> ${esc(displayMsg)}`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

// Detail modal helpers
function openDetailModal() {
    document.getElementById('detail-modal').classList.add('open');
}

function closeDetailModal() {
    document.getElementById('detail-modal').classList.remove('open');
}

window.closeDetailModal = closeDetailModal;
// Expose these for onclick attributes
window.adminUpdateOrgStatus = adminUpdateOrgStatus;
window.adminActivateOpp = adminActivateOpp;
window.adminCloseOpp = adminCloseOpp;
window.adminDeleteApp = adminDeleteApp;
window.adminDeleteNotif = adminDeleteNotif;
window.adminDeleteParticipation = adminDeleteParticipation;
window.adminDeleteOpp = adminDeleteOpp;
window.adminDeleteOrg = adminDeleteOrg;
