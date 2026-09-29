const DataCache = invoke('GameServer/DataCache');
const ItemTemplateIndex = require('../../Item/ItemTemplateIndex');
const Pricing = require('./BotEconomyPricing');
const ClanCraftingPolicy = invoke('GameServer/Clan/ClanCraftingPolicy');

const MIN_BASE_VALUE = 2000;
const MIN_BULK_COUNT = 5;
const MIN_SHOT_COUNT = 500;

function material(line) {
    const template = ItemTemplateIndex.find(DataCache.items, line?.selfId);
    const kind = String(line?.kind || template?.template?.kind || '');
    return kind.startsWith('Other.Material') || [1785, 2508, 3031].includes(Number(line?.selfId));
}

function shot(line) {
    const template = ItemTemplateIndex.find(DataCache.items, line?.selfId);
    return String(line?.kind || template?.template?.kind || '').startsWith('Other.Shot');
}

function viable(line) {
    if (shot(line)) {
        return Number.isSafeInteger(Number(line.count)) && Number(line.count) >= MIN_SHOT_COUNT;
    }
    if (!material(line)) return true;
    const template = ItemTemplateIndex.find(DataCache.items, line?.selfId);
    const base = Number(template?.template?.price ?? line.basePrice ?? 0);
    const count = Number(line.count || 0);
    // An inflated ask must not turn two cheap fragments into a valuable lot.
    if ((base < MIN_BASE_VALUE || ClanCraftingPolicy.isResource(line.selfId))
        && count < MIN_BULK_COUNT) return false;
    const unitValue = Math.min(Number(line.price || 0), Pricing.scalePrice(base));
    return Number.isSafeInteger(count) && count > 0
        && unitValue * count >= Pricing.scalePrice(MIN_BASE_VALUE);
}

module.exports = { material, shot, viable, MIN_BASE_VALUE, MIN_BULK_COUNT, MIN_SHOT_COUNT };
