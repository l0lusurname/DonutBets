const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserBalance, updateUserBalance, logGame, formatCurrency, updateCasinoBankBalance } = require('../utils/database');
const { generateSeed, generateCrashMultiplier } = require('../utils/provablyFair');

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
        console.error('Crash button error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred!', flags: 64 });
        } else if (interaction.deferred) {
            await interaction.editReply({ content: 'An error occurred!', components: [] });
        }
    }
}

async function startGame(interaction) {
    const userId = interaction.user.id;
    
    // Check if user already has an active game
    if (activeGames.has(userId)) {
        const reply = {
            content: '❌ You already have an active Crash game! Use the "🚪 Close Game" button to end your current session first.',
            flags: 64
        };
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(reply);
        } else {
            await interaction.reply(reply);
        }
        return;
    }
    
    const balance = await getUserBalance(userId);

    if (balance < 1000) {
        const reply = {
            content: 'You need at least 1K credits to play Crash!',
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
            new ButtonBuilder().setCustomId('crash_start').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
        );

    await interaction.editReply({ embeds: [embed], components: [backRow] });

    const filter = (message) => {
        return message.author.id === userId && message.content.startsWith('!bet');
    };

    const collector = interaction.channel.createMessageCollector({ filter, time: 30000, max: 1 });

    collector.on('collect', async (message) => {
        const betInput = message.content.split(' ')[1];
        const betAmount = parseFormattedNumber(betInput);

        if (isNaN(betAmount) || betAmount < 1000) {
            await message.reply('Invalid bet amount! Minimum bet is 1K credits.');
            return;
        }

        if (betAmount > balance) {
            await message.reply('Insufficient balance!');
            return;
        }

        try {
            const replyMsg = await message.reply(`Custom bet set: ${formatCurrency(betAmount)}!`);
            setTimeout(() => replyMsg.delete().catch(() => {}), 3000);
            await message.delete().catch(() => {});
        } catch (error) {
            console.log('Message interaction error:', error.message);
        }

        await startCrashGame(interaction, betAmount);
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            startGame(interaction);
        }
    });
}

async function handleBetSelection(interaction, betAmount) {
    await startCrashGame(interaction, betAmount);
}

async function startCrashGame(interaction, betAmount) {
    const userId = interaction.user.id;
    const balance = await getUserBalance(userId);

    if (balance < betAmount) {
        await interaction.editReply({ content: 'Insufficient balance!', components: [] });
        return;
    }

    // Bank balance validation removed - no more bet limits!

    const seed = generateSeed();
    const crashPoint = await generateCrashMultiplier(seed);
    
    console.log(`🎲 NEW CRASH GAME - Crash Point: ${crashPoint}x`);

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
    await updateUserBalance(userId, balance - betAmount);
    await updateCrashGame(interaction, gameState);
}

