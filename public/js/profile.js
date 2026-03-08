import { supabase, signOut, getUserProfile } from './supabase-client.js';

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Check Auth (allow guests to view public profiles)
    const { data: { user } } = await supabase.auth.getUser();

    // 2. Determine whose profile to display
    //    URL schema: profile.html?id=<uuid>
    //    If no ?id param, show the logged-in user's own profile (redirect if not logged in)
    const params = new URLSearchParams(window.location.search);
    const profileId = params.get('id');

    if (!profileId && !user) {
        // No ID in URL and not logged in → redirect to login
        window.location.href = 'login.html';
        return;
    }

    const targetUserId = profileId || user.id;
    const isOwnProfile = user && user.id === targetUserId;

    // 3. Show/hide Edit button depending on ownership
    const openEditBtn = document.getElementById('open-edit-btn');
    if (!isOwnProfile) {
        openEditBtn.style.display = 'none';
    }

    // 4. Load the target profile
    await loadProfile(targetUserId);

    // 5. Share Profile — builds URL with the user's UUID
    document.getElementById('share-profile-btn').onclick = () => {
        const shareUrl = `${window.location.origin}${window.location.pathname}?id=${targetUserId}`;
        navigator.clipboard.writeText(shareUrl).then(() => {
            const btn = document.getElementById('share-profile-btn');
            const original = btn.textContent;
            btn.textContent = '✓ Link Copied!';
            btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
            setTimeout(() => {
                btn.textContent = original;
                btn.style.background = '';
            }, 2500);
        }).catch(() => {
            // Fallback for browsers that block clipboard without HTTPS
            prompt('Copy this link:', shareUrl);
        });
    };

    // 6. Edit Profile Logic (only relevant when viewing own profile)
    if (isOwnProfile) {
        const editModal = document.getElementById('edit-modal');
        openEditBtn.onclick = () => editModal.classList.add('open');

        document.getElementById('edit-profile-form').onsubmit = async (e) => {
            e.preventDefault();
            const saveBtn = document.getElementById('save-profile-btn');
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';

            const updates = {
                full_name: document.getElementById('edit-name').value,
                phone: document.getElementById('edit-phone').value,
                location: document.getElementById('edit-location').value,
                bio: document.getElementById('edit-bio').value,
                skills: document.getElementById('edit-skills').value
                    .split(',')
                    .map(s => s.trim())
                    .filter(s => s !== '')
            };

            const { error } = await supabase
                .from('users')
                .update(updates)
                .eq('id', user.id);

            if (error) {
                console.error('Update error:', error);
                alert('Error updating profile: ' + error.message);
            } else {
                editModal.classList.remove('open');
                await loadProfile(user.id);
            }

            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Changes';
        };
    }

    // 7. Logout
    document.getElementById('nav-logout').onclick = async (e) => {
        e.preventDefault();
        await signOut();
        window.location.href = 'index.html';
    };
});

async function loadProfile(userId) {
    const { data: profile, error } = await getUserProfile(userId);

    if (error || !profile) {
        console.error('Profile fetch error', error);
        document.getElementById('profile-name').textContent = 'Profile not found';
        return;
    }

    // Update page title to show the user's name
    document.title = `${profile.full_name} — VolunteerHub`;

    // Header & Avatar
    document.getElementById('profile-name').textContent = profile.full_name;

    const avatarEl = document.getElementById('profile-avatar');
    if (profile.avatar_url) {
        avatarEl.style.backgroundImage = `url(${profile.avatar_url})`;
        avatarEl.style.backgroundSize = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        avatarEl.textContent = '';
    } else {
        avatarEl.textContent = profile.full_name.charAt(0).toUpperCase();
    }

    document.getElementById('profile-role-badge').textContent = profile.role.toUpperCase();

    // Stats (calculated from participation_records)
    const { data: records } = await supabase
        .from('participation_records')
        .select('hours_completed')
        .eq('volunteer_id', userId);

    const totalHours = records
        ? records.reduce((acc, curr) => acc + (Number(curr.hours_completed) || 0), 0)
        : 0;
    document.getElementById('stat-hours').textContent = totalHours;
    document.getElementById('stat-projects').textContent = records ? records.length : 0;

    // Contact Info
    document.getElementById('info-email').textContent = profile.email;
    document.getElementById('info-phone').textContent = profile.phone || 'Not provided';
    document.getElementById('info-location').textContent = profile.location || 'Not specified';
    document.getElementById('info-joined').textContent = new Date(profile.created_at).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    });

    // Bio
    document.getElementById('profile-bio').textContent =
        profile.bio || 'No bio provided yet.';

    // Skills
    const skillsList = document.getElementById('skills-list');
    skillsList.innerHTML = '';
    if (profile.skills && profile.skills.length > 0) {
        profile.skills.forEach(skill => {
            const span = document.createElement('span');
            span.className = 'badge';
            span.textContent = skill;
            skillsList.appendChild(span);
        });
    } else {
        skillsList.innerHTML = '<p style="color:var(--text-muted); font-size:0.9rem;">No skills listed.</p>';
    }

    // Populate Edit Form fields (only matters if edit modal is shown)
    document.getElementById('edit-name').value = profile.full_name;
    document.getElementById('edit-phone').value = profile.phone || '';
    document.getElementById('edit-location').value = profile.location || '';
    document.getElementById('edit-bio').value = profile.bio || '';
    document.getElementById('edit-skills').value = profile.skills ? profile.skills.join(', ') : '';
}
