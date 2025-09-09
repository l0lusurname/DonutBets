const { SlashCommandBuilder } = require('discord.js');
const minesGame = require('../games/mines');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mines')
        .setDescription('Play the Mines minigame'),
    
    async execute(interaction) {
        await minesGame.handleButton(interaction, ['start']);
    }
};