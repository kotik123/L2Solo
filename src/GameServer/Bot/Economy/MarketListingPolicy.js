const DataCache = invoke('GameServer/DataCache');
const ItemDisposition = invoke('GameServer/Bot/Economy/ItemDisposition');
const MarketDemandIndex = invoke('GameServer/Bot/Economy/MarketDemandIndex');
const BotMarketPricing = invoke('GameServer/Bot/Economy/BotMarketPricing');
const MarketBuyerActivity = invoke('GameServer/Bot/Economy/MarketBuyerActivity');
const LifeState = invoke('GameServer/Bot/Population/BotLifeState');
const ProgressionRates = invoke('GameServer/ProgressionRates');

const MARKET_GEAR_MIN_BASE_PRICE = ItemDisposition.NPC_LIQUIDATION_MAX_UNIT_PRICE;
const SPECULATIVE_GEAR_MIN_BASE_PRICE = 10000;
const SPECULATIVE_SUPPLY_LIMIT = 1;
const MIN_LISTING_BASE_PERCENT = 60;
const NPC_SURPLUS_GEAR_MAX_BASE_PRICE = 50000;

let newbieItemSource = null;
let newbieItemIds = new Set();

function starterItemIds() {
    const source = DataCache.newbieItems || [];
    if (newbieItemSource !== source) {
        newbieItemSource = source;
        newbieItemIds = new Set(source.flatMap((row) => (row.items || []).map((item) => Number(item.selfId || 0))).filter(Boolean));
    }
    return newbieItemIds;
}

function isGear(item = {}) {
    return String(item.kind || '').startsWith('Weapon.') || String(item.kind || '').startsWith('Armor.');
}

function allowsLowGradeMarket() {
    return ['x1', 'x10'].includes(ProgressionRates.profile().preset);
}

function listOrWarehouse(item, decision) {
    if (listingPrice(item, decision) !== null) return decision;
    return surplusGearDecision(item, 'non_competitive_floor', decision.market);
}

function surplusGearDecision(item, reason, market) {
    const ordinary = item.npcComparable !== false && Number(item.enchant || 0) <= 0;
    const common = isGear(item) && ordinary
        && Number(item.basePrice || 0) <= NPC_SURPLUS_GEAR_MAX_BASE_PRICE;
    return { action: common ? 'npc' : 'warehouse', reason, market };
}

function classify(state, item, options = {}) {
    if (!item || Number(item.selfId || 0) <= 0 || Number(item.count || 0) <= 0) {
        return { action: 'ignore', reason: 'invalid_item' };
    }
    if (ItemDisposition.isNpcOnlyItem(item)) {
        return { action: 'npc', reason: 'npc_only_item' };
    }
    if (starterItemIds().has(Number(item.selfId))) {
        return isGear(item) ? surplusGearDecision(item, 'starter_kit')
            : { action: 'npc', reason: 'starter_kit' };
    }
    const lowGradeGear = isGear(item)
        && ItemDisposition.gradeIndex(item.rank) < ItemDisposition.gradeIndex('c');
    if (lowGradeGear && !allowsLowGradeMarket()) {
        return surplusGearDecision(item, 'low_grade_high_rate');
    }
    if (isGear(item) && !lowGradeGear && Number(item.basePrice || 0) <= MARKET_GEAR_MIN_BASE_PRICE) {
        return surplusGearDecision(item, 'low_value_gear');
    }

    const marketOptions = {
        ...options,
        excludeCharacterId: state.characterId
    };
    const supply = MarketDemandIndex.supplyFor(item.selfId, marketOptions);
    const unitPrice = listingPrice(item, { market: { supply } }) ?? listingFloor(item);
    const market = {
        supply,
        demand: MarketDemandIndex.demandFor(item.selfId, { ...marketOptions, unitPrice })
    };
    if (isGear(item)) {
        const buyers = Math.max(0, Number(options.buyerActivity?.get?.(Number(item.selfId))
            ?? options.buyerActivity?.[Number(item.selfId)]
            ?? MarketBuyerActivity.count(item.selfId)) || 0);
        const competitiveUnits = supply.offers.reduce((units, offer) => units + (
            Number(offer.price || 0) <= Math.ceil(unitPrice * 1.05)
                ? Math.max(0, Number(offer.count || 0)) : 0
        ), 0);
        market.recentBuyers = buyers;
        market.competitiveUnits = competitiveUnits;
    }
    const fundedUnits = Math.max(0, Number(market.demand.fundedUnits || 0));
    if (isGear(item) && fundedUnits <= market.supply.units && market.recentBuyers > 0) {
        const available = Math.max(0, market.recentBuyers - market.competitiveUnits);
        if (available > 0) return listOrWarehouse(item, {
            action: 'list', reason: 'recent_buyer_activity',
            listCount: Math.min(Number(item.count), available), market
        });
        return surplusGearDecision(item, 'market_oversupply', market);
    }
    if (market.demand.bots <= 0 && Number(market.demand.afkOrders || 0) <= 0) {
        if (lowGradeGear) return surplusGearDecision(item, 'low_grade_no_funded_demand', market);
        return surplusGearDecision(item, 'no_demand', market);
    }
    const actionableUnits = fundedUnits;
    if (actionableUnits > 0) {
        const availableUnits = Math.max(0, actionableUnits - market.supply.units);
        if (availableUnits <= 0) return surplusGearDecision(item, 'saturated', market);
        return listOrWarehouse(item, {
            action: 'list',
            reason: 'active_demand',
            listCount: Math.min(Number(item.count), availableUnits),
            market
        });
    }

    if (market.demand.readyBots > 0) {
        if (lowGradeGear) return surplusGearDecision(item, 'low_grade_no_funded_demand', market);
        return { action: 'warehouse', reason: 'unfunded_demand', market };
    }
    if (lowGradeGear) {
        return surplusGearDecision(item, 'low_grade_no_funded_demand', market);
    }
    const speculative = isGear(item)
        && Number(item.basePrice || 0) >= SPECULATIVE_GEAR_MIN_BASE_PRICE
        && market.supply.units < SPECULATIVE_SUPPLY_LIMIT;
    if (speculative) {
        const failed = state.stats?.marketPricing?.[Number(item.selfId)];
        if (Number(failed?.speculativeFailedAt || 0) > 0) {
            return { action: 'warehouse', reason: 'speculative_already_tried', market };
        }
        return listOrWarehouse(item, {
            action: 'list',
            reason: 'speculative_demand',
            listCount: Math.min(Number(item.count), SPECULATIVE_SUPPLY_LIMIT - market.supply.units),
            market
        });
    }
    if (market.supply.units >= SPECULATIVE_SUPPLY_LIMIT) {
        return surplusGearDecision(item, 'saturated', market);
    }
    return { action: 'warehouse', reason: 'latent_demand', market };
}

