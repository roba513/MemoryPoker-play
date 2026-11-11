(function (root, factory) {
  var cardsApi = typeof module === 'object' && module.exports
    ? require('./cards.js')
    : root.MemoryPokerCards;
  var api = factory(cardsApi);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.MemoryPokerNet = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Cards) {
  'use strict';

  var PREFIX = 'mempoker-';
  var MEMORIZE_MS = 30000;
  var WINS_NEEDED = 2;
  var LINK_SILENCE_MS = 7000;
  var ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var SUITS = { s: true, h: true, d: true, c: true };

  // Guest picks may arrive before the host has chosen. They stay in sealedRemote
  // and are omitted from publicView and from every outgoing message until the
  // host has confirmed as well. The reveal message is the first one that carries
  // both hands, and it is sent only after that.

  function createSession(role) {
    if (role !== 'host' && role !== 'guest') throw new Error('role must be host or guest');
    return {
      role: role,
      phase: 'lobby',
      round: 0,
      scores: { local: 0, remote: 0, draws: 0 },
      winsNeeded: WINS_NEEDED,
      grid: null,
      community: null,
      localPicks: null,
      remotePicks: null,
      sealedRemote: null,
      localConfirmed: false,
      memorizeEndsAt: null,
      lastResult: null,
      matchWinner: null,
    };
  }

  function copyCard(card) {
    return { suit: card.suit, rank: card.rank };
  }

  function cloneSession(session) {
    return {
      role: session.role,
      phase: session.phase,
      round: session.round,
      scores: {
        local: session.scores.local,
        remote: session.scores.remote,
        draws: session.scores.draws,
      },
      winsNeeded: session.winsNeeded,
      grid: session.grid ? session.grid.map(copyCard) : null,
      community: session.community ? session.community.map(copyCard) : null,
      localPicks: session.localPicks ? session.localPicks.slice() : null,
      remotePicks: session.remotePicks ? session.remotePicks.slice() : null,
      sealedRemote: session.sealedRemote ? session.sealedRemote.slice() : null,
      localConfirmed: session.localConfirmed,
      memorizeEndsAt: session.memorizeEndsAt,
      lastResult: session.lastResult,
      matchWinner: session.matchWinner,
    };
  }

  function reject(session, error) {
    return { ok: false, session: session, messages: [], effect: null, error: error };
  }

  function accept(session, messages, effect) {
    return { ok: true, session: session, messages: messages, effect: effect || null, error: null };
  }

  function normalizeRoomCode(input) {
    return String(input == null ? '' : input).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function isValidRoomCode(code) {
    return /^[A-Z0-9]{4,6}$/.test(normalizeRoomCode(code));
  }

  function randomRoomCode(rng, length) {
    var random = rng || Math.random;
    var size = length == null ? 5 : length;
    if (!Number.isInteger(size) || size < 4 || size > 6) {
      throw new Error('room code length must be 4 to 6');
    }
    var code = '';
    for (var i = 0; i < size; i++) {
      code += ALPHABET[Math.floor(random() * ALPHABET.length)];
    }
    return code;
  }

  function peerIdForRoom(code) {
    var normalized = normalizeRoomCode(code);
    if (!isValidRoomCode(normalized)) throw new Error('invalid room code');
    return PREFIX + normalized;
  }

  function codeFromUserInput(value) {
    var text = String(value == null ? '' : value).trim();
    var fromUrl = text.match(/[?&]room=([A-Za-z0-9]{4,6})/i);
    if (fromUrl) return fromUrl[1].toUpperCase();
    var prefixed = text.match(/mempoker-([A-Za-z0-9]{4,6})$/i);
    if (prefixed) return prefixed[1].toUpperCase();
    var code = normalizeRoomCode(text);
    return isValidRoomCode(code) ? code : '';
  }

  function parseRoomQuery(search) {
    var params = new URLSearchParams(String(search || ''));
    var code = normalizeRoomCode(params.get('room') || '');
    return isValidRoomCode(code) ? code : null;
  }

  function shareUrl(pageUrl, code) {
    var url = new URL(pageUrl);
    url.searchParams.set('room', normalizeRoomCode(code));
    url.hash = '';
    return url.toString();
  }

  // A live match stays quiet while both players memorize, so each side sends
  // its own ping. Drop the link immediately when the transport has failed, or
  // after LINK_SILENCE_MS with no inbound message at all.
  function shouldDropLink(connectionState, silentForMs) {
    if (connectionState === 'failed' || connectionState === 'closed') return true;
    return typeof silentForMs === 'number' && silentForMs >= LINK_SILENCE_MS;
  }

  function memorizeDeadline(sentAt, memorizeMs, now) {
    var elapsed = now - sentAt;
    if (!Number.isFinite(elapsed) || elapsed < -5000 || elapsed > memorizeMs + 60000) {
      return now + memorizeMs;
    }
    return sentAt + memorizeMs;
  }

  function isCard(card) {
    return !!card && typeof card === 'object'
      && SUITS[card.suit] === true
      && Number.isInteger(card.rank)
      && card.rank >= 2
      && card.rank <= 14;
  }

  function uniqueDeal(grid, community) {
    if (!Array.isArray(grid) || grid.length !== 16) return false;
    if (!Array.isArray(community) || community.length !== 3) return false;
    var seen = Object.create(null);
    var all = grid.concat(community);
    for (var i = 0; i < all.length; i++) {
      if (!isCard(all[i])) return false;
      var key = all[i].suit + ':' + all[i].rank;
      if (seen[key]) return false;
      seen[key] = true;
    }
    return true;
  }

  function copyDeal(grid, community) {
    return {
      grid: grid.map(copyCard),
      community: community.map(copyCard),
    };
  }

  function normalizePicks(picks) {
    if (!Array.isArray(picks) || picks.length !== 2) return null;
    var a = picks[0];
    var b = picks[1];
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    if (a < 0 || b < 0 || a > 15 || b > 15 || a === b) return null;
    return a < b ? [a, b] : [b, a];
  }

  function isCount(value) {
    return Number.isInteger(value) && value >= 0 && value <= 9;
  }

  function invalid(error) {
    return { ok: false, error: error };
  }

  function validateMessage(data) {
    var msg = data;
    if (typeof msg === 'string') {
      try {
        msg = JSON.parse(msg);
      } catch (error) {
        return invalid('json');
      }
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return invalid('shape');
    if (msg.v !== 1) return invalid('version');

    if (msg.type === 'deal') {
      if (!Number.isInteger(msg.round) || msg.round < 1) return invalid('round');
      if (!uniqueDeal(msg.grid, msg.community)) return invalid('cards');
      if (msg.memorizeMs !== MEMORIZE_MS) return invalid('timer');
      if (!Number.isInteger(msg.sentAt) || msg.sentAt < 0) return invalid('sentAt');
      if (!msg.scores || !isCount(msg.scores.host) || !isCount(msg.scores.guest) || !isCount(msg.scores.draws)) {
        return invalid('scores');
      }
      var dealt = copyDeal(msg.grid, msg.community);
      return {
        ok: true,
        message: {
          v: 1,
          type: 'deal',
          round: msg.round,
          grid: dealt.grid,
          community: dealt.community,
          memorizeMs: MEMORIZE_MS,
          sentAt: msg.sentAt,
          scores: { host: msg.scores.host, guest: msg.scores.guest, draws: msg.scores.draws },
        },
      };
    }

    if (msg.type === 'pick') {
      if ('hostPicks' in msg || 'guestPicks' in msg || 'remotePicks' in msg || 'opponentPicks' in msg) {
        return invalid('leak');
      }
      var picks = normalizePicks(msg.picks);
      if (!picks) return invalid('picks');
      if (!Number.isInteger(msg.round) || msg.round < 1) return invalid('round');
      return { ok: true, message: { v: 1, type: 'pick', round: msg.round, picks: picks } };
    }

    if (msg.type === 'reveal') {
      var hostPicks = normalizePicks(msg.hostPicks);
      var guestPicks = normalizePicks(msg.guestPicks);
      if (!hostPicks || !guestPicks) return invalid('picks');
      if (!Number.isInteger(msg.round) || msg.round < 1) return invalid('round');
      return {
        ok: true,
        message: { v: 1, type: 'reveal', round: msg.round, hostPicks: hostPicks, guestPicks: guestPicks },
      };
    }

    if (msg.type === 'next' || msg.type === 'rematch') {
      if (!Number.isInteger(msg.round) || msg.round < 0) return invalid('round');
      return { ok: true, message: { v: 1, type: msg.type, round: msg.round } };
    }

    return invalid('type');
  }

  function publicView(session) {
    var revealed = session.phase === 'showdown' || session.phase === 'done';
    return {
      role: session.role,
      phase: session.phase,
      round: session.round,
      scores: {
        local: session.scores.local,
        remote: session.scores.remote,
        draws: session.scores.draws,
      },
      winsNeeded: session.winsNeeded,
      grid: session.grid ? session.grid.map(copyCard) : null,
      community: session.community ? session.community.map(copyCard) : null,
      localPicks: session.localPicks ? session.localPicks.slice() : null,
      remotePicks: revealed && session.remotePicks ? session.remotePicks.slice() : null,
      localConfirmed: session.localConfirmed,
      waiting: session.phase === 'picking' && session.localConfirmed && !revealed,
      memorizeEndsAt: session.memorizeEndsAt,
      lastResult: session.lastResult,
      matchWinner: session.matchWinner,
    };
  }

  function winnerOf(session) {
    if (session.scores.local >= session.winsNeeded) return 'local';
    if (session.scores.remote >= session.winsNeeded) return 'remote';
    if (session.round >= session.winsNeeded * 2 - 1) {
      if (session.scores.local > session.scores.remote) return 'local';
      if (session.scores.remote > session.scores.local) return 'remote';
      return 'draw';
    }
    return null;
  }

  function fiveCards(session, picks) {
    return [
      session.grid[picks[0]],
      session.grid[picks[1]],
      session.community[0],
      session.community[1],
      session.community[2],
    ];
  }

  function applyScore(session) {
    var comparison = Cards.compareHands(
      fiveCards(session, session.localPicks),
      fiveCards(session, session.remotePicks)
    );
    if (comparison.result === 'a') session.scores.local += 1;
    else if (comparison.result === 'b') session.scores.remote += 1;
    else session.scores.draws += 1;
    session.lastResult = comparison;
    session.matchWinner = winnerOf(session);
    session.phase = session.matchWinner ? 'done' : 'showdown';
  }

  function wireScores(session) {
    if (session.role === 'host') {
      return {
        host: session.scores.local,
        guest: session.scores.remote,
        draws: session.scores.draws,
      };
    }
    return {
      host: session.scores.remote,
      guest: session.scores.local,
      draws: session.scores.draws,
    };
  }

  function adoptScores(session, wire) {
    if (session.role === 'host') {
      session.scores = { local: wire.host, remote: wire.guest, draws: wire.draws };
    } else {
      session.scores = { local: wire.guest, remote: wire.host, draws: wire.draws };
    }
  }

  function hostStartRound(session, dealt, now) {
    if (session.role !== 'host') return reject(session, 'role');
    if (session.phase !== 'lobby' && session.phase !== 'showdown' && session.phase !== 'done') {
      return reject(session, 'phase');
    }
    if (session.phase === 'showdown' && session.matchWinner) return reject(session, 'phase');
    if (!dealt || !uniqueDeal(dealt.grid, dealt.community)) return reject(session, 'cards');
    if (!Number.isInteger(now) || now < 0) return reject(session, 'time');

    var next = cloneSession(session);
    if (session.phase === 'done') {
      next.scores = { local: 0, remote: 0, draws: 0 };
      next.round = 0;
      next.matchWinner = null;
      next.lastResult = null;
    }
    var cards = copyDeal(dealt.grid, dealt.community);
    next.round += 1;
    next.phase = 'memorize';
    next.grid = cards.grid;
    next.community = cards.community;
    next.localPicks = null;
    next.remotePicks = null;
    next.sealedRemote = null;
    next.localConfirmed = false;
    next.memorizeEndsAt = now + MEMORIZE_MS;
    next.lastResult = null;
    next.matchWinner = null;
    return accept(next, [{
      v: 1,
      type: 'deal',
      round: next.round,
      grid: cards.grid.map(copyCard),
      community: cards.community.map(copyCard),
      memorizeMs: MEMORIZE_MS,
      sentAt: now,
      scores: wireScores(next),
    }], 'memorize');
  }

  function canTakeDeal(session, message) {
    if (session.phase === 'lobby') return message.round === 1;
    if (session.phase === 'done') return message.round === 1;
    if (session.phase === 'showdown' && !session.matchWinner) return message.round === session.round + 1;
    return false;
  }

  function beginPicking(session, now) {
    if (session.phase !== 'memorize') return reject(session, 'phase');
    if (!Number.isInteger(now)) return reject(session, 'time');
    if (now + 1000 < session.memorizeEndsAt) return reject(session, 'early');
    var next = cloneSession(session);
    next.phase = 'picking';
    return accept(next, [], 'picking');
  }

  function finishReveal(session) {
    session.remotePicks = session.sealedRemote.slice();
    session.sealedRemote = null;
    applyScore(session);
    return accept(session, [{
      v: 1,
      type: 'reveal',
      round: session.round,
      hostPicks: session.localPicks.slice(),
      guestPicks: session.remotePicks.slice(),
    }], 'reveal');
  }

  function confirmLocalPicks(session, picks) {
    if (session.phase !== 'picking') return reject(session, 'phase');
    if (session.localConfirmed) return reject(session, 'duplicate');
    var normalized = normalizePicks(picks);
    if (!normalized) return reject(session, 'picks');
    var next = cloneSession(session);
    next.localPicks = normalized;
    next.localConfirmed = true;
    if (session.role === 'guest') {
      return accept(next, [{
        v: 1,
        type: 'pick',
        round: next.round,
        picks: normalized.slice(),
      }], 'waiting');
    }
    if (next.sealedRemote) return finishReveal(next);
    return accept(next, [], 'waiting');
  }

  function receiveMessage(session, raw, now) {
    var checked = validateMessage(raw);
    if (!checked.ok) return reject(session, checked.error);
    var message = checked.message;

    if (message.type === 'deal') {
      if (session.role !== 'guest') return reject(session, 'role');
      if (!canTakeDeal(session, message)) return reject(session, 'phase');
      if (!Number.isInteger(now)) return reject(session, 'time');
      var next = cloneSession(session);
      next.phase = 'memorize';
      next.round = message.round;
      next.grid = message.grid.map(copyCard);
      next.community = message.community.map(copyCard);
      next.localPicks = null;
      next.remotePicks = null;
      next.sealedRemote = null;
      next.localConfirmed = false;
      next.lastResult = null;
      next.matchWinner = null;
      next.memorizeEndsAt = memorizeDeadline(message.sentAt, message.memorizeMs, now);
      adoptScores(next, message.scores);
      return accept(next, [], 'memorize');
    }

    if (message.type === 'pick') {
      if (session.role !== 'host') return reject(session, 'role');
      if (session.phase !== 'memorize' && session.phase !== 'picking') return reject(session, 'phase');
      if (message.round !== session.round) return reject(session, 'round');
      if (session.sealedRemote) return reject(session, 'duplicate');
      var host = cloneSession(session);
      host.sealedRemote = message.picks.slice();
      if (host.localConfirmed) return finishReveal(host);
      return accept(host, [], null);
    }

    if (message.type === 'reveal') {
      if (session.role !== 'guest') return reject(session, 'role');
      if (session.phase !== 'picking' || !session.localConfirmed) return reject(session, 'phase');
      if (message.round !== session.round) return reject(session, 'round');
      if (!session.localPicks
        || message.guestPicks[0] !== session.localPicks[0]
        || message.guestPicks[1] !== session.localPicks[1]) {
        return reject(session, 'mismatch');
      }
      var guest = cloneSession(session);
      guest.remotePicks = message.hostPicks.slice();
      guest.sealedRemote = null;
      applyScore(guest);
      return accept(guest, [], 'reveal');
    }

    if (message.type === 'next') {
      if (session.role !== 'host') return reject(session, 'role');
      if (session.phase !== 'showdown' || session.matchWinner) return reject(session, 'phase');
      return accept(session, [], 'deal-now');
    }

    if (message.type === 'rematch') {
      if (session.role !== 'host') return reject(session, 'role');
      if (session.phase !== 'done') return reject(session, 'phase');
      return accept(session, [], 'deal-now');
    }

    return reject(session, 'type');
  }

  function requestAdvance(session, kind) {
    if (kind === 'next') {
      if (session.phase !== 'showdown' || session.matchWinner) return reject(session, 'phase');
    } else if (kind === 'rematch') {
      if (session.phase !== 'done') return reject(session, 'phase');
    } else {
      return reject(session, 'type');
    }
    if (session.role === 'host') return accept(session, [], 'deal-now');
    return accept(session, [{ v: 1, type: kind, round: session.round }], 'waiting');
  }

  function openRoom(options) {
    var PeerCtor = options.Peer || (typeof Peer !== 'undefined' ? Peer : null);
    function later(fn) {
      if (typeof queueMicrotask === 'function') queueMicrotask(fn);
      else setTimeout(fn, 0);
    }
    if (typeof PeerCtor !== 'function') {
      later(function () {
        if (options.onError) options.onError({ type: 'peerjs-missing' });
      });
      return {
        send: function () { return false; },
        close: function () {},
      };
    }

    var closed = false;
    var announced = false;
    var peer = null;
    var conn = null;
    var queue = [];
    var beat = null;
    var lastHeard = 0;

    function markHeard() {
      lastHeard = Date.now();
    }

    function startBeat() {
      if (beat || closed) return;
      markHeard();
      beat = setInterval(function () {
        if (closed) return;
        var state = '';
        if (conn && conn.peerConnection) {
          state = conn.peerConnection.connectionState || conn.peerConnection.iceConnectionState || '';
        }
        if (conn && conn.open) {
          try {
            conn.send({ v: 1, type: 'ping' });
          } catch (error) {
            destroy('error');
            return;
          }
        }
        if (announced && shouldDropLink(state, Date.now() - lastHeard)) destroy('closed');
      }, 2000);
      if (beat && typeof beat.unref === 'function') beat.unref();
    }

    function watchTransport(next) {
      var pc = next.peerConnection;
      if (!pc || pc.__mpWatch) return;
      pc.__mpWatch = true;
      var onState = function () {
        if (closed || conn !== next) return;
        var state = pc.connectionState || pc.iceConnectionState || '';
        if (shouldDropLink(state, 0)) destroy('closed');
      };
      if (typeof pc.addEventListener === 'function') {
        pc.addEventListener('connectionstatechange', onState);
        pc.addEventListener('iceconnectionstatechange', onState);
      }
    }

    function emitStatus(status) {
      if (!closed && options.onStatus) options.onStatus(status);
    }

    function send(message) {
      if (closed) return false;
      var checked = validateMessage(message);
      if (!checked.ok) return false;
      if (conn && conn.open) conn.send(checked.message);
      else queue.push(checked.message);
      return true;
    }

    function flush() {
      if (!conn || !conn.open) return;
      while (queue.length) conn.send(queue.shift());
    }

    function destroy(reason) {
      if (closed) return;
      closed = true;
      if (beat) {
        clearInterval(beat);
        beat = null;
      }
      var current = conn;
      conn = null;
      try {
        if (current) current.close();
      } catch (error) { /* already closing */ }
      try {
        if (peer && !peer.destroyed) peer.destroy();
      } catch (error) { /* already destroyed */ }
      if (reason !== 'local' && options.onClose) options.onClose(reason || 'closed');
    }

    function announceOpen() {
      if (announced || closed) return;
      announced = true;
      emitStatus('connected');
      startBeat();
      flush();
      if (options.onOpen) options.onOpen();
    }

    function watchConn(next) {
      if (conn && conn !== next) {
        var rejectExtra = function () {
          try { next.close(); } catch (error) { /* ignore */ }
        };
        if (next.open) rejectExtra();
        else if (next.on) next.on('open', rejectExtra);
        else rejectExtra();
        return;
      }
      conn = next;
      watchTransport(next);
      next.on('data', function (data) {
        if (closed || conn !== next) return;
        markHeard();
        if (data && data.type === 'ping') return;
        var checked = validateMessage(data);
        if (!checked.ok) return;
        if (options.onMessage) options.onMessage(checked.message);
      });
      next.on('open', function () {
        if (conn !== next) return;
        watchTransport(next);
        announceOpen();
      });
      next.on('close', function () {
        if (conn !== next) return;
        destroy('closed');
      });
      next.on('error', function () {
        if (conn !== next) return;
        destroy('error');
      });
      if (next.open) announceOpen();
    }

    emitStatus(options.role === 'host' ? 'creating' : 'connecting');
    try {
      peer = options.role === 'host'
        ? new PeerCtor(peerIdForRoom(options.code))
        : new PeerCtor();
    } catch (error) {
      later(function () {
        if (options.onError) options.onError(error);
      });
      return { send: send, close: function () { destroy('local'); } };
    }

    peer.on('open', function () {
      if (closed) return;
      if (options.role === 'host') {
        emitStatus('waiting');
        if (options.onReady) options.onReady();
        return;
      }
      watchConn(peer.connect(peerIdForRoom(options.code), {
        reliable: true,
        serialization: 'json',
      }));
    });
    peer.on('connection', function (incoming) {
      if (closed || options.role !== 'host') {
        try { incoming.close(); } catch (error) { /* ignore */ }
        return;
      }
      watchConn(incoming);
    });
    peer.on('error', function (error) {
      if (options.onError) options.onError(error);
      var type = error && error.type;
      if (type === 'unavailable-id') {
        destroy('local');
        return;
      }
      if (type === 'peer-unavailable') destroy('unavailable');
      else if (!closed) destroy('error');
    });
    peer.on('disconnected', function () {
      if (closed || !peer || peer.destroyed) return;
      try { peer.reconnect(); } catch (error) { /* broker already gone */ }
    });

    return {
      send: send,
      close: function () { destroy('local'); },
    };
  }

  return {
    PREFIX: PREFIX,
    MEMORIZE_MS: MEMORIZE_MS,
    WINS_NEEDED: WINS_NEEDED,
    createSession: createSession,
    normalizeRoomCode: normalizeRoomCode,
    isValidRoomCode: isValidRoomCode,
    randomRoomCode: randomRoomCode,
    peerIdForRoom: peerIdForRoom,
    codeFromUserInput: codeFromUserInput,
    parseRoomQuery: parseRoomQuery,
    shareUrl: shareUrl,
    memorizeDeadline: memorizeDeadline,
    shouldDropLink: shouldDropLink,
    validateMessage: validateMessage,
    publicView: publicView,
    hostStartRound: hostStartRound,
    beginPicking: beginPicking,
    confirmLocalPicks: confirmLocalPicks,
    receiveMessage: receiveMessage,
    requestAdvance: requestAdvance,
    openRoom: openRoom,
  };
});
