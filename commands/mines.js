
const { SlashCommandBuilder } = require('discord.js');
const minesGame = require('../games/mines');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mines')
        .setDescription('Play the Mines minigame')
        .addSubcommand(subcommand =>
            subcommand
                .setName('play')
                .setDescription('Start a new mines game')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('cashout')
                .setDescription('Cash out your current mines game')
        ),
    
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        
        if (subcommand === 'cashout') {
            await minesGame.cashOut(interaction);
        } else {
            await minesGame.startGame(interaction);
        }
    }
};
