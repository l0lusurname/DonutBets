const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deposit')
        .setDescription('Get instructions for depositing credits via Minecraft'),

    async execute(interaction) {
        const client = interaction.client;
        const supabase = client.supabase;
        const { ensureUserExists } = client.utils;
        const minecraftBot = client.minecraftBot;

        try {
            await interaction.deferReply({ ephemeral: true });

            const userId = interaction.user.id;

            // Ensure user exists in database
            await ensureUserExists(userId, interaction.user.username);

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
                    .setDescription('You need to link your Minecraft account first before you can deposit.')
                    .addFields({
                        name: '🔗 Link Your Account',
                        value: 'Use `/link <minecraft_username>` to connect your accounts',
                        inline: false
                    })
                    .setFooter({ text: 'Account linking is required for deposits and withdrawals' });

                return await interaction.editReply({ embeds: [embed] });
            }

            // Check Minecraft bot status
            const botStatus = minecraftBot.getStatus();
            
            const embed = new EmbedBuilder()
                .setColor('#4CAF50')
                .setTitle('💰 Deposit Credits')
                .setDescription(`Your Minecraft account **${linkedAccount.mc_username}** is linked and ready for deposits!`)
                .addFields(
                    {
                        name: '🎮 How to Deposit',
                        value: `Simply pay any amount to **${botStatus.username}** in Minecraft:`,
                        inline: false
                    },
                    {
                        name: '⚡ Command Example',
                        value: `\`/pay ${botStatus.username} 500\` (deposits $500.00)`,
                        inline: false
                    },
                    {
                        name: '✅ Automatic Processing',
                        value: 'Deposits are processed instantly when the bot detects your payment',
                        inline: false
                    },
                    {
                        name: '📊 Your Stats',
                        value: `Total Deposited: **$${(linkedAccount.total_deposited_cents / 100).toFixed(2)}**\nTotal Withdrawn: **$${(linkedAccount.total_withdrawn_cents / 100).toFixed(2)}**`,
                        inline: false
                    }
                )
                .setFooter({ 
                    text: `Bot Status: ${botStatus.connected ? '🟢 Online' : '🔴 Offline'} | Any amount accepted`
                })
                .setTimestamp();

            if (!botStatus.connected) {
                embed.setColor('#ff6b35');
                embed.addFields({
                    name: '⚠️ Bot Status',
                    value: 'The Minecraft bot is currently offline. Deposits may not be processed immediately.',
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in deposit command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setColor('#ff6b35')
                .setTitle('❌ Error')
                .setDescription('An error occurred while retrieving deposit information. Please try again later.')
                .setFooter({ text: 'Contact support if this issue persists' });

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    },
};