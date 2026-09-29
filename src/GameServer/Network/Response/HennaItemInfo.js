const SendPacket = invoke('Packet/Send');

const byte = (value) => value & 0xff;

// C4: preview of one henna symbol with projected stats (opcode 0xE3).
// Written in the reference INT, STR, CON, MEN, DEX, WIT order.
function hennaItemInfo(actor, symbol, adena) {
    const packet = new SendPacket(0xe3);

    packet
        .writeD(symbol.id)
        .writeD(symbol.dyeSelfId)
        .writeD(symbol.dyeAmount)
        .writeD(symbol.price)
        .writeD(1)
        .writeD(Number(adena) || 0);

    const preview = [
        [actor.fetchInt(), symbol.INT],
        [actor.fetchStr(), symbol.STR],
        [actor.fetchCon(), symbol.CON],
        [actor.fetchMen(), symbol.MEN],
        [actor.fetchDex(), symbol.DEX],
        [actor.fetchWit(), symbol.WIT]
    ];
    for (const [current, delta] of preview) {
        packet.writeD(current).writeC(byte((current || 0) + (delta || 0)));
    }

    return packet.fetchBuffer();
}

module.exports = hennaItemInfo;
