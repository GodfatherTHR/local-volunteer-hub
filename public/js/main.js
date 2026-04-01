import { getCurrentUser, fetchOpportunities } from './supabase-client.js';

document.addEventListener('DOMContentLoaded', () => {
    initAuthUI();
    initFeaturedOpportunities();
    initHeroSlider();
    initCounters();
});

async function initAuthUI() {
    try {
        const user = await getCurrentUser();
        if (!user) return;

        const navLinks = document.querySelector('.nav-links');
        if (!navLinks) return;

        // Replace Login/Register buttons
        const loginBtn = document.querySelector('a[href="login.html"]');
        const registerBtn = document.querySelector('a[href="register.html"]');

        if (loginBtn) loginBtn.remove();
        if (registerBtn) registerBtn.remove();

        // Add Dashboard link
        const dashboardBtn = document.createElement('a');
        dashboardBtn.href = 'dashboard.html';
        dashboardBtn.className = 'nav-link';
        dashboardBtn.textContent = 'Dashboard';
        navLinks.appendChild(dashboardBtn);

        // Add Profile link
        const profileBtn = document.createElement('a');
        profileBtn.href = 'profile.html';
        profileBtn.className = 'nav-link';
        profileBtn.textContent = 'My Profile';
        navLinks.appendChild(profileBtn);

        // Add Logout button
        const logoutBtn = document.createElement('a');
        logoutBtn.href = '#';
        logoutBtn.className = 'btn btn-secondary';
        logoutBtn.textContent = 'Logout';
        logoutBtn.onclick = async (e) => {
            e.preventDefault();
            const { signOut } = await import('./supabase-client.js');
            await signOut();
            window.location.reload();
        };
        navLinks.appendChild(logoutBtn);
    } catch (err) {
        console.error('Auth UI Init Error:', err);
    }
}

async function initFeaturedOpportunities() {
    const featuredContainer = document.getElementById('featured-opportunities');
    if (!featuredContainer) return;

    try {
        const opps = await fetchOpportunities();

        if (opps && opps.length > 0) {
            featuredContainer.innerHTML = ''; // Clear loading state
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
            featuredContainer.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 3rem;">
                    <p style="color: var(--text-muted); font-size: 1.1rem;">No active opportunities found at the moment.</p>
                </div>
            `;
        }
    } catch (err) {
        console.error('Fetch Opportunities Error:', err);
        featuredContainer.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 3rem;">
                <p style="color: #ef4444;">Unable to load opportunities. Please try again later.</p>
                <button onclick="window.location.reload()" class="btn btn-secondary" style="margin-top: 1rem;">Retry</button>
            </div>
        `;
    }
}

function initHeroSlider() {
    const slides = document.querySelectorAll('.slide');
    if (slides.length > 0) {
        let currentSlide = 0;
        setInterval(() => {
            slides[currentSlide].classList.remove('active');
            currentSlide = (currentSlide + 1) % slides.length;
            slides[currentSlide].classList.add('active');
        }, 5000);
    }
}

function initCounters() {
    const counters = document.querySelectorAll('.counter');
    if (counters.length === 0) return;

    const runCounter = () => {
        counters.forEach(counter => {
            const target = +counter.getAttribute('data-target');
            const duration = 2000; // 2 seconds
            const startTime = performance.now();

            const updateCount = (currentTime) => {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                
                // Ease out function for smoother finish
                const easedProgress = 1 - Math.pow(1 - progress, 3);
                const currentCount = Math.floor(easedProgress * target);

                counter.innerText = currentCount;

                if (progress < 1) {
                    requestAnimationFrame(updateCount);
                } else {
                    counter.innerText = target;
                }
            };
            requestAnimationFrame(updateCount);
        });
    };

    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            runCounter();
            observer.disconnect();
        }
    }, { threshold: 0.5 });

    const statsSection = document.querySelector('.hero-stats');
    if (statsSection) observer.observe(statsSection);
}
