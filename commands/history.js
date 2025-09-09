const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { ensureUserExists, getUserHistory, formatCurrency } = require('../utils/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('history')
        .setDescription('View your last 10 games'),
    
    async execute(interaction) {
        try {
            await ensureUserExists(interaction.user.id, interaction.user.username);
            const history = await getUserHistory(interaction.user.id, 10);
            
            if (history.length === 0) {
                const embed = new EmbedBuilder()
                    .setTitle('📊 Game History')
                    .setDescription('No games played yet.')
                    .setColor('#808080')
                    .setThumbnail(interaction.user.displayAvatarURL());
                    
                await interaction.reply({ embeds: [embed] });
                return;
            }
            
            const embed = new EmbedBuilder()
                .setTitle('📊 Game History')
                .setDescription(`Last ${history.length} games`)
                .setColor('#4169E1')
                .setThumbnail(interaction.user.displayAvatarURL())
                .setTimestamp();
            
            for (let i = 0; i < Math.min(history.length, 10); i++) {
                const game = history[i];
                const outcome = game.outcome === 'Win' ? '🟢' : '🔴';
                const profit = game.profit_loss >= 0 ? `+${formatCurrency(game.profit_loss)}` : formatCurrency(game.profit_loss);
                const date = new Date(game.created_at).toLocaleDateString();
                
                embed.addFields({
                    name: `${outcome} ${game.game_type} - ${date}`,
                    value: `Bet: ${formatCurrency(game.bet_amount)} | Multiplier: ${game.multiplier}x | ${profit}`,
                    inline: false
                });
            }
            
            await interaction.reply({ embeds: [embed] });
            
        } catch (error) {
            console.error('History command error:', error);
            await interaction.reply({ content: 'Failed to retrieve game history.', ephemeral: true });
        }
    }
};