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

// Generate mines positions for Mines game (4x4 grid)
function generateMinesResults(seed, mineCount) {
    // Validate mine count
    if (mineCount < 1) mineCount = 1;
    if (mineCount > 15) mineCount = 15; // Max 15 mines in 16-tile grid (leave at least 1 safe)

    // Create array of all possible positions
    const allPositions = [];
    for (let i = 0; i < 16; i++) {
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
            do {
                position = getRandomFromSeed(seed, 0, slotsPerLevel - 1, level * 10 + m);
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

// Generate crash multiplier
async function generateCrashMultiplier(seed, houseEdge = null) {
    const random = getRandomFromSeed(seed, 1, 10000, 0) / 10000;

    // Get configurable house edge if not provided
    if (houseEdge === null) {
        const { getCasinoSettings } = require('./database');
        const settings = await getCasinoSettings();
        houseEdge = settings.house_edge;
    }

    // Updated distribution: 30% instant crash (0x), 50% between 1.3-1.5x (usual), 15% between 1.5-2x (lucky), 5% above 2x (super lucky)
    if (random < 0.3) {
        // 30% chance of instant crash (0x) - happens often
        return 0;
    } else if (random < 0.8) {
        // 50% chance between 1.3x - 1.5x (usual range) 
        const normalizedRandom = (random - 0.3) / 0.5;
        return Math.floor((1.3 + normalizedRandom * 0.2) * 100) / 100;
    } else if (random < 0.95) {
        // 15% chance between 1.5x - 2x (lucky)
        const normalizedRandom = (random - 0.8) / 0.15;
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

    const totalTiles = 16; // 4x4 grid = 16 tiles

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

    let perFloorFactor;
    const totalSlots = 4; // 4 blocks per floor as per spec

    // Per-floor factor = (totalSlots/safeSlots) * (1 - house_edge)
    switch (difficulty) {
        case 'easy':
            // 3 safe, 1 mine 
            perFloorFactor = (totalSlots / 3) * (1 - houseEdge);
            break;
        case 'medium':
            // 2 safe, 2 mines 
            perFloorFactor = (totalSlots / 2) * (1 - houseEdge);
            break;
        case 'hard':
            // 1 safe, 3 mines 
            perFloorFactor = (totalSlots / 1) * (1 - houseEdge);
            break;
        default:
            perFloorFactor = (totalSlots / 3) * (1 - houseEdge);
    }

    // Cumulative multiplier = per-floor factor compounded for each floor
    let cumulativeMultiplier = 1;
    for (let floor = 0; floor <= level; floor++) {
        cumulativeMultiplier *= perFloorFactor;
    }

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
    generateCrashMultiplier,
    calculateMinesMultiplier,
    calculateTowerMultiplier
};