/* 보조 도구: 공식집, 회로 계산기, 페이저, 저항 색띠, 타이머 */
window.Tools = (() => {
  "use strict";
  const { $, esc, parseSI, fmt, num } = window.U;
  let built = false, cur = "formulas";
  const cells = (el, items) => { el.innerHTML = items.map(([k, v, hl]) => `<div><div class="k">${k}</div><div class="v${hl ? " hl" : ""}">${v}</div></div>`).join(""); };

  const HTML = `<div class="view-head"><h2>도구</h2><p>문제 풀다가 필요한 공식과 계산기입니다. 값에는 SI 접두어를 쓸 수 있습니다: <span class="mono-inline">4.7k</span> <span class="mono-inline">10m</span> <span class="mono-inline">100u</span> (m 밀리, M 메가).</p></div>
  <div class="subnav" id="t-nav">
    <button class="chip" data-t="formulas">공식집</button><button class="chip" data-t="calc">계산기</button>
    <button class="chip" data-t="phasor">페이저</button><button class="chip" data-t="resistor">저항 색띠</button><button class="chip" data-t="timer">타이머</button>
  </div>

  <div data-pane="formulas" class="stack">
    <input type="text" id="tf-search" placeholder="예: 슬립, 전압강하, 오버슈트, 효율" aria-label="공식 검색">
    <div class="row" id="tf-chips"></div>
    <div class="fgrid" id="tf-list"></div>
  </div>

  <div data-pane="calc" class="grid2">
    <div class="panel"><h3>옴의 법칙 · 전력 <small>두 값을 입력</small></h3>
      <div class="fields">
        <label class="f">전압 V<input type="text" class="mono" id="to-v" value="12"></label>
        <label class="f">전류 I<input type="text" class="mono" id="to-i"></label>
        <label class="f">저항 R<input type="text" class="mono" id="to-r" value="4.7k"></label>
        <label class="f">전력 P<input type="text" class="mono" id="to-p"></label>
      </div>
      <div class="results" id="to-out" style="margin-top:12px"></div><p class="msg" id="to-msg"></p>
    </div>
    <div class="panel"><h3>역률 개선 콘덴서</h3>
      <div class="fields">
        <label class="f">유효전력 P [kW]<input type="text" class="mono" id="tq-p" value="100"></label>
        <label class="f">개선 전 역률<input type="text" class="mono" id="tq-1" value="0.6"></label>
        <label class="f">개선 후 역률<input type="text" class="mono" id="tq-2" value="0.9"></label>
      </div>
      <div class="results" id="tq-out" style="margin-top:12px"></div>
    </div>
    <div class="panel"><h3>3상 전력</h3>
      <div class="fields">
        <label class="f">선간전압 V<input type="text" class="mono" id="tp-v" value="380"></label>
        <label class="f">선전류 I<input type="text" class="mono" id="tp-i" value="10"></label>
        <label class="f">역률<input type="text" class="mono" id="tp-pf" value="0.8"></label>
        <label class="f">결선<select id="tp-conn"><option value="Y">Y</option><option value="D">Δ</option></select></label>
      </div>
      <div class="results" id="tp-out" style="margin-top:12px"></div>
    </div>
    <div class="panel"><h3>%임피던스 · 단락</h3>
      <div class="fields">
        <label class="f">정격용량 [kVA]<input type="text" class="mono" id="tz-s" value="1000"></label>
        <label class="f">정격전압 [V]<input type="text" class="mono" id="tz-v" value="380"></label>
        <label class="f">%Z [%]<input type="text" class="mono" id="tz-z" value="5"></label>
      </div>
      <div class="results" id="tz-out" style="margin-top:12px"></div>
    </div>
    <div class="panel"><h3>직렬 · 병렬 합성</h3>
      <label class="f">값 목록 (쉼표로 구분)<textarea class="mono" id="ts-in" rows="2">1k, 2.2k, 4.7k</textarea></label>
      <div class="results" id="ts-out" style="margin-top:12px"></div>
    </div>
    <div class="panel"><h3>데시벨</h3>
      <div class="fields">
        <label class="f">종류<select id="td-kind"><option value="20">전압·전류비 (20log)</option><option value="10">전력비 (10log)</option></select></label>
        <label class="f">비율<input type="text" class="mono" id="td-ratio" value="100"></label>
        <label class="f">dB<input type="text" class="mono" id="td-db"></label>
      </div>
    </div>
    <div class="panel" style="grid-column:1/-1"><h3>직렬 RLC 임피던스 · 공진</h3>
      <div class="fields">
        <label class="f">R [Ω]<input type="text" class="mono" id="tr-r" value="100"></label>
        <label class="f">L [H]<input type="text" class="mono" id="tr-l" value="10m"></label>
        <label class="f">C [F]<input type="text" class="mono" id="tr-c" value="100n"></label>
        <label class="f">f [Hz]<input type="text" class="mono" id="tr-f" value="3k"></label>
      </div>
      <div class="results" id="tr-out" style="margin-top:12px"></div><p class="msg" id="tr-msg"></p>
      <div class="chart" id="tr-chart"></div>
    </div>
  </div>

  <div data-pane="phasor" class="panel ph-layout">
    <div class="stack">
      <div class="fields">
        <label class="f">A 형식<select id="pa-mode"><option value="pol">극좌표</option><option value="rect">직교좌표</option></select></label>
        <label class="f" id="pa-l1">크기<input type="text" class="mono" id="pa-1" value="10"></label>
        <label class="f" id="pa-l2">각도 [°]<input type="text" class="mono" id="pa-2" value="30"></label>
      </div>
      <div class="fields">
        <label class="f">B 형식<select id="pb-mode"><option value="pol">극좌표</option><option value="rect">직교좌표</option></select></label>
        <label class="f" id="pb-l1">크기<input type="text" class="mono" id="pb-1" value="5"></label>
        <label class="f" id="pb-l2">각도 [°]<input type="text" class="mono" id="pb-2" value="-45"></label>
      </div>
      <label class="f" style="max-width:200px">연산<select id="ph-op"><option value="add">A + B</option><option value="sub">A − B</option><option value="mul" selected>A × B</option><option value="div">A ÷ B</option></select></label>
      <div class="results" id="ph-out" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))"></div>
    </div>
    <div class="ph-svg" id="ph-svg"></div>
  </div>

  <div data-pane="resistor" class="grid2">
    <div class="panel"><h3>색 → 저항값</h3>
      <div class="res-svg" id="rr-svg"></div>
      <label class="f" style="width:140px;margin-bottom:10px">띠 개수<select id="rr-n"><option value="4">4색띠</option><option value="5">5색띠</option></select></label>
      <div class="fields" id="rr-bands"></div>
      <div class="results" id="rr-out" style="margin-top:12px"></div>
    </div>
    <div class="panel"><h3>저항값 → 색</h3>
      <div class="fields">
        <label class="f">저항값 [Ω]<input type="text" class="mono" id="rr-val" value="4.7k"></label>
        <label class="f">띠 개수<select id="rr-vn"><option value="4">4색띠</option><option value="5">5색띠</option></select></label>
      </div>
      <p class="msg" id="rr-msg"></p>
      <button id="rr-apply">왼쪽 그림에 적용</button>
    </div>
  </div>

  <div data-pane="timer" class="panel stack" style="justify-items:center">
    <span class="tag" id="tm-phase">집중</span>
    <div class="clock" id="tm-clock">25:00</div>
    <div class="row"><button class="primary" id="tm-start">시작</button><button id="tm-reset">초기화</button><button id="tm-skip">건너뛰기</button></div>
    <div class="row"><label class="f" style="width:110px">집중 [분]<input type="number" id="tm-focus" min="1" max="120" value="25"></label><label class="f" style="width:110px">휴식 [분]<input type="number" id="tm-rest" min="1" max="60" value="5"></label></div>
    <p class="msg" id="tm-count"></p>
  </div>`;

  function show(t) {
    cur = t;
    document.querySelectorAll("#v-tools [data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== t; });
    document.querySelectorAll("#t-nav .chip").forEach((b) => b.setAttribute("aria-pressed", b.dataset.t === t));
  }

  function render(el) {
    if (built) { show(cur); return; }
    el.innerHTML = HTML; built = true;
    $("t-nav").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) show(b.dataset.t); });
    initFormulas(); initCalc(); initPhasor(); initResistor(); initTimer();
    show(cur);
  }

  /* ---- 공식집 ---- */
  function initFormulas() {
    const F = window.FORMULAS; let sub = "전체";
    const subs = ["전체", ...new Set(F.map((f) => f[0]))];
    $("tf-chips").innerHTML = subs.map((s) => `<button class="chip" data-s="${s}" aria-pressed="${s === sub}">${s}</button>`).join("");
    const strip = (h) => h.replace(/<[^>]+>/g, "");
    const draw = () => {
      const q = $("tf-search").value.trim().toLowerCase();
      const list = F.filter(([s, n, eq, note]) => (sub === "전체" || s === sub) && (!q || (s + n + strip(eq) + strip(note)).toLowerCase().includes(q)));
      $("tf-list").innerHTML = list.length ? list.map(([s, n, eq, note]) => `<article class="fcard"><div class="meta">${s}</div><div class="name">${n}</div><div class="eq">${eq}</div><div class="note">${note}</div></article>`).join("")
        : `<div class="empty" style="grid-column:1/-1">맞는 공식이 없습니다. 다른 키워드로 찾아보세요.</div>`;
    };
    $("tf-chips").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; sub = b.dataset.s; $("tf-chips").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.s === sub)); draw(); });
    $("tf-search").addEventListener("input", draw); draw();
  }

  /* ---- 계산기 ---- */
  function initCalc() {
    const K = ["v", "i", "r", "p"];
    const ohm = () => {
      const g = {}; K.forEach((k) => { const raw = $("to-" + k).value; if (raw.trim()) g[k] = parseSI(raw); });
      const keys = Object.keys(g), msg = $("to-msg"); let V, I, R, P;
      if (keys.some((k) => !isFinite(g[k]))) { msg.textContent = "숫자로 읽을 수 없는 값이 있습니다."; }
      else if (keys.length !== 2) msg.textContent = keys.length < 2 ? "값을 두 개 입력하면 나머지가 계산됩니다." : "두 개만 남겨 주세요.";
      else {
        ({ v: V, i: I, r: R, p: P } = g);
        const k = keys.sort().join("");
        if (k === "iv") { R = V / I; P = V * I; } else if (k === "rv") { I = V / R; P = V * V / R; } else if (k === "pv") { I = P / V; R = V * V / P; }
        else if (k === "ir") { V = I * R; P = I * I * R; } else if (k === "ip") { V = P / I; R = P / (I * I); } else { V = Math.sqrt(P * R); I = Math.sqrt(P / R); }
        msg.textContent = "";
      }
      cells($("to-out"), [["V", fmt(V, "V"), !g.v], ["I", fmt(I, "A"), !g.i], ["R", fmt(R, "Ω"), !g.r], ["P", fmt(P, "W"), !g.p]]);
    };
    K.forEach((k) => $("to-" + k).addEventListener("input", ohm)); ohm();

    const pfc = () => {
      const P = parseFloat($("tq-p").value), a = parseFloat($("tq-1").value), b = parseFloat($("tq-2").value);
      if (!(P > 0 && a > 0 && a <= 1 && b > 0 && b <= 1)) return cells($("tq-out"), [["입력 확인", "역률은 0~1"]]);
      const t1 = Math.sqrt(1 - a * a) / a, t2 = Math.sqrt(1 - b * b) / b;
      cells($("tq-out"), [["tanθ₁", num(t1)], ["tanθ₂", num(t2)], ["콘덴서 Q_C", num(P * (t1 - t2)) + " kVA", true], ["개선 전 Q", num(P * t1) + " kvar"]]);
    };
    ["tq-p", "tq-1", "tq-2"].forEach((id) => $(id).addEventListener("input", pfc)); pfc();

    const tp = () => {
      const V = parseSI($("tp-v").value), I = parseSI($("tp-i").value), pf = parseFloat($("tp-pf").value), Y = $("tp-conn").value === "Y";
      if (!(isFinite(V) && isFinite(I) && pf >= 0 && pf <= 1)) return cells($("tp-out"), [["입력 확인", "역률은 0~1"]]);
      const S = Math.sqrt(3) * V * I;
      cells($("tp-out"), [["S", fmt(S, "VA"), true], ["P", fmt(S * pf, "W"), true], ["Q", fmt(S * Math.sin(Math.acos(pf)), "var")], ["상전압", fmt(Y ? V / Math.sqrt(3) : V, "V")], ["상전류", fmt(Y ? I : I / Math.sqrt(3), "A")]]);
    };
    ["tp-v", "tp-i", "tp-pf", "tp-conn"].forEach((id) => $(id).addEventListener("input", tp)); tp();

    const tz = () => {
      const S = parseFloat($("tz-s").value), V = parseSI($("tz-v").value), Z = parseFloat($("tz-z").value);
      if (!(S > 0 && V > 0 && Z > 0)) return cells($("tz-out"), [["입력 확인", "0보다 큰 값"]]);
      const In = S * 1e3 / (Math.sqrt(3) * V);
      cells($("tz-out"), [["정격전류 I_n", fmt(In, "A")], ["단락전류 I_s", fmt(In * 100 / Z, "A"), true], ["단락용량 P_s", fmt(S * 1e3 * 100 / Z, "VA"), true]]);
    };
    ["tz-s", "tz-v", "tz-z"].forEach((id) => $(id).addEventListener("input", tz)); tz();

    const sp = () => {
      const vals = $("ts-in").value.split(/[\s,;]+/).filter(Boolean).map(parseSI);
      const ok = vals.length && vals.every((v) => isFinite(v) && v > 0);
      const s = ok ? vals.reduce((a, b) => a + b, 0) : NaN, p = ok ? 1 / vals.reduce((a, b) => a + 1 / b, 0) : NaN;
      cells($("ts-out"), [["R·L 직렬", fmt(s, ""), true], ["R·L 병렬", fmt(p, ""), true], ["C 직렬", fmt(p, "")], ["C 병렬", fmt(s, "")]]);
    };
    $("ts-in").addEventListener("input", sp); sp();

    const d1 = () => { const k = +$("td-kind").value, r = parseSI($("td-ratio").value); $("td-db").value = r > 0 ? num(k * Math.log10(r), 5) : ""; };
    $("td-ratio").addEventListener("input", d1); $("td-kind").addEventListener("change", d1);
    $("td-db").addEventListener("input", () => { const k = +$("td-kind").value, d = parseFloat($("td-db").value); $("td-ratio").value = isFinite(d) ? num(Math.pow(10, d / k), 5) : ""; });
    d1();

    const rlc = () => {
      const R = parseSI($("tr-r").value), L = parseSI($("tr-l").value), C = parseSI($("tr-c").value), f = parseSI($("tr-f").value);
      if (![R, L, C, f].every((v) => isFinite(v) && v > 0)) { $("tr-msg").textContent = "0보다 큰 값을 넣어 주세요."; $("tr-out").innerHTML = ""; $("tr-chart").innerHTML = ""; return; }
      const w = 2 * Math.PI * f, XL = w * L, XC = 1 / (w * C), X = XL - XC, f0 = 1 / (2 * Math.PI * Math.sqrt(L * C)), Q = Math.sqrt(L / C) / R;
      cells($("tr-out"), [["X_L", fmt(XL, "Ω")], ["X_C", fmt(XC, "Ω")], ["|Z|", fmt(Math.hypot(R, X), "Ω"), true], ["θ", num(Math.atan2(X, R) * 180 / Math.PI) + "°", true], ["f₀", fmt(f0, "Hz"), true], ["Q", num(Q)], ["BW", fmt(f0 / Q, "Hz")]]);
      $("tr-msg").textContent = Math.abs(f - f0) / f0 < 0.01 ? "공진 근처: |Z| ≈ R, 전류 최대." : X > 0 ? "f > f₀: 유도성 (전류 지상)" : "f < f₀: 용량성 (전류 진상)";
      const W = 640, H = 220, ml = 62, mr = 16, mt = 14, mb = 32, fa = f0 / 30, fb = f0 * 30;
      const Zf = (x) => { const ww = 2 * Math.PI * x; return Math.hypot(R, ww * L - 1 / (ww * C)); };
      const pts = []; for (let i = 0; i <= 200; i++) { const x = fa * Math.pow(fb / fa, i / 200); pts.push([x, Zf(x)]); }
      const zs = pts.map((p) => p[1]), y0 = Math.floor(Math.log10(Math.min(...zs))), y1 = Math.ceil(Math.log10(Math.max(...zs))), x0 = Math.log10(fa), x1 = Math.log10(fb);
      const Xs = (x) => ml + (Math.log10(x) - x0) / (x1 - x0) * (W - ml - mr), Ys = (z) => mt + (1 - (Math.log10(z) - y0) / Math.max(1e-9, y1 - y0)) * (H - mt - mb);
      let g = "";
      for (let d = Math.ceil(x0); d <= Math.floor(x1); d++) { const x = Xs(Math.pow(10, d)); g += `<line class="gridl" x1="${x}" x2="${x}" y1="${mt}" y2="${H - mb}"/><text x="${x}" y="${H - mb + 16}" text-anchor="middle">${fmt(Math.pow(10, d), "Hz", 3)}</text>`; }
      for (let d = y0; d <= y1; d += Math.max(1, Math.ceil((y1 - y0) / 5))) { const y = Ys(Math.pow(10, d)); g += `<line class="gridl" x1="${ml}" x2="${W - mr}" y1="${y}" y2="${y}"/><text x="${ml - 6}" y="${y + 4}" text-anchor="end">${fmt(Math.pow(10, d), "Ω", 3)}</text>`; }
      const path = pts.map((p, i) => (i ? "L" : "M") + Xs(p[0]).toFixed(1) + "," + Ys(p[1]).toFixed(1)).join("");
      let mk = `<line x1="${Xs(f0)}" x2="${Xs(f0)}" y1="${mt}" y2="${H - mb}" stroke="var(--blue)" stroke-dasharray="4 3"/><text x="${Xs(f0) + 5}" y="${mt + 11}" style="fill:var(--blue)">f₀</text>`;
      if (f >= fa && f <= fb) mk += `<circle cx="${Xs(f)}" cy="${Ys(Zf(f))}" r="5" fill="var(--copper)" stroke="var(--panel)" stroke-width="2"/>`;
      $("tr-chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="주파수에 따른 임피던스 크기">${g}<line class="axis" x1="${ml}" x2="${W - mr}" y1="${H - mb}" y2="${H - mb}"/><path d="${path}" fill="none" stroke="var(--copper)" stroke-width="2"/>${mk}</svg>`;
    };
    ["tr-r", "tr-l", "tr-c", "tr-f"].forEach((id) => $(id).addEventListener("input", rlc)); rlc();
  }

  /* ---- 페이저 ---- */
  function initPhasor() {
    const RAD = Math.PI / 180;
    const read = (p) => { const m = $(p + "-mode").value, a = parseSI($(p + "-1").value), b = parseSI($(p + "-2").value); if (!isFinite(a) || !isFinite(b)) return null; return m === "pol" ? { re: a * Math.cos(b * RAD), im: a * Math.sin(b * RAD) } : { re: a, im: b }; };
    const mag = (z) => Math.hypot(z.re, z.im), ang = (z) => Math.atan2(z.im, z.re) / RAD;
    const pol = (z) => `${num(mag(z))} ∠ ${num(ang(z))}°`, rect = (z) => `${num(z.re)} ${z.im < 0 ? "−" : "+"} j${num(Math.abs(z.im))}`;
    const draw = () => {
      const A = read("pa"), B = read("pb"), op = $("ph-op").value;
      if (!A || !B) { cells($("ph-out"), [["입력 확인", "숫자를 입력하세요"]]); return; }
      let R;
      if (op === "add") R = { re: A.re + B.re, im: A.im + B.im }; else if (op === "sub") R = { re: A.re - B.re, im: A.im - B.im };
      else if (op === "mul") R = { re: A.re * B.re - A.im * B.im, im: A.re * B.im + A.im * B.re };
      else { const d = B.re * B.re + B.im * B.im; R = { re: (A.re * B.re + A.im * B.im) / d, im: (A.im * B.re - A.re * B.im) / d }; }
      cells($("ph-out"), [["A", pol(A) + "<br>" + rect(A)], ["B", pol(B) + "<br>" + rect(B)], ["결과 극좌표", pol(R), true], ["결과 직교좌표", rect(R), true]]);
      const S = 300, c = S / 2, rad = 118, list = [[A, "var(--copper)", "A"], [B, "var(--blue)", "B"], [R, "var(--ink)", "R"]];
      const mx = Math.max(...list.map(([z]) => (isFinite(mag(z)) ? mag(z) : 0)), 1e-12), k = rad / mx;
      let s = `<circle cx="${c}" cy="${c}" r="${rad}" fill="none" stroke="var(--line)" stroke-dasharray="3 4"/><line x1="12" x2="${S - 12}" y1="${c}" y2="${c}" stroke="var(--muted)"/><line x1="${c}" x2="${c}" y1="12" y2="${S - 12}" stroke="var(--muted)"/><text x="${S - 14}" y="${c - 6}" text-anchor="end" fill="var(--muted)">Re</text><text x="${c + 6}" y="22" fill="var(--muted)">Im</text>`;
      list.forEach(([z, col, lab]) => {
        if (!isFinite(z.re)) return;
        const x = c + z.re * k, y = c - z.im * k, L = Math.hypot(x - c, y - c); if (L < 1) return;
        const ux = (x - c) / L, uy = (y - c) / L, bx = x - ux * 10, by = y - uy * 10;
        s += `<line x1="${c}" y1="${c}" x2="${bx}" y2="${by}" stroke="${col}" stroke-width="2.4"/><polygon points="${x},${y} ${bx - uy * 5},${by + ux * 5} ${bx + uy * 5},${by - ux * 5}" fill="${col}"/><text x="${x + ux * 14}" y="${y + uy * 14 + 4}" text-anchor="middle" fill="${col}" font-weight="600">${lab}</text>`;
      });
      $("ph-svg").innerHTML = `<svg viewBox="0 0 ${S} ${S}" role="img" aria-label="페이저도">${s}</svg>`;
    };
    ["pa", "pb"].forEach((p) => {
      $(p + "-mode").addEventListener("change", () => {
        const pol = $(p + "-mode").value === "pol", a = parseSI($(p + "-1").value), b = parseSI($(p + "-2").value);
        if (isFinite(a) && isFinite(b)) {
          if (!pol) { $(p + "-1").value = num(a * Math.cos(b * RAD)); $(p + "-2").value = num(a * Math.sin(b * RAD)); }
          else { $(p + "-1").value = num(Math.hypot(a, b)); $(p + "-2").value = num(Math.atan2(b, a) / RAD); }
        }
        $(p + "-l1").firstChild.textContent = pol ? "크기" : "실수부"; $(p + "-l2").firstChild.textContent = pol ? "각도 [°]" : "허수부";
        draw();
      });
      $(p + "-1").addEventListener("input", draw); $(p + "-2").addEventListener("input", draw);
    });
    $("ph-op").addEventListener("change", draw); draw();
  }

  /* ---- 저항 색띠 ---- */
  function initResistor() {
    const COL = [["검정", "#1b1b1b"], ["갈색", "#7a4a26"], ["빨강", "#d0302a"], ["주황", "#ee7d1d"], ["노랑", "#f2cf1f"], ["초록", "#2f9a4a"], ["파랑", "#2a64c8"], ["보라", "#7d4cc2"], ["회색", "#8a8a8a"], ["흰색", "#f4f4f4"]];
    const MULT = [...COL.map((c, i) => [c[0], c[1], i]), ["금색", "#c9a33c", -1], ["은색", "#b8bec4", -2]];
    const TOL = [["갈색", "#7a4a26", 1], ["빨강", "#d0302a", 2], ["초록", "#2f9a4a", 0.5], ["파랑", "#2a64c8", 0.25], ["보라", "#7d4cc2", 0.1], ["회색", "#8a8a8a", 0.05], ["금색", "#c9a33c", 5], ["은색", "#b8bec4", 10]];
    let st = { n: 4, d: [4, 7, 0], m: 2, t: 6 };
    const sel = (id, label, list, v, fmtx) => `<label class="f">${label}<select id="${id}">${list.map((o, i) => `<option value="${i}"${i === v ? " selected" : ""}>${o[0]} ${fmtx(o, i)}</option>`).join("")}</select></label>`;
    const bands = () => {
      const nd = st.n === 4 ? 2 : 3; let h = "";
      for (let i = 0; i < nd; i++) h += sel("rr-d" + i, `${i + 1}번째 숫자`, COL, st.d[i], (o, k) => `(${k})`);
      h += sel("rr-m", "배수", MULT, st.m, (o) => `(×10^${o[2]})`) + sel("rr-t", "허용오차", TOL, st.t, (o) => `(±${o[2]}%)`);
      $("rr-bands").innerHTML = h;
      for (let i = 0; i < nd; i++) $("rr-d" + i).addEventListener("change", (e) => { st.d[i] = +e.target.value; calc(); });
      $("rr-m").addEventListener("change", (e) => { st.m = +e.target.value; calc(); });
      $("rr-t").addEventListener("change", (e) => { st.t = +e.target.value; calc(); });
      calc();
    };
    const calc = () => {
      const nd = st.n === 4 ? 2 : 3; let base = 0; for (let i = 0; i < nd; i++) base = base * 10 + st.d[i];
      const v = base * Math.pow(10, MULT[st.m][2]), t = TOL[st.t][2];
      cells($("rr-out"), [["저항값", fmt(v, "Ω"), true], ["허용오차", "±" + t + "%"], ["범위", fmt(v * (1 - t / 100), "Ω") + " ~ " + fmt(v * (1 + t / 100), "Ω")]]);
      const cols = [...st.d.slice(0, nd).map((i) => COL[i][1]), MULT[st.m][1], TOL[st.t][1]], xs = nd === 2 ? [140, 175, 210, 300] : [130, 160, 190, 220, 300];
      $("rr-svg").innerHTML = `<svg viewBox="0 0 460 120" role="img" aria-label="저항 색띠"><line x1="0" x2="460" y1="60" y2="60" stroke="var(--muted)" stroke-width="5"/><path d="M100 30 Q100 22 112 22 L140 22 Q150 22 156 30 L304 30 Q310 22 320 22 L348 22 Q360 22 360 30 L360 90 Q360 98 348 98 L320 98 Q310 98 304 90 L156 90 Q150 98 140 98 L112 98 Q100 98 100 90 Z" fill="#d9c7a0" stroke="#a8936a"/>${xs.map((x, i) => `<rect x="${x}" y="${x < 156 || x > 300 ? 22 : 30}" width="16" height="${x < 156 || x > 300 ? 76 : 60}" fill="${cols[i]}"/>`).join("")}</svg>`;
    };
    $("rr-n").addEventListener("change", (e) => { st.n = +e.target.value; bands(); });
    bands();
    const toBands = () => {
      const v = parseSI($("rr-val").value), n = +$("rr-vn").value, nd = n === 4 ? 2 : 3, msg = $("rr-msg");
      if (!(v > 0)) { msg.textContent = "0보다 큰 값을 입력하세요."; return null; }
      let e = Math.floor(Math.log10(v) + 1e-9) - (nd - 1), sig = Math.round(v / Math.pow(10, e));
      if (sig >= Math.pow(10, nd)) { sig = Math.round(sig / 10); e++; }
      if (e < -2 || e > 9) { msg.textContent = "색띠로 표현할 수 없는 범위입니다."; return null; }
      const digits = String(sig).padStart(nd, "0").split("").map(Number), mIdx = e >= 0 ? e : e === -1 ? 10 : 11;
      msg.innerHTML = [...digits.map((d) => COL[d]), MULT[mIdx]].map((c) => `<span class="swatch" style="background:${c[1]}"></span>${c[0]}`).join(" · ") + " · 허용오차띠";
      return { n, digits, mIdx };
    };
    $("rr-val").addEventListener("input", toBands); $("rr-vn").addEventListener("change", toBands); toBands();
    $("rr-apply").addEventListener("click", () => { const r = toBands(); if (!r) return; st = { n: r.n, d: r.digits.concat([0, 0, 0]).slice(0, 3), m: r.mIdx, t: r.n === 4 ? 6 : 0 }; $("rr-n").value = r.n; bands(); });
  }

  /* ---- 타이머 ---- */
  function initTimer() {
    let phase = "focus", left = 25 * 60, running = false, end = 0, iv = null, actx = null;
    const len = (p) => Math.max(1, Math.min(120, +$(p === "focus" ? "tm-focus" : "tm-rest").value || (p === "focus" ? 25 : 5))) * 60;
    const getLog = () => { try { return JSON.parse(localStorage.getItem("ohmstudy:timer") || "{}"); } catch (e) { return {}; } };
    const showT = () => {
      $("tm-clock").textContent = String(Math.floor(left / 60)).padStart(2, "0") + ":" + String(left % 60).padStart(2, "0");
      $("tm-phase").textContent = phase === "focus" ? "집중" : "휴식"; $("tm-phase").className = "tag " + (phase === "focus" ? "file" : "good");
      $("tm-start").textContent = running ? "일시정지" : left < len(phase) ? "계속" : "시작";
      const n = getLog()[window.U.today()] || 0; $("tm-count").textContent = `오늘 완료한 집중 세션: ${n}회`;
    };
    const beep = () => { try { if (!actx) return; const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(0.15, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.6); o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.6); } catch (e) { /* 소리 없이 진행 */ } };
    const tick = () => {
      left = Math.max(0, Math.round((end - Date.now()) / 1000));
      if (left === 0) {
        if (phase === "focus") { const l = getLog(); l[window.U.today()] = (l[window.U.today()] || 0) + 1; try { localStorage.setItem("ohmstudy:timer", JSON.stringify(l)); } catch (e) { /* ignore */ } }
        beep(); phase = phase === "focus" ? "rest" : "focus"; left = len(phase); end = Date.now() + left * 1000;
      }
      showT();
    };
    $("tm-start").addEventListener("click", () => {
      try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* ignore */ }
      if (running) { running = false; clearInterval(iv); } else { running = true; end = Date.now() + left * 1000; iv = setInterval(tick, 250); }
      showT();
    });
    $("tm-reset").addEventListener("click", () => { running = false; clearInterval(iv); phase = "focus"; left = len("focus"); showT(); });
    $("tm-skip").addEventListener("click", () => { phase = phase === "focus" ? "rest" : "focus"; left = len(phase); if (running) end = Date.now() + left * 1000; showT(); });
    ["tm-focus", "tm-rest"].forEach((id) => $(id).addEventListener("change", () => { if (!running) { left = len(phase); showT(); } }));
    showT();
  }

  return { render };
})();
