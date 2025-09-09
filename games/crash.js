const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserBalance, updateUserBalance, logGame, formatCurrency, parseCurrency } = require('../utils/database');
const { generateSeed, generateCrashMultiplier } = require('../utils/provablyFair');

// Store active games
const activeGames = new Map();

async function handleButton(interaction, params) {
    const [action, ...data] = params;

    try {
        // Always defer the interaction first to prevent timeout
        if (!interaction.deferred && !interaction.replied) {
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
            case 'join':
                await joinGame(interaction);
                break;
            case 'newgame':
                await startGame(interaction);
                break;
        }
    } catch (error) {
        console.error('Crash button error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred!', ephemeral: true });
        } else if (interaction.deferred) {
            await interaction.editReply({ content: 'An error occurred!', components: [] });
        }
    }
}

async function startGame(interaction) {
    const userId = interaction.user.id;
    const balance = await getUserBalance(userId);

    if (balance < 100) {
        await interaction.reply({
            content: 'You need at least 100 credits to play Crash!',
            ephemeral: true
        });
        return;
    }

    // Clear any existing game state
    activeGames.delete(userId);

    const embed = new EmbedBuilder()
        .setTitle('🚀 Crash Game')
        .setDescription('Select your bet amount to start!')
        .setColor('#FF6B6B')
        .addFields(
            { name: '💰 Your Balance', value: formatCurrency(balance), inline: true },
            { name: '🎯 Goal', value: 'Cash out before the crash!', inline: true }
        );

    const betRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('crash_bet_100').setLabel('100').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('crash_bet_500').setLabel('500').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('crash_bet_1000').setLabel('1K').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('crash_bet_5000').setLabel('5K').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('crash_bet_10000').setLabel('10K').setStyle(ButtonStyle.Primary)
        );

    const customRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('crash_bet_custom').setLabel('💰 Custom Bet').setStyle(ButtonStyle.Success)
        );

    if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [embed], components: [betRow, customRow] });
    } else {
        await interaction.reply({ embeds: [embed], components: [betRow, customRow] });
    }
}

async function startCrashGame(interaction, betAmount) {
    const userId = interaction.user.id;

    // Defer the interaction if not already handled
    if (!interaction.replied && !interaction.deferred) {
        await interaction.deferUpdate();
    }

    const balance = await getUserBalance(userId);

    if (balance < betAmount) {
        await interaction.editReply({ content: 'Insufficient balance!', components: [] });
        return;
    }

    // Generate crash point
    const seed = generateSeed();
    const crashPoint = generateCrashMultiplier(seed);

    const gameState = {
        userId,
        betAmount,
        crashPoint,
        seed,
        currentMultiplier: 1.0,
        gameActive: true,
        crashed: false,
        cashedOut: false,
        startTime: Date.now()
    };

    activeGames.set(userId, gameState);

    // Deduct bet from balance
    await updateUserBalance(userId, balance - betAmount);

    // Start the game loop
    await updateCrashGame(interaction, gameState);
}

async function handleCustomBet(interaction) {
    const userId = interaction.user.id;
    const balance = await getUserBalance(userId);

    const embed = new EmbedBuilder()
        .setTitle('💰 Custom Bet Amount')
        .setDescription('Enter your custom bet amount in the chat!\nFormat: `!bet [amount]`\nExample: `!bet 1500`')
        .setColor('#FFD700')
        .addFields(
            { name: '💰 Your Balance', value: formatCurrency(balance), inline: true },
            { name: '💡 Tip', value: 'Minimum bet: 100 credits', inline: true }
        );

    const backRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('crash_start').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
        );

    await interaction.editReply({ embeds: [embed], components: [backRow] });

    // Set up message collector for custom bet
    const filter = (message) => {
        return message.author.id === userId && message.content.startsWith('!bet');
    };

    const collector = interaction.channel.createMessageCollector({ filter, time: 30000, max: 1 });

    collector.on('collect', async (message) => {
        const betAmount = parseInt(message.content.split(' ')[1]);

        if (isNaN(betAmount) || betAmount < 100) {
            await message.reply('Invalid bet amount! Minimum bet is 100 credits.');
            return;
        }

        if (betAmount > balance) {
            await message.reply('Insufficient balance!');
            return;
        }

        await message.delete().catch(() => {});
        // Remove the problematic message reply that causes the reference error

        await startCrashGame(interaction, betAmount); // Changed from handleBetSelection to startCrashGame
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            startGame(interaction);
        }
    });
}

