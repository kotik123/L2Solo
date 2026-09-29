const Database = invoke('Database');

const REFRESH_MS = 5 * 60 * 1000;
let buyers = new Map();
let loadedAt = 0;
let pending = null;

function count(selfId) {
    return buyers.get(Number(selfId)) || 0;
}

function revision() {
    return loadedAt;
}

function refresh(timestamp = Date.now()) {
    if (pending) return pending;
    if (loadedAt && timestamp - loadedAt < REFRESH_MS) return Promise.resolve(false);
    pending = Database.fetchMarketBuyerActivity({ timestamp }).then((rows) => {
        buyers = new Map(rows.map((row) => [Number(row.selfId), Number(row.buyers || 0)]));
        loadedAt = timestamp;
        return true;
    }).finally(() => { pending = null; });
    return pending;
}

module.exports = { count, refresh, revision,
    _resetForTests() { buyers = new Map(); loadedAt = 0; pending = null; } };
