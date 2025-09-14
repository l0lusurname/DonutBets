const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserBalance, updateUserBalance, logGame, formatCurrency, updateCasinoBankBalance } = require('../utils/database');
const { generateSeed, generateCoinflipResult } = require('../utils/provablyFair');

const activeGames = new Map();

function parseFormattedNumber(input) {
    if (typeof input === 'number') {
        // Validate numeric input
        if (!Number.isFinite(input) || input < 0 || input > 1000000000000) {
            throw new Error('Invalid number: must be finite, positive, and within reasonable limits');
        }
        return Math.floor(input);
    }

    if (typeof input !== 'string' || input.trim() === '') {
        throw new Error('Invalid input: must be a non-empty string or number');
    }

    // Clean and validate string input
    const str = input.toString().toLowerCase().trim().replace(/,/g, '');
    
    // Reject dangerous patterns
    if (str.includes('infinity') || str.includes('nan') || str.includes('e') || str.includes('script') || str.includes('\x00')) {
        throw new Error('Invalid input: contains dangerous patterns');
    }
    
    // Parse base number
    const num = parseFloat(str);
    
    // Validate parsed number
    if (!Number.isFinite(num) || num < 0) {
        throw new Error('Invalid number: must be finite and positive');
    }
    
    let result;
    if (str.includes('k')) {
        result = num * 1000;
    } else if (str.includes('m')) {
        result = num * 1000000;
    } else if (str.includes('b')) {
        result = num * 1000000000;
    } else {
        result = num;
    }
    
    // Final validation and bounds checking
    if (!Number.isFinite(result) || result < 1 || result > 1000000000000) {
        throw new Error('Result out of bounds: must be between 1 and 1T');
    }
    
    return Math.floor(result);
}

async function handleButton(interaction, params) {
    const [action, ...data] = params;

    try {
        // Improved interaction handling - check if it's a button and defer properly
        if (interaction.isButton && interaction.isButton() && !interaction.deferred && !interaction.replied) {
            await interaction.deferUpdate();
        }

        switch (action) {
            case 'start':
                await startGame(interaction);
                break;
            case 'bet':
                if (data[0] === 'custom') {
                    await handleCustomBet(interaction);
                    return;
                }
                await handleBetSelection(interaction, parseInt(data[0]));
                break;
            case 'heads':
                await makeChoice(interaction, 'heads');
                break;
            case 'tails':
                await makeChoice(interaction, 'tails');
                break;
            case 'newgame':
                await startGame(interaction);
                break;
            case 'close':
                await closeGame(interaction);
                break;
        }
    } catch (error) {
        console.error('Coinflip button error:', error);
        // Only try to respond if we haven't already
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'An error occurred!', flags: 64 });
            } else if (interaction.deferred && !interaction.replied) {
                await interaction.editReply({ content: 'An error occurred!', components: [] });
            }
        } catch (responseError) {
            console.error('Failed to send error response:', responseError.message);
        }
    }
}

async function startGame(interaction) {
    const userId = interaction.user.id;
    
    // Check if user already has an active game
    const balance = await getUserBalance(userId);

    if (balance < 1000) {
        const reply = {
            content: 'You need at least 1K credits to play Coinflip!',
            flags: 64
        };

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(reply);
        } else {
            await interaction.reply(reply);
        }
        return;
    }

    activeGames.delete(userId);

    const embed = new EmbedBuilder()
        .setTitle('🪙 Coinflip')
        .setDescription('Choose heads or tails and double your bet!\n🎯 **50/50 chance • x2 multiplier**')
        .setColor('#FFD700')
        .addFields(
            { name: '💰 Your Balance', value: formatCurrency(balance), inline: true },
            { name: '🎲 Odds', value: '50% chance to win', inline: true },
            { name: '📈 Multiplier', value: 'x2.00', inline: true }
        );

    const betRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('coinflip_bet_100').setLabel('100').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('coinflip_bet_500').setLabel('500').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('coinflip_bet_1000').setLabel('1K').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('coinflip_bet_5000').setLabel('5K').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('coinflip_bet_10000').setLabel('10K').setStyle(ButtonStyle.Primary)
        );

    const customRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('coinflip_bet_custom').setLabel('💰 Custom Bet').setStyle(ButtonStyle.Success)
        );

    if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [embed], components: [betRow, customRow] });
    } else {
        await interaction.reply({ embeds: [embed], components: [betRow, customRow] });
    }
}

