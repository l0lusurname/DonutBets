const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserBalance, updateUserBalance, logGame, formatCurrency, parseCurrency } = require('../utils/database');
const { generateSeed, generateCrashMultiplier } = require('../utils/provablyFair');

// Store active games
const activeGames = new Map();

async function handleButton(interaction, params) {
    const [action, ...data] = params;

    try {
        switch (action) {
            case 'start':
                await startGame(interaction);
                break;
            case 'bet':
                if (data[0] === 'custom') {
                    // Handle custom bet (simplified for now)
                    return;
                }
                await startCrashGame(interaction, parseInt(data[0]));
                break;
            case 'cashout':
                await cashOut(interaction);
                break;
            case 'newgame':
                await startGame(interaction);
                break;
        }
    } catch (error) {
        console.error('Crash button error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred!', ephemeral: true });
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

    if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [embed], components: [betRow] });
    } else {
        await interaction.reply({ embeds: [embed], components: [betRow] });
    }
}

async function startCrashGame(interaction, betAmount) {
    const userId = interaction.user.id;
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

module.exports = {
    handleButton
};