import { supabase, signOut, getUserProfile } from './supabase-client.js';

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Check Auth
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        window.location.href = 'login.html';
        return;
    }

    // 2. Fetch User Profile (Role)
    const { data: profile, error } = await getUserProfile(user.id);

    if (error || !profile) {
        console.error('Profile fetch error', error);
        alert('Error loading profile. Please contact support.');
        return;
    }

    // 3. Update Sidebar
    document.getElementById('user-name').textContent = profile.full_name;
    document.getElementById('sidebar-avatar').textContent = profile.full_name.charAt(0);
    document.getElementById('user-role').textContent = profile.role.toUpperCase();

    // 4. Show Relevant Dashboard
    if (profile.role === 'volunteer') {
        initVolunteerDashboard(user, profile);
    } else if (profile.role === 'organization') {
        initOrgDashboard(user, profile);
    } else if (profile.role === 'admin') {
        initAdminDashboard(user, profile);
    }

    // Logout Handler
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await signOut();
        window.location.href = 'index.html';
    });
});

async function initVolunteerDashboard(user, profile) {
    document.getElementById('volunteer-dashboard').classList.add('active');
    document.getElementById('vol-name').textContent = profile.full_name;

    // Sidebar items
    const nav = document.getElementById('sidebar-nav');
    nav.innerHTML = `
        <div class="nav-item active" onclick="switchSection('volunteer-dashboard', this)">📊 Dashboard</div>
        <div class="nav-item" onclick="window.location.href='opportunities.html'">🔍 Browse</div>
        <div class="nav-item" onclick="window.location.href='organizations.html'">🏢 Organizations</div>
        <div class="nav-item" onclick="window.location.href='messages.html'">💬 Messages</div>
        <div class="nav-item" onclick="switchSection('notifications-dashboard', this); loadNotifications('${user.id}')">🔔 Notifications</div>
    `;

    // Fetch Applications
    const { data: apps } = await supabase
        .from('applications')
        .select(`
            *,
            opportunities (
                title,
                organizations (organization_name)
            )
        `)
        .eq('volunteer_id', user.id);

    const list = document.getElementById('applications-list');
    document.getElementById('vol-applications').textContent = apps ? apps.length : 0;

    if (apps && apps.length > 0) {
        list.innerHTML = apps.map(app => `
            <tr>
                <td>${app.opportunities.title}</td>
                <td>${app.opportunities.organizations?.organization_name || 'N/A'}</td>
                <td>${new Date(app.applied_at).toLocaleDateString()}</td>
                <td><span class="status-badge status-${app.status}">${app.status}</span></td>
            </tr>
        `).join('');
    } else {
        list.innerHTML = '<tr><td colspan="4" class="text-center">No active applications.</td></tr>';
    }
}

