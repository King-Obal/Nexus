/**
 * City of Traitors — tap produces 2 colorless mana.
 * Bug fixed: was returning 0 due to MagicColor.COLORLESS vs ManaAtom.COLORLESS mismatch.
 */
const h = require('../helpers');

module.exports = {
  name: 'City of Traitors: tap produces {C}{C}',

  async run(id) {
    let setup = false;
    let activated = false;

    await h.navigate(id, async (state, dec) => {
      // During mulligan: add City of Traitors to battlefield
      if (dec.type === 'MULLIGAN' && !setup) {
        setup = true;
        await h.addCard(id, 'City of Traitors', 'battlefield', 0);
        return { keep: true };
      }

      // In our main phase: activate City of Traitors mana ability
      if (dec.type === 'CHOOSE_ACTION'
          && state.phase === 'MAIN1'
          && state.priorityPlayer === 'Player 1'
          && !activated) {
        const opts = dec.data?.options ?? [];
        const opt = h.findManaOption(opts, 'City of Traitors');
        if (opt) {
          activated = true;
          return { choice: opt.id };
        }
      }

      // After activating: stop and check mana pool
      if (activated && dec.type === 'CHOOSE_ACTION') {
        throw new h.StopNavigation(state);
      }

      return null; // auto-handle
    });

    if (!activated) throw new Error('Never found City of Traitors mana ability in CHOOSE_ACTION options');

    const fresh = await h.getState(id);
    h.assertMana(fresh, 0, { C: 2 });
  },
};
