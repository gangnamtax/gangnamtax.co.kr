// 개인사업자 기장의무 · 경비율 · 창업감면 판정 및 소득세 · 보수 비교 (계산 엔진)
// 원본: 개인사업자_기장의무_경비율_판정표.xlsx (판정 · 보조계산 · 기준표 · 보수표 시트)
// 브라우저(window.GijangEngine)와 Node(require) 양쪽에서 동작
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GijangEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ===== 기준표 (소득세법 시행령 · 조특법 제6조, 2026년 11월 현행) =====
  const GROUPS = {
    // 복식부기의무, 단순경비율, 외부조정 (직전연도) / 성실신고확인 (해당연도)
    '그룹1': { book: 300000000, simple: 60000000, ext: 600000000, faithful: 1500000000 },
    '그룹2': { book: 150000000, simple: 36000000, ext: 300000000, faithful: 750000000 },
    '그룹3': { book: 75000000, simple: 24000000, ext: 150000000, faithful: 500000000 },
    '욕탕업': { book: 150000000, simple: 24000000, ext: 300000000, faithful: 750000000 },
    '인적용역': { book: 75000000, simple: 36000000, ext: 150000000, faithful: 500000000 }
  };
  const LAW = {
    smallBizNoBookPenalty: 48000000, // 무기장가산세 제외 소규모사업자 (직전연도 수입 미만)
    simpleOverFrom: 40000000,        // 단순경비율 초과율 적용 구간 (이 금액 초과분)
    capMultipleSimple: 2.8,          // 기준경비율 소득금액 한도 배율 - 간편장부대상자
    capMultipleDouble: 3.4,          // 기준경비율 소득금액 한도 배율 - 복식부기의무자
    bookCreditRate: 0.2,             // 기장세액공제율
    bookCreditLimit: 1000000,        // 기장세액공제 한도
    doubleStandardRatio: 0.5,        // 복식부기의무자 기준경비율 1/2
    livelihoodLimit: 80000000,       // 생계형 창업 수입금액 기준 (이하)
    youthMaxAge: 34,                 // 청년 연령 상한 (창업 당시 만 나이)
    militaryMaxYears: 6,             // 병역기간 차감 한도
    noReturnRate: 0.0007,            // 무신고가산세 수입금액 비율 (복식부기의무자)
    localTaxRate: 0.1,               // 지방소득세율
    noBookPenaltyRate: 0.2           // 무기장가산세율
  };
  // 종합소득세 기본세율: [과세표준 하한(초과), 세율, 누진공제]
  const BRACKETS = [
    [0, 0.06, 0], [14000000, 0.15, 1260000], [50000000, 0.24, 5760000], [88000000, 0.35, 15440000],
    [150000000, 0.38, 19940000], [300000000, 0.40, 25940000], [500000000, 0.42, 35940000], [1000000000, 0.45, 65940000]
  ];
  // 창업중소기업 세액감면율 [2025.12.31 이전 청년·생계형, 이전 일반, 2026.1.1 이후 청년·생계형, 이후 일반]
  const REGIONS = [
    ['수도권과밀억제권역', [0.5, 0, 0.5, 0]],
    ['수도권 (과밀억제권역·인구감소지역 제외)', [1, 0.5, 0.75, 0.25]],
    ['수도권 인구감소지역 (가평·연천·강화·옹진)', [1, 0.5, 1, 0.5]],
    ['수도권 외 지역', [1, 0.5, 1, 0.5]]
  ];

  // ===== 보수표 (세무회계강남, 부가세 별도) =====
  const FEE = {
    monthly: [[0, 100000], [100000000, 120000], [200000000, 150000], [300000000, 180000],
      [500000000, 220000], [1000000000, 300000], [2000000000, 400000]],
    // [수입금액 하한, 기본료, 초과분 요율]
    adjust: [[0, 300000, 0.002], [100000000, 500000, 0.0015], [300000000, 800000, 0.001],
      [500000000, 1000000, 0.0008], [1000000000, 1400000, 0.0005], [3000000000, 2400000, 0.0003]],
    perEmployee: 10000,     // 직원 1인당 월 기장료 가산
    minAdjust: 300000,      // 최저 조정료
    simpleAdjustRatio: 0.7, // 간편장부 조정료 계수
    externalExtra: 0,       // 외부조정 대상 가산율
    faithfulMultiple: 1.5,  // 성실신고확인 수수료 (조정료 대비 배수)
    faithfulMin: 1000000,   // 성실신고확인 최저 수수료
    vat: 0.1,
    simpleBookRatio: 0.7,   // 간편장부 기장료 계수
    estimateRatio: 0.5      // 추계신고 대행 수수료 계수
  };

  // ===== 도우미 =====
  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  // 엑셀 ROUND (0에서 먼 쪽으로 반올림)
  const xround = (x, digits) => {
    const p = Math.pow(10, digits);
    const y = Math.abs(x) * p;
    const r = Math.round(y + y * 1e-12 + 1e-9) / p; // 부동소수 오차 보정
    return x < 0 ? -r : r;
  };
  // VLOOKUP(..., TRUE): 하한이 x 이하인 마지막 행
  const lookup = (table, x) => { let row = table[0]; for (const t of table) if (t[0] <= x) row = t; return row; };
  const fmt = n => Math.round(n).toLocaleString('ko-KR');
  const pct = (r, d = 1) => xround(r * 100, d).toFixed(d) + '%'; // 엑셀 TEXT(…,"0.0%")와 같은 반올림

  // 날짜: 8자리 숫자(19870625) 또는 'YYYY-MM-DD' → UTC 일수
  function toDay(v) {
    const s = String(v == null ? '' : v).replace(/\D/g, '');
    if (s.length !== 8) return null;
    const y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
    const t = Date.UTC(y, m - 1, d);
    const dt = new Date(t);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return t / 86400000;
  }
  const ymd = day => { const d = new Date(day * 86400000); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]; };
  const fromYmd = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000;
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  // 엑셀 EDATE
  function edate(day, months) {
    const [y, m, d] = ymd(day);
    const total = y * 12 + (m - 1) + months;
    const ny = Math.floor(total / 12), nm = total % 12 + 1;
    return fromYmd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
  }
  // 엑셀 DATEDIF: 'y', 'ym', 'md'
  function datedif(a, b, unit) {
    const [y1, m1, d1] = ymd(a), [y2, m2, d2] = ymd(b);
    let months = (y2 - y1) * 12 + (m2 - m1);
    if (d2 < d1) months -= 1;
    if (unit === 'y') return Math.floor(months / 12);
    if (unit === 'ym') return months % 12;
    // 'md': 일 차이 (엑셀 방식: 전달 일수 기준)
    if (d2 >= d1) return d2 - d1;
    const pm = m2 === 1 ? 12 : m2 - 1, py = m2 === 1 ? y2 - 1 : y2;
    return daysInMonth(py, pm) - d1 + d2;
  }

  // ===== 데이터 색인 =====
  let INDEX = null;
  function index(data) {
    if (INDEX && INDEX.data === data) return INDEX;
    const ind = new Map(), ksic = new Map();
    data.industries.forEach(r => ind.set(r[0], {
      code: r[0], group: r[1], uptae: r[2], sebun: r[3], name: r[4], simple: r[5], simpleOver: r[6],
      standard: r[7], startup: r[8], startupNote: r[9], desc: r[10], ksic: r[11]
    }));
    data.ksic.forEach(r => ksic.set(r[0], {
      code: r[0], name: r[1], sebun: r[2], jungbun: r[3], startup: r[4], note: r[5], taxCode: r[6], big: r[7]
    }));
    INDEX = { data, ind, ksic };
    return INDEX;
  }

  /**
   * input = {
   *   year, isNew, isPro,                       // 귀속연도, 신규 사업자, 전문직 (true/false)
   *   biz: [{ code, prev, cur }, ...최대 3],     // 업종코드(6자리), 직전연도·해당연도 수입
   *   purchase, rent, labor,                    // 주요경비 (기준경비율 방식)
   *   bookExpense, deduction,                   // 장부상 필요경비, 종합소득공제
   *   ksic,                                     // 감면 판단 표준산업분류(5자리, 비우면 주업종 기준)
   *   birth, enlist, discharge, startDate,      // 생년월일 · 입대일 · 전역일 · 창업일 (YYYYMMDD)
   *   region, firstIncomeYear, realStartup,     // 창업 당시 소재지, 최초 소득 발생 연도, 실질 창업 (true/false)
   *   employees, discount                       // 직원 수, 보수 할인율 (0.1 = 10%)
   * }
   */
  function compute(input, data) {
    const { ind, ksic } = index(data);
    const isPro = !!input.isPro, isNew = !!input.isNew;
    const year = num(input.year);

    // --- 업종별 (보조계산 4~6행) ---
    const rows = [0, 1, 2].map(i => {
      const b = (input.biz || [])[i] || {};
      const code = String(b.code || '').trim().slice(0, 6);
      const info = code ? ind.get(code) : null;
      const g = info ? GROUPS[info.group] : null;
      const F = num(b.prev), G = num(b.cur);
      const H = g ? g.book : 0, I = g ? g.simple : 0, J = g ? g.ext : 0, K = g ? g.faithful : 0;
      const Q = info ? info.simple : 0, R = info ? info.simpleOver : 0, S = info ? info.standard : 0;
      const V = G - (R === 0 ? G * Q : Math.min(G, LAW.simpleOverFrom) * Q + Math.max(G - LAW.simpleOverFrom, 0) * R);
      return {
        code, info, found: !!info, F, G, H, I, J, K, Q, R, S,
        L: H ? F / H : 0, M: I ? F / I : 0, N: J ? F / J : 0, O: H ? G / H : 0, P: K ? G / K : 0,
        V, W: G * S, X: G - G * Q
      };
    });
    const sum = k => rows.reduce((s, r) => s + r[k], 0);
    const argmax = k => { let best = 0; rows.forEach((r, i) => { if (r[k] > rows[best][k]) best = i; }); return best; };
    const pm = argmax('F'), cm = argmax('G'); // 직전·해당 주업종
    const prevMain = rows[pm], curMain = rows[cm];
    const mainName = r => r.code ? `${r.code} ${r.info ? r.info.name : ''} (${r.info ? r.info.group : ''})` : '';

    const bookTh = prevMain.H, bookConv = bookTh * sum('L');
    const simpleTh = prevMain.I, simpleConv = simpleTh * sum('M');
    const extTh = prevMain.J, extConv = extTh * sum('N');
    const curBookTh = curMain.H, curBookConv = curBookTh * sum('O');
    const faithTh = curMain.K, faithConv = faithTh * sum('P');
    const prevTotal = sum('F'), rev = sum('G');

    // --- ② 판단 ---
    const bookType = isPro ? '복식부기의무자' : isNew ? '간편장부대상자' : (bookConv >= bookTh ? '복식부기의무자' : '간편장부대상자');
    const isDouble = bookType === '복식부기의무자';
    const bookReason = isPro ? '전문직은 수입 무관' : isNew ? '신규 사업자' : '직전연도 환산수입 기준 (시행령 제208조)';

    let method;
    if (isPro) method = '기준경비율';
    else if (isNew) method = curBookConv < curBookTh ? '단순경비율' : '기준경비율';
    else method = simpleConv < simpleTh && curBookConv < curBookTh ? '단순경비율' : '기준경비율';
    const isStandard = method === '기준경비율';
    const rate = rev === 0 ? 0 : (!isStandard ? (rev - sum('V')) / rev : sum('W') * (isDouble ? LAW.doubleStandardRatio : 1) / rev);
    const methodText = `${method} ${pct(rate)}${isStandard && isDouble ? ' (1/2 적용)' : ''}`;
    const multiBiz = rows.filter(r => r.code).length > 1;

    const external = isDouble && extConv >= extTh ? '외부조정 대상' : '자기조정 가능';
    const faithful = faithTh > 0 && faithConv >= faithTh ? '성실신고확인대상' : '해당 없음';
    const penaltyExcluded = isNew || prevTotal < LAW.smallBizNoBookPenalty;
    const penaltyText = penaltyExcluded ? '제외 (소규모사업자)' : isDouble ? '무기장·무신고 가산세 중 큰 금액' : '산출세액의 20%';
    const bookCredit = bookType === '간편장부대상자' ? '복식부기 신고 시 적용' : '해당 없음';
    const account = isDouble ? '신고·사용 의무' : '의무 없음';

    // --- ③ 창업감면 ---
    const ksicCode = String(input.ksic || '').trim().slice(0, 5);
    const k = ksicCode ? ksic.get(ksicCode) : null;
    const mainTaxCode = curMain.code;
    const mainKsic = mainTaxCode && ind.get(mainTaxCode) ? ind.get(mainTaxCode).ksic : '';
    const startupKind = ksicCode ? (k ? k.startup : '') : (curMain.info ? curMain.info.startup : '');
    const startupNote = ksicCode ? (k ? k.note : '') : (curMain.info ? curMain.info.startupNote : '');
    let ksicText;
    if (ksicCode) ksicText = `${ksicCode} ${k ? k.name : '분류코드 없음'} (직접 선택)`;
    else if (!mainKsic) ksicText = '자동: 주업종 세법코드 기준';
    else {
      const first = ksic.get(mainKsic.slice(0, 5));
      ksicText = `자동: ${mainKsic}${first ? ' ' + first.name + (mainKsic.length > 5 ? ' 등' : '') : ''}`;
    }
    const ksicMatch = !ksicCode ? '주업종 기준'
      : (k && k.taxCode && mainTaxCode && k.taxCode.indexOf(mainTaxCode) >= 0) ? '주업종 코드와 일치' : '주업종 코드와 다름 - 확인';

    const birth = toDay(input.birth), start = toDay(input.startDate);
    const enlist = toDay(input.enlist), discharge = toDay(input.discharge);
    const milDays = enlist != null && discharge != null
      ? Math.max(0, Math.min(discharge - enlist + 1, edate(enlist, 12 * LAW.militaryMaxYears) - enlist)) : 0;
    const milActual = enlist != null && discharge != null ? Math.max(0, discharge - enlist + 1) : 0;
    let milText = '';
    if (milActual > 0) {
      milText = discharge < enlist ? '전역일 확인'
        : `${datedif(enlist, discharge + 1, 'y')}년 ${datedif(enlist, discharge + 1, 'ym')}개월 ${datedif(enlist, discharge + 1, 'md')}일` +
          (milActual > milDays ? ' (6년 한도 적용)' : '');
    }
    const adjStart = start != null ? start - milDays : null;
    const age = birth != null && adjStart != null && adjStart >= birth ? datedif(birth, adjStart, 'y') : null;
    const ageText = age == null ? '입력 필요' : (age >= 15 && age <= LAW.youthMaxAge ? '청년' : '일반 (35세 이상)');
    const livelihood = rev <= LAW.livelihoodLimit;
    const livelihoodText = livelihood ? '해당 (8천만 원 이하)' : '해당 없음';
    const industryText = startupKind + (startupNote ? ' : ' + startupNote : '');
    const industryOk = startupKind === '대상' ? '충족' : startupKind === '일부 대상' ? '충족 (세부 업종 확인)' : '미충족';
    const realOk = input.realStartup ? '충족' : '미충족';
    const fy = input.firstIncomeYear ? num(input.firstIncomeYear) : null;
    const periodText = fy ? `${fy}년 ~ ${fy + 4}년` : '';
    const periodOk = !fy ? '입력 필요' : (year >= fy && year <= fy + 4 ? `기간 내 (${year - fy + 1}년차)` : '기간 경과');
    const ruleText = start == null ? '' : (start < fromYmd(2026, 1, 1) ? '2025.12.31 이전 창업' : '2026.1.1 이후 창업');
    // ※ 엑셀 원본은 LEFT(생계형,2)="해당" 으로 비교해 '해당 없음'도 생계형으로 보는 오류가 있어 바로잡음
    const rateGroup = ageText === '입력 필요' || !ruleText ? '' : (ageText === '청년' || livelihood ? '청년·생계형' : '일반');
    const region = REGIONS.find(r => r[0] === input.region);
    const regionRate = region ? region[1][(ruleText === '2025.12.31 이전 창업' ? 0 : 2) + (rateGroup === '청년·생계형' ? 0 : 1)] : 0;
    const eligible = industryOk.startsWith('충족') && realOk === '충족' && periodOk.startsWith('기간 내');
    const reliefRate = eligible ? regionRate : 0;
    const reliefText = reliefRate > 0 ? `감면 대상 (${pct(reliefRate, 0)}, 5년)`
      : !industryOk.startsWith('충족') ? '감면 제외: 업종 요건 미충족'
      : realOk !== '충족' ? '감면 제외: 실질 창업 아님'
      : !periodOk.startsWith('기간 내') ? '감면 제외: 감면기간 아님'
      : '감면 제외: 지역·연령 요건 (과밀억제권역 일반창업)';

    // --- ④ 추계 vs 장부 ---
    const purchase = num(input.purchase), rent = num(input.rent), labor = num(input.labor);
    const mainExp = purchase + rent + labor;
    const book = num(input.bookExpense), deduction = num(input.deduction);
    const simpleIncome = sum('X');
    const cap = isStandard ? xround(simpleIncome * (isDouble ? LAW.capMultipleDouble : LAW.capMultipleSimple), 0) : null;
    const estExp = xround(rev * rate, 0) + (isStandard ? mainExp : 0);
    const bookExp = Math.min(book, rev);
    const taxOf = base => { if (base <= 0) return 0; const b = lookup(BRACKETS, base); return base * b[1] - b[2]; };

    const col = (name, expense, income, reliefOn, credit, penalty) => {
      const taxBase = Math.max(income - deduction, 0);
      const tax = taxOf(taxBase);
      const relief = reliefOn ? -tax * reliefRate : 0;
      const cr = credit ? credit(tax, relief) : 0;
      const pen = penalty(tax);
      const decided = Math.max(tax + relief + cr, 0) + pen;
      const local = decided * LAW.localTaxRate;
      return { name, revenue: rev, rate: rev === 0 ? 0 : expense / rev, expense, income, deduction, taxBase, tax, relief, credit: cr, penalty: pen, decided, local, total: decided + local };
    };
    const estIncome = Math.max(isStandard ? Math.min(rev - estExp, cap) : rev - estExp, 0);
    const est = col(`추계 (${method})`, estExp, estIncome, !isDouble, null,
      t => penaltyExcluded ? 0 : (isDouble ? Math.max(t * LAW.noBookPenaltyRate, rev * LAW.noReturnRate) : t * LAW.noBookPenaltyRate));
    est.rate = rate;
    const simple = col('간편장부', bookExp, Math.max(rev - bookExp, 0), !isDouble, null,
      t => isDouble && !penaltyExcluded ? Math.max(t * LAW.noBookPenaltyRate, rev * LAW.noReturnRate) : 0);
    const double = col('복식부기', bookExp, Math.max(rev - bookExp, 0), true,
      bookType === '간편장부대상자' ? (t, r) => -Math.min(t * LAW.bookCreditRate, LAW.bookCreditLimit, t + r) : null, () => 0);
    const cols = [est, simple, double];
    simple.saving = est.total - simple.total; double.saving = est.total - double.total; est.saving = 0;
    const minTotal = Math.min(...cols.map(c => c.total));
    const best = minTotal === est.total ? `${est.name} (장부 신고보다 세 부담이 적음)`
      : `${cols.find(c => c.total === minTotal).name} (추계 대비 ${fmt(Math.max(simple.saving, double.saving))}원 절감)`;

    const expenseNote = isStandard
      ? `주요경비 ${fmt(mainExp)} + 수입×기준경비율 ${fmt(xround(rev * rate, 0))}${isDouble ? ' (복식부기의무자 1/2)' : ''} = ${fmt(estExp)}원`
      : `수입 ${fmt(rev)} × 단순경비율 ${pct(rate)} = ${fmt(estExp)}원`;
    const capNote = !isStandard ? '단순경비율 적용 대상이라 한도 계산 없음'
      : `단순경비율 소득금액 ${fmt(simpleIncome)}원 × 배율 ${isDouble ? LAW.capMultipleDouble.toFixed(1) + ' (복식부기의무자)' : LAW.capMultipleSimple.toFixed(1) + ' (간편장부대상자)'} = ${fmt(cap)}원`;
    const incomeNote = !isStandard ? `수입 ${fmt(rev)} − 필요경비 ${fmt(estExp)} = ${fmt(estIncome)}원`
      : `MIN(수입−필요경비 ${fmt(rev - estExp)}, 한도 ${fmt(cap)}) = ${fmt(estIncome)}원${cap < rev - estExp ? ' → 한도 적용' : ' → 한도 미적용'}`;
    const reliefNote = isDouble && reliefRate > 0
      ? '복식부기의무자가 추계·간편장부로 신고하면 무신고로 간주되어 감면 배제 (소득세법 §70④, 조특법 §128②)'
      : '산출세액 × 최종 감면율. 간편장부대상자는 추계신고도 감면 가능';

    // --- ⑤ 보수 ---
    const emp = num(input.employees), disc = num(input.discount);
    const mRow = lookup(FEE.monthly, rev);
    const monthlyBase = rev <= 0 ? 0 : mRow[1];
    const aRow = lookup(FEE.adjust, rev);
    const adjustBase = Math.max(FEE.minAdjust, aRow[1] + (rev - aRow[0]) * aRow[2]);
    const isExternal = external === '외부조정 대상';
    const monthly = [0, xround((monthlyBase + emp * FEE.perEmployee) * FEE.simpleBookRatio * (1 - disc), -3),
      xround((monthlyBase + emp * FEE.perEmployee) * (1 - disc), -3)];
    const adjust = [xround(adjustBase * FEE.estimateRatio * (1 - disc), -3), xround(adjustBase * FEE.simpleAdjustRatio * (1 - disc), -3),
      xround(adjustBase * (isExternal ? 1 + FEE.externalExtra : 1) * (1 - disc), -3)];
    const faithFee = [0, 0, faithful === '성실신고확인대상' ? xround(Math.max(FEE.faithfulMin, adjustBase * FEE.faithfulMultiple) * (1 - disc), -3) : 0];
    const fees = cols.map((c, i) => {
      const yearly = monthly[i] * 12, supply = yearly + adjust[i] + faithFee[i], vat = supply * FEE.vat;
      return { name: c.name, monthly: monthly[i], yearly, adjust: adjust[i], faithful: faithFee[i], supply, vat, withVat: supply + vat, grand: c.total + supply + vat };
    });
    fees.forEach(f => { f.net = fees[0].grand - f.grand; });
    const minGrand = Math.min(...fees.map(f => f.grand));
    const bestWithFee = `${fees.find(f => f.grand === minGrand).name} (세금+보수 ${fmt(minGrand)}원)`;
    const mIdx = FEE.monthly.indexOf(mRow), aIdx = FEE.adjust.indexOf(aRow);
    const range = (t, i) => `연 매출 ${fmt(t[i][0])}원 이상${t[i + 1] ? ' ~ ' + fmt(t[i + 1][0]) + '원 미만' : ''} 구간`;
    const monthlyNote = `${range(FEE.monthly, mIdx)} → 월 ${fmt(monthlyBase)}원 + 직원 ${emp}명 × ${fmt(FEE.perEmployee)}원 / 간편장부 × ${pct(FEE.simpleBookRatio, 0)}${disc > 0 ? ' / 할인 ' + pct(disc, 0) : ''} (천 원 단위)`;
    const adjustNote = `${range(FEE.adjust, aIdx)}: 기본료 ${fmt(aRow[1])}원 + 초과분 ${fmt(rev - aRow[0])}원 × ${pct(aRow[2], 2)} = 기준 조정료 ${fmt(adjustBase)}원 → 추계 × ${pct(FEE.estimateRatio, 0)} / 간편 × ${pct(FEE.simpleAdjustRatio, 0)} / 복식 × ${pct(isExternal ? 1 + FEE.externalExtra : 1, 0)}${isExternal ? ' (외부조정)' : ''}`;

    return {
      rows: rows.map(r => ({ code: r.code, found: r.found, info: r.info, prev: r.F, cur: r.G, simple: r.Q, simpleOver: r.R, standard: r.S })),
      prevMainName: mainName(prevMain), curMainName: mainName(curMain),
      judge: {
        book: { threshold: bookTh, amount: bookConv, result: bookType, reason: bookReason },
        rate: { threshold: simpleTh, amount: simpleConv, result: methodText, method, rate, multiBiz },
        external: { threshold: extTh, amount: extConv, result: external },
        faithful: { threshold: faithTh, amount: faithConv, result: faithful },
        penalty: { threshold: LAW.smallBizNoBookPenalty, amount: prevTotal, result: penaltyText },
        bookCredit, account
      },
      startup: {
        ksicText, ksicMatch, linkedTaxCode: k ? k.taxCode : '', age, ageText, milText, revenue: rev, livelihoodText,
        industryText, industryOk, realOk, periodText, periodOk, ruleText, region: input.region || '', rateGroup, regionRate, reliefRate, reliefText
      },
      tax: { cols, cap, best, expenseNote, capNote, incomeNote, reliefNote, isDouble, isStandard },
      fee: { rows: fees, best: bestWithFee, monthlyNote, adjustNote }
    };
  }

  return { compute, GROUPS, LAW, BRACKETS, REGIONS, FEE, toDay };
});
