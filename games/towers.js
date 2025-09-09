
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserBalance, updateUserBalance, logGame, formatCurrency } = require('../utils/database');
const { generateSeed, generateTowersResults } = require('../utils/provablyFair');

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
            case 'difficulty':
                await handleDifficultySelection(interaction, data[0]);
                break;
            case 'game':
                const userId = interaction.user.id;
                const gameState = activeGames.get(userId);
                if (gameState && gameState.betAmount && gameState.difficulty) {
                    await setupGame(interaction, gameState.betAmount, gameState.difficulty);
                }
                break;
            case 'tile':
                await selectTile(interaction, parseInt(data[0]), parseInt(data[1]));
                break;
            case 'cashout':
                await cashOut(interaction);
                break;
            case 'newgame':
                await startGame(interaction);
                break;
        }
    } catch (error) {
        console.error('Towers button error:', error);
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
            content: 'You need at least 100 credits to play Towers!',
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
        .setTitle('🗼 Towers Game')
        .setDescription('Choose your bet amount and difficulty!')
        .setColor('#4B0082')
        .addFields(
            { name: '💰 Your Balance', value: formatCurrency(balance), inline: true },
            { name: '🎯 Difficulty', value: 'Choose wisely!', inline: true }
        );

    const betRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('towers_bet_100').setLabel('100').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('towers_bet_500').setLabel('500').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('towers_bet_1000').setLabel('1K').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('towers_bet_5000').setLabel('5K').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('towers_bet_10000').setLabel('10K').setStyle(ButtonStyle.Primary)
        );

    const customRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('towers_bet_custom').setLabel('💰 Custom Bet').setStyle(ButtonStyle.Success)
        );

    const difficultyRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('towers_difficulty_easy').setLabel('🟢 Easy: 4 blocks, 1 mine').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('towers_difficulty_medium').setLabel('🟡 Medium: 3 blocks, 1 mine').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('towers_difficulty_hard').setLabel('🔴 Hard: 2 blocks, 1 mine').setStyle(ButtonStyle.Danger)
        );

    if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [embed], components: [betRow, customRow, difficultyRow] });
    } else {
        await interaction.reply({ embeds: [embed], components: [betRow, customRow, difficultyRow] });
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
            new ButtonBuilder().setCustomId('towers_start').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
        );

    if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [embed], components: [backRow] });
    } else {
        await interaction.update({ embeds: [embed], components: [backRow] });
    }

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

    if (gameState.difficulty) {
        await setupGame(interaction, gameState.betAmount, gameState.difficulty);
    } else {
        await updateSelectionDisplay(interaction, gameState);
    }
}

async function handleDifficultySelection(interaction, difficulty) {
    const userId = interaction.user.id;
    let gameState = activeGames.get(userId) || {};
    gameState.difficulty = difficulty;
    activeGames.set(userId, gameState);

    if (gameState.betAmount) {
        await setupGame(interaction, gameState.betAmount, gameState.difficulty);
    } else {
        await updateSelectionDisplay(interaction, gameState);
    }
}

