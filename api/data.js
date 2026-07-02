// api/data.js — Vercel Serverless Function

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

  try {
    const API_KEY    = process.env.WINDSOR_API_KEY;
    const ACCOUNT_ID = process.env.WINDSOR_ACCOUNT_ID;

    if (!API_KEY || !ACCOUNT_ID) {
      return res.status(500).json({ error: 'Missing WINDSOR_API_KEY or WINDSOR_ACCOUNT_ID' });
    }

    // ── Windsor URL (نفس الطريقة المستخدمة في المحادثة) ──────────
    const fields = [
      'timestamp','media_caption','media_product_type',
      'media_views','media_like_count','media_comments_count',
      'media_saved','media_shares','media_reel_total_interactions',
      'media_reach','media_permalink'
    ].join(',');

    const url = `https://connectors.windsor.ai/all?api_key=${API_KEY}&date_preset=last_6m&fields=${fields}&connector=instagram&select_accounts=${ACCOUNT_ID}`;

    const windsorRes = await fetch(url);

    if (!windsorRes.ok) {
      const errText = await windsorRes.text();
      throw new Error(`Windsor ${windsorRes.status}: ${errText.slice(0,200)}`);
    }

    const windsorData = await windsorRes.json();
    const rows = windsorData.data || windsorData || [];

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error('Windsor returned empty data');
    }

    // ── فلتر الريلز فقط ──────────────────────────────────────────
    const reels = rows.filter(r =>
      (r.media_product_type || '').toUpperCase() === 'REELS'
    );

    // ── معالجة البيانات ───────────────────────────────────────────
    const parsed = reels.map(r => {
      const dt  = new Date(r.timestamp || '');
      const cap = (r.media_caption || '').replace(/[\u200e\u2068\u2069]/g, '');
      const lines = cap.split('\n').map(l => l.trim()).filter(Boolean);
      const title = (lines[0] || 'بدون عنوان').slice(0, 95);

      const views   = parseInt(r.media_views)                    || 0;
      const likes   = parseInt(r.media_like_count)               || 0;
      const cmts    = parseInt(r.media_comments_count)           || 0;
      const saved   = parseInt(r.media_saved)                    || 0;
      const shares  = parseInt(r.media_shares)                   || 0;
      const inter   = parseInt(r.media_reel_total_interactions)  || 0;
      const reach   = parseInt(r.media_reach)                    || 0;
      const eng     = reach > 0 ? Math.round(inter/reach*10000)/100 : 0;

      return {
        ts: isNaN(dt.getTime()) ? 0 : dt.getTime(),
        date: isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0,10),
        wd: dt.getDay(),
        hr: dt.getUTCHours(),
        title, cap_len: cap.length,
        views, likes, comments: cmts,
        saved, shares, inter, reach, eng,
        url: r.media_permalink || ''
      };
    }).filter(r => r.ts > 0);

    // أحدث 30 ريل
    parsed.sort((a,b) => b.ts - a.ts);
    const last30 = parsed.slice(0, 30);

    if (last30.length === 0) {
      throw new Error('No reels found after filtering');
    }

    // ── إحصائيات ─────────────────────────────────────────────────
    const avg_eng      = Math.round(last30.reduce((s,r)=>s+r.eng,0)/last30.length*100)/100;
    const hi           = Math.round(avg_eng*1.5*100)/100;
    const lo           = Math.round(avg_eng*0.5*100)/100;
    const total_views  = last30.reduce((s,r)=>s+r.views,0);
    const total_shares = last30.reduce((s,r)=>s+r.shares,0);
    const top = last30.reduce((a,b)=>b.eng>a.eng?b:a);
    const bot = last30.reduce((a,b)=>a.eng<b.eng?a:b);

    const wdMap={}, hrMap={};
    last30.forEach(r=>{
      if(!wdMap[r.wd]) wdMap[r.wd]=[];
      if(!hrMap[r.hr]) hrMap[r.hr]=[];
      wdMap[r.wd].push(r.eng);
      hrMap[r.hr].push(r.eng);
    });
    const wdAvg = Object.fromEntries(Object.entries(wdMap).map(([k,v])=>[k,Math.round(v.reduce((a,b)=>a+b,0)/v.length*100)/100]));
    const hrAvg = Object.fromEntries(Object.entries(hrMap).map(([k,v])=>[k,Math.round(v.reduce((a,b)=>a+b,0)/v.length*100)/100]));
    const best_wd  = parseInt(Object.entries(wdAvg).sort((a,b)=>b[1]-a[1])[0]?.[0]??0);
    const worst_wd = parseInt(Object.entries(wdAvg).sort((a,b)=>a[1]-b[1])[0]?.[0]??0);
    const best_hr  = parseInt(Object.entries(hrAvg).sort((a,b)=>b[1]-a[1])[0]?.[0]??0);

    const suc = last30.filter(r=>r.eng>=hi);
    const ava = last30.filter(r=>r.eng>=lo&&r.eng<hi);
    const cap_s = suc.length ? Math.round(suc.reduce((s,r)=>s+r.cap_len,0)/suc.length) : 0;
    const cap_a = ava.length ? Math.round(ava.reduce((s,r)=>s+r.cap_len,0)/ava.length) : 0;

    const hm={};
    last30.forEach(r=>{
      const k=`${r.wd}_${r.hr}`;
      if(!hm[k]) hm[k]=[];
      hm[k].push(r.eng);
    });
    const HM = Object.fromEntries(Object.entries(hm).map(([k,v])=>[k,Math.round(v.reduce((a,b)=>a+b,0)/v.length*100)/100]));

    return res.status(200).json({
      R: last30.map(r=>({
        date:r.date, wd:r.wd, hr:r.hr,
        title:r.title, views:r.views, likes:r.likes,
        comments:r.comments, saved:r.saved, shares:r.shares,
        eng:r.eng, url:r.url
      })),
      M: {
        avg_eng, hi, lo,
        total_views, total_shares,
        avg_views: Math.round(total_views/last30.length),
        n: last30.length,
        sn: suc.length,
        an: ava.length,
        wn: last30.filter(r=>r.eng<lo).length,
        top_eng: top.eng, top_title: top.title.slice(0,60),
        bot_eng: bot.eng, bot_title: bot.title.slice(0,60),
        best_wd, worst_wd, best_hr,
        best_wd_e: wdAvg[best_wd]||0,
        best_hr_e: hrAvg[best_hr]||0,
        cap_s, cap_a,
        fetch: new Date().toISOString().slice(0,16).replace('T',' ')
      },
      HM
    });

  } catch(err) {
    console.error('Handler error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
