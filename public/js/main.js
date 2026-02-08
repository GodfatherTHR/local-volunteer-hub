import { getCurrentUser, fetchOpportunities } from './supabase-client.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Check Auth State to update UI
    const user = await getCurrentUser();
    const navLinks = document.querySelector('.nav-links');

    if (user) {
        // Replace Login/Register with dashboard link
        // This is a naive implementation, meant to be replaced by a more robust state manager if complex
        const loginBtn = document.querySelector('a[href="login.html"]');
        const registerBtn = document.querySelector('a[href="register.html"]');

        if (loginBtn) loginBtn.remove();
        if (registerBtn) registerBtn.remove();

        const dashboardBtn = document.createElement('a');
        dashboardBtn.href = 'dashboard.html';
        dashboardBtn.className = 'btn btn-primary';
        dashboardBtn.textContent = 'Dashboard';
        navLinks.appendChild(dashboardBtn);
    }

    // Load Featured Opportunities
    const featuredContainer = document.getElementById('featured-opportunities');
    if (featuredContainer) {
        const opps = await fetchOpportunities();

        if (opps && opps.length > 0) {
            featuredContainer.innerHTML = ''; // Clear loading
            opps.forEach(opp => {
                const card = document.createElement('div');
                card.className = 'glass-card opportunity-card';
                card.innerHTML = `
                    <h3>${opp.title}</h3>
                    <p class="org-name">${opp.organizations ? opp.organizations.organization_name : 'Local Org'}</p>
                    <p class="desc">${opp.description.substring(0, 100)}...</p>
                    <div class="meta">
                        <span>📍 ${opp.location || 'Remote'}</span>
                        <span>📅 ${new Date(opp.date).toLocaleDateString()}</span>
                    </div>
                    <a href="opportunity.html?id=${opp.id}" class="btn btn-sm btn-outline" style="margin-top: 1rem;">View Details</a>
                `;
                featuredContainer.appendChild(card);
            });
        } else {
            featuredContainer.innerHTML = '<p class="text-center" style="grid-column: 1/-1;">No active opportunities found at the moment.</p>';
        }
    }
});
