const ServerResponse = invoke('AuthenticationServer/Network/Response');
const ReceivePacket  = invoke('Packet/Receive');
const Database       = invoke('Database');
const AccountName    = invoke('AccountName');

function authLogin(session, buffer) {
    const packet = new ReceivePacket(buffer);

    packet
        .readB(128) // Enciphered Block
        .readD();   // Session ID

    const deciphered = require('rsa-raw').decipher(
        packet.data[0]
    );

    const username = AccountName.resolve(
        utils.stripNull(deciphered.slice(0x62, 0x62 + 14))
    );

    // A client started with a non-English keyboard layout leaks cp1251 bytes into
    // the login block. Keep it out instead of creating an account nobody can
    // type back, and never guess: a trimmed name may belong to somebody else.
    if (!username) {
        return failure(session, 0x03);
    }

    consume(session, {
        username: username,
        password: utils.stripNull(deciphered.slice(0x70, 0x70 + 16)).trim(),
        sessionId: packet.data[1],
    });
}

function consume(session, data) {
    Database.fetchUserPassword(data.username).then((rows) => {
        const account = rows[0];
        const password = account?.password;

        // Username exists in database
        if (password) {
            data.password === password ? passwordMatch(session, account.username) : failure(session, 0x02);
        }
        else { // User account does not exist, create if needed
            const optn = options.default.AuthServer;

            if (optn.autoCreate) {
                return Database.createAccount(data.username, data.password).then(() => {
                    return consume(session, data);
                });
            }
            else { // Auto-create not permitted
                failure(session, 0x04);
            }
        }
    }).catch((error) => {
        utils.infoWarn('AuthServer', 'login request failed: %s', error.message);
        failure(session, 0x01);
    });
}

function passwordMatch(session, username) {
    session.setAccountId(username);
    session.dataSend(ServerResponse.loginSuccess(session));
}

function failure(session, reason) {
    session.dataSend(ServerResponse.loginFail(reason));
}

module.exports = authLogin;
