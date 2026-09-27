const HennaService = invoke('GameServer/Henna/HennaService');
const ReceivePacket = invoke('Packet/Receive');

function hennaItemInfo(session, buffer) {
    const packet = new ReceivePacket(buffer);
    packet.readD();
    HennaService.sendHennaItemInfo(session, packet.data[0]);
}

module.exports = hennaItemInfo;