async function updateSelectionDisplay(interaction, gameState) {
    const userId = interaction.user.id;
    const balance = await getUserBalance(userId);

    const embed = new EmbedBuilder()
        .setTitle('🗼 Towers Game - Setup')
        .setDescription('Choose your bet amount and difficulty!')
        .setColor('#4B0082')
        .addFields(
            { name: '💰 Your Balance', value: formatCurrency(balance), inline: true },
            { name: '💰 Selected Bet', value: gameState.betAmount ? formatCurrency(gameState.betAmount) : 'Not selected', inline: true },
            { name: '🎯 Selected Difficulty', value: gameState.difficulty ? gameState.difficulty.charAt(0).toUpperCase() + gameState.difficulty.slice(1) : 'Not selected', inline: true }
        );

    if (gameState.betAmount && gameState.difficulty) {
        embed.addFields({ name: '🎮 Ready!', value: 'Click "Start Game" to begin!', inline: false });
    }

    const betRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('towers_bet_100').setLabel('100').setStyle(gameState.betAmount === 100 ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('towers_bet_500').setLabel('500').setStyle(gameState.betAmount === 500 ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('towers_bet_1000').setLabel('1K').setStyle(gameState.betAmount === 1000 ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('towers_bet_5000').setLabel('5K').setStyle(gameState.betAmount === 5000 ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('towers_bet_10000').setLabel('10K').setStyle(gameState.betAmount === 10000 ? ButtonStyle.Success : ButtonStyle.Primary)
        );

    const customRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('towers_bet_custom').setLabel('💰 Custom Bet').setStyle(ButtonStyle.Success)
        );

    const difficultyRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('towers_difficulty_easy').setLabel('🟢 Easy').setStyle(gameState.difficulty === 'easy' ? ButtonStyle.Success : ButtonStyle.Success),
            new ButtonBuilder().setCustomId('towers_difficulty_medium').setLabel('🟡 Medium').setStyle(gameState.difficulty === 'medium' ? ButtonStyle.Success : ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('towers_difficulty_hard').setLabel('🔴 Hard').setStyle(gameState.difficulty === 'hard' ? ButtonStyle.Success : ButtonStyle.Danger)
        );

    const components = [betRow, customRow, difficultyRow];
    
    if (gameState.betAmount && gameState.difficulty) {
        const startRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('towers_game').setLabel('🎮 Start Game!').setStyle(ButtonStyle.Primary)
            );
        components.push(startRow);
    }

    await interaction.editReply({ embeds: [embed], components });
}

async function setupGame(interaction, betAmount, difficulty) {
    const userId = interaction.user.id;
    const balance = await getUserBalance(userId);

    if (balance < betAmount) {
        await interaction.editReply({ content: 'Insufficient balance!', components: [] });
        return;
    }

    let blocksPerLevel;
    switch (difficulty) {
        case 'easy': blocksPerLevel = 4; break;
        case 'medium': blocksPerLevel = 3; break; 
        case 'hard': blocksPerLevel = 2; break;
        default: blocksPerLevel = 3;
    }

    const seed = generateSeed();
    const correctPath = generateTowersResults(seed, 8, blocksPerLevel);

    const gameState = {
        userId,
        betAmount,
        difficulty,
        blocksPerLevel,
        correctPath,
        currentLevel: 0,
        gameActive: true,
        seed
    };

    activeGames.set(userId, gameState);
    await updateUserBalance(userId, balance - betAmount);
    await updateTowersBoard(interaction, gameState);
}

async function updateTowersBoard(interaction, gameState) {
    const multiplier = Math.pow(1.5, gameState.currentLevel);
    const potentialWin = Math.floor(gameState.betAmount * multiplier);

    // Build visual representation of completed levels
    let completedLevels = '';
    for (let level = gameState.currentLevel - 1; level >= Math.max(0, gameState.currentLevel - 5); level--) {
        let levelStr = `Level ${level + 1}: `;
        for (let block = 0; block < gameState.blocksPerLevel; block++) {
            if (block === gameState.correctPath[level]) {
                levelStr += '💎 ';
            } else {
                levelStr += '💣 ';
            }
        }
        completedLevels += levelStr + '\n';
    }

    const embed = new EmbedBuilder()
        .setTitle('🗼 Towers Game')
        .setDescription(`**Level ${gameState.currentLevel + 1}/8**\n${completedLevels || 'Start climbing!'}`)
        .setColor('#4B0082')
        .addFields(
            { name: '💰 Bet Amount', value: formatCurrency(gameState.betAmount), inline: true },
            { name: '🎯 Difficulty', value: gameState.difficulty.charAt(0).toUpperCase() + gameState.difficulty.slice(1), inline: true },
            { name: '🎯 Multiplier', value: `${multiplier.toFixed(2)}x`, inline: true },
            { name: '💰 Potential Win', value: formatCurrency(potentialWin), inline: true }
        );

    const rows = [];
    
    // Current level tiles
    if (gameState.currentLevel < 8) {
        const currentLevelRow = new ActionRowBuilder();
        for (let block = 0; block < gameState.blocksPerLevel; block++) {
            currentLevelRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`towers_tile_${gameState.currentLevel}_${block}`)
                    .setLabel('💎')
                    .setStyle(ButtonStyle.Secondary)
            );
        }
        rows.push(currentLevelRow);
    }

    // Cashout button if player has progressed
    if (gameState.currentLevel > 0) {
        const cashoutRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('towers_cashout')
                    .setLabel(`💰 Cash Out - ${formatCurrency(potentialWin)}`)
                    .setStyle(ButtonStyle.Success)
            );
        rows.push(cashoutRow);
    }

    await interaction.editReply({ embeds: [embed], components: rows });
}

