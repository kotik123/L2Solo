const HennaService = invoke('GameServer/Henna/HennaService');

function hennaList(session) {
    HennaService.sendHennaList(session);
}

module.exports = hennaList;
