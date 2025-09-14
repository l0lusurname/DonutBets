const { SlashCommandBuilder } = require('discord.js');
const coinflipGame = require('../games/coinflip');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('coinflip')
        .setDescription('Simple 50/50 coinflip game with x2 multiplier'),
    
    async execute(interaction) {
        await coinflipGame.startGame(interaction);
    }
};