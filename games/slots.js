const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserBalance, updateUserBalance, logGame, formatCurrency } = require('../utils/database');
const { generateSeed, generateSlotResults } = require('../utils/provablyFair');

async function handleButton(interaction, params) {
    const [action] = params;
    
    if (action === 'start') {
        await startGame(interaction, 1000); // Default 1K bet
    }
}

async function startGame(interaction, betAmount) {
    const userId = interaction.user.id;
    const balance = await getUserBalance(userId);
    
    if (balance < betAmount) {
        await interaction.reply({ content: 'Insufficient balance!', ephemeral: true });
        return;
    }
    
    const seed = generateSeed();
    const results = generateSlotResults(seed);
    
    // Simple payout logic
    let multiplier = 0;
    const grid = [
        [results[0], results[1], results[2]],
        [results[3], results[4], results[5]],
        [results[6], results[7], results[8]]
    ];
    
    // Check for wins (simplified)
    if (results[4] === '7️⃣') multiplier = 5;
    else if (results[0] === results[4] && results[4] === results[8]) multiplier = 3;
    else if (results[2] === results[4] && results[4] === results[6]) multiplier = 3;
    else if (results[0] === results[1] && results[1] === results[2]) multiplier = 2;
    
    const winAmount = Math.floor(betAmount * multiplier);
    const profit = winAmount - betAmount;
    
    await updateUserBalance(userId, balance - betAmount + winAmount);
    await logGame(userId, 'Slots', betAmount, multiplier > 0 ? 'Win' : 'Loss', multiplier, profit, seed.hash);
    
    const embed = new EmbedBuilder()
        .setTitle('🎰 Slots Result')
        .setDescription(`${grid[0].join(' ')}\n${grid[1].join(' ')}\n${grid[2].join(' ')}\n\n${multiplier > 0 ? `🎉 Win! +${formatCurrency(profit)}` : '💸 Try again!'}`)
        .setColor(multiplier > 0 ? '#00FF00' : '#FF0000');
    
    await interaction.reply({ embeds: [embed] });
}

module.exports = { handleButton };