async function initOrgDashboard(user, profile) {
    document.getElementById('org-dashboard').classList.add('active');

    // Sidebar
    const nav = document.getElementById('sidebar-nav');
    nav.innerHTML = `
        <div class="nav-item active" onclick="switchSection('org-dashboard', this)">📊 Overview</div>
        <div class="nav-item" onclick="window.location.href='messages.html'">💬 Messages</div>
        <div class="nav-item" onclick="switchSection('notifications-dashboard', this); loadNotifications('${user.id}')">🔔 Notifications</div>
    `;

    // Check Org Profile
    let { data: orgData } = await supabase.from('organizations').select('*').eq('user_id', user.id).single();

    if (!orgData) {
        // Show Profile Completion Modal
        const profileModal = document.getElementById('org-profile-modal');
        profileModal.classList.add('open');

        document.getElementById('org-profile-form').onsubmit = async (e) => {
            e.preventDefault();
            const name = document.getElementById('org-name-init').value;
            const email = document.getElementById('org-email-init').value;

            const { error: insertError } = await supabase.from('organizations').insert([{
                user_id: user.id,
                organization_name: name,
                contact_email: email,
                status: 'approved' // Auto-approve for demo
            }]);

            if (insertError) {
                console.error(insertError);
                alert('Error processing profile: ' + insertError.message);
            } else {
                profileModal.classList.remove('open');
                window.location.reload();
            }
        };
        return; // Stop loading dashboard until profile created
    }

    // Setup Post Modal
    document.getElementById('create-post-btn').onclick = () => openPostModal();
    window.closePostModal = () => document.getElementById('post-modal').classList.remove('open');

    // Make these functions global so they can be called from HTML
    window.editOpportunity = (id) => editOpportunity(id, orgData.id);
    window.deleteOpportunity = (id) => deleteOpportunity(id, orgData.id);

    document.getElementById('post-form').onsubmit = async (e) => {
        e.preventDefault();
        const id = document.getElementById('post-id').value;
        const title = document.getElementById('post-title').value;
        const desc = document.getElementById('post-desc').value;
        const date = document.getElementById('post-date').value;
        const loc = document.getElementById('post-location').value;
        const slots = document.getElementById('post-slots').value;

        let error;

        if (id) {
            // Update
            const { error: updateError } = await supabase
                .from('opportunities')
                .update({ title, description: desc, date, location: loc, slots_available: slots })
                .eq('id', id)
                .eq('organization_id', orgData.id);
            error = updateError;
        } else {
            // Create
            const { error: insertError } = await supabase.from('opportunities').insert([{
                organization_id: orgData.id,
                title,
                description: desc,
                date,
                location: loc,
                slots_available: slots,
                status: 'active'
            }]);
            error = insertError;
        }

        if (!error) {
            alert(id ? 'Opportunity Updated!' : 'Opportunity Posted!');
            closePostModal();
            loadOrgPosts(orgData.id);
        } else {
            console.error(error);
            alert('Error saving opportunity: ' + error.message);
        }
    };

    // Load Data
    loadOrgPosts(orgData.id);
    loadOrgStats(orgData.id);
    loadOrgApplications(orgData.id);

    // Global helper for applications
    window.updateApplicationStatus = async (appId, status) => {
        if (!confirm(`Are you sure you want to mark this application as ${status}?`)) return;

        // Get details for notification
        const { data: appDetails, error: fetchError } = await supabase
            .from('applications')
            .select('volunteer_id, opportunities(title)')
            .eq('id', appId)
            .single();

        const { error } = await supabase
            .from('applications')
            .update({ status: status })
            .eq('id', appId);

        if (error) {
            console.error(error);
            alert('Error updating status');
        } else {
            // Send Notification
            if (appDetails && !fetchError) {
                const { error: notifError } = await supabase.from('notifications').insert([{
                    user_id: appDetails.volunteer_id,
                    title: 'Application Update',
                    message: `Your application for "${appDetails.opportunities?.title || 'Opportunity'}" has been ${status}.`,
                    is_read: false
                }]);
                if (notifError) console.error('Notification error:', notifError);
            }

            // Refresh counts and lists
            loadOrgStats(orgData.id);
            loadOrgApplications(orgData.id);
        }
    };
}

// Helper to open modal for create
function openPostModal() {
    document.getElementById('post-form').reset();
    document.getElementById('post-id').value = '';
    document.getElementById('modal-title').textContent = 'Post New Opportunity';
    document.getElementById('save-post-btn').textContent = 'Post';
    document.getElementById('post-modal').classList.add('open');
}

// Helper to open modal for edit
async function editOpportunity(id, orgId) {
    const { data: opp, error } = await supabase
        .from('opportunities')
        .select('*')
        .eq('id', id)
        .eq('organization_id', orgId)
        .single();

    if (error || !opp) {
        alert('Error fetching details');
        return;
    }

    document.getElementById('post-id').value = opp.id;
    document.getElementById('post-title').value = opp.title;
    document.getElementById('post-desc').value = opp.description;
    document.getElementById('post-date').value = opp.date;
    document.getElementById('post-location').value = opp.location;
    document.getElementById('post-slots').value = opp.slots_available;

    document.getElementById('modal-title').textContent = 'Edit Opportunity';
    document.getElementById('save-post-btn').textContent = 'Update';
    document.getElementById('post-modal').classList.add('open');
}

// Helper to delete
async function deleteOpportunity(id, orgId) {
    if (!confirm('Are you sure you want to delete this opportunity?')) return;

    const { error } = await supabase
        .from('opportunities')
        .delete()
        .eq('id', id)
        .eq('organization_id', orgId);

    if (error) {
        alert('Error deleting: ' + error.message);
    } else {
        loadOrgPosts(orgId);
    }
}

