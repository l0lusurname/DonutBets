const crypto = require('crypto');

// Generate a provably fair seed
function generateSeed() {
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const clientSeed = crypto.randomBytes(16).toString('hex');
    const nonce = Date.now() + Math.random();
    
    return {
        serverSeed,
        clientSeed,
        nonce,
        hash: crypto.createHash('sha256').update(serverSeed + clientSeed + nonce.toString()).digest('hex')
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
    const hash = crypto.createHash('sha256').update(serverSeed + clientSeed + nonce).digest('hex');
    return hash === expectedHash;
}

// Generate mines positions for Mines game
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
        // Use unique offsets with more randomization
        const offset = level * 1337 + Math.floor(Math.random() * 10000) + Date.now() % 10000;
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
            minesPerLevel = 1;
            break;
        case 'medium':
            slotsPerLevel = 3;
            minesPerLevel = 1;
            break;
        case 'hard':
            slotsPerLevel = 3;
            minesPerLevel = 2;
            break;
        default:
            slotsPerLevel = 4;
            minesPerLevel = 1;
    }
    
    for (let level = 0; level < levels; level++) {
        const levelMines = [];
        const used = new Set();
        
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

// Calculate Mines multipliers
function calculateMinesMultiplier(mineCount, tilesRevealed) {
    if (tilesRevealed === 0) return 1;
    
    const totalTiles = 25;
    const safeTiles = totalTiles - mineCount;
    
    let multiplier = 1;
    for (let i = 0; i < tilesRevealed; i++) {
        const safeRemaining = safeTiles - i;
        const totalRemaining = totalTiles - i;
        multiplier = multiplier * (totalRemaining / safeRemaining);
    }
    
    // Apply house edge (2%)
    multiplier = multiplier * 0.98;
    
    return Math.max(1.01, Math.floor(multiplier * 100) / 100);
}

// Calculate Tower multipliers
function calculateTowerMultiplier(difficulty, level) {
    if (level < 0) return 1;
    
    let baseMultiplier;
    switch (difficulty) {
        case 'easy':
            baseMultiplier = 1.25; // 4 slots, 1 mine (3/4 chance)
            break;
        case 'medium':
            baseMultiplier = 1.41; // 3 slots, 1 mine (2/3 chance)
            break;
        case 'hard':
            baseMultiplier = 2.12; // 3 slots, 2 mines (1/3 chance)
            break;
        default:
            baseMultiplier = 1.25;
    }
    
    const multiplier = Math.pow(baseMultiplier, level + 1);
    
    // Apply house edge (2%)
    return Math.floor(multiplier * 0.98 * 100) / 100;
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