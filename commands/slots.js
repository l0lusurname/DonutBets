const { SlashCommandBuilder } = require('discord.js');
const slotsGame = require('../games/slots');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('slots')
        .setDescription('Play the Slots minigame'),
    
    async execute(interaction) {
        await slotsGame.startGame(interaction);
    }
};