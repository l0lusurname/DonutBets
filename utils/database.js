const { createClient } = require('@supabase/supabase-js');

// Handle URL format - fallback to correct URL if environment variable is malformed
const supabaseUrl = process.env.SUPABASE_URL && process.env.SUPABASE_URL.startsWith('http') 
    ? process.env.SUPABASE_URL 
    : 'https://vfltbqpabgvbbxuezaah.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

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
                    balance: 0, // Starting balance: 0
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

// Casino bank balance functions
async function getCasinoBankBalance() {
    try {
        const { data, error } = await supabase
            .from('casino_settings')
            .select('bank_balance')
            .eq('id', 1)
            .maybeSingle();

        if (error) throw error;
        return data?.bank_balance || 100000000; // Default 100M
    } catch (error) {
        console.error('Error getting casino bank balance:', error);
        return 100000000; // Default fallback
    }
}

async function setCasinoBankBalance(amount) {
    try {
        const { data, error } = await supabase
            .from('casino_settings')
            .upsert({
                id: 1,
                bank_balance: amount,
                updated_at: new Date()
            }, {
                onConflict: 'id'
            });

        if (error) throw error;
        return true;
    } catch (error) {
        console.error('Error setting casino bank balance:', error);
        return false;
    }
}

async function updateCasinoBankBalance(amount) {
    try {
        const currentBalance = await getCasinoBankBalance();
        const newBalance = currentBalance + amount;
        
        const { error } = await supabase
            .from('casino_settings')
            .upsert({
                id: 1,
                bank_balance: newBalance,
                updated_at: new Date()
            }, {
                onConflict: 'id'
            });

        if (error) throw error;
        return newBalance;
    } catch (error) {
        console.error('Error updating casino bank balance:', error);
        return false;
    }
}

// Get casino settings (house edge, max bet %, payout cap)
async function getCasinoSettings() {
    try {
        const { data, error } = await supabase
            .from('casino_settings')
            .select('*')
            .eq('id', 1)
            .maybeSingle();

        if (error) throw error;
        return data || {
            bank_balance: 100000000,
            house_edge: 0.03,
            max_bet_percentage: 0.05,
            payout_cap: 500
        };
    } catch (error) {
        console.error('Error getting casino settings:', error);
        return {
            bank_balance: 100000000,
            house_edge: 0.03,
            max_bet_percentage: 0.05,
            payout_cap: 500
        };
    }
}

// Calculate maximum allowed bet based on house balance
async function getMaxBetAmount() {
    try {
        const settings = await getCasinoSettings();
        return Math.floor(settings.bank_balance * settings.max_bet_percentage);
    } catch (error) {
        console.error('Error calculating max bet:', error);
        return 500000; // Fallback 500K
    }
}

// Validate bet amount and potential payout
async function validateBetAndPayout(betAmount, potentialMultiplier) {
    try {
        const settings = await getCasinoSettings();
        const maxBet = Math.floor(settings.bank_balance * settings.max_bet_percentage);
        const potentialPayout = betAmount * potentialMultiplier;
        const maxAllowedPayout = Math.min(
            settings.payout_cap * betAmount,
            settings.bank_balance * 0.9
        );
        
        const validation = {
            isValid: true,
            reasons: []
        };
        
        if (betAmount > maxBet) {
            validation.isValid = false;
            validation.reasons.push(`Bet exceeds maximum (${formatCurrency(maxBet)})`);
        }
        
        if (potentialPayout > maxAllowedPayout) {
            validation.isValid = false;
            validation.reasons.push(`Potential payout too high (max: ${formatCurrency(maxAllowedPayout)})`);
        }
        
        return validation;
    } catch (error) {
        console.error('Error validating bet:', error);
        return { isValid: false, reasons: ['Validation error'] };
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
    updateWithdrawalStatus,
    getCasinoBankBalance,
    setCasinoBankBalance,
    updateCasinoBankBalance,
    getCasinoSettings,
    getMaxBetAmount,
    validateBetAndPayout
};