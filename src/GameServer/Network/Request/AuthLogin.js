const Shared         = invoke('GameServer/Network/Shared');
const ReceivePacket  = invoke('Packet/Receive');
const AccountName    = invoke('AccountName');

function authLogin(session, buffer) {
    const packet = new ReceivePacket(buffer);

    packet
        .readS()  // Username
        .readD()  // Session Key (last)
        .readD(); // Session Key (first)

    const username = AccountName.resolve(packet.data[0]);

    // The client may hand over the same garbage the login server refused to
    // accept. An unusable name has no account, so drop the connection.
    if (!username) {
        return dropSession(session, new Error(
            `unusable account name in login packet: ${JSON.stringify(packet.data[0])}`
        ));
    }

    consume(session, {
        username: username,
        key2: packet.data[1],
        key1: packet.data[2],
    });
}

function consume(session, data) { // TODO: Need to match the Session Keys
    session.setAccountId(data.username);

    Shared.fetchCharacters(session.accountId).then((characters) => {
        Shared.enterCharacterHall(session, characters);
    }).catch((error) => dropSession(session, error));
}

function dropSession(session, error) {
    session.error(error);
    session.socket.destroy();
}

module.exports = authLogin;
