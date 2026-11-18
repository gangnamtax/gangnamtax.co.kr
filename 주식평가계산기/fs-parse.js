/**
 * 세무회계강남 주식평가 계산기 - 재무제표 · 법인세 신고서 글자에서 숫자 찾기 (무료 자동 입력)
 * PDF 글자 레이어 또는 구글 드라이브 OCR로 얻은 쪽별 글자를 받아, 서식 문구 옆의 금액을 찾아
 * Claude 인식과 같은 모양({ companyName, sharesIssued, fiscalYears, balanceSheets, notes })으로 돌려줌.
 * 서식이 정해진 문서(법인세 과세표준 및 세액조정계산서, 소득금액조정합계표, 재무상태표 등)만 대상.
 */
(function (root) {
    // 금액: 1,234,567 / △1,234 / -1,234 / (1,234) / 쉼표 없는 5자리 이상
    const AMOUNT = /(△|▲|-|\()?\s*(\d{1,3}(?:,\d{3})+|\d{5,})(\))?(?![\d,])/g;

    // 글자 사이 공백 · 원문자 · 줄바꿈을 허용하는 라벨 패턴
    function labelRe(label) {
        const chars = [...label.replace(/\s+/g, '')].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        return new RegExp(chars.join('[\\s\\u2460-\\u24ff\\u3251-\\u32bf·ㆍ]*'), 'g');
    }
    function parseAmount(m) {
        const n = Number(m[2].replace(/,/g, ''));
        return m[1] && m[1] !== '' ? -n : n;
    }
    // 다음 항목이 시작되는 곳: 원문자(⑩⑤), 줄 첫머리의 한글 · 원문자 · "105 한글" 같은 서식 코드
    const NEXT_ITEM = /[①-⓿㉑-㊿]|\n\s*(?:[가-힣]|\(?\d{2,3}\)?\s*[가-힣])/;
    // 라벨 뒤에서 다음 항목 전까지 처음 나오는 금액 (서식 코드 107 같은 3자리 이하 숫자는 건너뜀)
    function amountAfter(text, label, opts) {
        opts = opts || {};
        const re = labelRe(label);
        let m;
        while ((m = re.exec(text))) {
            const rest = text.slice(m.index + m[0].length, m.index + m[0].length + (opts.window || 160));
            const stop = rest.search(opts.stopAt || NEXT_ITEM);
            const scope = stop >= 0 ? rest.slice(0, stop) : rest;
            AMOUNT.lastIndex = 0;
            const a = AMOUNT.exec(scope);
            if (a) return parseAmount(a);
            if (!opts.all) return null;
        }
        return null;
    }
    // 줄 단위로 키워드가 들어간 줄의 첫 금액을 모두 더함 (소득금액조정합계표처럼 과목별로 줄이 있는 표)
    function sumLines(text, keywords, exclude) {
        let sum = 0, found = false;
        text.split(/\n/).forEach(line => {
            const flat = line.replace(/\s+/g, '');
            if (!keywords.some(k => flat.includes(k))) return;
            if (exclude && exclude.some(k => flat.includes(k))) return;
            AMOUNT.lastIndex = 0;
            const a = AMOUNT.exec(line);
            if (a) { sum += Math.abs(parseAmount(a)); found = true; }
        });
        return found ? sum : null;
    }
    const pad = n => String(n).padStart(2, '0');
    // 사업연도 종료일: "사업연도 2022.01.01 ~ 2022.12.31" / "2022년 1월 1일부터 2022년 12월 31일까지"
    function fiscalEnd(text) {
        const D = '(\\d{4})\\s*[.\\-/년]\\s*(\\d{1,2})\\s*[.\\-/월]\\s*(\\d{1,2})\\s*일?';
        const m = new RegExp(`사\\s*업\\s*연\\s*도[\\s\\S]{0,40}?${D}[\\s\\S]{0,12}?(?:~|∼|-|부터)[\\s\\S]{0,6}?${D}`).exec(text);
        return m ? `${m[4]}-${pad(m[5])}-${pad(m[6])}` : null;
    }
    function asOfDate(text) {
        const m = /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*현\s*재/.exec(text);
        return m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : null;
    }
    function pageKind(text) {
        const flat = text.replace(/\s+/g, '');
        if (/지방소득세과세표준및세액/.test(flat)) return 'local';
        if (/농어촌특별세과세표준및세액/.test(flat)) return 'rural';
        if (/법인세과세표준및세액조정계산서/.test(flat)) return 'taxcalc';
        if (/소득금액조정합계표/.test(flat)) return 'adjust';
        if (/재무상태표|대차대조표/.test(flat)) return 'bs';
        if (/주식등변동상황명세서|주식등\s*변동/.test(flat)) return 'shares';
        if (/손익계산서/.test(flat)) return 'pl';
        return '';
    }

    function parseFinancials(pages) {
        // 파일별 사업연도 (쪽에 사업연도가 안 보이면 같은 파일의 다른 쪽 · 파일 이름의 연도로)
        const fileEnd = {};
        pages.forEach(p => { const e = fiscalEnd(p.text); if (e && !fileEnd[p.file]) fileEnd[p.file] = e; });
        const years = {}, sheets = {}, found = {};
        let companyName = null, sharesIssued = null;
        const Y = end => years[end] || (years[end] = { fiscalYearEnd: end });
        const set = (obj, k, v) => { if (v !== null && v !== undefined && (obj[k] === undefined || obj[k] === null)) obj[k] = v; };
        const add = (obj, k, v) => { if (v !== null && v !== undefined) obj[k] = (obj[k] || 0) + v; };

        pages.forEach(p => {
            const t = p.text || '';
            const kind = pageKind(t);
            if (!kind) return;
            found[kind] = (found[kind] || 0) + 1;
            const nameM = /법\s*인\s*명[\s:：]*([^\n]{2,30}?)(?:\s{2,}|\n|사업자)/.exec(t);
            if (!companyName && nameM) companyName = nameM[1].replace(/\s+/g, ' ').trim();
            let end = fiscalEnd(t) || fileEnd[p.file];
            if (!end) { const fy = /(20\d{2})/.exec(p.file || ''); if (fy) end = `${fy[1]}-12-31`; }

            if (kind === 'taxcalc' && end) {
                const y = Y(end);
                set(y, 'income', amountAfter(t, '각사업연도소득금액'));
                set(y, 's15', amountAfter(t, '기부금한도초과액'));
                set(y, 'a4', amountAfter(t, '기부금한도초과이월액손금산입'));
                set(y, 's8', amountAfter(t, '총부담세액') ?? amountAfter(t, '가감계'));
            } else if (kind === 'local' && end) {
                set(Y(end), 's9b', amountAfter(t, '총부담세액') ?? amountAfter(t, '가감계') ?? amountAfter(t, '산출세액'));
            } else if (kind === 'rural' && end) {
                set(Y(end), 's9a', amountAfter(t, '납부할세액') ?? amountAfter(t, '산출세액'));
            } else if (kind === 'adjust' && end) {
                const y = Y(end);
                set(y, 's16', sumLines(t, ['접대비', '기업업무추진비']));
                set(y, 's10', sumLines(t, ['벌과금', '벌금', '과태료', '가산세', '가산금', '체납처분비']));
                set(y, 's11', sumLines(t, ['공과금'], ['벌과금']));
                set(y, 's17', sumLines(t, ['업무무관']));
                set(y, 's18', sumLines(t, ['업무용승용차']));
                set(y, 's19', sumLines(t, ['지급이자']));
                set(y, 'a3', sumLines(t, ['수입배당금']));
                set(y, 'a2', sumLines(t, ['환급금이자', '환급가산금']));
                y._adjDonation = sumLines(t, ['기부금'], ['한도초과']);
            } else if (kind === 'bs') {
                const asOf = asOfDate(t) || end;
                if (!asOf) return;
                const s = sheets[asOf] || (sheets[asOf] = { asOf });
                set(s, 'totalAssets', amountAfter(t, '자산총계'));
                set(s, 'totalLiabilities', amountAfter(t, '부채총계'));
                const realty = ['토지', '건물', '구축물', '건설중인자산'].map(l => amountAfter(t, l, { window: 60 })).filter(v => v !== null);
                if (realty.length) set(s, 'realty', realty.reduce((a, b) => a + b, 0));
                set(s, 'prepaid', amountAfter(t, '선급비용', { window: 60 }));
                set(s, 'provisions', amountAfter(t, '퇴직급여충당부채', { window: 60 }) ?? amountAfter(t, '퇴직급여충당금', { window: 60 }));
                set(s, 'intangibles', amountAfter(t, '무형자산', { window: 60 }));
            } else if (kind === 'shares' && end) {
                const n = amountAfter(t, '발행주식총수') ?? amountAfter(t, '기말주식수');
                set(Y(end), 'sharesAtYearEnd', n);
                if (!sharesIssued) sharesIssued = n;
            }
        });
        // 기부금 손금불산입 = 세액조정계산서 한도초과액 + 소득금액조정합계표의 비지정기부금 등
        Object.values(years).forEach(y => { if (y._adjDonation) add(y, 's15', y._adjDonation); delete y._adjDonation; });
        const kinds = { taxcalc: '세액조정계산서', adjust: '소득금액조정합계표', bs: '재무상태표', local: '지방소득세 신고서', rural: '농어촌특별세 신고서', shares: '주식등변동상황명세서', pl: '손익계산서' };
        const notes = Object.keys(found).map(k => `${kinds[k]} ${found[k]}쪽`).join(', ');
        return {
            companyName, sharesIssued,
            fiscalYears: Object.values(years), balanceSheets: Object.values(sheets),
            notes: notes ? `찾은 서식: ${notes}` : '알아볼 수 있는 서식(세액조정계산서 · 소득금액조정합계표 · 재무상태표)을 찾지 못했습니다.'
        };
    }

    root.parseFinancials = parseFinancials;
    root.__fsParse = { amountAfter, sumLines, fiscalEnd, asOfDate, pageKind };
})(typeof window !== 'undefined' ? window : globalThis);