async function loadOrgStats(orgId) {
    // Get all opportunities for this org first
    const { data: opps } = await supabase
        .from('opportunities')
        .select('id')
        .eq('organization_id', orgId);

    if (opps && opps.length > 0) {
        const oppIds = opps.map(o => o.id);
        const { count: appCount } = await supabase
            .from('applications')
            .select('*', { count: 'exact', head: true })
            .in('opportunity_id', oppIds)
            .eq('status', 'pending');

        document.getElementById('org-pending-apps').textContent = appCount || 0;
    } else {
        document.getElementById('org-pending-apps').textContent = 0;
    }
}


async function loadOrgApplications(orgId) {
    // 1. Get Opp IDs
    const { data: opps } = await supabase
        .from('opportunities')
        .select('id')
        .eq('organization_id', orgId);

    const list = document.getElementById('org-applications-list');

    if (!opps || opps.length === 0) {
        list.innerHTML = '<tr><td colspan="4" class="text-center">No active opportunities.</td></tr>';
        return;
    }

    const oppIds = opps.map(o => o.id);

    // 2. Fetch Pending Applications
    // We need user details (volunteer) so we join 'users'
    // We need opp details so we join 'opportunities'
    const { data: apps, error } = await supabase
        .from('applications')
        .select(`
            id,
            applied_at,
            status,
            volunteer_id,
            opportunity_id,
            users:volunteer_id (full_name, email),
            opportunities:opportunity_id (title)
        `)
        .in('opportunity_id', oppIds)
        .eq('status', 'pending')
        .order('applied_at', { ascending: false });

    if (error) {
        console.error('Error fetching apps:', error);
        list.innerHTML = '<tr><td colspan="4" class="text-center">Error loading applications.</td></tr>';
        return;
    }

    if (apps && apps.length > 0) {
        list.innerHTML = apps.map(app => `
            <tr>
                <td>
                    <div style="font-weight:500">${app.users?.full_name || 'Volunteer'}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted)">${app.users?.email || ''}</div>
                </td>
                <td>${app.opportunities?.title || 'Unknown Opportunity'}</td>
                <td>${new Date(app.applied_at).toLocaleDateString()}</td>
                <td>
                    <div style="display:flex; gap:0.5rem;">
                        <button class="btn btn-sm btn-secondary" style="color:#4ade80; border-color: rgba(74, 222, 128, 0.5);" onclick="updateApplicationStatus('${app.id}', 'approved')">Approve</button>
                        <button class="btn btn-sm btn-secondary" style="color:#ef4444; border-color: rgba(239, 68, 68, 0.5);" onclick="updateApplicationStatus('${app.id}', 'rejected')">Reject</button>
                        <a href="messages.html?recipient_id=${app.volunteer_id}&name=${encodeURIComponent(app.users?.full_name || 'Volunteer')}" class="btn btn-sm btn-secondary">Message</a>
                    </div>
                </td>
            </tr>
        `).join('');
    } else {
        list.innerHTML = '<tr><td colspan="4" class="text-center">No pending applications.</td></tr>';
    }
}

async function loadOrgPosts(orgId) {
    const { data: posts } = await supabase
        .from('opportunities')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });

    const list = document.getElementById('org-posts-list');
    document.getElementById('org-active-posts').textContent = posts ? posts.length : 0;

    if (posts && posts.length > 0) {
        list.innerHTML = posts.map(post => `
            <tr>
                <td>${post.title}</td>
                <td>${new Date(post.date).toLocaleDateString()}</td>
                <td><span class="status-badge status-${post.status}">${post.status}</span></td>
                <td>
                    <button class="btn btn-sm btn-secondary" onclick="editOpportunity('${post.id}')">Edit</button>
                    <button class="btn btn-sm btn-secondary" style="color:#ef4444; border-color: rgba(239, 68, 68, 0.5);" onclick="deleteOpportunity('${post.id}')">Delete</button>
                </td>
            </tr>
        `).join('');
    } else {
        list.innerHTML = '<tr><td colspan="4" class="text-center">No opportunities posted yet.</td></tr>';
    }
}

// Section Switcher
window.switchSection = function (sectionId, element) {
    // Hide all sections
    document.querySelectorAll('.dashboard-section').forEach(el => el.classList.remove('active'));
    // Show target
    const target = document.getElementById(sectionId);
    if (target) target.classList.add('active');

    // Update nav
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    if (element) element.classList.add('active');
}

