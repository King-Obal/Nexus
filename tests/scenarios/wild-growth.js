/**
 * Wild Growth — enchanted land produces 1 extra green mana.
 * Tests the TapsForMana static trigger chain via PlayerControllerApi.playTrigger.
 */
const h = require('../helpers');

module.exports = {
  name: 'Wild Growth: enchanted Forest produces {G}{G}',

  async run(id) {
    let setup = false;
    let casted = false;
    let targeted = false;
    let activated = false;
    let forestId = null;

    await h.navigate(id, async (state, dec) => {
      // During mulligan: add Forest to battlefield + Wild Growth to hand
      if (dec.type === 'MULLIGAN' && !setup) {
        setup = true;
        await h.addCard(id, 'Forest', 'battlefield', 0);
        await h.addCard(id, 'Wild Growth', 'hand', 0);
        // Capture Forest ID for targeting
        return { keep: true };
      }

      // In main phase: cast Wild Growth from hand
      if (dec.type === 'CHOOSE_ACTION'
          && state.phase === 'MAIN1'
          && state.priorityPlayer === 'Player 1'
          && !casted && !targeted) {
        const opts = dec.data?.options ?? [];
        const opt = h.findCardOption(opts, 'Wild Growth');
        if (opt) {
          casted = true;
          return { choice: opt.id };
        }
      }

      // Target selection for Wild Growth (choose the Forest)
      if (dec.type === 'CHOOSE_CARD' && casted && !targeted) {
        targeted = true;
        const cards = dec.data?.cards ?? [];
        // Find the Forest (or just pick first land)
        const forest = cards.find(c => c.name === 'Forest') ?? cards[0];
        if (!forest) throw new Error('No land available to target with Wild Growth');
        forestId = forest.id;
        return { cardIds: [forest.id] };
      }

      // After Wild Growth resolves, tap the enchanted Forest
      if (dec.type === 'CHOOSE_ACTION'
          && state.phase === 'MAIN1'
          && state.priorityPlayer === 'Player 1'
          && targeted && !activated) {
        const opts = dec.data?.options ?? [];
        const opt = h.findManaOption(opts, 'Forest');
        if (opt) {
          // Verify Forest is on battlefield (enchanted)
          const bf = state.players[0]?.battlefield ?? [];
          const forest = bf.find(c => c.name === 'Forest');
          if (!forest) throw new Error('Forest not found on battlefield after casting Wild Growth');
          activated = true;
          return { choice: opt.id };
        }
      }

      // After tapping: stop
      if (activated && dec.type === 'CHOOSE_ACTION') {
        throw new h.StopNavigation(state);
      }

      return null;
    });

    if (!casted)    throw new Error('Wild Growth was never available to cast in CHOOSE_ACTION');
    if (!targeted)  throw new Error('Never got CHOOSE_CARD decision for Wild Growth target');
    if (!activated) throw new Error('Never found Forest mana ability after casting Wild Growth');

    const fresh = await h.getState(id);
    h.assertMana(fresh, 0, { G: 2 });
  },
};
