const assert = require('assert');

require('../src/Global');

const ShotStock = invoke('GameServer/Inventory/ShotStock');
const AfkTrade = invoke('GameServer/AfkTrade/AfkTradeService');
const Database = invoke('Database');
const originalOffers = AfkTrade.offers;
const originalBuy = AfkTrade.buyFromShop;
const originalUpdate = Database.updateItemAmount;

const amounts = new Map([[57, 10000], [1835, 100]]);
const items = new Map([...amounts].map(([selfId]) => [selfId, {
    fetchId: () => selfId, fetchAmount: () => amounts.get(selfId),
    setAmount: (amount) => amounts.set(selfId, amount)
}]));
const actor = {
    fetchId: () => 100,
    backpack: { fetchItemFromSelfId: (selfId) => items.get(Number(selfId)) }
};
const plan = { selfId: 1835, kind: 'soulshot', rank: 'none', price: 7, name: 'Soulshot: No Grade' };

(async () => {
    const purchases = [];
    AfkTrade.offers = () => [{ price: 5, count: 900, store: { afkTrade: true }, sourceId: 200 }];
    AfkTrade.buyFromShop = async (_buyerId, _store, selfId, amount) => {
        purchases.push({ selfId, amount });
        amounts.set(57, amounts.get(57) - amount * 5);
        amounts.set(selfId, amounts.get(selfId) + amount);
        return {};
    };
    Database.updateItemAmount = () => { throw new Error('fixed-store restock must not run'); };
    const result = await ShotStock.purchaseActorRestock(actor, { plan, targetAmount: 1000 });
    assert.strictEqual(result.cost, 4500);
    assert.strictEqual(result.amount, 1000);
    assert.deepStrictEqual(purchases, [{ selfId: 1835, amount: 900 }]);
    assert.strictEqual(amounts.get(57), 5500);
    console.log('Shot restock prefers a cheaper AFK market offer');
})().finally(() => {
    AfkTrade.offers = originalOffers;
    AfkTrade.buyFromShop = originalBuy;
    Database.updateItemAmount = originalUpdate;
});
