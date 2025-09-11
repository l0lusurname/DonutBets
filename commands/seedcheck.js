
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { verifySeed, generateMinesResults, generateTowersResults, generateSlotResults, generateCrashMultiplier } = require('../utils/provablyFair');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('seedcheck')
        .setDescription('Verify a game seed and see the actual game results')
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
        )
        .addStringOption(option =>
            option.setName('gametype')
                .setDescription('Type of game (mines, towers, slots, crash)')
                .setRequired(true)
                .addChoices(
                    { name: 'Mines', value: 'mines' },
                    { name: 'Towers', value: 'towers' },
                    { name: 'Slots', value: 'slots' },
                    { name: 'Crash', value: 'crash' }
                )
        )
        .addIntegerOption(option =>
            option.setName('minecount')
                .setDescription('Number of mines (for Mines game)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('difficulty')
                .setDescription('Difficulty (for Towers game)')
                .setRequired(false)
                .addChoices(
                    { name: 'Easy', value: 'easy' },
                    { name: 'Medium', value: 'medium' },
                    { name: 'Hard', value: 'hard' }
                )
        ),
    
    async execute(interaction) {
        try {
            const serverSeed = interaction.options.getString('serverseed');
            const clientSeed = interaction.options.getString('clientseed');
            const nonce = interaction.options.getString('nonce');
            const expectedHash = interaction.options.getString('hash');
            const gameType = interaction.options.getString('gametype');
            const mineCount = interaction.options.getInteger('minecount');
            const difficulty = interaction.options.getString('difficulty');
            
            const isValid = verifySeed(serverSeed, clientSeed, nonce, expectedHash);
            
            if (!isValid) {
                const embed = new EmbedBuilder()
                    .setTitle('❌ Invalid Seed')
                    .setDescription('The provided seed information does not match!\n\n**Required Parameters:**\n• Server Seed\n• Client Seed\n• Nonce\n• Hash\n• Game Type (mines/towers/slots/crash)\n\n**Optional Parameters:**\n• Mine Count (for Mines game)\n• Difficulty (for Towers game)')
                    .addFields(
                        { name: 'Provided Information', value: `Server Seed: \`${serverSeed.substring(0, 16)}...\`\nClient Seed: \`${clientSeed}\`\nNonce: \`${nonce}\`\nGame Type: \`${gameType}\``, inline: false }
                    )
                    .setColor('#FF0000')
                    .setTimestamp();
                
                await interaction.reply({ embeds: [embed] });
                return;
            }

            // Recreate the seed object for game result generation
            const seedObj = {
                serverSeed,
                clientSeed,
                nonce,
                hash: expectedHash
            };

            let gameResultsEmbed;

            switch (gameType) {
                case 'mines':
                    gameResultsEmbed = await generateMinesResultsEmbed(seedObj, mineCount);
                    break;
                case 'towers':
                    gameResultsEmbed = await generateTowersResultsEmbed(seedObj, difficulty);
                    break;
                case 'slots':
                    gameResultsEmbed = await generateSlotsResultsEmbed(seedObj);
                    break;
                case 'crash':
                    gameResultsEmbed = await generateCrashResultsEmbed(seedObj);
                    break;
                default:
                    gameResultsEmbed = new EmbedBuilder()
                        .setTitle('❌ Unknown Game Type')
                        .setColor('#FF0000');
            }

            const verificationEmbed = new EmbedBuilder()
                .setTitle('✅ Seed Verified - Game Results')
                .setDescription('The seed is valid and the game was provably fair!')
                .addFields(
                    { name: 'Server Seed', value: `\`${serverSeed.substring(0, 16)}...\``, inline: true },
                    { name: 'Client Seed', value: `\`${clientSeed}\``, inline: true },
                    { name: 'Nonce', value: nonce, inline: true },
                    { name: 'Game Type', value: gameType.charAt(0).toUpperCase() + gameType.slice(1), inline: true }
                )
                .setColor('#00FF00')
                .setTimestamp();
            
            await interaction.reply({ embeds: [verificationEmbed, gameResultsEmbed] });
            
        } catch (error) {
            console.error('Seed check error:', error);
            await interaction.reply({ content: 'Failed to verify seed. Please check your input.', flags: 64 });
        }
    }
};

