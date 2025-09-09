const { SlashCommandBuilder } = require('discord.js');
const minesGame = require('../games/mines');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cashout')
        .setDescription('Cash out your current mines game'),
    
    async execute(interaction) {
        await minesGame.cashOut(interaction);
    }
};