async function handleCustomBet(interaction) {
    const userId = interaction.user.id;
    const balance = await getUserBalance(userId);

    const embed = new EmbedBuilder()
        .setTitle('💰 Custom Bet Amount')
        .setDescription('Enter your custom bet amount in the chat!\nFormat: `!bet [amount]`\nExamples: `!bet 1500`, `!bet 2.5k`, `!bet 10m`')
        .setColor('#FFD700')
        .addFields(
            { name: '💰 Your Balance', value: formatCurrency(balance), inline: true },
            { name: '💡 Tip', value: 'Minimum bet: 1K credits\nSupports: k, m, b suffixes', inline: true }
        );

    const backRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('coinflip_start').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
        );

    await interaction.editReply({ embeds: [embed], components: [backRow] });

    const filter = (message) => {
        return message.author.id === userId && message.content.startsWith('!bet');
    };

    const collector = interaction.channel.createMessageCollector({ filter, time: 30000, max: 1 });

    collector.on('collect', async (message) => {
        try {
            const betInput = message.content.split(' ')[1];
            
            if (!betInput) {
                await message.reply('Please specify a bet amount! Example: `!bet 99k`');
                return;
            }
            
            const betAmount = parseFormattedNumber(betInput);

            if (isNaN(betAmount) || betAmount < 1000) {
                await message.reply('Invalid bet amount! Minimum bet is 1K credits.');
                return;
            }

            // Check current balance again to ensure it's up to date
            const currentBalance = await getUserBalance(message.author.id);
            if (betAmount > currentBalance) {
                await message.reply(`Insufficient balance! You have ${formatCurrency(currentBalance)}, but tried to bet ${formatCurrency(betAmount)}`);
                return;
            }

            try {
                const replyMsg = await message.reply(`Custom bet set: ${formatCurrency(betAmount)}!`);
                setTimeout(() => replyMsg.delete().catch(() => {}), 3000);
                await message.delete().catch(() => {});
            } catch (error) {
                console.log('Message interaction error:', error.message);
            }

            await handleBetSelection(interaction, betAmount);
        } catch (error) {
            console.error('Custom bet collection error:', error);
            try {
                await message.reply('❌ Error processing custom bet. Please try again.');
            } catch (replyError) {
                console.error('Failed to send error reply:', replyError);
            }
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            startGame(interaction);
        }
    });
}

async function handleBetSelection(interaction, betAmount) {
    const userId = interaction.user.id;
    const balance = await getUserBalance(userId);

    if (balance < betAmount) {
        await interaction.editReply({ content: 'Insufficient balance!', components: [] });
        return;
    }

    // Store game state
    const gameState = {
        userId,
        betAmount,
        gameActive: true
    };

    activeGames.set(userId, gameState);

    // Show choice buttons
    const embed = new EmbedBuilder()
        .setTitle('🪙 Choose Your Side!')
        .setDescription(`Betting: **${formatCurrency(betAmount)}**\nPotential win: **${formatCurrency(betAmount * 2)}**\n\nChoose heads or tails!`)
        .setColor('#FFD700')
        .addFields(
            { name: '🎲 Odds', value: '50% chance to win', inline: true },
            { name: '📈 Multiplier', value: 'x2.00', inline: true },
            { name: '💰 Bet', value: formatCurrency(betAmount), inline: true }
        );

    const choiceRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('coinflip_heads').setLabel('🪙 Heads').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('coinflip_tails').setLabel('🪙 Tails').setStyle(ButtonStyle.Secondary)
        );

    await interaction.editReply({ embeds: [embed], components: [choiceRow] });
}

async function makeChoice(interaction, playerChoice) {
    const userId = interaction.user.id;
    const gameState = activeGames.get(userId);

    if (!gameState || !gameState.gameActive) {
        return;
    }

    gameState.gameActive = false;
    
    // Deduct bet from balance
    const currentBalance = await getUserBalance(userId);
    await updateUserBalance(userId, currentBalance - gameState.betAmount);

    // Generate result
    const seed = generateSeed();
    const result = generateCoinflipResult(seed); // 'heads' or 'tails'
    const won = result === playerChoice;

    let winAmount, profit;
    if (won) {
        winAmount = gameState.betAmount * 2;
        profit = gameState.betAmount;
        await updateUserBalance(userId, currentBalance + winAmount);
        await updateCasinoBankBalance(-profit);
    } else {
        winAmount = 0;
        profit = -gameState.betAmount;
        await updateCasinoBankBalance(gameState.betAmount);
    }

    // Create result embed
    const embed = new EmbedBuilder()
        .setTitle(`🪙 ${won ? 'You Won!' : 'You Lost!'} ${won ? '🎉' : '💸'}`)
        .setDescription(`The coin landed on **${result}**!`)
        .setColor(won ? '#00FF00' : '#FF0000')
        .addFields(
            { name: '🎯 Your Choice', value: `${playerChoice === 'heads' ? '🪙' : '🪙'} ${playerChoice.charAt(0).toUpperCase() + playerChoice.slice(1)}`, inline: true },
            { name: '🎲 Result', value: `${result === 'heads' ? '🪙' : '🪙'} ${result.charAt(0).toUpperCase() + result.slice(1)}`, inline: true },
            { name: '💰 Outcome', value: won ? `Won ${formatCurrency(winAmount)}!` : `Lost ${formatCurrency(gameState.betAmount)}`, inline: true },
            { name: '🔍 Server Seed', value: `\`${seed.serverSeed}\``, inline: false },
            { name: '🎲 Client Seed', value: `\`${seed.clientSeed}\``, inline: true },
            { name: '🔢 Nonce', value: `\`${seed.nonce}\``, inline: true },
            { name: '🔐 Hash', value: `\`${seed.hash}\``, inline: false }
        );

    await logGame(
        gameState.userId,
        'Coinflip',
        gameState.betAmount,
        won ? 'Win' : 'Loss',
        winAmount,
        profit,
        seed.hash
    );

    await interaction.editReply({ embeds: [embed], components: [] });
    
    // Send new game button as separate message
    setTimeout(async () => {
        try {
            const newGameRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('coinflip_newgame')
                        .setLabel('🎮 New Game')
                        .setStyle(ButtonStyle.Primary)
                );
            await interaction.followUp({ content: won ? 'Lucky! Ready to flip again?' : 'Better luck next time!', components: [newGameRow] });
        } catch (error) {
            console.error('Error sending new game follow-up:', error);
        }
    }, 1000);
}

async function closeGame(interaction) {
    const userId = interaction.user.id;
    activeGames.delete(userId);
    await interaction.editReply({ content: 'Game closed.', components: [] });
}

module.exports = { handleButton, startGame };