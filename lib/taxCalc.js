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

    let longTermRate = 0;
    let longTermFormulaStr = '';
    if (holdingYears < 3) {
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

    if (shortTermRate > 0) {
        tax = taxBase * shortTermRate;
        appliedRateStr = `적용세율 : ${(shortTermRate * 100).toFixed(0)}% (단기보유)`;
    } else if (taxBase <= 14000000) {
        tax = taxBase * 0.06;
        appliedRateStr = '적용세율 : 6%';
    } else if (taxBase <= 50000000) {
        tax = taxBase * 0.15 - 1260000;
        appliedRateStr = '적용세율 : 15%';
    } else if (taxBase <= 88000000) {
        tax = taxBase * 0.24 - 5760000;
        appliedRateStr = '적용세율 : 24%';
    } else if (taxBase <= 150000000) {
        tax = taxBase * 0.35 - 15440000;
        appliedRateStr = '적용세율 : 35%';
    } else if (taxBase <= 300000000) {
        tax = taxBase * 0.38 - 19940000;
        appliedRateStr = '적용세율 : 38%';
    } else if (taxBase <= 500000000) {
        tax = taxBase * 0.40 - 25940000;
        appliedRateStr = '적용세율 : 40%';
    } else if (taxBase <= 1000000000) {
        tax = taxBase * 0.42 - 35940000;
        appliedRateStr = '적용세율 : 42%';
    } else {
        tax = taxBase * 0.45 - 65940000;
        appliedRateStr = '적용세율 : 45%';
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
