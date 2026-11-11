(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.MemoryPokerCards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SUITS = {
    s: { id: 's', symbol: '♠', color: 'black', name: '스페이드' },
    h: { id: 'h', symbol: '♥', color: 'red', name: '하트' },
    d: { id: 'd', symbol: '♦', color: 'red', name: '다이아몬드' },
    c: { id: 'c', symbol: '♣', color: 'black', name: '클럽' },
  };

  const SUIT_IDS = ['s', 'h', 'd', 'c'];

  const HAND_NAMES = [
    '하이카드',
    '원페어',
    '투페어',
    '트리플',
    '스트레이트',
    '플러시',
    '풀하우스',
    '포카드',
    '스트레이트 플러시',
    '로열 스트레이트 플러시',
  ];

  const SPOKEN_RANKS = { 14: '에이스', 13: '킹', 12: '퀸', 11: '잭' };

  function rankLabel(rank) {
    if (rank === 14) return 'A';
    if (rank === 13) return 'K';
    if (rank === 12) return 'Q';
    if (rank === 11) return 'J';
    return String(rank);
  }

  function cardName(card) {
    const spoken = SPOKEN_RANKS[card.rank] || String(card.rank);
    return SUITS[card.suit].name + ' ' + spoken;
  }

  function cardText(card) {
    return rankLabel(card.rank) + SUITS[card.suit].symbol;
  }

  function createDeck() {
    const deck = [];
    for (let s = 0; s < SUIT_IDS.length; s++) {
      for (let rank = 2; rank <= 14; rank++) {
        deck.push({ suit: SUIT_IDS[s], rank: rank });
      }
    }
    return deck;
  }

  function shuffle(deck, rng) {
    const random = rng || Math.random;
    const next = deck.slice();
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const tmp = next[i];
      next[i] = next[j];
      next[j] = tmp;
    }
    return next;
  }

  function deal(rng) {
    const deck = shuffle(createDeck(), rng);
    return {
      grid: deck.slice(0, 16),
      community: deck.slice(16, 19),
    };
  }

  function straightHigh(ranksDesc) {
    const unique = [];
    for (let i = 0; i < ranksDesc.length; i++) {
      if (unique.indexOf(ranksDesc[i]) === -1) unique.push(ranksDesc[i]);
    }
    if (unique.length !== 5) return null;
    unique.sort(function (a, b) { return a - b; });
    // Ace plays low in A-2-3-4-5, the lowest straight. It does not wrap the other way.
    if (unique[0] === 2 && unique[1] === 3 && unique[2] === 4 && unique[3] === 5 && unique[4] === 14) {
      return 5;
    }
    if (unique[4] - unique[0] === 4) return unique[4];
    return null;
  }

  function rankGroups(ranks) {
    const counts = new Map();
    for (let i = 0; i < ranks.length; i++) {
      counts.set(ranks[i], (counts.get(ranks[i]) || 0) + 1);
    }
    const groups = [];
    counts.forEach(function (count, rank) {
      groups.push({ rank: rank, count: count });
    });
    groups.sort(function (a, b) {
      return b.count - a.count || b.rank - a.rank;
    });
    return groups;
  }

  function evaluate(cards) {
    if (!cards || cards.length !== 5) {
      throw new Error('A hand must be exactly 5 cards');
    }
    const ranks = cards.map(function (card) { return card.rank; });
    ranks.sort(function (a, b) { return b - a; });
    const flush = cards.every(function (card) { return card.suit === cards[0].suit; });
    const straight = straightHigh(ranks);
    const groups = rankGroups(ranks);

    let category;
    let tiebreak;
    if (flush && straight) {
      category = straight === 14 ? 9 : 8;
      tiebreak = [straight];
    } else if (groups[0].count === 4) {
      category = 7;
      tiebreak = [groups[0].rank, groups[1].rank];
    } else if (groups[0].count === 3 && groups[1].count === 2) {
      category = 6;
      tiebreak = [groups[0].rank, groups[1].rank];
    } else if (flush) {
      category = 5;
      tiebreak = ranks.slice();
    } else if (straight) {
      category = 4;
      tiebreak = [straight];
    } else if (groups[0].count === 3) {
      category = 3;
      tiebreak = [groups[0].rank, groups[1].rank, groups[2].rank];
    } else if (groups[0].count === 2 && groups[1].count === 2) {
      category = 2;
      tiebreak = [groups[0].rank, groups[1].rank, groups[2].rank];
    } else if (groups[0].count === 2) {
      category = 1;
      tiebreak = [groups[0].rank, groups[1].rank, groups[2].rank, groups[3].rank];
    } else {
      category = 0;
      tiebreak = ranks.slice();
    }

    return {
      category: category,
      name: HAND_NAMES[category],
      tiebreak: tiebreak,
    };
  }

  function compareEvaluated(a, b) {
    if (a.category !== b.category) return a.category > b.category ? 1 : -1;
    const length = Math.max(a.tiebreak.length, b.tiebreak.length);
    for (let i = 0; i < length; i++) {
      const av = a.tiebreak[i] || 0;
      const bv = b.tiebreak[i] || 0;
      if (av !== bv) return av > bv ? 1 : -1;
    }
    return 0;
  }

  // result is 'a' when the first hand wins, 'b' when the second wins, 'draw' on an exact tie.
  function compareHands(cardsA, cardsB) {
    const handA = evaluate(cardsA);
    const handB = evaluate(cardsB);
    const delta = compareEvaluated(handA, handB);
    let result = 'draw';
    if (delta > 0) result = 'a';
    else if (delta < 0) result = 'b';
    return { result: result, handA: handA, handB: handB };
  }

  function handCaption(hand) {
    const label = [];
    for (let i = 0; i < hand.tiebreak.length; i++) label.push(rankLabel(hand.tiebreak[i]));
    const name = hand.name;
    const category = hand.category;
    if (category === 9) return name;
    if (category === 8 || category === 4) return name + ' · ' + label[0] + ' 하이';
    if (category === 7) return name + ' · ' + label[0];
    if (category === 6) return name + ' · ' + label[0] + ' / ' + label[1];
    if (category === 5 || category === 0) return name + ' · ' + label.join(' ');
    if (category === 3) return name + ' · ' + label[0] + ' (' + label.slice(1).join(' ') + ')';
    if (category === 2) return name + ' · ' + label[0] + ', ' + label[1] + ' (' + label[2] + ')';
    return name + ' · ' + label[0] + ' (' + label.slice(1).join(' ') + ')';
  }

  return {
    SUITS: SUITS,
    HAND_NAMES: HAND_NAMES,
    createDeck: createDeck,
    shuffle: shuffle,
    deal: deal,
    evaluate: evaluate,
    compareEvaluated: compareEvaluated,
    compareHands: compareHands,
    handCaption: handCaption,
    rankLabel: rankLabel,
    cardName: cardName,
    cardText: cardText,
  };
});
