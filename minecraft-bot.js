const mineflayer = require('mineflayer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

class MinecraftBot {
    constructor() {
        this.bot = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 50;
        this.reconnectDelay = 5000; // 5 seconds initial delay
        
        // Initialize Supabase
        this.supabase = createClient(
            process.env.SUPABASE_URL || 'https://vfltbqpabgvbbxuezaah.supabase.co',
            process.env.SUPABASE_ANON_KEY || ''
        );
        
        console.log('Minecraft bot initialized');
    }

    async connect() {
        if (this.bot) {
            console.log('Bot already exists, ending previous connection');
            this.bot.end();
        }

        try {
            const hasCredentials = process.env.MC_USERNAME && process.env.MC_PASSWORD;
            
            if (hasCredentials) {
                console.log(`Connecting to donutsmp.net as ${process.env.MC_USERNAME} (premium)...`);
                
                this.bot = mineflayer.createBot({
                    host: 'donutsmp.net',
                    port: 25565,
                    username: process.env.MC_USERNAME,
                    password: process.env.MC_PASSWORD,
                    version: '1.20.1',
                    auth: 'microsoft'
                });
            } else {
                console.log('⚠️  No MC credentials found, connecting in offline mode for testing...');
                
                this.bot = mineflayer.createBot({
                    host: 'donutsmp.net',
                    port: 25565,
                    username: 'TestBot_' + Math.floor(Math.random() * 1000),
                    version: '1.20.1',
                    auth: 'offline'
                });
            }

            this.setupEventHandlers();

        } catch (error) {
            console.error('Failed to create minecraft bot:', error);
            this.scheduleReconnect();
        }
    }

    setupEventHandlers() {
        this.bot.on('login', () => {
            console.log(`✅ Minecraft bot logged in as ${this.bot.username}`);
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.reconnectDelay = 5000; // Reset delay
        });

        this.bot.on('spawn', () => {
            console.log('🌍 Bot spawned in minecraft world');
        });

        this.bot.on('message', (message) => {
            this.handleChatMessage(message);
        });

        this.bot.on('error', (error) => {
            console.error('❌ Minecraft bot error:', error);
            this.isConnected = false;
        });

        this.bot.on('end', (reason) => {
            console.log('🔌 Minecraft bot disconnected:', reason);
            this.isConnected = false;
            this.scheduleReconnect();
        });

        this.bot.on('kicked', (reason) => {
            console.log('👢 Minecraft bot was kicked:', reason);
            this.isConnected = false;
            this.scheduleReconnect();
        });
    }

    async handleChatMessage(message) {
        const text = message.toString();
        console.log('💬 Minecraft chat:', text);

        // Log all chat messages for debugging
        await this.logEvent('chat_message', text, { 
            message: text,
            messageObject: message,
            timestamp: new Date().toISOString()
        });

        // Only process system messages, not player chat
        // Check if this is a system message (server notification)
        // This prevents players from spoofing payments by typing fake messages
        if (message.extra || message.translate || (message.color && message.color !== 'white')) {
            // This looks like a system message - proceed with payment detection
            
            // Parse payment messages (e.g., "PlayerName paid you $500.50")
            const paymentRegex = /^(\w+) paid you \$?([\d,]+\.?\d*)/i;
            const match = text.match(paymentRegex);
            
            if (match) {
                const [, playerName, amountStr] = match;
                const amount = parseFloat(amountStr.replace(/,/g, ''));
                
                console.log(`💰 System payment detected: ${playerName} paid $${amount}`);
                
                await this.handlePayment(playerName, amount, text);
            }
        } else {
            // This is likely player chat - log but don't process as payment
            console.log('👥 Player chat (ignored for payments):', text);
        }
    }

    async handlePayment(playerName, amount, rawMessage) {
        try {
            // Convert to cents for precision
            const amountCents = Math.round(amount * 100);
            
            // Log the payment event
            await this.logEvent('payment_received', rawMessage, {
                player_name: playerName,
                amount_dollars: amount,
                amount_cents: amountCents,
                raw_message: rawMessage
            });

            console.log(`✅ Payment logged: ${playerName} -> $${amount}`);

            // Check for pending verifications and deposits
            await this.processPayment(playerName.toLowerCase(), amountCents, rawMessage);
            
        } catch (error) {
            console.error('Error handling payment:', error);
        }
    }

    async processPayment(playerName, amountCents, rawMessage) {
        try {
            // Check for verification payments first
            const { data: verificationData, error: verifyError } = await this.supabase
                .from('linked_accounts')
                .select('*')
                .eq('mc_username', playerName)
                .eq('status', 'Pending')
                .eq('verify_amount_cents', amountCents)
                .gte('verify_expires_at', new Date().toISOString())
                .single();

            if (!verifyError && verificationData) {
                // Verification payment found - complete the linking
                await this.completeAccountVerification(verificationData, rawMessage);
                return;
            }

            // Check for deposit payments from verified accounts
            const { data: linkedAccount, error: linkError } = await this.supabase
                .from('linked_accounts')
                .select('*')
                .eq('mc_username', playerName)
                .eq('status', 'Verified')
                .single();

            if (!linkError && linkedAccount) {
                // This is a deposit from a verified account
                await this.processDeposit(linkedAccount, amountCents, rawMessage);
                return;
            }

            console.log(`💰 Unlinked payment received: ${playerName} -> $${amountCents/100}`);

        } catch (error) {
            console.error('Error processing payment:', error);
        }
    }

    async completeAccountVerification(verificationData, rawMessage) {
        try {
            console.log(`✅ Completing verification for ${verificationData.mc_username}`);

            // Update account status to verified
            const { error: updateError } = await this.supabase
                .from('linked_accounts')
                .update({ 
                    status: 'Verified',
                    updated_at: new Date().toISOString()
                })
                .eq('id', verificationData.id);

            if (updateError) {
                console.error('Error updating account status:', updateError);
                return;
            }

            // Update payment record
            await this.supabase
                .from('payments')
                .update({
                    status: 'Completed',
                    confirmed_at: new Date().toISOString(),
                    raw_event: { raw_message: rawMessage }
                })
                .eq('discord_user_id', verificationData.discord_user_id)
                .eq('direction', 'verify')
                .eq('amount_cents', verificationData.verify_amount_cents)
                .eq('status', 'Pending');

            console.log(`🎉 Account verification completed: ${verificationData.mc_username} -> Discord ${verificationData.discord_user_id}`);

        } catch (error) {
            console.error('Error completing verification:', error);
        }
    }

    async processDeposit(linkedAccount, amountCents, rawMessage) {
        try {
            console.log(`💳 Processing deposit: ${linkedAccount.mc_username} -> $${amountCents/100}`);

            // Update user balance
            const { error: balanceError } = await this.supabase
                .from('users')
                .update({ 
                    balance: this.supabase.sql`balance + ${amountCents}`
                })
                .eq('id', linkedAccount.discord_user_id);

            if (balanceError) {
                console.error('Error updating balance:', balanceError);
                return;
            }

            // Update linked account totals
            await this.supabase
                .from('linked_accounts')
                .update({
                    total_deposited_cents: this.supabase.sql`total_deposited_cents + ${amountCents}`,
                    updated_at: new Date().toISOString()
                })
                .eq('id', linkedAccount.id);

            // Record the deposit
            await this.supabase
                .from('payments')
                .insert({
                    discord_user_id: linkedAccount.discord_user_id,
                    mc_username: linkedAccount.mc_username,
                    direction: 'deposit',
                    amount_cents: amountCents,
                    reference: `deposit_${linkedAccount.discord_user_id}_${Date.now()}`,
                    status: 'Completed',
                    confirmed_at: new Date().toISOString(),
                    raw_event: { raw_message: rawMessage }
                });

            console.log(`✅ Deposit completed: ${linkedAccount.mc_username} deposited $${amountCents/100}`);

        } catch (error) {
            console.error('Error processing deposit:', error);
        }
    }

    async logEvent(eventType, rawText, parsedData) {
        try {
            await this.supabase
                .from('mc_bot_events')
                .insert({
                    event_type: eventType,
                    raw: rawText,
                    parsed: parsedData,
                    created_at: new Date().toISOString()
                });
        } catch (error) {
            console.error('Error logging event to database:', error);
        }
    }

    async sendCommand(command) {
        if (!this.isConnected || !this.bot) {
            console.error('Cannot send command: bot not connected');
            return false;
        }

        try {
            console.log(`📤 Sending command: ${command}`);
            this.bot.chat(command);
            return true;
        } catch (error) {
            console.error('Error sending command:', error);
            return false;
        }
    }

    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('❌ Max reconnect attempts reached. Stopping.');
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 300000); // Max 5 min
        
        console.log(`🔄 Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
        
        setTimeout(() => {
            this.connect();
        }, delay);
    }

    async payPlayer(playerName, amount) {
        const command = `/pay ${playerName} ${amount}`;
        return await this.sendCommand(command);
    }

    getStatus() {
        return {
            connected: this.isConnected,
            username: this.bot?.username || null,
            reconnectAttempts: this.reconnectAttempts
        };
    }

    async stop() {
        console.log('🛑 Stopping minecraft bot...');
        if (this.bot) {
            this.bot.end();
        }
        this.isConnected = false;
    }
}

// Create global instance
const minecraftBot = new MinecraftBot();

// Don't auto-connect when module is loaded - wait for Discord bot to be ready
console.log('⚠️  Minecraft bot ready. Will connect when Discord bot starts.');

module.exports = minecraftBot;