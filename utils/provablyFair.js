const crypto = require('crypto');

// Generate a provably fair seed
function generateSeed() {
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const clientSeed = crypto.randomBytes(16).toString('hex');
    const nonce = Date.now().toString();

    return {
        serverSeed,
        clientSeed,
        nonce,
        hash: crypto.createHash('sha256').update(serverSeed + clientSeed + nonce).digest('hex')
    };
}

// Generate random number from seed
function getRandomFromSeed(seed, min, max, index = 0) {
    const hash = crypto.createHash('sha256').update(seed.hash + index).digest('hex');
    const randomValue = parseInt(hash.substring(0, 8), 16) / 0xffffffff;
    return Math.floor(randomValue * (max - min + 1)) + min;
}

// Generate array of random numbers
function getRandomArray(seed, count, min, max) {
    const results = [];
    for (let i = 0; i < count; i++) {
        results.push(getRandomFromSeed(seed, min, max, i));
    }
    return results;
}

// Verify a seed matches expected results
function verifySeed(serverSeed, clientSeed, nonce, expectedHash) {
    const hash = crypto.createHash('sha256').update(serverSeed + clientSeed + nonce.toString()).digest('hex');
    return hash === expectedHash;
}

// Generate mines positions for Mines game (5x5 grid)
function generateMinesResults(seed, mineCount) {
    // Validate mine count
    if (mineCount < 1) mineCount = 1;
    if (mineCount > 24) mineCount = 24; // Max 24 mines in 25-tile grid (leave at least 1 safe)

    // Create array of all possible positions
    const allPositions = [];
    for (let i = 0; i < 25; i++) {
        allPositions.push(i);
    }

    // Fisher-Yates shuffle algorithm using provably fair random
    const positions = [];
    const remaining = [...allPositions];

    for (let i = 0; i < mineCount; i++) {
        // Get random index from remaining positions
        const randomIndex = getRandomFromSeed(seed, 0, remaining.length - 1, i + 100);

        // Take the position at that index
        const selectedPosition = remaining[randomIndex];
        positions.push(selectedPosition);

        // Remove selected position from remaining (swap with last and pop)
        remaining[randomIndex] = remaining[remaining.length - 1];
        remaining.pop();
    }

    return positions.sort((a, b) => a - b);
}

// Generate towers correct path
function generateTowersResults(seed, levels, blocksPerLevel) {
    const correctPath = [];

    for (let level = 0; level < levels; level++) {
        // Use deterministic offset based only on seed and level
        const offset = level * 1337;
        const correctBlock = getRandomFromSeed(seed, 0, blocksPerLevel - 1, offset);
        correctPath.push(correctBlock);
    }

    return correctPath;
}

// Generate tower mine positions
function generateTowerMines(seed, difficulty) {
    const levels = 8;
    const minePositions = {};

    let slotsPerLevel, minesPerLevel;
    switch (difficulty) {
        case 'easy':
            slotsPerLevel = 4;
            minesPerLevel = 1;  // 1 mine, 3 safe blocks
            break;
        case 'medium':
            slotsPerLevel = 4;
            minesPerLevel = 2;  // 2 mines, 2 safe blocks  
            break;
        case 'hard':
            slotsPerLevel = 4;
            minesPerLevel = 3;  // 3 mines, 1 safe block
            break;
        default:
            slotsPerLevel = 4;
            minesPerLevel = 1;
    }

    for (let level = 0; level < levels; level++) {
        const levelMines = [];
        const used = new Set();

        // Generate mine positions for this level
        for (let m = 0; m < minesPerLevel; m++) {
            let position;
            let attempts = 0;
            do {
                position = getRandomFromSeed(seed, 0, slotsPerLevel - 1, level * 10 + m + attempts * 100);
                attempts++;
                // Prevent infinite loops if we can't find enough unique positions
                if (attempts > 50) {
                    console.error(`Could not generate unique mine positions for level ${level}, difficulty ${difficulty}`);
                    position = m; // Fallback to sequential positions
                    break;
                }
            } while (used.has(position));

            used.add(position);
            levelMines.push(position);
        }

        minePositions[level] = levelMines;
    }

    return minePositions;
}

