const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('withdraw')
        .setDescription('Withdraw credits to your linked Minecraft account')
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Amount to withdraw (in credits)')
                .setRequired(true)
                .setMinValue(1)),
    
    async execute(interaction) {
        const client = interaction.client;
        const supabase = client.supabase;
        const { ensureUserExists, formatCurrency } = client.utils;
        const minecraftBot = client.minecraftBot;

        try {
            await interaction.deferReply({ ephemeral: true });

            const userId = interaction.user.id;
            const amount = interaction.options.getInteger('amount');

            // Ensure user exists in database
            await ensureUserExists(userId, interaction.user.username);

            // Get user balance
            const { data: userData, error: userError } = await supabase
                .from('users')
                .select('balance')
                .eq('id', userId)
                .single();

            if (userError || !userData) {
                throw new Error('Could not fetch user balance');
            }

            if (userData.balance < amount) {
                const embed = new EmbedBuilder()
                    .setColor('#ff6b35')
                    .setTitle('❌ Insufficient Balance')
                    .setDescription(`You only have ${formatCurrency(userData.balance)} but tried to withdraw ${formatCurrency(amount)}.`)
                    .setFooter({ text: 'Check your balance with /balance' });

                return await interaction.editReply({ embeds: [embed] });
            }

            // Check if user has a linked Minecraft account
            const { data: linkedAccount, error: linkError } = await supabase
                .from('linked_accounts')
                .select('*')
                .eq('discord_user_id', userId)
                .eq('status', 'Verified')
                .single();

            if (linkError || !linkedAccount) {
                const embed = new EmbedBuilder()
                    .setColor('#ff6b35')
                    .setTitle('❌ No Linked Account')
                    .setDescription('You need to link your Minecraft account first before you can withdraw.')
                    .addFields({
                        name: '🔗 Link Your Account',
                        value: 'Use `/link <minecraft_username>` to connect your accounts',
                        inline: false
                    })
                    .setFooter({ text: 'Account linking is required for withdrawals' });

                return await interaction.editReply({ embeds: [embed] });
            }

            // Check Minecraft bot status
            const botStatus = minecraftBot.getStatus();
            
            if (!botStatus.connected) {
                const embed = new EmbedBuilder()
                    .setColor('#ff6b35')
                    .setTitle('❌ Minecraft Bot Offline')
                    .setDescription('The Minecraft bot is currently offline and cannot process withdrawals.')
                    .setFooter({ text: 'Try again later when the bot is online' });

                return await interaction.editReply({ embeds: [embed] });
            }

            // Process withdrawal
            await this.processWithdrawal(interaction, supabase, minecraftBot, userId, linkedAccount, amount);

        } catch (error) {
            console.error('Withdraw command error:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setColor('#ff6b35')
                .setTitle('❌ Error')
                .setDescription('An error occurred while processing your withdrawal. Please try again later.')
                .setFooter({ text: 'Contact support if this issue persists' });

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    },

    async processWithdrawal(interaction, supabase, minecraftBot, userId, linkedAccount, amount) {
        try {
            const amountCents = amount;
            const reference = `withdraw_${userId}_${Date.now()}`;

            // Create withdrawal record
            const { data: paymentRecord, error: paymentError } = await supabase
                .from('payments')
                .insert({
                    discord_user_id: userId,
                    mc_username: linkedAccount.mc_username,
                    direction: 'withdraw',
                    amount_cents: amountCents,
                    reference: reference,
                    status: 'Pending'
                })
                .select()
                .single();

            if (paymentError) {
                throw new Error('Failed to create withdrawal record');
            }

            // Deduct balance immediately (amount is already in credits, not cents)
            const { error: balanceError } = await supabase
                .from('users')
                .update({ 
                    balance: userData.balance - amount  // Simple subtraction
                })
                .eq('id', userId);

            if (balanceError) {
                console.error('Balance update error:', balanceError);
                throw new Error('Failed to update balance');
            }

            // Send payment in Minecraft
            const paymentSuccess = await minecraftBot.payPlayer(linkedAccount.mc_username, amount);

            if (!paymentSuccess) {
                // Refund the balance if payment failed
                await supabase
                    .from('users')
                    .update({ 
                        balance: userData.balance  // Restore original balance
                    })
                    .eq('id', userId);

                await supabase
                    .from('payments')
                    .update({ status: 'Failed' })
                    .eq('id', paymentRecord.id);

                const embed = new EmbedBuilder()
                    .setColor('#ff6b35')
                    .setTitle('❌ Withdrawal Failed')
                    .setDescription('Failed to send payment in Minecraft. Your balance has been refunded.')
                    .setFooter({ text: 'Try again later or contact support' });

                return await interaction.editReply({ embeds: [embed] });
            }

            // Update records on success
            await supabase
                .from('payments')
                .update({ 
                    status: 'Completed',
                    confirmed_at: new Date().toISOString()
                })
                .eq('id', paymentRecord.id);

            await supabase
                .from('linked_accounts')
                .update({
                    total_withdrawn_cents: supabase.sql`total_withdrawn_cents + ${amountCents}`,
                    updated_at: new Date().toISOString()
                })
                .eq('id', linkedAccount.id);

            const embed = new EmbedBuilder()
                .setColor('#4CAF50')
                .setTitle('✅ Withdrawal Successful')
                .setDescription(`Successfully sent **$${amount.toFixed(2)}** to **${linkedAccount.mc_username}** in Minecraft!`)
                .addFields(
                    {
                        name: '💰 Amount Sent',
                        value: `$${amount.toFixed(2)}`,
                        inline: true
                    },
                    {
                        name: '🎮 Recipient',
                        value: linkedAccount.mc_username,
                        inline: true
                    },
                    {
                        name: '📋 Reference',
                        value: reference,
                        inline: false
                    }
                )
                .setFooter({ text: 'Payment has been sent in Minecraft' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error processing withdrawal:', error);
            throw error;
        }
    }
};