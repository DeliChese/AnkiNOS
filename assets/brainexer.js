(function initBrainExer() {
  'use strict';
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBrainExer, {once: true});
    return;
  }
  const $ = id => document.getElementById('brainexer-' + id);
  const page = $('page');
  if (!page || window.NOSBrainExer) return;

  const native = document.getElementById('nos-app').dataset.native === 'true' || typeof window.pycmd === 'function';
  const tabs = ['practice', 'game', 'mistakes', 'listening', 'settings'];
  const models = {openai: 'model', deepseek: 'deepseek_model', gemini: 'gemini_model'};
  const mistakeTypes = {grammar: 'Ngữ pháp', word_choice: 'Chọn từ', spelling: 'Chính tả', nuance: 'Sắc thái', word_form: 'Từ loại', other: 'Khác'};
  const format = new Intl.NumberFormat('vi-VN');
  const settings = $('settings-form');
  const controls = settings.elements;
  let tab = 'practice', status = null, exercise = null, answered = false, working = false;
  let sequence = 0, pending = null, offset = 0;

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function request(method, args = {}) {
    const request_id = ++sequence;
    const timeout = method === 'generate' || method === 'submit' ? 330000 : 20000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending = null;
        reject(new Error('BrainExer chưa phản hồi. Hãy thử lại.'));
      }, timeout);
      pending = {request_id, resolve, reject, timer};
      window.AnkiNOS.brainexerCommand({method, request_id, ...args});
    });
  }

  function receive(payload) {
    if (pending?.request_id !== payload.request_id) {
      window.NOSBrainExerHub?.receive(payload);
      return;
    }
    const {timer, resolve, reject} = pending;
    pending = null;
    clearTimeout(timer);
    if (payload.error) {
      if (status && payload.data?.usage) renderUsage(payload.data.usage);
      reject(new Error(payload.error));
    } else resolve(payload.data);
  }

  function message(text = '', error = false) {
    $('status').textContent = text;
    $('status').classList.toggle('brainexer-error', error);
    $('status').hidden = !text;
  }

  function ready() {
    return status && !status.keyring_error && status.keys[status.config.provider] && status.config.ai_data_consent;
  }

  function renderControls() {
    const upcoming = !working && !!status;
    $('generate').querySelector('fieldset').disabled = !upcoming || !$('deck').options.length;
    $('create').disabled = !ready();
    settings.querySelector('fieldset').disabled = !upcoming;
    $('answer').readOnly = answered;
    $('submit').disabled = working || !exercise || answered || (exercise.type === 'multiple_choice' && !$('answer').value);
    $('mastered').disabled = !upcoming;
    $('more').disabled = !upcoming;
    $('import').disabled = !upcoming;
    $('delete-key').disabled = !upcoming || !status.keys[$('provider').value];
    page.querySelectorAll('[data-brainexer-view], [data-mistake-id]').forEach(button => { button.disabled = working; });
    $('options').querySelectorAll('button').forEach(button => { button.disabled = working || answered; });
  }

  async function perform(label, task, onError) {
    if (working) return;
    working = true;
    renderControls();
    message(label);
    try {
      await task();
      if ($('status').textContent === label) message();
    } catch (error) {
      message(error.message, true);
      onError?.();
    } finally {
      working = false;
      renderControls();
    }
  }

  function option([value, label]) {
    const element = node('option', label);
    element.value = value;
    return element;
  }

  function setOptions(select, choices, selected) {
    select.replaceChildren(...choices.map(option));
    if (Array.from(select.options).some(option => option.value === selected)) select.value = selected;
  }

  function renderUsage(usage) {
    const formatLimit = (used, limit) => `${format.format(used)}/${format.format(status.config[limit])}`;
    $('usage').replaceChildren(
      node('strong', status.providers[status.config.provider]),
      node('span', `Hôm nay · ${formatLimit(usage.exercise_day, 'max_exercises_per_day')} bài · ${formatLimit(usage.api_day, 'max_api_calls_per_day')} lượt AI`),
      node('span', `Tuần này · ${formatLimit(usage.exercise_week, 'max_exercises_per_week')} bài · ${formatLimit(usage.api_week, 'max_api_calls_per_week')} lượt AI`),
      node('span', `Azure Speech tháng này · ${format.format(status.tts_used || 0)}/${format.format(status.config.max_tts_chars_per_month)} ký tự`)
    );
    $('usage').hidden = false;
  }

  function renderProvider() {
    const provider = $('provider').value;
    const model = $('model');
    model.value = status.config[models[provider]];
    $('key').value = '';
    controls.ai_data_consent.checked = provider === status.config.provider && status.config.ai_data_consent;
    $('key-status').textContent = status.keyring_error || (status.keys[provider]
      ? 'Đã có khóa trong kho bảo mật của hệ điều hành. Để trống ô API key để giữ khóa hiện tại.'
      : 'Khóa sẽ được lưu trong kho bảo mật của hệ điều hành.');
    $('azure-key-status').textContent = status.keys.azure
      ? 'Đã lưu khóa Azure Speech. Để trống ô khóa để giữ khóa hiện tại.'
      : 'Chưa có khóa Azure Speech trong kho bảo mật của hồ sơ.';
    $('consent-label').textContent = `Tôi đồng ý gửi nội dung văn bản từ các thẻ được lấy mẫu và bài viết đã nộp tới ${status.providers[provider]} để tạo và chấm bài.`;
    renderControls();
  }

  function applyStatus(data) {
    status = data;
    const type = $('type');
    const selected = type.value;
    const exercises = Object.entries(status.exercises);
    const knowledge = node('optgroup');
    knowledge.label = 'Kiến thức';
    const language = node('optgroup');
    language.label = 'Ngoại ngữ';
    for (const entry of exercises) {
      const group = status.knowledge_types.includes(entry[0]) ? knowledge : language;
      group.append(option(entry));
    }
    type.replaceChildren(knowledge, language);
    if (Object.hasOwn(status.exercises, selected)) type.value = selected;
    setOptions($('provider'), Object.entries(status.providers), status.config.provider);
    for (const [key, value] of Object.entries(status.config)) {
      const field = controls.namedItem(key);
      if (!field || key === 'provider') continue;
      if (field.type === 'checkbox') field.checked = value;
      else field.value = value;
    }
    renderProvider();
    renderUsage(status.usage);
    $('setup').hidden = !!ready();
    $('setup-text').textContent = status.keyring_error || 'Thêm API key và xác nhận chia sẻ dữ liệu để tạo bài tập.';
    $('import-section').hidden = !status.can_import;
    window.dispatchEvent(new CustomEvent('brainexer-status', {detail: status}));
  }

  function load() {
    return perform('Đang tải BrainExer…', async () => {
      $('retry').hidden = true;
      const data = await request('status');
      const {decks, selected} = await request('decks');
      setOptions($('deck'), decks.map(({id, name}) => [id, name]), $('deck').value || selected);
      applyStatus(data);
      window.dispatchEvent(new CustomEvent('brainexer-decks', {detail: {decks, selected}}));
      $('mistake-deck').replaceChildren(option(['', 'Tất cả bộ thẻ']),
        ...decks.map(({id, name}) => option([name, name])));
      if (tab === 'mistakes') await loadMistakes();
    }, () => { $('retry').hidden = false; });
  }

  function showTab(next) {
    if (tab === next) return;
    $('key').value = '';
    tab = next;
    for (const item of tabs) $(item).hidden = item !== tab;
    page.querySelectorAll('.brainexer-nav button').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.brainexerView === tab));
    });
    if (native) message();
    if (tab === 'mistakes' && status) refreshMistakes();
    window.dispatchEvent(new CustomEvent('brainexer-tab', {detail: tab}));
  }

  function renderExercise() {
    const item = exercise;
    $('question').hidden = !item;
    $('empty').hidden = !!item;
    $('feedback').hidden = true;
    $('feedback').replaceChildren();
    $('answer').value = '';
    if (!item) return;
    $('source').textContent = `${item.deck_name} · ${status.exercises[item.type]}`;
    $('prompt').textContent = item.question_prompt;
    const instructions = [];
    if (item.suggested_length) instructions.push(`Độ dài gợi ý · ${item.suggested_length}`);
    if (item.target_words_to_use.length) instructions.push(`Từ gợi ý · ${item.target_words_to_use.join(', ')}`);
    $('instructions').textContent = instructions.join('\n');
    $('instructions').hidden = !instructions.length;
    $('hint').hidden = !item.hint;
    $('hint').open = false;
    $('hint').querySelector('p').textContent = item.hint;
    const multipleChoice = item.type === 'multiple_choice';
    $('answer-label').hidden = $('answer').hidden = multipleChoice;
    $('answer').required = !multipleChoice;
    $('options').replaceChildren(...item.options.map(option => {
      const button = node('button', option, 'subtle-button');
      button.type = 'button';
      button.dataset.answer = option;
      button.setAttribute('aria-pressed', 'false');
      return button;
    }));
    $('options').hidden = !item.options.length;
    if (!page.hidden && tab === 'practice') $('prompt').focus();
  }

  function renderFeedback({feedback, score}) {
    const target = $('feedback');
    target.replaceChildren(node('h3', `Kết quả · ${format.format(score)}/10`));
    if (exercise.type === 'application') {
      const scores = [
        ['Độ chính xác', feedback.accuracy_score], ['Lập luận', feedback.reasoning_score], ['Mức rõ ràng', feedback.clarity_score],
      ];
      target.append(node('p', scores.map(([label, point]) => `${label} ${format.format(point)}/10`).join(' · '), 'brainexer-meta'));
    }
    if (feedback.summary) target.append(node('p', feedback.summary));
    if (feedback.correct_answers?.length) target.append(node('p', `Đáp án chấp nhận · ${feedback.correct_answers.join(', ')}`));
    if (feedback.explanation) target.append(node('p', feedback.explanation));
    if (feedback.strengths?.length) target.append(node('p', `Điểm mạnh · ${feedback.strengths.join(' · ')}`));
    for (const [title, rows] of [
      ['Lỗi cần xem lại', feedback.errors?.map(error => `${error.original_text} → ${error.corrected_text}\n${error.explanation}`)],
      ['Gợi ý diễn đạt', feedback.style_suggestions?.map(item => `${item.suggested_text}\n${item.note}`)],
    ]) {
      if (!rows?.length) continue;
      const list = node('ul');
      list.append(...rows.map(row => node('li', row)));
      target.append(node('h4', title), list);
    }
    if (feedback.corrected_full_text) {
      const correction = node('details');
      const label = exercise.type === 'application' ? 'Xem câu trả lời mẫu' : 'Xem bài viết đã sửa';
      correction.append(node('summary', label), node('p', feedback.corrected_full_text));
      target.append(correction);
    }
    target.hidden = false;
  }

  async function loadMistakes(append = false) {
    const rows = await request('hub_mistakes', {
      include_mastered: $('mastered').checked, due_only: $('mistake-due').checked,
      deck_name: $('mistake-deck').value, kind: $('mistake-kind').value,
      state: $('mistake-state').value,
      min_wrong: Number($('mistake-min-wrong').value) || 1,
      due_before: $('mistake-before').value,
      offset: append ? offset : 0,
    });
    if (!append) {
      offset = 0;
      $('mistake-list').replaceChildren();
    }
    for (const row of rows.slice(0, 40)) {
      const li = node('li');
      const kind = {meaning: 'Nghĩa', spelling: 'Chính tả', listening: 'Nghe', usage: 'Dùng từ',
        concept: 'Khái niệm', confidence: 'Tưởng biết'}[row.kind] || mistakeTypes[row.kind] || 'Khác';
      const origin = status.hub_modes[row.exercise_type] || status.exercises[row.exercise_type] || row.exercise_type;
      li.append(node('p', `${row.deck_name} · ${kind} · ${row.mastered ? 'Đã thuộc' :
        row.review_count ? 'Đang ôn' : 'Mới'} · ${row.due_date ? 'Đến hạn ' + row.due_date : 'Chưa hẹn'} · Sai ${row.wrong_count} lần · ${origin}${row.source_card_id ? ' · Thẻ ' + row.source_card_id : ''}`, 'brainexer-meta'));
      if (row.prompt) li.append(node('p', row.prompt));
      li.append(
        node('p', row.original_text, 'brainexer-original'),
        node('strong', row.corrected_text),
        node('p', row.explanation)
      );
      const actions = node('div', null, 'brainexer-actions');
      const available = [['mastered', row.mastered ? 'Đánh dấu cần ôn' : 'Đánh dấu đã thuộc']];
      if (status.config.allow_anki_mistake_export) available.push(
        ['add_mistake', row.linked_anki_note_id ? 'Kiểm tra thẻ Anki' : 'Tạo thẻ Anki']);
      for (const [action, label] of available) {
        const button = node('button', label, 'subtle-button');
        Object.assign(button.dataset, {mistakeId: row.id, method: action, mastered: !row.mastered});
        actions.append(button);
      }
      li.append(actions);
      $('mistake-list').append(li);
    }
    offset += Math.min(rows.length, 40);
    $('mistakes-empty').hidden = offset > 0;
    $('more').hidden = rows.length <= 40;
  }

  function refreshMistakes(append = false) {
    return perform('Đang tải sổ lỗi…', () => loadMistakes(append));
  }

  page.addEventListener('click', event => {
    const tabButton = event.target.closest('[data-brainexer-view]');
    if (tabButton) showTab(tabButton.dataset.brainexerView);
    const option = event.target.closest('[data-answer]');
    if (option && !answered && !working) {
      $('answer').value = option.dataset.answer;
      selectOption();
      if (!$('answer').hidden) $('answer').focus();
    }
    const action = event.target.closest('[data-mistake-id]');
    if (action) {
      const {method, mistakeId, mastered} = action.dataset;
      if (method === 'add_mistake' && !window.confirm('Tạo thẻ Anki từ lỗi này? Thẻ mới sẽ thuộc lịch ôn Anki.')) return;
      perform('Đang cập nhật sổ lỗi…', async () => {
        await request(method, {mistake_id: Number(mistakeId), mastered: mastered === 'true'});
        await loadMistakes();
        if (method === 'add_mistake') message('Thẻ đã có trong BrainExer::Mistakes.');
      });
    }
  });

  function selectOption() {
    $('options').querySelectorAll('button').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.answer === $('answer').value));
    });
    renderControls();
  }

  $('answer').addEventListener('input', selectOption);
  $('retry').addEventListener('click', load);
  $('mastered').addEventListener('change', () => refreshMistakes());
  $('mistake-deck').addEventListener('change', () => refreshMistakes());
  $('mistake-kind').addEventListener('change', () => refreshMistakes());
  $('mistake-due').addEventListener('change', () => refreshMistakes());
  $('mistake-state').addEventListener('change', () => refreshMistakes());
  $('mistake-min-wrong').addEventListener('change', () => refreshMistakes());
  $('mistake-before').addEventListener('change', () => refreshMistakes());
  $('more').addEventListener('click', () => refreshMistakes(true));
  $('provider').addEventListener('change', renderProvider);

  $('generate').addEventListener('submit', event => {
    event.preventDefault();
    if (!ready()) return;
    perform('Đang đọc bộ thẻ và tạo bài tập…', async () => {
      const data = await request('generate', {
        deck_id: $('deck').value, exercise_type: $('type').value, include_children: $('children').checked,
      });
      exercise = data.exercise;
      answered = false;
      renderUsage(data.usage);
      $('import-section').hidden = true;
      renderExercise();
    });
  });

  $('answer-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!exercise || answered) return;
    const graded = exercise.type === 'writing_free' || exercise.type === 'application';
    perform(graded ? 'AI đang chấm bài…' : 'Đang kiểm tra câu trả lời…', async () => {
      const data = await request('submit', {exercise_id: exercise.id, answer: $('answer').value});
      answered = true;
      renderUsage(data.usage);
      renderFeedback(data.result);
    });
  });

  settings.addEventListener('submit', event => {
    event.preventDefault();
    perform('Đang lưu cài đặt AI…', async () => {
      const values = {...status.config, [models[$('provider').value]]: $('model').value.trim()};
      for (const field of controls) {
        if (!field.name) continue;
        values[field.name] = field.type === 'checkbox' ? field.checked
          : field.type === 'number' ? field.valueAsNumber : field.value.trim();
      }
      const api_key = $('key').value;
      const azure_key = $('azure-key').value;
      $('key').value = '';
      $('azure-key').value = '';
      applyStatus(await request('settings', {values, api_key, azure_key}));
      message('Đã lưu cài đặt AI.');
    });
  });

  $('delete-key').addEventListener('click', () => {
    const provider = $('provider').value;
    if (!window.confirm(`Xóa API key ${status.providers[provider]} khỏi kho khóa của hồ sơ này?`)) return;
    perform('Đang xóa API key…', async () => {
      const data = await request('delete_key', {provider});
      status.keys = data.keys;
      status.keyring_error = data.keyring_error;
      renderProvider();
      $('setup').hidden = !!ready();
      message('Đã xóa API key.');
    });
  });

  $('import').addEventListener('click', () => perform('Đang nhập dữ liệu cũ…', async () => {
    await request('import_legacy');
    applyStatus(await request('status'));
    message('Đã nhập phiên luyện và sổ lỗi vào hồ sơ hiện tại.');
  }));

  function open() {
    if (!native) {
      message('Mở ANOS trong Anki để luyện tập với bộ thẻ của bạn.');
      return;
    }
    if (!status) load();
  }

  function reset() {
    status = exercise = null;
    answered = false;
    window.NOSBrainExerHub?.reset(false);
    $('usage').hidden = $('setup').hidden = $('import-section').hidden = true;
    $('mistake-list').replaceChildren();
    renderExercise();
    renderControls();
    if (!page.hidden) open();
  }

  renderControls();
  window.addEventListener('brainexer-tts-usage', event => {
    if (!status) return;
    status.tts_used = event.detail;
    renderUsage(status.usage);
  });
  window.addEventListener('brainexer-usage', event => {
    if (!status) return;
    status.usage = event.detail;
    renderUsage(status.usage);
  });
  window.NOSBrainExer = {open, receive, reset, showTab};
})();