// Generate slot machine results
function generateSlotResults(seed) {
    const symbols = ['🍒', '🍋', '🍊', '🍉', '⭐', '🔔', '7️⃣'];
    const results = [];

    for (let i = 0; i < 9; i++) { // 3x3 grid
        const symbolIndex = getRandomFromSeed(seed, 0, symbols.length - 1, i);
        results.push(symbols[symbolIndex]);
    }

    return results;
}

// Generate coinflip result
function generateCoinflipResult(seed) {
    const random = getRandomFromSeed(seed, 0, 1, 0);
    return random === 0 ? 'heads' : 'tails';
}

// Generate blackjack cards (shuffled deck)
function generateBlackjackCards(seed) {
    const suits = ['♠', '♥', '♦', '♣'];
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    
    // Create a full deck
    const deck = [];
    for (const suit of suits) {
        for (const rank of ranks) {
            deck.push(rank + suit);
        }
    }
    
    // Fisher-Yates shuffle using provably fair random
    const shuffledDeck = [...deck];
    for (let i = shuffledDeck.length - 1; i > 0; i--) {
        const randomIndex = getRandomFromSeed(seed, 0, i, i + 200); // Offset to avoid collision with other games
        
        // Swap elements
        const temp = shuffledDeck[i];
        shuffledDeck[i] = shuffledDeck[randomIndex];
        shuffledDeck[randomIndex] = temp;
    }
    
    return shuffledDeck;
}

// Generate chicken run multiplier with custom crash frequency based on difficulty
async function generateChickenRunMultiplier(seed, crashFrequency = 0.05, houseEdge = null) {
    const random = getRandomFromSeed(seed, 1, 10000, 1) / 10000; // Different offset from crash

    // Get configurable house edge if not provided
    if (houseEdge === null) {
        const { getCasinoSettings } = require('./database');
        const settings = await getCasinoSettings();
        houseEdge = settings.house_edge;
    }

    // Use custom crash frequency based on difficulty
    if (random < crashFrequency) {
        // Instant crash (0x) - frequency depends on difficulty
        return 0;
    } else if (random < crashFrequency + 0.60) {
        // 60% chance between 1.5x - 3x (good range for chicken theme)
        const normalizedRandom = (random - crashFrequency) / 0.60;
        return Math.floor((1.5 + normalizedRandom * 1.5) * 100) / 100;
    } else if (random < crashFrequency + 0.85) {
        // 25% chance between 3x - 6x (lucky range)
        const normalizedRandom = (random - crashFrequency - 0.60) / 0.25;
        return Math.floor((3 + normalizedRandom * 3) * 100) / 100;
    } else {
        // 15% chance between 6x - 15x (very lucky, higher cap for hard difficulty)
        const normalizedRandom = (random - crashFrequency - 0.85) / (1 - crashFrequency - 0.85);
        const exponentialValue = Math.pow(normalizedRandom, 1.5); // Makes higher values rarer
        const crashPoint = Math.floor((6 + exponentialValue * 9) * 100) / 100;
        return Math.min(15, crashPoint); // Cap at 15x for balance
    }
}

// Generate crash multiplier
async function generateCrashMultiplier(seed, houseEdge = null) {
    const random = getRandomFromSeed(seed, 1, 10000, 0) / 10000;

    // Get configurable house edge if not provided
    if (houseEdge === null) {
        const { getCasinoSettings } = require('./database');
        const settings = await getCasinoSettings();
        houseEdge = settings.house_edge;
    }

    // Updated distribution: 15% instant crash (0x), 60% between 1.3-1.5x (usual), 20% between 1.5-2x (lucky), 5% above 2x (super lucky)
    if (random < 0.15) {
        // 15% chance of instant crash (0x) - reduced from 30%
        return 0;
    } else if (random < 0.75) {
        // 60% chance between 1.3x - 1.5x (usual range) 
        const normalizedRandom = (random - 0.15) / 0.6;
        return Math.floor((1.3 + normalizedRandom * 0.2) * 100) / 100;
    } else if (random < 0.95) {
        // 20% chance between 1.5x - 2x (lucky)
        const normalizedRandom = (random - 0.75) / 0.2;
        return Math.floor((1.5 + normalizedRandom * 0.5) * 100) / 100;
    } else {
        // 5% chance above 2x (super lucky, up to 4x max)
        const normalizedRandom = (random - 0.95) / 0.05;
        const exponentialValue = Math.pow(normalizedRandom, 2); // Makes higher values rarer
        const crashPoint = Math.floor((2 + exponentialValue * 2) * 100) / 100;
        return Math.min(4, crashPoint);
    }
}

