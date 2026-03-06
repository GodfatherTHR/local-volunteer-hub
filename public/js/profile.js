import { supabase, signOut, getUserProfile } from './supabase-client.js';

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Check Auth
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        window.location.href = 'login.html';
        return;
    }

    // 2. Load Profile Data
    await loadProfile(user.id);

    // 3. Edit Profile Logic
    const editModal = document.getElementById('edit-modal');
    document.getElementById('open-edit-btn').onclick = () => editModal.classList.add('open');

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
            // Simple comma split for skills
            skills: document.getElementById('edit-skills').value.split(',').map(s => s.trim()).filter(s => s !== '')
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

    // 4. Share Profile (Copy to clipboard)
    document.getElementById('share-profile-btn').onclick = () => {
        const url = window.location.href; // In a real app we might have /profile?id=...
        navigator.clipboard.writeText(url).then(() => {
            alert('Profile link copied to clipboard!');
        });
    };

    // 5. Logout
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
        return;
    }

    // Header & Avatar
    document.getElementById('profile-name').textContent = profile.full_name;
    document.getElementById('profile-avatar').textContent = profile.full_name.charAt(0);
    document.getElementById('profile-role-badge').textContent = profile.role.toUpperCase();

    // Stats (calculated from participation_records)
    const { data: records } = await supabase
        .from('participation_records')
        .select('hours_completed')
        .eq('volunteer_id', userId);

    const totalHours = records ? records.reduce((acc, curr) => acc + (Number(curr.hours_completed) || 0), 0) : 0;
    document.getElementById('stat-hours').textContent = totalHours;
    document.getElementById('stat-projects').textContent = records ? records.length : 0;

    // Contact Info
    document.getElementById('info-email').textContent = profile.email;
    document.getElementById('info-phone').textContent = profile.phone || 'Not provided';
    document.getElementById('info-location').textContent = profile.location || 'Not specified';
    document.getElementById('info-joined').textContent = new Date(profile.created_at).toLocaleDateString();

    // Bio
    document.getElementById('profile-bio').textContent = profile.bio || 'No bio provided yet. Tell the community about your passion for volunteering!';

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

    // Populate Edit Form
    document.getElementById('edit-name').value = profile.full_name;
    document.getElementById('edit-phone').value = profile.phone || '';
    document.getElementById('edit-location').value = profile.location || '';
    document.getElementById('edit-bio').value = profile.bio || '';
    document.getElementById('edit-skills').value = profile.skills ? profile.skills.join(', ') : '';
}
