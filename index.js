const { Client, GatewayIntentBits, Collection, Events } = require('discord.js');
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
const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_ANON_KEY || ''
);

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
});

// Handle message commands like ?bankset
client.on(Events.MessageCreate, async message => {
    // Ignore bot messages and DMs
    if (message.author.bot || !message.guild) return;
    
    // Check for ?bankset command
    if (message.content.startsWith('?bankset ')) {
        // Check if user is the server owner
        if (message.author.id !== process.env.SERVER_OWNER_ID) {
            await message.reply('❌ Only the server owner can set the casino bank balance.');
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
        // Check if user is the server owner
        if (message.author.id !== process.env.SERVER_OWNER_ID) {
            await message.reply('❌ Only the server owner can reload commands.');
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

// Handle all interactions in one place to avoid conflicts
client.on(Events.InteractionCreate, async interaction => {
    try {
        // Handle chat input commands
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);

            if (!command) {
                console.error(`No command matching ${interaction.commandName} was found.`);
                return;
            }

            // Check if it's a gambling command
            const gamblingCommands = ['mines', 'towers', 'crash', 'slots', 'cashout'];
            if (gamblingCommands.includes(interaction.commandName)) {
                // Check if user is in their private gambling channel
                const expectedChannelName = `gambling-${interaction.user.username.toLowerCase()}`;
                
                if (interaction.channel.name !== expectedChannelName) {
                    await interaction.reply({ 
                        content: '🚫 Gambling commands can only be used in your private gambling room! Use `/setup` to create the gambling channels if they don\'t exist, then click the button in the start-gambling channel to create your room.', 
                        flags: 64 
                    });
                    return;
                }
            }

            // Ensure user exists in database before processing command
            await ensureUserExists(interaction.user.id);
            await command.execute(interaction);
        }
        
        // Handle button interactions
        else if (interaction.isButton()) {
            const [game, action, ...params] = interaction.customId.split('_');
            
            // Ensure user exists in database before processing
            await ensureUserExists(interaction.user.id);
            
            // Handle gambling room creation
            if (game === 'gambling' && action === 'create' && params[0] === 'room') {
                const { PermissionFlagsBits } = require('discord.js');
                
                // Check if user already has a gambling channel
                const existingChannel = interaction.guild.channels.cache.find(
                    channel => channel.name === `gambling-${interaction.user.username.toLowerCase()}` && channel.type === 0
                );
                
                if (existingChannel) {
                    await interaction.reply({ content: `You already have a gambling room: ${existingChannel}`, flags: 64 });
                    return;
                }
                
                // Find gambling category
                const category = interaction.guild.channels.cache.find(
                    channel => channel.name === '🎰 GAMBLING' && channel.type === 4
                );
                
                if (!category) {
                    await interaction.reply({ content: 'Gambling category not found. Please run `/setup` first.', flags: 64 });
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
                
                const { EmbedBuilder } = require('discord.js');
                const welcomeEmbed = new EmbedBuilder()
                    .setTitle('🎰 Your Private Gambling Room!')
                    .setDescription('Welcome to your personal gambling space! Use the commands below to start playing.')
                    .setColor('#FFD700')
                    .addFields(
                        { name: '🎮 Game Commands', value: '`/mines` - Play Mines\n`/towers` - Play Towers\n`/crash` - Play Crash\n`/slots` - Play Slots', inline: true },
                        { name: '💰 Account Commands', value: '`/balance` - Check balance\n`/deposit` - Add credits\n`/withdraw` - Request withdrawal', inline: true }
                    )
                    .setFooter({ text: 'Good luck and gamble responsibly!' })
                    .setTimestamp();
                
                await gamblingChannel.send({ embeds: [welcomeEmbed] });
                await interaction.reply({ content: `Your gambling room has been created: ${gamblingChannel}`, flags: 64 });
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
        if (!interaction.replied && !interaction.deferred) {
            try {
                await interaction.reply({ content: 'There was an error processing your request!', flags: 64 });
            } catch (replyError) {
                console.error('Failed to send error reply:', replyError);
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