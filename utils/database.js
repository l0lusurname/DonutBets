const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Ensure user exists in database
async function ensureUserExists(userId, username) {
    try {
        const { data: existingUser } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();

        if (!existingUser) {
            const { data, error } = await supabase
                .from('users')
                .insert({
                    id: userId,
                    username: username,
                    balance: 10000, // Starting balance: 10K
                    created_at: new Date()
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        }

        return existingUser;
    } catch (error) {
        console.error('Error ensuring user exists:', error);
        throw error;
    }
}

// Get user balance
async function getUserBalance(userId) {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('balance')
            .eq('id', userId)
            .maybeSingle();

        if (error) throw error;
        return data?.balance || 0;
    } catch (error) {
        console.error('Error getting user balance:', error);
        return 0;
    }
}

// Update user balance
async function updateUserBalance(userId, newBalance) {
    try {
        const { error } = await supabase
            .from('users')
            .update({ balance: newBalance })
            .eq('id', userId);

        if (error) throw error;
        return true;
    } catch (error) {
        console.error('Error updating user balance:', error);
        return false;
    }
}

// Log game result
async function logGame(userId, gameType, betAmount, outcome, multiplier, profitLoss, seed) {
    try {
        const { error } = await supabase
            .from('games')
            .insert({
                user_id: userId,
                game_type: gameType,
                bet_amount: betAmount,
                outcome: outcome,
                multiplier: multiplier,
                profit_loss: profitLoss,
                seed: seed,
                created_at: new Date()
            });

        if (error) throw error;
        return true;
    } catch (error) {
        console.error('Error logging game:', error);
        return false;
    }
}

// Get user game history
async function getUserHistory(userId, limit = 10) {
    try {
        const { data, error } = await supabase
            .from('games')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Error getting user history:', error);
        return [];
    }
}

// Format currency (K, M, B)
function formatCurrency(amount) {
    if (amount >= 1000000000) {
        return (amount / 1000000000).toFixed(2).replace(/\.00$/, '') + 'B';
    } else if (amount >= 1000000) {
        return (amount / 1000000).toFixed(2).replace(/\.00$/, '') + 'M';
    } else if (amount >= 1000) {
        return (amount / 1000).toFixed(2).replace(/\.00$/, '') + 'K';
    }
    return amount.toString();
}

// Parse currency format back to number
function parseCurrency(input) {
    const str = input.toString().toUpperCase();
    const num = parseFloat(str);
    
    if (str.includes('K')) {
        return Math.floor(num * 1000);
    } else if (str.includes('M')) {
        return Math.floor(num * 1000000);
    } else if (str.includes('B')) {
        return Math.floor(num * 1000000000);
    }
    
    return Math.floor(num);
}

// Log withdrawal request
async function logWithdrawal(userId, amount, status = 'Pending') {
    try {
        const { data, error } = await supabase
            .from('withdrawals')
            .insert({
                user_id: userId,
                amount: amount,
                status: status,
                created_at: new Date()
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('Error logging withdrawal:', error);
        return null;
    }
}

// Update withdrawal status
async function updateWithdrawalStatus(withdrawalId, status) {
    try {
        const { error } = await supabase
            .from('withdrawals')
            .update({ 
                status: status,
                updated_at: new Date()
            })
            .eq('id', withdrawalId);

        if (error) throw error;
        return true;
    } catch (error) {
        console.error('Error updating withdrawal status:', error);
        return false;
    }
}

module.exports = {
    supabase,
    ensureUserExists,
    getUserBalance,
    updateUserBalance,
    logGame,
    getUserHistory,
    formatCurrency,
    parseCurrency,
    logWithdrawal,
    updateWithdrawalStatus
};