
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { ensureUserExists, getUserBalance, updateUserBalance, formatCurrency, parseCurrency } = require('../utils/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pay')
        .setDescription('Transfer credits to another user')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('User to send credits to')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('amount')
                .setDescription('Amount to send (supports K/M/B format, e.g., 5K, 2.5M)')
                .setRequired(true)),
    
    async execute(interaction) {
        try {
            const sender = interaction.user;
            const recipient = interaction.options.getUser('user');
            const amountInput = interaction.options.getString('amount');

            // Validate recipient
            if (recipient.id === sender.id) {
                await interaction.reply({ 
                    content: '❌ You cannot send credits to yourself!', 
                    ephemeral: true 
                });
                return;
            }

            if (recipient.bot) {
                await interaction.reply({ 
                    content: '❌ You cannot send credits to bots!', 
                    ephemeral: true 
                });
                return;
            }

            // Parse amount
            let amount;
            try {
                amount = parseCurrency(amountInput);
            } catch (error) {
                await interaction.reply({ 
                    content: '❌ Invalid amount! Please enter a valid amount. Examples: `1000`, `5K`, `2.5M`, `1B`', 
                    ephemeral: true 
                });
                return;
            }

            // Minimum transfer amount
            if (amount < 1000) {
                await interaction.reply({ 
                    content: '❌ Minimum transfer amount is 1K credits!', 
                    ephemeral: true 
                });
                return;
            }

            // Ensure both users exist in database
            await ensureUserExists(sender.id, sender.username);
            await ensureUserExists(recipient.id, recipient.username);

            // Check sender balance
            const senderBalance = await getUserBalance(sender.id);
            if (senderBalance < amount) {
                await interaction.reply({ 
                    content: `❌ Insufficient balance! You have ${formatCurrency(senderBalance)} but need ${formatCurrency(amount)}.`, 
                    ephemeral: true 
                });
                return;
            }

            // Get recipient balance for display
            const recipientBalance = await getUserBalance(recipient.id);

            // Perform the transfer
            const newSenderBalance = senderBalance - amount;
            const newRecipientBalance = recipientBalance + amount;

            await updateUserBalance(sender.id, newSenderBalance);
            await updateUserBalance(recipient.id, newRecipientBalance);

            // Create success embed
            const embed = new EmbedBuilder()
                .setTitle('💸 Payment Sent')
                .setDescription(`Successfully sent ${formatCurrency(amount)} to ${recipient.tag}`)
                .setColor('#00FF00')
                .addFields(
                    { name: '👤 From', value: sender.tag, inline: true },
                    { name: '👤 To', value: recipient.tag, inline: true },
                    { name: '💰 Amount', value: formatCurrency(amount), inline: true },
                    { name: '💳 Your New Balance', value: formatCurrency(newSenderBalance), inline: false }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

            // Try to notify recipient if they're in the same guild
            try {
                const recipientMember = await interaction.guild.members.fetch(recipient.id);
                if (recipientMember) {
                    const notificationEmbed = new EmbedBuilder()
                        .setTitle('💰 Payment Received')
                        .setDescription(`You received ${formatCurrency(amount)} from ${sender.tag}`)
                        .setColor('#00FF00')
                        .addFields(
                            { name: '💳 Your New Balance', value: formatCurrency(newRecipientBalance), inline: false }
                        )
                        .setTimestamp();

                    await recipient.send({ embeds: [notificationEmbed] });
                }
            } catch (error) {
                // Silently fail if we can't notify the recipient
                console.log('Could not notify recipient:', error.message);
            }

        } catch (error) {
            console.error('Pay command error:', error);
            await interaction.reply({ 
                content: '❌ An error occurred while processing the payment.', 
                ephemeral: true 
            });
        }
    }
};
