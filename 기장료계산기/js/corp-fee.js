// 법인 기장료 · 법인세 조정료 계산 (세무회계강남 기장수수료테이블_수정.xlsx 기준, 부가세 별도 금액)
// 브라우저(window.CorpFee)와 Node(require) 양쪽에서 동작
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CorpFee = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 월 기장료: [매출액 하한(이상), 월 기장료, 구간 이름]
  const MONTHLY = [
    [0, 150000, '신규법인 및 1억원 미만'],
    [100000000, 200000, '1억원 이상 ~ 3억원 미만'],
    [300000000, 200000, '3억원 이상 ~ 5억원 미만'],
    [500000000, 250000, '5억원 이상 ~ 10억원 미만'],
    [1000000000, 300000, '10억원 이상 ~ 20억원 미만'],
    [2000000000, 400000, '20억원 이상 ~ 30억원 미만'],
    [3000000000, 500000, '30억원 이상 ~ 40억원 미만'],
    [4000000000, 600000, '40억원 이상 ~ 50억원 미만'],
    [5000000000, 700000, '50억원 이상 ~ 80억원 미만'],
    [8000000000, 800000, '80억원 이상 ~ 100억원 미만'],
    [10000000000, 1000000, '100억원 이상']
  ];
  const OVER_100_STEP = 5000000000;  // 100억원 초과 시 50억원마다
  const OVER_100_ADD = 500000;       //   월 50만원 추가
  const PREMIUM = 1.3;               // 고급기장 가산 배수

  // 법인세 조정료: [수입금액 하한, 이전구간금액(초과액 기준점), 요율, 이전구간가산액, 계산식]
  const ADJUST = [
    [0, 0, 0.004, 0, '40만원'],
    [100000000, 100000000, 0.0019, 400000, '40만원 + 1억원 초과액 × 0.19%'],
    [300000000, 300000000, 0.001, 780000, '78만원 + 3억원 초과액 × 0.10%'],
    [500000000, 500000000, 0.0007, 980000, '98만원 + 5억원 초과액 × 0.07%'],
    [1000000000, 1000000000, 0.0006, 1330000, '133만원 + 10억원 초과액 × 0.06%'],
    [3000000000, 3000000000, 0.0005, 2530000, '253만원 + 30억원 초과액 × 0.05%'],
    [5000000000, 5000000000, 0.0004, 3530000, '353만원 + 50억원 초과액 × 0.04%'],
    [7500000000, 7500000000, 0.0003, 4530000, '453만원 + 75억원 초과액 × 0.03%'],
    [10000000000, 10000000000, 0.0002, 5280000, '528만원 + 100억원 초과액 × 0.02%'],
    // ※ 엑셀 원본은 이 구간이 1,000억원부터 시작해(B49=1000억) 500억~1,000억원에 0.02%가 계속 적용되고
    //   1,000억원 정각에서 조정료가 떨어지는 오류가 있어, 계산식 문구대로 500억원부터 적용
    [50000000000, 50000000000, 0.0001, 13280000, '1,328만원 + 500억원 초과액 × 0.01%'],
    [100000000001, 100000000000, 0.00005, 18200000, '1,820만원 + 1,000억원 초과액 × 0.005%']
  ];
  const MIN_ADJUST = 400000;
  const VAT = 0.1;

  const lookup = (table, x) => { let row = table[0]; for (const t of table) if (t[0] <= x) row = t; return row; };

  /**
   * input = { revenue, isNew, premium }  (premium: 고급기장 해당 여부)
   */
  function compute(input) {
    const revenue = Math.max(0, Number(input.revenue) || 0);
    const isNew = !!input.isNew;
    const premium = !!input.premium;

    // 월 기장료 (엑셀: INDEX(구간) + 100억 초과 시 INT((매출-100억-1)/50억+1)×50만)
    const row = isNew ? MONTHLY[0] : lookup(MONTHLY, revenue);
    const over100 = !isNew && revenue > 10000000000 ? Math.floor((revenue - 10000000001) / OVER_100_STEP + 1) * OVER_100_ADD : 0;
    const monthlyBase = row[1] + over100;
    const monthly = Math.round(monthlyBase * (premium ? PREMIUM : 1));
    const monthlyVat = monthly * VAT;

    // 조정료 (엑셀: MAX((매출 − 구간 기준점) × 요율 + 이전구간가산액, 40만원))
    const a = lookup(ADJUST, revenue);
    const adjust = Math.max((revenue - a[1]) * a[2] + a[3], MIN_ADJUST);
    const adjustVat = adjust * VAT;

    const yearlyBookkeeping = (monthly + monthlyVat) * 12;
    const total = yearlyBookkeeping + adjust + adjustVat;
    return {
      revenue, isNew, premium,
      bracket: isNew ? '신규법인' : row[2], monthlyBase, over100, monthly, monthlyVat, monthlyWithVat: monthly + monthlyVat,
      yearlyBookkeeping, adjustFormula: a[4], adjust, adjustVat, adjustWithVat: adjust + adjustVat,
      total, perMonth: total / 12
    };
  }

  // ===== 예상 법인세 (법인세법 제55조) =====
  // [과세표준 상한, 세율] — 사업연도 개시일 기준
  const CORP_TAX = {
    2026: { label: '2026.1.1 이후 개시 사업연도', normal: [[2e8, 0.10], [200e8, 0.20], [3000e8, 0.22], [Infinity, 0.25]],
      // 성실신고확인대상 소규모 법인 (부동산임대업 주업 등, 법인세법 제55조 제1항 단서): 2억 이하 구간 없음
      small: [[200e8, 0.20], [3000e8, 0.22], [Infinity, 0.25]] },
    2025: { label: '2025.12.31 이전 개시 사업연도', normal: [[2e8, 0.09], [200e8, 0.19], [3000e8, 0.21], [Infinity, 0.24]],
      small: [[200e8, 0.19], [3000e8, 0.21], [Infinity, 0.24]] }
  };
  const LOCAL_TAX = 0.1;

  /** base: 과세표준(예상 이익), year: 2025 | 2026, small: 성실신고확인대상 소규모 법인 */
  function corpTax(base, year, small) {
    base = Math.max(0, Math.floor(Number(base) || 0));
    const t = CORP_TAX[year] || CORP_TAX[2026];
    const table = small ? t.small : t.normal;
    let tax = 0, prev = 0;
    const steps = [];
    for (const [limit, rate] of table) {
      if (base <= prev) break;
      const part = Math.min(base, limit) - prev;
      tax += part * rate;
      steps.push({ from: prev, to: Math.min(base, limit), rate, tax: part * rate });
      prev = limit;
    }
    tax = Math.floor(tax);
    const local = Math.floor(tax * LOCAL_TAX);
    return { base, year: CORP_TAX[year] ? year : 2026, label: t.label, small: !!small, steps, tax, local, total: tax + local,
      effective: base ? (tax + local) / base : 0 };
  }

  return { compute, corpTax, MONTHLY, ADJUST, PREMIUM, CORP_TAX };
});
