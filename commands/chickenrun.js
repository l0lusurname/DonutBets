const { SlashCommandBuilder } = require('discord.js');
const chickenrunGame = require('../games/chickenrun');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('chickenrun')
        .setDescription('Move forward to increase your multiplier! Each step is riskier, but the payout grows.'),
    
    async execute(interaction) {
        await chickenrunGame.startGame(interaction);
    }
};