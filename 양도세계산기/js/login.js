// ==========================================
// 0. 서버 통신 도우미 (로그인 토큰 자동 첨부)
// ==========================================
// 구글 Apps Script 웹 앱 주소 (배포 후 받은 주소를 넣으면 깃허브 홈페이지에서도 동작)
// 비워 두면 같은 주소의 Node 서버(/api/...)를 사용
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyL-g8WPHabkFEKsiAut9mdJXYU4zNLJ6eDfiS0no6YC21JBb0_mSFdyCL5963W3BgWcQ/exec';

function getToken() {
  return localStorage.getItem('authToken');
}

async function api(path, body) {
  if (APPS_SCRIPT_URL) return appsScriptApi(path, body);

  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

// Apps Script는 주소 하나로 받으므로 '/api/send-code' → action 'sendCode' 로 바꿔 보냄
// (Content-Type을 text/plain으로 보내야 구글 쪽에서 브라우저 요청을 막지 않음)
async function appsScriptApi(path, body) {
  const action = path.replace(/^\/api\//, '').replace(/[-/](\w)/g, (m, c) => c.toUpperCase());
  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...(body || {}), action, token: getToken() })
  });
  const data = await response.json().catch(() => ({}));
  return { ok: !!data.success, status: data.status || (data.success ? 200 : 500), data };
}

// ==========================================
// 1. 페이지 로드 시 결제 결과 처리 + 로그인 상태 체크
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  if (!(await isServerReady())) {
    showComingSoon();
    return;
  }
  await handlePaymentRedirect();
  await refreshUser();
});

// 계산 서버가 없는 곳(예: 깃허브 페이지)에서는 '준비 중' 안내만 표시
// 서버가 있으면 /api/me 가 200(로그인) 또는 401(비로그인)을 돌려줌
async function isServerReady() {
  try {
    const { status } = await api('/api/me');
    return status === 200 || status === 401;
  } catch {
    return false;
  }
}

