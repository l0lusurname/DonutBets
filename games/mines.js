const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { 
    getUserBalance, 
    updateUserBalance, 
    logGame, 
    formatCurrency, 
    parseCurrency 
} = require('../utils/database');
const { 
    generateSeed, 
    generateMinesPositions, 
    calculateMinesMultiplier 
} = require('../utils/provablyFair');

// Store active games
const activeGames = new Map();

// Handle button interactions
async function handleButton(interaction, params) {
    const [action, ...data] = params;
    
    try {
        switch (action) {
            case 'start':
                await startGame(interaction);
                break;
            case 'play':
                await playTile(interaction, parseInt(data[0]));
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
        }
    }
}

async function startGame(interaction) {
    const userId = interaction.user.id;
    const balance = await getUserBalance(userId);
    
    if (balance < 100) {
        await interaction.reply({ 
            content: 'You need at least 100 credits to play Mines!', 
            ephemeral: true 
        });
        return;
    }
    
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
            new ButtonBuilder().setCustomId('mines_bet_custom').setLabel('Custom').setStyle(ButtonStyle.Primary)
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
        await interaction.editReply({ embeds: [embed], components: [betRow, mineRow1, mineRow2] });
    } else {
        await interaction.reply({ embeds: [embed], components: [betRow, mineRow1, mineRow2] });
    }
}

async function setupGame(interaction, betAmount, mineCount) {
    const userId = interaction.user.id;
    const balance = await getUserBalance(userId);
    
    if (balance < betAmount) {
        await interaction.editReply({ content: 'Insufficient balance!', components: [] });
        return;
    }
    
    // Generate seed and mine positions
    const seed = generateSeed();
    const minePositions = generateMinesPositions(seed, mineCount);
    
    // Store game state
    const gameState = {
        userId,
        betAmount,
        mineCount,
        minePositions,
        revealedTiles: [],
        seed,
        multiplier: 1,
        gameActive: true
    };
    
    activeGames.set(userId, gameState);
    
    // Deduct bet from balance
    await updateUserBalance(userId, balance - betAmount);
    
    // Create game board
    const embed = new EmbedBuilder()
        .setTitle('💣 Mines Game - Active')
        .setDescription(`Bet: ${formatCurrency(betAmount)} | Mines: ${mineCount} | Multiplier: 1.00x`)
        .setColor('#00FF00')
        .addFields(
            { name: '💡 Tip', value: 'Click tiles to reveal them. Avoid the mines!', inline: false }
        );
    
    const components = createGameBoard(gameState);
    
    await interaction.editReply({ embeds: [embed], components });
}

function createGameBoard(gameState) {
    const components = [];
    
    for (let row = 0; row < 5; row++) {
        const actionRow = new ActionRowBuilder();
        for (let col = 0; col < 5; col++) {
            const position = row * 5 + col;
            const isRevealed = gameState.revealedTiles.includes(position);
            const isMine = gameState.minePositions.includes(position);
            
            let emoji = '⬜';
            let style = ButtonStyle.Secondary;
            let disabled = false;
            
            if (isRevealed) {
                if (isMine) {
                    emoji = '💣';
                    style = ButtonStyle.Danger;
                } else {
                    emoji = '💎';
                    style = ButtonStyle.Success;
                }
                disabled = true;
            }
            
            if (!gameState.gameActive) {
                if (isMine && !isRevealed) {
                    emoji = '💣';
                    style = ButtonStyle.Danger;
                }
                disabled = true;
            }
            
            actionRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`mines_play_${position}`)
                    .setLabel(emoji)
                    .setStyle(style)
                    .setDisabled(disabled)
            );
        }
        components.push(actionRow);
    }
    
    // Add control buttons
    if (gameState.gameActive && gameState.revealedTiles.length > 0) {
        const controlRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('mines_cashout')
                    .setLabel(`💰 Cash Out (${gameState.multiplier.toFixed(2)}x)`)
                    .setStyle(ButtonStyle.Success)
            );
        components.push(controlRow);
    }
    
    if (!gameState.gameActive) {
        const newGameRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('mines_newgame')
                    .setLabel('🎮 New Game')
                    .setStyle(ButtonStyle.Primary)
            );
        components.push(newGameRow);
    }
    
    return components;
}

