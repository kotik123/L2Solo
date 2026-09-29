const Database = invoke('Database');
const LifeState = invoke('GameServer/Bot/Population/BotLifeState');
const Profile = invoke('GameServer/Bot/Population/ColdCombatProfile');
const Rules = invoke('GameServer/Skills/C4SkillRules');
const Loadout = invoke('GameServer/Bot/AI/PartyBuffLoadout');
const Policy = invoke('GameServer/Bot/Economy/BuffServicePolicy');

const MAX_PURCHASES_PER_TICK = 6;
const BUYER_COOLDOWN_MS = 10 * 60 * 1000;
let running = false;

function available(state) {
    return state?.phase === 'cold' && ['hunting', 'resting'].includes(state.activity)
        && !!state.spotId && !state.party?.partyId && !state.partyId
        && !state.stats?.backgroundPartyId && !state.stats?.pveEncounter && !state.stats?.pvpEncounter
        && Number(state.vitals?.hp || 0) > 0;
}

function skillAdapter(record) {
    const resolved = Profile.skillSnapshotsFromRecords([record])[0] || record;
    const semantic = Rules.resolve({ selfId: Number(record.selfId), level: Number(record.level || 1) });
    return {
        record, semantic,
        fetchSelfId: () => Number(record.selfId),
        fetchLevel: () => Number(record.level || 1),
        fetchSemantic: () => semantic,
        fetchTargetKind: () => semantic.target,
        fetchConsumedMp: () => Math.max(0, Number(resolved.mp ?? semantic.mpConsume ?? 0)),
        fetchBuffTime: () => Math.max(0, Number(resolved.buffTime ?? semantic.durationMs ?? 0))
    };
}

function coldOffer(provider, recipient, timestamp = Date.now()) {
    if (!available(provider) || !available(recipient) || provider.spotId !== recipient.spotId
        || provider.characterId === recipient.characterId || !Policy.serviceClass(provider)) return null;
    if (timestamp - Number(recipient.stats?.lastBuffServicePurchase?.at || 0) < BUYER_COOLDOWN_MS) return null;
    const active = (recipient.stats?.coldCombat?.effects || [])
        .filter(effect => Number(effect.expiresAt || 0) > timestamp + Policy.REFRESH_MS);
    const byFamily = new Map();
    (Profile.profileFor(provider, timestamp).skills || [])
        .filter(record => !record.passive)
        .map(skillAdapter)
        .filter(Policy.eligibleSkill)
        .filter(skill => Loadout.useful(recipient, skill))
        .forEach(skill => {
            const semantic = skill.fetchSemantic();
            const family = Loadout.family(semantic.effect);
            if (active.some(effect => Loadout.family(effect.key) === family
                && Number(effect.level || 0) >= skill.fetchLevel())) return;
            const previous = byFamily.get(family);
            if (!previous || previous.fetchLevel() < skill.fetchLevel()) byFamily.set(family, skill);
        });
    const selected = [];
    let mpCost = 0;
    const mpBudget = Math.max(0, Number(provider.vitals?.mp || 0) - Number(provider.vitals?.maxMp || 0) * 0.2);
    for (const skill of byFamily.values()) {
        const cost = skill.fetchConsumedMp();
        if (selected.length >= 12 || mpCost + cost > mpBudget) continue;
        selected.push(skill);
        mpCost += cost;
    }
    if (!selected.length) return null;
    const relation = invoke('GameServer/Social/InteractionMemoryRuntime').assess(
        { id: provider.characterId }, { id: recipient.characterId }, {}, timestamp);
    const price = Policy.priceFor({ provider, recipient, skills: selected, town: false,
        trust: Number(relation?.effective?.trust ?? relation?.personal?.trust ?? 0) });
    const wallet = Number(recipient.adena || 0);
    const benefitCeiling = Policy.incomeForTenMinutes(recipient) * 0.8;
    if (price > wallet * 0.25 || price > benefitCeiling) return null;
    const effects = selected.map(skill => {
        const semantic = skill.fetchSemantic();
        const durationMs = Math.max(60000, Number(semantic.durationMs ?? skill.fetchBuffTime()) || 20 * 60000);
        const key = Loadout.normalize(semantic.effect);
        return { key, id: skill.fetchSelfId(), level: skill.fetchLevel(), name: semantic.effect,
            type: 'buff', durationMs, expiresAt: timestamp + durationMs,
            stackFamily: semantic.stackFamily || Loadout.family(key),
            stackOrder: semantic.stackOrder ?? null, stats: { ...(semantic.stats || {}) } };
    });
    return { provider, recipient, spotId: provider.spotId, price, mpCost, effects, timestamp };
}

async function purchase(offer) {
    const { provider, recipient, spotId, price, mpCost, effects, timestamp } = offer;
    const result = await Database.purchaseColdBuffs({
        payerId: recipient.characterId, providerId: provider.characterId, spotId,
        payerRevision: recipient.simulation?.revision || 0,
        providerRevision: provider.simulation?.revision || 0,
        price, mpCost, effects, timestamp
    });
    if (!result.ok) return result;
    const buyer = LifeState.acceptSimulationOwnership(recipient.characterId, {
        ...recipient.simulation, revision: result.buyerRevision
    }, { ...recipient, adena: result.buyerAdena, inventory: result.buyerInventory,
        stats: result.buyerStats, updatedAt: timestamp });
    const seller = LifeState.acceptSimulationOwnership(provider.characterId, {
        ...provider.simulation, revision: result.sellerRevision
    }, { ...provider, adena: result.sellerAdena, inventory: result.sellerInventory,
        vitals: { ...provider.vitals, mp: result.nextMp }, stats: result.sellerStats, updatedAt: timestamp });
    const coordinator = invoke('GameServer/Bot/Population/ColdSimulationCoordinator');
    coordinator.markDirty(buyer, { critical: true, reason: 'buff_service_purchase' });
    coordinator.markDirty(seller, { critical: true, reason: 'buff_service_sale' });
    return { ok: true, price, count: effects.length, buyerId: recipient.characterId, providerId: provider.characterId };
}

async function tick(timestamp = Date.now()) {
    if (running) return { ok: false, reason: 'busy' };
    running = true;
    try {
        const states = LifeState.allStates(2000).filter(available);
        const bySpot = new Map();
        states.forEach(state => {
            if (!bySpot.has(state.spotId)) bySpot.set(state.spotId, []);
            bySpot.get(state.spotId).push(state);
        });
        let sales = 0;
        for (const group of bySpot.values()) {
            if (sales >= MAX_PURCHASES_PER_TICK) break;
            for (const provider of group.filter(Policy.serviceClass)) {
                if (sales >= MAX_PURCHASES_PER_TICK) break;
                if (timestamp - Number(provider.stats?.lastBuffService?.at || 0) < BUYER_COOLDOWN_MS) continue;
                for (const recipient of group) {
                    const offer = coldOffer(provider, recipient, timestamp);
                    if (!offer) continue;
                    const result = await purchase(offer);
                    if (result.ok) { sales += 1; break; }
                }
            }
        }
        return { ok: true, sales };
    } finally { running = false; }
}

module.exports = { available, coldOffer, purchase, tick, skillAdapter };
