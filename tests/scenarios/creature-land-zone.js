/**
 * Creature-land zone — lands that become creatures must have "Creature" in their type string.
 * Bug fixed: renderer.js was filtering creature-lands into lands zone only.
 *
 * This test verifies the server correctly returns the full type (e.g. "Land Creature - Forest")
 * after a land is animated by Badgermole Cub's earthbend ability.
 */
const h = require('../helpers');

module.exports = {
  name: 'Creature-land: earthbent land type includes "Creature"',

  async run(id) {
    let setup = false;
    let earthbendActivated = false;
    let targeted = false;

    await h.navigate(id, async (state, dec) => {
      if (dec.type === 'MULLIGAN' && !setup) {
        setup = true;
        await h.addCard(id, 'Badgermole Cub', 'battlefield', 0);
        await h.addCard(id, 'Forest', 'battlefield', 0);
        return { keep: true };
      }

      // Activate Badgermole Cub's earthbend ability (costs {G} + tap, but debug = free)
      if (dec.type === 'CHOOSE_ACTION'
          && state.phase === 'MAIN1'
          && state.priorityPlayer === 'Player 1'
          && !earthbendActivated) {
        const opts = dec.data?.options ?? [];
        // Earthbend ability description contains "Earthbend" or "becomes a" or "until end of turn"
        const opt = opts.find(o =>
          o.card === 'Badgermole Cub' &&
          o.description && (
            o.description.includes('Earthbend') ||
            o.description.includes('becomes') ||
            o.description.includes('Forest') ||
            o.description.toLowerCase().includes('creature')
          )
        );
        if (opt) { earthbendActivated = true; return { choice: opt.id }; }
      }

      // Choose target land for earthbend
      if (dec.type === 'CHOOSE_CARD' && earthbendActivated && !targeted) {
        targeted = true;
        const cards = dec.data?.cards ?? [];
        const forest = cards.find(c => c.name === 'Forest') ?? cards[0];
        if (!forest) throw new Error('No land to earthbend');
        return { cardIds: [forest.id] };
      }

      // After earthbend resolves, stop and check type
      if (earthbendActivated && targeted && dec.type === 'CHOOSE_ACTION') {
        throw new h.StopNavigation(state);
      }

      return null;
    });

    if (!earthbendActivated) throw new Error('Badgermole Cub earthbend ability not found in CHOOSE_ACTION options');
    if (!targeted) throw new Error('Never got CHOOSE_CARD for earthbend target');

    const fresh = await h.getState(id);
    h.assertCardTypeContains(fresh, 0, 'Forest', 'Creature');
  },
};
