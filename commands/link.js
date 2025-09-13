const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Minecraft account to your Discord account')
        .addStringOption(option =>
            option.setName('minecraft_username')
                .setDescription('Your Minecraft username')
                .setRequired(true)),

    async execute(interaction) {
        const client = interaction.client;
        const supabase = client.supabase;
        const { ensureUserExists } = client.utils;
        const minecraftBot = client.minecraftBot;

        try {
            await interaction.deferReply({ ephemeral: true });

            const userId = interaction.user.id;
            const mcUsername = interaction.options.getString('minecraft_username');

            // Ensure user exists in database
            await ensureUserExists(userId, interaction.user.username);

            // Check if user already has a verified account
            const { data: existingLink, error: linkError } = await supabase
                .from('linked_accounts')
                .select('*')
                .eq('discord_user_id', userId)
                .eq('status', 'Verified')
                .single();

            if (!linkError && existingLink) {
                const embed = new EmbedBuilder()
                    .setColor('#ff6b35')
                    .setTitle('❌ Account Already Linked')
                    .setDescription(`Your Discord account is already linked to Minecraft username: **${existingLink.mc_username}**`)
                    .setFooter({ text: 'Contact an admin if you need to change your linked account' });

                return await interaction.editReply({ embeds: [embed] });
            }

            // Check if Minecraft bot is connected
            const botStatus = minecraftBot.getStatus();
            if (!botStatus.connected) {
                const embed = new EmbedBuilder()
                    .setColor('#ff6b35')
                    .setTitle('❌ Minecraft Bot Offline')
                    .setDescription('The Minecraft bot is currently offline. Please try again later.')
                    .setFooter({ text: 'Contact an admin if this issue persists' });

                return await interaction.editReply({ embeds: [embed] });
            }

            // Generate unique verification amount (between $1-999 with cents encoding a nonce)
            const baseAmount = Math.floor(Math.random() * 999) + 1; // $1-999
            const nonce = Math.floor(Math.random() * 99) + 1; // 1-99 cents
            const verifyAmountCents = baseAmount * 100 + nonce;
            const verifyAmountDollars = verifyAmountCents / 100;

            // Set expiration time (15 minutes from now)
            const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

            // Remove any existing pending verification for this user
            await supabase
                .from('linked_accounts')
                .delete()
                .eq('discord_user_id', userId)
                .eq('status', 'Pending');

            // Create new verification record
            const { error: insertError } = await supabase
                .from('linked_accounts')
                .insert({
                    discord_user_id: userId,
                    mc_username: mcUsername.toLowerCase(),
                    status: 'Pending',
                    verify_amount_cents: verifyAmountCents,
                    verify_expires_at: expiresAt.toISOString()
                });

            if (insertError) {
                console.error('Error creating verification record:', insertError);
                throw new Error('Database error');
            }

            // Create payment tracking record
            const reference = `verify_${userId}_${Date.now()}`;
            await supabase
                .from('payments')
                .insert({
                    discord_user_id: userId,
                    mc_username: mcUsername.toLowerCase(),
                    direction: 'verify',
                    amount_cents: verifyAmountCents,
                    reference: reference,
                    status: 'Pending'
                });

            const embed = new EmbedBuilder()
                .setColor('#4CAF50')
                .setTitle('🔗 Account Linking Started')
                .setDescription(`To verify ownership of **${mcUsername}**, please complete the following step:`)
                .addFields(
                    {
                        name: '💰 Payment Required',
                        value: `Send exactly **$${verifyAmountDollars.toFixed(2)}** to **${botStatus.username}** in Minecraft`,
                        inline: false
                    },
                    {
                        name: '⚡ How to Pay',
                        value: `Type in Minecraft chat: \`/pay ${botStatus.username} ${verifyAmountDollars.toFixed(2)}\``,
                        inline: false
                    },
                    {
                        name: '⏰ Time Limit',
                        value: `You have **15 minutes** to complete this verification`,
                        inline: false
                    }
                )
                .setFooter({ text: 'The exact amount is required for verification. Do not send any other amount.' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in link command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setColor('#ff6b35')
                .setTitle('❌ Error')
                .setDescription('An error occurred while setting up account linking. Please try again later.')
                .setFooter({ text: 'Contact support if this issue persists' });

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    },
};