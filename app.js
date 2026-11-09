/* 國中教甄知識刷題室 — 無後端靜態版 v1.0
 * 所有個人資料僅儲存在瀏覽器 localStorage。
 * 匯入的題目一律使用 textContent 渲染，避免 HTML 注入。
 */
(function () {
  'use strict';
  const $ = function (id) { return document.getElementById(id); };
  const KEY = { custom: 'jte.custom.v1', attempts: 'jte.attempts.v1', wrong: 'jte.wrong.v1', bookmarks: 'jte.bookmarks.v1' };
  const LETTERS = 'ABCDEF';
  const MAX_IMPORT = 3000;
  const MAX_FILE_BYTES = 4 * 1024 * 1024;
  let demoQuestions = [];
  let customQuestions = [];
  let attempts = [];
  let wrongIds = [];
  let bookmarkIds = [];
  let session = null;
  let toastTimer = null;
  let dataLoaded = false;

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (error) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (error) { toast('儲存失敗：瀏覽器儲存空間不足或禁止存取。請匯出資料備份。'); return false; }
  }
  function toast(message) {
    const node = $('toast');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.hidden = true; }, 4500);
  }
  function textNode(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value === undefined || value === null ? '' : String(value);
    return node;
  }
  function safeArray(value) { return Array.isArray(value) ? value : []; }
  function uniqueStrings(value) { return Array.from(new Set(safeArray(value).filter(function (v) { return typeof v === 'string'; }))); }
  function shortText(str, max) {
    const value = String(str || '').trim();
    return value.length > max ? value.slice(0, max) + '…' : value;
  }
  function hashText(str) {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
  function normalizeQuestion(item, index, kind) {
    if (!item || typeof item !== 'object') return null;
    const stem = typeof item.stem === 'string' ? item.stem.trim() : (typeof item.question === 'string' ? item.question.trim() : '');
    const sourceOptions = item.options || item.choices;
    if (!stem || !Array.isArray(sourceOptions) || sourceOptions.length < 2 || sourceOptions.length > 6) return null;
    const options = sourceOptions.map(function (x) { return typeof x === 'string' ? x.trim() : ''; });
    if (options.some(function (x) { return !x; })) return null;
    let answer = item.answer;
    if (typeof answer === 'string') {
      const a = answer.trim().toUpperCase();
      answer = /^[A-F]$/.test(a) ? LETTERS.indexOf(a) : (/^\d+$/.test(a) ? Number(a) : -1);
    }
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) return null;
    const rawId = (typeof item.id === 'string' || typeof item.id === 'number') ? String(item.id).trim() : '';
    const id = rawId || 'USR-' + hashText(stem + '||' + options.join('||'));
    const explanations = item.optionExplanations;
    return {
      id: id, kind: kind, stem: stem, options: options, answer: answer,
      category: typeof item.category === 'string' && item.category.trim() ? item.category.trim() : '其他',
      topic: typeof item.topic === 'string' ? item.topic.trim() : '',
      year: item.year === undefined || item.year === null ? null : String(item.year),
      exam: kind === 'demo' ? '原創示範題（非歷屆原題）' : (typeof item.exam === 'string' && item.exam.trim() ? item.exam.trim() : '自行匯入題庫'),
      explanation: typeof item.explanation === 'string' ? item.explanation.trim() : '',
      optionExplanations: Array.isArray(explanations) ? options.map(function (_, i) { return typeof explanations[i] === 'string' ? explanations[i].trim() : ''; }) : [],
      keyPoint: typeof item.keyPoint === 'string' ? item.keyPoint.trim() : '',
      trap: typeof item.trap === 'string' ? item.trap.trim() : '',
      mnemonic: typeof item.mnemonic === 'string' ? item.mnemonic.trim() : ''
    };
  }
  function normalizeAll(items, kind) {
    const seen = new Set();
    return safeArray(items).map(function (item, i) { return normalizeQuestion(item, i, kind); }).filter(function (item) {
      if (!item || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }
  function allQuestions() { return demoQuestions.concat(customQuestions); }
  function questionMap() {
    const map = new Map();
    allQuestions().forEach(function (q) { map.set(q.id, q); });
    return map;
  }
  function availableQuestions() {
    const mode = $('filter-mode').value;
    const category = $('filter-category').value;
    const bank = $('filter-bank').value;
    const attempted = new Set(attempts.map(function (a) { return a.id; }));
    return allQuestions().filter(function (q) {
      if (category !== 'all' && q.category !== category) return false;
      if (bank !== 'all' && q.kind !== bank) return false;
      if (mode === 'wrong' && !wrongIds.includes(q.id)) return false;
      if (mode === 'bookmark' && !bookmarkIds.includes(q.id)) return false;
      if (mode === 'unanswered' && attempted.has(q.id)) return false;
      return true;
    });
  }
  function updateCategories() {
    const select = $('filter-category');
    const selected = select.value;
    const categories = Array.from(new Set(allQuestions().map(function (q) { return q.category; }))).sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); });
    select.replaceChildren(new Option('全部領域', 'all'));
    categories.forEach(function (category) { select.add(new Option(category, category)); });
    select.value = categories.includes(selected) ? selected : 'all';
  }
  function updateAvailability() {
    const count = availableQuestions().length;
    $('available-count').textContent = '符合條件：' + count + ' 題';
    $('start-btn').disabled = count === 0;
    $('practice-wrong-btn').disabled = !wrongIds.some(function (id) { return questionMap().has(id); });
  }
  function showView(name) {
    if (!['home', 'practice', 'wrong', 'library'].includes(name)) name = 'home';
    ['home', 'practice', 'wrong', 'library'].forEach(function (id) {
      const visible = id === name;
      $('view-' + id).hidden = !visible;
      $('view-' + id).classList.toggle('active', visible);
    });
    document.querySelectorAll('[data-nav]').forEach(function (el) {
      if (el.classList.contains('nav-link')) {
        el.classList.toggle('active', el.dataset.nav === name);
        if (el.dataset.nav === name) el.setAttribute('aria-current', 'page');
        else el.removeAttribute('aria-current');
      }
    });
    if (name === 'home') renderHome();
    if (name === 'wrong') renderWrong();
    if (name === 'library') renderLibrary();
    if (name === 'practice') updateAvailability();
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    window.scrollTo(0, 0);
  }
  function renderHome() {
    const qs = allQuestions();
    const completed = attempts.filter(function (a) { return a.correct; }).length;
    $('stat-total').textContent = String(qs.length);
    $('stat-attempts').textContent = String(attempts.length);
    $('stat-accuracy').textContent = attempts.length ? Math.round(completed / attempts.length * 100) + '%' : '—';
    const countWrong = wrongIds.filter(function (id) { return questionMap().has(id); }).length;
    $('stat-wrong').textContent = String(countWrong);
    $('nav-wrong-count').textContent = String(countWrong);
    const counts = new Map();
    qs.forEach(function (q) { counts.set(q.category, (counts.get(q.category) || 0) + 1); });
    const block = $('category-breakdown');
    block.replaceChildren();
    $('category-total').textContent = counts.size + ' 個主題領域';
    if (!qs.length) { block.append(textNode('p', 'empty-copy', dataLoaded ? '目前尚無題目，請至題庫管理匯入。' : '正在載入題庫……')); return; }
    Array.from(counts.entries()).sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant'); }).forEach(function (entry) {
      const item = textNode('div', 'category-item', '');
      const top = textNode('div', 'category-top', '');
      top.append(textNode('span', '', entry[0]), textNode('span', '', entry[1] + ' 題'));
      const track = textNode('div', 'bar-track', '');
      const fill = textNode('div', 'bar-fill', '');
      fill.style.width = (entry[1] / qs.length * 100).toFixed(1) + '%';
      track.append(fill);
      item.append(top, track);
      block.append(item);
    });
  }
  function renderWrong() {
    const map = questionMap();
    const questions = wrongIds.map(function (id) { return map.get(id); }).filter(Boolean);
    $('wrong-summary').textContent = '待複習 ' + questions.length + ' 題';
    const list = $('wrong-list');
    list.replaceChildren();
    if (!questions.length) {
      const box = textNode('div', 'empty-state', '');
      box.append(textNode('div', 'empty-icon', '✓'), textNode('h3', '', '目前沒有待複習的錯題'), textNode('p', '', '完成一回練習後，答錯的題目會自動出現在這裡。'));
      const button = textNode('button', 'btn btn-primary', '開始綜合刷題');
      button.type = 'button';
      button.addEventListener('click', function () { showView('practice'); });
      box.append(button);
      list.append(box);
    } else {
      questions.forEach(function (q) {
        const card = textNode('article', 'panel wrong-item', '');
        const head = textNode('div', 'wrong-head', '');
        const left = textNode('div', '', '');
        left.append(textNode('span', 'topic-chip', q.category), textNode('h3', '', shortText(q.stem, 105)), textNode('p', '', q.topic || q.exam));
        head.append(left);
        const actions = textNode('div', 'wrong-actions', '');
        const practice = textNode('button', 'small-btn', '練習這一題');
        practice.type = 'button';
        practice.addEventListener('click', function () { startSession([q]); });
        const remove = textNode('button', 'text-danger', '移出錯題本');
        remove.type = 'button';
        remove.setAttribute('aria-label', '將題目 ' + q.id + ' 移出錯題本');
        remove.addEventListener('click', function () {
          wrongIds = wrongIds.filter(function (id) { return id !== q.id; });
          save(KEY.wrong, wrongIds);
          refreshUI();
          toast('已移出錯題本。');
        });
        actions.append(practice, remove);
        card.append(head, actions);
        list.append(card);
      });
    }
    updateAvailability();
  }
  function renderLibrary() {
    $('library-demo-count').textContent = String(demoQuestions.length);
    $('library-custom-count').textContent = String(customQuestions.length);
    $('library-bookmark-count').textContent = String(bookmarkIds.length);
    const sample = examplePayload();
    $('schema-preview').textContent = JSON.stringify(sample, null, 2);
  }
  function refreshUI() {
    updateCategories();
    updateAvailability();
    renderHome();
    renderLibrary();
    if (!$('view-wrong').hidden) renderWrong();
  }
  function shuffle(items) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = result[i]; result[i] = result[j]; result[j] = t;
    }
    return result;
  }
  function startFromFilters() {
    const questions = availableQuestions();
    if (!questions.length) {
      $('setup-status').textContent = '沒有符合條件的題目，請調整篩選方式或匯入題庫。';
      return;
    }
    const order = document.querySelector('input[name="order"]:checked').value;
    const ordered = order === 'random' ? shuffle(questions) : questions.slice().sort(function (a, b) { return a.id.localeCompare(b.id, 'zh-Hant', {numeric:true}); });
    const count = $('filter-count').value === 'all' ? ordered.length : Math.min(Number($('filter-count').value), ordered.length);
    startSession(ordered.slice(0, count));
  }
  function startSession(questions) {
    if (!questions.length) return;
    session = { questions: questions.slice(), index: 0, answers: [], selected: null };
    $('setup-status').textContent = '';
    $('setup-screen').hidden = true;
    $('summary-stage').hidden = true;
    $('quiz-stage').hidden = false;
    showView('practice');
    renderQuestion();
  }
  function renderQuestion() {
    if (!session) return;
    const q = session.questions[session.index];
    const answered = session.selected !== null;
    $('quiz-category').textContent = q.category + (q.topic ? ' · ' + q.topic : '');
    $('quiz-source').textContent = q.exam + (q.year ? ' · ' + q.year : '');
    $('progress-text').textContent = '第 ' + (session.index + 1) + ' 題 / 共 ' + session.questions.length + ' 題';
    $('progress-percent').textContent = Math.round((session.index + (answered ? 1 : 0)) / session.questions.length * 100) + '%';
    $('progress-bar').style.width = ((session.index + (answered ? 1 : 0)) / session.questions.length * 100) + '%';
    $('question-number').textContent = 'QUESTION ' + String(session.index + 1).padStart(2, '0');
    $('question-stem').textContent = q.stem;
    $('bookmark-btn').setAttribute('aria-pressed', String(bookmarkIds.includes(q.id)));
    $('bookmark-btn').textContent = bookmarkIds.includes(q.id) ? '★ 已收藏' : '☆ 加入收藏';
    $('answer-feedback').hidden = true;
    $('explanation-panel').hidden = true;
    $('next-btn').disabled = true;
    $('next-btn').textContent = session.index === session.questions.length - 1 ? '完成本回 →' : '下一題 →';
    const options = $('question-options');
    options.replaceChildren();
    q.options.forEach(function (choice, i) {
      const button = textNode('button', 'choice', '');
      button.type = 'button';
      button.append(textNode('span', 'letter', LETTERS[i]), textNode('span', 'choice-content', choice));
      button.addEventListener('click', function () { chooseAnswer(i); });
      options.append(button);
    });
  }
  function chooseAnswer(selected) {
    if (!session || session.selected !== null) return;
    const q = session.questions[session.index];
    if (!Number.isInteger(selected) || selected < 0 || selected >= q.options.length) return;
    session.selected = selected;
    const correct = selected === q.answer;
    session.answers.push({ id: q.id, selected: selected, correct: correct });
    attempts.push({ id: q.id, selected: selected, correct: correct, at: new Date().toISOString() });
    if (attempts.length > 10000) attempts = attempts.slice(-10000);
    save(KEY.attempts, attempts);
    if (correct) wrongIds = wrongIds.filter(function (id) { return id !== q.id; });
    else if (!wrongIds.includes(q.id)) wrongIds.push(q.id);
    save(KEY.wrong, wrongIds);
    Array.from($('question-options').children).forEach(function (button, i) {
      button.disabled = true;
      if (i === q.answer) button.classList.add('is-correct');
      else if (i === selected) button.classList.add('is-incorrect');
    });
    const feedback = $('answer-feedback');
    feedback.hidden = false;
    feedback.className = 'answer-feedback ' + (correct ? 'is-correct' : 'is-wrong');
    feedback.textContent = correct ? '✓ 答對了！請繼續閱讀詳解，鞏固考點。' : '✕ 本題答錯。正確答案是 ' + LETTERS[q.answer] + '，請閱讀下方解析。';
    renderExplanation(q);
    $('explanation-panel').hidden = false;
    $('next-btn').disabled = false;
    $('progress-percent').textContent = Math.round((session.index + 1) / session.questions.length * 100) + '%';
    $('progress-bar').style.width = ((session.index + 1) / session.questions.length * 100) + '%';
    refreshUI();
  }
  function addExplanationSection(target, title, content) {
    if (!content) return;
    const section = textNode('section', 'explanation-section', '');
    section.append(textNode('h4', '', title), textNode('p', '', content));
    target.append(section);
  }
  function renderExplanation(q) {
    const target = $('explanation-body');
    target.replaceChildren();
    addExplanationSection(target, '核心概念', q.explanation || '本題尚未提供整體詳解，可先依正確答案核對；後續可透過題庫 JSON 補齊。');
    const optionBlock = textNode('section', 'explanation-section', '');
    optionBlock.append(textNode('h4', '', '選項逐項解析'));
    q.options.forEach(function (option, i) {
      const line = textNode('div', 'explanation-option', '');
      line.append(textNode('strong', '', LETTERS[i] + (i === q.answer ? ' ✓' : '')), textNode('span', '', q.optionExplanations[i] || (i === q.answer ? '正確答案：' + option : '尚無此選項的個別解析。')));
      optionBlock.append(line);
    });
    target.append(optionBlock);
    addExplanationSection(target, '破題關鍵', q.keyPoint);
    addExplanationSection(target, '易錯觀念', q.trap);
    addExplanationSection(target, '考場記憶提示', q.mnemonic);
  }
  function nextQuestion() {
    if (!session || session.selected === null) return;
    if (session.index === session.questions.length - 1) { finishSession(); return; }
    session.index += 1;
    session.selected = null;
    renderQuestion();
    $('quiz-stage').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function finishSession() {
    if (!session) return;
    const answered = session.answers.length;
    const correct = session.answers.filter(function (a) { return a.correct; }).length;
    $('quiz-stage').hidden = true;
    $('summary-stage').hidden = false;
    $('summary-score').textContent = answered ? Math.round(correct / answered * 100) + '%' : '—';
    $('summary-correct').textContent = correct + ' / ' + answered;
    $('summary-wrong').textContent = String(answered - correct);
    $('summary-bookmark').textContent = String(bookmarkIds.length);
    session = null;
    refreshUI();
    window.scrollTo(0, 0);
  }
  function exitSession() {
    session = null;
    $('quiz-stage').hidden = true;
    $('summary-stage').hidden = true;
    $('setup-screen').hidden = false;
    updateAvailability();
    window.scrollTo(0, 0);
  }
  function toggleBookmark() {
    if (!session) return;
    const id = session.questions[session.index].id;
    if (bookmarkIds.includes(id)) bookmarkIds = bookmarkIds.filter(function (saved) { return saved !== id; });
    else bookmarkIds.push(id);
    save(KEY.bookmarks, bookmarkIds);
    $('bookmark-btn').setAttribute('aria-pressed', String(bookmarkIds.includes(id)));
    $('bookmark-btn').textContent = bookmarkIds.includes(id) ? '★ 已收藏' : '☆ 加入收藏';
    refreshUI();
  }
  function examplePayload() {
    return {version:1,questions:[{
      id:'MY-001',category:'教育心理學',topic:'學習理論',year:'115',
      exam:'自建練習題',stem:'這裡填入題目敘述，下列何者正確？',
      options:['選項 A','選項 B','選項 C','選項 D'],answer:1,
      explanation:'整體概念詳解。',optionExplanations:['A 的解析','B 的解析','C 的解析','D 的解析'],
      keyPoint:'破題關鍵。',trap:'常見迷思。',mnemonic:'考場記憶提示。'
    }]};
  }
  function downloadJson(name, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2) + '\n'], {type:'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = name;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }
  async function importQuestions(file) {
    if (!file) return;
    const status = $('import-status');
    if (file.size > MAX_FILE_BYTES) { status.textContent = '檔案超過 4MB，請分批匯入。'; return; }
    try {
      const data = JSON.parse(await file.text());
      const items = Array.isArray(data) ? data : data && data.questions;
      if (!Array.isArray(items)) throw new Error('JSON 格式不正確：需要陣列或 questions 陣列。');
      if (items.length > MAX_IMPORT) throw new Error('一次最多可處理 3,000 題，請分批匯入。');
      const existingIds = new Set(allQuestions().map(function (q) { return q.id; }));
      let invalid = 0, duplicate = 0;
      const accepted = [];
      items.forEach(function (entry, i) {
        const q = normalizeQuestion(entry, i, 'custom');
        if (!q) { invalid++; return; }
        if (existingIds.has(q.id)) { duplicate++; return; }
        existingIds.add(q.id);
        accepted.push(q);
      });
      if (!accepted.length) {
        status.textContent = '未新增題目：格式錯誤 ' + invalid + ' 題，重複 ID ' + duplicate + ' 題。';
        return;
      }
      const next = customQuestions.concat(accepted);
      if (!save(KEY.custom, next)) { status.textContent = '儲存失敗，請確認瀏覽器空間。'; return; }
      customQuestions = next;
      refreshUI();
      status.textContent = '成功匯入 ' + accepted.length + ' 題；格式不合 ' + invalid + ' 題；重複略過 ' + duplicate + ' 題。';
      toast('題庫匯入完成，新增 ' + accepted.length + ' 題。');
    } catch (error) {
      status.textContent = '匯入失敗：' + (error.message || '無法讀取 JSON 檔案。');
    } finally {
      $('import-file').value = '';
    }
  }
  function exportProgress() {
    downloadJson('教甄刷題-學習紀錄.json', {
      version:1, exportedAt:new Date().toISOString(),
      attempts:attempts, wrongIds:wrongIds, bookmarkIds:bookmarkIds
    });
  }
  async function importProgress(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { toast('學習紀錄檔案超過 4MB。'); return; }
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || !Array.isArray(parsed.attempts) || !Array.isArray(parsed.wrongIds) || !Array.isArray(parsed.bookmarkIds)) {
        throw new Error('不是有效的學習紀錄備份。');
      }
      const cleanedAttempts = parsed.attempts.filter(function (a) {
        return a && typeof a.id === 'string' && typeof a.correct === 'boolean' &&
          Number.isInteger(a.selected) && a.selected >= 0 && a.selected <= 5 &&
          typeof a.at === 'string';
      }).slice(-10000);
      if (!window.confirm('將以備份內容取代目前的學習紀錄（不影響題庫）。確定匯入嗎？')) return;
      attempts = cleanedAttempts;
      wrongIds = uniqueStrings(parsed.wrongIds);
      bookmarkIds = uniqueStrings(parsed.bookmarkIds);
      save(KEY.attempts, attempts);
      save(KEY.wrong, wrongIds);
      save(KEY.bookmarks, bookmarkIds);
      refreshUI();
      toast('已還原學習紀錄。');
    } catch (error) { toast('匯入失敗：' + (error.message || 'JSON 格式錯誤。')); }
    finally { $('import-progress-file').value = ''; }
  }
  async function loadDemo() {
    try {
      const response = await fetch('./data/questions.json', {cache:'no-store'});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const payload = await response.json();
      const entries = Array.isArray(payload) ? payload : payload.questions;
      if (!Array.isArray(entries)) throw new Error('題庫結構不正確');
      demoQuestions = normalizeAll(entries, 'demo');
      if (!demoQuestions.length) throw new Error('沒有有效示範題目');
    } catch (error) {
      $('setup-status').textContent = '示範題庫讀取失敗（' + error.message + '）。請確認 data/questions.json 是否已發布，或匯入個人題庫。';
      toast('示範題庫暫時無法讀取。');
    } finally {
      dataLoaded = true;
      refreshUI();
    }
  }
  function init() {
    customQuestions = normalizeAll(read(KEY.custom, []), 'custom');
    attempts = safeArray(read(KEY.attempts, [])).filter(function (a) { return a && typeof a.id === 'string' && typeof a.correct === 'boolean'; });
    wrongIds = uniqueStrings(read(KEY.wrong, []));
    bookmarkIds = uniqueStrings(read(KEY.bookmarks, []));
    document.querySelectorAll('[data-nav]').forEach(function (node) {
      node.addEventListener('click', function (event) {
        if (node.tagName === 'A') event.preventDefault();
        showView(node.dataset.nav);
      });
    });
    ['filter-mode', 'filter-category', 'filter-bank', 'filter-count'].forEach(function (id) {
      $(id).addEventListener('change', function () { $('setup-status').textContent = ''; updateAvailability(); });
    });
    $('setup-form').addEventListener('submit', function (event) { event.preventDefault(); startFromFilters(); });
    $('bookmark-btn').addEventListener('click', toggleBookmark);
    $('next-btn').addEventListener('click', nextQuestion);
    $('exit-btn').addEventListener('click', exitSession);
    $('again-btn').addEventListener('click', exitSession);
    $('practice-wrong-btn').addEventListener('click', function () {
      $('filter-mode').value = 'wrong';
      $('filter-category').value = 'all';
      $('filter-bank').value = 'all';
      startFromFilters();
    });
    $('import-file').addEventListener('change', function (event) { importQuestions(event.target.files[0]); });
    $('download-sample').addEventListener('click', function () { downloadJson('教甄刷題-題庫格式範例.json', examplePayload()); });
    $('export-progress').addEventListener('click', exportProgress);
    $('export-custom').addEventListener('click', function () {
      downloadJson('教甄刷題-我的題庫.json', {version:1,questions:customQuestions.map(function (q) {
        const copy = Object.assign({}, q);
        delete copy.kind;
        return copy;
      })});
    });
    $('import-progress-file').addEventListener('change', function (event) { importProgress(event.target.files[0]); });
    $('import-progress-btn').addEventListener('click', function () { $('import-progress-file').click(); });
    $('reset-progress').addEventListener('click', function () {
      if (!window.confirm('確定清除作答紀錄、錯題本及收藏嗎？已匯入的題庫會保留。')) return;
      attempts = []; wrongIds = []; bookmarkIds = [];
      save(KEY.attempts, attempts); save(KEY.wrong, wrongIds); save(KEY.bookmarks, bookmarkIds);
      exitSession();
      refreshUI();
      toast('學習紀錄已清除，個人題庫仍保留。');
    });
    document.addEventListener('keydown', function (event) {
      if ($('view-practice').hidden || $('quiz-stage').hidden || !session) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 6 && session.selected === null) {
        chooseAnswer(digit - 1);
      } else if (event.key === 'Enter' && session.selected !== null && document.activeElement.tagName !== 'BUTTON') {
        nextQuestion();
      }
    });
    renderLibrary();
    const incoming = location.hash.slice(1);
    showView(['home', 'practice', 'wrong', 'library'].includes(incoming) ? incoming : 'home');
    loadDemo();
  }
  init();
})();
