const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserBalance, updateUserBalance, logGame, formatCurrency, updateCasinoBankBalance } = require('../utils/database');
const { generateSeed, generateBlackjackCards } = require('../utils/provablyFair');

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

function getCardValue(card) {
    const rank = card.slice(0, -1); // Remove suit symbol
    if (rank === 'A') {
        return 11; // Will be adjusted for soft aces later
    } else if (['K', 'Q', 'J'].includes(rank)) {
        return 10;
    } else {
        return parseInt(rank);
    }
}

function calculateHandValue(cards) {
    let total = 0;
    let aces = 0;
    
    for (const card of cards) {
        const value = getCardValue(card);
        if (value === 11) aces++;
        total += value;
    }
    
    // Adjust for soft aces
    while (total > 21 && aces > 0) {
        total -= 10; // Convert ace from 11 to 1
        aces--;
    }
    
    return total;
}

function formatCards(cards) {
    return cards.join(' ');
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
            case 'hit':
                await hitCard(interaction);
                break;
            case 'stand':
                await stand(interaction);
                break;
            case 'double':
                await doubleDown(interaction);
                break;
            case 'newgame':
                await startGame(interaction);
                break;
            case 'close':
                await closeGame(interaction);
                break;
        }
    } catch (error) {
        console.error('Blackjack button error:', error);
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
            content: 'You need at least 1K credits to play Blackjack!',
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
        .setTitle('♠️ Blackjack')
        .setDescription('Select your bet amount to start playing!')
        .setColor('#000000')
        .addFields(
            { name: '💰 Your Balance', value: formatCurrency(balance), inline: true },
            { name: '🎯 Goal', value: 'Get 21 or closer than the dealer!', inline: true }
        );

    const betRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('blackjack_bet_100').setLabel('100').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('blackjack_bet_500').setLabel('500').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('blackjack_bet_1000').setLabel('1K').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('blackjack_bet_5000').setLabel('5K').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('blackjack_bet_10000').setLabel('10K').setStyle(ButtonStyle.Primary)
        );

    const customRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('blackjack_bet_custom').setLabel('💰 Custom Bet').setStyle(ButtonStyle.Success)
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
            new ButtonBuilder().setCustomId('blackjack_start').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
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

    // Generate cards
    const seed = generateSeed();
    const cards = generateBlackjackCards(seed);

    const playerCards = [cards[0], cards[2]]; // Player gets 1st and 3rd cards
    const dealerCards = [cards[1], cards[3]]; // Dealer gets 2nd and 4th cards

    const gameState = {
        userId,
        betAmount,
        playerCards,
        dealerCards,
        cardIndex: 4, // Next card to deal
        seed,
        gameActive: true,
        canDoubleDown: true
    };

    activeGames.set(userId, gameState);
    await updateUserBalance(userId, balance - betAmount);

    await updateGameDisplay(interaction, gameState);
}

async function updateGameDisplay(interaction, gameState, gameOver = false) {
    const playerValue = calculateHandValue(gameState.playerCards);
    const dealerValue = calculateHandValue(gameState.dealerCards);
    
    // Show dealer's hole card only if game is over
    const dealerDisplay = gameOver 
        ? formatCards(gameState.dealerCards) 
        : gameState.dealerCards[0] + ' ??';
    
    const dealerValueDisplay = gameOver 
        ? `(${dealerValue})` 
        : `(${getCardValue(gameState.dealerCards[0])}+ ??)`;

    const embed = new EmbedBuilder()
        .setTitle('♠️ Blackjack Game')
        .setColor(gameOver ? '#FF4500' : '#000000')
        .addFields(
            { name: '🃏 Your Cards', value: `${formatCards(gameState.playerCards)}\n**Total: ${playerValue}**`, inline: true },
            { name: '🏠 Dealer Cards', value: `${dealerDisplay}\n**Total: ${dealerValueDisplay}**`, inline: true },
            { name: '💰 Bet', value: formatCurrency(gameState.betAmount), inline: true }
        );

    if (!gameOver && gameState.gameActive) {
        // Check for blackjack
        if (playerValue === 21 && gameState.playerCards.length === 2) {
            await handleBlackjack(interaction, gameState);
            return;
        }
        
        // Check for bust
        if (playerValue > 21) {
            await handlePlayerBust(interaction, gameState);
            return;
        }

        // Show game controls
        const gameRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('blackjack_hit').setLabel('🎯 Hit').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('blackjack_stand').setLabel('✋ Stand').setStyle(ButtonStyle.Secondary)
            );

        // Add double down if eligible
        if (gameState.canDoubleDown) {
            gameRow.addComponents(
                new ButtonBuilder().setCustomId('blackjack_double').setLabel('⚡ Double Down').setStyle(ButtonStyle.Success)
            );
        }

        await interaction.editReply({ embeds: [embed], components: [gameRow] });
    } else {
        await interaction.editReply({ embeds: [embed], components: [] });
    }
}

