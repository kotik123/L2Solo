// Temple priests of the C4 towns (source spawnlist zones). Each offers the
// town's Class Transfer and Clan dialog through data/Html/<selfId>.html.
// Towns: Gludin, Gludio, Floran, Dion, Giran, Oren, Aden.
const PRIESTS = new Set([
    // Gludin
    7022, 7037, 7375,
    // Gludio
    7030, 7289, 7293,
    // Floran
    7031, 7032, 7036,
    // Dion
    7067, 7068, 7070,
    // Giran
    7116, 7117, 7118, 7119, 7120, 7473,
    // Oren
    7188, 7191, 7680,
    // Aden
    7857, 7858, 7859, 7860, 7861
]);

function handles(npcId) {
    return PRIESTS.has(Number(npcId));
}

module.exports = { handles };
