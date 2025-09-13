const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserBalance, updateUserBalance, logGame, formatCurrency, updateCasinoBankBalance } = require('../utils/database');
const { generateSeed, generateMinesResults } = require('../utils/provablyFair');

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
            case 'mines':
                await handleMineSelection(interaction, parseInt(data[0]));
                break;
            case 'game':
                const userId = interaction.user.id;
                const gameState = activeGames.get(userId);
                if (gameState && gameState.betAmount && gameState.mineCount) {
                    await setupGame(interaction, gameState.betAmount, gameState.mineCount);
                }
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
            case 'close':
                await closeGame(interaction);
                break;
        }
    } catch (error) {
        console.error('Mines button error:', error);
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
            content: 'You need at least 1K credits to play Mines!',
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
        .setTitle('💣 Mines Game')
        .setDescription('Select your bet amount and number of mines!')
        .setColor('#FF4500')
        .addFields(
            { name: '💰 Your Balance', value: formatCurrency(balance), inline: true },
            { name: '💣 Mines', value: 'Choose 1-15 mines', inline: true }
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
            new ButtonBuilder().setCustomId('mines_mines_8').setLabel('8 💣').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('mines_mines_12').setLabel('12 💣').setStyle(ButtonStyle.Secondary)
        );

    const mineRow2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('mines_mines_15').setLabel('15 💣').setStyle(ButtonStyle.Danger)
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
            { name: '💡 Tip', value: 'Minimum bet: 1K credits\nSupports: k, m, b suffixes', inline: true }
        );

    const backRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('mines_start').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
        );

    await interaction.editReply({ embeds: [embed], components: [backRow] });

    const filter = (message) => {
        return message.author.id === userId && message.content.startsWith('!bet');
    };

    const collector = interaction.channel.createMessageCollector({ filter, time: 30000, max: 1 });

    collector.on('collect', async (message) => {
        try {
            const betInput = message.content.split(' ')[1];
            console.log('Custom bet input:', betInput);
            
            if (!betInput) {
                await message.reply('Please specify a bet amount! Example: `!bet 99k`');
                return;
            }
            
            const betAmount = parseFormattedNumber(betInput);
            console.log('Parsed bet amount:', betAmount);

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
    let gameState = activeGames.get(userId) || {};
    gameState.betAmount = betAmount;
    activeGames.set(userId, gameState);

    if (gameState.mineCount) {
        await setupGame(interaction, gameState.betAmount, gameState.mineCount);
    } else {
        await updateSelectionDisplay(interaction, gameState);
    }
}

async function handleMineSelection(interaction, mineCount) {
    const userId = interaction.user.id;
    let gameState = activeGames.get(userId) || {};
    gameState.mineCount = mineCount;
    activeGames.set(userId, gameState);

    if (gameState.betAmount) {
        await setupGame(interaction, gameState.betAmount, gameState.mineCount);
    } else {
        await updateSelectionDisplay(interaction, gameState);
    }
}

async function updateSelectionDisplay(interaction, gameState) {
    const userId = interaction.user.id;
    const balance = await getUserBalance(userId);

    const embed = new EmbedBuilder()
        .setTitle('💣 Mines Game - Setup')
        .setDescription('Select your bet amount and number of mines!')
        .setColor('#FF4500')
        .addFields(
            { name: '💰 Your Balance', value: formatCurrency(balance), inline: true },
            { name: '💰 Selected Bet', value: gameState.betAmount ? formatCurrency(gameState.betAmount) : 'Not selected', inline: true },
            { name: '💣 Selected Mines', value: gameState.mineCount ? `${gameState.mineCount} mines` : 'Not selected', inline: true }
        );

    if (gameState.betAmount && gameState.mineCount) {
        embed.addFields({ name: '🎮 Ready!', value: 'Click "Start Game" to begin!', inline: false });
    }

    const betRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('mines_bet_100').setLabel('100').setStyle(gameState.betAmount === 100 ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('mines_bet_500').setLabel('500').setStyle(gameState.betAmount === 500 ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('mines_bet_1000').setLabel('1K').setStyle(gameState.betAmount === 1000 ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('mines_bet_5000').setLabel('5K').setStyle(gameState.betAmount === 5000 ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('mines_bet_10000').setLabel('10K').setStyle(gameState.betAmount === 10000 ? ButtonStyle.Success : ButtonStyle.Primary)
        );

    const customRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('mines_bet_custom').setLabel('💰 Custom Bet').setStyle(ButtonStyle.Success)
        );

    const mineRow1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('mines_mines_1').setLabel('1 💣').setStyle(gameState.mineCount === 1 ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('mines_mines_3').setLabel('3 💣').setStyle(gameState.mineCount === 3 ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('mines_mines_5').setLabel('5 💣').setStyle(gameState.mineCount === 5 ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('mines_mines_8').setLabel('8 💣').setStyle(gameState.mineCount === 8 ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('mines_mines_12').setLabel('12 💣').setStyle(gameState.mineCount === 12 ? ButtonStyle.Success : ButtonStyle.Secondary)
        );

    const mineRow2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('mines_mines_15').setLabel('15 💣').setStyle(gameState.mineCount === 15 ? ButtonStyle.Success : ButtonStyle.Danger)
        );

    // Add start game button if both selections are made
    const components = [betRow, customRow, mineRow1, mineRow2];
    if (gameState.betAmount && gameState.mineCount) {
        const startRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('mines_game').setLabel('🎮 Start Game!').setStyle(ButtonStyle.Primary)
            );
        components.push(startRow);
    }

    await interaction.editReply({ embeds: [embed], components });
}

async function setupGame(interaction, betAmount, mineCount) {
    const userId = interaction.user.id;
    const balance = await getUserBalance(userId);

    if (balance < betAmount) {
        await interaction.editReply({ content: 'Insufficient balance!', components: [] });
        return;
    }

    // Bank balance validation removed - no more bet limits!

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
            { name: '💎 Safe Tiles', value: (16 - mineCount).toString(), inline: true }
        );

    const rows = [];
    for (let i = 0; i < 4; i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < 4; j++) {
            const tileNumber = i * 4 + j;
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`mines_tile_${tileNumber}`)
                    .setLabel('?')
                    .setStyle(ButtonStyle.Secondary)
            );
        }
        rows.push(row);
    }

    // Add cashout button row
    const cashoutRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('mines_cashout')
                .setLabel('💰 Cash Out')
                .setStyle(ButtonStyle.Success)
        );
    rows.push(cashoutRow);

    await interaction.editReply({ embeds: [embed], components: rows });
}