async function hitCard(interaction) {
    const userId = interaction.user.id;
    const gameState = activeGames.get(userId);

    if (!gameState || !gameState.gameActive) {
        return;
    }

    // Deal another card to player
    const cards = generateBlackjackCards(gameState.seed);
    gameState.playerCards.push(cards[gameState.cardIndex]);
    gameState.cardIndex++;
    gameState.canDoubleDown = false; // Can't double down after hitting

    await updateGameDisplay(interaction, gameState);
}

async function stand(interaction) {
    const userId = interaction.user.id;
    const gameState = activeGames.get(userId);

    if (!gameState || !gameState.gameActive) {
        return;
    }

    // Dealer plays
    await dealerPlay(interaction, gameState);
}

async function doubleDown(interaction) {
    const userId = interaction.user.id;
    const gameState = activeGames.get(userId);

    if (!gameState || !gameState.gameActive || !gameState.canDoubleDown) {
        return;
    }

    // Double the bet
    const currentBalance = await getUserBalance(userId);
    if (currentBalance < gameState.betAmount) {
        await interaction.editReply({ content: 'Insufficient balance to double down!', components: [] });
        return;
    }

    await updateUserBalance(userId, currentBalance - gameState.betAmount);
    gameState.betAmount *= 2;
    
    // Deal one more card to player
    const cards = generateBlackjackCards(gameState.seed);
    gameState.playerCards.push(cards[gameState.cardIndex]);
    gameState.cardIndex++;
    
    // Check for bust first
    const playerValue = calculateHandValue(gameState.playerCards);
    if (playerValue > 21) {
        await handlePlayerBust(interaction, gameState);
        return;
    }

    // Automatically stand after double down
    await dealerPlay(interaction, gameState);
}

async function dealerPlay(interaction, gameState) {
    const cards = generateBlackjackCards(gameState.seed);
    
    // Dealer must hit on 16 or less, stand on 17 or more
    let dealerValue = calculateHandValue(gameState.dealerCards);
    
    while (dealerValue < 17) {
        gameState.dealerCards.push(cards[gameState.cardIndex]);
        gameState.cardIndex++;
        dealerValue = calculateHandValue(gameState.dealerCards);
    }

    await resolveGame(interaction, gameState);
}

async function handleBlackjack(interaction, gameState) {
    gameState.gameActive = false;
    
    const dealerValue = calculateHandValue(gameState.dealerCards);
    const winAmount = dealerValue === 21 ? gameState.betAmount : Math.floor(gameState.betAmount * 2.5); // Blackjack pays 3:2
    const profit = winAmount - gameState.betAmount;
    
    const currentBalance = await getUserBalance(gameState.userId);
    await updateUserBalance(gameState.userId, currentBalance + winAmount);
    await updateCasinoBankBalance(-profit);

    const embed = new EmbedBuilder()
        .setTitle('♠️ BLACKJACK! 🎉')
        .setDescription(dealerValue === 21 ? 'Push! Both have Blackjack!' : 'You got a natural blackjack!')
        .setColor('#FFD700')
        .addFields(
            { name: '🃏 Your Cards', value: `${formatCards(gameState.playerCards)}\n**Total: 21**`, inline: true },
            { name: '🏠 Dealer Cards', value: `${formatCards(gameState.dealerCards)}\n**Total: ${dealerValue}**`, inline: true },
            { name: '💰 Result', value: dealerValue === 21 ? 'Push (Tie)' : `Won ${formatCurrency(winAmount)}!`, inline: true }
        );

    await logGame(
        gameState.userId,
        'Blackjack',
        gameState.betAmount,
        dealerValue === 21 ? 'Push' : 'Win',
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
                        .setCustomId('blackjack_newgame')
                        .setLabel('🎮 New Game')
                        .setStyle(ButtonStyle.Primary)
                );
            await interaction.followUp({ content: 'Ready for another hand?', components: [newGameRow] });
        } catch (error) {
            console.error('Error sending new game follow-up:', error);
        }
    }, 1000);
}

