const Config = invoke('GameServer/Bot/Population/PopulationConfig');
const Voice = invoke('GameServer/Bot/AI/BotChatVoice');
const Speech = invoke('GameServer/Bot/AI/BotSpeechTemplates');
const Identity = invoke('GameServer/Bot/AI/BotServiceIdentity');
const AfkTradeChatSelection = invoke('GameServer/Bot/Economy/AfkTradeChatSelection');
const ItemTemplateIndex = require('../../Item/ItemTemplateIndex');

const MAX_PENDING = 64;
const HISTORY_LIMIT = 2048;
const PENDING_TTL_MS = 5 * 60000;
const AFK_RECHECK_MS = 30000;
const pending = new Map();
const history = new Map();
const lastItemAt = new Map();
const lastTownAt = new Map();
let nextGlobalAt = 0;
let nextFlushAt = 0;
let nextAfkScanAt = 0;
let lastDeliveryType = null;
let afkAdsSent = 0;

function id(source) { return Number(source?.actor?.fetchId?.() || source?.characterId || 0); }
function price(value) {
    const amount = Math.round(Number(value));
    if (!Number.isSafeInteger(amount) || amount <= 0) return '';
    if (amount < 1000) return `${amount} adena`;
    const unit = amount >= 1000000 ? 1000000 : 1000;
    const rounded = Math.round(amount / unit * 10) / 10;
    if (unit === 1000 && rounded >= 1000) return '1kk';
    return `${rounded}${unit === 1000000 ? 'kk' : 'k'}`;
}

function players() {
    return (invoke('GameServer/World/World').user?.sessions || []).filter(session =>
        session.accountId && !String(session.accountId).startsWith('bot_') &&
        session.socket && typeof session.socket.write === 'function' && session.actor?.fetchIsOnline?.() !== false);
}

function snapshot(source, now) {
    if (!id(source) || Identity.isStaticService(source)) return null;
    let store;
    if (source.actor) {
        if (source.plan !== 'merchant' || source.merchantStoreMutation || source.actor.fetchIsOnline?.() === false || source.actor.isDead?.()) return null;
        store = source.actor.fetchPrivateStore?.();
        if (Number(source.actor.fetchPrivateStoreType?.()) !== Number(store?.storeType)) return null;
    } else {
        if (source.phase !== 'cold' || source.activity !== 'merchant') return null;
        store = source.stats?.marketStore;
    }
    const stateStore = source.coldMarketState?.stats?.marketStore || store;
    const expiresAt = Number(stateStore?.expiresAt || store?.expiresAt || 0);
    if (!store || ![1, 3].includes(Number(store.storeType || 1)) || store.repricing || expiresAt && expiresAt <= now) return null;
    if (Number(store.storeType) === 3 && store.budgetBacked !== true) return null;
    let items = (store.items || []).filter(item => Number(item.count) > 0 && price(item.price) &&
        (!item.marketExpiresAt || Number(item.marketExpiresAt) > now));
    if (!items.length) return null;
    const wallet = Number(source.actor?.fetchAdena?.() ?? source.adena);
    if (Number(store.storeType) === 3 && Number.isFinite(wallet)) items = items.filter(item => Number(item.price) <= wallet);
    if (!items.length) return null;
    return { store: { ...store, items }, key: `${id(source)}:${stateStore?.id || store.openedAt || ''}:${store.storeType || 1}` };
}

function label(item) {
    const readable = name => name && !/[{}_]/.test(name) && !/^(?:Item|Material)\s+\d+$/i.test(name);
    const name = readable(item.name) ? item.name : ItemTemplateIndex.find(invoke('GameServer/DataCache').items, item.selfId)?.template?.name;
    if (!readable(name)) return '';
    return `${Number(item.enchant || 0) > 0 ? `+${Number(item.enchant)} ` : ''}${String(name).replace(/\s+/g, ' ').trim()}`;
}

