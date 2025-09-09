const { EmbedBuilder } = require('discord.js');
const { getUserBalance, updateUserBalance, logGame, formatCurrency } = require('../utils/database');
const { generateSeed } = require('../utils/provablyFair');

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
    // Simplified towers - random win/loss
    const won = Math.random() > 0.5;
    const multiplier = won ? 2.5 : 0;
    const winAmount = Math.floor(betAmount * multiplier);
    const profit = winAmount - betAmount;
    
    await updateUserBalance(userId, balance - betAmount + winAmount);
    await logGame(userId, 'Towers', betAmount, won ? 'Win' : 'Loss', multiplier, profit, seed.hash);
    
    const embed = new EmbedBuilder()
        .setTitle('🗼 Towers Result')
        .setDescription(won ? `🎉 You climbed the tower! +${formatCurrency(profit)}` : '💸 You fell! Try again!')
        .setColor(won ? '#00FF00' : '#FF0000');
    
    await interaction.reply({ embeds: [embed] });
}

module.exports = { handleButton };