
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserBalance, updateUserBalance, logGame, formatCurrency } = require('../utils/database');
const { generateSeed, generateTowerMines, calculateTowerMultiplier } = require('../utils/provablyFair');

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
                await handleBetSelection(interaction, parseInt(data[0]));
                break;
            case 'difficulty':
                await handleDifficultySelection(interaction, data[0]);
                break;
            case 'climb':
                await climbTower(interaction, parseInt(data[0]), parseInt(data[1])); // level, slot
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
            await interaction.reply({ content: 'An error occurred!', ephemeral: true });
        }
    }
}

async function startGame(interaction) {
    const userId = interaction.user.id;
    const balance = await getUserBalance(userId);
    
    if (balance < 100) {
        await interaction.reply({ 
            content: 'You need at least 100 credits to play Towers!', 
            ephemeral: true 
        });
        return;
    }
    
    // Clear any existing game state
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
    
    const difficultyRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('towers_difficulty_easy').setLabel('Easy (4 slots, 1 mine)').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('towers_difficulty_medium').setLabel('Medium (3 slots, 1 mine)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('towers_difficulty_hard').setLabel('Hard (3 slots, 2 mines)').setStyle(ButtonStyle.Danger)
        );
    
    if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [embed], components: [betRow, difficultyRow] });
    } else {
        await interaction.reply({ embeds: [embed], components: [betRow, difficultyRow] });
    }
}

async function handleBetSelection(interaction, betAmount) {
    const userId = interaction.user.id;
    let gameState = activeGames.get(userId) || {};
    gameState.betAmount = betAmount;
    activeGames.set(userId, gameState);
    
    if (gameState.difficulty) {
        await setupGame(interaction, gameState.betAmount, gameState.difficulty);
    }
}

async function handleDifficultySelection(interaction, difficulty) {
    const userId = interaction.user.id;
    let gameState = activeGames.get(userId) || {};
    gameState.difficulty = difficulty;
    activeGames.set(userId, gameState);
    
    if (gameState.betAmount) {
        await setupGame(interaction, gameState.betAmount, gameState.difficulty);
    }
}

async function setupGame(interaction, betAmount, difficulty) {
    const userId = interaction.user.id;
    const balance = await getUserBalance(userId);
    
    if (balance < betAmount) {
        await interaction.editReply({ content: 'Insufficient balance!', components: [] });
        return;
    }
    
    // Generate seed and mine positions for each level
    const seed = generateSeed();
    const minePositions = generateTowerMines(seed, difficulty);
    
    const gameState = {
        userId,
        betAmount,
        difficulty,
        minePositions,
        currentLevel: 0,
        seed,
        gameActive: true,
        multiplier: 1
    };
    
    activeGames.set(userId, gameState);
    
    // Deduct bet from balance
    await updateUserBalance(userId, balance - betAmount);
    
    // Show first level
    await showCurrentLevel(interaction, gameState);
}

async function showCurrentLevel(interaction, gameState) {
    const difficultyInfo = {
        easy: { slots: 4, mines: 1, color: '#00FF00' },
        medium: { slots: 3, mines: 1, color: '#FFA500' },
        hard: { slots: 3, mines: 2, color: '#FF0000' }
    };
    
    const info = difficultyInfo[gameState.difficulty];
    const currentMultiplier = calculateTowerMultiplier(gameState.difficulty, gameState.currentLevel);
    
    const embed = new EmbedBuilder()
        .setTitle(`🗼 Towers - Level ${gameState.currentLevel + 1}/8`)
        .setDescription(`Difficulty: ${gameState.difficulty.toUpperCase()} | Multiplier: ${currentMultiplier}x`)
        .setColor(info.color)
        .addFields(
            { name: '💰 Bet', value: formatCurrency(gameState.betAmount), inline: true },
            { name: '🎯 Current Level', value: `${gameState.currentLevel + 1}/8`, inline: true },
            { name: '📈 Potential Win', value: formatCurrency(Math.floor(gameState.betAmount * currentMultiplier)), inline: true }
        );
    
    const components = [];
    
    if (gameState.gameActive && gameState.currentLevel < 8) {
        // Create buttons for current level
        const levelRow = new ActionRowBuilder();
        for (let slot = 0; slot < info.slots; slot++) {
            levelRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`towers_climb_${gameState.currentLevel}_${slot}`)
                    .setLabel(`Slot ${slot + 1}`)
                    .setStyle(ButtonStyle.Secondary)
            );
        }
        components.push(levelRow);
        
        // Add cash out button if not on first level
        if (gameState.currentLevel > 0) {
            const controlRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('towers_cashout')
                        .setLabel(`💰 Cash Out (${currentMultiplier}x)`)
                        .setStyle(ButtonStyle.Success)
                );
            components.push(controlRow);
        }
    }
    
    if (!gameState.gameActive) {
        const newGameRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('towers_newgame')
                    .setLabel('🎮 New Game')
                    .setStyle(ButtonStyle.Primary)
            );
        components.push(newGameRow);
    }
    
    if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [embed], components });
    } else {
        await interaction.reply({ embeds: [embed], components });
    }
}

