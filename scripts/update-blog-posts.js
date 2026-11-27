// 네이버 블로그 RSS → blog-posts.json (홈페이지 '세무사 칼럼'에 표시)
// GitHub Actions(.github/workflows/update-blog-posts.yml)가 몇 시간마다 실행. 직접 실행: node scripts/update-blog-posts.js
//
// 최신 글의 요약은 기본적으로 본문 앞부분(인사말 제외)을 씁니다.
// 직접 정리한 요약·핵심 내용을 넣고 싶은 글은 blog-highlights.json에 글 번호(주소 맨 끝 숫자)로 적어 두면 그 내용이 대신 쓰입니다.
const fs = require('fs');
const path = require('path');

const BLOG_ID = 'gangnamcta';
const RSS_URL = `https://rss.blog.naver.com/${BLOG_ID}.xml`;
const COUNT = 6; // 최신 글 1개 + 목록 5개
const EXCLUDE_CATS = ['세무사_CTA_준비하기']; // 홈페이지에 올리지 않을 블로그 카테고리
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'blog-posts.json');
const HIGHLIGHTS = path.join(ROOT, 'blog-highlights.json');

const decode = s => s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const tag = (item, name) => {
    const m = item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
    return m ? decode(m[1]).trim() : '';
};

// 제목 끝의 검색용 꼬리말(예: "_증여세 세무사") 제거
const cleanTitle = t => t.replace(/_[^_]*세무사\s*$/, '').trim();

// 본문 앞부분에서 인사말("안녕하세요 … 김하원세무사입니다.")을 빼고 요약으로 사용
function makeLead(desc) {
    let text = desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.startsWith('안녕하세요')) {
        const end = text.indexOf('입니다.');
        if (end !== -1 && end < 200) text = text.slice(end + 4).trim();
    }
    const cut = /\.{2,}\s*$/.test(text);
    text = text.replace(/\.{2,}\s*$/, '').trim();
    if (text.length > 180) { text = text.slice(0, 180).replace(/\s+\S*$/, ''); return text + '…'; }
    return cut ? text + '…' : text;
}

// 발행일 → 2026.11.26 (한국 시간)
function kstDate(pub) {
    const d = new Date(new Date(pub).getTime() + 9 * 3600 * 1000);
    const p = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}`;
}

async function main() {
    const res = await fetch(RSS_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (blog-posts updater)' } });
    if (!res.ok) throw new Error(`RSS 요청 실패: ${res.status}`);
    const xml = await res.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    if (!items.length) throw new Error('RSS에 글이 없습니다');

    const highlights = fs.existsSync(HIGHLIGHTS) ? JSON.parse(fs.readFileSync(HIGHLIGHTS, 'utf8')) : {};

    const posts = items.filter(item => !EXCLUDE_CATS.includes(tag(item, 'category'))).slice(0, COUNT).map((item, i) => {
        const url = tag(item, 'link').split('?')[0];
        const id = url.split('/').pop();
        const post = { id, date: kstDate(tag(item, 'pubDate')), cat: tag(item, 'category'), title: cleanTitle(tag(item, 'title')), url };
        if (i === 0) {
            const h = highlights[id] || {};
            post.lead = h.lead || makeLead(tag(item, 'description'));
            if (h.points) post.points = h.points;
        }
        return post;
    });

    const json = JSON.stringify(posts, null, 2) + '\n';
    const before = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (json === before) { console.log('변경 없음'); return; }
    fs.writeFileSync(OUT, json);
    console.log(`blog-posts.json 갱신: ${posts[0].date} ${posts[0].title}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