async function revealTile(interaction, tileNumber) {
    const userId = interaction.user.id;
    const gameState = activeGames.get(userId);

    if (!gameState || !gameState.gameActive) {
        return;
    }

    if (gameState.revealedTiles.has(tileNumber)) {
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
    const totalSafeTiles = 16 - gameState.mineCount;

    // Better multiplier calculation based on mine count and tiles revealed
    let baseMultiplier;
    if (gameState.mineCount === 1) baseMultiplier = 1.05;
    else if (gameState.mineCount <= 3) baseMultiplier = 1.12;
    else if (gameState.mineCount <= 5) baseMultiplier = 1.18;
    else if (gameState.mineCount <= 10) baseMultiplier = 1.25;
    else baseMultiplier = 1.35;

    const multiplier = Math.pow(baseMultiplier, revealedSafeTiles);
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

    // Create 4x4 grid (16 tiles)
    for (let i = 0; i < 4; i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < 4; j++) {
            const tileNumber = i * 4 + j;
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

    // Add cashout button
    const controlRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('mines_cashout')
                .setLabel(`💰 Cash Out - ${formatCurrency(potentialWin)}`)
                .setStyle(ButtonStyle.Success)
        );
    rows.push(controlRow);

    await interaction.editReply({ embeds: [embed], components: rows });
}

async function gameOver(interaction, gameState, hitMine) {
    gameState.gameActive = false;

    const embed = new EmbedBuilder()
        .setTitle('💣 Game Over!')
        .setDescription('You hit a mine! Here\'s the full board revealed:')
        .setColor('#FF0000')
        .addFields(
            { name: '💰 Lost', value: formatCurrency(gameState.betAmount), inline: true },
            { name: '💣 Hit Mine', value: `Position ${hitMine}`, inline: true },
            { name: '🔍 Server Seed', value: `\`${gameState.seed.serverSeed}\``, inline: false },
            { name: '🎲 Client Seed', value: `\`${gameState.seed.clientSeed}\``, inline: true },
            { name: '🔢 Nonce', value: `\`${gameState.seed.nonce}\``, inline: true },
            { name: '🔐 Hash', value: `\`${gameState.seed.hash}\``, inline: false }
        );

    // Create revealed board showing all mines and diamonds
    const rows = [];
    for (let i = 0; i < 4; i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < 4; j++) {
            const tileNumber = i * 4 + j;
            const isMine = gameState.minePositions.includes(tileNumber);
            const isHitMine = tileNumber === hitMine;
            
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`mines_revealed_${tileNumber}`)
                    .setLabel(isMine ? '💣' : '💎')
                    .setStyle(isHitMine ? ButtonStyle.Danger : (isMine ? ButtonStyle.Secondary : ButtonStyle.Success))
                    .setDisabled(true)
            );
        }
        rows.push(row);
    }

    // Add new game button
    const newGameRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('mines_newgame')
                .setLabel('🎮 New Game')
                .setStyle(ButtonStyle.Primary)
        );
    rows.push(newGameRow);

    // Update casino bank balance (casino gains the bet amount on user loss)
    await updateCasinoBankBalance(gameState.betAmount);
    
    await logGame(
        gameState.userId,
        'Mines',
        gameState.betAmount,
        'Loss',
        0,
        -gameState.betAmount,
        gameState.seed.hash
    );

    await interaction.editReply({ embeds: [embed], components: rows });
}

