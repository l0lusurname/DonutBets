const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserBalance, updateUserBalance, logGame, formatCurrency } = require('../utils/database');
const { generateSeed, generateCrashMultiplier } = require('../utils/provablyFair');

const activeGames = new Map();

function parseFormattedNumber(input) {
    if (typeof input === 'number') return input;

    const str = input.toString().toLowerCase().replace(/,/g, '');
    const num = parseFloat(str);

    if (str.includes('k')) return Math.floor(num * 1000);
    if (str.includes('m')) return Math.floor(num * 1000000);
    if (str.includes('b')) return Math.floor(num * 1000000000);

    return Math.floor(num);
}

async function handleButton(interaction, params) {
    const [action, ...data] = params;

    try {
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
            await interaction.reply({ content: 'An error occurred!', flags: 64 });
        } else if (interaction.deferred) {
            await interaction.editReply({ content: 'An error occurred!', components: [] });
        }
    }
}

async function startGame(interaction) {
    const userId = interaction.user.id;
    const balance = await getUserBalance(userId);

    if (balance < 100) {
        const reply = {
            content: 'You need at least 100 credits to play Crash!',
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
            { name: '💡 Tip', value: 'Minimum bet: 100 credits\nSupports: k, m, b suffixes', inline: true }
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

        if (isNaN(betAmount) || betAmount < 100) {
            await message.reply('Invalid bet amount! Minimum bet is 100 credits.');
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
    await updateUserBalance(userId, balance - betAmount);
    await updateCrashGame(interaction, gameState);
}

async function updateCrashGame(interaction, gameState) {
    if (!gameState.gameActive || gameState.crashed || gameState.cashedOut) {
        return;
    }

    const elapsed = (Date.now() - gameState.startTime) / 1000;
    let newMultiplier;

    if (gameState.currentMultiplier < 2) {
        newMultiplier = 1 + (elapsed * 0.1);
    } else if (gameState.currentMultiplier < 5) {
        newMultiplier = 1 + (elapsed * 0.2);
    } else {
        const speedMultiplier = Math.pow(2, Math.floor(gameState.currentMultiplier / 5));
        const baseSpeed = Math.min(speedMultiplier * 0.2, 5);
        newMultiplier = 1 + (elapsed * baseSpeed);
    }

    gameState.currentMultiplier = parseFloat(newMultiplier.toFixed(2));

    if (gameState.currentMultiplier >= gameState.crashPoint) {
        gameState.crashed = true;
        gameState.gameActive = false;
        await endCrashGame(interaction, gameState, true);
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle('🚀 Crash Game - FLYING!')
        .setDescription(`**${gameState.currentMultiplier.toFixed(2)}x**`)
        .setColor('#00FF00')
        .addFields(
            { name: '💰 Bet Amount', value: formatCurrency(gameState.betAmount), inline: true },
            { name: '💰 Current Value', value: formatCurrency(Math.floor(gameState.betAmount * gameState.currentMultiplier)), inline: true }
        );

    const cashoutRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('crash_cashout')
                .setLabel(`💰 Cash Out - ${formatCurrency(Math.floor(gameState.betAmount * gameState.currentMultiplier))}`)
                .setStyle(ButtonStyle.Success)
        );

    await interaction.editReply({ embeds: [embed], components: [cashoutRow] });

    setTimeout(() => updateCrashGame(interaction, gameState), 100);
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
        const embed = new EmbedBuilder()
            .setTitle('💥 CRASHED!')
            .setDescription(`Crashed at **${gameState.crashPoint.toFixed(2)}x**`)
            .setColor('#FF0000')
            .addFields(
                { name: '💰 Lost', value: formatCurrency(gameState.betAmount), inline: true },
                { name: '💥 Crash Point', value: `${gameState.crashPoint.toFixed(2)}x`, inline: true }
            );

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

module.exports = { handleButton, startGame };