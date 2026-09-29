const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('../src/Global');

const Database      = invoke('Database');
const DataCache     = invoke('GameServer/DataCache');
const Shared        = invoke('GameServer/Network/Shared');
const gameAuthLogin = invoke('GameServer/Network/Request/AuthLogin');
const createNewChar = invoke('GameServer/Network/Request/CreateNewChar');

const CHAR_CREATE_FAIL = 0x1a;
const CREATION_FAILED  = 0x00;

// The latin-1 reading of the raw bytes a non-English keyboard layout puts into
// the login field, which is what the client hands over when it goes wrong.
const BAD_NAME = Buffer.from([0xe2, 0xfb, 0xf4, 0xe2, 0xf4, 0xfb]).toString('latin1');

const databasePath = path.join(process.cwd(), 'tmp', 'test-character-create-failure.sqlite');

fs.rmSync(databasePath, { force: true });
options.default.Database.path = path.relative(process.cwd(), databasePath);

Database.init();

// The spawn and class lookups run before the account check, so the request has
// something to work with until it reaches the part that fails.
DataCache.newbieSpawns = [{ classId: 0, spawns: [{ locX: 0, locY: 0, locZ: 0 }] }];
Shared.fetchClassInformation = () => Promise.resolve({ vitals: { maxHp: 100, maxMp: 50 } });

function newSession(accountId) {
    return {
        accountId,
        socket: { destroyed: false, destroy() { this.destroyed = true; } },
        responses: [],
        errors: [],
        error(error) {
            this.errors.push(error);
        },
        setAccountId(username) {
            this.accountId = username;
        },
        dataSendToMe(packet) {
            this.responses.push(packet);
        }
    };
}

function waitForResponse(session) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + 4000;
        const poll = () => {
            if (session.responses.length) return resolve(session.responses[0]);
            if (Date.now() > deadline) return reject(new Error('no server response'));
            return setTimeout(poll, 5);
        };
        return poll();
    });
}

function createCharPacket(name) {
    const parts = [Buffer.from([0x00]), Buffer.from(name, 'ucs2'), Buffer.alloc(2)];

    // Race, sex, classId and the stat block the client always zeroes out.
    for (let i = 0; i < 12; i++) parts.push(Buffer.alloc(4));
    return Buffer.concat(parts);
}

function loginPacket(username) {
    return Buffer.concat([
        Buffer.from([0x00]),
        Buffer.from(username, 'ucs2'),
        Buffer.alloc(2),
        Buffer.alloc(4),
        Buffer.alloc(4)
    ]);
}

// Nothing may crash the process on the way to the response.
process.on('unhandledRejection', (error) => {
    console.error('unhandled rejection:', error);
    process.exit(1);
});

(async () => {
    // The login server used to be able to store an account of nothing but bad
    // characters, after which creating a character threw with nobody handling
    // the rejection and the whole game server went down with it.
    const orphan = newSession(BAD_NAME);

    createNewChar(orphan, createCharPacket('CrashProbe'));

    const failed = await waitForResponse(orphan);
    assert.strictEqual(failed[0], CHAR_CREATE_FAIL, 'the client is told the character was not created');
    assert.strictEqual(failed.readUInt32LE(1), CREATION_FAILED, 'the client sees a plain creation failure');
    assert.deepStrictEqual(
        await Database.fetchCharacters(BAD_NAME),
        [],
        'no character may be left behind for an account that does not exist'
    );

    // The same bad name straight from the client never becomes a session.
    const badLogin = newSession(undefined);

    gameAuthLogin(badLogin, loginPacket(BAD_NAME));

    assert.strictEqual(badLogin.accountId, undefined, 'an unusable account name never opens a session');
    assert.strictEqual(badLogin.socket.destroyed, true, 'the connection carrying it is dropped');
    assert.strictEqual(badLogin.errors.length, 1, 'the drop is reported once');

    console.log('character creation failure handling ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
