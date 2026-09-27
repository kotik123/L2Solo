'use strict';

function tradeRow(row = {}) {
    return {
        id: Number(row.id || 0),
        eventKey: String(row.eventKey || ''),
        at: Number(row.occurredAt || 0),
        channel: String(row.channel || ''),
        sourceType: String(row.sourceType || ''),
        selfId: Number(row.selfId || 0),
        itemName: String(row.itemName || ''),
        quantity: Number(row.quantity || 0),
        unitPrice: Number(row.unitPrice || 0),
        adena: Number(row.totalPrice || 0),
        town: row.town || null,
        seller: {
            characterId: Number(row.sellerCharacterId || 0) || null,
            name: row.sellerName || null
        },
        buyer: {
            characterId: Number(row.buyerCharacterId || 0) || null,
            name: row.buyerName || null
        }
    };
}

function aggregate(all, since) {
    const row = all(`SELECT COUNT(*) AS trades,
        COALESCE(SUM(quantity), 0) AS units,
        COALESCE(SUM(totalPrice), 0) AS adena,
        COUNT(DISTINCT selfId) AS items,
        MIN(occurredAt) AS firstAt,
        MAX(occurredAt) AS lastAt
        FROM market_trades WHERE occurredAt >= ?`, [since])[0] || {};
    return {
        trades: Number(row.trades || 0),
        units: Number(row.units || 0),
        adena: Number(row.adena || 0),
        items: Number(row.items || 0),
        firstAt: Number(row.firstAt || 0) || null,
        lastAt: Number(row.lastAt || 0) || null
    };
}

function fetch(all, { timestamp = Date.now(), recentLimit = 200 } = {}) {
    const current = Math.max(1, Number(timestamp) || Date.now());
    const limit = Math.max(1, Math.min(500, Math.floor(Number(recentLimit) || 200)));
    const dayAgo = current - 24 * 60 * 60 * 1000;
    const weekAgo = current - 7 * 24 * 60 * 60 * 1000;
    const recent = all(`SELECT * FROM market_trades
        ORDER BY occurredAt DESC, id DESC LIMIT ${limit}`).map(tradeRow);
    const byItem = all(`SELECT selfId, MAX(itemName) AS name, COUNT(*) AS trades,
        COALESCE(SUM(quantity), 0) AS items, COALESCE(SUM(totalPrice), 0) AS adena,
        MAX(occurredAt) AS lastTradeAt
        FROM market_trades INDEXED BY market_trades_recent WHERE occurredAt >= ?
        GROUP BY selfId ORDER BY adena DESC, items DESC, selfId ASC`, [weekAgo])
        .map((row) => ({
            selfId: Number(row.selfId),
            name: row.name || `Item ${row.selfId}`,
            trades: Number(row.trades || 0),
            items: Number(row.items || 0),
            adena: Number(row.adena || 0),
            lastTradeAt: Number(row.lastTradeAt || 0) || null
        }));
    const byTown = Object.fromEntries(all(`SELECT COALESCE(town, 'Unknown') AS town,
        COUNT(*) AS trades, COALESCE(SUM(quantity), 0) AS items,
        COALESCE(SUM(totalPrice), 0) AS adena
        FROM market_trades WHERE occurredAt >= ?
        GROUP BY COALESCE(town, 'Unknown') ORDER BY adena DESC`, [weekAgo]).map((row) => [row.town, {
        trades: Number(row.trades || 0),
        items: Number(row.items || 0),
        adena: Number(row.adena || 0)
    }]));
    return {
        scope: 'persistent_90d',
        retentionDays: 90,
        windows: {
            day: aggregate(all, dayAgo),
            week: aggregate(all, weekAgo)
        },
        recent,
        byItem,
        byTown
    };
}

module.exports = { fetch };
