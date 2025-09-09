
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserBalance, updateUserBalance, logGame, formatCurrency } = require('../utils/database');
const { generateSeed, generateMinesResults } = require('../utils/provablyFair');

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
            case 'mines':
                await handleMineSelection(interaction, parseInt(data[0]));
                break;
            case 'tile':
                await revealTile(interaction, parseInt(data[0]));
                break;
            case 'cashout':
                await cashOut(interaction);
                break;
            case 'newgame':
                await startGame(interaction);
                break;
        }
    } catch (error) {
        console.error('Mines button error:', error);
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
        const reply = {
            content: 'You need at least 100 credits to play Mines!',
            ephemeral: true
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
        .setTitle('💣 Mines Game')
        .setDescription('Select your bet amount and number of mines!')
        .setColor('#FF4500')
        .addFields(
            { name: '💰 Your Balance', value: formatCurrency(balance), inline: true },
            { name: '💣 Mines', value: 'Choose 1-24 mines', inline: true }
        );

    const betRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('mines_bet_100').setLabel('100').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('mines_bet_500').setLabel('500').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('mines_bet_1000').setLabel('1K').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('mines_bet_5000').setLabel('5K').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('mines_bet_10000').setLabel('10K').setStyle(ButtonStyle.Primary)
        );

    const customRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('mines_bet_custom').setLabel('💰 Custom Bet').setStyle(ButtonStyle.Success)
        );

    const mineRow1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('mines_mines_1').setLabel('1 💣').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('mines_mines_3').setLabel('3 💣').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('mines_mines_5').setLabel('5 💣').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('mines_mines_10').setLabel('10 💣').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('mines_mines_15').setLabel('15 💣').setStyle(ButtonStyle.Secondary)
        );

    const mineRow2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('mines_mines_20').setLabel('20 💣').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('mines_mines_24').setLabel('24 💣').setStyle(ButtonStyle.Danger)
        );

    if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [embed], components: [betRow, customRow, mineRow1, mineRow2] });
    } else {
        await interaction.reply({ embeds: [embed], components: [betRow, customRow, mineRow1, mineRow2] });
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
            new ButtonBuilder().setCustomId('mines_start').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
        );

    await interaction.update({ embeds: [embed], components: [backRow] });

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

        await message.delete().catch(() => {});
        await message.reply(`Custom bet set: ${formatCurrency(betAmount)}!`).then(msg => {
            setTimeout(() => msg.delete().catch(() => {}), 3000);
        });

        await handleBetSelection(interaction, betAmount);
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            startGame(interaction);
        }
    });
}

async function handleBetSelection(interaction, betAmount) {
    const userId = interaction.user.id;
    let gameState = activeGames.get(userId) || {};
    gameState.betAmount = betAmount;
    activeGames.set(userId, gameState);

    if (gameState.mineCount) {
        await setupGame(interaction, gameState.betAmount, gameState.mineCount);
    }
}

async function handleMineSelection(interaction, mineCount) {
    const userId = interaction.user.id;
    let gameState = activeGames.get(userId) || {};
    gameState.mineCount = mineCount;
    activeGames.set(userId, gameState);

    if (gameState.betAmount) {
        await setupGame(interaction, gameState.betAmount, gameState.mineCount);
    }
}

async function setupGame(interaction, betAmount, mineCount) {
    const userId = interaction.user.id;
    const balance = await getUserBalance(userId);

    if (balance < betAmount) {
        await interaction.editReply({ content: 'Insufficient balance!', components: [] });
        return;
    }

    const seed = generateSeed();
    const minePositions = generateMinesResults(seed, mineCount);

    const gameState = {
        userId,
        betAmount,
        mineCount,
        minePositions,
        revealedTiles: new Set(),
        gameActive: true,
        seed
    };

    activeGames.set(userId, gameState);
    await updateUserBalance(userId, balance - betAmount);

    const embed = new EmbedBuilder()
        .setTitle('💣 Mines Game - In Progress')
        .setDescription('Click tiles to reveal them. Avoid the mines!')
        .setColor('#00FF00')
        .addFields(
            { name: '💰 Bet Amount', value: formatCurrency(betAmount), inline: true },
            { name: '💣 Mines', value: mineCount.toString(), inline: true },
            { name: '💎 Safe Tiles', value: (25 - mineCount).toString(), inline: true }
        );

    const rows = [];
    for (let i = 0; i < 5; i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < 5; j++) {
            const tileNumber = i * 5 + j;
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`mines_tile_${tileNumber}`)
                    .setLabel('?')
                    .setStyle(ButtonStyle.Secondary)
            );
        }
        rows.push(row);
    }

    await interaction.editReply({ embeds: [embed], components: rows });
}

