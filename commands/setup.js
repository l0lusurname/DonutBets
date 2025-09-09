
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Setup gambling channels (Admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    async execute(interaction) {
        try {
            // Check if user has admin permissions
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                await interaction.reply({ content: 'You need administrator permissions to use this command.', flags: 64 });
                return;
            }

            const guild = interaction.guild;
            
            // Create gambling category
            const category = await guild.channels.create({
                name: '🎰 GAMBLING',
                type: 4, // Category channel
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        deny: [PermissionFlagsBits.ViewChannel],
                    },
                ],
            });

            // Create start gambling channel
            const startChannel = await guild.channels.create({
                name: '✅ start-gambling',
                type: 0, // Text channel
                parent: category.id,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                        deny: [PermissionFlagsBits.SendMessages],
                    },
                ],
            });

            // Send welcome message in start gambling channel
            const welcomeEmbed = new EmbedBuilder()
                .setTitle('🎰 Welcome to DonutBets Casino!')
                .setDescription('Click the button below to create your private gambling room!')
                .setColor('#FFD700')
                .setThumbnail(interaction.client.user.displayAvatarURL())
                .addFields(
                    { name: '🎮 Available Games', value: '• Mines\n• Towers\n• Crash\n• Slots', inline: true },
                    { name: '💰 Commands', value: '• `/balance` - Check balance\n• `/deposit` - Add credits\n• `/withdraw` - Request withdrawal', inline: true }
                )
                .setTimestamp();

            const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            const startButton = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('gambling_create_room')
                        .setLabel('🎰 Create Gambling Room')
                        .setStyle(ButtonStyle.Success)
                );

            await startChannel.send({ embeds: [welcomeEmbed], components: [startButton] });

            const embed = new EmbedBuilder()
                .setTitle('✅ Setup Complete!')
                .setDescription(`Gambling channels created successfully!\n\n**Category:** ${category.name}\n**Start Channel:** ${startChannel}`)
                .setColor('#00FF00')
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Setup command error:', error);
            await interaction.reply({ content: 'Failed to setup gambling channels.', flags: 64 });
        }
    }
};