function listingFloor(item) {
    const basePrice = Math.max(0, Number(item?.basePrice || 0));
    if (basePrice <= 0) return 1;
    return BotMarketPricing.listingFloor(item);
}

function listingPrice(item, decision) {
    const preferred = Math.max(1, Math.floor(Number(item.price || 0)));
    const minimum = listingFloor(item);
    const competition = Math.min(Number(decision?.market?.supply?.minimumPrice || Infinity), BotMarketPricing.npcPrice(item));
    if (!Number.isFinite(competition) || competition <= 0) return Math.max(minimum, preferred);
    const competitivePrice = Math.floor(competition * 0.98);
    if (minimum > competitivePrice) return null;
    return Math.max(minimum, Math.min(preferred, competitivePrice));
}

function evaluate(state, options = {}) {
    const marketCandidates = ItemDisposition.saleCandidates(state, options);
    const npcCandidates = ItemDisposition.saleCandidates(state, {
        ...options,
        onlyNpc: true,
        unlimited: true
    });
    const marketIds = new Set(marketCandidates.map((item) => Number(item.selfId)));
    const candidates = [
        ...marketCandidates,
        ...npcCandidates.filter((item) => !marketIds.has(Number(item.selfId)))
    ];
    const states = options.states || LifeState.allStates(5000);
    const supplyByItem = options.supplyByItem || MarketDemandIndex.indexSupply(states);
    const signalsByItem = options.signalsByItem || MarketDemandIndex.indexSignals(states, Number(options.now) || Date.now());
    const decisions = candidates.map((item) => {
        const decision = classify(state, item, { ...options, states, supplyByItem,
            signals: options.signals || signalsByItem.get(Number(item.selfId)) || [] });
        return {
            ...decision,
            item: decision.action === 'list' ? {
                ...item,
                count: Math.max(1, Math.min(Number(item.count), Number(decision.listCount || item.count))),
                price: listingPrice(item, decision),
                marketReason: decision.reason
            } : item
        };
    });
    return {
        candidates,
        decisions,
        listings: decisions.filter((decision) => decision.action === 'list').map((decision) => decision.item),
        npc: decisions.filter((decision) => decision.action === 'npc').map((decision) => ({
            ...decision.item,
            npcPrice: Math.max(1, Math.floor(Number(decision.item.basePrice || 0) * 0.5))
        })),
        warehouse: decisions.filter((decision) => decision.action === 'warehouse').map((decision) => decision.item)
    };
}

module.exports = {
    MARKET_GEAR_MIN_BASE_PRICE,
    MIN_LISTING_BASE_PERCENT,
    SPECULATIVE_GEAR_MIN_BASE_PRICE,
    SPECULATIVE_SUPPLY_LIMIT,
    allowsLowGradeMarket,
    classify,
    evaluate,
    isGear,
    listingFloor,
    listingPrice,
    starterItemIds
};
