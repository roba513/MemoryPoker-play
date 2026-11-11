(function () {
  'use strict';

  var Cards = globalThis.MemoryPokerCards;
  var AI = globalThis.MemoryPokerAI;
  var Net = globalThis.MemoryPokerNet;
  var MEMORIZE_MS = (Net && Net.MEMORIZE_MS) || 30000;
  var MATCH_LABEL = { 1: '단판', 2: '3판 2선승', 3: '5판 3선승' };
  var HINTS = {
    easy: 'AI가 조금만 기억하고 나머지는 추측합니다.',
    normal: 'AI가 절반 이상을 기억하고 그중에서 최선의 패를 고릅니다.',
    hard: 'AI가 거의 정확하게 기억하고 최선의 2장을 고릅니다.',
  };

  var ui = {
    menu: document.getElementById('screen-menu'),
    menuAi: document.getElementById('menu-ai'),
    menuOnline: document.getElementById('menu-online'),
    menuNotice: document.getElementById('menu-notice'),
    setup: document.getElementById('screen-setup'),
    setupBack: document.getElementById('setup-back'),
    online: document.getElementById('screen-online'),
    onlineLobby: document.getElementById('online-lobby'),
    roomWaiting: document.getElementById('room-waiting'),
    netStatus: document.getElementById('net-status'),
    createRoom: document.getElementById('create-room'),
    joinForm: document.getElementById('join-form'),
    joinCode: document.getElementById('join-code'),
    roomCode: document.getElementById('room-code'),
    shareUrl: document.getElementById('share-url'),
    copyCode: document.getElementById('copy-code'),
    copyLink: document.getElementById('copy-link'),
    copyFeedback: document.getElementById('copy-feedback'),
    onlineBack: document.getElementById('online-back'),
    game: document.getElementById('screen-game'),
    form: document.getElementById('setup-form'),
    scoreboard: document.getElementById('scoreboard'),
    scorePlayer: document.getElementById('score-player'),
    scoreDraw: document.getElementById('score-draw'),
    scoreOpponent: document.getElementById('score-opponent'),
    opponentLabel: document.getElementById('score-opponent-label'),
    roundLabel: document.getElementById('round-label'),
    diffLabel: document.getElementById('diff-label'),
    connStatus: document.getElementById('conn-status'),
    abandon: document.getElementById('abandon'),
    hint: document.getElementById('difficulty-hint'),
    status: document.getElementById('status'),
    timer: document.getElementById('timer'),
    timerNum: document.getElementById('timer-num'),
    timerFill: document.getElementById('timer-fill'),
    placeholder: document.getElementById('community-placeholder'),
    community: document.getElementById('community'),
    gridLabel: document.getElementById('grid-label'),
    grid: document.getElementById('grid'),
    result: document.getElementById('result'),
    confirm: document.getElementById('confirm'),
    next: document.getElementById('next'),
    rematch: document.getElementById('rematch'),
    restart: document.getElementById('restart'),
  };

  var state = {
    mode: 'ai',
    phase: 'setup',
    difficulty: 'normal',
    winsNeeded: 2,
    scores: { player: 0, opponent: 0, draws: 0 },
    played: 0,
    grid: [],
    community: [],
    playerPicks: [],
    opponentPicks: [],
    timerId: 0,
    joinTimer: 0,
    memorizeEndsAt: 0,
    revealId: 0,
    session: null,
    link: null,
    roomCode: '',
    roomToken: null,
    netError: null,
  };

  function setPhase(phase) {
    state.phase = phase;
    document.body.dataset.phase = phase;
  }

  function setStatus(text) {
    if (ui.status.textContent !== text) ui.status.textContent = text;
  }

  function setNetStatus(text) {
    ui.netStatus.textContent = text;
  }

  function clearTimers() {
    if (state.timerId) {
      window.clearInterval(state.timerId);
      state.timerId = 0;
    }
    if (state.revealId) {
      window.clearTimeout(state.revealId);
      state.revealId = 0;
    }
  }

  function clearJoinTimer() {
    if (state.joinTimer) {
      window.clearTimeout(state.joinTimer);
      state.joinTimer = 0;
    }
  }

  function maxRounds() {
    return state.winsNeeded * 2 - 1;
  }

  function matchWinner() {
    if (state.scores.player >= state.winsNeeded) return 'player';
    if (state.scores.opponent >= state.winsNeeded) return 'opponent';
    if (state.played >= maxRounds()) {
      if (state.scores.player > state.scores.opponent) return 'player';
      if (state.scores.opponent > state.scores.player) return 'opponent';
      return 'draw';
    }
    return null;
  }

  function opponentName() {
    return state.mode === 'online' ? '상대' : 'AI';
  }

  function mapWinner(kind) {
    if (kind === 'local') return 'player';
    if (kind === 'remote') return 'opponent';
    return kind;
  }

  function renderScore() {
    ui.scorePlayer.textContent = String(state.scores.player);
    ui.scoreDraw.textContent = String(state.scores.draws);
    ui.scoreOpponent.textContent = String(state.scores.opponent);
    ui.opponentLabel.textContent = opponentName();
    ui.roundLabel.textContent = MATCH_LABEL[state.winsNeeded] + ' · ' + state.played + '판';
    ui.diffLabel.textContent = state.mode === 'online'
      ? state.roomCode
      : AI.DIFFICULTIES[state.difficulty].label;
    ui.connStatus.hidden = state.mode !== 'online';
    if (state.mode === 'online') ui.connStatus.textContent = '연결됨';
  }

  function createCard(card, options) {
    var interactive = !!options.interactive;
    var node = document.createElement(interactive ? 'button' : 'div');
    node.className = 'card' + (options.mini ? ' mini' : '') + (options.faceDown ? ' is-down' : '');
    if (interactive) {
      node.type = 'button';
      node.disabled = !options.enabled;
    } else {
      node.setAttribute('role', 'img');
    }
    var label = options.label || (options.faceDown ? '뒷면 카드' : Cards.cardName(card));
    node.setAttribute('aria-label', label);
    if (interactive) node.setAttribute('aria-pressed', 'false');

    var inner = document.createElement('span');
    inner.className = 'card-inner';
    inner.setAttribute('aria-hidden', 'true');

    var suit = Cards.SUITS[card.suit];
    var front = document.createElement('span');
    front.className = 'face front ' + suit.color;

    var corner = document.createElement('span');
    corner.className = 'corner';
    var rank = document.createElement('b');
    rank.textContent = Cards.rankLabel(card.rank);
    if (card.rank === 10) rank.classList.add('ten');
    var symbol = document.createElement('i');
    symbol.textContent = suit.symbol;
    corner.append(rank, symbol);

    var pip = document.createElement('span');
    pip.className = 'pip';
    pip.textContent = suit.symbol;
    front.append(corner, pip);

    var back = document.createElement('span');
    back.className = 'face back';
    inner.append(front, back);
    node.append(inner);
    return node;
  }

  function renderGrid() {
    ui.grid.replaceChildren();
    state.grid.forEach(function (card, index) {
      var button = createCard(card, {
        interactive: true,
        faceDown: false,
        enabled: false,
        label: (index + 1) + '번 ' + Cards.cardName(card),
      });
      button.dataset.index = String(index);
      button.classList.add('deal-in');
      button.style.animationDelay = (index * 22) + 'ms';
      button.addEventListener('animationend', function () {
        button.classList.remove('deal-in');
        button.style.animationDelay = '';
      });
      ui.grid.append(button);
    });
  }

  function renderCommunity() {
    ui.placeholder.hidden = true;
    ui.community.replaceChildren();
    state.community.forEach(function (card, index) {
      var node = createCard(card, {
        interactive: false,
        faceDown: true,
        label: '공유 카드 뒷면',
      });
      node.dataset.community = String(index);
      node.style.transitionDelay = (index * 120) + 'ms';
      ui.community.append(node);
    });
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        var nodes = ui.community.querySelectorAll('.card');
        for (var i = 0; i < nodes.length; i++) {
          nodes[i].classList.remove('is-down');
          nodes[i].style.transitionDelay = (i * 120) + 'ms';
          nodes[i].setAttribute('aria-label', Cards.cardName(state.community[i]));
        }
      });
    });
  }

  function syncPicks() {
    var buttons = ui.grid.querySelectorAll('.card');
    for (var i = 0; i < buttons.length; i++) {
      var selected = state.playerPicks.indexOf(i) !== -1;
      buttons[i].classList.toggle('is-selected', selected);
      buttons[i].setAttribute('aria-pressed', selected ? 'true' : 'false');
      var label = (i + 1) + '번 뒷면';
      if (selected) label += ', 선택됨';
      buttons[i].setAttribute('aria-label', label);
    }
    var count = state.playerPicks.length;
    ui.confirm.disabled = count !== 2;
    if (count === 2) setStatus('확정하면 양쪽 선택이 함께 공개됩니다.');
    else setStatus('상대의 선택은 보이지 않습니다. 뒷면 카드 2장을 고르세요. ' + count + '/2');
  }

  function togglePick(index) {
    if (state.phase !== 'pick') return;
    var at = state.playerPicks.indexOf(index);
    if (at !== -1) {
      state.playerPicks.splice(at, 1);
      syncPicks();
      return;
    }
    if (state.playerPicks.length >= 2) {
      setStatus('이미 2장을 골랐습니다. 한 장을 다시 누르면 해제됩니다.');
      return;
    }
    state.playerPicks.push(index);
    syncPicks();
  }

  function fiveCards(picks) {
    return [
      state.grid[picks[0]],
      state.grid[picks[1]],
      state.community[0],
      state.community[1],
      state.community[2],
    ];
  }

  function addBadge(button, className, text) {
    var badges = button.querySelector('.badges');
    if (!badges) {
      badges = document.createElement('span');
      badges.className = 'badges';
      button.append(badges);
    }
    var badge = document.createElement('span');
    badge.className = 'badge ' + className;
    badge.textContent = text;
    badges.append(badge);
  }

  function revealGridCard(button, index) {
    button.classList.remove('is-down', 'is-selected');
    button.disabled = true;
    button.setAttribute('aria-pressed', 'false');
    var who = [];
    if (state.playerPicks.indexOf(index) !== -1) who.push('나');
    if (state.opponentPicks.indexOf(index) !== -1) who.push(opponentName());
    var label = (index + 1) + '번 ' + Cards.cardName(state.grid[index]);
    if (who.length) label += ', ' + who.join(' ');
    button.setAttribute('aria-label', label);
  }

  function handBlock(title, picks, hand, winner) {
    var wrap = document.createElement('div');
    wrap.className = 'hand' + (winner ? ' is-winner' : '');
    var heading = document.createElement('h3');
    heading.textContent = title;
    var row = document.createElement('div');
    row.className = 'hand-cards';
    picks.forEach(function (index) {
      row.append(createCard(state.grid[index], { interactive: false, mini: true }));
    });
    var plus = document.createElement('span');
    plus.className = 'plus';
    plus.textContent = '+';
    plus.setAttribute('aria-hidden', 'true');
    row.append(plus);
    state.community.forEach(function (card) {
      row.append(createCard(card, { interactive: false, mini: true }));
    });
    var caption = document.createElement('p');
    caption.className = 'caption';
    caption.textContent = Cards.handCaption(hand);
    wrap.append(heading, row, caption);
    return wrap;
  }

  function roundText(result) {
    if (result === 'a') return '이 판은 당신의 승리';
    if (result === 'b') return '이 판은 상대의 승리';
    return '이 판은 무승부';
  }

  function matchText(kind) {
    if (kind === 'player') return '매치 승리';
    if (kind === 'opponent') return '매치 패배';
    return '매치 무승부';
  }

  function resultClass(result) {
    if (result === 'a') return 'player';
    if (result === 'b') return 'opponent';
    return 'draw';
  }

  function renderResult(comparison, done) {
    ui.result.replaceChildren();
    if (done) {
      var banner = document.createElement('p');
      banner.className = 'match-banner ' + done;
      banner.textContent = matchText(done);
      ui.result.append(banner);
    }
    var headline = document.createElement('h2');
    headline.className = 'round-headline ' + resultClass(comparison.result);
    headline.textContent = roundText(comparison.result);
    ui.result.append(headline);
    ui.result.append(handBlock('나의 패', state.playerPicks, comparison.handA, comparison.result === 'a'));
    ui.result.append(handBlock('상대의 패', state.opponentPicks, comparison.handB, comparison.result === 'b'));
    var shared = state.playerPicks.filter(function (index) {
      return state.opponentPicks.indexOf(index) !== -1;
    });
    if (shared.length) {
      var overlap = document.createElement('p');
      overlap.className = 'note';
      overlap.textContent = '같은 카드를 둘 다 골랐습니다.';
      ui.result.append(overlap);
    }
    var rule = document.createElement('p');
    rule.className = 'note';
    rule.textContent = '같은 족보는 키커로 가릅니다. 완전히 같으면 무승부입니다.';
    ui.result.append(rule);
    ui.result.hidden = false;
  }

  function presentShowdown(comparison, done) {
    setPhase('showdown');
    ui.confirm.hidden = true;
    var buttons = ui.grid.children;
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true;

    var chosen = {};
    state.playerPicks.forEach(function (index) { chosen[index] = true; });
    state.opponentPicks.forEach(function (index) { chosen[index] = true; });
    Object.keys(chosen).forEach(function (key) {
      var index = Number(key);
      var button = buttons[index];
      if (state.playerPicks.indexOf(index) !== -1) {
        button.classList.add('picked-player');
        addBadge(button, 'player', '나');
      }
      if (state.opponentPicks.indexOf(index) !== -1) {
        button.classList.add('picked-opponent');
        addBadge(button, 'opponent', opponentName());
      }
      revealGridCard(button, index);
    });

    renderScore();
    renderResult(comparison, done);
    ui.gridLabel.textContent = '선택한 카드';
    var online = state.mode === 'online';
    ui.next.hidden = done !== null;
    ui.next.disabled = false;
    ui.rematch.hidden = !online || done === null;
    ui.rematch.disabled = false;
    ui.restart.hidden = online || done === null;
    var verdict = (done ? matchText(done) + '. ' : '') +
      roundText(comparison.result) + '. 나의 패 ' + comparison.handA.name +
      ', 상대의 패 ' + comparison.handB.name + '.';
    setStatus(verdict);

    state.revealId = window.setTimeout(function () {
      state.revealId = 0;
      if (state.phase !== 'showdown') return;
      for (var n = 0; n < buttons.length; n++) revealGridCard(buttons[n], n);
      ui.gridLabel.textContent = '16장 정답';
    }, 700);
  }

  function onConfirm() {
    if (state.phase !== 'pick' || state.playerPicks.length !== 2) return;
    if (state.mode === 'online') {
      confirmOnline();
      return;
    }
    state.opponentPicks = AI.choose(state.grid, state.community, state.difficulty);
    var comparison = Cards.compareHands(fiveCards(state.playerPicks), fiveCards(state.opponentPicks));
    if (comparison.result === 'a') state.scores.player += 1;
    else if (comparison.result === 'b') state.scores.opponent += 1;
    else state.scores.draws += 1;
    presentShowdown(comparison, matchWinner());
  }

  function beginPick() {
    setPhase('reveal-community');
    setStatus('공유 카드를 공개합니다.');
    renderCommunity();
    state.revealId = window.setTimeout(function () {
      state.revealId = 0;
      if (state.phase !== 'reveal-community') return;
      if (state.mode === 'online') {
        if (!state.session) return;
        var stepped = Net.beginPicking(state.session, Math.max(Date.now(), state.session.memorizeEndsAt));
        if (!stepped.ok) {
          setStatus('선택을 시작하지 못했습니다.');
          return;
        }
        state.session = stepped.session;
      }
      setPhase('pick');
      var buttons = ui.grid.querySelectorAll('.card');
      for (var i = 0; i < buttons.length; i++) buttons[i].disabled = false;
      ui.confirm.hidden = false;
      ui.confirm.disabled = true;
      setStatus('상대의 선택은 보이지 않습니다. 뒷면 카드 2장을 고르세요. 0/2');
    }, 900);
  }

  function endMemorize() {
    if (state.phase !== 'memorize') return;
    setPhase('flip');
    if (state.timerId) {
      window.clearInterval(state.timerId);
      state.timerId = 0;
    }
    ui.timer.hidden = true;
    var buttons = ui.grid.querySelectorAll('.card');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.add('is-down');
      buttons[i].setAttribute('aria-label', (i + 1) + '번 뒷면');
    }
    ui.gridLabel.textContent = '고를 카드';
    setStatus('카드를 뒤집는 중입니다.');
    state.revealId = window.setTimeout(function () {
      state.revealId = 0;
      if (state.phase !== 'flip') return;
      beginPick();
    }, 700);
  }

  function tick() {
    var left = state.memorizeEndsAt - Date.now();
    if (left <= 0) {
      ui.timerNum.textContent = '0';
      ui.timerFill.style.transform = 'scaleX(0)';
      endMemorize();
      return;
    }
    var seconds = Math.ceil(left / 1000);
    ui.timerNum.textContent = String(seconds);
    ui.timerFill.style.transform = 'scaleX(' + Math.min(1, left / MEMORIZE_MS) + ')';
    ui.timer.classList.toggle('urgent', seconds <= 5);
    ui.timerNum.setAttribute('aria-label', '외우는 시간 ' + seconds + '초');
    if (seconds <= 5) setStatus('곧 뒤집힙니다.');
  }

  function startMemorize(endsAt) {
    setPhase('memorize');
    state.memorizeEndsAt = endsAt || (Date.now() + MEMORIZE_MS);
    ui.timer.hidden = false;
    ui.timer.classList.remove('urgent');
    tick();
    if (state.phase === 'memorize') state.timerId = window.setInterval(tick, 100);
  }

  function resetRoundUi() {
    ui.result.hidden = true;
    ui.result.replaceChildren();
    ui.confirm.hidden = true;
    ui.confirm.disabled = true;
    ui.next.hidden = true;
    ui.rematch.hidden = true;
    ui.restart.hidden = true;
    ui.placeholder.hidden = false;
    ui.community.replaceChildren();
    ui.gridLabel.textContent = '외울 카드';
  }

  function startRound() {
    clearTimers();
    state.played += 1;
    state.playerPicks = [];
    state.opponentPicks = [];
    var dealt = Cards.deal();
    state.grid = dealt.grid;
    state.community = dealt.community;
    resetRoundUi();
    renderScore();
    renderGrid();
    setStatus('30초 동안 위치와 무늬를 기억하세요.');
    startMemorize();
  }

  function showScreen(name) {
    ui.menu.hidden = name !== 'menu';
    ui.setup.hidden = name !== 'setup';
    ui.online.hidden = name !== 'online';
    ui.game.hidden = name !== 'game';
    var playing = name === 'game';
    ui.scoreboard.hidden = !playing;
    ui.abandon.hidden = !playing;
    if (!playing) ui.timer.hidden = true;
  }

  function showMenu() {
    showScreen('menu');
    setPhase('setup');
    ui.abandon.textContent = '새 게임';
  }

  function showAiSetup() {
    clearTimers();
    state.mode = 'ai';
    showScreen('setup');
    setPhase('setup');
  }

  function showOnlineHome() {
    showScreen('online');
    ui.onlineLobby.hidden = false;
    ui.roomWaiting.hidden = true;
    ui.copyFeedback.textContent = '';
    setPhase('setup');
    setNetStatus('코드를 만들거나 입력하세요.');
  }

  function showRoomPanel(code) {
    showScreen('online');
    ui.onlineLobby.hidden = true;
    ui.roomWaiting.hidden = false;
    ui.roomCode.textContent = code;
    var link = Net.shareUrl(window.location.href, code);
    ui.shareUrl.textContent = link;
    ui.shareUrl.dataset.url = link;
    ui.copyFeedback.textContent = '';
  }

  function copyText(text) {
    function done(ok) {
      ui.copyFeedback.textContent = ok ? '복사했습니다.' : '복사하지 못했습니다.';
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallback(); });
      return;
    }
    fallback();
    function fallback() {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.append(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
      area.remove();
      done(ok);
    }
  }

  function closeLink() {
    var link = state.link;
    state.link = null;
    if (link) link.close();
  }

  function leaveOnline(notice) {
    state.roomToken = null;
    clearTimers();
    clearJoinTimer();
    closeLink();
    state.session = null;
    state.mode = 'ai';
    state.roomCode = '';
    state.netError = null;
    ui.grid.replaceChildren();
    ui.community.replaceChildren();
    ui.result.hidden = true;
    ui.result.replaceChildren();
    ui.connStatus.hidden = true;
    showMenu();
    if (notice) {
      ui.menuNotice.hidden = false;
      ui.menuNotice.textContent = notice;
    } else {
      ui.menuNotice.hidden = true;
      ui.menuNotice.textContent = '';
    }
  }

  function disconnectMessage(err, reason) {
    var type = err && err.type;
    if (reason === 'unavailable' || type === 'peer-unavailable') {
      return '방을 찾을 수 없습니다. 코드를 확인해 주세요.';
    }
    if (type === 'peerjs-missing') {
      return '온라인 대전을 불러오지 못했습니다. http 또는 https로 연 페이지에서 인터넷 연결을 확인해 주세요.';
    }
    if (type === 'unavailable-id') return '방을 만들지 못했습니다. 다시 시도해 주세요.';
    if (type === 'browser-incompatible') return '이 브라우저는 온라인 대전을 지원하지 않습니다.';
    if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'disconnected') {
      return '연결 서버에 닿지 못했습니다. 인터넷 연결을 확인해 주세요.';
    }
    return '연결이 끊어졌습니다. 메뉴로 돌아왔습니다.';
  }

  function failOnline(err, reason) {
    var message = disconnectMessage(err, reason);
    leaveOnline(message);
  }

  function peerMissingMessage() {
    return '온라인 대전을 불러오지 못했습니다. http 또는 https로 연 페이지에서 인터넷 연결을 확인해 주세요.';
  }

  function syncFromSession(session) {
    var view = Net.publicView(session);
    state.grid = view.grid || [];
    state.community = view.community || [];
    state.playerPicks = view.localPicks ? view.localPicks.slice() : [];
    state.opponentPicks = view.remotePicks ? view.remotePicks.slice() : [];
    state.scores.player = view.scores.local;
    state.scores.opponent = view.scores.remote;
    state.scores.draws = view.scores.draws;
    state.played = view.round;
    state.winsNeeded = view.winsNeeded;
  }

  function renderDealtRound(session) {
    clearTimers();
    syncFromSession(session);
    resetRoundUi();
    renderScore();
    renderGrid();
    setStatus('30초 동안 위치와 무늬를 기억하세요.');
    startMemorize(session.memorizeEndsAt);
  }

  function dealAsHost() {
    if (!state.session || state.session.role !== 'host' || !state.link) return false;
    var started = Net.hostStartRound(state.session, Cards.deal(), Date.now());
    if (!started.ok) return false;
    state.session = started.session;
    var sent = true;
    started.messages.forEach(function (message) {
      if (!state.link.send(message)) sent = false;
    });
    if (!sent) {
      failOnline(state.netError, 'error');
      return false;
    }
    ui.abandon.textContent = '나가기';
    showScreen('game');
    renderDealtRound(started.session);
    return true;
  }

  function onNetMessage(message) {
    if (!state.session) return;
    var result = Net.receiveMessage(state.session, message, Date.now());
    if (!result.ok) return;
    state.session = result.session;
    if (result.effect === 'memorize') {
      ui.abandon.textContent = '나가기';
      showScreen('game');
      renderDealtRound(result.session);
    } else if (result.effect === 'reveal') {
      syncFromSession(result.session);
      presentShowdown(result.session.lastResult, mapWinner(result.session.matchWinner));
    } else if (result.effect === 'deal-now') {
      dealAsHost();
    }
    result.messages.forEach(function (outgoing) {
      if (state.link) state.link.send(outgoing);
    });
  }

  function lockPicks() {
    var buttons = ui.grid.querySelectorAll('.card');
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true;
    ui.confirm.hidden = true;
  }

  function confirmOnline() {
    if (!state.session) return;
    var result = Net.confirmLocalPicks(state.session, state.playerPicks.slice());
    if (!result.ok) return;
    state.session = result.session;
    result.messages.forEach(function (message) {
      if (state.link) state.link.send(message);
    });
    if (result.effect === 'reveal') {
      syncFromSession(result.session);
      presentShowdown(result.session.lastResult, mapWinner(result.session.matchWinner));
      return;
    }
    lockPicks();
    setStatus('상대 선택 대기 중');
  }

  function advanceOnline(kind) {
    if (!state.session) return;
    var result = Net.requestAdvance(state.session, kind);
    if (!result.ok) return;
    state.session = result.session;
    if (kind === 'next') ui.next.disabled = true;
    if (kind === 'rematch') ui.rematch.disabled = true;
    if (result.effect === 'deal-now') {
      dealAsHost();
      return;
    }
    result.messages.forEach(function (message) {
      if (state.link) state.link.send(message);
    });
    setStatus(kind === 'rematch' ? '재대결을 준비하는 중' : '다음 판을 준비하는 중');
  }

  function createRoom() {
    if (typeof Peer !== 'function') {
      leaveOnline(peerMissingMessage());
      return;
    }
    closeLink();
    clearJoinTimer();
    var token = {};
    state.roomToken = token;
    state.mode = 'online';
    state.session = Net.createSession('host');
    state.netError = null;
    state.scores = { player: 0, opponent: 0, draws: 0 };
    state.winsNeeded = Net.WINS_NEEDED;
    var generation = 0;
    var attempts = 0;

    function tryCode() {
      if (state.roomToken !== token) return;
      attempts += 1;
      generation += 1;
      var mine = generation;
      var code = Net.randomRoomCode(Math.random, 5);
      state.roomCode = code;
      showRoomPanel(code);
      setNetStatus('방을 만드는 중');
      var link = Net.openRoom({
        role: 'host',
        code: code,
        onStatus: function (status) {
          if (state.roomToken !== token || mine !== generation) return;
          if (status === 'creating') setNetStatus('방을 만드는 중');
          if (status === 'waiting') setNetStatus('상대를 기다리는 중');
          if (status === 'connected') setNetStatus('연결됨');
        },
        onOpen: function () {
          if (state.roomToken !== token || mine !== generation) return;
          dealAsHost();
        },
        onMessage: function (message) {
          if (state.roomToken !== token || mine !== generation) return;
          onNetMessage(message);
        },
        onError: function (err) {
          if (state.roomToken !== token || mine !== generation) return;
          if (err && err.type === 'unavailable-id' && attempts < 5) {
            tryCode();
            return;
          }
          state.netError = err;
          if (err && (err.type === 'peerjs-missing' || err.type === 'unavailable-id')) failOnline(err, 'error');
        },
        onClose: function (reason) {
          if (state.roomToken !== token || mine !== generation) return;
          failOnline(state.netError, reason);
        },
      });
      if (mine === generation) state.link = link;
    }

    tryCode();
  }

  function joinRoom(raw) {
    var code = Net.codeFromUserInput(raw);
    if (!code) {
      showOnlineHome();
      setNetStatus('방 코드는 영문 또는 숫자 4~6자리입니다.');
      return;
    }
    if (typeof Peer !== 'function') {
      leaveOnline(peerMissingMessage());
      return;
    }
    closeLink();
    clearJoinTimer();
    var token = {};
    state.roomToken = token;
    state.mode = 'online';
    state.roomCode = code;
    state.session = Net.createSession('guest');
    state.netError = null;
    state.scores = { player: 0, opponent: 0, draws: 0 };
    state.winsNeeded = Net.WINS_NEEDED;
    showRoomPanel(code);
    setNetStatus('방에 접속하는 중');
    state.joinTimer = window.setTimeout(function () {
      if (state.roomToken !== token) return;
      failOnline({ type: 'peer-unavailable' }, 'unavailable');
    }, 15000);
    state.link = Net.openRoom({
      role: 'guest',
      code: code,
      onStatus: function (status) {
        if (state.roomToken !== token) return;
        if (status === 'connecting') setNetStatus('방에 접속하는 중');
        if (status === 'connected') setNetStatus('연결됨. 방장이 카드를 준비하는 중');
      },
      onOpen: function () {
        if (state.roomToken !== token) return;
        clearJoinTimer();
        setNetStatus('연결됨. 방장이 카드를 준비하는 중');
      },
      onMessage: function (message) {
        if (state.roomToken !== token) return;
        onNetMessage(message);
      },
      onError: function (err) {
        if (state.roomToken !== token) return;
        state.netError = err;
        if (err && err.type === 'peerjs-missing') failOnline(err, 'error');
      },
      onClose: function (reason) {
        if (state.roomToken !== token) return;
        failOnline(state.netError, reason);
      },
    });
  }

  function onStart(event) {
    event.preventDefault();
    closeLink();
    state.mode = 'ai';
    state.session = null;
    state.roomCode = '';
    var data = new FormData(ui.form);
    var difficulty = String(data.get('difficulty') || 'normal');
    var wins = Number(data.get('wins') || 2);
    state.difficulty = AI.DIFFICULTIES[difficulty] ? difficulty : 'normal';
    state.winsNeeded = wins === 1 || wins === 3 ? wins : 2;
    state.scores = { player: 0, opponent: 0, draws: 0 };
    state.played = 0;
    ui.abandon.textContent = '새 게임';
    ui.connStatus.hidden = true;
    ui.menuNotice.hidden = true;
    showScreen('game');
    startRound();
  }

  function onSetupChange() {
    var data = new FormData(ui.form);
    var difficulty = String(data.get('difficulty') || 'normal');
    ui.hint.textContent = HINTS[difficulty] || HINTS.normal;
  }

  function onGridClick(event) {
    var button = event.target.closest('.card');
    if (!button || !ui.grid.contains(button)) return;
    togglePick(Number(button.dataset.index));
  }

  function init() {
    if (!Cards || !AI || !Net || !ui.form || !ui.grid || !ui.menu || !ui.joinForm) {
      document.body.insertAdjacentHTML('beforeend', '<p class="status">게임을 불러오지 못했습니다.</p>');
      return;
    }
    ui.form.addEventListener('submit', onStart);
    ui.form.addEventListener('change', onSetupChange);
    ui.grid.addEventListener('click', onGridClick);
    ui.confirm.addEventListener('click', onConfirm);
    ui.next.addEventListener('click', function () {
      if (state.mode === 'online') {
        advanceOnline('next');
        return;
      }
      if (matchWinner()) return;
      startRound();
    });
    ui.rematch.addEventListener('click', function () { advanceOnline('rematch'); });
    ui.restart.addEventListener('click', showAiSetup);
    ui.abandon.addEventListener('click', function () {
      if (state.mode === 'online') leaveOnline('');
      else showAiSetup();
    });
    ui.menuAi.addEventListener('click', function () {
      ui.menuNotice.hidden = true;
      showAiSetup();
    });
    ui.menuOnline.addEventListener('click', function () {
      ui.menuNotice.hidden = true;
      showOnlineHome();
    });
    ui.setupBack.addEventListener('click', function () {
      ui.menuNotice.hidden = true;
      showMenu();
    });
    ui.onlineBack.addEventListener('click', function () { leaveOnline(''); });
    ui.createRoom.addEventListener('click', createRoom);
    ui.joinForm.addEventListener('submit', function (event) {
      event.preventDefault();
      joinRoom(ui.joinCode.value);
    });
    ui.copyCode.addEventListener('click', function () { copyText(ui.roomCode.textContent || ''); });
    ui.copyLink.addEventListener('click', function () {
      copyText(ui.shareUrl.dataset.url || ui.shareUrl.textContent || '');
    });
    document.addEventListener('visibilitychange', function () {
      if (state.phase === 'memorize') tick();
    });
    onSetupChange();
    var autoCode = Net.parseRoomQuery(window.location.search);
    if (autoCode) joinRoom(autoCode);
    else showMenu();
  }

  init();
})();