function showComingSoon() {
  ['loginBtn', 'signupBtn', 'logoutBtn'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById('lockOverlay').style.display = 'flex';
  document.getElementById('lockLogin').style.display = 'none';
  document.getElementById('lockPay').style.display = 'none';
  document.getElementById('lockWait').style.display = 'none';
  document.getElementById('lockReady').style.display = 'block';
}

async function refreshUser() {
  if (!getToken()) {
    updateUi(null);
    return;
  }
  try {
    const { ok, data } = await api('/api/me');
    if (!ok) {
      localStorage.removeItem('authToken');
      updateUi(null);
      return;
    }
    updateUi(data.user, data.plan, data.paymentEnabled, data.bank);
  } catch (error) {
    console.error('통신 에러:', error);
    updateUi(null);
  }
}

// ==========================================
// 2. 모달 창 제어 및 탭 전환 함수
// ==========================================
function switchTab(type) {
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const loginTabBtn = document.getElementById('loginTabBtn');
  const signupTabBtn = document.getElementById('signupTabBtn');

  if (type === 'signup') {
    if (loginForm) loginForm.style.display = 'none';
    if (signupForm) signupForm.style.display = 'block';
    if (loginTabBtn) loginTabBtn.classList.remove('active');
    if (signupTabBtn) signupTabBtn.classList.add('active');
  } else {
    if (loginForm) loginForm.style.display = 'block';
    if (signupForm) signupForm.style.display = 'none';
    if (loginTabBtn) loginTabBtn.classList.add('active');
    if (signupTabBtn) signupTabBtn.classList.remove('active');
  }
}

function openModal(type = 'login') {
  const modal = document.getElementById('authModal');
  if (modal) modal.style.display = 'flex';
  switchTab(type); // 열 때 지정한 타입(기본 로그인)으로 탭 설정
}

function closeModal() {
  const modal = document.getElementById('authModal');
  if (modal) modal.style.display = 'none';
}

// ==========================================
// 3. 이메일 인증번호 발송 요청
// ==========================================
async function sendVerificationCode() {
  const emailInput = document.getElementById('signupId') || document.getElementById('signupEmail');

  if (!emailInput || !emailInput.value) {
    alert('이메일(아이디) 주소를 입력해주세요.');
    return;
  }

  try {
    const { data } = await api('/api/send-code', { email: emailInput.value });
    if (data.success) {
      alert('인증 코드가 이메일로 발송되었습니다.');
    } else {
      alert(data.message || '이메일 발송에 실패했습니다.');
    }
  } catch (error) {
    console.error('통신 에러:', error);
    alert('백엔드 서버(node server.js)가 실행 중인지 확인해 주세요.');
  }
}

// ==========================================
// 3-1. 이메일 인증번호 검증 요청
// ==========================================
async function verifyEmailCode() {
  const emailInput = document.getElementById('signupId') || document.getElementById('signupEmail');
  const codeInput = document.getElementById('verifyCodeInput');

  if (!emailInput || !emailInput.value || !codeInput || !codeInput.value) {
    alert('이메일과 인증번호를 모두 입력해주세요.');
    return;
  }

  try {
    const { data } = await api('/api/verify-code', { email: emailInput.value, code: codeInput.value });
    if (data.success) {
      alert('이메일 인증이 완료되었습니다!');
    } else {
      alert(data.message || '인증번호가 일치하지 않습니다.');
    }
  } catch (error) {
    console.error('통신 에러:', error);
    alert('서버와 통신하지 못했습니다.');
  }
}

// ==========================================
// 4. 회원가입 처리 (서버에 저장)
// ==========================================
async function handleSignup(e) {
  e.preventDefault();
  try {
    const { data } = await api('/api/signup', {
      name: document.getElementById('signupName').value,
      phone: document.getElementById('signupPhone').value,
      email: document.getElementById('signupId').value,
      password: document.getElementById('signupPw').value
    });
    alert(data.message || '회원가입에 실패했습니다.');
    if (data.success) {
      document.getElementById('loginId').value = document.getElementById('signupId').value;
      switchTab('login'); // 가입 완료 후 로그인 탭으로 전환
    }
  } catch (error) {
    console.error('통신 에러:', error);
    alert('서버와 통신하지 못했습니다.');
  }
}

// ==========================================
// 5. 로그인 처리
// ==========================================
async function handleLogin(e) {
  e.preventDefault();
  try {
    const { data } = await api('/api/login', {
      email: document.getElementById('loginId').value,
      password: document.getElementById('loginPw').value
    });
    if (!data.success) {
      alert(data.message || '아이디 또는 비밀번호가 일치하지 않습니다.');
      return;
    }
    localStorage.setItem('authToken', data.token);
    closeModal();
    await refreshUser();
  } catch (error) {
    console.error('통신 에러:', error);
    alert('서버와 통신하지 못했습니다.');
  }
}

// ==========================================
// 6. 로그아웃 처리 (로그아웃 시 로그인 탭 창 자동 팝업)
// ==========================================
async function handleLogout() {
  try {
    await api('/api/logout', {});
  } catch (error) {
    console.error('통신 에러:', error);
  }
  localStorage.removeItem('authToken');
  updateUi(null);
  alert('로그아웃 되었습니다.');
  openModal('login');
}

// ==========================================
// 7. 화면 상태 변경 (비회원 / 승인 대기 회원 / 승인된 회원)
// ==========================================
function updateUi(user, plan, paymentEnabled, bank) {
  const loggedIn = !!user;
  const paid = loggedIn && user.paid;
  const waiting = loggedIn && !paid;

  document.getElementById('loginBtn').style.display = loggedIn ? 'none' : 'inline-block';
  document.getElementById('signupBtn').style.display = loggedIn ? 'none' : 'inline-block';
  document.getElementById('logoutBtn').style.display = loggedIn ? 'inline-block' : 'none';
  document.getElementById('adminLink').style.display = loggedIn && user.admin ? 'inline' : 'none';

  document.getElementById('lockOverlay').style.display = paid ? 'none' : 'flex';
  document.getElementById('lockLogin').style.display = loggedIn ? 'none' : 'block';
  // 카드결제를 쓰지 않으면 '승인 대기' 안내, 쓰면 결제 안내
  document.getElementById('lockWait').style.display = waiting && !paymentEnabled ? 'block' : 'none';
  document.getElementById('lockPay').style.display = waiting && paymentEnabled ? 'block' : 'none';
  if (waiting && !paymentEnabled) {
    const applied = !!user.appliedAt;
    document.getElementById('applyBefore').style.display = applied ? 'none' : 'block';
    document.getElementById('applyAfter').style.display = applied ? 'block' : 'none';
    if (user.paidUntil) {
      document.getElementById('waitInfo').innerText = '이용기간이 만료되었습니다. 다시 인가 신청을 해주세요.';
    }
    if (plan) {
      const price = `${plan.price.toLocaleString('ko-KR')}원`;
      document.getElementById('applyPlan').innerText = `${plan.name} · ${price}`;
      document.getElementById('bankAmount').innerText = `${price} (${plan.days}일 이용)`;
    }
    if (bank) {
      document.getElementById('bankLine').innerText = `${bank.bank} ${bank.number}`;
      document.getElementById('bankHolder').innerText = bank.holder;
    }
  }

  if (plan) {
    document.getElementById('planInfo').innerText =
      `${plan.name} · ${plan.price.toLocaleString('ko-KR')}원 (카드결제)`;
  }

  const status = document.getElementById('planStatus');
  if (paid && user.admin) {
    status.innerText = '관리자';
  } else if (paid) {
    status.innerText = `이용기간: ~${user.paidUntil.slice(0, 10)}`;
  } else if (loggedIn && user.paidUntil) {
    status.innerText = '이용기간 만료';
  } else {
    status.innerText = '';
  }

  if (!paid) document.getElementById('result').style.display = 'none';
}

// ==========================================
// 7-1. 인가 신청 (계좌이체 안내 → 관리자 승인)
// ==========================================
async function applyAccess() {
  try {
    const { ok, data } = await api('/api/apply', {});
    if (!ok) {
      alert(data.message || '인가 신청을 하지 못했습니다.');
      return;
    }
    await refreshUser();
  } catch (error) {
    console.error('통신 에러:', error);
    alert('서버와 통신하지 못했습니다.');
  }
}

// ==========================================
// 8. 이용권 카드결제 (토스페이먼츠 결제위젯)
// ==========================================
let paymentWidgets = null; // 결제 UI는 한 번만 렌더링하고 재사용
let currentOrder = null;

async function startPayment() {
  try {
    // 주문번호와 금액은 서버에서 정함 (금액 위변조 방지)
    const { ok, data } = await api('/api/payments/prepare', {});
    if (!ok) {
      alert(data.message || '결제를 시작하지 못했습니다.');
      return;
    }
    currentOrder = data;

    document.getElementById('payTitle').innerText =
      `${data.orderName} · ${data.amount.toLocaleString('ko-KR')}원`;
    document.getElementById('payModal').style.display = 'flex';

    if (!paymentWidgets) {
      const tossPayments = TossPayments(data.clientKey);
      paymentWidgets = tossPayments.widgets({ customerKey: data.customerKey });
      await paymentWidgets.setAmount({ currency: 'KRW', value: data.amount });
      await Promise.all([
        paymentWidgets.renderPaymentMethods({ selector: '#payment-method', variantKey: 'DEFAULT' }),
        paymentWidgets.renderAgreement({ selector: '#agreement', variantKey: 'AGREEMENT' })
      ]);
    } else {
      await paymentWidgets.setAmount({ currency: 'KRW', value: data.amount });
    }
  } catch (error) {
    console.error('결제 준비 에러:', error);
    alert(error.message || '결제 화면을 불러오지 못했습니다.');
  }
}

function closePayModal() {
  document.getElementById('payModal').style.display = 'none';
}

async function requestWidgetPayment() {
  if (!paymentWidgets || !currentOrder) return;
  const returnUrl = window.location.origin + window.location.pathname;
  try {
    await paymentWidgets.requestPayment({
      orderId: currentOrder.orderId,
      orderName: currentOrder.orderName,
      customerEmail: currentOrder.customerEmail,
      customerName: currentOrder.customerName,
      successUrl: returnUrl + '?payment=success',
      failUrl: returnUrl + '?payment=fail'
    });
  } catch (error) {
    // 사용자가 결제창을 닫은 경우 등
    console.error('결제 요청 에러:', error);
    if (error && error.code !== 'USER_CANCEL') {
      alert(error.message || '결제 중 오류가 발생했습니다.');
    }
  }
}

// 결제창에서 돌아왔을 때: 성공이면 서버에 최종 승인 요청
async function handlePaymentRedirect() {
  const params = new URLSearchParams(window.location.search);
  const result = params.get('payment');
  if (!result) return;

  // 새로고침 시 중복 처리되지 않도록 주소창 정리
  window.history.replaceState(null, '', window.location.pathname);

  if (result === 'fail') {
    alert(params.get('message') || '결제가 취소되었거나 실패했습니다.');
    return;
  }

  try {
    const { data } = await api('/api/payments/confirm', {
      paymentKey: params.get('paymentKey'),
      orderId: params.get('orderId'),
      amount: params.get('amount')
    });
    if (data.success) {
      alert(`결제가 완료되었습니다! ${data.user.paidUntil.slice(0, 10)}까지 이용 가능합니다.`);
    } else {
      alert(data.message || '결제 승인에 실패했습니다.');
    }
  } catch (error) {
    console.error('통신 에러:', error);
    alert('결제 승인 중 서버와 통신하지 못했습니다.');
  }
}
