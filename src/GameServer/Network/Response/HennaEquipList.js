const SendPacket = invoke('Packet/Send');

// C4: server answer to a henna window request (opcode 0xE2).
// Symbols the player has no dye for are still listed, but written as empty rows.
function hennaEquipList(adena, hennas) {
    const packet = new SendPacket(0xe2);

    packet
        .writeD(Number(adena) || 0)
        .writeD(3)
        .writeD(hennas.length);

    for (const henna of hennas) {
        if (henna.owned) {
            packet
                .writeD(henna.symbolId)
                .writeD(henna.dyeSelfId)
                .writeD(henna.dyeAmount)
                .writeD(henna.price)
                .writeD(1);
        }
        else {
            packet.writeD(0).writeD(0).writeD(0).writeD(0).writeD(0);
        }
    }

    return packet.fetchBuffer();
}

module.exports = hennaEquipList;
