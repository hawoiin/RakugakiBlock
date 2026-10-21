/* らくがきブロック v20.49 - テレフォンゲーム・思い出帳・怪談モード */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const Bridge = window.RakugakiPhoneBridge;
  if (!Bridge) { console.error('らくがきブロック: phone bridge is missing'); return; }
  const COLORS = ['#111111', '#e53935', '#fb8c00', '#fdd835', '#7cb342', '#2e7d32', '#00acc1', '#1e88e5', '#3949ab', '#8e24aa', '#d81b60', '#6d4c41', '#ffffff'];
  let state = null;
  let errorText = '';
  let draftKey = '';
  let draftText = '';
  let draftDrawing = '';
  let drawColor = '#111111';
  let drawSize = 5;
  let drawingPointer = null;
  let lastPoint = null;
  let countdownTimer = null;
  let memoryPanel = null; // null | 'list' | { type: 'detail', record }
  let memoryItems = [];
  let memoryLoadStatus = '';
  let memorySaveStatus = '';
  let lastArchiveStartedId = '';

  // 思い出帳は参加者それぞれのブラウザ内に保存する。サーバー負荷や共有ワールドの保存量は増やさない。
  const MEMORY_DB = 'rakugaki-phone-memory';
  const MEMORY_STORE = 'games';
  const MEMORY_MAX_GAMES = 10;
  const MEMORY_MAX_TOTAL_BYTES = 24 * 1024 * 1024; // UTF-16の概算サイズ
  const MEMORY_MAX_ITEM_BYTES = 12 * 1024 * 1024;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  }
  function send(t, extra) {
    if (!Bridge.id) { showError('先にワールドへ参加してください'); return; }
    Bridge.send(Object.assign({ t }, extra || {}));
  }
  function showError(message) {
    errorText = String(message || '操作できません');
    const e = $('phoneError');
    if (e) { e.textContent = errorText; e.style.display = 'block'; }
    Bridge.notify(errorText);
  }
  function phaseName(phase) {
    return ({ lobby: '参加者を募集中', prompt: '最初のお題を書く', draw: '絵を描く', caption: '絵を文章にする', results: '結果発表' })[phase] || '待機中';
  }
  function phaseDescription(s) {
    if (s.phase === 'prompt') return s.horrorMode ? '怪談の始まりになるお題を書きます。提出するまで、ほかの参加者には見えません。' : '自分だけのお題を入力します。提出するまで、ほかの参加者には見えません。';
    if (s.phase === 'draw') return s.horrorMode ? '直前の文章から、不気味さや違和感のある絵を自由に描いてください。' : '表示された直前の文章を絵にします。完成したら提出してください。';
    if (s.phase === 'caption') return s.horrorMode ? 'この絵から想像できる、少し不気味な出来事を文章にしてください。' : '表示された絵を見て、何が描かれているか文章にします。';
    return '';
  }
  function captureDraft() {
    const text = $('phoneText');
    if (text) draftText = text.value;
    const canvas = $('phoneCanvas');
    if (canvas && state && state.phase === 'draw' && !state.mySubmitted) {
      try { draftDrawing = canvas.toDataURL('image/png'); } catch (_) {}
    }
  }
  function resetDraftFor(s) {
    const key = s ? `${s.id || ''}:${s.phase || ''}:${s.stage || 0}` : '';
    if (key !== draftKey) {
      draftKey = key;
      draftText = '';
      draftDrawing = '';
    }
  }
  function requestState() { send('phone-state'); }
  function close() {
    memoryPanel = null;
    Bridge.setOpen(false);
    $('phoneModal').style.display = 'none';
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    drawingPointer = null;
    lastPoint = null;
  }
  function open() {
    if (!Bridge.id) { showError('先にワールドへ参加してください'); return; }
    Bridge.setOpen(true);
    if ($('phoneModal')) $('phoneModal').style.display = 'flex';
    requestState();
    render();
    startCountdown();
  }
  function playerRows(s) {
    const done = new Set(s.submittedIds || []);
    return `<ul class="phone-player-list">${(s.players || []).map((p) => `<li><span>${esc(p.name)}${p.id === s.ownerId ? ' <b>主催者</b>' : ''}${p.id === Bridge.id ? '（あなた）' : ''}</span><span class="phone-check ${done.has(p.id) ? 'done' : ''}">${s.phase === 'lobby' ? '参加中' : (done.has(p.id) ? '提出済み' : '作業中')}</span></li>`).join('')}</ul>`;
  }
  function drawTask(s) {
    if (s.mySubmitted) {
      return `<div class="phone-wait"><strong>提出済みです</strong><p>ほかの参加者の提出を待っています。</p></div>`;
    }
    const task = s.myTask;
    if (!task) return '<p>担当ページを読み込んでいます…</p>';
    if (s.phase === 'prompt') {
      return `<label class="phone-label" for="phoneText">最初のお題（120文字まで）</label><textarea id="phoneText" maxlength="120" placeholder="${s.horrorMode ? '例：夜中、切れているはずの電話が鳴った' : '例：世界一しょぼい勇者'}">${esc(draftText)}</textarea><button id="phoneSubmit" class="phone-primary">お題を提出</button>`;
    }
    if (s.phase === 'draw') {
      const source = task.sourceType === 'caption' ? '直前の回答' : '元のお題';
      return `<div class="phone-source"><strong>${source}</strong><p>${esc(task.sourceValue || '')}</p></div>
        <p class="phone-instruction">下のキャンバスに絵を描いてください。</p>
        <div class="phone-palette">${COLORS.map((c) => `<button type="button" class="phone-color ${c === drawColor ? 'selected' : ''}" data-color="${c}" style="--swatch:${c}" aria-label="色 ${c}"></button>`).join('')}<label class="phone-size">太さ <input id="phoneSize" type="range" min="2" max="18" value="${drawSize}"></label></div>
        <canvas id="phoneCanvas" width="480" height="300" aria-label="お絵かきキャンバス"></canvas>
        <div class="phone-actions"><button id="phoneClear" class="phone-secondary">消去</button><button id="phoneSubmit" class="phone-primary">絵を提出</button></div>`;
    }
    if (s.phase === 'caption') {
      const image = typeof task.sourceValue === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(task.sourceValue)
        ? `<img class="phone-source-image" src="${task.sourceValue}" alt="前の人が描いた絵">`
        : '<p>画像を読み込めませんでした。</p>';
      return `<div class="phone-source"><strong>この絵を文章にしてください</strong>${image}</div><label class="phone-label" for="phoneText">絵の説明（120文字まで）</label><textarea id="phoneText" maxlength="120" placeholder="${s.horrorMode ? 'この絵の裏に、何が隠れている？' : 'この絵には何が描かれている？'}">${esc(draftText)}</textarea><button id="phoneSubmit" class="phone-primary">回答を提出</button>`;
    }
    return '';
  }
  function resultEntry(entry) {
    if (entry.type === 'draw') {
      const safe = typeof entry.value === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(entry.value);
      return safe ? `<div class="phone-result-item"><small>${esc(entry.authorName)}が描いた絵</small><img class="phone-result-image" src="${entry.value}" alt="提出された絵"></div>` : '';
    }
    const title = entry.type === 'prompt' ? '最初のお題' : '文章の回答';
    return `<div class="phone-result-item"><small>${esc(entry.authorName)}：${title}</small><blockquote>${esc(entry.value)}</blockquote></div>`;
  }
  function openMemoryDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('このブラウザはローカル保存に対応していません')); return; }
      let request;
      try { request = indexedDB.open(MEMORY_DB, 1); }
      catch (error) { reject(error); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(MEMORY_STORE)) db.createObjectStore(MEMORY_STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('思い出帳を開けませんでした'));
      request.onblocked = () => reject(new Error('別のタブが思い出帳を使用中です'));
    });
  }
  function estimateMemoryBytes(record) {
    try { return JSON.stringify(record).length * 2; } catch (_) { return MEMORY_MAX_ITEM_BYTES + 1; }
  }
  function makeMemoryRecord(s) {
    if (!s || s.phase !== 'results' || !s.isMember || !Array.isArray(s.books) || typeof s.id !== 'string' || !/^[a-f0-9]{8,32}$/i.test(s.id)) return null;
    const books = s.books.slice(0, 8).map((book) => ({
      authorName: String(book && book.authorName || '参加者').slice(0, 40),
      entries: (Array.isArray(book && book.entries) ? book.entries : []).slice(0, 8).filter((entry) => entry && ['prompt', 'draw', 'caption'].includes(entry.type)).map((entry) => {
        const authorName = String(entry.authorName || '参加者').slice(0, 40);
        if (entry.type === 'draw') {
          const value = entry.value;
          if (typeof value !== 'string' || value.length > 150000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)) return null;
          return { type: 'draw', authorName, value };
        }
        const value = String(entry.value == null ? '' : entry.value).slice(0, 120);
        return { type: entry.type, authorName, value };
      }).filter(Boolean),
    }));
    const record = {
      id: s.id,
      isMember: true,
      completedAt: new Date().toISOString(),
      players: (Array.isArray(s.players) ? s.players : []).slice(0, 8).map((p) => String(p && p.name || '参加者').slice(0, 40)),
      horrorMode: s.horrorMode === true,
      books,
    };
    record.bytes = estimateMemoryBytes(record);
    return record.bytes <= MEMORY_MAX_ITEM_BYTES ? record : null;
  }
  async function loadMemories() {
    const db = await openMemoryDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MEMORY_STORE, 'readonly');
      const request = tx.objectStore(MEMORY_STORE).getAll();
      let items = [];
      request.onsuccess = () => { items = Array.isArray(request.result) ? request.result : []; };
      tx.oncomplete = () => { db.close(); resolve(items.sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('思い出帳を読み込めませんでした')); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('思い出帳の読み込みが中断されました')); };
    });
  }
  async function saveMemory(record) {
    const db = await openMemoryDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MEMORY_STORE, 'readwrite');
      const store = tx.objectStore(MEMORY_STORE);
      const request = store.getAll();
      let retainedNew = false;
      request.onsuccess = () => {
        const records = (Array.isArray(request.result) ? request.result : []).filter((item) => item.id !== record.id);
        records.push(record);
        records.sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
        const keep = [];
        let total = 0;
        for (const item of records) {
          const bytes = Number.isFinite(item.bytes) ? item.bytes : estimateMemoryBytes(item);
          if (keep.length >= MEMORY_MAX_GAMES || total + bytes > MEMORY_MAX_TOTAL_BYTES) continue;
          keep.push(item); total += bytes;
        }
        retainedNew = keep.some((item) => item.id === record.id);
        if (!retainedNew) { tx.abort(); return; }
        const keepIds = new Set(keep.map((item) => item.id));
        for (const item of request.result || []) if (!keepIds.has(item.id)) store.delete(item.id);
        store.put(record);
      };
      tx.oncomplete = () => { db.close(); resolve(retainedNew); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('思い出帳に保存できませんでした')); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('思い出帳の保存が中断されました')); };
    });
  }
  async function deleteMemory(id) {
    const db = await openMemoryDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MEMORY_STORE, 'readwrite');
      tx.objectStore(MEMORY_STORE).delete(id);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('記録を削除できませんでした')); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('削除が中断されました')); };
    });
  }
  async function clearMemories() {
    const db = await openMemoryDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MEMORY_STORE, 'readwrite');
      tx.objectStore(MEMORY_STORE).clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('思い出帳を空にできませんでした')); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('削除が中断されました')); };
    });
  }
  function archiveCurrentResults(s, retry) {
    const record = makeMemoryRecord(s);
    if (!record || (!retry && lastArchiveStartedId === record.id)) return;
    lastArchiveStartedId = record.id;
    memorySaveStatus = '思い出帳に保存中…';
    saveMemory(record).then((saved) => {
      const isCurrentResult = !!(state && state.phase === 'results' && state.id === record.id);
      if (isCurrentResult) memorySaveStatus = saved ? 'この結果を思い出帳に保存しました。' : '保存できませんでした。思い出帳の保存容量を確認してください。';
      if (memoryPanel === 'list') {
        if (!saved) memoryLoadStatus = '直近の結果を保存できませんでした。ブラウザの保存容量を確認してください。';
        loadMemories().then((items) => {
          if (memoryPanel === 'list') { memoryItems = items; render(); }
        }).catch((loadError) => {
          if (memoryPanel === 'list') { memoryLoadStatus = loadError.message || '思い出帳を更新できませんでした'; render(); }
        });
      } else if (isCurrentResult) render();
    }).catch((error) => {
      console.warn('[phone-memory] save failed', error);
      if (state && state.phase === 'results' && state.id === record.id) memorySaveStatus = '思い出帳に保存できませんでした。ブラウザの保存設定を確認してください。';
      if (memoryPanel === 'list') { memoryLoadStatus = '直近の結果を思い出帳に保存できませんでした。'; render(); }
      else if (state && state.phase === 'results' && state.id === record.id) render();
    });
  }
  function memoryDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '日時不明' : date.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function showMemoryList() {
    captureDraft();
    memoryPanel = 'list';
    memoryLoadStatus = '思い出帳を読み込んでいます…';
    render();
    loadMemories().then((items) => {
      if (memoryPanel !== 'list') return;
      memoryItems = items;
      memoryLoadStatus = '';
      render();
    }).catch((error) => {
      console.warn('[phone-memory] load failed', error);
      if (memoryPanel !== 'list') return;
      memoryItems = [];
      memoryLoadStatus = error.message || '思い出帳を読み込めませんでした';
      render();
    });
  }
  function memoryListView() {
    const list = memoryItems.length ? `<div class="phone-memory-list">${memoryItems.map((item) => `<section class="phone-memory-row"><div class="phone-memory-meta"><strong>${esc(memoryDate(item.completedAt))}</strong><p>${esc((item.players || []).join('、') || '参加者不明')}</p><small>${item.horrorMode ? '👻 怪談モード ・ ' : ''}${(item.books || []).length}冊の記録</small></div><div class="phone-memory-actions"><button type="button" class="phone-primary" data-memory-open="${esc(item.id)}">見る</button><button type="button" class="phone-secondary" data-memory-delete="${esc(item.id)}">削除</button></div></section>`).join('')}</div>` : memoryLoadStatus ? '' : '<p class="phone-muted">まだ記録がありません。テレフォンゲームの結果発表まで遊ぶと、自動的に保存されます。</p>';
    return `<p class="phone-muted">この思い出帳は、このブラウザ内だけに保存されます。最大${MEMORY_MAX_GAMES}件で、容量制限に達すると古い記録から整理します。</p>${memoryLoadStatus ? `<p class="phone-memory-status">${esc(memoryLoadStatus)}</p>` : ''}${list}<div class="phone-memory-footer"><button id="phoneMemoryBack" class="phone-secondary">ゲームに戻る</button>${memoryItems.length ? '<button id="phoneMemoryClear" class="phone-secondary">すべて削除</button>' : ''}</div>`;
  }
  function resultsView(s, historical) {
    if (!s.isMember) return `<p>この回のゲームは終了しました。結果の詳細は参加者に表示されます。</p><p class="phone-muted">主催者が次のロビーを開くと参加できます。</p>`;
    const saveStatus = !historical && memorySaveStatus ? `<p class="phone-memory-status">${esc(memorySaveStatus)}${memorySaveStatus.includes('保存できません') ? ' <button id="phoneMemoryRetry" class="phone-secondary">保存を再試行</button>' : ''}</p>` : '';
    const action = historical
      ? '<button id="phoneMemoryBack" class="phone-secondary">思い出帳に戻る</button>'
      : `${saveStatus}${s.ownerId === Bridge.id ? '<button id="phoneAgain" class="phone-primary">このメンバーでもう一度</button>' : '<p class="phone-muted">主催者が次のゲームを始めると、ここにロビーが表示されます。</p>'}`;
    const intro = historical ? `<p class="phone-muted">${s.horrorMode ? '👻 怪談モード · ' : ''}${esc(memoryDate(s.completedAt))} の記録です。</p>` : `<p class="phone-muted">${s.horrorMode ? '👻 怪談モード：不思議な話がどう変化したか、順番に見てみましょう。' : '文章と絵がどのように変わったか、最初から順番に見てみましょう。'}</p>`;
    return `${intro}<div class="phone-results">${(s.books || []).map((book, i) => `<section class="phone-book"><h3>本 ${i + 1} — ${esc(book.authorName)}のお題から</h3>${(book.entries || []).map(resultEntry).join('')}</section>`).join('')}</div>${action}`;
  }
  function updateCountdown() {
    if (!Bridge.isOpen || !state || memoryPanel) return;
    const status = $('phoneStatus');
    if (!status) return;
    if (!['prompt', 'draw', 'caption'].includes(state.phase) || !state.deadline) {
      status.textContent = `${phaseName(state.phase)}${state.phase === 'draw' || state.phase === 'caption' ? `（${state.stage}/${state.totalStages}）` : ''}`;
      return;
    }
    const serverClock = state.serverNow && state.clientReceivedAt ? Date.now() + (state.serverNow - state.clientReceivedAt) : Date.now();
    const remain = Math.max(0, Math.ceil((state.deadline - serverClock) / 1000));
    const stage = state.phase === 'draw' || state.phase === 'caption' ? `（${state.stage}/${state.totalStages}）` : '';
    status.textContent = `${phaseName(state.phase)}${stage} · 残り ${remain} 秒${remain === 0 ? '（時間切れ処理中）' : ''}`;
  }
  function startCountdown() {
    if (!countdownTimer) countdownTimer = setInterval(updateCountdown, 1000);
    updateCountdown();
  }
  function render() {
    const body = $('phoneBody');
    const title = $('phoneTitle');
    const status = $('phoneStatus');
    const error = $('phoneError');
    if (!body) return;
    if (error) { error.textContent = errorText; error.style.display = errorText ? 'block' : 'none'; }
    const s = state;
    if (title) title.textContent = memoryPanel ? '📚 テレフォンゲームの思い出帳' : (state && state.horrorMode ? '👻 怪談テレフォンゲーム' : '☎ テレフォンゲーム');
    if (memoryPanel === 'list') {
      if (status) status.textContent = '過去のゲーム結果';
      body.innerHTML = memoryListView();
      bindButtons();
      return;
    }
    if (memoryPanel && memoryPanel.type === 'detail') {
      if (status) status.textContent = '思い出帳 · 結果を閲覧中';
      body.innerHTML = resultsView(memoryPanel.record, true);
      bindButtons();
      return;
    }
    if (!s) {
      if (status) status.textContent = 'ワールドの参加者と文章・絵を交互に回して遊びます。';
      body.innerHTML = `<p>このゲームはワールド内の参加者と遊ぶミニゲームです。ロビーを作り、2人以上集まったら開始します。</p><button id="phoneJoin" class="phone-primary">ロビーを作成</button>`;
      bindButtons();
      return;
    }
    if (status) status.textContent = `${phaseName(s.phase)}${s.phase === 'draw' || s.phase === 'caption' ? `（${s.stage}/${s.totalStages}）` : ''}`;
    if (s.phase === 'lobby') {
      const isMember = !!s.isMember;
      const modeLabel = s.horrorMode ? '👻 怪談モード ON' : '🎨 通常モード';
      const modeControl = isMember && s.ownerId === Bridge.id
        ? `<button id="phoneHorrorToggle" class="phone-secondary">${s.horrorMode ? '👻 怪談モード: ON（タップで通常に戻す）' : '👻 怪談モード: OFF（タップで有効）'}</button>`
        : `<p class="phone-muted">${modeLabel}${s.horrorMode ? ' · 文章と絵で怪談をつなぎます。' : ''}</p>`;
      body.innerHTML = `<p>${esc(s.ownerName)}がロビーを開いています。2〜${s.maxPlayers || 8}人で遊べます。</p>${playerRows(s)}${modeControl}${isMember ? (s.ownerId === Bridge.id ? `<button id="phoneStart" class="phone-primary" ${s.players.length < 2 ? 'disabled' : ''}>${s.horrorMode ? '怪談ゲーム開始' : 'ゲーム開始'}（${s.players.length}人）</button>` : '<p class="phone-wait">主催者が開始するのを待っています。</p>') : '<button id="phoneJoin" class="phone-primary">このロビーに参加</button>'}${isMember ? '<button id="phoneLeave" class="phone-secondary">ロビーから退出</button>' : ''}`;
      bindButtons();
      return;
    }
    if (s.phase === 'results') {
      body.innerHTML = resultsView(s, false);
      bindButtons();
      return;
    }
    if (!s.isMember) {
      body.innerHTML = `<p>ほかの参加者がテレフォンゲームを進行中です。</p>${playerRows(s)}<p class="phone-muted">ゲームが終了すると、次のロビーに参加できます。</p>`;
      bindButtons();
      return;
    }
    const submitted = (s.submittedIds || []).length;
    body.innerHTML = `<p class="phone-instruction">${esc(phaseDescription(s))}</p>${playerRows(s)}<div class="phone-progress">提出状況：${submitted}/${s.players.length}人</div>${drawTask(s)}<button id="phoneLeave" class="phone-secondary phone-leave">ゲームから退出</button>`;
    bindButtons();
    if (s.phase === 'draw' && !s.mySubmitted) setupCanvas();
  }
  function bindButtons() {
    const join = $('phoneJoin'); if (join) join.onclick = () => { errorText = ''; send('phone-join'); };
    const start = $('phoneStart'); if (start) start.onclick = () => { errorText = ''; send('phone-start'); };
    const horrorToggle = $('phoneHorrorToggle'); if (horrorToggle) horrorToggle.onclick = () => { errorText = ''; send('phone-horror-toggle', { enabled: !(state && state.horrorMode) }); };
    const again = $('phoneAgain'); if (again) again.onclick = () => { errorText = ''; send('phone-again'); };
    const memBack = $('phoneMemoryBack'); if (memBack) memBack.onclick = () => { memoryPanel = null; render(); };
    const memClear = $('phoneMemoryClear'); if (memClear) memClear.onclick = async () => {
      if (!confirm('このブラウザに保存した思い出をすべて削除しますか？')) return;
      try { await clearMemories(); memoryItems = []; memoryLoadStatus = ''; render(); }
      catch (error) { memoryLoadStatus = error.message || '思い出帳を削除できませんでした'; render(); }
    };
    const memRetry = $('phoneMemoryRetry'); if (memRetry) memRetry.onclick = () => archiveCurrentResults(state, true);
    const memRefresh = $('phoneMemoryRefresh'); if (memRefresh) memRefresh.onclick = showMemoryList;
    document.querySelectorAll('#phoneBody [data-memory-open]').forEach((button) => {
      button.onclick = () => {
        const record = memoryItems.find((item) => item.id === button.getAttribute('data-memory-open'));
        if (record) { memoryPanel = { type: 'detail', record }; render(); }
      };
    });
    document.querySelectorAll('#phoneBody [data-memory-delete]').forEach((button) => {
      button.onclick = async () => {
        const id = button.getAttribute('data-memory-delete');
        if (!confirm('この思い出を削除しますか？')) return;
        try { await deleteMemory(id); memoryItems = memoryItems.filter((item) => item.id !== id); render(); }
        catch (error) { memoryLoadStatus = error.message || '記録を削除できませんでした'; render(); }
      };
    });
    const leave = $('phoneLeave'); if (leave) leave.onclick = () => {
      if (state && !['lobby', 'results'].includes(state.phase) && !confirm('進行中に退出すると、参加者全員のゲームが中止されます。退出しますか？')) return;
      errorText = '';
      send('phone-leave');
    };
    const submit = $('phoneSubmit'); if (submit) submit.onclick = submitCurrent;
    const clear = $('phoneClear'); if (clear) clear.onclick = clearCanvas;
    document.querySelectorAll('#phoneModal [data-color]').forEach((button) => {
      button.onclick = () => {
        captureDraft();
        drawColor = button.getAttribute('data-color') || '#111111';
        render();
      };
    });
    const size = $('phoneSize'); if (size) size.oninput = () => { drawSize = +size.value || 5; };
  }
  function initCanvas() {
    const canvas = $('phoneCanvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (draftDrawing && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(draftDrawing)) {
      const img = new Image();
      img.onload = () => { if ($('phoneCanvas') === canvas) ctx.drawImage(img, 0, 0, canvas.width, canvas.height); };
      img.src = draftDrawing;
    }
    return { canvas, ctx };
  }
  function setupCanvas() {
    const setup = initCanvas();
    if (!setup) return;
    const { canvas, ctx } = setup;
    const point = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height };
    };
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault(); drawingPointer = e.pointerId; lastPoint = point(e);
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      ctx.beginPath(); ctx.arc(lastPoint.x, lastPoint.y, drawSize / 2, 0, Math.PI * 2); ctx.fillStyle = drawColor; ctx.fill();
      draftDrawing = canvas.toDataURL('image/png');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (drawingPointer !== e.pointerId || !lastPoint) return;
      e.preventDefault(); const p = point(e);
      ctx.beginPath(); ctx.moveTo(lastPoint.x, lastPoint.y); ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = drawColor; ctx.lineWidth = drawSize; ctx.stroke(); lastPoint = p;
      draftDrawing = canvas.toDataURL('image/png');
    });
    const end = (e) => { if (drawingPointer === e.pointerId) { drawingPointer = null; lastPoint = null; draftDrawing = canvas.toDataURL('image/png'); } };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end); canvas.addEventListener('lostpointercapture', end);
  }
  function clearCanvas() {
    const canvas = $('phoneCanvas'); if (!canvas) return;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    draftDrawing = canvas.toDataURL('image/png');
  }
  function submitCurrent() {
    if (!state || state.mySubmitted) return;
    let value = '';
    if (state.phase === 'draw') {
      const canvas = $('phoneCanvas');
      if (!canvas) return;
      value = canvas.toDataURL('image/png');
      draftDrawing = value;
      if (value.length > 150000) { showError('絵の情報量が多すぎます。消去して簡単な線で描いてください'); return; }
    } else {
      const input = $('phoneText');
      value = String(input ? input.value : '').trim();
      if (!value) { showError(state.phase === 'prompt' ? '最初のお題を入力してください' : '絵の説明を入力してください'); return; }
      if (value.length > 120) { showError('文章は120文字以内にしてください'); return; }
      draftText = value;
    }
    errorText = '';
    send('phone-submit', { phase: state.phase, value });
  }
  function handleMessage(m) {
    if (m.t === 'phone-error') { showError(m.message); return; }
    if (m.t !== 'phone-state') return;
    captureDraft();
    const next = m.state || null;
    if (next) next.clientReceivedAt = Date.now();
    resetDraftFor(next);
    state = next;
    if (m.notice) errorText = m.notice;
    if (next && next.phase === 'results' && next.isMember && Array.isArray(next.books)) archiveCurrentResults(next, false);
    render();
    if (Bridge.isOpen) startCountdown();
  }
  Bridge.setMessageHandler(handleMessage);

  $('phoneOpen').addEventListener('click', open);
  $('phoneClose').addEventListener('click', close);
  const memoryShortcut = $('phoneMemoryShortcut');
  if (memoryShortcut) memoryShortcut.addEventListener('click', showMemoryList);
  $('phoneModal').addEventListener('click', (e) => { if (e.target === $('phoneModal')) close(); });
  $('phoneCard').addEventListener('pointerdown', (e) => e.stopPropagation());
  window.addEventListener('keydown', (e) => {
    if (!Bridge.isOpen || e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation(); close();
  }, true);

  window.PhoneGame = { open, close, isOpen: () => Bridge.isOpen };
})();
