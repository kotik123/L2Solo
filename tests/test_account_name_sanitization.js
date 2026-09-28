const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('../src/Global');

const Database    = invoke('Database');
const AccountName = invoke('AccountName');
const authLogin   = invoke('AuthenticationServer/Network/Request/AuthLogin');

const RSA = require('rsa-raw');

// A non-English keyboard layout puts these raw bytes into the login field, and
// the client sends them straight through the 14-byte block.
const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');

const STRAY_BYTE_LOGIN = Buffer.from([0xf4, 0x74, 0x65, 0x73, 0x74, 0x31]); // one bad byte, then `test1`
const BAD_BYTES_LOGIN  = Buffer.from([0xe2, 0xfb, 0xf4, 0xe2, 0xf4, 0xfb]); // nothing but bad bytes

const LOGIN_SUCCESS = 0x03; // the client shows the server list
const LOGIN_FAIL    = 0x01; // the client shows an error, the reason follows
const BAD_LOGIN     = 0x03; // USER_OR_PASS_WRONG

const databasePath = path.join(process.cwd(), 'tmp', 'test-account-name-sanitization.sqlite');

fs.rmSync(databasePath, { force: true });
options.default.Database.path = path.relative(process.cwd(), databasePath);
options.default.AuthServer.autoCreate = 'true';

Database.init();

function loginPacket(login, password) {
    const block = Buffer.alloc(128, 0x20); // the client fills the unused block with spaces
    Buffer.from(login).copy(block, 0x62, 0, Math.min(login.length, 14));
    Buffer.from(password).copy(block, 0x70, 0, Math.min(password.length, 16));

    // `node-forge` only takes a raw byte string here, which is what the client
    // hands over once it has enciphered the block on its own.
    const enciphered = Buffer.from(RSA.encipher(block.toString('latin1')), 'latin1');
    const packet     = Buffer.alloc(1 + enciphered.length + 4);

    packet[0] = 0x00; // RequestAuthLogin
    enciphered.copy(packet, 1);
    return packet;
}

function newSession() {
    return {
        key1: 0x11111111,
        key2: 0x22222222,
        responses: [],
        setAccountId(username) {
            this.accountId = username;
        },
        dataSend(packet) {
            this.responses.push(packet);
        }
    };
}

// The login server answers asynchronously, the response is the first packet out.
function login(login, password = 'secret') {
    const session = newSession();

    authLogin(session, loginPacket(login, password));

    return new Promise((resolve, reject) => {
        const deadline = Date.now() + 4000;
        const poll = () => {
            if (session.responses.length) {
                const response = session.responses[0];
                return resolve({
                    opcode: response[0],
                    reason: response.readUInt32LE(1),
                    accountId: session.accountId
                });
            }
            if (Date.now() > deadline) return reject(new Error('no login response'));
            return setTimeout(poll, 5);
        };
        return poll();
    });
}

(async () => {
    assert.strictEqual(AccountName.resolve('test1'), 'test1', 'a plain login stays as it is');
    assert.strictEqual(AccountName.resolve('test_1'), 'test_1', 'underscores stay, generated bot accounts use them');
    assert.strictEqual(AccountName.resolve(latin1([0xf4, 0x74, 0x65, 0x73, 0x74, 0x31])), 'test1', 'bad characters in front of a login are dropped');
    assert.strictEqual(AccountName.resolve(latin1([0xe2, 0xfb, 0xf4, 0xe2, 0xf4, 0xfb])), '', 'a login of nothing but bad characters resolves to nothing');
    assert.strictEqual(AccountName.resolve('abcdefghijklmnop'), '', 'an overlong login is refused, never truncated into somebody else\'s account');
    assert.strictEqual(utils.stripNull(Buffer.from([0xf4, 0x74, 0x65, 0x73, 0x74])), latin1([0xf4, 0x74, 0x65, 0x73, 0x74]), 'raw block bytes stay readable for the login filter');

    // `test1` logs in first, autoCreate writes the account.
    const first = await login(Buffer.from('test1'));
    assert.strictEqual(first.opcode, LOGIN_SUCCESS, 'a plain login must succeed');
    assert.strictEqual(first.accountId, 'test1', 'the account is the login the player typed');

    // The first bug of the issue: one stray byte in front of the login used to
    // create a second, empty account the player never intended to use.
    const strayByte = await login(STRAY_BYTE_LOGIN);
    assert.strictEqual(strayByte.opcode, LOGIN_SUCCESS, 'the stray byte is dropped and the real account is reached');
    assert.strictEqual(strayByte.accountId, 'test1', 'the login carrying the stray byte lands on the same account');

    // The second bug: a login of nothing but bad characters used to be created,
    // and the character creation that followed took the server down.
    const badBytes = await login(BAD_BYTES_LOGIN);
    assert.strictEqual(badBytes.opcode, LOGIN_FAIL, 'a login of nothing but bad characters is refused');
    assert.strictEqual(badBytes.reason, BAD_LOGIN, 'the client is told the login itself is unusable');
    assert.strictEqual(badBytes.accountId, undefined, 'a refused login must not be attached to the session');
    assert.deepStrictEqual(
        await Database.fetchUserPassword(latin1(BAD_BYTES_LOGIN)),
        [],
        'a refused login must never be written to the accounts table'
    );

    console.log('account name sanitization ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
