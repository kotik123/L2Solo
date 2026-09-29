const HennaService = invoke('GameServer/Henna/HennaService');

// Symbol Maker: opens the tattoo window with the class symbol list.
module.exports = function henna(session) {
    HennaService.sendHennaList(session);
};