async function handlePlayerBust(interaction, gameState) {
    gameState.gameActive = false;
    
    await updateCasinoBankBalance(gameState.betAmount);

    const embed = new EmbedBuilder()
        .setTitle('♠️ BUST! 💥')
        .setDescription('You went over 21!')
        .setColor('#FF0000')
        .addFields(
            { name: '🃏 Your Cards', value: `${formatCards(gameState.playerCards)}\n**Total: ${calculateHandValue(gameState.playerCards)}**`, inline: true },
            { name: '🏠 Dealer Cards', value: `${formatCards(gameState.dealerCards)}\n**Total: ${calculateHandValue(gameState.dealerCards)}**`, inline: true },
            { name: '💰 Result', value: `Lost ${formatCurrency(gameState.betAmount)}`, inline: true }
        );

    await logGame(
        gameState.userId,
        'Blackjack',
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
                        .setCustomId('blackjack_newgame')
                        .setLabel('🎮 New Game')
                        .setStyle(ButtonStyle.Primary)
                );
            await interaction.followUp({ content: 'Better luck next time!', components: [newGameRow] });
        } catch (error) {
            console.error('Error sending new game follow-up:', error);
        }
    }, 1000);
}

async function resolveGame(interaction, gameState) {
    gameState.gameActive = false;
    
    const playerValue = calculateHandValue(gameState.playerCards);
    const dealerValue = calculateHandValue(gameState.dealerCards);
    
    let result, winAmount, profit;
    
    if (dealerValue > 21) {
        // Dealer bust - player wins
        result = 'Win';
        winAmount = gameState.betAmount * 2;
        profit = gameState.betAmount;
    } else if (playerValue > dealerValue) {
        // Player wins
        result = 'Win';
        winAmount = gameState.betAmount * 2;
        profit = gameState.betAmount;
    } else if (playerValue === dealerValue) {
        // Push (tie)
        result = 'Push';
        winAmount = gameState.betAmount;
        profit = 0;
    } else {
        // Dealer wins
        result = 'Loss';
        winAmount = 0;
        profit = -gameState.betAmount;
    }
    
    const currentBalance = await getUserBalance(gameState.userId);
    await updateUserBalance(gameState.userId, currentBalance + winAmount);
    await updateCasinoBankBalance(-profit);

    const embed = new EmbedBuilder()
        .setTitle(`♠️ ${result}! ${result === 'Win' ? '🎉' : result === 'Push' ? '🤝' : '💸'}`)
        .setDescription(dealerValue > 21 ? 'Dealer busted!' : `You ${result.toLowerCase()}!`)
        .setColor(result === 'Win' ? '#00FF00' : result === 'Push' ? '#FFD700' : '#FF0000')
        .addFields(
            { name: '🃏 Your Cards', value: `${formatCards(gameState.playerCards)}\n**Total: ${playerValue}**`, inline: true },
            { name: '🏠 Dealer Cards', value: `${formatCards(gameState.dealerCards)}\n**Total: ${dealerValue}**`, inline: true },
            { name: '💰 Result', value: result === 'Win' ? `Won ${formatCurrency(winAmount)}!` : result === 'Push' ? 'Push (Tie)' : `Lost ${formatCurrency(gameState.betAmount)}`, inline: true }
        );

    await logGame(
        gameState.userId,
        'Blackjack',
        gameState.betAmount,
        result,
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
                        .setCustomId('blackjack_newgame')
                        .setLabel('🎮 New Game')
                        .setStyle(ButtonStyle.Primary)
                );
            await interaction.followUp({ content: 'Ready for another hand?', components: [newGameRow] });
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