function offerText(store, source = {}) {
    if (!store) return '';
    const side = Number(store.storeType || 1) === 3 ? 'buy' : 'sell';
    const rawTown = store.town || source.currentRegion || '';
    const town = rawTown && !/[{}_]|\d/.test(rawTown) ? String(rawTown).slice(0, 30) : 'town';
    const templates = Speech.voices[`trade.${side}`];
    const overhead = Math.max(...templates.map(([, text]) => text.length - '{goods}'.length - '{town}'.length));
    const available = 120 - town.length - overhead;
    const lines = [];
    for (const item of store.items || []) {
        if (Number(item.count) <= 0) continue;
        const name = label(item), cost = price(item.price);
        if (!name || !cost) continue;
        const displayed = parseFloat(cost) * (cost.endsWith('kk') ? 1000000 : cost.endsWith('k') ? 1000 : 1);
        const suffix = ` - ${displayed !== Number(item.price) ? '~' : ''}${cost} each`;
        const full = `${name}${suffix}`;
        if (lines.length && [...lines, full].join(', ').length > available) break;
        const room = available - suffix.length;
        if (room < 8) continue;
        lines.push(full.length <= available ? full : `${name.slice(0, room - 3).trimEnd()}...${suffix}`);
        if (lines.length >= 2) break;
    }
    if (!lines.length) return '';
    return Voice.line(`trade.${side}`, source, { goods: lines.join(', '), town });
}

function afkOfferText(shop, line) {
    const name = label(line);
    if (!name) return '';
    const side = Number(shop.storeType) === 3 ? 'WTB' : 'WTS';
    const town = String(shop.town || 'town').replace(/[{}_]/g, '').slice(0, 30);
    const suffix = ` x${Number(line.count)} — ${Number(line.price).toLocaleString('en-US')} Adena ea, ${town}. PM me.`;
    const room = 120 - side.length - 1 - suffix.length;
    if (room < 8) return '';
    return `${side} ${name.length > room ? `${name.slice(0, room - 3).trimEnd()}...` : name}${suffix}`;
}

function ready(source, now = Date.now()) {
    return Config.marketTradeChatEnabled !== false && !Identity.isStaticService(source) && id(source) > 0 &&
        now >= nextGlobalAt && now - (history.get(id(source))?.at ?? -Infinity) >= Config.marketTradeChatIntervalMs;
}

function deliver(source, text, now = Date.now()) {
    if (!text || !ready(source, now)) return false;
    const audience = players();
    if (!audience.length) return false;
    const actor = source.actor || { fetchId: () => id(source), fetchName: () => source.name || 'Bot' };
    const packet = invoke('GameServer/Network/Response').speak(actor, { kind: 8, text: text.slice(0, 120) });
    let sent = false;
    for (const session of audience) {
        try { session.dataSendToMe(packet); sent = true; }
        catch (error) { utils.infoWarn('BotTradeChat', 'delivery failed: %s', error.message); }
    }
    if (!sent) return false;
    if (!history.has(id(source)) && history.size >= HISTORY_LIMIT) history.delete(history.keys().next().value);
    history.set(id(source), { at: now, text });
    nextGlobalAt = now + Config.marketTradeChatGlobalMinIntervalMs;
    lastDeliveryType = source.afkTradeAd ? 'afk' : 'merchant';
    return true;
}

function announceAfk(now) {
    if (now < nextAfkScanAt) return false;
    nextAfkScanAt = now + AFK_RECHECK_MS;
    const shops = invoke('GameServer/AfkTrade/AfkTradeService').activeShops();
    const preferredSide = afkAdsSent % 3 === 2 ? 3 : 1;
    const candidate = AfkTradeChatSelection.choose(shops, {
        now, lastItemAt, lastOwnerAt: history, lastTownAt, preferredSide
    });
    if (!candidate) return false;
    const { shop, line, type } = candidate;
    const source = { characterId: Number(shop.ownerId), name: shop.ownerName || 'Bot', afkTradeAd: true };
    const text = afkOfferText(shop, line);
    if (!deliver(source, text, now)) return false;
    const key = AfkTradeChatSelection.itemKey(type, line);
    if (!lastItemAt.has(key) && lastItemAt.size >= HISTORY_LIMIT) lastItemAt.delete(lastItemAt.keys().next().value);
    lastItemAt.set(key, now);
    lastTownAt.set(String(shop.town), now);
    afkAdsSent += 1;
    return true;
}

