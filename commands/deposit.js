const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { ensureUserExists, getUserBalance, updateUserBalance, formatCurrency, parseCurrency } = require('../utils/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deposit')
        .setDescription('Add fake credits to your balance')
        .addStringOption(option =>
            option.setName('amount')
                .setDescription('Amount to deposit (use K/M/B format)')
                .setRequired(true)
        ),
    
    async execute(interaction) {
        try {
            const amountInput = interaction.options.getString('amount');
            const amount = parseCurrency(amountInput);
            
            if (amount <= 0 || amount > 1000000000) { // Max 1B deposit
                await interaction.reply({ content: 'Invalid amount. Must be between 1 and 1B.', flags: 64 });
                return;
            }
            
            await ensureUserExists(interaction.user.id, interaction.user.username);
            const currentBalance = await getUserBalance(interaction.user.id);
            const newBalance = currentBalance + amount;
            
            await updateUserBalance(interaction.user.id, newBalance);
            
            const embed = new EmbedBuilder()
                .setTitle('💳 Deposit Successful')
                .setDescription(`Added **${formatCurrency(amount)}** to your balance`)
                .addFields(
                    { name: '💰 New Balance', value: formatCurrency(newBalance), inline: true }
                )
                .setColor('#00FF00')
                .setThumbnail(interaction.user.displayAvatarURL())
                .setTimestamp();
            
            await interaction.reply({ embeds: [embed] });
            
        } catch (error) {
            console.error('Deposit command error:', error);
            await interaction.reply({ content: 'Failed to process deposit.', flags: 64 });
        }
    }
};