async function cashOut(interaction) {
    const userId = interaction.user.id;
    const gameState = activeGames.get(userId);

    if (!gameState || !gameState.gameActive) {
        return;
    }

    gameState.gameActive = false;
    const revealedSafeTiles = gameState.revealedTiles.size;

    // Better multiplier calculation based on mine count and tiles revealed
    let baseMultiplier;
    if (gameState.mineCount === 1) baseMultiplier = 1.05;
    else if (gameState.mineCount <= 3) baseMultiplier = 1.12;
    else if (gameState.mineCount <= 5) baseMultiplier = 1.18;
    else if (gameState.mineCount <= 10) baseMultiplier = 1.25;
    else baseMultiplier = 1.35;

    const multiplier = Math.pow(baseMultiplier, revealedSafeTiles);
    const winAmount = Math.floor(gameState.betAmount * multiplier);
    const profit = winAmount - gameState.betAmount;

    const currentBalance = await getUserBalance(userId);
    await updateUserBalance(userId, currentBalance + winAmount);
    
    // Update casino bank balance (opposite of user's profit/loss)
    await updateCasinoBankBalance(-profit);

    const embed = new EmbedBuilder()
        .setTitle('💰 Cashed Out!')
        .setDescription('You successfully cashed out! Here\'s the full board revealed:')
        .setColor('#00FF00')
        .addFields(
            { name: '💰 Bet Amount', value: formatCurrency(gameState.betAmount), inline: true },
            { name: '🎯 Multiplier', value: `${multiplier.toFixed(2)}x`, inline: true },
            { name: '💰 Win Amount', value: formatCurrency(winAmount), inline: true },
            { name: '📈 Profit', value: formatCurrency(profit), inline: true },
            { name: '🔍 Server Seed', value: `\`${gameState.seed.serverSeed}\``, inline: false },
            { name: '🎲 Client Seed', value: `\`${gameState.seed.clientSeed}\``, inline: true },
            { name: '🔢 Nonce', value: `\`${gameState.seed.nonce}\``, inline: true },
            { name: '🔐 Hash', value: `\`${gameState.seed.hash}\``, inline: false }
        );

    // Create revealed board showing all mines and diamonds (same as gameOver)
    const rows = [];
    for (let i = 0; i < 4; i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < 4; j++) {
            const tileNumber = i * 4 + j;
            const isMine = gameState.minePositions.includes(tileNumber);
            const wasRevealed = gameState.revealedTiles.has(tileNumber);
            
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`mines_revealed_${tileNumber}`)
                    .setLabel(isMine ? '💣' : '💎')
                    .setStyle(wasRevealed ? ButtonStyle.Success : (isMine ? ButtonStyle.Secondary : ButtonStyle.Success))
                    .setDisabled(true)
            );
        }
        rows.push(row);
    }

    await logGame(
        userId,
        'Mines',
        gameState.betAmount,
        'Win',
        multiplier,
        profit,
        gameState.seed.hash
    );

    // Add new game button
    const newGameRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('mines_newgame')
                .setLabel('🎮 New Game')
                .setStyle(ButtonStyle.Primary)
        );
    rows.push(newGameRow);

    await interaction.editReply({ embeds: [embed], components: rows });
}

async function closeGame(interaction) {
    const userId = interaction.user.id;
    
    if (!activeGames.has(userId)) {
        const reply = {
            content: '❌ You don\'t have an active Mines game to close.',
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
        .setDescription('Your Mines game has been closed. You can start a new game anytime!')
        .setColor('#6c757d');
    
    const newGameRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('mines_newgame')
                .setLabel('🎮 Start New Game')
                .setStyle(ButtonStyle.Primary)
        );
    
    await interaction.editReply({ embeds: [embed], components: [newGameRow] });
}

module.exports = { handleButton, startGame, cashOut };