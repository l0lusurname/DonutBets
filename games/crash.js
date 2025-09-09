const { EmbedBuilder } = require('discord.js');
const { getUserBalance, updateUserBalance, logGame, formatCurrency } = require('../utils/database');
const { generateSeed, generateCrashMultiplier } = require('../utils/provablyFair');

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
    const crashPoint = generateCrashMultiplier(seed);
    const cashoutPoint = Math.random() * (crashPoint - 1) + 1; // Random cashout
    
    const won = cashoutPoint < crashPoint;
    const multiplier = won ? parseFloat(cashoutPoint.toFixed(2)) : 0;
    const winAmount = Math.floor(betAmount * multiplier);
    const profit = winAmount - betAmount;
    
    await updateUserBalance(userId, balance - betAmount + winAmount);
    await logGame(userId, 'Crash', betAmount, won ? 'Win' : 'Loss', multiplier, profit, seed.hash);
    
    const embed = new EmbedBuilder()
        .setTitle('🚀 Crash Result')
        .setDescription(`Crashed at: ${crashPoint}x\n${won ? `🎉 Cashed out at ${cashoutPoint}x! +${formatCurrency(profit)}` : `💥 Crashed before cashout!`}`)
        .setColor(won ? '#00FF00' : '#FF0000');
    
    await interaction.reply({ embeds: [embed] });
}

module.exports = { handleButton };