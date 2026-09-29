const assert = require('assert');
const Policy = require('../src/GameServer/Bot/Economy/WealthCraftPolicy');

const recipe = {
    type: 'dwarven', recipeId: 41, productId: 1894, productCount: 1,
    successRate: 100, mpCost: 20,
    materials: [{ selfId: 1876, amount: 2 }, { selfId: 1881, amount: 1 }]
};
const state = { adena: 500000, vitals: { mp: 100 } };
const offers = new Map([
    [1876, [{ price: 10000, count: 1, store: { afkTrade: true }, playerPriority: true },
        { price: 12000, count: 2, store: { afkTrade: true } }]],
    [1881, [{ price: 5000, count: 1, store: { afkTrade: true } }]]
]);
const offersFor = (selfId) => offers.get(selfId) || [];
const exit = { type: 'afk', price: 50000, count: 1 };
const found = Policy.opportunityFor(state, recipe, offersFor, [exit]);
assert(found, 'funded, complete and profitable basket should be selected');
assert.strictEqual(found.basket.cost, 27000);
assert.deepStrictEqual(found.basket.purchases.map((purchase) => purchase.count), [1, 1, 1]);
assert.strictEqual(found.expectedProfit, 23000);
const partialStock = Policy.opportunityFor(state, recipe, offersFor, [exit], (selfId) => (
    selfId === 1876 ? { count: 1, unitValue: 11000 } : null
));
assert(partialStock, 'the crafter can buy only the missing pieces');
assert.strictEqual(partialStock.basket.cashCost, 15000);
assert.strictEqual(partialStock.basket.cost, 26000,
    'owned materials must still count toward economic cost');
assert.deepStrictEqual(partialStock.basket.purchases.map((purchase) => purchase.count), [1, 1]);
assert.strictEqual(Policy.opportunityFor(state, recipe, offersFor, [{ ...exit, count: 0 }]), null,
    'the output needs a buyer for the full craft yield');
assert.strictEqual(Policy.opportunityFor(state, recipe, offersFor, [{ ...exit, price: 30000 }]), null,
    'a thin margin should not risk the materials');
assert.strictEqual(Policy.opportunityFor({ ...state, adena: 100000 }, recipe, offersFor, [exit]), null,
    'purchases must preserve the wallet risk limit');
assert.strictEqual(Policy.opportunityFor(state, { ...recipe, successRate: 50 }, offersFor, [exit]), null,
    'failed crafts must be included in expected profit');
assert.strictEqual(Policy.opportunityFor(state, recipe, (selfId) => selfId === 1881 ? [] : offersFor(selfId), [exit]), null,
    'every ingredient must be available before the bot starts buying');
assert.strictEqual(Policy.opportunityFor({ ...state, vitals: { mp: 1 } }, recipe, offersFor, [exit]), null,
    'the crafter must have enough MP');

console.log('Wealth craft policy checks passed');
