const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const nodemailer = require('nodemailer');
const { calculateTax } = require('./lib/taxCalc');

const app = express();
const port = process.env.PORT || 3000; // 호스팅 서비스가 정해주는 포트 사용

// 메일 속 승인 링크에 쓰는 사이트 주소 (호스팅 후 .env에 PUBLIC_URL=https://calc.gangnamtax.co.kr)
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, '');

// 이용권 설정 (가격/기간은 여기서 변경)
const PLAN = {
    name: '양도세 계산기 1주 이용권',
    price: 99000,
    days: 7
};

// 인가 신청 시 안내할 입금 계좌 (계좌이체 확인 후 관리자가 승인)
// 저장소에 올라가지 않도록 .env의 BANK_NAME / BANK_NUMBER / BANK_HOLDER 에서 읽음
const BANK_ACCOUNT = {
    bank: process.env.BANK_NAME || '은행명',
    number: process.env.BANK_NUMBER || '계좌번호',
    holder: process.env.BANK_HOLDER || '예금주'
};

// 카드결제 사용 여부 (지금은 관리자 승인 방식만 사용)
const PAYMENT_ENABLED = false;

// 관리자 승인 기간 (일) - 관리자 화면의 승인 버튼
const APPROVE_DAYS = [7];

// 관리자 이메일 (.env의 ADMIN_EMAIL, 없으면 알림 메일 계정)
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || process.env.NAVER_EMAIL || '').trim().toLowerCase();

// 토스페이먼츠 키 (.env에 TOSS_CLIENT_KEY / TOSS_SECRET_KEY 설정)
// 설정하지 않으면 토스페이먼츠 공식 문서의 공개 테스트 키를 사용 (실제 결제 안 됨)
const TOSS_CLIENT_KEY = process.env.TOSS_CLIENT_KEY || 'test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm';
const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY || 'test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6';

// 미들웨어 설정
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // 메일 승인 화면의 [승인] 버튼
// 공개 파일만 노출 (.env, data/ 등은 노출하지 않음)
// 홈페이지(대문) = /, 양도세 계산기 = /양도세계산기/main.html
for (const file of ['index.html', 'robots.txt', 'sitemap.xml']) {
    app.get('/' + (file === 'index.html' ? '' : file), (req, res) => res.sendFile(path.join(__dirname, file)));
}
app.use('/images', express.static(path.join(__dirname, 'images')));
// 브라우저는 한글 경로를 %EC%96... 형태로 보내므로 인코딩된 경로로 연결
app.use('/' + encodeURIComponent('양도세계산기'), express.static(path.join(__dirname, '양도세계산기')));

// ==========================================
// 간단한 파일 저장소 (data/db.json)
// ==========================================
// 회원 정보 저장 위치 (호스팅에서는 재배포해도 지워지지 않는 디스크 경로를 DATA_DIR로 지정)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function loadDb() {
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch {
        return { users: {}, sessions: {}, orders: {} };
    }
}
const db = loadDb();

function saveDb() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function hashPassword(pw, salt) {
    return crypto.scryptSync(pw, salt, 64).toString('hex');
}

function isPaid(user) {
    return !!user.paidUntil && new Date(user.paidUntil) > new Date();
}

function isAdmin(user) {
    return !!ADMIN_EMAIL && user.email === ADMIN_EMAIL;
}

// paidUntil = 이용 가능 기한 (관리자 승인 또는 결제로 설정)
function publicUser(user) {
    return { email: user.email, name: user.name, paidUntil: user.paidUntil || null, paid: isPaid(user) || isAdmin(user), admin: isAdmin(user), appliedAt: user.appliedAt || null };
}

// 로그인 확인 미들웨어 (Authorization: Bearer <토큰>)
function requireAuth(req, res, next) {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const email = db.sessions[token];
    const user = email && db.users[email];
    if (!user) {
        return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
    }
    req.user = user;
    req.token = token;
    next();
}

