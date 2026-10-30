// 양도소득세 계산 로직 (서버 전용 - 브라우저에 공개되지 않음)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(str) {
    if (!DATE_RE.test(str || '')) return null;
    const d = new Date(str + 'T00:00:00');
    return isNaN(d) ? null : d;
}

// 달력 기준 만 연수 (기념일 당일 양도 시 1년 인정)
function fullYearsBetween(startStr, endStr) {
    const start = parseDate(startStr);
    const end = parseDate(endStr);
    if (!start || !end || end < start) return null;

    let years = end.getFullYear() - start.getFullYear();
    if (end.getMonth() < start.getMonth() ||
        (end.getMonth() === start.getMonth() && end.getDate() < start.getDate())) {
        years -= 1;
    }
    return years;
}

function toAmount(v) {
    const n = Number(String(v ?? '').replace(/[^0-9]/g, ''));
    return Number.isFinite(n) ? n : 0;
}

function calculateTax(input) {
    const transferPrice = toAmount(input.transferPrice);
    const acquisitionPrice = toAmount(input.acquisitionPrice);
    const expenses = toAmount(input.expenses);
    const taxType = input.taxType === 'general' ? 'general' : 'single_house';

    const holdingYears = fullYearsBetween(input.acquisitionDate, input.transferDate);
    if (holdingYears === null) {
        return { error: '보유 기간 날짜를 올바르게 입력해주세요.' };
    }

    const totalMargin = transferPrice - acquisitionPrice - expenses;
    if (totalMargin <= 0) {
        return { error: '양도차익이 발생하지 않았거나 입력 금액을 확인해주세요.' };
    }

    // 1세대 1주택 비과세는 2년 이상 보유 시에만 적용 (조정대상지역 취득분 2년 거주 요건은 별도 확인 필요)
    const isSingleHouseExempt = taxType === 'single_house' && holdingYears >= 2;

    if (isSingleHouseExempt && transferPrice <= 1200000000) {
        return {
            exempt: true,
            profitLabel: '양도차익 (1세대 1주택 비과세)',
            profit: totalMargin,
            longTermLabel: '장기보유특별공제',
            longTermDeduction: 0,
            taxBase: 0,
            rateLabel: '양도소득세 (비과세: 양도가액 12억 이하)',
            tax: 0,
            localTax: 0,
            total: 0
        };
    }

    let taxableMargin = totalMargin;
    let profitLabel = '양도차익';
    if (isSingleHouseExempt) {
        taxableMargin = totalMargin * ((transferPrice - 1200000000) / transferPrice);
        profitLabel = '양도차익 (12억 초과 과세분)';
    }

    let residenceYears = 0;
    if (isSingleHouseExempt) {
        residenceYears = fullYearsBetween(input.residenceStartDate, input.residenceEndDate) || 0;
    }

    // 다주택자 중과: 조정대상지역 주택 양도 시 2주택 +20%p, 3주택 이상 +30%p, 장기보유특별공제 배제
    const heavy = taxType === 'general' && [20, 30].includes(Number(input.heavy)) ? Number(input.heavy) : 0;
    const heavyLabel = heavy === 30 ? '조정대상지역 3주택 이상' : '조정대상지역 2주택';

    let longTermRate = 0;
    let longTermFormulaStr = '';
    if (heavy) {
        longTermFormulaStr = '중과 대상 – 공제 배제 (0%)';
    } else if (holdingYears < 3) {
        longTermFormulaStr = '보유 3년 미만 (0%)';
    } else if (isSingleHouseExempt && residenceYears >= 2) {
        // 표2: 1세대 1주택 + 거주 2년 이상 → 보유 연 4% + 거주 연 4% (각 최대 40%)
        const holdingRate = Math.min(holdingYears * 0.04, 0.40);
        const residenceRate = Math.min(residenceYears * 0.04, 0.40);
        longTermRate = Math.min(holdingRate + residenceRate, 0.80);
        longTermFormulaStr = `보유(${holdingYears}년×4%)+거주(${residenceYears}년×4%) = ${(longTermRate * 100).toFixed(0)}%`;
    } else {
        // 표1: 일반 → 보유 연 2% (최대 30%)
        longTermRate = Math.min(holdingYears * 0.02, 0.30);
        longTermFormulaStr = `보유(${holdingYears}년×2%, 최대30%) = ${(longTermRate * 100).toFixed(0)}%`;
    }

    const longTermDeduction = taxableMargin * longTermRate;
    const basicDeduction = 2500000;
    const taxBase = Math.max(0, taxableMargin - longTermDeduction - basicDeduction);

    let tax = 0;
    let appliedRateStr = '';

    // 주택 단기보유 세율: 보유기간만으로 자동 적용 (1년 미만 70%, 2년 미만 60%)
    let shortTermRate = 0;
    if (holdingYears < 1) {
        shortTermRate = 0.70;
    } else if (holdingYears < 2) {
        shortTermRate = 0.60;
    }

    const brackets = [
        [14000000, 0.06, 0], [50000000, 0.15, 1260000], [88000000, 0.24, 5760000],
        [150000000, 0.35, 15440000], [300000000, 0.38, 19940000], [500000000, 0.40, 25940000],
        [1000000000, 0.42, 35940000], [Infinity, 0.45, 65940000]
    ];
    const [, rate, deduction] = brackets.find(([limit]) => taxBase <= limit);
    const basicTax = taxBase * (rate + heavy / 100) - deduction;
    const basicRateStr = heavy
        ? `적용세율 : ${(rate * 100).toFixed(0)}% + 중과 ${heavy}%p (${heavyLabel})`
        : `적용세율 : ${(rate * 100).toFixed(0)}%`;

    if (shortTermRate > 0) {
        // 단기보유: 단기세율 세액과 (중과가 있으면) 중과세율 세액 중 큰 금액
        const shortTax = taxBase * shortTermRate;
        if (heavy && basicTax > shortTax) {
            tax = basicTax;
            appliedRateStr = `${basicRateStr}, 단기세율보다 큼`;
        } else {
            tax = shortTax;
            appliedRateStr = `적용세율 : ${(shortTermRate * 100).toFixed(0)}% (단기보유)`;
        }
    } else {
        tax = basicTax;
        appliedRateStr = basicRateStr;
    }

    tax = Math.max(0, tax);
    const localTax = tax * 0.1;

    return {
        exempt: false,
        profitLabel,
        profit: Math.round(taxableMargin),
        longTermLabel: `장기보유특별공제 (${longTermFormulaStr})`,
        longTermDeduction: Math.round(longTermDeduction),
        taxBase: Math.round(taxBase),
        rateLabel: `양도소득세 (${appliedRateStr})`,
        tax: Math.round(tax),
        localTax: Math.round(localTax),
        total: Math.round(tax + localTax)
    };
}

module.exports = { calculateTax };
