(function (root, factory) {
  const cardsApi = typeof module === 'object' && module.exports
    ? require('./cards.js')
    : root.MemoryPokerCards;
  const api = factory(cardsApi);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.MemoryPokerAI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Cards) {
  'use strict';

  const DIFFICULTIES = {
    easy: { id: 'easy', label: '쉬움', memory: 0.2 },
    normal: { id: 'normal', label: '보통', memory: 0.55 },
    hard: { id: 'hard', label: '어려움', memory: 0.9 },
  };

  function memoryRate(difficulty) {
    if (typeof difficulty === 'number') return difficulty;
    const entry = DIFFICULTIES[difficulty];
    if (!entry) throw new Error('Unknown difficulty: ' + difficulty);
    return entry.memory;
  }

  // Remember each grid card independently. Play the best pair among the
  // remembered cards with the 3 community cards. If fewer than two cards
  // were remembered, fill the remaining picks by guessing forgotten slots.
  function choose(grid, community, difficulty, rng) {
    if (!grid || grid.length !== 16) throw new Error('grid must be 16 cards');
    if (!community || community.length !== 3) throw new Error('community must be 3 cards');
    const random = rng || Math.random;
    const rate = memoryRate(difficulty);
    const remembered = [];
    for (let i = 0; i < grid.length; i++) {
      if (random() < rate) remembered.push(i);
    }
    if (remembered.length >= 2) return bestPair(grid, community, remembered, random);

    const picks = remembered.slice();
    const forgotten = [];
    for (let i = 0; i < grid.length; i++) {
      if (remembered.indexOf(i) === -1) forgotten.push(i);
    }
    while (picks.length < 2) {
      const index = Math.floor(random() * forgotten.length);
      picks.push(forgotten.splice(index, 1)[0]);
    }
    picks.sort(function (a, b) { return a - b; });
    return picks;
  }

  function bestPair(grid, community, indices, random) {
    let best = null;
    const ties = [];
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        const pair = [indices[a], indices[b]];
        const hand = Cards.evaluate([
          grid[pair[0]],
          grid[pair[1]],
          community[0],
          community[1],
          community[2],
        ]);
        if (!best || Cards.compareEvaluated(hand, best) > 0) {
          best = hand;
          ties.length = 0;
          ties.push(pair);
        } else if (Cards.compareEvaluated(hand, best) === 0) {
          ties.push(pair);
        }
      }
    }
    const picked = ties[Math.floor(random() * ties.length)];
    return [picked[0], picked[1]].sort(function (a, b) { return a - b; });
  }

  return {
    DIFFICULTIES: DIFFICULTIES,
    choose: choose,
  };
});
