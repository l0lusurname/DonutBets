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
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        }
    }
}

// Import utilities
const { ensureUserExists, formatCurrency } = require('./utils/database');
const { generateSeed, verifySeed } = require('./utils/provablyFair');

// Store references for global access
client.supabase = supabase;
client.utils = { ensureUserExists, formatCurrency, generateSeed, verifySeed };

client.once(Events.ClientReady, readyClient => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    try {
        // Ensure user exists in database before processing command
        await ensureUserExists(interaction.user.id);
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        } else {
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
});

// Handle button interactions
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;
    
    const [game, action, ...params] = interaction.customId.split('_');
    
    try {
        // Ensure user exists in database before processing
        await ensureUserExists(interaction.user.id);
        
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
    } catch (error) {
        console.error('Button interaction error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'There was an error processing your request!', ephemeral: true });
        }
    }
});

// Handle modal submissions
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isModalSubmit()) return;
    
    try {
        if (interaction.customId === 'withdraw_modal') {
            const withdrawHandler = require('./utils/withdraw');
            await withdrawHandler.handleModal(interaction);
        }
    } catch (error) {
        console.error('Modal interaction error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'There was an error processing your request!', ephemeral: true });
        }
    }
});

// Handle modal submissions
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isModalSubmit()) return;
    
    const [action, type] = interaction.customId.split('_');
    
    try {
        if (action === 'withdraw' && type === 'modal') {
            const withdrawHandler = require('./utils/withdraw');
            await withdrawHandler.handleModal(interaction);
        }
    } catch (error) {
        console.error('Modal submission error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'There was an error processing your request!', ephemeral: true });
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