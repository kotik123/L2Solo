const SendPacket = invoke('Packet/Send');

const byte = (value) => value & 0xff;

// C4: henna summary of the drawn symbols (opcode 0xE4).
// Stat totals are signed bytes in the reference INT, STR, CON, MEN, DEX, WIT order.
function hennaInfo(session) {
    const totals = session.actor.hennaStats || {};
    const drawn = (Array.isArray(session.hennas) ? session.hennas : []).filter(Boolean);

    const packet = new SendPacket(0xe4);

    packet
        .writeC(byte(totals.INT || 0))
        .writeC(byte(totals.STR || 0))
        .writeC(byte(totals.CON || 0))
        .writeC(byte(totals.MEN || 0))
        .writeC(byte(totals.DEX || 0))
        .writeC(byte(totals.WIT || 0))
        .writeD(3)
        .writeD(drawn.length);

    for (const symbolId of drawn) {
        packet.writeD(symbolId).writeD(symbolId);
    }

    return packet.fetchBuffer();
}

module.exports = hennaInfo;
