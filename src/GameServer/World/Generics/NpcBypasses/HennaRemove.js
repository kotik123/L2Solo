const ServerResponse = invoke('GameServer/Network/Response');
const HennaService = invoke('GameServer/Henna/HennaService');
const HtmlKit = invoke('GameServer/World/Generics/HtmlKit');

function statLine(symbol) {
    const labels = { STR: 'STR', DEX: 'DEX', CON: 'CON', INT: 'INT', WIT: 'WIT', MEN: 'MEN' };
    return HennaService.STAT_KEYS
        .filter((stat) => symbol[stat])
        .map((stat) => `${symbol[stat] > 0 ? '+' : ''}${symbol[stat]} ${labels[stat]}`)
        .join(', ');
}

function renderRemoveList(session) {
    const hennas = HennaService.fetchRemoveList(session);

    const rows = hennas.length
        ? hennas.map((entry) => {
            const symbol = HennaService.symbol(entry.symbolId);
            return `<tr><td width=270><a action="bypass -h henna-remove ${entry.slot}" color="${HtmlKit.COLOR.link}">Slot ${entry.slot}: ${entry.name}</a></td></tr>` +
                `<tr><td width=270><font color="${HtmlKit.COLOR.muted}">${statLine(symbol)}</font></td></tr>`;
        }).join('')
        : `<tr><td width=270><font color="${HtmlKit.COLOR.muted}">You have no tattoos drawn.</font></td></tr>`;

    const html = `<html><body><table width=280>
<tr><td width=270>Tattoos to remove:<br></td></tr>${rows}
</table></body></html>`;

    session.dataSendToMe(ServerResponse.npcHtml(session.actor.fetchId(), html));
}

// Symbol Maker: `henna-remove` lists drawn symbols, `henna-remove <slot>` erases
// one and returns half of its dye, matching the reference Symbol Maker flow.
module.exports = function hennaRemove(session, parts = []) {
    const slot = Number(parts[1]);
    if (slot >= 1 && slot <= HennaService.SLOT_COUNT) {
        HennaService.removeSymbol(session, slot);
        renderRemoveList(session);
        return;
    }
    renderRemoveList(session);
};