async function playTile(interaction, position) {
    const userId = interaction.user.id;
    const gameState = activeGames.get(userId);
    
    if (!gameState || !gameState.gameActive) {
        await interaction.reply({ content: 'No active game found!', ephemeral: true });
        return;
    }
    
    if (gameState.revealedTiles.includes(position)) {
        await interaction.reply({ content: 'Tile already revealed!', ephemeral: true });
        return;
    }
    
    gameState.revealedTiles.push(position);
    
    if (gameState.minePositions.includes(position)) {
        // Hit mine - game over
        gameState.gameActive = false;
        
        const embed = new EmbedBuilder()
            .setTitle('💥 BOOM! Game Over')
            .setDescription(`You hit a mine! Lost ${formatCurrency(gameState.betAmount)}`)
            .setColor('#FF0000');
        
        await logGame(
            userId, 
            'Mines', 
            gameState.betAmount, 
            'Loss', 
            0, 
            -gameState.betAmount, 
            gameState.seed.hash
        );
        
        const components = createGameBoard(gameState);
        await interaction.update({ embeds: [embed], components });
        
    } else {
        // Safe tile
        const safeTiles = 25 - gameState.mineCount;
        const tilesRevealed = gameState.revealedTiles.length;
        gameState.multiplier = calculateMinesMultiplier(gameState.mineCount, tilesRevealed);
        
        let description = `Bet: ${formatCurrency(gameState.betAmount)} | Mines: ${gameState.mineCount} | Multiplier: ${gameState.multiplier.toFixed(2)}x`;
        
        if (tilesRevealed === safeTiles) {
            // Won all safe tiles
            gameState.gameActive = false;
            const winAmount = Math.floor(gameState.betAmount * gameState.multiplier);
            const profit = winAmount - gameState.betAmount;
            
            const currentBalance = await getUserBalance(userId);
            await updateUserBalance(userId, currentBalance + winAmount);
            
            description = `🎉 You won! +${formatCurrency(profit)}`;
            
            await logGame(
                userId, 
                'Mines', 
                gameState.betAmount, 
                'Win', 
                gameState.multiplier, 
                profit, 
                gameState.seed.hash
            );
        }
        
        const embed = new EmbedBuilder()
            .setTitle('💣 Mines Game - Active')
            .setDescription(description)
            .setColor(gameState.gameActive ? '#00FF00' : '#FFD700');
        
        const components = createGameBoard(gameState);
        await interaction.update({ embeds: [embed], components });
    }
}

async function cashOut(interaction) {
    const userId = interaction.user.id;
    const gameState = activeGames.get(userId);
    
    if (!gameState || !gameState.gameActive) {
        await interaction.reply({ content: 'No active game found!', ephemeral: true });
        return;
    }
    
    gameState.gameActive = false;
    const winAmount = Math.floor(gameState.betAmount * gameState.multiplier);
    const profit = winAmount - gameState.betAmount;
    
    const currentBalance = await getUserBalance(userId);
    await updateUserBalance(userId, currentBalance + winAmount);
    
    const embed = new EmbedBuilder()
        .setTitle('💰 Cashed Out!')
        .setDescription(`You won ${formatCurrency(profit)} with a ${gameState.multiplier.toFixed(2)}x multiplier!`)
        .setColor('#FFD700');
    
    await logGame(
        userId, 
        'Mines', 
        gameState.betAmount, 
        'Win', 
        gameState.multiplier, 
        profit, 
        gameState.seed.hash
    );
    
    const components = createGameBoard(gameState);
    await interaction.update({ embeds: [embed], components });
}

// Handle bet and mine count selection
async function handleSetup(interaction) {
    const [_, type, value] = interaction.customId.split('_');
    
    if (type === 'bet' && value === 'custom') {
        // Handle custom bet amount (could implement modal here)
        return;
    }
    
    const userId = interaction.user.id;
    let gameData = activeGames.get(userId) || {};
    
    if (type === 'bet') {
        gameData.betAmount = parseInt(value);
    } else if (type === 'mines') {
        gameData.mineCount = parseInt(value);
    }
    
    activeGames.set(userId, gameData);
    
    if (gameData.betAmount && gameData.mineCount) {
        await setupGame(interaction, gameData.betAmount, gameData.mineCount);
    }
}

module.exports = {
    handleButton,
    handleSetup
};