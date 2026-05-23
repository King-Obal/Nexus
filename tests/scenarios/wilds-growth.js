/**
 * Wilds Growth (Bloomburrow) — enchanted land produces 1 extra green mana.
 * Card file was missing; created forge-gui/res/cardsfolder/w/wilds_growth.txt.
 */
const h = require('../helpers');

module.exports = {
  name: 'Wilds Growth: enchanted Forest produces {G}{G}',

  async run(id) {
    let setup = false;
    let casted = false;
    let targeted = false;
    let activated = false;

    await h.navigate(id, async (state, dec) => {
      if (dec.type === 'MULLIGAN' && !setup) {
        setup = true;
        await h.addCard(id, 'Forest', 'battlefield', 0);
        await h.addCard(id, 'Wilds Growth', 'hand', 0);
        return { keep: true };
      }

      if (dec.type === 'CHOOSE_ACTION'
          && state.phase === 'MAIN1'
          && state.priorityPlayer === 'Player 1'
          && !casted && !targeted) {
        const opt = h.findCardOption(dec.data?.options ?? [], 'Wilds Growth');
        if (opt) { casted = true; return { choice: opt.id }; }
      }

      if (dec.type === 'CHOOSE_CARD' && casted && !targeted) {
        targeted = true;
        const cards = dec.data?.cards ?? [];
        const target = cards.find(c => c.name === 'Forest') ?? cards[0];
        if (!target) throw new Error('No land to target with Wilds Growth');
        return { cardIds: [target.id] };
      }

      if (dec.type === 'CHOOSE_ACTION'
          && state.phase === 'MAIN1'
          && state.priorityPlayer === 'Player 1'
          && targeted && !activated) {
        const opt = h.findManaOption(dec.data?.options ?? [], 'Forest');
        if (opt) { activated = true; return { choice: opt.id }; }
      }

      if (activated && dec.type === 'CHOOSE_ACTION') {
        throw new h.StopNavigation(state);
      }

      return null;
    });

    if (!activated) throw new Error('Never activated Forest mana after casting Wilds Growth');

    const fresh = await h.getState(id);
    h.assertMana(fresh, 0, { G: 2 });
  },
};
