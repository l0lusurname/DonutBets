const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { verifySeed } = require('../utils/provablyFair');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('seedcheck')
        .setDescription('Verify a game seed for provably fair gaming')
        .addStringOption(option =>
            option.setName('serverseed')
                .setDescription('Server seed from game')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('clientseed')
                .setDescription('Client seed from game')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('nonce')
                .setDescription('Nonce from game')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('hash')
                .setDescription('Expected hash from game')
                .setRequired(true)
        ),
    
    async execute(interaction) {
        try {
            const serverSeed = interaction.options.getString('serverseed');
            const clientSeed = interaction.options.getString('clientseed');
            const nonce = interaction.options.getString('nonce');
            const expectedHash = interaction.options.getString('hash');
            
            const isValid = verifySeed(serverSeed, clientSeed, parseInt(nonce), expectedHash);
            
            const embed = new EmbedBuilder()
                .setTitle('🔍 Seed Verification')
                .setDescription(isValid ? '✅ Seed is valid and game was provably fair!' : '❌ Seed verification failed!')
                .addFields(
                    { name: 'Server Seed', value: `\`${serverSeed.substring(0, 16)}...\``, inline: true },
                    { name: 'Client Seed', value: `\`${clientSeed}\``, inline: true },
                    { name: 'Nonce', value: nonce, inline: true },
                    { name: 'Expected Hash', value: `\`${expectedHash.substring(0, 16)}...\``, inline: false },
                    { name: 'Status', value: isValid ? '✅ Valid' : '❌ Invalid', inline: true }
                )
                .setColor(isValid ? '#00FF00' : '#FF0000')
                .setTimestamp();
            
            await interaction.reply({ embeds: [embed] });
            
        } catch (error) {
            console.error('Seed check error:', error);
            await interaction.reply({ content: 'Failed to verify seed. Please check your input.', flags: 64 });
        }
    }
};