// ==========================================
// 1. 페이지 로드 시 로그인 상태 체크 (새로고침 대응)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  const currentUser = localStorage.getItem('currentUser');
  if (currentUser) {
    updateUiForLogin(currentUser);
  }
});

// ==========================================
// 2. 모달 창 제어 함수 (열기 / 닫기)
// ==========================================
function openModal(type) {
  const modal = document.getElementById('authModal');
  if (modal) modal.style.display = 'flex';
  
  const signupForm = document.getElementById('signupForm');
  const loginForm = document.getElementById('loginForm');

  if (type === 'signup') {
    if (signupForm) signupForm.style.display = 'block';
    if (loginForm) loginForm.style.display = 'none';
  } else {
    if (signupForm) signupForm.style.display = 'none';
    if (loginForm) loginForm.style.display = 'block';
  }
}

function closeModal() {
  const modal = document.getElementById('authModal');
  if (modal) modal.style.display = 'none';
}

// ==========================================
// 3. 이메일 인증번호 발송 요청 (서버 3000번 통신)
// ==========================================
async function sendVerificationCode() {
  // HTML의 이메일 입력창 ID가 'signupEmail' 또는 'signupId' 등인지 확인 후 맞춰서 수정하세요.
  const emailInput = document.getElementById('signupEmail') || document.getElementById('signupId');
  
  if (!emailInput || !emailInput.value) {
    alert('이메일 주소를 입력해주세요.');
    return;
  }

  const email = emailInput.value;

  try {
    // 3000번 백엔드 서버로 명시적 전체 URL 요청
    const response = await fetch('http://localhost:3000/api/send-verification', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: email })
    });

    const data = await response.json();

    if (data.success) {
      alert('인증 코드가 이메일로 발송되었습니다. 3분 이내에 입력해주세요.');
    } else {
      alert(data.message || '이메일 발송에 실패했습니다.');
    }
  } catch (error) {
    console.error('통신 에러:', error);
    alert('서버와 통신하지 못했습니다. Node.js 백엔드 서버(node server.js)가 실행 중인지 확인해 주세요.');
  }
}

// ==========================================
// 4. 회원가입 처리
// ==========================================
function handleSignup(e) {
  e.preventDefault();
  const id = document.getElementById('signupId').value;
  const pw = document.getElementById('signupPw').value;

  // 기존 사용자 목록 가져오기 (없으면 빈 배열)
  let users = JSON.parse(localStorage.getItem('users')) || [];

  // 중복 아이디 체크
  if (users.find(u => u.id === id)) {
    alert('이미 존재하는 이메일(아이디)입니다.');
    return;
  }

  // 사용자 정보 저장
  users.push({ id: id, pw: pw });
  localStorage.setItem('users', JSON.stringify(users));

  alert('회원가입이 완료되었습니다! 로그인 해주세요.');
  closeModal();
  openModal('login');
}

// ==========================================
// 5. 로그인 처리
// ==========================================
function handleLogin(e) {
  e.preventDefault();
  const id = document.getElementById('loginId').value;
  const pw = document.getElementById('loginPw').value;

  const users = JSON.parse(localStorage.getItem('users')) || [];

  // 아이디와 비밀번호 일치 확인
  const user = users.find(u => u.id === id && u.pw === pw);

  if (user) {
    alert(`${user.id}님 환영합니다!`);
    localStorage.setItem('currentUser', user.id); // 현재 로그인한 사용자 저장
    updateUiForLogin(user.id);
    closeModal();
  } else {
    alert('아이디 또는 비밀번호가 일치하지 않습니다.');
  }
}

// ==========================================
// 6. 로그아웃 처리
// ==========================================
function handleLogout() {
  localStorage.removeItem('currentUser');
  
  const lockOverlay = document.getElementById('lockOverlay');
  if (lockOverlay) lockOverlay.style.display = 'flex';
  
  const loginBtn = document.getElementById('loginBtn');
  const signupBtn = document.getElementById('signupBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const resultDiv = document.getElementById('result');

  if (loginBtn) loginBtn.style.display = 'inline-block';
  if (signupBtn) signupBtn.style.display = 'inline-block';
  if (logoutBtn) logoutBtn.style.display = 'none';
  if (resultDiv) resultDiv.style.display = 'none';

  alert('로그아웃 되었습니다.');
}

// ==========================================
// 7. 로그인 성공 시 화면 변경 (잠금 해제)
// ==========================================
function updateUiForLogin(userId) {
  const lockOverlay = document.getElementById('lockOverlay');
  if (lockOverlay) lockOverlay.style.display = 'none';

  const loginBtn = document.getElementById('loginBtn');
  const signupBtn = document.getElementById('signupBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  if (loginBtn) loginBtn.style.display = 'none';
  if (signupBtn) signupBtn.style.display = 'none';
  if (logoutBtn) logoutBtn.style.display = 'inline-block';
}

// ==========================================
// 8. 세액 계산 실행
// ==========================================
function calculateTax(e) {
  e.preventDefault();

  if (!localStorage.getItem('currentUser')) {
    alert('로그인이 필요합니다.');
    return;
  }

  const sale = Number(document.getElementById('salePrice').value) || 0;
  const acq = Number(document.getElementById('acqPrice').value) || 0;
  const exp = Number(document.getElementById('expenses').value) || 0;

  const gain = sale - acq - exp;

  const resultDiv = document.getElementById('result');
  if (resultDiv) {
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `
      <strong>계산 결과</strong><br>
      양도차익: <strong>${gain.toLocaleString()}원</strong><br>
      <small>* 기본 계산 결과이며, 상세 세액은 보유기간 및 주택 수에 따라 달라집니다.</small>
    `;
  }
}