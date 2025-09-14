const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserBalance, updateUserBalance, logGame, formatCurrency, updateCasinoBankBalance } = require('../utils/database');
const { generateSeed, generateChickenRunMultiplier } = require('../utils/provablyFair');

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
            case 'forward':
                await moveForward(interaction);
                break;
            case 'cashout':
                await cashOut(interaction);
                break;
            case 'newgame':
                await startGame(interaction);
                break;
            case 'close':
                await closeGame(interaction);
                break;
        }
    } catch (error) {
        console.error('Chicken Run button error:', error);
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
            content: 'You need at least 1K credits to play Chicken Run!',
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
        .setTitle('🐓 Chicken Run 💨')
        .setDescription('Move forward to increase your multiplier! Each step is riskier, but the payout grows.\n\n🎯 **The farther you go, the higher the multiplier climbs!**')
        .setColor('#FFA500')
        .addFields(
            { name: '💰 Your Balance', value: formatCurrency(balance), inline: true },
            { name: '🎲 Strategy', value: 'Risk vs Reward!', inline: true },
            { name: '📈 Max Multiplier', value: 'Up to 10x!', inline: true }
        );

    const betRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('chickenrun_bet_100').setLabel('100').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('chickenrun_bet_500').setLabel('500').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('chickenrun_bet_1000').setLabel('1K').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('chickenrun_bet_5000').setLabel('5K').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('chickenrun_bet_10000').setLabel('10K').setStyle(ButtonStyle.Primary)
        );

    const customRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('chickenrun_bet_custom').setLabel('💰 Custom Bet').setStyle(ButtonStyle.Success)
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
            new ButtonBuilder().setCustomId('chickenrun_start').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
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

    // Generate the crash point
    const seed = generateSeed();
    const crashMultiplier = await generateChickenRunMultiplier(seed);

    const gameState = {
        userId,
        betAmount,
        crashMultiplier,
        currentMultiplier: 1.00,
        steps: 0,
        seed,
        gameActive: true
    };

    activeGames.set(userId, gameState);
    await updateUserBalance(userId, balance - betAmount);

    await updateGameDisplay(interaction, gameState);
}

async function updateGameDisplay(interaction, gameState) {
    const multiplierDisplay = gameState.currentMultiplier.toFixed(2);
    const potentialWin = Math.floor(gameState.betAmount * gameState.currentMultiplier);
    const profit = potentialWin - gameState.betAmount;

    // Generate path visualization
    let pathDisplay = '';
    for (let i = 0; i <= gameState.steps; i++) {
        if (i === gameState.steps) {
            pathDisplay += '🐓'; // Current position
        } else {
            pathDisplay += '🔸'; // Completed steps
        }
        if (i < 10) pathDisplay += '━';
    }
    if (gameState.steps < 10) {
        pathDisplay += '❓'.repeat(Math.max(0, 9 - gameState.steps));
    }

    const embed = new EmbedBuilder()
        .setTitle('🐓 Chicken Run 💨')
        .setDescription(`**Step ${gameState.steps}/10** • **${multiplierDisplay}x** multiplier\n\n${pathDisplay}\n\nKeep moving forward or cash out now!`)
        .setColor('#FFA500')
        .addFields(
            { name: '💰 Bet Amount', value: formatCurrency(gameState.betAmount), inline: true },
            { name: '📈 Current Multiplier', value: `${multiplierDisplay}x`, inline: true },
            { name: '💎 Potential Win', value: formatCurrency(potentialWin), inline: true },
            { name: '🎯 Profit', value: formatCurrency(profit), inline: true },
            { name: '👣 Steps Taken', value: gameState.steps.toString(), inline: true },
            { name: '⚡ Status', value: gameState.gameActive ? 'Active 🟢' : 'Ended 🔴', inline: true }
        );

    const gameRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('chickenrun_forward').setLabel('➡️ Move Forward').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('chickenrun_cashout').setLabel(`💰 Cash Out - ${formatCurrency(potentialWin)}`).setStyle(ButtonStyle.Success)
        );

    await interaction.editReply({ embeds: [embed], components: [gameRow] });
}

async function moveForward(interaction) {
    const userId = interaction.user.id;
    const gameState = activeGames.get(userId);

    if (!gameState || !gameState.gameActive) {
        return;
    }

    gameState.steps++;
    
    // Progressive multiplier increase - gets riskier as you go further
    const multiplierIncrease = 0.15 + (gameState.steps * 0.05); // Starts at 0.15, increases by 0.05 per step
    gameState.currentMultiplier += multiplierIncrease;

    // Check if player hit the crash point
    if (gameState.currentMultiplier >= gameState.crashMultiplier) {
        await handleCrash(interaction, gameState);
        return;
    }

    // Max 10 steps
    if (gameState.steps >= 10) {
        gameState.currentMultiplier = 10.00; // Cap at 10x
        await cashOut(interaction, true); // Auto cashout at max
        return;
    }

    await updateGameDisplay(interaction, gameState);
}

