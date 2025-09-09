const { 
    getUserBalance, 
    updateUserBalance, 
    logWithdrawal, 
    updateWithdrawalStatus, 
    formatCurrency, 
    parseCurrency 
} = require('./database');

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

// Handle withdraw button click (show modal)
async function handleButton(interaction, params) {
    if (interaction.customId === 'withdraw_start') {
        const modal = new ModalBuilder()
            .setCustomId('withdraw_modal')
            .setTitle('Withdrawal Request');

        const amountInput = new TextInputBuilder()
            .setCustomId('withdraw_amount')
            .setLabel('Amount to withdraw (use K/M/B format)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., 5K, 2.5M, 1B')
            .setRequired(true);

        const usernameInput = new TextInputBuilder()
            .setCustomId('withdraw_username')
            .setLabel('In-game username')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Your in-game username')
            .setRequired(true);

        const firstActionRow = new ActionRowBuilder().addComponents(amountInput);
        const secondActionRow = new ActionRowBuilder().addComponents(usernameInput);

        modal.addComponents(firstActionRow, secondActionRow);

        await interaction.showModal(modal);
    } else if (params[0] === 'approve' || params[0] === 'decline') {
        await handleOwnerResponse(interaction, params);
    }
}

// Handle modal submission
async function handleModal(interaction) {
    const amount = interaction.fields.getTextInputValue('withdraw_amount');
    const username = interaction.fields.getTextInputValue('withdraw_username');
    
    try {
        const parsedAmount = parseCurrency(amount);
        const userBalance = await getUserBalance(interaction.user.id);
        
        if (parsedAmount <= 0) {
            await interaction.reply({ content: 'Invalid amount specified.', flags: 64 });
            return;
        }
        
        if (parsedAmount > userBalance) {
            await interaction.reply({ 
                content: `Insufficient balance. You have ${formatCurrency(userBalance)} available.`, 
                flags: 64 
            });
            return;
        }
        
        // Log withdrawal request
        const withdrawal = await logWithdrawal(interaction.user.id, parsedAmount);
        
        if (!withdrawal) {
            await interaction.reply({ content: 'Failed to process withdrawal request.', flags: 64 });
            return;
        }
        
        // Send DM to server owner
        const owner = await interaction.client.users.fetch(process.env.SERVER_OWNER_ID);
        
        const embed = new EmbedBuilder()
            .setTitle('💳 Withdrawal Request')
            .setColor('#FFD700')
            .addFields(
                { name: '👤 User', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                { name: '💰 Amount', value: formatCurrency(parsedAmount), inline: true },
                { name: '🎮 Username', value: username, inline: true },
                { name: '💳 Current Balance', value: formatCurrency(userBalance), inline: true },
                { name: '📅 Requested', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
            )
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`withdraw_approve_${withdrawal.id}_${interaction.user.id}_${parsedAmount}`)
                    .setLabel('💰 Pay')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`withdraw_decline_${withdrawal.id}_${interaction.user.id}`)
                    .setLabel('❌ Decline')
                    .setStyle(ButtonStyle.Danger)
            );

        await owner.send({ embeds: [embed], components: [row] });
        
        await interaction.reply({ 
            content: `✅ Withdrawal request for **${formatCurrency(parsedAmount)}** has been sent to the server owner for approval.`, 
            flags: 64 
        });
        
    } catch (error) {
        console.error('Withdrawal modal error:', error);
        await interaction.reply({ content: 'Failed to process withdrawal request.', flags: 64 });
    }
}

// Handle owner response to withdrawal
async function handleOwnerResponse(interaction, params) {
    if (interaction.user.id !== process.env.SERVER_OWNER_ID) {
        await interaction.reply({ content: 'You are not authorized to use this button.', flags: 64 });
        return;
    }
    
    const [action, withdrawalId, userId, amount] = params;
    
    try {
        const user = await interaction.client.users.fetch(userId);
        
        if (action === 'approve') {
            // Update withdrawal status
            await updateWithdrawalStatus(withdrawalId, 'Paid');
            
            // Deduct from user balance
            const currentBalance = await getUserBalance(userId);
            const newBalance = currentBalance - parseInt(amount);
            await updateUserBalance(userId, Math.max(0, newBalance));
            
            // DM user
            const embed = new EmbedBuilder()
                .setTitle('💰 Withdrawal Approved')
                .setDescription(`Your withdrawal request for **${formatCurrency(parseInt(amount))}** has been approved and paid.`)
                .setColor('#00FF00')
                .setTimestamp();
                
            await user.send({ embeds: [embed] });
            
            // Update button message
            await interaction.update({ 
                content: `✅ Withdrawal approved and paid to ${user.tag}`, 
                components: [],
                embeds: []
            });
            
        } else if (action === 'decline') {
            // Update withdrawal status
            await updateWithdrawalStatus(withdrawalId, 'Declined');
            
            // DM user
            const embed = new EmbedBuilder()
                .setTitle('❌ Withdrawal Declined')
                .setDescription('Your withdrawal request has been declined.')
                .setColor('#FF0000')
                .setTimestamp();
                
            await user.send({ embeds: [embed] });
            
            // Update button message
            await interaction.update({ 
                content: `❌ Withdrawal declined for ${user.tag}`, 
                components: [],
                embeds: []
            });
        }
        
    } catch (error) {
        console.error('Owner response error:', error);
        await interaction.reply({ content: 'Failed to process response.', flags: 64 });
    }
}

module.exports = {
    handleButton,
    handleModal
};