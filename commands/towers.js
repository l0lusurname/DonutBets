
const { SlashCommandBuilder } = require('discord.js');
const towersGame = require('../games/towers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('towers')
        .setDescription('Play the Towers minigame'),
    
    async execute(interaction) {
        await towersGame.startGame(interaction);
    }
};
