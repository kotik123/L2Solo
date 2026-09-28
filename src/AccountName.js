// The login field is a fixed-size ASCII block on the wire. A client started with
// a non-English keyboard layout can leak cp1251 bytes into that block, so every
// character outside this set is dropped before it can reach the accounts table.
const BAD_CHARACTERS = /[^A-Za-z0-9_]/g;

// Size of the login block the client sends to the login server.
const MAX_LENGTH = 14;

module.exports = {
    MAX_LENGTH,

    // Returns the account name the server may actually use, or '' when the
    // client sent something unusable. Never truncated: a shortened name could
    // silently match somebody else's account.
    resolve(value) {
        const username = String(value ?? '').replace(BAD_CHARACTERS, '');
        return username.length > MAX_LENGTH ? '' : username;
    }
};
