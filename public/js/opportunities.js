import { supabase, getCurrentUser } from './supabase-client.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Auth-aware navbar
    const user = await getCurrentUser();
    if (user) {
        const navLinks = document.querySelector('.nav-links');
        navLinks.innerHTML = `
            <a href="dashboard.html" class="nav-link">Dashboard</a>
            <a href="profile.html" class="nav-link">My Profile</a>
            <a href="#" class="btn btn-secondary" id="nav-logout">Logout</a>
        `;
        document.getElementById('nav-logout').onclick = async (e) => {
            e.preventDefault();
            const { signOut } = await import('./supabase-client.js');
            await signOut();
            window.location.reload();
        };
    } else {
        const navLinks = document.querySelector('.nav-links');
        navLinks.innerHTML = `
            <a href="opportunities.html" class="nav-link">Opportunities</a>
            <a href="organizations.html" class="nav-link">Organizations</a>
            <a href="login.html" class="btn btn-secondary">Log In</a>
            <a href="register.html" class="btn btn-primary">Join Now</a>
        `;
    }

    loadOpportunities();

    // Search Logic
    document.getElementById('search-btn').addEventListener('click', () => {
        const query = document.getElementById('search-input').value;
        const loc = document.getElementById('location-filter').value;
        loadOpportunities(query, loc);
    });

    // Handle Application Submit
    document.getElementById('apply-form').onsubmit = async (e) => {
        e.preventDefault();
        const user = await getCurrentUser();
        if (!user) {
            alert('Please login to apply.');
            window.location.href = 'login.html';
            return;
        }

        const oppId = document.getElementById('opp-id-input').value;

        // Optimistic UI for University Project demo
        const modal = document.getElementById('apply-modal');
        modal.classList.remove('open');

        try {
            const { error } = await supabase
                .from('applications')
                .insert([{
                    volunteer_id: user.id,
                    opportunity_id: oppId,
                    status: 'pending'
                }]);

            if (error) {
                if (error.code === '23505') { // Unique violation
                    alert('You have already applied for this opportunity.');
                } else {
                    console.error(error);
                    alert('Error submitting application.');
                }
            } else {
                alert('Application submitted successfully!');
            }
        } catch (err) {
            console.error(err);
        }
    };
});

async function loadOpportunities(searchPrefix = '', locationFilter = '') {
    const grid = document.getElementById('opportunities-grid');
    grid.innerHTML = '<div class="loading-state" style="grid-column: 1/-1; text-align: center;">Loading opportunities...</div>';

    let query = supabase
        .from('opportunities')
        .select(`
            id,
            title,
            description,
            location,
            date,
            slots_available,
            organization_id,
            organizations ( organization_name )
        `)
        .eq('status', 'active');

    if (searchPrefix) {
        query = query.ilike('title', `%${searchPrefix}%`);
    }

    // Note: Exact match for location in this simple demo
    if (locationFilter) {
        query = query.eq('location', locationFilter);
    }

    const { data: opportunities, error } = await query;

    if (error) {
        console.error('Error fetching opportunities:', error);
        grid.innerHTML = '<p>Error loading opportunities.</p>';
        return;
    }

    grid.innerHTML = '';

    if (opportunities.length === 0) {
        grid.innerHTML = '<p>No opportunities found.</p>';
        return;
    }

    opportunities.forEach(opp => {
        const card = document.createElement('div');
        card.className = 'glass-card opp-card';
        card.innerHTML = `
            <div class="opp-org-name">${opp.organizations?.organization_name || 'Organization'}</div>
            <a href="opportunity.html?id=${opp.id}" style="text-decoration:none; color:inherit;">
                <h3 class="opp-title">${opp.title}</h3>
            </a>
            <p style="color: var(--text-muted); flex-grow: 1;">${opp.description.substring(0, 150)}...</p>
            
            <div class="opp-details">
                <div class="opp-detail-item">
                    <span>📍</span> ${opp.location || 'Remote'}
                </div>
                <div class="opp-detail-item">
                    <span>📅</span> ${new Date(opp.date).toLocaleDateString()}
                </div>
                 <div class="opp-detail-item">
                    <span>👥</span> ${opp.slots_available} slots left
                </div>
            </div>

            <div class="action-row">
                <a href="opportunity.html?id=${opp.id}" class="btn btn-secondary">View Details</a>
                <button class="btn btn-primary btn-apply" data-id="${opp.id}" data-title="${opp.title}">Apply Now</button>
            </div>
        `;
        grid.appendChild(card);
    });

    // Bind Apply Buttons
    document.querySelectorAll('.btn-apply').forEach(btn => {
        btn.onclick = (e) => {
            const id = e.target.dataset.id;
            const title = e.target.dataset.title;
            openApplyModal(id, title);
        };
    });
}

function openApplyModal(id, title) {
    document.getElementById('opp-id-input').value = id;
    document.getElementById('modal-opp-title').textContent = title;
    document.getElementById('apply-modal').classList.add('open');
}
