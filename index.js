const { Client, GatewayIntentBits, Collection, Events, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL && process.env.SUPABASE_URL.startsWith('http')
    ? process.env.SUPABASE_URL
    : 'https://vfltbqpabgvbbxuezaah.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

// Commands collection
client.commands = new Collection();

// Import command files
const fs = require('fs');
const path = require('path');

// Load commands
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        try {
            const filePath = path.join(commandsPath, file);
            const command = require(filePath);
            if ('data' in command && 'execute' in command) {
                client.commands.set(command.data.name, command);
            }
        } catch (error) {
            console.error(`Error loading command ${file}:`, error);
        }
    }
} else {
    console.log('Commands directory does not exist');
}

// Import utilities
const { ensureUserExists, formatCurrency } = require('./utils/database');
const { generateSeed, verifySeed } = require('./utils/provablyFair');

// Store references for global access
client.supabase = supabase;
client.utils = { ensureUserExists, formatCurrency, generateSeed, verifySeed };

// Initialize Minecraft bot
const minecraftBot = require('./minecraft-bot');
client.minecraftBot = minecraftBot;

client.once(Events.ClientReady, async readyClient => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);

    // Register slash commands with Discord
    try {
        const commands = [];
        for (const [name, command] of client.commands) {
            commands.push(command.data.toJSON());
        }

        await client.application.commands.set(commands);
        console.log(`Successfully registered ${commands.length} slash commands.`);
    } catch (error) {
        console.error('Error registering commands:', error);
    }

    // Start Minecraft bot connection after Discord is ready
    console.log('🎮 Starting Minecraft bot connection...');
    minecraftBot.connect();
});