async function updateCrashGame(interaction, gameState) {
    if (!gameState.gameActive || gameState.crashed || gameState.cashedOut) {
        return;
    }

    // Check for instant crash (0x)
    if (gameState.crashPoint === 0) {
        console.log(`💥 INSTANT CRASH at 0x`);
        gameState.crashed = true;
        gameState.gameActive = false;
        gameState.currentMultiplier = 0;
        await endCrashGame(interaction, gameState, true);
        return;
    }

    const elapsed = (Date.now() - gameState.startTime) / 1000;

    // Faster progression so crashes actually happen in reasonable time
    let newMultiplier;
    if (elapsed < 2) {
        // First 2 seconds: 1.0 to 1.2x
        newMultiplier = 1 + (elapsed * 0.1);
    } else if (elapsed < 5) {
        // Next 3 seconds: 1.2 to 1.5x  
        newMultiplier = 1.2 + ((elapsed - 2) * 0.1);
    } else if (elapsed < 10) {
        // Next 5 seconds: 1.5 to 2.0x
        newMultiplier = 1.5 + ((elapsed - 5) * 0.1);
    } else if (elapsed < 20) {
        // Next 10 seconds: 2.0 to 3.0x
        newMultiplier = 2.0 + ((elapsed - 10) * 0.1);
    } else {
        // After 20 seconds: accelerating climb to higher multipliers
        const acceleratedTime = elapsed - 20;
        const acceleration = Math.min(acceleratedTime * 0.02, 0.3);
        newMultiplier = 3.0 + (acceleratedTime * (0.05 + acceleration));
    }

    // Round to 2 decimal places for comparison
    newMultiplier = Math.round(newMultiplier * 100) / 100;
    
    console.log(`🚀 Current: ${gameState.currentMultiplier}x -> New: ${newMultiplier}x | Crash at: ${gameState.crashPoint}x`);

    // Check if the new multiplier would exceed or meet the crash point
    if (newMultiplier >= gameState.crashPoint && gameState.crashPoint > 0) {
        console.log(`💥 CRASH! ${newMultiplier}x >= ${gameState.crashPoint}x`);
        gameState.currentMultiplier = gameState.crashPoint;
        gameState.crashed = true;
        gameState.gameActive = false;
        await endCrashGame(interaction, gameState, true);
        return;
    }

    gameState.currentMultiplier = parseFloat(newMultiplier.toFixed(2));

    const embed = new EmbedBuilder()
        .setTitle('🚀 Crash Game - FLYING!')
        .setDescription(`**${gameState.currentMultiplier.toFixed(2)}x**`)
        .setColor('#00FF00')
        .addFields(
            { name: '💰 Bet Amount', value: formatCurrency(gameState.betAmount), inline: true },
            { name: '💰 Current Value', value: formatCurrency(Math.floor(gameState.betAmount * gameState.currentMultiplier)), inline: true }
        );

    const controlRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('crash_cashout')
                .setLabel(`💰 Cash Out - ${formatCurrency(Math.floor(gameState.betAmount * gameState.currentMultiplier))}`)
                .setStyle(ButtonStyle.Success)
        );

    await interaction.editReply({ embeds: [embed], components: [controlRow] });

    // Slower update interval - 300ms instead of 100ms
    setTimeout(() => updateCrashGame(interaction, gameState), 300);
}

async function cashOut(interaction) {
    const userId = interaction.user.id;
    const gameState = activeGames.get(userId);

    if (!gameState || !gameState.gameActive || gameState.crashed || gameState.cashedOut) {
        await interaction.deferUpdate();
        return;
    }

    gameState.cashedOut = true;
    gameState.gameActive = false;
    await endCrashGame(interaction, gameState, false);
}