async function generateMinesResultsEmbed(seed, mineCount) {
    if (!mineCount) mineCount = 3; // Default if not provided
    
    const minePositions = generateMinesResults(seed, mineCount);
    
    // Create 4x4 grid visualization
    let gridDisplay = '';
    for (let i = 0; i < 4; i++) {
        let row = '';
        for (let j = 0; j < 4; j++) {
            const position = i * 4 + j;
            if (minePositions.includes(position)) {
                row += '💣 ';
            } else {
                row += '💎 ';
            }
        }
        gridDisplay += row + '\n';
    }
    
    return new EmbedBuilder()
        .setTitle('💣 Mines Game Results')
        .setDescription(`**Mine Count:** ${mineCount}\n**Grid Layout:**\n\`\`\`\n${gridDisplay}\`\`\``)
        .addFields(
            { name: '💣 Mine Positions', value: minePositions.map(pos => `Position ${pos}`).join(', '), inline: false },
            { name: '💎 Safe Positions', value: Array.from({length: 16}, (_, i) => i).filter(pos => !minePositions.includes(pos)).map(pos => `Position ${pos}`).join(', '), inline: false }
        )
        .setColor('#FF4500');
}

async function generateTowersResultsEmbed(seed, difficulty) {
    if (!difficulty) difficulty = 'medium'; // Default if not provided
    
    let blocksPerLevel;
    switch (difficulty) {
        case 'easy': blocksPerLevel = 4; break;
        case 'medium': blocksPerLevel = 4; break;
        case 'hard': blocksPerLevel = 4; break;
        default: blocksPerLevel = 4;
    }
    
    const correctPath = generateTowersResults(seed, 8, blocksPerLevel);
    
    let pathDisplay = '';
    for (let level = 0; level < 8; level++) {
        let levelStr = `Level ${level + 1}: `;
        for (let block = 0; block < blocksPerLevel; block++) {
            if (block === correctPath[level]) {
                levelStr += '💎 ';
            } else {
                levelStr += '💣 ';
            }
        }
        pathDisplay += levelStr + '\n';
    }
    
    return new EmbedBuilder()
        .setTitle('🗼 Towers Game Results')
        .setDescription(`**Difficulty:** ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}\n**Correct Path:**\n\`\`\`\n${pathDisplay}\`\`\``)
        .addFields(
            { name: '✅ Correct Blocks Per Level', value: correctPath.map((block, level) => `Level ${level + 1}: Block ${block + 1}`).join('\n'), inline: false }
        )
        .setColor('#4B0082');
}

async function generateSlotsResultsEmbed(seed) {
    const results = generateSlotResults(seed);
    
    // Create 3x3 grid
    const grid = [
        [results[0], results[1], results[2]],
        [results[3], results[4], results[5]],
        [results[6], results[7], results[8]]
    ];
    
    let gridDisplay = '';
    for (let row of grid) {
        gridDisplay += row.join(' ') + '\n';
    }
    
    // Check for wins
    let winLines = [];
    if (results[4] === '7️⃣') winLines.push('Center 7️⃣ (5x multiplier)');
    if (results[0] === results[4] && results[4] === results[8]) winLines.push('Diagonal \\ match (3x multiplier)');
    if (results[2] === results[4] && results[4] === results[6]) winLines.push('Diagonal / match (3x multiplier)');
    if (results[0] === results[1] && results[1] === results[2]) winLines.push('Top row match (2x multiplier)');
    
    return new EmbedBuilder()
        .setTitle('🎰 Slots Game Results')
        .setDescription(`**Grid Result:**\n${gridDisplay}`)
        .addFields(
            { name: '🎯 Winning Lines', value: winLines.length > 0 ? winLines.join('\n') : 'No wins', inline: false }
        )
        .setColor(winLines.length > 0 ? '#00FF00' : '#FF0000');
}

async function generateCrashResultsEmbed(seed) {
    const crashMultiplier = generateCrashMultiplier(seed);
    
    return new EmbedBuilder()
        .setTitle('🚀 Crash Game Results')
        .setDescription(`**Crash Point:** ${crashMultiplier}x`)
        .addFields(
            { name: '📊 Analysis', value: `The rocket crashed at ${crashMultiplier}x multiplier`, inline: false }
        )
        .setColor(crashMultiplier >= 2 ? '#00FF00' : '#FF4500');
}
