const assert = require('assert');
require('../src/Global');

const Npc = invoke('GameServer/Npc/Npc');
const receivedHit = invoke('GameServer/Npc/Generics/ReceivedHit');
const World = invoke('GameServer/World/World');
const ActorGenerics = invoke('GameServer/Actor/Generics');

World.npc = { grid: {} };
World.removeNpc = () => {};
ActorGenerics.npcDied = () => {};

const templates = require('../data/Npcs/npcs.json');
const actor = {
    fetchId: () => 2000001,
    fetchLevel: () => 40,
    fetchIsOnline: () => true,
    isDead: () => false,
    state: { fetchDead: () => false, setCombats: () => {} },
    automation: { abortAll: () => {} }
};
const session = { actor, dataSendToMeAndOthers: () => {}, dataSendToMe: () => {} };

function create(kind, extra = {}) {
    const row = templates.find(value => value.template.kind === kind);
    assert(row, `missing ${kind} template`);
    const data = { selfId: row.selfId, locX: 0, locY: 0, locZ: 0, head: 0 };
    for (const value of Object.values(row)) {
        if (value && typeof value === 'object') Object.assign(data, value);
    }
    const npc = new Npc(900001, { ...data, ...extra });
    npc.broadcastVitals = () => {};
    npc.automation.replenishVitals = () => {};
    return npc;
}

// The reported bug: a bow hunter killed the Gludio Warehouse Keeper. Town
// staff must soak unlimited damage, stop at 1 HP, and never reach a corpse.
for (const kind of ['Citizen', 'Merchant', 'Teleporter', 'Trainer', 'Blacksmith', 'Chamberlain',
    'Guild Coach', 'Guild Master', 'Thing', 'Holything', 'Castle Gate']) {
    const npc = create(kind);
    try {
        assert.strictEqual(npc.fetchIsKillable(), false, `${kind}: must be immortal`);
        assert.strictEqual(npc.fetchImmortalMinHp(), 1, `${kind}: HP floor must be 1`);
        for (const damage of [10, 0, npc.fetchMaxHp() * 3]) {
            receivedHit(session, actor, npc, damage);
        }
        assert.strictEqual(npc.fetchHp(), 1, `${kind}: lethal damage must clamp at 1 HP`);
        assert.strictEqual(npc.state.fetchDead(), false, `${kind}: must not be dead`);

        // No other code path may bypass the damage clamp either.
        npc.setHp(1);
        invoke('GameServer/Npc/Generics/Die')(session, actor, npc);
        assert.strictEqual(npc.state.fetchDead(), false, `${kind}: direct die() must be refused`);
    } finally {
        npc.destructor(session);
    }
}

// Guards fight back and can be killed; monsters and summons keep dying.
for (const kind of ['Guard', 'Monster', 'Summon']) {
    const npc = create(kind);
    try {
        assert.strictEqual(npc.fetchIsKillable(), true, `${kind}: must stay killable`);
        assert.strictEqual(npc.fetchImmortalMinHp(), 0, `${kind}: HP floor must be 0`);
        npc.setHp(5);
        receivedHit(session, actor, npc, 10);
        assert.strictEqual(npc.fetchHp(), 0, `${kind}: lethal damage must reach 0 HP`);
        assert.strictEqual(npc.state.fetchDead(), true, `${kind}: must die`);
    } finally {
        npc.destructor(session);
    }
}

// Name-detached town guards (the TOWN_GUARD_NAME regex path in TownGuard)
// stay killable even under a non-Guard template kind.
const namedGuard = create('Citizen', { name: 'Gludio Castle Town Guard' });
try {
    assert.strictEqual(namedGuard.fetchIsKillable(), true, 'named guard must stay killable');
} finally {
    namedGuard.destructor(session);
}

// Damage-over-time ticks run through the same ReceivedHit pipeline, so a
// lethal poison tick must clamp an immortal NPC at 1 HP as well.
const poisoned = create('Citizen');
try {
    poisoned.setHp(2);
    receivedHit(session, actor, poisoned, 5, { wakeSleep: false });
    assert.strictEqual(poisoned.fetchHp(), 1, 'DoT damage must clamp at 1 HP');
    assert.strictEqual(poisoned.state.fetchDead(), false, 'DoT must not kill');
} finally {
    poisoned.destructor(session);
}

console.log('Town NPC immortality checks passed');