function freshSource(entry, now) {
    if (entry.source.actor) return entry.source;
    // Re-read the cache at delivery time: queued stock and prices can change,
    // and a cold merchant may have become a visible actor in the meantime.
    const current = invoke('GameServer/Bot/Population/BotLifeState').cachedState(id(entry.source));
    if (current?.phase === 'hot') return invoke('GameServer/Bot/BotManager').findSessionById(id(entry.source));
    return current || (now === entry.at ? entry.source : null);
}

function flush(now = Date.now(), immediate = false) {
    if (!immediate && now < nextFlushAt) return;
    nextFlushAt = now + 1000;
    if (Config.marketTradeChatEnabled === false) { pending.clear(); return; }
    if (now < nextGlobalAt) return;
    if (!players().length) return;
    // AFK shops share the existing global chat budget. Inspect their in-memory
    // projections only when a message slot opens, never on every bot tick.
    if (lastDeliveryType !== 'afk' && announceAfk(now)) return;
    for (const [characterId, entry] of pending) {
        const source = freshSource(entry, now);
        const current = source && snapshot(source, now);
        if (!current || current.key !== entry.key || now - entry.at >= PENDING_TTL_MS) { pending.delete(characterId); continue; }
        if (!ready(source, now)) continue;
        const text = offerText(current.store, source);
        pending.delete(characterId);
        if (deliver(source, text, now)) return;
    }
    if (lastDeliveryType === 'afk') announceAfk(now);
}

function offer(source, now = Date.now()) {
    if (Config.marketTradeChatEnabled === false) return { announced: false, reason: 'disabled' };
    const current = snapshot(source, now);
    if (!current) return { announced: false, reason: 'not_merchant' };
    const previousAt = history.get(id(source))?.at;
    flush(now);
    if (history.get(id(source))?.at !== previousAt) return { announced: true, text: history.get(id(source)).text };
    const lastAt = Math.max(history.get(id(source))?.at ?? -Infinity,
        Number(source.stats?.marketStore?.lastTradeAdAt || source.coldMarketState?.stats?.marketStore?.lastTradeAdAt || 0) || -Infinity);
    if (now - lastAt < Config.marketTradeChatIntervalMs) return { announced: false, reason: 'cooldown' };
    if (!players().length) return { announced: false, reason: 'no_audience' };
    if (!pending.has(id(source)) && pending.size >= MAX_PENDING) return { announced: false, reason: 'queue_full' };
    const existing = pending.get(id(source));
    // Repeated AI ticks must not keep an old announcement alive indefinitely.
    if (!existing || existing.key !== current.key) pending.set(id(source), { source, key: current.key, at: now });
    flush(now, true);
    const sent = history.get(id(source));
    return sent?.at === now ? { announced: true, text: sent.text } : { announced: false, reason: 'global_cooldown' };
}

function safe(fn) {
    return (...args) => {
        try { return fn(...args); }
        catch (error) { utils.infoWarn('BotTradeChat', 'ad skipped: %s', error.message); return { announced: false, reason: 'ad_error' }; }
    };
}

module.exports = { price, offerText, ready, deliver, offer: safe(offer), flush: safe(flush), MAX_PENDING, PENDING_TTL_MS,
    snapshot: () => ({ pending: pending.size, history: history.size, afkItemHistory: lastItemAt.size }),
    reset() { pending.clear(); history.clear(); lastItemAt.clear(); lastTownAt.clear();
        nextGlobalAt = 0; nextFlushAt = 0;
        nextAfkScanAt = 0;
        lastDeliveryType = null; afkAdsSent = 0; } };