async function endCrashGame(interaction, gameState, crashed) {
    const userId = gameState.userId;

    if (crashed) {
        let embed;

        if (gameState.crashPoint === 0) {
            // Instant crash (0x)
            embed = new EmbedBuilder()
                .setTitle('💥 INSTANT CRASH!')
                .setDescription('The rocket exploded instantly at **0x**!\nBetter luck next time!')
                .setColor('#FF0000')
                .addFields(
                    { name: '💰 Lost', value: formatCurrency(gameState.betAmount), inline: true },
                    { name: '💥 Crash Point', value: '0x', inline: true },
                    { name: '🔍 Server Seed', value: `\`${gameState.seed.serverSeed}\``, inline: false },
                    { name: '🎲 Client Seed', value: `\`${gameState.seed.clientSeed}\``, inline: true },
                    { name: '🔢 Nonce', value: `\`${gameState.seed.nonce}\``, inline: true },
                    { name: '🔐 Hash', value: `\`${gameState.seed.hash}\``, inline: false }
                );
        } else {
            // Normal crash
            const potentialWin = Math.floor(gameState.betAmount * gameState.crashPoint);
            const missedProfit = potentialWin - gameState.betAmount;

            embed = new EmbedBuilder()
                .setTitle('💥 CRASHED!')
                .setDescription(`The multiplier crashed at **${gameState.crashPoint.toFixed(2)}x**!\nHere's what you could have won if you cashed out earlier:`)
                .setColor('#FF0000')
                .addFields(
                    { name: '💰 Lost', value: formatCurrency(gameState.betAmount), inline: true },
                    { name: '💥 Crash Point', value: `${gameState.crashPoint.toFixed(2)}x`, inline: true },
                    { name: '📊 Could Have Won', value: formatCurrency(potentialWin), inline: true },
                    { name: '💸 Missed Profit', value: formatCurrency(missedProfit), inline: true },
                    { name: '🎯 Max Safe Cashout', value: `${(gameState.crashPoint - 0.01).toFixed(2)}x`, inline: true },
                    { name: '🔍 Server Seed', value: `\`${gameState.seed.serverSeed}\``, inline: false },
                    { name: '🎲 Client Seed', value: `\`${gameState.seed.clientSeed}\``, inline: true },
                    { name: '🔢 Nonce', value: `\`${gameState.seed.nonce}\``, inline: true },
                    { name: '🔐 Hash', value: `\`${gameState.seed.hash}\``, inline: false }
                );
        }

        // Update casino bank balance (casino gains the bet amount on user loss)
        await updateCasinoBankBalance(gameState.betAmount);

        await logGame(userId, 'Crash', gameState.betAmount, 'Loss', 0, -gameState.betAmount, gameState.seed.hash);

        const newGameRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('crash_newgame')
                    .setLabel('🎮 New Game')
                    .setStyle(ButtonStyle.Primary)
            );

        await interaction.editReply({ embeds: [embed], components: [newGameRow] });
    } else {
        const winAmount = Math.floor(gameState.betAmount * gameState.currentMultiplier);
        const profit = winAmount - gameState.betAmount;
        const currentBalance = await getUserBalance(userId);

        await updateUserBalance(userId, currentBalance + winAmount);

        // Update casino bank balance (opposite of user's profit/loss)
        await updateCasinoBankBalance(-profit);

        const embed = new EmbedBuilder()
            .setTitle('💰 CASHED OUT!')
            .setDescription(`Cashed out at **${gameState.currentMultiplier.toFixed(2)}x**`)
            .setColor('#00FF00')
            .addFields(
                { name: '💰 Bet Amount', value: formatCurrency(gameState.betAmount), inline: true },
                { name: '🎯 Multiplier', value: `${gameState.currentMultiplier.toFixed(2)}x`, inline: true },
                { name: '💰 Win Amount', value: formatCurrency(winAmount), inline: true },
                { name: '📈 Profit', value: formatCurrency(profit), inline: true }
            );

        await logGame(userId, 'Crash', gameState.betAmount, 'Win', gameState.currentMultiplier, profit, gameState.seed.hash);

        const newGameRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('crash_newgame')
                    .setLabel('🎮 New Game')
                    .setStyle(ButtonStyle.Primary)
            );

        await interaction.editReply({ embeds: [embed], components: [newGameRow] });
    }
}

async function closeGame(interaction) {
    const userId = interaction.user.id;
    
    if (!activeGames.has(userId)) {
        const reply = {
            content: '❌ You don\'t have an active Crash game to close.',
            flags: 64
        };
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(reply);
        } else {
            await interaction.reply(reply);
        }
        return;
    }
    
    // Remove the active game
    activeGames.delete(userId);
    
    const embed = new EmbedBuilder()
        .setTitle('🚪 Game Closed')
        .setDescription('Your Crash game has been closed. You can start a new game anytime!')
        .setColor('#6c757d');
    
    const newGameRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('crash_newgame')
                .setLabel('🎮 Start New Game')
                .setStyle(ButtonStyle.Primary)
        );
    
    await interaction.editReply({ embeds: [embed], components: [newGameRow] });
}

module.exports = { handleButton, startGame };