async function selectTile(interaction, level, block) {
    const userId = interaction.user.id;
    const gameState = activeGames.get(userId);

    if (!gameState || !gameState.gameActive || level !== gameState.currentLevel) {
        await interaction.deferUpdate();
        return;
    }

    if (block === gameState.correctPath[level]) {
        gameState.currentLevel++;
        if (gameState.currentLevel >= 8) {
            await winGame(interaction, gameState);
        } else {
            await updateTowersBoard(interaction, gameState);
        }
    } else {
        await loseGame(interaction, gameState);
    }
}

async function winGame(interaction, gameState) {
    gameState.gameActive = false;
    const multiplier = Math.pow(1.5, 8);
    const winAmount = Math.floor(gameState.betAmount * multiplier);
    const profit = winAmount - gameState.betAmount;

    const currentBalance = await getUserBalance(gameState.userId);
    await updateUserBalance(gameState.userId, currentBalance + winAmount);

    const embed = new EmbedBuilder()
        .setTitle('🏆 Victory!')
        .setDescription('You completed the tower!')
        .setColor('#FFD700')
        .addFields(
            { name: '💰 Bet Amount', value: formatCurrency(gameState.betAmount), inline: true },
            { name: '🎯 Multiplier', value: `${multiplier.toFixed(2)}x`, inline: true },
            { name: '💰 Win Amount', value: formatCurrency(winAmount), inline: true },
            { name: '📈 Profit', value: formatCurrency(profit), inline: true }
        );

    await logGame(
        gameState.userId,
        'Towers',
        gameState.betAmount,
        'Win',
        multiplier,
        profit,
        gameState.seed.hash
    );

    const newGameRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('towers_newgame')
                .setLabel('🎮 New Game')
                .setStyle(ButtonStyle.Primary)
        );

    await interaction.editReply({ embeds: [embed], components: [newGameRow] });
}

async function loseGame(interaction, gameState) {
    gameState.gameActive = false;

    const embed = new EmbedBuilder()
        .setTitle('💥 Game Over!')
        .setDescription('You chose the wrong block!')
        .setColor('#FF0000')
        .addFields(
            { name: '💰 Lost', value: formatCurrency(gameState.betAmount), inline: true },
            { name: '📊 Level Reached', value: `${gameState.currentLevel}/8`, inline: true }
        );

    await logGame(
        gameState.userId,
        'Towers',
        gameState.betAmount,
        'Loss',
        0,
        -gameState.betAmount,
        gameState.seed.hash
    );

    const newGameRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('towers_newgame')
                .setLabel('🎮 New Game')
                .setStyle(ButtonStyle.Primary)
        );

    await interaction.editReply({ embeds: [embed], components: [newGameRow] });
}

async function cashOut(interaction) {
    const userId = interaction.user.id;
    const gameState = activeGames.get(userId);

    if (!gameState || !gameState.gameActive || gameState.currentLevel === 0) {
        await interaction.deferUpdate();
        return;
    }

    gameState.gameActive = false;
    const multiplier = Math.pow(1.5, gameState.currentLevel);
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
            { name: '📊 Level Reached', value: `${gameState.currentLevel}/8`, inline: true },
            { name: '🎯 Multiplier', value: `${multiplier.toFixed(2)}x`, inline: true },
            { name: '💰 Win Amount', value: formatCurrency(winAmount), inline: true },
            { name: '📈 Profit', value: formatCurrency(profit), inline: true }
        );

    await logGame(
        gameState.userId,
        'Towers',
        gameState.betAmount,
        'Win',
        multiplier,
        profit,
        gameState.seed.hash
    );

    const newGameRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('towers_newgame')
                .setLabel('🎮 New Game')
                .setStyle(ButtonStyle.Primary)
        );

    await interaction.editReply({ embeds: [embed], components: [newGameRow] });
}

module.exports = { handleButton, startGame };