// Load Notifications
window.loadNotifications = async function (userId) {
    const list = document.getElementById('notifications-list');
    list.innerHTML = '<div class="text-center" style="color: var(--text-muted); padding: 2rem;">Loading...</div>';

    const { data: notifs, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error loading notifications:', error);
        list.innerHTML = '<div class="text-center" style="color: #ef4444; padding: 2rem;">Error loading notifications.</div>';
        return;
    }

    if (!notifs || notifs.length === 0) {
        list.innerHTML = '<div class="text-center" style="color: var(--text-muted); padding: 2rem;">No new notifications.</div>';
        return;
    }

    list.innerHTML = notifs.map(n => `
        <div class="notification-item" style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: var(--radius-sm); border-left: 4px solid ${n.is_read ? 'transparent' : 'var(--primary)'}; opacity: ${n.is_read ? 0.7 : 1}">
            <div style="display:flex; justify-content:space-between; margin-bottom:0.25rem;">
                <h4 style="font-weight:600; margin:0; font-size:1rem;">${n.title}</h4>
                <span style="font-size:0.75rem; color:var(--text-muted);">${new Date(n.created_at).toLocaleDateString()}</span>
            </div>
            <p style="margin:0; color:var(--text-secondary); font-size:0.9rem;">${n.message}</p>
        </div>
    `).join('');
}

// Admin Dashboard Logic
async function initAdminDashboard(user, profile) {
    document.getElementById('admin-dashboard').classList.add('active');

    // Sidebar
    const nav = document.getElementById('sidebar-nav');
    nav.innerHTML = `
        <div class="nav-item active" onclick="switchSection('admin-dashboard', this)">📊 Admin Overview</div>
        <div class="nav-item" onclick="window.location.href='organizations.html'">🏢 All Organizations</div>
        <div class="nav-item" onclick="window.location.href='messages.html'">💬 Messages</div>
        <div class="nav-item" onclick="switchSection('notifications-dashboard', this); loadNotifications('${user.id}')">🔔 Notifications</div>
    `;

    // 1. Load Stats
    loadAdminStats();

    // 2. Load Pending Organizations
    loadPendingOrgs();

    // 3. Load All Organizations
    loadAllOrgs();

    // 4. Load Recent Users
    loadRecentUsers();

    // 5. Load Opportunities
    loadAdminOpps();

    // Global helpers for Admin
    window.updateOrgStatus = async (orgId, status) => {
        if (!confirm(`Are you sure you want to mark this organization as ${status}?`)) return;

        const { error } = await supabase
            .from('organizations')
            .update({ status: status })
            .eq('id', orgId);

        if (error) {
            console.error('Error updating org status:', error);
            alert('Failed to update status.');
        } else {
            // Refresh
            loadPendingOrgs();
            loadAllOrgs();
            loadAdminStats();
        }
    };

    window.adminDeleteUser = async (userId) => {
        if (!confirm('Are you sure you want to delete this user? This will remove all their data.')) return;
        const { error } = await supabase.from('users').delete().eq('id', userId);
        if (error) {
            console.error(error);
            alert('Error deleting user: ' + error.message);
        } else {
            loadRecentUsers();
            loadAdminStats();
        }
    };

    window.adminDeleteOrg = async (orgId) => {
        if (!confirm('Are you sure you want to delete this organization?')) return;
        const { error } = await supabase.from('organizations').delete().eq('id', orgId);
        if (error) {
            console.error(error);
            alert('Error deleting organization: ' + error.message);
        } else {
            loadAllOrgs();
            loadPendingOrgs();
            loadAdminStats();
        }
    };

    window.adminDeleteOpp = async (oppId) => {
        if (!confirm('Are you sure you want to delete this opportunity?')) return;
        const { error } = await supabase.from('opportunities').delete().eq('id', oppId);
        if (error) {
            console.error(error);
            alert('Error deleting opportunity: ' + error.message);
        } else {
            loadAdminOpps();
            loadAdminStats();
        }
    };
}