function requireAdmin(req, res, next) {
    requireAuth(req, res, () => {
        if (!isAdmin(req.user)) {
            return res.status(403).json({ success: false, message: '관리자만 사용할 수 있습니다.' });
        }
        next();
    });
}

// ==========================================
// 1. 이메일 인증
// ==========================================

// 임시로 인증번호를 저장할 객체 (메모리 저장)
const verificationCodes = {};

// Gmail SMTP 설정
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // SSL 사용
    auth: {
        user: process.env.NAVER_EMAIL, // .env에 입력된 구글 이메일
        pass: process.env.NAVER_PASS  // .env에 입력된 16자리 앱 비밀번호
    }
});

// 이메일 인증번호 전송 라우터
app.post('/api/send-code', async (req, res) => {
    const { email } = req.body;
    console.log(`\n[요청 들어옴] 이메일 발송 시도: ${email}`);

    if (!email) {
        return res.status(400).json({ success: false, message: '이메일 주소를 입력해주세요.' });
    }

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    verificationCodes[email] = verificationCode;

    const mailOptions = {
        from: process.env.NAVER_EMAIL,
        to: email,
        subject: '[세무회계강남] 이메일 인증번호 안내',
        text: `안녕하세요. 요청하신 인증번호는 [${verificationCode}] 입니다. 타인에게 유출되지 않도록 주의해 주세요.`
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[인증 메일 전송 성공] 수신자: ${email}`);
        res.status(200).json({ success: true, message: '인증번호가 발송되었습니다.' });
    } catch (error) {
        console.error('[인증 메일 전송 실패 상세 에러]:', error);
        res.status(500).json({ success: false, message: '메일 전송에 실패했습니다.' });
    }
});

// 인증번호 확인 라우터
app.post('/api/verify-code', (req, res) => {
    const { email, code } = req.body;

    if (!email || !code) {
        return res.status(400).json({ success: false, message: '이메일과 인증번호를 모두 입력해주세요.' });
    }

    if (verificationCodes[email] && verificationCodes[email] === code) {
        delete verificationCodes[email];
        return res.status(200).json({ success: true, message: '이메일 인증이 완료되었습니다.' });
    } else {
        return res.status(400).json({ success: false, message: '인증번호가 일치하지 않거나 만료되었습니다.' });
    }
});

// ==========================================
// 2. 회원가입 / 로그인 / 로그아웃
// ==========================================
app.post('/api/signup', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const { password, name, phone } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: '아이디(이메일)와 비밀번호를 입력해주세요.' });
    }
    if (String(password).length < 8) {
        return res.status(400).json({ success: false, message: '비밀번호는 8자 이상으로 입력해주세요.' });
    }
    if (db.users[email]) {
        return res.status(409).json({ success: false, message: '이미 존재하는 아이디입니다.' });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    db.users[email] = {
        email,
        name: name || '',
        phone: phone || '',
        salt,
        passwordHash: hashPassword(String(password), salt),
        customerKey: crypto.randomUUID(),
        paidUntil: null,
        createdAt: new Date().toISOString()
    };
    saveDb();
    res.json({ success: true, message: '회원가입이 완료되었습니다! 로그인 후 인가 신청을 해주세요.' });
});

app.post('/api/login', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = db.users[email];
    const ok = user && crypto.timingSafeEqual(
        Buffer.from(user.passwordHash, 'hex'),
        Buffer.from(hashPassword(String(req.body.password || ''), user.salt), 'hex')
    );
    if (!ok) {
        return res.status(401).json({ success: false, message: '아이디 또는 비밀번호가 일치하지 않습니다.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    db.sessions[token] = email;
    saveDb();
    res.json({ success: true, token, user: publicUser(user) });
});

app.post('/api/logout', requireAuth, (req, res) => {
    delete db.sessions[req.token];
    saveDb();
    res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
    res.json({ success: true, user: publicUser(req.user), plan: PLAN, bank: BANK_ACCOUNT, paymentEnabled: PAYMENT_ENABLED });
});

// 인가 신청: 회원이 신청하면 입금 계좌를 안내하고, 관리자에게 알림 메일
app.post('/api/apply', requireAuth, (req, res) => {
    const user = req.user;
    const first = !user.appliedAt;
    user.appliedAt = new Date().toISOString();
    saveDb();

    if (first) {
        // 메일의 [승인하기] 링크용 일회용 토큰
        user.approveToken = crypto.randomBytes(24).toString('hex');
        saveDb();
    }

    if (first && ADMIN_EMAIL) {
        const link = `${PUBLIC_URL}/approve?email=${encodeURIComponent(user.email)}&token=${user.approveToken}`;
        const info = [
            ['이름', user.name || '-'],
            ['연락처', user.phone || '-'],
            ['이메일', user.email],
            ['입금 금액', `${PLAN.price.toLocaleString('ko-KR')}원 (${PLAN.days}일 이용)`]
        ];
        transporter.sendMail({
            from: process.env.NAVER_EMAIL,
            to: ADMIN_EMAIL,
            subject: `[세무회계강남] 양도세 계산기 인가 신청: ${user.name || user.email}`,
            text: `양도세 계산기 인가 신청이 들어왔습니다.\n\n${info.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n입금을 확인한 뒤 아래 링크에서 승인해 주세요.\n${link}`,
            html: `<div style="font-family: sans-serif; font-size: 15px; color: #1e293b;">
                <p>양도세 계산기 인가 신청이 들어왔습니다.</p>
                <table style="border-collapse: collapse; margin: 12px 0;">
                    ${info.map(([k, v]) => `<tr><td style="padding: 4px 12px 4px 0; color: #64748b;">${k}</td><td style="padding: 4px 0;"><b>${escapeHtml(v)}</b></td></tr>`).join('')}
                </table>
                <p>입금을 확인한 뒤 아래 버튼을 눌러 승인해 주세요.</p>
                <p><a href="${link}" style="display: inline-block; background: #1f2352; color: #fff; padding: 12px 22px; border-radius: 8px; text-decoration: none; font-weight: bold;">${PLAN.days}일 승인하기</a></p>
                <p style="color: #94a3b8; font-size: 13px;">버튼을 누르면 확인 화면이 열리고, 한 번 더 [승인]을 눌러야 승인됩니다.</p>
            </div>`
        }).catch(error => console.error('[인가 신청 알림 메일 실패]', error.message));
    }
    console.log(`[인가 신청] ${user.email}`);
    res.json({ success: true, user: publicUser(user), plan: PLAN, bank: BANK_ACCOUNT });
});

// ==========================================
// 2-1. 관리자: 회원 목록 / 기간 승인 / 승인 취소
// ==========================================
app.get('/api/admin/users', requireAdmin, (req, res) => {
    const users = Object.values(db.users)
        .map(u => ({
            email: u.email,
            name: u.name,
            phone: u.phone,
            createdAt: u.createdAt,
            appliedAt: u.appliedAt || null,
            paidUntil: u.paidUntil || null,
            active: isPaid(u),
            admin: isAdmin(u)
        }))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json({ success: true, users, approveDays: APPROVE_DAYS });
});

app.post('/api/admin/approve', requireAdmin, (req, res) => {
    const user = db.users[String(req.body.email || '').toLowerCase()];
    const days = Number(req.body.days);
    if (!user) {
        return res.status(404).json({ success: false, message: '회원을 찾을 수 없습니다.' });
    }
    if (!APPROVE_DAYS.includes(days)) {
        return res.status(400).json({ success: false, message: '승인 기간이 올바르지 않습니다.' });
    }
    approveUser(user, days);
    res.json({ success: true, user: publicUser(user) });
});

// 승인 처리 (관리자 화면, 메일 승인 링크 공통): 승인한 시점부터 기간 시작
function approveUser(user, days) {
    const until = new Date();
    until.setDate(until.getDate() + days);
    user.paidUntil = until.toISOString();
    user.approvedAt = new Date().toISOString();
    user.appliedAt = null; // 다음 연장 때 다시 인가 신청
    user.approveToken = null; // 메일 승인 링크는 한 번만 사용
    saveDb();
    console.log(`[승인] ${user.email} ${days}일, ~${user.paidUntil}`);
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ==========================================
// 2-2. 메일 승인 링크: 링크(GET)는 확인 화면만, [승인] 버튼(POST)을 눌러야 승인
// (메일 프로그램이 링크를 미리 열어봐도 자동 승인되지 않도록)
// ==========================================
function approvePage(title, body) {
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow"><title>${title} - 세무회계강남</title>
<style>body{font-family:'Malgun Gothic',sans-serif;background:#f8fafc;color:#1e293b;display:flex;justify-content:center;padding:40px 16px;margin:0}
.box{background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.08);padding:28px;max-width:380px;width:100%}
h1{font-size:20px;margin:0 0 16px}td{padding:4px 12px 4px 0}td:first-child{color:#64748b}
button{margin-top:18px;width:100%;background:#1f2352;color:#fff;border:none;border-radius:8px;padding:14px;font-size:16px;font-weight:bold;cursor:pointer}
p{color:#475569;line-height:1.6}</style></head><body><div class="box"><h1>${title}</h1>${body}</div></body></html>`;
}

const BAD_LINK_PAGE = approvePage('승인할 수 없는 링크', '<p>이미 승인했거나 잘못된 링크입니다.<br>관리자 화면에서 확인해 주세요.</p>');

function findApproveRequest(email, token) {
    const user = db.users[String(email || '').toLowerCase()];
    token = String(token || '');
    if (!user || !user.approveToken || token.length !== user.approveToken.length ||
        !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(user.approveToken))) {
        return null;
    }
    return user;
}

app.get('/approve', (req, res) => {
    const user = findApproveRequest(req.query.email, req.query.token);
    if (!user) return res.status(404).send(BAD_LINK_PAGE);
    res.send(approvePage('양도세 계산기 인가 승인', `
        <table>
            <tr><td>이름</td><td><b>${escapeHtml(user.name || '-')}</b></td></tr>
            <tr><td>연락처</td><td>${escapeHtml(user.phone || '-')}</td></tr>
            <tr><td>이메일</td><td>${escapeHtml(user.email)}</td></tr>
            <tr><td>신청일</td><td>${escapeHtml((user.appliedAt || '').slice(0, 10))}</td></tr>
        </table>
        <p>입금(${PLAN.price.toLocaleString('ko-KR')}원)을 확인하셨으면 승인해 주세요.<br>오늘부터 ${PLAN.days}일 동안 계산기를 쓸 수 있습니다.</p>
        <form method="POST" action="/approve">
            <input type="hidden" name="email" value="${escapeHtml(user.email)}">
            <input type="hidden" name="token" value="${escapeHtml(req.query.token)}">
            <button type="submit">${PLAN.days}일 승인</button>
        </form>`));
});

app.post('/approve', (req, res) => {
    const user = findApproveRequest(req.body.email, req.body.token);
    if (!user) return res.status(404).send(BAD_LINK_PAGE);
    approveUser(user, PLAN.days);
    res.send(approvePage('승인 완료 ✅', `<p><b>${escapeHtml(user.name || user.email)}</b> 님은 <b>${user.paidUntil.slice(0, 10)}</b>까지 양도세 계산기를 사용할 수 있습니다.</p>`));
});

app.post('/api/admin/revoke', requireAdmin, (req, res) => {
    const user = db.users[String(req.body.email || '').toLowerCase()];
    if (!user) {
        return res.status(404).json({ success: false, message: '회원을 찾을 수 없습니다.' });
    }
    user.paidUntil = null;
    saveDb();
    console.log(`[승인 취소] ${user.email}`);
    res.json({ success: true, user: publicUser(user) });
});

// ==========================================
// 3. 이용권 결제 (토스페이먼츠)
// ==========================================

// 결제 준비: 서버에서 주문번호와 금액을 정해 저장 (금액 위변조 방지)
app.post('/api/payments/prepare', requireAuth, (req, res) => {
    if (!PAYMENT_ENABLED) {
        return res.status(403).json({ success: false, message: '현재 카드결제는 사용하지 않습니다. 관리자 승인 후 이용해 주세요.' });
    }
    const orderId = `ORD-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    db.orders[orderId] = {
        email: req.user.email,
        amount: PLAN.price,
        status: 'pending',
        createdAt: new Date().toISOString()
    };
    saveDb();
    res.json({
        success: true,
        clientKey: TOSS_CLIENT_KEY,
        customerKey: req.user.customerKey,
        orderId,
        orderName: PLAN.name,
        amount: PLAN.price,
        customerEmail: req.user.email,
        customerName: req.user.name
    });
});

// 결제 승인: 토스 결제창에서 돌아온 뒤 서버가 토스에 최종 승인 요청
app.post('/api/payments/confirm', requireAuth, async (req, res) => {
    const { paymentKey, orderId } = req.body;
    const amount = Number(req.body.amount);
    const order = db.orders[orderId];

    if (!order || order.email !== req.user.email) {
        return res.status(400).json({ success: false, message: '주문 정보를 찾을 수 없습니다.' });
    }
    if (order.status === 'paid') {
        return res.json({ success: true, user: publicUser(req.user) });
    }
    if (order.amount !== amount) {
        return res.status(400).json({ success: false, message: '결제 금액이 주문 금액과 다릅니다.' });
    }

    try {
        const tossRes = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
            method: 'POST',
            headers: {
                Authorization: 'Basic ' + Buffer.from(TOSS_SECRET_KEY + ':').toString('base64'),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ paymentKey, orderId, amount })
        });
        const data = await tossRes.json();

        if (!tossRes.ok) {
            console.error('[결제 승인 실패]', data);
            order.status = 'failed';
            saveDb();
            return res.status(400).json({ success: false, message: data.message || '결제 승인에 실패했습니다.' });
        }

        // 이용기간 연장: 남은 기간이 있으면 그 뒤로 이어서 연장
        const base = isPaid(req.user) ? new Date(req.user.paidUntil) : new Date();
        base.setDate(base.getDate() + PLAN.days);
        req.user.paidUntil = base.toISOString();

        order.status = 'paid';
        order.paymentKey = paymentKey;
        order.approvedAt = data.approvedAt;
        saveDb();

        console.log(`[결제 완료] ${req.user.email} ${amount}원, 이용기간 ~${req.user.paidUntil}`);
        res.json({ success: true, user: publicUser(req.user) });
    } catch (error) {
        console.error('[결제 승인 통신 에러]', error);
        res.status(500).json({ success: false, message: '결제 승인 중 오류가 발생했습니다.' });
    }
});

// ==========================================
// 4. 세액 계산 (결제한 회원만)
// ==========================================
app.post('/api/calculate', requireAuth, (req, res) => {
    if (!isPaid(req.user) && !isAdmin(req.user)) {
        return res.status(402).json({ success: false, message: '관리자 승인 후 이용 가능합니다.' });
    }
    const result = calculateTax(req.body);
    if (result.error) {
        return res.status(400).json({ success: false, message: result.error });
    }
    res.json({ success: true, result });
});

// 서버 실행
app.listen(port, () => {
    console.log(`서버가 http://localhost:${port} 에서 실행 중입니다.`);
    if (!process.env.TOSS_SECRET_KEY) {
        console.log('[안내] TOSS 키가 .env에 없어 토스페이먼츠 공개 테스트 키로 동작합니다 (실제 결제 안 됨).');
    }
});