// Handle message commands like ?bankset
client.on(Events.MessageCreate, async message => {
    // Ignore bot messages and DMs
    if (message.author.bot || !message.guild) return;

    // Check for ?bankset command
    if (message.content.startsWith('?bankset ')) {
        // Check if user has administrator permissions or is bot owner
        const { PermissionFlagsBits } = require('discord.js');
        const isOwner = message.author.id === process.env.SERVER_OWNER_ID;
        const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);

        if (!isOwner && !isAdmin) {
            await message.reply('❌ Only administrators or the bot owner can set the casino bank balance.');
            return;
        }

        const amountStr = message.content.slice(9).trim(); // Remove "?bankset "

        if (!amountStr) {
            await message.reply('❌ Please specify an amount. Example: `?bankset 100m`');
            return;
        }

        const amount = parseFormattedNumber(amountStr);

        if (isNaN(amount) || amount < 0) {
            await message.reply('❌ Invalid amount. Please use a positive number with optional K/M/B suffix.');
            return;
        }

        try {
            console.log(`Setting casino bank balance to: ${amount}`);
            const { setCasinoBankBalance, formatCurrency } = require('./utils/database');
            await setCasinoBankBalance(amount);
            console.log(`Successfully set casino bank balance to: ${amount}`);
            await message.reply(`✅ Casino bank balance set to ${formatCurrency(amount)}.`);
        } catch (error) {
            console.error('Error setting casino bank:', error);
            await message.reply('❌ Failed to set casino bank balance. Please try again.');
        }
    }

    // Check for ?reload command
    else if (message.content.startsWith('?reload')) {
        // Check if user has administrator permissions or is bot owner
        const { PermissionFlagsBits } = require('discord.js');
        const isOwner = message.author.id === process.env.SERVER_OWNER_ID;
        const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);

        if (!isOwner && !isAdmin) {
            await message.reply('❌ Only administrators or the bot owner can reload commands.');
            return;
        }

        try {
            const loadingMsg = await message.reply('🔄 Reloading slash commands...');

            // Clear existing commands from Discord
            await client.application.commands.set([]);

            // Reload commands from files
            client.commands.clear();
            const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

            const commands = [];
            for (const file of commandFiles) {
                const filePath = path.join(commandsPath, file);

                // Clear require cache to reload the file
                delete require.cache[require.resolve(filePath)];

                const command = require(filePath);
                if ('data' in command && 'execute' in command) {
                    client.commands.set(command.data.name, command);
                    commands.push(command.data.toJSON());
                }
            }

            // Register commands with Discord
            await client.application.commands.set(commands);

            await loadingMsg.edit(`✅ Successfully reloaded ${commands.length} slash commands!\n\nCommands registered: ${commands.map(cmd => `\`/${cmd.name}\``).join(', ')}`);
        } catch (error) {
            console.error('Error reloading commands:', error);
            await message.reply('❌ Failed to reload commands. Check console for details.');
        }
    }
});

// Parse formatted numbers with K/M/B suffixes
function parseFormattedNumber(input) {
    if (typeof input === 'number') return input;

    const str = input.toString().toLowerCase().replace(/,/g, '');
    const num = parseFloat(str);

    if (str.includes('k')) return Math.floor(num * 1000);
    if (str.includes('m')) return Math.floor(num * 1000000);
    if (str.includes('b')) return Math.floor(num * 1000000000);

    return Math.floor(num);
}

// Safe reply utility that handles interaction states
async function safeReply(interaction, options) {
    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({ ...options, ephemeral: true });
        } else if (interaction.deferred && !interaction.replied) {
            // Remove ephemeral from editReply options since it can't be changed after defer
            const { ephemeral, ...editOptions } = options;
            await interaction.editReply(editOptions);
        } else {
            await interaction.followUp({ ...options, ephemeral: true });
        }
    } catch (error) {
        console.error('Error in safeReply:', error);
    }
}

// Gambling room guard - returns true if in correct channel, false if restricted
function ensureInGamblingRoom(interaction, gameName) {
    // Check if it's a guild interaction with proper channel
    if (!interaction.guild || !interaction.channel || !interaction.channel.name) {
        const embed = new EmbedBuilder()
            .setTitle('🚫 Invalid Channel!')
            .setDescription('Gambling commands can only be used in your private gambling room!')
            .setColor('#FF0000');
        safeReply(interaction, { embeds: [embed] });
        return false;
    }

    const channelName = interaction.channel.name;
    const username = interaction.user.username.toLowerCase();
    const expectedChannelName = `gambling-${username}`;

    if (channelName !== expectedChannelName) {
        const embed = new EmbedBuilder()
            .setTitle('🚫 Wrong Channel!')
            .setDescription('You can only gamble in your private gambling room!')
            .setColor('#FF0000')
            .addFields(
                { name: '🎰 How to get your gambling room:', value: '1. Go to **✅ start-gambling** channel\n2. Click **🎰 Create Gambling Room**\n3. Use gambling commands in your private room', inline: false }
            );
        safeReply(interaction, { embeds: [embed] });
        return false;
    }

    return true;
}

// Debug: Log all events received by bot
client.on('raw', (packet) => {
    if (packet.t === 'INTERACTION_CREATE') {
        console.log('Raw interaction received:', packet.d.type, packet.d.data?.name || 'no name');
    }
});

// Handle all interactions in one place to avoid conflicts
client.on(Events.InteractionCreate, async interaction => {
    console.log('=== INTERACTION RECEIVED ===');
    console.log('Type:', interaction.type);
    console.log('User:', interaction.user.username);
    console.log('Command:', interaction.isCommand() ? interaction.commandName : 'Not a command');
    try {
        // Handle chat input commands
        if (interaction.isChatInputCommand()) {
            console.log(`Command used: ${interaction.commandName} by ${interaction.user.username} (${interaction.user.id})`);

            const command = interaction.client.commands.get(interaction.commandName);

            if (!command) {
                console.error(`No command matching ${interaction.commandName} was found.`);
                return;
            }

            // Check if gambling commands are used in proper gambling channel
            const gamblingCommands = ['mines', 'towers', 'crash', 'slots'];
            if (gamblingCommands.includes(interaction.commandName)) {
                if (!ensureInGamblingRoom(interaction, interaction.commandName)) {
                    return; // Early return if not in gambling room
                }
            }

            // Ensure user exists in database before processing command
            console.log(`Ensuring user exists: ${interaction.user.id}`);
            await ensureUserExists(interaction.user.id, interaction.user.username);
            console.log(`Executing command: ${interaction.commandName}`);
            await command.execute(interaction);
            console.log(`Command ${interaction.commandName} completed successfully`);
        }

        // Handle button interactions
        else if (interaction.isButton()) {
            console.log('Button clicked:', interaction.customId);
            const [game, action, ...params] = interaction.customId.split('_');
            console.log('Parsed button:', { game, action, params });

            // Ensure user exists in database before processing
            await ensureUserExists(interaction.user.id, interaction.user.username);

            // Check if gambling button interactions are used in proper gambling channel
            const gamblingGames = ['mines', 'towers', 'crash', 'slots'];
            if (gamblingGames.includes(game)) {
                if (!ensureInGamblingRoom(interaction, game)) {
                    return; // Early return if not in gambling room
                }
            }

            // Handle gambling room creation
            if (game === 'gambling' && action === 'create' && params[0] === 'room') {
                const { PermissionFlagsBits } = require('discord.js');

                // Check if user already has a gambling channel
                const existingChannel = interaction.guild.channels.cache.find(
                    channel => channel.name === `gambling-${interaction.user.username.toLowerCase()}` && channel.type === 0
                );

                if (existingChannel) {
                    await interaction.reply({ content: `You already have a gambling room: ${existingChannel}`, ephemeral: true });
                    return;
                }

                // Find gambling category
                const category = interaction.guild.channels.cache.find(
                    channel => channel.name === '🎰 GAMBLING' && channel.type === 4
                );

                if (!category) {
                    await interaction.reply({ content: 'Gambling category not found. Please run `/setup` first.', ephemeral: true });
                    return;
                }

                // Create private gambling channel for user
                const gamblingChannel = await interaction.guild.channels.create({
                    name: `gambling-${interaction.user.username.toLowerCase()}`,
                    type: 0, // Text channel
                    parent: category.id,
                    permissionOverwrites: [
                        {
                            id: interaction.guild.roles.everyone.id,
                            deny: [PermissionFlagsBits.ViewChannel],
                        },
                        {
                            id: interaction.user.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory,
                                PermissionFlagsBits.UseApplicationCommands
                            ],
                        },
                    ],
                });

                // Create welcome message for new gambling room
                const welcomeEmbed = new EmbedBuilder()
                    .setTitle(`🎰 Welcome to ${interaction.user.username}'s Gambling Room!`)
                    .setDescription('This is your **private gambling space**! Here\'s everything you need to know to get started.')
                    .addFields(
                        {
                            name: '🎮 **Game Commands**',
                            value: '**`/mines`** - Reveal tiles on a minefield (avoid bombs for bigger wins!)\n**`/towers`** - Climb difficulty levels for increasing multipliers\n**`/crash`** - Watch the multiplier rise and cash out before it crashes\n**`/slots`** - Spin the classic 3x3 slot machine for combinations',
                            inline: false
                        },
                        {
                            name: '💰 **Money Management**',
                            value: '**`/balance`** - Check your current credit balance\n**`/deposit`** - Get instructions to add credits via Minecraft\n**`/withdraw`** - Request to withdraw credits to your Minecraft account\n**`/link`** - Link your Minecraft account (required for deposits/withdrawals)',
                            inline: false
                        },
                        {
                            name: '📊 **Additional Features**',
                            value: '**`/history`** - View your last 10 game results\n**`/seedcheck`** - Verify any game was provably fair using seeds',
                            inline: false
                        },
                        {
                            name: '🚀 **Getting Started**',
                            value: '1️⃣ Use `/link <minecraft_username>` to connect accounts\n2️⃣ Use `/deposit` to add credits via Minecraft payments\n3️⃣ Start gambling with any game command!\n4️⃣ Use `/withdraw` when you want to cash out',
                            inline: false
                        }
                    )
                    .setColor('#FFD700')
                    .setFooter({ text: '🎲 All games use cryptographic seeds for fairness • Have fun and gamble responsibly!' })
                    .setTimestamp();

                await gamblingChannel.send({ embeds: [welcomeEmbed] });
                await interaction.reply({ content: `Your gambling room has been created: ${gamblingChannel}`, ephemeral: true });
                return;
            }

            switch (game) {
                case 'mines':
                    const minesHandler = require('./games/mines');
                    await minesHandler.handleButton(interaction, [action, ...params]);
                    break;
                case 'towers':
                    const towersHandler = require('./games/towers');
                    await towersHandler.handleButton(interaction, [action, ...params]);
                    break;
                case 'slots':
                    const slotsHandler = require('./games/slots');
                    await slotsHandler.handleButton(interaction, [action, ...params]);
                    break;
                case 'crash':
                    const crashHandler = require('./games/crash');
                    await crashHandler.handleButton(interaction, [action, ...params]);
                    break;
                case 'withdraw':
                    const withdrawHandler = require('./utils/withdraw');
                    await withdrawHandler.handleButton(interaction, [action, ...params]);
                    break;
            }
        }

        // Handle modal submissions
        else if (interaction.isModalSubmit()) {
            const [action, type] = interaction.customId.split('_');

            if (action === 'withdraw' && type === 'modal') {
                const withdrawHandler = require('./utils/withdraw');
                await withdrawHandler.handleModal(interaction);
            }
        }
    } catch (error) {
        console.error('Interaction error:', error);
        // Only try to reply if the interaction hasn't been handled at all
        if (!interaction.replied && !interaction.deferred) {
            try {
                await interaction.reply({ content: 'There was an error processing your request!', ephemeral: true });
            } catch (replyError) {
                console.error('Failed to send error reply:', replyError);
            }
        }
        // If interaction was deferred but not replied to, use editReply instead
        else if (interaction.deferred && !interaction.replied) {
            try {
                await interaction.editReply({ content: 'There was an error processing your request!' });
            } catch (editError) {
                console.error('Failed to edit deferred reply:', editError);
            }
        }
    }
});

// Login to Discord
const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error('DISCORD_TOKEN is not set in environment variables');
    process.exit(1);
}

client.login(token);