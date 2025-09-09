const { SlashCommandBuilder } = require('discord.js');
const crashGame = require('../games/crash');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('crash')
        .setDescription('Play the Crash minigame'),
    
    async execute(interaction) {
        await crashGame.handleButton(interaction, ['start']);
    }
};