async function revealTile(interaction, tileNumber) {
    const userId = interaction.user.id;
    const gameState = activeGames.get(userId);

    if (!gameState || !gameState.gameActive) {
        await interaction.deferUpdate();
        return;
    }

    if (gameState.revealedTiles.has(tileNumber)) {
        await interaction.deferUpdate();
        return;
    }

    gameState.revealedTiles.add(tileNumber);

    if (gameState.minePositions.includes(tileNumber)) {
        await gameOver(interaction, gameState, tileNumber);
    } else {
        await updateGameBoard(interaction, gameState);
    }
}

async function updateGameBoard(interaction, gameState) {
    const revealedSafeTiles = gameState.revealedTiles.size;
    const totalSafeTiles = 25 - gameState.mineCount;
    const multiplier = Math.pow(1.1, revealedSafeTiles);
    const potentialWin = Math.floor(gameState.betAmount * multiplier);

    const embed = new EmbedBuilder()
        .setTitle('💣 Mines Game - In Progress')
        .setDescription('Click tiles to reveal them. Avoid the mines!')
        .setColor('#00FF00')
        .addFields(
            { name: '💰 Bet Amount', value: formatCurrency(gameState.betAmount), inline: true },
            { name: '💣 Mines', value: gameState.mineCount.toString(), inline: true },
            { name: '💎 Revealed', value: `${revealedSafeTiles}/${totalSafeTiles}`, inline: true },
            { name: '🎯 Current Multiplier', value: `${multiplier.toFixed(2)}x`, inline: true },
            { name: '💰 Potential Win', value: formatCurrency(potentialWin), inline: true }
        );

    const rows = [];
    for (let i = 0; i < 5; i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < 5; j++) {
            const tileNumber = i * 5 + j;
            const isRevealed = gameState.revealedTiles.has(tileNumber);
            
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`mines_tile_${tileNumber}`)
                    .setLabel(isRevealed ? '💎' : '?')
                    .setStyle(isRevealed ? ButtonStyle.Success : ButtonStyle.Secondary)
                    .setDisabled(isRevealed)
            );
        }
        rows.push(row);
    }

    const cashoutRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('mines_cashout')
                .setLabel(`💰 Cash Out - ${formatCurrency(potentialWin)}`)
                .setStyle(ButtonStyle.Primary)
        );

    rows.push(cashoutRow);

    await interaction.update({ embeds: [embed], components: rows });
}

async function gameOver(interaction, gameState, hitMine) {
    gameState.gameActive = false;

    const embed = new EmbedBuilder()
        .setTitle('💣 Game Over!')
        .setDescription('You hit a mine!')
        .setColor('#FF0000')
        .addFields(
            { name: '💰 Lost', value: formatCurrency(gameState.betAmount), inline: true },
            { name: '💣 Hit Mine', value: `Position ${hitMine}`, inline: true }
        );

    await logGame(
        gameState.userId,
        'Mines',
        gameState.betAmount,
        'Loss',
        0,
        -gameState.betAmount,
        gameState.seed.hash
    );

    const newGameRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('mines_newgame')
                .setLabel('🎮 New Game')
                .setStyle(ButtonStyle.Primary)
        );

    await interaction.update({ embeds: [embed], components: [newGameRow] });
}

async function cashOut(interaction) {
    const userId = interaction.user.id;
    const gameState = activeGames.get(userId);

    if (!gameState || !gameState.gameActive) {
        await interaction.deferUpdate();
        return;
    }

    gameState.gameActive = false;
    const revealedSafeTiles = gameState.revealedTiles.size;
    const multiplier = Math.pow(1.1, revealedSafeTiles);
    const winAmount = Math.floor(gameState.betAmount * multiplier);
    const profit = winAmount - gameState.betAmount;

    const currentBalance = await getUserBalance(userId);
    await updateUserBalance(userId, currentBalance + winAmount);

    const embed = new EmbedBuilder()
        .setTitle('💰 Cashed Out!')
        .setDescription('You successfully cashed out!')
        .setColor('#00FF00')
        .addFields(
            { name: '💰 Bet Amount', value: formatCurrency(gameState.betAmount), inline: true },
            { name: '🎯 Multiplier', value: `${multiplier.toFixed(2)}x`, inline: true },
            { name: '💰 Win Amount', value: formatCurrency(winAmount), inline: true },
            { name: '📈 Profit', value: formatCurrency(profit), inline: true }
        );

    await logGame(
        userId,
        'Mines',
        gameState.betAmount,
        'Win',
        multiplier,
        profit,
        gameState.seed.hash
    );

    const newGameRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('mines_newgame')
                .setLabel('🎮 New Game')
                .setStyle(ButtonStyle.Primary)
        );

    await interaction.update({ embeds: [embed], components: [newGameRow] });
}

module.exports = { handleButton, startGame };
