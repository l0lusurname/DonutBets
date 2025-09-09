# Discord Gambling Bot

A Discord bot with provably fair gambling minigames including Mines, Towers, Slots, and Crash. Built with Discord.js v14 and Supabase for data storage.

## Features

### Games
- **Mines**: 5x5 grid with configurable mine count (1-24)
- **Towers**: Three difficulty levels with climbing mechanics
- **Slots**: 3x3 grid with symbol combinations
- **Crash**: Real-time multiplier with cashout system

### Commands
- `/balance` - Check current balance
- `/deposit <amount>` - Add fake credits (K/M/B format)
- `/withdraw` - Request withdrawal (owner approval)
- `/history` - View last 10 games
- `/mines` - Play Mines game
- `/towers` - Play Towers game  
- `/slots` - Play Slots game
- `/crash` - Play Crash game
- `/seedcheck` - Verify provably fair seeds
- `/admin setbalance` - Set user balance (owner only)
- `/admin give` - Give credits to user (owner only)

### Provably Fair System
All games use cryptographic seeds for fairness verification. Players can verify any game result using the `/seedcheck` command.

## Setup Instructions

### 1. Discord Bot Setup
1. Go to https://discord.com/developers/applications
2. Create a new application
3. Go to "Bot" tab and create a bot
4. Copy the bot token for DISCORD_TOKEN
5. In "Privileged Gateway Intents", enable:
   - SERVER MEMBERS INTENT
   - MESSAGE CONTENT INTENT
6. Go to "OAuth2" > "URL Generator"
7. Select scopes: `bot` and `applications.commands`
8. Select permissions: `Send Messages`, `Use Slash Commands`, `Send Messages in Threads`, `Read Message History`
9. Use the generated URL to add bot to your server

### 2. Supabase Database Setup
Create these tables in your Supabase project:

```sql
-- Users table
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    balance BIGINT DEFAULT 10000,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Games table  
CREATE TABLE games (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    game_type TEXT NOT NULL,
    bet_amount BIGINT NOT NULL,
    outcome TEXT NOT NULL,
    multiplier FLOAT NOT NULL,
    profit_loss BIGINT NOT NULL,
    seed TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Withdrawals table
CREATE TABLE withdrawals (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    amount BIGINT NOT NULL,
    status TEXT DEFAULT 'Pending',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### 3. Environment Variables
The following secrets are configured in Replit:
- `DISCORD_TOKEN` - Your Discord bot token
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Your Supabase anonymous key
- `SERVER_OWNER_ID` - Discord user ID of server owner

### 4. Running the Bot
The bot is configured to run automatically with the "Discord Bot" workflow.

## Currency Format
- Balances display in K/M/B format (1.5K = 1,500 credits)
- Starting balance: 10,000 credits
- All games use virtual credits (no real money)

## Admin Features
Server owner can:
- Set user balances
- Give credits to users
- Approve/decline withdrawal requests via DM
- View all game logs and statistics

## Withdrawal System
1. User submits withdrawal request via `/withdraw`
2. Bot sends DM to server owner with approval buttons
3. Owner clicks Pay or Decline
4. User receives DM notification
5. If approved, balance is deducted

## Architecture
- `index.js` - Main bot file with event handlers
- `commands/` - Slash command definitions
- `games/` - Game logic and button interactions
- `utils/` - Database helpers and provably fair system
- Supabase - PostgreSQL database for persistence

## Recent Changes
- Created complete Discord bot structure
- Implemented all four minigames with basic functionality
- Set up provably fair system with seed verification
- Created admin commands and withdrawal system
- Configured Supabase database integration
- Added comprehensive error handling