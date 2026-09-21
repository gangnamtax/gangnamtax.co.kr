// 시작 시 로그인 상태 체크 (페이지 새로고침 대응)
document.addEventListener('DOMContentLoaded', () => {
  const currentUser = localStorage.getItem('currentUser');
  if (currentUser) {
    updateUiForLogin(currentUser);
  }
});

// 모달 창 열기 (login 또는 signup)
function openModal(type) {
  document.getElementById('authModal').style.display = 'flex';
  if (type === 'signup') {
    document.getElementById('signupForm').style.display = 'block';
    document.getElementById('loginForm').style.display = 'none';
  } else {
    document.getElementById('signupForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
  }
}

// 모달 창 닫기
function closeModal() {
  document.getElementById('authModal').style.display = 'none';
}

// 1. 회원가입 처리
function handleSignup(e) {
  e.preventDefault();
  const id = document.getElementById('signupId').value;
  const pw = document.getElementById('signupPw').value;

  // 기존 사용자 목록 가져오기 (없으면 빈 배열)
  let users = JSON.parse(localStorage.getItem('users')) || [];

  // 중복 아이디 체크
  if (users.find(u => u.id === id)) {
    alert('이미 존재하는 아이디입니다.');
    return;
  }

  // 사용자 정보 저장
  users.push({ id: id, pw: pw });
  localStorage.setItem('users', JSON.stringify(users));

  alert('회원가입이 완료되었습니다! 로그인 해주세요.');
  closeModal();
  openModal('login');
}

// 2. 로그인 처리
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

// 3. 로그아웃 처리
function handleLogout() {
  localStorage.removeItem('currentUser');
  document.getElementById('lockOverlay').style.display = 'flex';
  document.getElementById('loginBtn').style.display = 'inline-block';
  document.getElementById('signupBtn').style.display = 'inline-block';
  document.getElementById('logoutBtn').style.display = 'none';
  document.getElementById('result').style.display = 'none';
  alert('로그아웃 되었습니다.');
}

// 로그인 성공 시 화면 변경
function updateUiForLogin(userId) {
  document.getElementById('lockOverlay').style.display = 'none';
  document.getElementById('loginBtn').style.display = 'none';
  document.getElementById('signupBtn').style.display = 'none';
  document.getElementById('logoutBtn').style.display = 'inline-block';
}

// 4. 세액 계산 실행
function calculateTax(e) {
  e.preventDefault();

  if (!localStorage.getItem('currentUser')) {
    alert('로그인이 필요합니다.');
    return;
  }

  const sale = Number(document.getElementById('salePrice').value);
  const acq = Number(document.getElementById('acqPrice').value);
  const exp = Number(document.getElementById('expenses').value);

  const gain = sale - acq - exp;

  const resultDiv = document.getElementById('result');
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = `
    <strong>계산 결과</strong><br>
    양도차익: <strong>${gain.toLocaleString()}원</strong><br>
    <small>* 기본 계산 결과이며, 상세 세액은 보유기간 및 주택 수에 따라 달라집니다.</small>
  `;
}