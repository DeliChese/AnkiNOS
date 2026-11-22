(function initBrainExerHub() {
  'use strict';
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBrainExerHub, {once: true});
    return;
  }
  if (!document.getElementById('brainexer-page') || window.NOSBrainExerHub) return;
  const $ = name => document.getElementById('brainexer-' + name);
  const modes = {
    multiple_choice: ['Nhớ và phân biệt', 'Chọn đáp án từ nội dung thẻ'],
    fill_blank: ['Ngữ cảnh', 'Điền từ trong câu ví dụ'],
    phrase: ['Nhớ và phân biệt', 'Nhận diện cụm từ'],
    sentence: ['Ngữ cảnh', 'Đặt câu dùng từ đã học'],
    listening: ['Nghe', 'Nghe câu và chép lại'],
    quick: ['Tốc độ', 'Trả lời trong 60 giây'],
    recall: ['Nhớ', 'Gõ đáp án ngắn'],
    explain: ['Hiểu', 'Giải thích bằng lời của bạn'],
    application: ['Vận dụng', 'Áp dụng kiến thức vào tình huống'],
    review: ['Ôn lại', 'Ôn các lỗi đến hạn'],
    matching: ['Ghép cặp', 'Ghép thuật ngữ với định nghĩa'],
    word_hunter: ['Thợ săn từ', 'Chọn từ trước khi hết giờ'],
    unscramble: ['Sắp xếp chữ', 'Xếp chữ thành đáp án'],
    listening_reflex: ['Phản xạ nghe', 'Nhận diện từ sau khi nghe'],
  };
  const language = new Set(['multiple_choice', 'fill_blank', 'phrase', 'sentence', 'listening', 'quick',
    'review', 'matching', 'word_hunter', 'unscramble', 'listening_reflex']);
  const knowledge = new Set(['multiple_choice', 'quick', 'recall', 'explain', 'application', 'review', 'matching']);
  const games = new Set(['matching', 'word_hunter', 'unscramble', 'listening_reflex']);
  const aiModes = new Set(['sentence', 'listening', 'explain', 'application']);
  const icons = {multiple_choice:'target', fill_blank:'file', phrase:'link', sentence:'spark',
    listening:'play', quick:'bolt', recall:'search', explain:'info', application:'puzzle',
    review:'sync', matching:'grid', word_hunter:'down', unscramble:'list', listening_reflex:'clock'};
  const base = document.querySelector('script[src*="brainexer-hub.js"]')?.src.replace(/assets\/brainexer-hub\.js.*$/, '') || '';
  let sequence = 1000000, pending = null, status = null, decks = [], runToken = 0;
  let mode = '', sessionId = 0, current = null, itemId = 0, answered = false;
  let count = 0, correctCount = 0, score = 0, combo = 0, clock = null, fallTimer = null,
    seconds = 0, started = 0, confidence = '';
  let activeTab = 'practice', busy = false, highscore = {}, progress = {}, libraryReplay = false, usedHint = false,
    hintLevel = 0, libraryItems = [], awaitingSelf = false, listenCount = 0;
  let reflexCardIds = [];
  let retrySourceSessionId = 0, summarySourceSessionId = 0;

  function request(method, args = {}) {
    if (pending) return Promise.reject(Error('Đang xử lý yêu cầu trước.'));
    return new Promise((resolve, reject) => {
      const request_id = ++sequence;
      const timer = setTimeout(() => {
        pending = null;
        reject(Error('Yêu cầu chưa phản hồi. Hãy thử lại.'));
      }, aiModes.has(mode) || method === 'hub_next' || method === 'listening_generate' || method === 'hub_reflex_prepare'
        || method === 'listening_respeed'
        ? Math.max(330000, (status?.config?.request_timeout_seconds || 60) * 2000 + 60000)
        : 30000);
      pending = {request_id, resolve, reject, timer};
      window.AnkiNOS.brainexerCommand({method, request_id, ...args});
    });
  }
  function receive(payload) {
    if (payload.request_id !== pending?.request_id) return;
    const {resolve, reject, timer} = pending;
    pending = null;
    clearTimeout(timer);
    payload.error ? reject(Error(payload.error)) : resolve(payload.data);
  }
  function endSessionSilently(id) {
    if (id && window.AnkiNOS?.brainexerCommand)
      window.AnkiNOS.brainexerCommand({method: 'hub_session_end', request_id: ++sequence,
        session_id: id});
  }
  function text(tag, content, className = '') {
    const element = document.createElement(tag);
    element.textContent = String(content ?? '');
    if (className) element.className = className;
    return element;
  }
  function message(content, error = false) {
    $('status').textContent = content;
    $('status').hidden = !content;
    $('status').classList.toggle('brainexer-error', error);
  }
  function updateTtsUsed(result) {
    if (!status || typeof result?.tts_used !== 'number') return;
    status.tts_used = result.tts_used;
    window.dispatchEvent(new CustomEvent('brainexer-tts-usage', {detail: result.tts_used}));
  }
  function updateUsage(result) {
    if (!status || !result?.usage) return;
    status.usage = result.usage;
    window.dispatchEvent(new CustomEvent('brainexer-usage', {detail: result.usage}));
  }
  async function action(label, operation) {
    if (busy) return;
    busy = true;
    message(label);
    try {
      await operation();
      $('hub-retry').hidden = true;
      if ($('status').textContent === label) message('');
    } catch (error) {
      message(error.message, true);
      $('hub-retry').hidden = $('hub-run').hidden || !mode;
    } finally {
      busy = false;
      $('hub-submit').disabled = false;
      $('hub-next').disabled = false;
      renderModes();
    }
  }
  function deck() {
    return decks.find(item => item.id === $('hub-deck').value);
  }
  function deckKind() {
    const names = deck()?.name.split('::') || [];
    for (let i = names.length; i; i--) {
      const kind = status?.deck_kinds?.[names.slice(0, i).join('::')];
      if (kind) return kind;
    }
    return '';
  }
  function audioPreferenceKey() {
    return status && deck() ? `nos-brainexer-audio:${status.profile_folder}:${deck().name}` : '';
  }
  function setPlaybackSpeed(raw, persist = true) {
    const parsed = Number(raw);
    const speed = Number.isFinite(parsed) ? Math.round(Math.min(2.5, Math.max(0.1, parsed)) * 100) / 100 : 1;
    const label = `${speed.toFixed(2).replace('.', ',')}×`;
    for (const name of ['hub-speed', 'hub-playback-speed']) $(name).value = String(speed);
    for (const name of ['hub-speed-value', 'hub-playback-speed-value']) $(name).textContent = label;
    $('hub-player').playbackRate = speed;
    if (persist) saveAudioPreference();
  }
  function restoreAudioPreference() {
    const key = audioPreferenceKey();
    if (!key) {
      setPlaybackSpeed(1, false);
      return;
    }
    $('hub-voice').value = status.voices['en-US'];
    let speed = 1;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      if (Array.from($('hub-voice').options).some(option => option.value === saved.voice))
        $('hub-voice').value = saved.voice;
      if (saved.speed !== null && saved.speed !== '' && Number.isFinite(Number(saved.speed))) speed = saved.speed;
    } catch { /* File URL storage may be disabled by WebEngine. */ }
    setPlaybackSpeed(speed, false);
  }
  function saveAudioPreference() {
    const key = audioPreferenceKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify({voice: $('hub-voice').value, speed: $('hub-speed').value}));
    } catch { /* Preference is optional when WebEngine disables storage. */ }
  }
  function renderModes() {
    if (!status) return;
    const kind = deckKind();
    $('hub-kind').value = kind;
    $('hub-question-field').disabled = $('hub-answer-field').disabled = !kind || busy;
    $('hub-progress-levels').hidden = kind !== 'knowledge';
    $('hub-confidence-summary').hidden = kind !== 'knowledge';
    if (kind === 'knowledge') {
      $('hub-progress-levels').replaceChildren(...[
        ['remember', 'Nhớ'], ['understand', 'Hiểu'], ['apply', 'Vận dụng'],
      ].map(([key, label]) => text('span', `${label}: ${progress[key]?.correct || 0}/${progress[key]?.count || 0} câu`)));
      const sure = progress.confidence?.sure || {count: 0, wrong: 0};
      const guess = progress.confidence?.guess || {count: 0, wrong: 0};
      $('hub-confidence-summary').textContent = `Tưởng biết: ${sure.wrong}/${sure.count} câu chọn Chắc nhưng sai · Đoán đúng: ${guess.count - guess.wrong}/${guess.count} câu.`;
    }
    $('hub-voice-controls').hidden = kind !== 'language';
    $('hub-explain').textContent = kind
      ? 'Lịch ôn thẻ Anki không đổi. Kết quả luyện tập lưu riêng trong ANOS.'
      : 'Chọn loại bộ thẻ một lần để xem các dạng bài phù hợp.';
    for (const [container, game] of [[$('hub-practice-modes'), false], [$('hub-game-modes'), true]]) {
      container.replaceChildren();
      const ids = game ? Object.keys(modes) : kind === 'language'
        ? ['multiple_choice','phrase','fill_blank','sentence','listening','quick','review']
        : ['recall','multiple_choice','quick','explain','application','review'];
      for (const id of ids) {
        const [group, description] = modes[id];
        if (games.has(id) !== game || (kind === 'language' && !language.has(id))
            || (kind === 'knowledge' && !knowledge.has(id)) || !kind) continue;
        const button = text('button', '', 'brainexer-mode-card');
        button.type = 'button';
        button.dataset.mode = id;
        button.title = group;
        button.disabled = busy;
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.classList.add('icon', 'brainexer-mode-icon');
        icon.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', `#i-${icons[id]}`);
        icon.append(use);
        button.append(icon, text('strong', status.hub_modes[id] || id), text('span', description));
        if (game) button.append(text('em', `Kỷ lục: ${highscore[id] || 0} điểm`));
        container.append(button);
      }
    }
  }
  function setStatus(value) {
    status = value;
    $('hub-voice').replaceChildren(...Object.entries(value.voices).map(([locale, voice]) => {
      const option = text('option', `${locale} · ${voice}`);
      option.value = voice;
      return option;
    }));
    $('hub-voice').value = value.voices['en-US'];
    restoreAudioPreference();
    renderModes();
  }
  function setDecks(value) {
    decks = value.decks;
    $('hub-deck').replaceChildren(...decks.map(item => {
      const option = text('option', item.name);
      option.value = item.id;
      return option;
    }));
    $('hub-deck').value = value.selected;
    restoreAudioPreference();
    renderModes();
    loadHighscores();
  }
  async function loadHighscores() {
    if (!deck() || pending) return;
    busy = true;
    renderModes();
    try {
      highscore = await request('hub_highscores', {deck_name: deck().name});
      const data = await request('hub_fields', {deck_id: deck().id,
        include_children: $('hub-children').checked});
      for (const [name, selected] of [['question-field', data.roles.question_field],
                                      ['answer-field', data.roles.answer_field]]) {
        const select = $('hub-' + name);
        select.replaceChildren(...['', ...data.fields].map(field => {
          const option = text('option', field || 'Tự nhận diện');
          option.value = field;
          return option;
        }));
        select.value = selected;
      }
      progress = deckKind() === 'knowledge'
        ? await request('hub_progress', {deck_name: deck().name}) : {};
    } catch (error) {
      message(error.message, true);
    } finally {
      busy = false;
      renderModes();
    }
  }
  function stopClock() {
    clearInterval(clock);
    clearTimeout(fallTimer);
    clock = null;
    fallTimer = null;
  }
  function startClock(duration) {
    stopClock();
    seconds = duration;
    $('hub-progress').textContent = `Còn ${seconds} giây`;
    clock = setInterval(() => {
      seconds--;
      $('hub-progress').textContent = `Còn ${Math.max(seconds, 0)} giây · ${correctCount}/${count} đúng`;
      if (seconds <= 0) finish();
    }, 1000);
  }
  function showRun() {
    $('practice').hidden = $('game').hidden = $('listening').hidden = true;
    $('hub-run').hidden = false;
    $('hub-summary').hidden = true;
  }
  function showTab() {
    $('hub-run').hidden = true;
    $('practice').hidden = activeTab !== 'practice';
    $('game').hidden = activeTab !== 'game';
    $('listening').hidden = activeTab !== 'listening';
  }
  async function begin(selected, sourceSessionId = 0) {
    if (!deckKind()) return;
    const token = ++runToken;
    mode = selected;
    retrySourceSessionId = selected === 'review' ? sourceSessionId : 0;
    libraryReplay = false;
    sessionId = itemId = count = correctCount = score = combo = 0;
    answered = false;
    awaitingSelf = false;
    confidence = '';
    reflexCardIds = [];
    $('hub-retry').hidden = true;
    if (mode === 'listening_reflex') {
      let prepared = false;
      await action('Đang chuẩn bị âm thanh trước khi chơi…', async () => {
        const preparation = await request('hub_reflex_prepare', {deck_id: deck().id,
          include_children: $('hub-children').checked, voice: $('hub-voice').value});
        updateTtsUsed(preparation);
        reflexCardIds = preparation.card_ids || [];
        prepared = true;
      });
      if (!prepared || token !== runToken) return;
    }
    showRun();
    $('hub-run').dataset.mode = mode;
    $('hub-run').dataset.untimed = String(status.config.game_seconds === 0);
    $('hub-run-title').textContent = status.hub_modes[mode];
    if (mode === 'quick' && status.config.quick_seconds > 0) startClock(status.config.quick_seconds);
    else if (games.has(mode) && status.config.game_seconds > 0) startClock(status.config.game_seconds);
    await next();
  }
  async function next() {
    if (libraryReplay && count) return finish();
    const token = runToken;
    let noMore = false;
    await action('Đang chuẩn bị câu hỏi…', async () => {
      const selected = deck();
      if (!selected) throw Error('Hãy chọn bộ thẻ.');
      let result;
      if (mode === 'review') {
        result = await request('hub_review_next', {deck_id: selected.id, deck_name: selected.name,
          kind: deckKind(), session_id: sessionId,
          include_children: $('hub-children').checked,
          source_session_id: retrySourceSessionId});
        if (!result.question) {
          noMore = true;
          return;
        }
      } else if (mode === 'listening') {
        const voice = $('hub-voice')?.value || status.voices['en-US'];
        result = await request('listening_generate', {deck_id: selected.id,
          include_children: $('hub-children').checked, voice, speed: '1', session_id: sessionId});
        updateTtsUsed(result);
        updateUsage(result);
        itemId = result.item_id;
        result.question = {id: result.exercise_id, mode, prompt: 'Nghe và chép lại câu', options: [],
          audio_hash: result.audio_hash, hint_initials: result.hint_initials,
          hint_translation: result.hint_translation};
      } else {
        result = await request('hub_next', {
          deck_id: selected.id, kind: deckKind(), mode,
          include_children: $('hub-children').checked, session_id: sessionId,
          voice: $('hub-voice').value,
          card_ids: reflexCardIds,
        });
        updateUsage(result);
      }
      if (token !== runToken) {
        endSessionSilently(result.session_id);
        return;
      }
      sessionId = result.session_id || sessionId;
      current = result.question;
      answered = false;
      awaitingSelf = false;
      confidence = '';
      usedHint = false;
      hintLevel = 0;
      listenCount = 0;
      started = performance.now();
      renderQuestion();
    });
    if (noMore && token === runToken) {
      if (sessionId) await finish();
      else {
        showTab();
        message('Hôm nay chưa có lỗi đến hạn.');
      }
    }
  }
  function renderQuestion() {
    const question = current;
    $('hub-question').hidden = false;
    $('hub-options').hidden = false;
    $('hub-question').textContent = question.prompt;
    $('hub-answer').value = '';
    $('hub-feedback').hidden = true;
    $('hub-feedback').replaceChildren();
    $('hub-next').hidden = true;
    $('hub-submit').hidden = false;
    $('hub-options').replaceChildren();
    if (mode === 'matching') {
      for (const pair of question.pairs || []) {
        const label = text('label', pair.left, 'brainexer-match-row');
        const select = document.createElement('select');
        select.append(text('option', 'Chọn đáp án'));
        select.firstChild.value = '';
        for (const right of question.right_options || []) {
          const option = text('option', right);
          option.value = right;
          select.append(option);
        }
        label.append(select);
        $('hub-options').append(label);
      }
    } else for (const value of question.options || []) {
      const button = text('button', value, 'subtle-button');
      button.type = 'button';
      button.dataset.option = value;
      $('hub-options').append(button);
    }
    if (mode === 'unscramble') {
      const clear = text('button', 'Xóa chữ', 'subtle-button');
      clear.type = 'button';
      clear.dataset.clearLetters = 'true';
      $('hub-options').append(clear);
    }
    const choices = (question.options || []).length && mode !== 'unscramble';
    $('hub-answer-label').hidden = (!!choices && mode !== 'word_hunter') || mode === 'matching';
    $('hub-confidence').hidden = deckKind() !== 'knowledge' || games.has(mode) || mode === 'review';
    $('hub-audio').hidden = !question.audio_hash;
    $('hub-listens').textContent = mode === 'listening' && status.config.max_listens_per_sentence
      ? `Lượt nghe: ${listenCount}/${status.config.max_listens_per_sentence}` : '';
    $('hub-hints').hidden = mode !== 'listening' && mode !== 'unscramble';
    $('hub-hint').textContent = 'Gợi ý';
    if (question.audio_hash) {
      const scriptBase = base || document.querySelector('script[src*="dashboard.js"]')?.src.replace(/assets\/dashboard\.js.*$/, '') || '';
      const profileFolder = status.profile_folder;
      $('hub-player').src = `${scriptBase}user_files/${profileFolder}/brainexer_audio/${question.audio_hash}.mp3`;
      $('hub-player').playbackRate = Number($('hub-speed').value);
      $('hub-player').play().catch(() => {});
    }
    $('hub-progress').textContent = clock ? `Còn ${seconds} giây` : `${count + 1}. câu`;
    clearTimeout(fallTimer);
    if (mode === 'word_hunter' && status.config.game_seconds > 0) {
      const duration = Math.max(3000, 8000 - count * 350);
      $('hub-options').style.setProperty('--fall-duration', `${duration}ms`);
      fallTimer = setTimeout(() => {
        if (!answered && current === question) {
          $('hub-answer').value = 'Hết giờ';
          submit();
        }
      }, duration);
    }
    $('hub-question').focus();
  }
  async function submit() {
    if (!current || answered || awaitingSelf || busy) return;
    const token = runToken;
    const answer = mode === 'matching' ? JSON.stringify(Array.from(
      $('hub-options').querySelectorAll('select'), select => select.value)) : $('hub-answer').value.trim();
    if (mode === 'matching' && Array.from($('hub-options').querySelectorAll('select')).some(select => !select.value)) {
      message('Hãy ghép đủ các cặp trước khi nộp.', true);
      return;
    }
    if (!answer) {
      message('Hãy nhập hoặc chọn câu trả lời.', true);
      return;
    }
    if (deckKind() === 'knowledge' && mode !== 'review' && !games.has(mode) && !confidence) {
      message('Hãy chọn mức tự tin trước khi xem đáp án.', true);
      return;
    }
    $('hub-submit').disabled = true;
    clearTimeout(fallTimer);
    await action('Đang chấm câu trả lời…', async () => {
      let feedback;
      if (mode === 'review') {
        feedback = await request('hub_review', {mistake_id: current.id,
          exercise_id: current.exercise_id, answer,
          response_ms: Math.round(performance.now() - started)});
      } else if (mode === 'listening') {
        feedback = await request('listening_answer', {item_id: itemId, answer,
          exercise_id: current.id, hint: usedHint,
          response_ms: Math.round(performance.now() - started)});
        feedback.correct = feedback.accuracy === 1;
        feedback.answers = [feedback.sentence];
      } else {
        feedback = await request('hub_answer', {exercise_id: current.id, answer, confidence,
          hint: usedHint, response_ms: Math.round(performance.now() - started)});
        updateUsage(feedback);
      }
      if (token !== runToken) return;
      if (feedback.needs_self_check) {
        awaitingSelf = true;
        const target = $('hub-feedback');
        target.replaceChildren(text('strong', 'Tự đối chiếu lời giải'),
          ...(feedback.reason ? [text('p', feedback.reason)] : []),
          text('p', `Đáp án tham chiếu: ${feedback.answers.join(' / ')}`),
          text('p', feedback.explanation || 'Hãy đối chiếu các bước làm với nội dung thẻ.'));
        for (const [points, label] of [[10, 'Đúng'], [5, 'Một phần'], [0, 'Chưa đúng']]) {
          const button = text('button', label, 'subtle-button');
          button.type = 'button';
          button.dataset.selfScore = String(points);
          target.append(button);
        }
        target.hidden = false;
        $('hub-submit').hidden = true;
        return;
      }
      acceptFeedback(feedback);
    });
  }
  function acceptFeedback(feedback) {
    answered = true;
    awaitingSelf = false;
    count++;
    if (feedback.correct) correctCount++;
    combo = feedback.correct ? combo + 1 : 0;
    score += Number(feedback.score || 0) + Number(feedback.combo_bonus || 0);
    renderFeedback(feedback);
    if (games.has(mode) && combo > 1) $('hub-feedback').append(text('p', `Chuỗi đúng: ${combo}`));
    $('hub-next').hidden = false;
    $('hub-submit').hidden = true;
    $('hub-progress').textContent = `${correctCount}/${count} đúng` +
      (games.has(mode) || deckKind() === 'language' ? ` · ${Math.round(score)} điểm` : '');
  }
  function renderFeedback(result) {
    const target = $('hub-feedback');
    target.replaceChildren(text('strong', result.correct ? 'Đúng' : 'Cần ôn thêm'));
    if (result.answers?.length) target.append(text('p', `Đáp án · ${result.answers.join(' / ')}`));
    if (result.explanation) target.append(text('p', result.explanation));
    if (result.feedback?.summary) target.append(text('p', result.feedback.summary));
    if (result.feedback?.strengths?.length) {
      target.append(text('h3', 'Đúng ý chính'));
      const list = text('ul', '');
      list.append(...result.feedback.strengths.map(item => text('li', item)));
      target.append(list);
    }
    if (result.feedback?.errors?.length) {
      target.append(text('h3', 'Thiếu ý hoặc sai khái niệm'));
      const list = text('ul', '');
      list.append(...result.feedback.errors.map(item =>
        text('li', `${item.original_text} → ${item.corrected_text}. ${item.explanation}`)));
      target.append(list);
    }
    if (result.feedback?.style_suggestions?.length) {
      target.append(text('p', result.feedback.style_suggestions.map(item => item.note).join(' · ')));
    }
    if (result.alignment) target.append(text('p', result.alignment.map(row =>
      `${row.kind === 'correct' ? '✓' : row.kind === 'missing' ? 'Thiếu' : row.kind === 'extra' ? 'Thừa' : 'Sai'} ${row.expected || row.actual}`).join(' · ')));
    if (result.suggest_mastered) target.append(text('p', 'Bạn có thể đánh dấu lỗi này đã thuộc trong Sổ lỗi.'));
    if (result.attempt_id && (mode === 'explain' || mode === 'application')) {
      const form = text('details', '');
      form.append(text('summary', 'Tôi không đồng ý với điểm AI'));
      const input = document.createElement('input');
      input.type = 'number'; input.min = '0'; input.max = '10'; input.step = '0.5';
      input.value = String(result.score);
      input.setAttribute('aria-label', 'Điểm bạn chọn');
      const reason = document.createElement('textarea');
      reason.maxLength = 1000;
      reason.placeholder = 'Lý do (tùy chọn)';
      reason.setAttribute('aria-label', 'Lý do ghi đè');
      const save = text('button', 'Lưu điểm của tôi', 'subtle-button');
      save.type = 'button'; save.dataset.override = result.attempt_id;
      save.dataset.originalScore = result.score;
      form.append(input, reason, save);
      target.append(form);
    }
    target.hidden = false;
  }
  async function finish() {
    stopClock();
    if (busy) {
      setTimeout(() => { if (!$('hub-run').hidden) finish(); }, 250);
      return;
    }
    if (!sessionId) {
      showTab();
      return;
    }
    await action('Đang tổng kết phiên…', async () => {
      const summary = await request('hub_summary', {session_id: sessionId, finish: true});
      if (games.has(mode)) {
        const best = await request('hub_score', {deck_name: deck().name, game: mode, score: Math.round(score)});
        highscore[mode] = best;
      }
      if (deckKind() === 'knowledge') {
        progress = await request('hub_progress', {deck_name: deck().name});
        renderModes();
      }
      $('hub-summary').replaceChildren(
        text('h3', 'Tổng kết phiên'),
        text('p', `${summary.correct} / ${summary.count} câu đúng` +
          (games.has(mode) || deckKind() === 'language' ? ` · ${Math.round(score)} điểm` : '')),
        text('p', `Thời gian trả lời: ${Math.floor(summary.duration_ms / 60000)} phút ${Math.round((summary.duration_ms % 60000) / 1000)} giây`),
        text('p', `${summary.mistakes} ${mode === 'review' ? 'câu cần ôn thêm' : 'lỗi cần xem lại'}`),
      );
      const retry = text('button', 'Luyện lại câu sai', 'subtle-button');
      retry.type = 'button';
      retry.dataset.summaryAction = 'review';
      retry.hidden = !summary.mistakes;
      const ledger = text('button', 'Mở Sổ lỗi', 'subtle-button');
      ledger.type = 'button';
      ledger.dataset.summaryAction = 'mistakes';
      $('hub-summary').append(retry, ledger);
      $('hub-summary').hidden = false;
      $('hub-question').hidden = $('hub-answer-label').hidden = $('hub-options').hidden =
        $('hub-submit').hidden = $('hub-next').hidden = $('hub-confidence').hidden = true;
      current = null;
      summarySourceSessionId = sessionId;
      sessionId = 0;
      runToken++;
      libraryReplay = false;
      mode = '';
    });
  }
  function reset(closeSession = true) {
    stopClock();
    runToken++;
    if (closeSession) endSessionSilently(sessionId);
    current = null;
    sessionId = 0;
    mode = '';
    retrySourceSessionId = summarySourceSessionId = 0;
    reflexCardIds = [];
    libraryReplay = false;
    awaitingSelf = false;
    $('hub-retry').hidden = true;
    if (!closeSession) {
      status = null;
      decks = [];
      highscore = {};
      progress = {};
    }
    showTab();
  }

  $('hub-deck').addEventListener('change', () => { restoreAudioPreference(); renderModes(); loadHighscores(); });
  $('hub-children').addEventListener('change', loadHighscores);
  $('hub-voice').addEventListener('change', saveAudioPreference);
  for (const name of ['hub-speed', 'hub-playback-speed']) {
    $(name).addEventListener('input', event => setPlaybackSpeed(event.target.value));
  }
  async function saveFieldRoles() {
    const question_field = $('hub-question-field').value;
    const answer_field = $('hub-answer-field').value;
    if (Boolean(question_field) !== Boolean(answer_field)) return;
    if (question_field === answer_field && question_field) {
      message('Hãy chọn hai trường khác nhau.', true);
      return;
    }
    await action('Đang lưu vai trò trường…', async () => {
      await request('hub_set_fields', {deck_name: deck().name, kind: deckKind(),
        question_field, answer_field});
      message(question_field ? 'Đã lưu vai trò trường cho bộ thẻ.' : 'Đã bật tự nhận diện trường.');
    });
  }
  $('hub-question-field').addEventListener('change', saveFieldRoles);
  $('hub-answer-field').addEventListener('change', saveFieldRoles);
  $('hub-kind').addEventListener('change', () => {
    const item = deck();
    if (!item || !$('hub-kind').value) return;
    action('Đang lưu loại bộ thẻ…', async () => {
      await request('deck_kind', {deck_name: item.name, kind: $('hub-kind').value});
      status.deck_kinds[item.name] = $('hub-kind').value;
      renderModes();
    });
  });
  $('hub-practice-modes').addEventListener('click', event => {
    const button = event.target.closest('[data-mode]');
    if (button) begin(button.dataset.mode);
  });
  $('hub-game-modes').addEventListener('click', event => {
    const button = event.target.closest('[data-mode]');
    if (button) begin(button.dataset.mode);
  });
  $('hub-options').addEventListener('click', event => {
    if (event.target.closest('[data-clear-letters]')) {
      $('hub-answer').value = '';
      $('hub-options').querySelectorAll('[data-option]').forEach(button => { button.disabled = false; });
      return;
    }
    const button = event.target.closest('[data-option]');
    if (!button) return;
    if (mode === 'unscramble') {
      $('hub-answer').value += button.dataset.option;
      button.disabled = true;
      $('hub-answer').focus();
      return;
    }
    $('hub-answer').value = button.dataset.option;
    $('hub-options').querySelectorAll('button').forEach(item =>
      item.setAttribute('aria-pressed', String(item === button)));
    if (mode === 'word_hunter' || mode === 'listening_reflex') submit();
  });
  $('hub-confidence').addEventListener('click', event => {
    const button = event.target.closest('[data-confidence]');
    if (!button) return;
    confidence = button.dataset.confidence;
    $('hub-confidence').querySelectorAll('button').forEach(item =>
      item.setAttribute('aria-pressed', String(item === button)));
  });
  $('hub-submit').addEventListener('click', submit);
  $('hub-next').addEventListener('click', next);
  $('hub-retry').addEventListener('click', () => {
    if (current && !answered) submit();
    else next();
  });
  $('hub-exit').addEventListener('click', finish);
  $('hub-summary').addEventListener('click', event => {
    const action = event.target.closest('[data-summary-action]')?.dataset.summaryAction;
    if (action === 'review') begin('review', summarySourceSessionId);
    if (action === 'mistakes') document.querySelector('[data-brainexer-view="mistakes"]')?.click();
  });
  $('hub-feedback').addEventListener('click', event => {
    const selfButton = event.target.closest('[data-self-score]');
    if (selfButton && awaitingSelf) {
      const token = runToken;
      action('Đang lưu kết quả tự đối chiếu…', async () => {
        const args = mode === 'review'
          ? {mistake_id: current.id, exercise_id: current.exercise_id,
             answer: $('hub-answer').value.trim(),
             response_ms: Math.round(performance.now() - started),
             self_score: Number(selfButton.dataset.selfScore)}
          : {exercise_id: current.id, answer: $('hub-answer').value.trim(), confidence,
             response_ms: Math.round(performance.now() - started),
             self_score: Number(selfButton.dataset.selfScore)};
        const feedback = await request(mode === 'review' ? 'hub_review' : 'hub_answer', args);
        if (token === runToken) acceptFeedback(feedback);
      });
      return;
    }
    const button = event.target.closest('[data-override]');
    if (!button) return;
    const form = button.closest('details');
    const revised = Number(form.querySelector('input').value);
    if (!Number.isFinite(revised) || revised < 0 || revised > 10) {
      message('Điểm cần từ 0 đến 10.', true);
      return;
    }
    action('Đang lưu điểm của bạn…', async () => {
      await request('hub_override', {attempt_id: Number(button.dataset.override),
        score: revised, reason: form.querySelector('textarea').value});
      score += revised - Number(button.dataset.originalScore);
      button.dataset.originalScore = String(revised);
      form.append(text('p', 'Đã lưu điểm bạn chọn cùng lý do trong lịch sử ghi đè.'));
      form.open = false;
    });
  });
  $('hub-replay').addEventListener('click', () => {
    if (mode === 'listening' && status.config.max_listens_per_sentence &&
        listenCount >= status.config.max_listens_per_sentence) {
      message('Đã đạt số lượt nghe tối đa của câu này.', true);
      return;
    }
    $('hub-player').currentTime = 0;
    $('hub-player').play().catch(() => {});
  });
  $('hub-player').addEventListener('play', () => {
    if (mode !== 'listening' || $('hub-player').currentTime > .2) return;
    const limit = status.config.max_listens_per_sentence;
    if (limit && listenCount >= limit) {
      $('hub-player').pause();
      message('Đã đạt số lượt nghe tối đa của câu này.', true);
      return;
    }
    listenCount++;
    $('hub-listens').textContent = limit ? `Lượt nghe: ${listenCount}/${limit}` : '';
  });
  $('hub-hint').addEventListener('click', () => {
    if (!current || answered) return;
    usedHint = true;
    hintLevel++;
    if (mode === 'unscramble') {
      $('hub-hint').textContent = `Chữ đầu: ${current.hint || 'Chưa có'}`;
      return;
    }
    $('hub-hint').textContent = hintLevel === 1
      ? `Chữ đầu: ${current.hint_initials || 'Không có'}`
      : `Dịch: ${current.hint_translation || 'Chưa có bản dịch'}`;
  });
  function renderLibrary(rows) {
    libraryItems = rows;
    for (const [name, values] of [
      ['deck', [...new Set(rows.map(row => row.deck_name))]],
      ['level', [...new Set(rows.map(row => row.level).filter(Boolean))]],
    ]) {
      const select = $('hub-library-' + name);
      const currentValue = select.value;
      select.replaceChildren(...['', ...values].map(value => {
        const option = text('option', value || 'Tất cả');
        option.value = value;
        return option;
      }));
      select.value = currentValue;
    }
    const deckFilter = $('hub-library-deck').value;
    const levelFilter = $('hub-library-level').value;
    const accuracyFilter = $('hub-library-accuracy').value;
    rows = rows.filter(row => (!deckFilter || row.deck_name === deckFilter)
      && (!levelFilter || row.level === levelFilter)
      && (!accuracyFilter || (accuracyFilter === 'wrong'
        ? row.attempts > 0 && row.last_accuracy < 1 : row.best_accuracy >= 1)));
    $('hub-library').replaceChildren(...rows.map(row => {
      const card = text('article', '', 'brainexer-library-item');
      card.append(text('p', row.sentence),
        text('small', `${row.deck_name} · ${row.level || 'Theo bộ thẻ'} · ${row.word_count} từ · ${row.voice} · Bản ghi gốc: ${row.speed === 'slow-normal' ? 'chậm rồi thường' : row.speed + '×'} · ${row.attempts} lượt · tốt nhất ${Math.round(row.best_accuracy * 100)}%`));
      try {
        const targets = JSON.parse(row.targets || '[]');
        if (targets.length) card.append(text('small', `Từ mục tiêu: ${targets.join(', ')}`));
      } catch { /* A corrupt row is rejected by the database validator during backup. */ }
      if (row.translation) card.append(text('p', row.translation, 'brainexer-meta'));
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = `${base}user_files/${status.profile_folder}/brainexer_audio/${row.audio_hash}.mp3`;
      const speed = Number($('hub-speed').value) || 1;
      audio.playbackRate = speed;
      const speedControl = text('label', 'Tốc độ phát', 'brainexer-speed-control');
      const speedValue = text('output', `${speed.toFixed(2).replace('.', ',')}×`);
      const speedInput = document.createElement('input');
      speedInput.type = 'range';
      speedInput.min = '0.1';
      speedInput.max = '2.5';
      speedInput.step = '0.01';
      speedInput.value = String(speed);
      speedInput.setAttribute('aria-label', 'Tốc độ phát từ 0,1 đến 2,5 lần');
      speedInput.className = 'brainexer-library-speed';
      speedControl.append(speedValue, speedInput);
      card.append(audio, speedControl);
      const actions = text('div', '', 'brainexer-actions');
      for (const [name, label] of [['replay', 'Chép lại'], ['pin', row.pinned ? 'Bỏ ghim' : 'Ghim'], ['delete', 'Xóa']]) {
        const button = text('button', label, 'subtle-button');
        button.type = 'button';
        button.dataset.libraryAction = name;
        button.dataset.itemId = row.id;
        button.dataset.pinned = row.pinned ? 'true' : 'false';
        actions.append(button);
      }
      card.append(actions);
      return card;
    }));
  }
  async function loadLibrary() {
    await action('Đang tải thư viện…', async () => {
      renderLibrary(await request('listening_library'));
    });
  }
  $('hub-library-refresh').addEventListener('click', loadLibrary);
  $('hub-library-wrong').addEventListener('click', () => {
    $('hub-library-accuracy').value = 'wrong';
    renderLibrary(libraryItems);
    const replay = $('hub-library').querySelector('[data-library-action="replay"]');
    if (replay) replay.click();
    else message('Chưa có câu chép sai trong Thư viện.');
  });
  $('hub-library-cleanup').addEventListener('click', () => {
    if (!window.confirm('Xóa audio chưa ghim đã lưu để giải phóng dung lượng?')) return;
    action('Đang dọn audio…', async () => {
      const result = await request('listening_cleanup');
      renderLibrary(await request('listening_library'));
      message(`Đã dọn ${result.removed} tệp audio, giải phóng ${Math.round(result.freed_bytes / 1048576)} MB.`);
    });
  });
  for (const name of ['deck', 'level', 'accuracy']) {
    $('hub-library-' + name).addEventListener('change', () => renderLibrary(libraryItems));
  }
  $('hub-library').addEventListener('input', event => {
    if (!event.target.matches('.brainexer-library-speed')) return;
    const card = event.target.closest('.brainexer-library-item');
    const speed = Number(event.target.value);
    card.querySelector('audio').playbackRate = speed;
    card.querySelector('output').textContent = `${speed.toFixed(2).replace('.', ',')}×`;
  });
  $('hub-library').addEventListener('click', event => {
    const button = event.target.closest('[data-library-action]');
    if (!button) return;
    const item_id = Number(button.dataset.itemId);
    if (button.dataset.libraryAction === 'delete' && !window.confirm('Xóa câu nghe này khỏi Thư viện?')) return;
    action('Đang xử lý câu nghe…', async () => {
      if (button.dataset.libraryAction === 'replay') {
        const result = await request('listening_replay', {item_id});
        mode = 'listening';
        libraryReplay = true;
        sessionId = result.session_id;
        itemId = result.item_id;
        count = correctCount = score = 0;
        answered = usedHint = false;
        listenCount = 0;
        awaitingSelf = false;
        hintLevel = 0;
        current = result.question;
        showRun();
        $('hub-run').dataset.mode = mode;
        $('hub-run-title').textContent = 'Nghe & chép';
        renderQuestion();
      } else {
        await request(button.dataset.libraryAction === 'pin' ? 'listening_pin' : 'listening_delete',
          {item_id, pinned: button.dataset.pinned !== 'true'});
        renderLibrary(await request('listening_library'));
      }
    });
  });
  document.getElementById('brainexer-page').addEventListener('keydown', event => {
    if ($('hub-run').hidden || !current) return;
    if (event.key === 'Enter' && !event.shiftKey &&
        (event.target.tagName !== 'TEXTAREA' || mode === 'word_hunter')) {
      event.preventDefault();
      answered ? next() : submit();
    }
    if (/^[1-4]$/.test(event.key) && $('hub-options').children.length && event.target.tagName !== 'TEXTAREA') {
      const button = $('hub-options').children[Number(event.key) - 1];
      button?.click();
    }
    if (event.ctrlKey && event.key === 'Enter' && !$('hub-audio').hidden) {
      event.preventDefault();
      $('hub-replay').click();
    }
  });
  window.addEventListener('brainexer-status', event => setStatus(event.detail));
  window.addEventListener('brainexer-decks', event => setDecks(event.detail));
  window.addEventListener('brainexer-tab', event => {
    const changed = event.detail !== activeTab;
    activeTab = event.detail;
    if (changed && (mode || !$('hub-run').hidden)) reset();
    if (activeTab === 'listening' && status) loadLibrary();
  });
  window.NOSBrainExerHub = {receive, reset};
})();
