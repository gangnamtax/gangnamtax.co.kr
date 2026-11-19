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
    // 다음 항목이 시작되는 곳: 원문자(⑩⑤), 또는 한글 · 로마숫자(Ⅸ)가 들어 있는 다음 줄
    // (숫자만 있는 다음 줄은 같은 항목의 금액일 수 있어 계속 봄)
    const NEXT_ITEM = /[①-⓿㉑-㊿]|\n(?=[^\n]*[가-힣Ⅰ-ⅿ])/;
    const TOKEN = /(△|▲|-|\()?\s*(\d{1,3}(?:,\d{3})+|\d+)(\))?(?![\d,])/g;
    // 라벨 뒤에서 다음 항목 전까지의 금액
    // - 쉼표가 있거나 5자리 이상인 숫자를 먼저 (서식 코드 107 · 06 같은 짧은 숫자는 건너뜀)
    // - 없으면 "코드 금액" 순서로 보고 마지막 짧은 숫자 (예: "218   0", "036   550")
    function amountAfter(text, label, opts) {
        opts = opts || {};
        const re = labelRe(label);
        let m;
        while ((m = re.exec(text))) {
            const rest = text.slice(m.index + m[0].length, m.index + m[0].length + (opts.window || 160));
            const stop = rest.search(opts.stopAt || NEXT_ITEM);
            const scope = (stop >= 0 ? rest.slice(0, stop) : rest)
                .replace(/\([^()\n]*[+\-~～][^()\n]*\)/g, ' ');   // (104+105-106), (Ⅰ+Ⅱ) 같은 계산식 빼기
            const toks = [];
            let a;
            TOKEN.lastIndex = 0;
            while ((a = TOKEN.exec(scope))) toks.push(a);
            const big = toks.find(t => t[2].includes(',') || t[2].length >= 5);
            if (big) return parseAmount(big);
            // 짧은 숫자는 라벨과 같은 줄에 있을 때만 금액으로 봄 (다음 줄의 짧은 숫자는 OCR이 흩어 놓은 서식 코드)
            const line = scope.split('\n')[0];
            const lt = [];
            TOKEN.lastIndex = 0;
            while ((a = TOKEN.exec(line))) lt.push(a);
            if (lt.length >= 2) return parseAmount(lt[lt.length - 1]);
            if (lt.length === 1 && lt[0][2] === '0') return 0;
            if (opts.first) return null;   // 기본은 같은 라벨이 뒤에 또 나오면 거기서 다시 찾음 (예: 토지등 '가감계' 다음의 법인세 '가감계')
        }
        return null;
    }
    // OCR이 표를 "과목들 → 금액들" 순서로 흩어 놓은 경우: 과목 줄과 금액 줄을 차례대로 짝지음
    function pairColumn(text, start, end) {
        const lines = text.slice(start, end).split('\n').map(s => s.trim()).filter(Boolean);
        const names = [], amounts = [];
        const HEAD = /과목|금액|처분|코드|익금산입|손금불산입|손금산입|익금불산입|합계|법인명|사업자|소득금액조정|앞쪽|서식|연도|사업|주\)|주식회사|유출|유보|상여|배당|기타$/;
        lines.forEach(l => {
            const am = /^(△|-)?\s*(\d{1,3}(?:,\d{3})+)/.exec(l);
            if (am) { amounts.push((am[1] ? -1 : 1) * Number(am[2].replace(/,/g, ''))); return; }
            if (/[가-힣]{2,}/.test(l) && !/\d/.test(l) && !HEAD.test(l.replace(/\s/g, ''))) names.push(l.replace(/\s+/g, ''));
        });
        return names.length && names.length === amounts.length ? names.map((n, i) => ({ name: n, amount: amounts[i] })) : [];
    }
    // 소득금액조정합계표 왼쪽(익금산입 및 손금불산입) 과목별 금액
    function adjustItems(text) {
        const flat = text;
        const s = flat.search(labelRe('익금산입및손금불산입'));
        if (s < 0) return [];
        // 표 끝의 "합계" 줄 (제목 '소득금액조정합계표'의 합계는 제외)
        let e = flat.slice(s + 5).search(/(^|\n)[\s\d]*합\s*계(?!\s*표)/);
        e = e < 0 ? flat.length : s + 5 + e;
        // 1) 한 줄에 "과목 금액"이 같이 있는 경우
        const inline = [];
        flat.slice(s, e).split('\n').forEach(l => {
            const m = /([가-힣][가-힣\s·()]{1,30}?)\s+(△|-)?\s*(\d{1,3}(?:,\d{3})+)/.exec(l);
            if (m) inline.push({ name: m[1].replace(/\s+/g, ''), amount: (m[2] ? -1 : 1) * Number(m[3].replace(/,/g, '')) });
        });
        return inline.length ? inline : pairColumn(flat, s, e);
    }
    function sumItems(items, keywords, exclude) {
        const hit = items.filter(it => keywords.some(k => it.name.includes(k)) && !(exclude || []).some(k => it.name.includes(k)));
        return hit.length ? hit.reduce((a, it) => a + Math.abs(it.amount), 0) : null;
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
    const D = '(\\d{4})\\s*[.\\-/년]\\s*(\\d{1,2})\\s*[.\\-/월]\\s*(\\d{1,2})\\s*일?';
    function fiscalEnd(text) {
        // "사업연도 2022.01.01 ~ 2022.12.31"
        let m = new RegExp(`사\\s*업\\s*연\\s*도[\\s\\S]{0,40}?${D}[\\s\\S]{0,12}?(?:~|∼|-|부터)[\\s\\S]{0,6}?${D}`).exec(text);
        if (m) return `${m[4]}-${pad(m[5])}-${pad(m[6])}`;
        // "2023년 01월 01일 부터 … 2023년 12월 31일 까지" (표지 · 표준손익계산서)
        m = new RegExp(`${D}\\s*부\\s*터[\\s\\S]{0,120}?${D}\\s*까\\s*지`).exec(text);
        if (m) return `${m[4]}-${pad(m[5])}-${pad(m[6])}`;
        // "2023.01.01 … ~ 2023.12.31" (홈택스 증명 표지)
        m = new RegExp(`${D}[\\s\\S]{0,80}?[~∼]\\s*${D}`).exec(text);
        return m ? `${m[4]}-${pad(m[5])}-${pad(m[6])}` : null;
    }
    // "2025년 10월 31일 현재" · "2025/10/31 현재" · "2025.10.31 현재"
    function asOfDate(text) {
        const m = new RegExp(`${D}\\s*현\\s*재`).exec(text);
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
            const nameM = /법\s*인\s*명\s*\)?[\s:：]*([^\n]{2,30}?)(?:\s{2,}|\n|사\s*업\s*자)/.exec(t);
            if (!companyName && nameM) companyName = nameM[1].replace(/\s+/g, ' ').trim();
            let end = fiscalEnd(t) || fileEnd[p.file];
            if (!end) { const fy = /(20\d{2})/.exec(p.file || ''); if (fy) end = `${fy[1]}-12-31`; }
            // 연도별로 어떤 서식을 찾았는지 기록 (못 채운 칸의 이유를 알려주는 데 씀)
            if (end && kind !== 'bs') { const y = Y(end); y.src = y.src || []; if (!y.src.includes(kind)) y.src.push(kind); }

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
                // 왼쪽(익금산입 및 손금불산입) 과목별 금액 → 순손익계산서 차감 항목
                const items = adjustItems(t);
                const RULES = [
                    ['s16', ['접대비', '기업업무추진비']],
                    ['s10', ['벌과금', '벌금', '과태료', '가산세', '가산금', '체납처분비']],
                    ['s11', ['공과금'], ['벌과금']],
                    ['s17', ['업무무관']],
                    ['s18', ['업무용승용차']],
                    ['s19', ['지급이자']]
                ];
                RULES.forEach(([k, kw, ex]) => set(y, k, items.length ? sumItems(items, kw, ex) : sumLines(t, kw, ex)));
                y._adjDonation = items.length ? sumItems(items, ['기부금'], ['한도초과']) : sumLines(t, ['기부금'], ['한도초과']);
                // 법인세 등(이미 8 · 9번에 들어감)과 위 규칙에 안 맞는 과목은 직접 확인하도록 알려줌
                const known = ['법인세', '지방소득세', '농어촌특별세', '기부금', ...RULES.flatMap(r => r[1])];
                const other = items.filter(it => !known.some(k => it.name.includes(k)));
                if (other.length) y.unclassified = (y.unclassified || []).concat(other.map(it => `${it.name} ${it.amount.toLocaleString('ko-KR')}`));
                // 오른쪽(손금산입 및 익금불산입) → 가산 항목
                set(y, 'a3', sumLines(t, ['수입배당금']));
                set(y, 'a2', sumLines(t, ['환급금이자', '환급가산금']));
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
            } else if (kind === 'pl' && end) {
                // 세무조정계산서가 없을 때 대신 쓸 값: 법인세비용차감전손익 · 법인세비용
                const y = Y(end);
                set(y, '_plPretax', amountAfter(t, '법인세비용차감전') ?? amountAfter(t, '법인세차감전'));
                const tm = /법\s*인\s*세\s*비\s*용(?!\s*차)/.exec(t);
                if (tm) set(y, '_plTax', amountAfter(t.slice(tm.index), '법인세비용'));
            } else if (kind === 'shares' && end) {
                const n = amountAfter(t, '발행주식총수') ?? amountAfter(t, '기말주식수');
                set(Y(end), 'sharesAtYearEnd', n);
                if (!sharesIssued) sharesIssued = n;
            }
        });
        // 기부금 손금불산입 = 세액조정계산서 한도초과액 + 소득금액조정합계표의 비지정기부금 등
        Object.values(years).forEach(y => { if (y._adjDonation) add(y, 's15', y._adjDonation); delete y._adjDonation; });
        // 세액조정계산서에서 소득금액을 못 찾은 연도는 손익계산서 값으로 대신 (추정 표시)
        const estimated = [];
        Object.values(years).forEach(y => {
            if ((y.income === undefined || y.income === null) && y._plPretax !== undefined && y._plPretax !== null) {
                y.income = y._plPretax;
                if ((y.s8 === undefined || y.s8 === null) && y._plTax) y.s8 = y._plTax;
                estimated.push(y.fiscalYearEnd.slice(0, 4));
                y.estimated = true;
            }
            delete y._plPretax; delete y._plTax;
        });
        const kinds = { taxcalc: '세액조정계산서', adjust: '소득금액조정합계표', bs: '재무상태표', local: '지방소득세 신고서', rural: '농어촌특별세 신고서', shares: '주식등변동상황명세서', pl: '손익계산서' };
        const notes = Object.keys(found).map(k => `${kinds[k]} ${found[k]}쪽`).join(', ');
        const est = estimated.length ? ` · ${estimated.sort().join(', ')}년은 세무조정계산서가 없어 손익계산서의 법인세비용차감전손익을 '각 사업연도 소득금액'에 대신 넣었어요(세무조정 전 금액).` : '';
        return {
            companyName, sharesIssued,
            fiscalYears: Object.values(years), balanceSheets: Object.values(sheets), found,
            notes: (notes ? `찾은 서식: ${notes}` : '알아볼 수 있는 서식(세액조정계산서 · 소득금액조정합계표 · 재무상태표)을 찾지 못했습니다.') + est
        };
    }

    root.parseFinancials = parseFinancials;
    root.__fsParse = { amountAfter, sumLines, fiscalEnd, asOfDate, pageKind };
})(typeof window !== 'undefined' ? window : globalThis);