async function climbTower(interaction, level, slot) {
    const userId = interaction.user.id;
    const gameState = activeGames.get(userId);
    
    if (!gameState || !gameState.gameActive || gameState.currentLevel !== level) {
        await interaction.reply({ content: 'Invalid game state!', ephemeral: true });
        return;
    }
    
    const levelMines = gameState.minePositions[level];
    
    if (levelMines.includes(slot)) {
        // Hit mine - game over
        gameState.gameActive = false;
        
        const embed = new EmbedBuilder()
            .setTitle('💥 You Fell!')
            .setDescription(`You hit a mine on level ${level + 1}! Lost ${formatCurrency(gameState.betAmount)}`)
            .setColor('#FF0000')
            .addFields(
                { name: '💸 Result', value: `Lost ${formatCurrency(gameState.betAmount)}`, inline: true },
                { name: '📊 Level Reached', value: `${level + 1}/8`, inline: true }
            );
        
        await logGame(
            userId, 
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
        
        await interaction.update({ embeds: [embed], components: [newGameRow] });
        
    } else {
        // Safe slot - advance to next level
        gameState.currentLevel++;
        
        if (gameState.currentLevel >= 8) {
            // Completed all levels!
            gameState.gameActive = false;
            const finalMultiplier = calculateTowerMultiplier(gameState.difficulty, 7);
            const winAmount = Math.floor(gameState.betAmount * finalMultiplier);
            const profit = winAmount - gameState.betAmount;
            
            const currentBalance = await getUserBalance(userId);
            await updateUserBalance(userId, currentBalance + winAmount);
            
            const embed = new EmbedBuilder()
                .setTitle('🎉 Tower Completed!')
                .setDescription(`You climbed all 8 levels! Amazing! +${formatCurrency(profit)}`)
                .setColor('#FFD700')
                .addFields(
                    { name: '🏆 Final Multiplier', value: `${finalMultiplier}x`, inline: true },
                    { name: '💰 Total Win', value: formatCurrency(profit), inline: true }
                );
            
            await logGame(
                userId, 
                'Towers', 
                gameState.betAmount, 
                'Win', 
                finalMultiplier, 
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
            
            await interaction.update({ embeds: [embed], components: [newGameRow] });
            
        } else {
            // Continue to next level
            await showCurrentLevel(interaction, gameState);
        }
    }
}

async function cashOut(interaction) {
    const userId = interaction.user.id;
    const gameState = activeGames.get(userId);
    
    if (!gameState || !gameState.gameActive || gameState.currentLevel === 0) {
        await interaction.reply({ content: 'Cannot cash out at this time!', ephemeral: true });
        return;
    }
    
    gameState.gameActive = false;
    const multiplier = calculateTowerMultiplier(gameState.difficulty, gameState.currentLevel - 1);
    const winAmount = Math.floor(gameState.betAmount * multiplier);
    const profit = winAmount - gameState.betAmount;
    
    const currentBalance = await getUserBalance(userId);
    await updateUserBalance(userId, currentBalance + winAmount);
    
    const embed = new EmbedBuilder()
        .setTitle('💰 Cashed Out!')
        .setDescription(`You climbed to level ${gameState.currentLevel} and cashed out! +${formatCurrency(profit)}`)
        .setColor('#FFD700')
        .addFields(
            { name: '📊 Level Reached', value: `${gameState.currentLevel}/8`, inline: true },
            { name: '📈 Multiplier', value: `${multiplier}x`, inline: true },
            { name: '💰 Profit', value: formatCurrency(profit), inline: true }
        );
    
    await logGame(
        userId, 
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
    
    await interaction.update({ embeds: [embed], components: [newGameRow] });
}

module.exports = {
    handleButton
};
