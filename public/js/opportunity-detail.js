import { supabase, getCurrentUser } from './supabase-client.js';

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Get ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const oppId = urlParams.get('id');

    if (!oppId) {
        window.location.href = 'opportunities.html';
        return;
    }

    // 2. Fetch Details
    const { data: opp, error } = await supabase
        .from('opportunities')
        .select(`
            *,
            organizations ( organization_name )
        `)
        .eq('id', oppId)
        .single();

    if (error || !opp) {
        console.error('Error fetching details:', error);
        document.getElementById('loading').innerHTML = '<h1>Opportunity not found.</h1>';
        return;
    }

    // 3. Render
    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = 'block';

    document.title = `${opp.title} - VolunteerHub`;
    document.getElementById('org-name').textContent = opp.organizations?.organization_name || 'Organization';
    document.getElementById('opp-title').textContent = opp.title;
    document.getElementById('opp-desc').textContent = opp.description;

    document.getElementById('opp-location').textContent = opp.location || 'Remote';
    document.getElementById('opp-date').textContent = new Date(opp.date).toLocaleDateString();
    document.getElementById('opp-time').textContent = opp.start_time ? `${opp.start_time.slice(0, 5)} - ${opp.end_time.slice(0, 5)}` : 'Flexible';
    document.getElementById('opp-slots').textContent = `${opp.slots_available} slots available`;

    const applyBtn = document.getElementById('apply-btn');
    applyBtn.onclick = () => {
        document.getElementById('opp-id-input').value = opp.id;
        document.getElementById('modal-opp-title').textContent = opp.title;
        document.getElementById('apply-modal').classList.add('open');
    }

    // 4. Handle Application
    document.getElementById('apply-form').onsubmit = async (e) => {
        e.preventDefault();
        const user = await getCurrentUser();

        if (!user) {
            alert('Please login to apply.');
            window.location.href = `login.html?redirect=opportunity.html?id=${oppId}`;
            return;
        }

        const modal = document.getElementById('apply-modal');
        modal.classList.remove('open');

        try {
            const { error: applyError } = await supabase
                .from('applications')
                .insert([{
                    volunteer_id: user.id,
                    opportunity_id: oppId,
                    status: 'pending'
                }]);

            if (applyError) {
                if (applyError.code === '23505') {
                    alert('You have already applied for this opportunity.');
                } else {
                    console.error(applyError);
                    alert('Error submitting application: ' + applyError.message);
                }
            } else {
                alert('Application submitted successfully!');
            }
        } catch (err) {
            console.error(err);
            alert('Unexpected error.');
        }
    };
});
