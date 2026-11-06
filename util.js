/* 공통 유틸리티: 숫자·단위 해석, 채점, 텍스트 렌더링, 파일 처리 */
window.U = (() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---- SI 접두어 ---- */
  const PREF = { p: 1e-12, n: 1e-9, u: 1e-6, m: 1e-3, "": 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };
  function parseSI(raw) {
    if (raw == null) return NaN;
    let s = String(raw).trim().replace(/µ|μ/g, "u").replace(/\s+/g, "").replace(/,/g, "");
    if (!s) return NaN;
    s = s.replace(/(ohms?|Ω|hz|v|a|w|h|f|s|°)$/i, "");
    const m = s.match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)([pnumkKMG]?)$/);
    if (!m) return NaN;
    return parseFloat(m[1]) * PREF[m[2]];
  }
  const SYM = ["p", "n", "µ", "m", "", "k", "M", "G"];
  function fmt(v, unit = "", digits = 4) {
    if (!isFinite(v)) return "—";
    if (v === 0) return "0 " + unit;
    let e = Math.floor(Math.log10(Math.abs(v)) / 3);
    e = Math.max(-4, Math.min(3, e));
    let str = String(parseFloat((v / Math.pow(10, 3 * e)).toPrecision(digits)));
    if (Math.abs(parseFloat(str)) >= 1000 && e < 3) { e++; str = String(parseFloat((v / Math.pow(10, 3 * e)).toPrecision(digits))); }
    return str + " " + SYM[e + 4] + unit;
  }
  const num = (v, d = 4) => (isFinite(v) ? String(parseFloat(v.toPrecision(d))) : "—");

  /* ---- 값+단위 해석 (채점용) ---- */
  const UNITS = ["varh", "VAh", "kWh", "Wh", "VA", "var", "rpm", "Hz", "Wb", "ohm", "Ω", "lx", "lm", "cd", "W", "V", "A", "H", "F", "S", "s", "%", "°", "J", "N", "T", "C", "m"];
  const CANON = { ohm: "Ω", hz: "Hz", rpm: "rpm", var: "var", va: "VA", kwh: "kWh" };
  function parseQty(raw) {
    if (raw == null) return null;
    const s = String(raw).trim().replace(/,/g, "").replace(/µ|μ/g, "u").replace(/×10\^?/g, "e").replace(/\s+/g, "");
    const m = s.match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(.*)$/i);
    if (!m) return null;
    const n = parseFloat(m[1]);
    let rest = m[2].replace(/^\[|\]$/g, "").replace(/[\[\]()]/g, "");
    if (!rest) return { value: n, unit: "", num: n };
    for (const u of UNITS) {
      let hit = rest.endsWith(u);
      if (!hit && /^(var|va|hz|rpm|ohm|wh|varh|vah)$/i.test(u)) hit = rest.toLowerCase().endsWith(u.toLowerCase());
      if (!hit) continue;
      const pre = rest.slice(0, rest.length - u.length);
      let unit = CANON[u.toLowerCase()] || u;
      if (unit === "kWh") return { value: n * 1e3 * (PREF[pre] || 1), unit: "Wh", num: n };
      if (pre === "" || (PREF[pre] !== undefined && !/^(%|°|rpm)$/.test(unit))) {
        return { value: n * (PREF[pre] || 1), unit, num: n };
      }
    }
    return { value: n, unit: null, num: n, rest };
  }
  // 사용자 답과 정답 비교. tol: 허용 오차 %
  function grade(userStr, answerDisplay, tol = 2) {
    const u = parseQty(userStr), a = parseQty(answerDisplay);
    if (!u) return { ok: false, msg: "숫자로 시작하는 답을 입력하세요. 예: 5.27 kW" };
    if (!a) return { ok: null, msg: "정답이 숫자 형식이 아니어서 자동 채점할 수 없습니다. 모범답안과 비교해 직접 판단하세요." };
    const close = (x, y) => Math.abs(x - y) <= Math.max(Math.abs(y) * tol / 100, 1e-9);
    if (u.unit && a.unit) {
      const eq = u.unit === a.unit || (["VA", "var"].includes(u.unit) && ["VA", "var"].includes(a.unit));
      if (!eq) return { ok: false, msg: `단위가 다릅니다. 정답 단위는 ${a.unit}입니다.` };
      return { ok: close(u.value, a.value), msg: u.unit !== a.unit ? "콘덴서 용량은 kVA, kvar 둘 다 인정되는 경우가 많습니다." : "" };
    }
    if (!u.unit && a.unit) {
      const ok = close(u.num, a.num) || close(u.value, a.value);
      return { ok, msg: ok ? `값은 맞습니다. 실기에서는 단위(${a.unit})까지 써야 점수를 받습니다.` : "" };
    }
    return { ok: close(u.value, a.value) || close(u.num, a.num), msg: "" };
  }

  /* ---- 텍스트 + 수식 렌더링 ---- */
  function richHtml(text) {
    let h = esc(text || "");
    h = h.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    h = h.replace(/\n/g, "<br>");
    return h;
  }
  function math(el) {
    if (!el || !window.renderMathInElement) return;
    try {
      window.renderMathInElement(el, {
        delimiters: [
          { left: "$$", right: "$$", display: true }, { left: "\\[", right: "\\]", display: true },
          { left: "$", right: "$", display: false }, { left: "\\(", right: "\\)", display: false }
        ], throwOnError: false
      });
    } catch (e) { /* 수식 렌더 실패 시 원문 유지 */ }
  }
  function rich(el, text) { el.innerHTML = richHtml(text); el.classList.add("rich"); math(el); }
  function svgImg(svg) {
    if (!svg || !/<svg[\s>]/i.test(svg)) return "";
    let s = svg.trim();
    if (!/xmlns=/.test(s)) s = s.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    return `<div class="diagram"><img alt="해설 그림" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}"></div>`;
  }

  /* ---- 알림 ---- */
  let tt = null;
  function toast(msg, ms = 2600) {
    const t = $("toast"); t.textContent = msg; t.classList.add("on");
    clearTimeout(tt); tt = setTimeout(() => t.classList.remove("on"), ms);
  }

  /* ---- 파일 ---- */
  const readAsDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  async function imageToJpeg(file, maxDim = 1600, q = 0.82) {
    const url = await readAsDataURL(file);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, maxDim / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL("image/jpeg", q);
    return { dataUrl, b64: dataUrl.split(",")[1], mime: "image/jpeg" };
  }
  function download(filename, text, type = "application/json") {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const CIRC = "①②③④⑤";

  return { $, esc, uid, PREF, parseSI, fmt, num, parseQty, grade, richHtml, rich, math, svgImg, toast, readAsDataURL, imageToJpeg, download, shuffle, today, sleep, CIRC };
})();
