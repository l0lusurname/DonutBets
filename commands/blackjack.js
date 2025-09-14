const { SlashCommandBuilder } = require('discord.js');
const blackjackGame = require('../games/blackjack');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('blackjack')
        .setDescription('Play Blackjack against the house'),
    
    async execute(interaction) {
        await blackjackGame.startGame(interaction);
    }
};