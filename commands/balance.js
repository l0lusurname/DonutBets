const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { ensureUserExists, getUserBalance, formatCurrency } = require('../utils/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Check your current balance'),
    
    async execute(interaction) {
        try {
            await ensureUserExists(interaction.user.id, interaction.user.username);
            const balance = await getUserBalance(interaction.user.id);
            
            const embed = new EmbedBuilder()
                .setTitle('💰 Your Balance')
                .setDescription(`**${formatCurrency(balance)}** credits`)
                .setColor('#FFD700')
                .setThumbnail(interaction.user.displayAvatarURL())
                .setTimestamp();
            
            await interaction.reply({ embeds: [embed] });
            
        } catch (error) {
            console.error('Balance command error:', error);
            await interaction.reply({ content: 'Failed to retrieve balance.', flags: 64 });
        }
    }
};