async function loadAdminStats() {
    // Users
    const { count: userCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
    document.getElementById('admin-total-users').textContent = userCount || 0;

    // Orgs
    const { count: orgCount } = await supabase.from('organizations').select('*', { count: 'exact', head: true });
    document.getElementById('admin-total-orgs').textContent = orgCount || 0;

    // Opportunities
    const { count: oppCount } = await supabase.from('opportunities').select('*', { count: 'exact', head: true }).eq('status', 'active');
    document.getElementById('admin-active-opps').textContent = oppCount || 0;
}

async function loadPendingOrgs() {
    const list = document.getElementById('admin-pending-orgs-list');
    list.innerHTML = '<tr><td colspan="4" class="text-center">Loading...</td></tr>';

    const { data: orgs, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

    if (error) {
        console.error(error);
        list.innerHTML = '<tr><td colspan="4" class="text-center" style="color:var(--danger)">Error loading data</td></tr>';
        return;
    }

    if (!orgs || orgs.length === 0) {
        list.innerHTML = '<tr><td colspan="4" class="text-center">No pending approvals.</td></tr>';
        return;
    }

    list.innerHTML = orgs.map(org => `
        <tr>
            <td>
                <div style="font-weight:600">${org.organization_name}</div>
                <div style="font-size:0.8rem; color:var(--text-muted)">${org.address || 'No address'}</div>
            </td>
            <td>
                <div>${org.contact_email || 'N/A'}</div>
                <div style="font-size:0.8rem">${org.contact_phone || ''}</div>
            </td>
            <td><span class="status-badge status-pending">Pending</span></td>
            <td>
                <button class="btn btn-sm btn-secondary" style="color:#4ade80; border-color: rgba(74, 222, 128, 0.5); margin-right:0.5rem;" onclick="updateOrgStatus('${org.id}', 'approved')">Approve</button>
                <button class="btn btn-sm btn-secondary" style="color:#ef4444; border-color: rgba(239, 68, 68, 0.5);" onclick="updateOrgStatus('${org.id}', 'rejected')">Reject</button>
            </td>
        </tr>
    `).join('');
}

async function loadAllOrgs() {
    const list = document.getElementById('admin-all-orgs-list');

    const { data: orgs } = await supabase
        .from('organizations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10); // Limit for performance

    if (orgs && orgs.length > 0) {
        list.innerHTML = orgs.map(org => `
            <tr>
                <td>${org.organization_name}</td>
                <td><span class="status-badge status-${org.status}">${org.status}</span></td>
                <td>${new Date(org.created_at).toLocaleDateString()}</td>
                <td>
                    <button class="btn btn-sm btn-secondary" style="color:#ef4444; border-color: rgba(239, 68, 68, 0.5);" onclick="adminDeleteOrg('${org.id}')">Delete</button>
                    ${org.status === 'pending' ?
                `<button class="btn btn-sm btn-secondary" onclick="updateOrgStatus('${org.id}', 'approved')" style="margin-left:0.5rem">Approve</button>` : ''
            }
                </td>
            </tr>
        `).join('');
    } else {
        list.innerHTML = '<tr><td colspan="4" class="text-center">No organizations found.</td></tr>';
    }
}

async function loadRecentUsers() {
    const list = document.getElementById('admin-users-list');

    const { data: users } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

    if (users && users.length > 0) {
        list.innerHTML = users.map(u => `
            <tr>
                <td>${u.full_name}</td>
                <td style="text-transform:capitalize">${u.role}</td>
                <td>${u.email}</td>
                <td>${new Date(u.created_at).toLocaleDateString()}</td>
                <td>
                    <button class="btn btn-sm btn-secondary" style="color:#ef4444; border-color: rgba(239, 68, 68, 0.5);" onclick="adminDeleteUser('${u.id}')">Delete</button>
                </td>
            </tr>
        `).join('');
    } else {
        list.innerHTML = '<tr><td colspan="5" class="text-center">No users found.</td></tr>';
    }
}

async function loadAdminOpps() {
    const list = document.getElementById('admin-opps-list');

    const { data: opps } = await supabase
        .from('opportunities')
        .select('*, organizations(organization_name)')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(10);

    if (opps && opps.length > 0) {
        list.innerHTML = opps.map(opp => `
            <tr>
                <td>${opp.title}</td>
                <td>${opp.organizations?.organization_name || 'N/A'}</td>
                <td>${new Date(opp.date).toLocaleDateString()}</td>
                <td>
                    <button class="btn btn-sm btn-secondary" style="color:#ef4444; border-color: rgba(239, 68, 68, 0.5);" onclick="adminDeleteOpp('${opp.id}')">Delete</button>
                </td>
            </tr>
        `).join('');
    } else {
        list.innerHTML = '<tr><td colspan="4" class="text-center">No active opportunities.</td></tr>';
    }
}
