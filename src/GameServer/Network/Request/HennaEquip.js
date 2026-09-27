const HennaService = invoke('GameServer/Henna/HennaService');
const ReceivePacket = invoke('Packet/Receive');

function hennaEquip(session, buffer) {
    const packet = new ReceivePacket(buffer);
    packet.readD();
    HennaService.drawSymbol(session, packet.data[0]);
}

module.exports = hennaEquip;
