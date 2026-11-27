// 서식 페이지(차용증 · 자금조달계획서) 공통 도우미
// 1) 날짜 입력: 양도세 계산기와 같은 방식 — 직접 입력(YYYY-MM-DD 자동 대시) + 달력 버튼(년·월 드롭다운 + 일 달력)
// 2) 은행 선택 + 은행별 계좌번호 대시 자동 입력 (기장 계약서와 같은 형식표)
(function () {
  const css = `
  .date-input-wrapper { position: relative; }
  .date-input-wrapper input[type="text"] { padding-right: 36px; }
  .cal-btn { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); background: none; border: none; padding: 5px; border-radius: 6px; cursor: pointer; color: #8a6d3b; display: flex; }
  .cal-btn:hover { background-color: #f1f5f9; }
  .dp { position: absolute; z-index: 200; width: 296px; background: #fff; border: 1px solid #e2e8f0; border-top: 3px solid #b08d57; border-radius: 10px; box-shadow: 0 10px 28px rgba(15,23,42,.14); padding: 14px; display: none; font-family: inherit; }
  .dp.open { display: block; }
  .dp-head { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
  .dp-head select { flex: 1; width: auto; height: auto; padding: 7px 8px; font-size: 14px; font-weight: 600; color: #1e293b; border-radius: 6px; cursor: pointer; }
  .dp-nav { flex: 0 0 30px; height: 32px; background: none; border: 1px solid #e2e8f0; border-radius: 6px; color: #8a6d3b; font-size: 18px; line-height: 1; cursor: pointer; }
  .dp-nav:hover { background: #faf7f1; border-color: #eadfc9; }
  .dp-week, .dp-days { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; }
  .dp-week span { font-size: 12px; color: #64748b; padding: 4px 0 6px; font-weight: 500; }
  .dp-week span:first-child { color: #b45309; }
  .dp-days { gap: 2px; }
  .dp-day { height: 34px; background: none; border: 1px solid transparent; border-radius: 6px; font-size: 14px; color: #1e293b; cursor: pointer; font-family: inherit; }
  .dp-day.sun { color: #b45309; }
  .dp-day:hover { background: #faf7f1; border-color: #eadfc9; }
  .dp-day.today { border-color: #cbd5e1; font-weight: 700; }
  .dp-day.sel, .dp-day.sel:hover { background: #8a6d3b; border-color: #8a6d3b; color: #fff; font-weight: 700; }
  .dp-foot { display: flex; justify-content: space-between; margin-top: 10px; padding-top: 10px; border-top: 1px solid #f1f5f9; }
  .dp-foot button { background: none; border: none; font-size: 13px; color: #8a6d3b; font-weight: 600; cursor: pointer; padding: 4px 6px; font-family: inherit; }
  .dp-foot .dp-close { color: #64748b; }
  @media print { .dp { display: none !important; } }`;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  const pad2 = (n) => String(n).padStart(2, '0');
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const THIS_YEAR = new Date().getFullYear();
  const FIRST_YEAR = 1960, LAST_YEAR = THIS_YEAR + 30;
  const CAL_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';

  // ---------- 달력 팝업 ----------
  let dpTarget = null, dpYear, dpMonth;
  const dp = document.createElement('div');
  dp.className = 'dp';
  dp.setAttribute('role', 'dialog');
  dp.setAttribute('aria-label', '날짜 선택');
  dp.innerHTML = `
    <div class="dp-head">
      <button type="button" class="dp-nav" data-step="-1" aria-label="이전 달">&#8249;</button>
      <select class="dp-year" aria-label="년">${Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => LAST_YEAR - i).map((y) => `<option value="${y}">${y}년</option>`).join('')}</select>
      <select class="dp-month" aria-label="월">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}월</option>`).join('')}</select>
      <button type="button" class="dp-nav" data-step="1" aria-label="다음 달">&#8250;</button>
    </div>
    <div class="dp-week"><span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span></div>
    <div class="dp-days"></div>
    <div class="dp-foot"><button type="button" class="dp-today">오늘</button><button type="button" class="dp-close">닫기</button></div>`;
  const ySel = dp.querySelector('.dp-year'), mSel = dp.querySelector('.dp-month');

  function render() {
    if (dpYear < FIRST_YEAR) { dpYear = FIRST_YEAR; dpMonth = 1; }
    if (dpYear > LAST_YEAR) { dpYear = LAST_YEAR; dpMonth = 12; }
    ySel.value = dpYear; mSel.value = dpMonth;
    const first = new Date(dpYear, dpMonth - 1, 1).getDay();
    const last = new Date(dpYear, dpMonth, 0).getDate();
    const sel = dpTarget && isDate(dpTarget.value) ? dpTarget.value : '';
    const t = new Date(), today = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
    let html = '<span></span>'.repeat(first);
    for (let d = 1; d <= last; d++) {
      const v = `${dpYear}-${pad2(dpMonth)}-${pad2(d)}`;
      const dow = (first + d - 1) % 7;
      html += `<button type="button" class="${['dp-day', v === sel ? 'sel' : '', v === today ? 'today' : '', dow === 0 ? 'sun' : ''].filter(Boolean).join(' ')}" data-v="${v}">${d}</button>`;
    }
    dp.querySelector('.dp-days').innerHTML = html;
  }
  function place() {
    const r = dpTarget.getBoundingClientRect();
    const w = dp.offsetWidth, h = dp.offsetHeight;
    let left = r.left + window.scrollX;
    left = Math.max(8 + window.scrollX, Math.min(left, window.scrollX + document.documentElement.clientWidth - w - 8));
    let top = r.bottom + window.scrollY + 6;
    if (r.bottom + h + 6 > window.innerHeight && r.top - h - 6 > 0) top = r.top + window.scrollY - h - 6;
    dp.style.left = left + 'px'; dp.style.top = top + 'px';
  }
  function open(input) {
    if (!dp.isConnected) document.body.appendChild(dp);
    dpTarget = input;
    const v = isDate(input.value) ? input.value : '';
    const t = new Date();
    dpYear = v ? +v.slice(0, 4) : t.getFullYear();
    dpMonth = v ? +v.slice(5, 7) : t.getMonth() + 1;
    render(); dp.classList.add('open'); place();
  }
  function close() { dp.classList.remove('open'); dpTarget = null; }
  function pick(v) {
    const input = dpTarget;
    input.value = v; input.dataset.prev = v;
    close();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  ySel.addEventListener('change', () => { dpYear = +ySel.value; render(); });
  mSel.addEventListener('change', () => { dpMonth = +mSel.value; render(); });
  dp.addEventListener('click', (e) => {
    const nav = e.target.closest('.dp-nav');
    if (nav) {
      dpMonth += +nav.dataset.step;
      if (dpMonth < 1) { dpMonth = 12; dpYear--; }
      if (dpMonth > 12) { dpMonth = 1; dpYear++; }
      render();
    } else if (e.target.closest('.dp-day')) pick(e.target.closest('.dp-day').dataset.v);
    else if (e.target.closest('.dp-today')) { const t = new Date(); pick(`${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`); }
    else if (e.target.closest('.dp-close')) close();
  });
  document.addEventListener('mousedown', (e) => { if (dpTarget && !dp.contains(e.target) && !e.target.closest('.cal-btn')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dpTarget) close(); });
  window.addEventListener('resize', () => { if (dpTarget) place(); });

  // 직접 입력: 숫자만 넣어도 YYYY-MM-DD로 대시 자동
  function formatDate(input) {
    const d = input.value.replace(/\D/g, '').slice(0, 8);
    input.value = d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d;
  }

  // <input data-date> 를 달력 입력칸으로 바꿈
  function setupDates(root) {
    (root || document).querySelectorAll('input[data-date]').forEach((input) => {
      if (input.dataset.dateReady) return;
      input.dataset.dateReady = '1';
      input.type = 'text';
      input.placeholder = input.placeholder || 'YYYY-MM-DD';
      input.maxLength = 10;
      input.inputMode = 'numeric';
      input.autocomplete = 'off';
      const wrap = document.createElement('div');
      wrap.className = 'date-input-wrapper';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'cal-btn'; btn.innerHTML = CAL_ICON;
      btn.setAttribute('aria-label', '달력에서 날짜 선택');
      btn.addEventListener('click', () => { if (dpTarget === input) close(); else open(input); });
      wrap.appendChild(btn);
      input.addEventListener('input', (e) => { if (e.isTrusted) formatDate(input); });
    });
  }

  // ---------- 은행 · 계좌번호 ----------
  // 은행별 계좌번호 형식 [숫자 개수, [앞, 가운데, ... 자리수]] — 첫 번째가 대표 형식 (기장 계약서와 같음)
  const BANKS = {
    'KB국민은행': [[14, [6, 2, 6]], [12, [3, 2, 4, 3]]],
    '신한은행': [[12, [3, 3, 6]], [11, [3, 2, 6]]],
    '우리은행': [[13, [4, 3, 6]]],
    '하나은행': [[14, [3, 6, 5]]],
    'NH농협은행': [[13, [3, 4, 4, 2]], [14, [6, 2, 6]], [11, [3, 2, 6]]],
    'IBK기업은행': [[14, [3, 6, 2, 3]]],
    '카카오뱅크': [[13, [4, 2, 7]]],
    '토스뱅크': [[12, [4, 4, 4]]],
    '케이뱅크': [[12, [3, 3, 6]]],
    'SC제일은행': [[11, [3, 2, 6]]],
    '우체국': [[14, [6, 2, 6]]],
    '새마을금고': [[13, [4, 4, 4, 1]]],
    '수협은행': [], '신협': [], '부산은행': [], '대구은행(iM뱅크)': [], '경남은행': [], '광주은행': [], '전북은행': [],
    '제주은행': [], 'KDB산업은행': [], '한국씨티은행': [], '기타': []
  };
  function cutBy(d, parts) {
    const out = []; let i = 0;
    for (const n of parts) { if (i >= d.length) break; out.push(d.slice(i, i + n)); i += n; }
    if (i < d.length) out.push(d.slice(i));
    return out.join('-');
  }
  function formatAccount(bank, value) {
    let d = String(value || '').replace(/\D/g, '');
    const rules = BANKS[bank] || [];
    if (!rules.length) return d.slice(0, 20);
    d = d.slice(0, 16);
    const hit = rules.find(([n]) => n === d.length);
    return cutBy(d, (hit || rules[0])[1]);
  }
  // 은행 선택칸 + (기타일 때) 직접 입력칸 + 계좌번호칸 연결
  function setupBank(select, other, account, onChange) {
    select.innerHTML = '<option value="">선택</option>' + Object.keys(BANKS).map((b) => `<option value="${b}">${b === '기타' ? '기타 (직접 입력)' : b}</option>`).join('');
    const sync = () => {
      if (other) other.style.display = select.value === '기타' ? '' : 'none';
      account.value = formatAccount(select.value, account.value);
      if (onChange) onChange();
    };
    select.addEventListener('change', sync);
    account.addEventListener('input', () => { account.value = formatAccount(select.value, account.value); });
    account.addEventListener('blur', () => { account.value = formatAccount(select.value, account.value); });
    sync();
  }

  window.FormTools = { setupDates, setupBank, formatAccount, BANKS, isDate };
})();