async function cashOut(interaction, maxSteps = false) {
    const userId = interaction.user.id;
    const gameState = activeGames.get(userId);

    if (!gameState || !gameState.gameActive) {
        return;
    }

    gameState.gameActive = false;
    const winAmount = Math.floor(gameState.betAmount * gameState.currentMultiplier);
    const profit = winAmount - gameState.betAmount;
    
    const currentBalance = await getUserBalance(userId);
    await updateUserBalance(userId, currentBalance + winAmount);
    await updateCasinoBankBalance(-profit);

    const embed = new EmbedBuilder()
        .setTitle(`🐓 ${maxSteps ? 'Maximum Steps Reached!' : 'Cashed Out!'} 🎉`)
        .setDescription(maxSteps ? 'You reached the maximum of 10 steps and achieved the highest multiplier!' : 'You successfully cashed out at the perfect time!')
        .setColor('#00FF00')
        .addFields(
            { name: '💰 Bet Amount', value: formatCurrency(gameState.betAmount), inline: true },
            { name: '📈 Final Multiplier', value: `${gameState.currentMultiplier.toFixed(2)}x`, inline: true },
            { name: '💎 Total Win', value: formatCurrency(winAmount), inline: true },
            { name: '🎯 Profit', value: formatCurrency(profit), inline: true },
            { name: '👣 Steps Taken', value: gameState.steps.toString(), inline: true },
            { name: '🔍 Crash Point', value: `${gameState.crashMultiplier.toFixed(2)}x`, inline: true },
            { name: '🔍 Server Seed', value: `\`${gameState.seed.serverSeed}\``, inline: false },
            { name: '🎲 Client Seed', value: `\`${gameState.seed.clientSeed}\``, inline: true },
            { name: '🔢 Nonce', value: `\`${gameState.seed.nonce}\``, inline: true },
            { name: '🔐 Hash', value: `\`${gameState.seed.hash}\``, inline: false }
        );

    await logGame(
        gameState.userId,
        'Chicken Run',
        gameState.betAmount,
        'Win',
        winAmount,
        profit,
        gameState.seed.hash
    );

    await interaction.editReply({ embeds: [embed], components: [] });
    
    // Send new game button as separate message
    setTimeout(async () => {
        try {
            const newGameRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('chickenrun_newgame')
                        .setLabel('🎮 New Game')
                        .setStyle(ButtonStyle.Primary)
                );
            await interaction.followUp({ content: 'Great run! Ready to try again?', components: [newGameRow] });
        } catch (error) {
            console.error('Error sending new game follow-up:', error);
        }
    }, 1000);
}

async function handleCrash(interaction, gameState) {
    gameState.gameActive = false;
    
    await updateCasinoBankBalance(gameState.betAmount);

    const embed = new EmbedBuilder()
        .setTitle('🐓💥 CRASH! The chicken got caught!')
        .setDescription('Oh no! You pushed too far and the chicken got caught before you could cash out!')
        .setColor('#FF0000')
        .addFields(
            { name: '💰 Lost', value: formatCurrency(gameState.betAmount), inline: true },
            { name: '📈 Reached Multiplier', value: `${gameState.currentMultiplier.toFixed(2)}x`, inline: true },
            { name: '💥 Crash Point', value: `${gameState.crashMultiplier.toFixed(2)}x`, inline: true },
            { name: '👣 Steps Taken', value: gameState.steps.toString(), inline: true },
            { name: '🎯 Next Time', value: 'Try cashing out earlier!', inline: true },
            { name: '📊 So Close!', value: 'You almost made it!', inline: true },
            { name: '🔍 Server Seed', value: `\`${gameState.seed.serverSeed}\``, inline: false },
            { name: '🎲 Client Seed', value: `\`${gameState.seed.clientSeed}\``, inline: true },
            { name: '🔢 Nonce', value: `\`${gameState.seed.nonce}\``, inline: true },
            { name: '🔐 Hash', value: `\`${gameState.seed.hash}\``, inline: false }
        );

    await logGame(
        gameState.userId,
        'Chicken Run',
        gameState.betAmount,
        'Loss',
        0,
        -gameState.betAmount,
        gameState.seed.hash
    );

    await interaction.editReply({ embeds: [embed], components: [] });
    
    // Send new game button as separate message
    setTimeout(async () => {
        try {
            const newGameRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('chickenrun_newgame')
                        .setLabel('🎮 New Game')
                        .setStyle(ButtonStyle.Primary)
                );
            await interaction.followUp({ content: 'Better luck next time! Ready for another run?', components: [newGameRow] });
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