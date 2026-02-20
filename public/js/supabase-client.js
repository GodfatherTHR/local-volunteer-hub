
const supabaseUrl = 'https://qngxgbwcfsbcwxjjaqgk.supabase.co'
const supabaseKey = 'sb_publishable_Q0yjTExN7XeSGaQze0cl4g_c5fonnZh'
const client = supabase.createClient(supabaseUrl, supabaseKey)

// Export the client for use in other modules
export { client as supabase };

export const signUp = async (email, password, fullName, role) => {
    // 1. Sign up with Supabase Auth
    const { data: authData, error: authError } = await client.auth.signUp({
        email,
        password,
    });

    if (authError) return { error: authError };

    // 2. Create user profile in 'users' table
    if (authData.user) {
        const { error: profileError } = await client
            .from('users')
            .insert([
                {
                    id: authData.user.id,
                    email: email,
                    full_name: fullName,
                    role: role,
                    password_hash: 'managed_by_supabase' // User schema has this, but Supabase handles auth. We just put a placeholder.
                }
            ]);

        if (profileError) {
            // Rollback (delete auth user) is hard from client. 
            // Just return error.
            console.error("Profile creation failed", profileError);
            return { error: profileError, user: authData.user };
        }
    }

    return { data: authData, error: null };
};

export const signIn = async (email, password) => {
    const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
    });
    return { data, error };
};

export const signOut = async () => {
    const { error } = await client.auth.signOut();
    return { error };
};

export const getUserProfile = async (userId) => {
    const { data, error } = await client
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();
    return { data, error };
};

// Helper to get current user
export const getCurrentUser = async () => {
    const { data: { user } } = await client.auth.getUser();
    return user;
};

// Helper query function for opportunities
export const fetchOpportunities = async () => {
    // Assuming 'opportunities' table exists as per schema
    const { data, error } = await client
        .from('opportunities')
        .select(`
            *,
            organizations (
                organization_name
            )
        `)
        .eq('status', 'active')
        .limit(3);

    if (error) {
        console.error('Error fetching opportunities:', error);
        return [];
    }
    return data;
};
