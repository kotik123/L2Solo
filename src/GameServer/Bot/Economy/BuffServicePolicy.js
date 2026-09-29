const Roles = invoke('GameServer/Bot/AI/BotRoles');
const Loadout = invoke('GameServer/Bot/AI/PartyBuffLoadout');
const Effects = invoke('GameServer/Effects/EffectStore');
const Rates = invoke('GameServer/ProgressionRates');

const EXCLUDED_CLASSES = new Set([21, 34, 49, 50, 51, 52]);
const REFRESH_MS = 2 * 60 * 1000;

function serviceClass(provider) {
    const classId = Roles.roleClassId(provider);
    return classId !== null && !EXCLUDED_CLASSES.has(classId)
        && ['buffer', 'healer'].includes(Roles.inferRole(provider));
}

function eligibleSkill(skill) {
    const semantic = skill?.fetchSemantic?.() || {};
    const effect = String(semantic.effect || '').toLowerCase();
    return semantic.effectType === 'buff'
        && (semantic.target || skill.fetchTargetKind?.()) === 'friendly'
        && effect && !effect.startsWith('song_of_') && !effect.startsWith('dance_of_')
        && !['kiss_of_eva', 'decrease_weight'].includes(effect);
}

function sameClan(provider, recipient) {
    const first = Number(provider?.fetchClanId?.() ?? provider?.stats?.clanId ?? 0);
    const second = Number(recipient?.fetchClanId?.() ?? recipient?.stats?.clanId ?? 0);
    return first > 0 && first === second;
}

function incomeForTenMinutes(provider) {
    const level = Math.max(1, Number(provider?.fetchLevel?.() ?? provider?.level ?? 1));
    // Approximate a solo support bot's ten-minute farm as six kills at
    // 25 Adena per level before applying the server's Adena rate.
    return Math.round(Math.max(20, level * 25) * 6 * Rates.profile().adena);
}

function priceFor({ provider, recipient, skills, town, trust = 0 }) {
    if (sameClan(provider, recipient)) return 0;
    const mp = skills.reduce((sum, skill) => sum + Math.max(0, Number(skill.fetchConsumedMp?.() || 0)), 0);
    const opportunity = incomeForTenMinutes(provider);
    const mpCost = Math.ceil(opportunity * Math.min(1, mp / Math.max(1, Number(provider?.fetchMaxMp?.() || provider?.vitals?.maxMp || 500))) * 0.22);
    const townPrice = Math.ceil(opportunity * 1.25 / 2 + mpCost);
    const base = town ? townPrice : Math.max(mpCost + skills.length * 8, Math.ceil(townPrice * 0.55));
    const relation = trust >= 8 ? 0.9 : trust >= 3 ? 0.96 : trust <= -5 ? 1.1 : 1;
    return Math.max(1, Math.ceil(base * relation));
}

function needsPaidBuff(recipient, skill) {
    const skillId = Number(skill.fetchSelfId());
    const effectKey = Loadout.normalize(skill.fetchSemantic?.()?.effect);
    const level = Number(skill.fetchLevel?.() || 1);
    const current = Effects.list(recipient).filter(effect => effect.type !== 'debuff'
        && (Number(effect.id) === skillId || Loadout.normalize(effect.key) === effectKey
            || Loadout.normalize(effect.category) === effectKey));
    if (current.some(effect => Number(effect.level || 0) > level)) return false;
    const durationMs = Number(skill.fetchBuffTime?.() ?? skill.fetchSemantic?.()?.durationMs ?? 0);
    const refreshMs = Number.isFinite(durationMs) && durationMs > 0
        ? Math.min(REFRESH_MS, Math.floor(durationMs * 0.25)) : REFRESH_MS;
    return !current.some(effect => Number(effect.level || 0) === level
        && Effects.remainingMs(recipient, effect.key) > refreshMs);
}

function hotSkills(provider, recipient) {
    if (!serviceClass(provider) || !recipient) return [];
    const Planner = invoke('GameServer/Bot/AI/BotSupportPlanner');
    const known = Planner.supportSkills(provider)
        .filter(eligibleSkill)
        .filter((skill) => Loadout.useful(recipient, skill))
        .filter((skill) => needsPaidBuff(recipient, skill))
        .filter((skill) => Planner.canPlanSupportAction(recipient, provider, skill, [{ actor: recipient, leader: true }]));
    const byFamily = new Map();
    known.forEach((skill) => {
        const family = Loadout.family(skill.fetchSemantic().effect);
        const previous = byFamily.get(family);
        if (!previous || Number(skill.fetchLevel?.() || 0) > Number(previous.fetchLevel?.() || 0)) byFamily.set(family, skill);
    });
    return [...byFamily.values()].sort((a, b) => Number(a.fetchSelfId()) - Number(b.fetchSelfId()));
}

module.exports = { EXCLUDED_CLASSES, REFRESH_MS, serviceClass, eligibleSkill, sameClan,
    incomeForTenMinutes, priceFor, needsPaidBuff, hotSkills };
