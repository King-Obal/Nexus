/**
 * Utopia Sprawl — enchanted land produces 1 extra mana of chosen color.
 * Bug fixed: chooseColors() was returning all colors; now asks player interactively.
 */
const h = require('../helpers');

const CHOSEN_COLOR = 'Red'; // What we'll choose

module.exports = {
  name: `Utopia Sprawl: choose ${CHOSEN_COLOR}, enchanted Forest produces {G}{R}`,

  async run(id) {
    let setup = false;
    let casted = false;
    let colorChosen = false;
    let targeted = false;
    let activated = false;

    await h.navigate(id, async (state, dec) => {
      if (dec.type === 'MULLIGAN' && !setup) {
        setup = true;
        await h.addCard(id, 'Forest', 'battlefield', 0);
        await h.addCard(id, 'Utopia Sprawl', 'hand', 0);
        return { keep: true };
      }

      if (dec.type === 'CHOOSE_ACTION'
          && state.phase === 'MAIN1'
          && state.priorityPlayer === 'Player 1'
          && !casted) {
        const opt = h.findCardOption(dec.data?.options ?? [], 'Utopia Sprawl');
        if (opt) { casted = true; return { choice: opt.id }; }
      }

      // Utopia Sprawl asks for a color BEFORE or AFTER target selection
      // (Forge asks for the color when the ability resolves, after targeting)
      if (dec.type === 'CHOOSE_CARD' && casted && !targeted) {
        targeted = true;
        const cards = dec.data?.cards ?? [];
        const target = cards.find(c => c.name === 'Forest') ?? cards[0];
        if (!target) throw new Error('No land to target with Utopia Sprawl');
        return { cardIds: [target.id] };
      }

      if (dec.type === 'CHOOSE_COLOR' && casted && !colorChosen) {
        colorChosen = true;
        return { color: CHOSEN_COLOR };
      }

      if (dec.type === 'CHOOSE_ACTION'
          && state.phase === 'MAIN1'
          && state.priorityPlayer === 'Player 1'
          && (targeted || colorChosen) && !activated) {
        const opt = h.findManaOption(dec.data?.options ?? [], 'Forest');
        if (opt) { activated = true; return { choice: opt.id }; }
      }

      if (activated && dec.type === 'CHOOSE_ACTION') {
        throw new h.StopNavigation(state);
      }

      return null;
    });

    if (!activated) throw new Error('Never activated Forest mana after casting Utopia Sprawl');

    const fresh = await h.getState(id);
    // Should produce G (base) + R (chosen color via Utopia Sprawl trigger)
    h.assertMana(fresh, 0, { G: 1, R: 1 });

    // Also assert NOT producing all colors (that was the bug)
    const pool = fresh.players[0]?.manaPool ?? {};
    const totalMana = (pool.W ?? 0) + (pool.U ?? 0) + (pool.B ?? 0) + (pool.G ?? 0) + (pool.R ?? 0) + (pool.C ?? 0);
    h.assert(totalMana === 2, `Expected exactly 2 mana total, got ${totalMana} (pool: ${JSON.stringify(pool)})`);
  },
};