// Calculate Mines multipliers using exact mathematical specification
async function calculateMinesMultiplier(mineCount, tilesRevealed, houseEdge = null) {
    if (tilesRevealed === 0) return 1;

    const totalTiles = 25; // 5x5 grid = 25 tiles

    // Get configurable house edge if not provided
    if (houseEdge === null) {
        const { getCasinoSettings } = require('./database');
        const settings = await getCasinoSettings();
        houseEdge = settings.house_edge;
    }

    let cumulativeMultiplier = 1;

    // Per-click probability model: factor per pick = (1 / p_safe) * (1 - house_edge)
    for (let click = 1; click <= tilesRevealed; click++) {
        const tilesRemaining = totalTiles - (click - 1);
        const safeTilesRemaining = (totalTiles - mineCount) - (click - 1);
        const pSafe = safeTilesRemaining / tilesRemaining;
        const factor = (1 / pSafe) * (1 - houseEdge);
        cumulativeMultiplier *= factor;
    }

    return Math.max(1.01, Math.floor(cumulativeMultiplier * 100) / 100);
}

// Calculate Tower multipliers using exact mathematical specification  
async function calculateTowerMultiplier(difficulty, level, houseEdge = null) {
    if (level < 0) return 1;

    // Get configurable house edge if not provided
    if (houseEdge === null) {
        const { getCasinoSettings } = require('./database');
        const settings = await getCasinoSettings();
        houseEdge = settings.house_edge;
    }

    let safeSlots;
    const totalSlots = 4; // 4 blocks per level

    // Determine safe slots based on difficulty
    switch (difficulty) {
        case 'easy':
            safeSlots = 3; // 1 mine, 3 safe blocks
            break;
        case 'medium':
            safeSlots = 2; // 2 mines, 2 safe blocks  
            break;
        case 'hard':
            safeSlots = 1; // 3 mines, 1 safe block
            break;
        default:
            safeSlots = 3;
    }

    // Mathematically fair per-step multiplier = (totalSlots/safeSlots) × (1 - house_edge)
    const perStepMultiplier = (totalSlots / safeSlots) * (1 - houseEdge);
    
    // Cumulative multiplier after clearing (level + 1) steps
    let cumulativeMultiplier = Math.pow(perStepMultiplier, level + 1);
    
    // Apply nerf factor to reduce overall profitability
    const nerfFactor = 0.75; // 25% reduction to make towers less profitable
    cumulativeMultiplier = cumulativeMultiplier * nerfFactor;
    
    // Apply high caps only to prevent extreme edge cases, not interfere with normal fair play
    let maxMultiplier;
    switch (difficulty) {
        case 'easy':
            maxMultiplier = 20; // High enough to not interfere with 8-level completion (~5.5x)
            break;
        case 'medium':
            maxMultiplier = 300; // High enough to not interfere with 8-level completion (~169x)
            break;
        case 'hard':
            maxMultiplier = 50000; // High enough to not interfere with 8-level completion (~43000x)
            break;
        default:
            maxMultiplier = 20;
    }
    
    cumulativeMultiplier = Math.min(cumulativeMultiplier, maxMultiplier);
    
    return Math.max(1.01, Math.floor(cumulativeMultiplier * 100) / 100);
}

module.exports = {
    generateSeed,
    getRandomFromSeed,
    getRandomArray,
    verifySeed,
    generateMinesResults,
    generateTowersResults,
    generateTowerMines,
    generateSlotResults,
    generateCoinflipResult,
    generateBlackjackCards,
    generateChickenRunMultiplier,
    generateCrashMultiplier,
    calculateMinesMultiplier,
    calculateTowerMultiplier
};