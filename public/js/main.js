import { getCurrentUser, fetchOpportunities } from './supabase-client.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Check Auth State to update UI
    const user = await getCurrentUser();
    const navLinks = document.querySelector('.nav-links');

    if (user) {
        // Replace Login/Register with user menu
        const loginBtn = document.querySelector('a[href="login.html"]');
        const registerBtn = document.querySelector('a[href="register.html"]');

        if (loginBtn) loginBtn.remove();
        if (registerBtn) registerBtn.remove();

        // Create Dashboard link
        const dashboardBtn = document.createElement('a');
        dashboardBtn.href = 'dashboard.html';
        dashboardBtn.className = 'nav-link';
        dashboardBtn.textContent = 'Dashboard';
        navLinks.appendChild(dashboardBtn);

        // Create Profile link
        const profileBtn = document.createElement('a');
        profileBtn.href = 'profile.html';
        profileBtn.className = 'nav-link';
        profileBtn.textContent = 'My Profile';
        navLinks.appendChild(profileBtn);

        // Create Logout button
        const logoutBtn = document.createElement('a');
        logoutBtn.href = '#';
        logoutBtn.className = 'btn btn-secondary';
        logoutBtn.textContent = 'Logout';
        logoutBtn.onclick = async (e) => {
            e.preventDefault();
            import('./supabase-client.js').then(async (module) => {
                await module.signOut();
                window.location.reload();
            });
        };
        navLinks.appendChild(logoutBtn);
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
                    <div class="opportunity-card-content">
                        <p class="org-name">${opp.organizations ? opp.organizations.organization_name : 'Local Org'}</p>
                        <h3>${opp.title}</h3>
                        <p class="desc">${opp.description.substring(0, 120)}...</p>
                        <div class="meta">
                            <span>📍 ${opp.location || 'Remote'}</span>
                            <span>📅 ${new Date(opp.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                        </div>
                        <div style="margin-top: 1.5rem;">
                            <a href="opportunity.html?id=${opp.id}" class="btn btn-primary w-100">View Details</a>
                        </div>
                    </div>
                `;
                featuredContainer.appendChild(card);
            });
        } else {
            featuredContainer.innerHTML = '<p class="text-center" style="grid-column: 1/-1;">No active opportunities found at the moment.</p>';
        }
    }

    // Hero Slider Logic
    const slides = document.querySelectorAll('.slide');
    if (slides.length > 0) {
        let currentSlide = 0;
        setInterval(() => {
            slides[currentSlide].classList.remove('active');
            currentSlide = (currentSlide + 1) % slides.length;
            slides[currentSlide].classList.add('active');
        }, 5000); // Change image every 5 seconds
    }
});
