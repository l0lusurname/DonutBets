const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUserBalance, updateUserBalance, formatCurrency, parseCurrency } = require('../utils/database');

function isOwner(userId) {
    return userId === process.env.SERVER_OWNER_ID;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Admin commands (Owner only)')
        .addSubcommand(subcommand =>
            subcommand
                .setName('setbalance')
                .setDescription('Set a user\'s balance')
                .addUserOption(option => option.setName('user').setDescription('User to set balance for').setRequired(true))
                .addStringOption(option => option.setName('amount').setDescription('Amount to set').setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('give')
                .setDescription('Give credits to a user')
                .addUserOption(option => option.setName('user').setDescription('User to give credits to').setRequired(true))
                .addStringOption(option => option.setName('amount').setDescription('Amount to give').setRequired(true))
        ),
    
    async execute(interaction) {
        if (!isOwner(interaction.user.id)) {
            await interaction.reply({ content: 'This command is only available to the server owner.', ephemeral: true });
            return;
        }
        
        const subcommand = interaction.options.getSubcommand();
        
        try {
            switch (subcommand) {
                case 'setbalance': {
                    const user = interaction.options.getUser('user');
                    const amountStr = interaction.options.getString('amount');
                    const amount = parseCurrency(amountStr);
                    
                    if (amount < 0) {
                        await interaction.reply({ content: 'Amount must be positive.', ephemeral: true });
                        return;
                    }
                    
                    await updateUserBalance(user.id, amount);
                    
                    const embed = new EmbedBuilder()
                        .setTitle('💼 Balance Updated')
                        .setDescription(`Set ${user.tag}'s balance to ${formatCurrency(amount)}`)
                        .setColor('#00FF00')
                        .setTimestamp();
                    
                    await interaction.reply({ embeds: [embed] });
                    break;
                }
                
                case 'give': {
                    const user = interaction.options.getUser('user');
                    const amountStr = interaction.options.getString('amount');
                    const amount = parseCurrency(amountStr);
                    
                    if (amount <= 0) {
                        await interaction.reply({ content: 'Amount must be positive.', ephemeral: true });
                        return;
                    }
                    
                    const currentBalance = await getUserBalance(user.id);
                    await updateUserBalance(user.id, currentBalance + amount);
                    
                    const embed = new EmbedBuilder()
                        .setTitle('💝 Credits Given')
                        .setDescription(`Gave ${formatCurrency(amount)} to ${user.tag}`)
                        .setColor('#00FF00')
                        .setTimestamp();
                    
                    await interaction.reply({ embeds: [embed] });
                    break;
                }
            }
        } catch (error) {
            console.error('Admin command error:', error);
            await interaction.reply({ content: 'An error occurred while processing the command.', ephemeral: true });
        }
    }
};