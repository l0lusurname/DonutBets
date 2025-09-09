const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('withdraw')
        .setDescription('Request to withdraw credits'),
    
    async execute(interaction) {
        try {
            const embed = new EmbedBuilder()
                .setTitle('💸 Withdrawal Request')
                .setDescription('Click the button below to start your withdrawal request. You\'ll need to specify the amount and your in-game username.')
                .setColor('#FFA500')
                .setThumbnail(interaction.user.displayAvatarURL())
                .setTimestamp();
            
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('withdraw_start')
                        .setLabel('💸 Start Withdrawal')
                        .setStyle(ButtonStyle.Primary)
                );
            
            await interaction.reply({ embeds: [embed], components: [row] });
            
        } catch (error) {
            console.error('Withdraw command error:', error);
            await interaction.reply({ content: 'Failed to start withdrawal process.', flags: 64 });
        }
    }
};