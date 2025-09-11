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
    const positions = [];
    const used = new Set();
    
    for (let i = 0; i < mineCount; i++) {
        let position;
        do {
            position = getRandomFromSeed(seed, 0, 15, i + 100); // 16 tiles (0-15) for 4x4 grid
        } while (used.has(position));
        
        used.add(position);
        positions.push(position);
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
function generateCrashMultiplier(seed) {
    const random = getRandomFromSeed(seed, 1, 10000, 0) / 10000;
    
    // Very aggressive distribution to keep crashes very low
    // Most crashes should be between 1.2x - 3x with heavy bias toward 1.5x-2x
    const houseEdge = 0.05; // 5% house edge
    
    // Transform random to heavily favor very low crashes
    let adjustedRandom;
    if (random < 0.7) {
        // 70% chance of crash between 1.2x - 2x
        adjustedRandom = 0.17 + (random / 0.7) * 0.3;
    } else if (random < 0.9) {
        // 20% chance of crash between 2x - 3x  
        adjustedRandom = 0.47 + ((random - 0.7) / 0.2) * 0.16;
    } else {
        // 10% chance of higher crashes up to 10x
        adjustedRandom = 0.63 + ((random - 0.9) / 0.1) * 0.27;
    }
    
    const crashPoint = Math.floor((1 / (1 - adjustedRandom * (1 - houseEdge))) * 100) / 100;
    
    // Cap maximum crash at 10x and ensure minimum is 1.2x
    return Math.max(1.2, Math.min(10, crashPoint));
}

// Calculate Mines multipliers using exact mathematical specification
function calculateMinesMultiplier(mineCount, tilesRevealed) {
    if (tilesRevealed === 0) return 1;
    
    const totalTiles = 16; // 4x4 grid = 16 tiles
    const houseEdge = 0.03; // 3% house edge as per specification
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
function calculateTowerMultiplier(difficulty, level) {
    if (level < 0) return 1;
    
    const houseEdge = 0.03; // 3% house edge as per specification
    let perFloorFactor;
    
    // Per-floor factor = (1/p) * (1 - house_edge) where p = safe_slots / total_slots
    switch (difficulty) {
        case 'easy':
            // 3 safe, 1 mine (p = 3/4)
            perFloorFactor = (1 / (3/4)) * (1 - houseEdge);
            break;
        case 'medium':
            // 2 safe, 2 mines (p = 2/4 = 0.5)
            perFloorFactor = (1 / 0.5) * (1 - houseEdge);
            break;
        case 'hard':
            // 1 safe, 3 mines (p = 1/4 = 0.25)
            perFloorFactor = (1 / 0.25) * (1 - houseEdge);
            break;
        default:
            perFloorFactor = (1 / (3/4)) * (1 - houseEdge);
    }
    
    // Cumulative multiplier = per-floor factor raised to the power of floors passed
    const cumulativeMultiplier = Math.pow(perFloorFactor, level + 1);
    
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