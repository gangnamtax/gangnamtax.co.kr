// 홈페이지 방문 기록: 페이지를 열 때마다 구글 시트 '방문기록' 탭에 한 줄 남김 (Apps Script Code.gs 의 visit_)
// 실제 사이트(gangnamtax.co.kr)에서만 기록하고, 내 컴퓨터에서 테스트할 때는 기록하지 않음
(function () {
  try {
    if (!/(^|\.)gangnamtax\.co\.kr$/.test(location.hostname)) return;
    var URL = 'https://script.google.com/macros/s/AKfycbyL-g8WPHabkFEKsiAut9mdJXYU4zNLJ6eDfiS0no6YC21JBb0_mSFdyCL5963W3BgWcQ/exec';

    // 브라우저마다 무작위 번호를 한 번 만들어 두고 계속 씀 (같은 사람의 재방문 구분용)
    var vid = '';
    try {
      vid = localStorage.getItem('gt_vid') || '';
      if (!vid) {
        vid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
          : Date.now().toString(36) + Math.random().toString(36).slice(2);
        localStorage.setItem('gt_vid', vid);
      }
    } catch (e) {}

    // 다른 사이트(검색, 블로그 등)에서 들어온 경우에만 그 사이트 주소를 남김
    var ref = '';
    try {
      if (document.referrer) {
        var r = new window.URL(document.referrer);
        if (r.hostname !== location.hostname) ref = r.hostname;
      }
    } catch (e) {}

    var page = location.pathname;
    try { page = decodeURIComponent(page); } catch (e) {}

    var body = JSON.stringify({ action: 'visit', page: page, vid: vid, ref: ref });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(URL, new Blob([body], { type: 'text/plain;charset=utf-8' }));
    } else {
      fetch(URL, { method: 'POST', mode: 'no-cors', keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body });
    }
  } catch (e) {}
})();