async function updateCrashGame(interaction, gameState) {
    if (!gameState.gameActive || gameState.crashed || gameState.cashedOut) {
        return;
    }

    const elapsed = (Date.now() - gameState.startTime) / 1000; // seconds
    let newMultiplier;

    // Calculate speed based on current multiplier
    if (gameState.currentMultiplier < 2) {
        newMultiplier = 1 + (elapsed * 0.1); // 0.1x per second
    } else if (gameState.currentMultiplier < 5) {
        newMultiplier = 1 + (elapsed * 0.2); // 0.2x per second
    } else {
        // Double speed every 5x
        const speedMultiplier = Math.pow(2, Math.floor(gameState.currentMultiplier / 5));
        const baseSpeed = Math.min(speedMultiplier * 0.2, 5); // Cap at 5x per second
        newMultiplier = 1 + (elapsed * baseSpeed);
    }

    gameState.currentMultiplier = parseFloat(newMultiplier.toFixed(2));

    // Check if crashed
    if (gameState.currentMultiplier >= gameState.crashPoint) {
        gameState.crashed = true;
        gameState.gameActive = false;

        const embed = new EmbedBuilder()
            .setTitle('💥 CRASHED!')
            .setDescription(`The rocket crashed at ${gameState.crashPoint}x!`)
            .setColor('#FF0000')
            .addFields(
                { name: '💸 Result', value: `Lost ${formatCurrency(gameState.betAmount)}`, inline: true },
                { name: '🚀 Crash Point', value: `${gameState.crashPoint}x`, inline: true }
            );

        await logGame(
            gameState.userId,
            'Crash',
            gameState.betAmount,
            'Loss',
            0,
            -gameState.betAmount,
            gameState.seed.hash
        );

        const newGameRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('crash_newgame')
                    .setLabel('🎮 New Game')
                    .setStyle(ButtonStyle.Primary)
            );

        await interaction.editReply({ embeds: [embed], components: [newGameRow] });
        return;
    }

    // Update display
    const embed = new EmbedBuilder()
        .setTitle('🚀 Crash Game - FLYING!')
        .setDescription(`Current Multiplier: **${gameState.currentMultiplier}x**`)
        .setColor('#00FF00')
        .addFields(
            { name: '💰 Bet', value: formatCurrency(gameState.betAmount), inline: true },
            { name: '📈 Potential Win', value: formatCurrency(Math.floor(gameState.betAmount * gameState.currentMultiplier)), inline: true },
            { name: '⏱️ Time', value: `${elapsed.toFixed(1)}s`, inline: true }
        );

    const cashoutRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('crash_cashout')
                .setLabel(`💰 Cash Out (${gameState.currentMultiplier}x)`)
                .setStyle(ButtonStyle.Success)
        );

    await interaction.editReply({ embeds: [embed], components: [cashoutRow] });

    // Continue updating every 200ms
    setTimeout(() => {
        if (gameState.gameActive && !gameState.crashed && !gameState.cashedOut) {
            updateCrashGame(interaction, gameState);
        }
    }, 200);
}

async function cashOut(interaction) {
    const userId = interaction.user.id;
    const gameState = activeGames.get(userId);

    if (!gameState || !gameState.gameActive || gameState.crashed || gameState.cashedOut) {
        await interaction.reply({ content: 'Cannot cash out at this time!', ephemeral: true });
        return;
    }

    gameState.cashedOut = true;
    gameState.gameActive = false;

    const winAmount = Math.floor(gameState.betAmount * gameState.currentMultiplier);
    const profit = winAmount - gameState.betAmount;

    const currentBalance = await getUserBalance(userId);
    await updateUserBalance(userId, currentBalance + winAmount);

    const embed = new EmbedBuilder()
        .setTitle('💰 Cashed Out!')
        .setDescription(`You cashed out at ${gameState.currentMultiplier}x! +${formatCurrency(profit)}`)
        .setColor('#FFD700')
        .addFields(
            { name: '🚀 Cash Out Point', value: `${gameState.currentMultiplier}x`, inline: true },
            { name: '💰 Profit', value: formatCurrency(profit), inline: true },
            { name: '📊 Crash Point', value: `${gameState.crashPoint}x`, inline: true }
        );

    await logGame(
        userId,
        'Crash',
        gameState.betAmount,
        'Win',
        gameState.currentMultiplier,
        profit,
        gameState.seed.hash
    );

    const newGameRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('crash_newgame')
                .setLabel('🎮 New Game')
                .setStyle(ButtonStyle.Primary)
        );

    await interaction.editReply({ embeds: [embed], components: [newGameRow] });
}

// Placeholder for joinGame function if it exists elsewhere or is intended to be added.
// If not used, it can be removed.
async function joinGame(interaction) {
    // This function is called when the 'join' action is triggered.
    // Implement the game joining logic here.
    // For now, let's assume it's a placeholder and reply with a message.
    await interaction.editReply({ content: 'Joining game...', components: [] });
}

// Placeholder for handleBetSelection function.
// This function is called when a specific bet amount is selected.
async function handleBetSelection(interaction, betAmount) {
    // This function is called when a specific bet amount is selected.
    // Implement the logic to start the crash game with the selected bet amount.
    await startCrashGame(interaction, betAmount);
}


module.exports = {
    handleButton
};