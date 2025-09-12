const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserBalance, updateUserBalance, logGame, formatCurrency, updateCasinoBankBalance } = require('../utils/database');
const { generateSeed, generateSlotResults } = require('../utils/provablyFair');

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
                await showBetSelection(interaction);
                break;
            case 'bet':
                if (data[0] === 'custom') {
                    await handleCustomBet(interaction);
                    return;
                }
                await playSlots(interaction, parseInt(data[0]));
                break;
            case 'newgame':
                await showBetSelection(interaction);
                break;
        }
    } catch (error) {
        console.error('Slots button error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred!', flags: 64 });
        } else if (interaction.deferred) {
            await interaction.editReply({ content: 'An error occurred!', components: [] });
        }
    }
}

async function showBetSelection(interaction) {
    const userId = interaction.user.id;
    const balance = await getUserBalance(userId);

    if (balance < 1000) {
        const reply = {
            content: 'You need at least 1K credits to play Slots!',
            flags: 64
        };
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(reply);
        } else {
            await interaction.reply(reply);
        }
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle('🎰 Slots Game')
        .setDescription('Select your bet amount to spin the reels!')
        .setColor('#FFD700')
        .addFields(
            { name: '💰 Your Balance', value: formatCurrency(balance), inline: true },
            { name: '🎯 Goal', value: 'Match symbols to win!', inline: true }
        );

    const betRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('slots_bet_100').setLabel('100').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('slots_bet_500').setLabel('500').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('slots_bet_1000').setLabel('1K').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('slots_bet_5000').setLabel('5K').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('slots_bet_10000').setLabel('10K').setStyle(ButtonStyle.Primary)
        );

    const customRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('slots_bet_custom').setLabel('💰 Custom Bet').setStyle(ButtonStyle.Success)
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
            new ButtonBuilder().setCustomId('slots_start').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
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
        const betInput = message.content.slice(4).trim();
        const betAmount = parseFormattedNumber(betInput);

        if (isNaN(betAmount) || betAmount < 1000) {
            try {
                const errorMsg = await message.reply('Invalid bet amount! Minimum bet is 1K credits.');
                setTimeout(() => errorMsg.delete().catch(() => {}), 3000);
                await message.delete().catch(() => {});
            } catch (error) {
                console.log('Message interaction error:', error.message);
            }
            return;
        }

        if (betAmount > balance) {
            try {
                const errorMsg = await message.reply(`Insufficient balance! You have ${formatCurrency(balance)}.`);
                setTimeout(() => errorMsg.delete().catch(() => {}), 3000);
                await message.delete().catch(() => {});
            } catch (error) {
                console.log('Message interaction error:', error.message);
            }
            return;
        }

        try {
            const replyMsg = await message.reply(`Custom bet set: ${formatCurrency(betAmount)}!`);
            setTimeout(() => replyMsg.delete().catch(() => {}), 3000);
            await message.delete().catch(() => {});
        } catch (error) {
            console.log('Message interaction error:', error.message);
        }

        await playSlots(interaction, betAmount);
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            showBetSelection(interaction);
        }
    });
}

async function playSlots(interaction, betAmount) {
    const userId = interaction.user.id;
    const balance = await getUserBalance(userId);
    
    if (balance < betAmount) {
        await interaction.editReply({ content: 'Insufficient balance!', components: [] });
        return;
    }

    // Bank balance validation removed - no more bet limits!
    
    const seed = generateSeed();
    const results = generateSlotResults(seed);
    
    // Simple payout logic
    let multiplier = 0;
    const grid = [
        [results[0], results[1], results[2]],
        [results[3], results[4], results[5]],
        [results[6], results[7], results[8]]
    ];
    
    // Check for wins (enhanced payout system)
    if (results[4] === '7️⃣') multiplier = 5; // Center 7 jackpot
    else if (results[0] === results[4] && results[4] === results[8]) multiplier = 3; // Diagonal
    else if (results[2] === results[4] && results[4] === results[6]) multiplier = 3; // Diagonal
    else if (results[0] === results[1] && results[1] === results[2]) multiplier = 2; // Top row
    else if (results[3] === results[4] && results[4] === results[5]) multiplier = 2; // Middle row
    else if (results[6] === results[7] && results[7] === results[8]) multiplier = 2; // Bottom row
    else if (results[0] === results[3] && results[3] === results[6]) multiplier = 1.5; // Left column
    else if (results[1] === results[4] && results[4] === results[7]) multiplier = 1.5; // Middle column
    else if (results[2] === results[5] && results[5] === results[8]) multiplier = 1.5; // Right column
    
    const winAmount = Math.floor(betAmount * multiplier);
    const profit = winAmount - betAmount;
    
    await updateUserBalance(userId, balance - betAmount + winAmount);
    
    // Update casino bank balance (opposite of user's profit/loss)
    await updateCasinoBankBalance(-profit);
    
    await logGame(userId, 'Slots', betAmount, multiplier > 0 ? 'Win' : 'Loss', multiplier, profit, seed.hash);
    
    let winDescription = '';
    if (multiplier > 0) {
        if (multiplier === 5) winDescription = '🎊 JACKPOT! Center 7!';
        else if (multiplier === 3) winDescription = '💎 DIAGONAL WIN!';
        else if (multiplier === 2) winDescription = '🔥 ROW WIN!';
        else if (multiplier === 1.5) winDescription = '✨ COLUMN WIN!';
    } else {
        winDescription = '💸 No matches - Try again!';
    }
    
    const embed = new EmbedBuilder()
        .setTitle('🎰 Slots Result')
        .setDescription(`${grid[0].join(' ')}\n${grid[1].join(' ')}\n${grid[2].join(' ')}\n\n${winDescription}`)
        .setColor(multiplier > 0 ? '#00FF00' : '#FF0000')
        .addFields(
            { name: '💰 Bet Amount', value: formatCurrency(betAmount), inline: true },
            { name: '🎯 Multiplier', value: `${multiplier.toFixed(1)}x`, inline: true },
            { name: multiplier > 0 ? '💰 Won' : '💸 Lost', value: formatCurrency(Math.abs(profit)), inline: true }
        );

    if (multiplier > 0) {
        embed.addFields(
            { name: '🔍 Server Seed', value: `\`${seed.serverSeed}\``, inline: false },
            { name: '🎲 Client Seed', value: `\`${seed.clientSeed}\``, inline: true },
            { name: '🔢 Nonce', value: `\`${seed.nonce}\``, inline: true },
            { name: '🔐 Hash', value: `\`${seed.hash}\``, inline: false }
        );
    }

    const newGameRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('slots_newgame')
                .setLabel('🎰 Spin Again')
                .setStyle(ButtonStyle.Primary)
        );
    
    await interaction.editReply({ embeds: [embed], components: [newGameRow] });
}

async function startGame(interaction) {
    await showBetSelection(interaction);
}

module.exports = { handleButton, startGame };