const Policy = invoke('GameServer/Bot/Economy/BuffServicePolicy');
const Roles = invoke('GameServer/Bot/AI/BotRoles');
const Town = invoke('GameServer/Bot/AI/TownPathfinder');
const TradeChat = invoke('GameServer/Bot/Economy/BotTradeChat');

const REPEAT_MS = 10 * 60 * 1000;
const SHIFT_MS = 10 * 60 * 1000;
const SHIFT_COOLDOWN_MS = 30 * 60 * 1000;
const lastAt = new Map();

function onDuty(session, timestamp = Date.now()) {
    const actor = session?.actor;
    if (!actor || !Policy.serviceClass(actor) || actor.isDead?.() || actor.state?.fetchCombats?.()
        || actor.state?.fetchCasts?.() || session.partyCompanion || session.hotBackgroundPartyId
        || session.activeTrade || session.chatArrivalActive || session.supplyErrandPhase
        || session.followPlayerSession || ['merchant', 'shopping', 'pk_hunting'].includes(session.plan)) return false;
    const town = Town.getTown({ locX: actor.fetchLocX(), locY: actor.fetchLocY(), locZ: actor.fetchLocZ() });
    if (!town) {
        session.buffServiceShiftUntil = 0;
        return false;
    }
    if (session.buffServiceShiftUntil && timestamp >= session.buffServiceShiftUntil) {
        session.buffServiceShiftUntil = 0;
        session.buffServiceNextShiftAt = timestamp + SHIFT_COOLDOWN_MS;
    }
    if (!session.buffServiceShiftUntil) {
        if (timestamp < Number(session.buffServiceNextShiftAt || 0)) return false;
        const skills = invoke('GameServer/Bot/AI/BotSupportPlanner').supportSkills(actor).filter(Policy.eligibleSkill);
        if (skills.length < 2) return false;
        session.buffServiceShiftUntil = timestamp + SHIFT_MS;
        actor.automation?.abortAll?.(actor);
    }
    return true;
}

function maybeAnnounce(session, timestamp = Date.now()) {
    if (!onDuty(session, timestamp)) return false;
    const actor = session.actor;
    const town = Town.getTown({ locX: actor.fetchLocX(), locY: actor.fetchLocY(), locZ: actor.fetchLocZ() });
    const id = Number(actor.fetchId());
    if (timestamp - (lastAt.get(id) || 0) < REPEAT_MS) return false;
    const skills = invoke('GameServer/Bot/AI/BotSupportPlanner').supportSkills(actor).filter(Policy.eligibleSkill);
    const price = Policy.priceFor({ provider: actor, recipient: { fetchClanId: () => 0 }, skills, town: true });
    const className = Roles.className(actor) || 'buffer';
    const text = `Lv${actor.fetchLevel()} ${className} buffs in ${town.name}: around ${price} Adena. Target me and type .buff; I open the trade.`;
    if (!TradeChat.deliver(session, text, timestamp)) return false;
    lastAt.set(id, timestamp);
    return true;
}

module.exports = { onDuty, maybeAnnounce };
