const assert = require('assert');

require('../src/Global');

const DataCache = invoke('GameServer/DataCache');
const Database = invoke('Database');
const LifeState = invoke('GameServer/Bot/Population/BotLifeState');
const ItemDisposition = invoke('GameServer/Bot/Economy/ItemDisposition');
const MarketListingPolicy = invoke('GameServer/Bot/Economy/MarketListingPolicy');
const MarketTownPolicy = invoke('GameServer/Bot/Economy/MarketTownPolicy');
const C4RecipeItems = invoke('GameServer/Items/C4RecipeItems');

DataCache.init();

const recipe = C4RecipeItems.resolve(2298);
const dRecipe = C4RecipeItems.resolve(2153);
const lowGradeRecipe = C4RecipeItems.resolve(2250);
const spellbook = DataCache.items.find((item) => item?.template?.kind === 'Other.Spellbook');
assert(recipe && dRecipe && lowGradeRecipe && spellbook,
    'the datapack must contain recipe and spellbook fixtures');

const original = {
    fetchCharacterRecipes: Database.fetchCharacterRecipes,
    setCharacterRecipe: Database.setCharacterRecipe,
    learnColdRecipes: Database.learnColdRecipes,
    acceptLifecycleRow: LifeState.acceptLifecycleRow,
    syncInventorySummary: Database.syncInventorySummary,
    upsertState: LifeState.upsertState
};

async function run() {
    const craftState = {
        characterId: 7001,
        level: 36,
        classId: 56,
        stats: { classId: 56 },
        inventory: {
            2298: { selfId: 2298, name: 'Recipe: Stormbringer', amount: 2, kind: 'Other.Recipe' },
            2250: { selfId: 2250, name: 'Recipe: Bone Arrow', amount: 1, kind: 'Other.Recipe' },
            [spellbook.selfId]: { selfId: spellbook.selfId, name: spellbook.template.name, amount: 1, kind: 'Other.Spellbook' }
        }
    };

    assert.deepStrictEqual(
        ItemDisposition.recipeDisposition(craftState, craftState.inventory[2298], []).action,
        'learn',
        'a C-grade recipe must be learned by a capable crafter when it is not known'
    );
    assert.strictEqual(
        ItemDisposition.recipeDisposition(craftState, craftState.inventory[2298], [recipe.recipeId]).action,
        'market',
        'a duplicate C-grade recipe remains available for another crafter'
    );
    const dRecipeItem = { selfId: 2153, name: "Recipe: Tiger's Eye Earring",
        amount: 1, kind: 'Other.Recipe' };
    assert.strictEqual(ItemDisposition.isNpcOnlyItem(dRecipeItem), false,
        'D-grade equipment recipes must be marketable');
    const dMarketItem = ItemDisposition.saleCandidates({ ...craftState, classId: 28,
        stats: { classId: 28 }, inventory: { 2153: dRecipeItem } },
    { unlimited: true }).find((item) => item.selfId === 2153);
    assert(dMarketItem, 'a non-crafter should sell a D-grade recipe');
    assert.strictEqual(dMarketItem.rank, 'd', 'recipe market grade follows its product');
    assert.strictEqual(MarketTownPolicy.targetTownForItems(craftState, [dMarketItem]),
        MarketTownPolicy.dGradeMarketFor(craftState));
    assert.strictEqual(MarketTownPolicy.targetTownForItems(craftState, [{ ...dMarketItem, selfId: 2298,
        rank: 'c' }]), 'Giran');
    assert.strictEqual(MarketListingPolicy.classify(craftState, dMarketItem, {
        states: [], signals: [], supplyByItem: new Map()
    }).action, 'list', 'one scarce D-grade recipe should be offered without existing demand');
    assert.strictEqual(
        ItemDisposition.recipeDisposition(craftState, craftState.inventory[2250], []).action,
        'npc',
        'a recipe producing below C-grade output must go to the NPC shop'
    );
    assert.strictEqual(
        MarketListingPolicy.classify(craftState, {
            selfId: spellbook.selfId,
            name: spellbook.template.name,
            kind: spellbook.template.kind,
            count: 1,
            price: 100,
            basePrice: Number(spellbook.template.price || 0)
        }).action,
        'npc',
        'all spellbooks must be NPC-only inventory'
    );

    const learned = [];
    Database.fetchCharacterRecipes = () => Promise.resolve([]);
    Database.learnColdRecipes = async (characterId, recipes, state) => {
        const inventory = structuredClone(state.inventory);
        for (const recipe of recipes) {
            learned.push({ characterId, recipeId: recipe.recipeId, type: recipe.type });
            inventory[recipe.recipeItemId].amount--;
        }
        return { coldLifeRow: { ...state, inventory, stats: { ...state.stats,
            lastRecipeBookLearning: { learned: recipes } } } };
    };
    LifeState.acceptLifecycleRow = state => state;
    Database.syncInventorySummary = () => Promise.resolve();
    LifeState.upsertState = (state) => Promise.resolve(state);

    const updated = await LifeState.learnCraftableRecipes(craftState);
    assert.deepStrictEqual(learned, [{ characterId: 7001, recipeId: recipe.recipeId, type: recipe.type }]);
    assert.strictEqual(updated.inventory[2298].amount, 1, 'learning must consume exactly one recipe item');
    assert.strictEqual(updated.inventory[2250].amount, 1, 'low-grade recipes must remain for NPC liquidation');
    assert.strictEqual(updated.inventory[spellbook.selfId].amount, 1, 'spellbooks must remain for NPC liquidation');
    assert.strictEqual(updated.stats.lastRecipeBookLearning.learned[0].recipeId, recipe.recipeId);

    console.log('Bot recipe disposition checks passed');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => {
    Database.fetchCharacterRecipes = original.fetchCharacterRecipes;
    Database.setCharacterRecipe = original.setCharacterRecipe;
    Database.learnColdRecipes = original.learnColdRecipes;
    LifeState.acceptLifecycleRow = original.acceptLifecycleRow;
    Database.syncInventorySummary = original.syncInventorySummary;
    LifeState.upsertState = original.upsertState;
    LifeState.reset?.();
});
