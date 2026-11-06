/* 기출 파일(PDF·사진) → 문제은행 변환 */
window.ImportView = (() => {
  "use strict";
  const { $, esc, toast, CIRC } = window.U;
  const SUBJ = window.SUBJ;
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  const IM = { phase: "setup", exam: "전기기사", stage: "필기", files: [], log: [], items: [], onlyWarn: false, running: false, cancel: false };

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = PDFJS + "pdf.min.js";
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; res(window.pdfjsLib); };
      s.onerror = () => rej(new Error("PDF 읽기 도구를 불러오지 못했습니다. 인터넷 연결을 확인하세요."));
      document.head.appendChild(s);
    });
  }

  // 파일 → 페이지 목록 [{page, text?, image?, thumb}]
  async function readFile(file, status) {
    if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
      const lib = await loadPdfJs();
      const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
      const pages = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        if (IM.cancel) break;
        status(`${file.name}: ${p}/${pdf.numPages}쪽 읽는 중…`);
        const page = await pdf.getPage(p);
        const tc = await page.getTextContent();
        const text = tc.items.map((it) => it.str + (it.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+\n/g, "\n").trim();
        const scanned = text.replace(/\s/g, "").length < 80;
        const base = page.getViewport({ scale: 1 });
        const scale = (scanned ? 1500 : 900) / base.width;
        const vp = page.getViewport({ scale });
        const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: g, viewport: vp }).promise;
        const dataUrl = c.toDataURL("image/jpeg", scanned ? 0.8 : 0.6);
        pages.push(scanned ? { page: p, image: { mime: "image/jpeg", b64: dataUrl.split(",")[1] }, thumb: dataUrl } : { page: p, text, thumb: dataUrl });
      }
      return pages;
    }
    if (/^image\//.test(file.type)) {
      const im = await window.U.imageToJpeg(file, 1600, 0.82);
      return [{ page: 1, image: { mime: im.mime, b64: im.b64 }, thumb: im.dataUrl }];
    }
    throw new Error(`${file.name}: PDF나 사진 파일만 변환할 수 있습니다.`);
  }

  function chunks(pages) {
    const out = []; let cur = [], w = 0;
    pages.forEach((p) => {
      const cost = p.text ? 1 : 2;
      if (cur.length && w + cost > 4) { out.push(cur); cur = []; w = 0; }
      cur.push(p); w += cost;
    });
    if (cur.length) out.push(cur);
    return out;
  }

  function parseChoice(ans, choices) {
    if (ans == null) return 0;
    const s = String(ans).trim(); if (!s) return 0;
    const c = s.match(/[①②③④]/); if (c) return "①②③④".indexOf(c[0]) + 1;
    const n = s.match(/^\(?\s*([1-4])\s*\)?(?:번)?(?:\D|$)/); if (n) return +n[1];
    const k = (choices || []).findIndex((x) => x && x.trim() === s); return k >= 0 ? k + 1 : 0;
  }

  async function run(el) {
    IM.running = true; IM.cancel = false; IM.items = []; IM.log = [];
    const status = (m) => { const s = $("im-status"); if (s) s.innerHTML = `<span class="spin"></span> ${esc(m)}`; };
    const log = (m, bad) => { IM.log.push({ m, bad }); const l = $("im-log"); if (l) l.innerHTML = IM.log.map((x) => `<li style="color:${x.bad ? "var(--bad)" : "inherit"}">${esc(x.m)}</li>`).join(""); };
    for (const f of IM.files) {
      if (IM.cancel) break;
      let pages;
      try { pages = await readFile(f.file, status); } catch (e) { log(e.message, true); continue; }
      if (pages.length > 60) log(`${f.file.name}: ${pages.length}쪽이라 요청이 많습니다. 무료 한도에 걸리면 자동으로 기다렸다가 이어서 진행합니다.`);
      // 1) 정답표 찾기 (마지막 3쪽)
      const key = new Map();
      if (pages.length >= 3) {
        status(`${f.file.name}: 정답표 찾는 중…`);
        try {
          const r = await window.G.answerKey(pages.slice(-3));
          if (r.found) { (r.answers || []).forEach((a) => { key.set(String(a.number), a.answer); if (a.subject) key.set(a.subject + "|" + a.number, a.answer); }); log(`${f.file.name}: 정답표에서 ${r.answers.length}개 정답을 찾았습니다.`); }
          else log(`${f.file.name}: 정답표가 없습니다. 문제 옆에 정답이 없으면 AI가 풀어서 'AI 추정 정답'으로 표시합니다.`);
        } catch (e) { log(`${f.file.name}: 정답표 확인 실패 (${e.message})`, true); if (e.code === "no_key" || e.code === "bad_key") break; }
      }
      // 2) 문제 추출
      const cs = chunks(pages);
      for (let i = 0; i < cs.length; i++) {
        if (IM.cancel) break;
        const pr = cs[i].map((p) => p.page);
        status(`${f.file.name}: 문제 옮기는 중 (${i + 1}/${cs.length}묶음, ${pr[0]}~${pr[pr.length - 1]}쪽)…`);
        try {
          const qs = await window.G.extract(cs[i], { exam: IM.exam, stage: IM.stage });
          qs.forEach((x) => {
            const page = pages.find((p) => p.page === x.page) || cs[i][0];
            const type = x.type || "mcq";
            const choices = type === "mcq" ? (x.choices || []).slice(0, 4) : [];
            const fromKey = key.get(x.subject + "|" + x.number) || key.get(String(x.number)) || "";
            const docAns = x.doc_answer || fromKey;
            const flags = [];
            let answerIndex = 0, answerDisplay = "", answerSource = "file";
            if (type === "mcq") {
              const d = parseChoice(docAns, choices), a = x.ai_answer_index >= 1 && x.ai_answer_index <= 4 ? x.ai_answer_index : 0;
              if (d) { answerIndex = d; if (a && a !== d) flags.push(`파일 정답(${CIRC[d - 1]})과 AI 풀이(${CIRC[a - 1]})가 다름`); }
              else { answerIndex = a; answerSource = "ai"; }
              answerDisplay = choices[answerIndex - 1] || "";
              if (choices.length !== 4) flags.push("보기 개수 확인");
            } else {
              if (docAns) answerDisplay = docAns; else { answerDisplay = x.ai_answer_display || ""; answerSource = "ai"; }
            }
            if (!answerIndex && type === "mcq") flags.push("정답 없음");
            if (x.confidence === "low") flags.push("판독 불확실");
            if (x.needs_figure) flags.push("그림 필요");
            if (x.cut_off) flags.push("페이지에서 잘림");
            IM.items.push({
              include: !x.cut_off, thumb: page.thumb, fileName: f.name, page: x.page,
              q: { exam: IM.exam, stage: IM.stage, subject: x.subject, unit: x.unit || "", type, question: x.question || "", choices, answerIndex, answerDisplay, answerSource, short: x.short || "", flags, number: x.number }
            });
          });
          log(`${f.file.name} ${pr[0]}~${pr[pr.length - 1]}쪽: ${qs.length}문제`);
        } catch (e) {
          log(`${f.file.name} ${pr[0]}~${pr[pr.length - 1]}쪽 실패: ${e.message}`, true);
          if (["no_key", "bad_key", "forbidden", "model"].includes(e.code)) { IM.cancel = true; break; }
        }
        await window.U.sleep(1200);
      }
    }
    IM.running = false;
    IM.phase = IM.items.length ? "review" : "setup";
    if (!IM.items.length) toast("옮긴 문제가 없습니다. 아래 기록을 확인하세요.", 4000);
    render(el);
  }

  function render(el) {
    if (IM.phase === "review") return review(el);
    el.innerHTML = `<div class="view-head"><h2>기출 파일 변환</h2><p>갖고 있는 기출문제 PDF나 사진을 넣으면 문제·보기·정답·핵심 풀이로 나눠 문제은행에 넣습니다. 저장하기 전에 원본과 나란히 놓고 확인할 수 있습니다.</p></div>
      ${window.G.hasKey() ? "" : window.App.noKeyNotice()}
      <div class="panel stack">
        <div class="fields">
          <label class="f">시험<select id="im-exam">${window.App.opts(Object.keys(SUBJ.EXAMS), IM.exam)}</select></label>
          <label class="f">필기/실기<select id="im-stage">${window.App.opts(["필기", "실기"], IM.stage)}</select></label>
        </div>
        <label class="f">파일 (PDF, 사진 · 여러 개 가능)<input type="file" id="im-files" accept="application/pdf,.pdf,image/*" multiple></label>
        <div id="im-names" class="stack"></div>
        <ul class="hint" style="margin:0;padding-left:1.2em">
          <li>글자를 드래그할 수 있는 PDF가 가장 정확합니다. 스캔본·사진은 수식이나 그림을 잘못 읽을 수 있어 확인이 필요합니다.</li>
          <li>정답표가 파일 끝에 있으면 자동으로 찾아 맞춥니다. 정답이 없으면 AI가 풀어서 ⚠ AI 추정 정답으로 표시합니다.</li>
          <li>20쪽짜리 파일은 대략 6~10번 요청을 보냅니다. 무료 한도에 걸리면 자동으로 기다렸다가 이어 갑니다.</li>
          <li>변환한 문제는 이 브라우저에만 저장됩니다. 개인 공부용으로만 쓰세요.</li>
        </ul>
        <div class="row"><button class="primary" id="im-go" ${window.G.hasKey() ? "" : "disabled"}>변환 시작</button><button id="im-stop" ${IM.running ? "" : "hidden"}>멈추기</button><span class="msg" id="im-status"></span></div>
        <ul class="hint" id="im-log" style="margin:0;padding-left:1.2em">${IM.log.map((x) => `<li style="color:${x.bad ? "var(--bad)" : "inherit"}">${esc(x.m)}</li>`).join("")}</ul>
      </div>`;
    const names = () => { $("im-names").innerHTML = IM.files.map((f, i) => `<label class="f">${esc(f.file.name)} · 출처 이름<input type="text" data-i="${i}" value="${esc(f.name)}"></label>`).join(""); $("im-names").querySelectorAll("input").forEach((inp) => inp.addEventListener("input", () => { IM.files[+inp.dataset.i].name = inp.value; })); };
    names();
    $("im-files").addEventListener("change", () => { IM.files = [...$("im-files").files].map((file) => ({ file, name: file.name.replace(/\.[^.]+$/, "") })); names(); });
    $("im-exam").addEventListener("change", () => { IM.exam = $("im-exam").value; });
    $("im-stage").addEventListener("change", () => { IM.stage = $("im-stage").value; });
    $("im-go").addEventListener("click", () => {
      if (!IM.files.length) { toast("파일을 먼저 고르세요."); return; }
      $("im-go").disabled = true; $("im-stop").hidden = false;
      run(el);
    });
    $("im-stop").addEventListener("click", () => { IM.cancel = true; toast("지금 진행 중인 묶음까지만 처리하고 멈춥니다."); });
  }

  function review(el) {
    const warnN = IM.items.filter((it) => it.q.flags.length || it.q.answerSource === "ai").length;
    const shown = IM.items.map((it, i) => ({ it, i })).filter(({ it }) => !IM.onlyWarn || it.q.flags.length || it.q.answerSource === "ai");
    el.innerHTML = `<div class="view-head"><h2>변환 결과 확인</h2><p>원본 페이지와 비교해 틀린 글자나 정답을 고친 뒤 저장하세요. ⚠ 표시가 있는 문제부터 보면 빠릅니다. 페이지 그림을 누르면 크게 보입니다.</p></div>
      <div class="panel row" style="position:sticky;top:46px;z-index:3">
        <span>전체 <b>${IM.items.length}</b> · ⚠ 확인 필요 <b>${warnN}</b> · 저장할 문제 <b id="rv-n">${IM.items.filter((x) => x.include).length}</b></span>
        <span class="spacer"></span>
        <label class="row" style="gap:4px"><input type="checkbox" id="rv-warn" ${IM.onlyWarn ? "checked" : ""}> ⚠만 보기</label>
        <button id="rv-cancel">처음으로</button><button class="primary" id="rv-save">저장</button>
      </div>
      <div class="list">${shown.map(({ it, i }) => card(it, i)).join("")}</div>
      <div class="row end"><button class="primary" id="rv-save2">저장</button></div>`;
    el.querySelectorAll("[data-card]").forEach((c) => bindCard(c, IM.items[+c.dataset.card]));
    $("rv-warn").addEventListener("change", () => { IM.onlyWarn = $("rv-warn").checked; review(el); });
    window.App.armed($("rv-cancel"), () => { IM.phase = "setup"; IM.items = []; render(el); }, "변환 결과를 버릴까요? 한 번 더");
    const save = async () => {
      const its = IM.items.filter((x) => x.include);
      if (!its.length) { toast("저장할 문제를 하나 이상 고르세요."); return; }
      const qs = its.map((it) => window.App.makeQ(Object.assign({}, it.q, { source: "file", sourceName: it.fileName, flags: it.q.flags.slice() })));
      await window.App.saveQs(qs);
      IM.phase = "setup"; IM.items = []; IM.files = []; IM.log = [];
      toast(`${qs.length}문제를 문제은행에 저장했습니다.`, 3500);
      window.App.startPractice(window.U.shuffle(qs.map((q) => q.id)), "방금 변환한 기출");
    };
    $("rv-save").addEventListener("click", save); $("rv-save2").addEventListener("click", save);
  }

  function card(it, i) {
    const q = it.q;
    return `<div class="item rv ${it.include ? "" : "off"}" data-card="${i}">
      <div><img class="thumb" src="${it.thumb}" alt="${esc(it.fileName)} ${it.page}쪽"><div class="hint">${esc(it.fileName)} · ${it.page}쪽 · ${q.number || "?"}번</div></div>
      <div class="stack">
        <div class="row"><label class="row" style="gap:4px"><input type="checkbox" class="c-inc" ${it.include ? "checked" : ""}> 저장</label>
          ${q.answerSource === "ai" ? `<span class="tag warn">⚠ AI 추정 정답</span>` : `<span class="tag file">파일 정답</span>`}
          ${q.flags.map((f) => `<span class="tag warn">⚠ ${esc(f)}</span>`).join("")}</div>
        <div class="fields">
          <label class="f">과목<select class="c-subj">${window.App.opts(SUBJ.ALL, q.subject)}</select></label>
          <label class="f">단원<input type="text" class="c-unit" value="${esc(q.unit)}"></label>
          <label class="f">유형<select class="c-type">${window.App.opt("mcq", "객관식", q.type === "mcq")}${window.App.opt("calc", "계산형", q.type === "calc")}${window.App.opt("text", "서술형", q.type === "text")}</select></label>
        </div>
        <label class="f">문제<textarea class="c-q" rows="4">${esc(q.question)}</textarea></label>
        <div class="c-prev rich hint"></div>
        <div class="c-mcq stack" ${q.type === "mcq" ? "" : "hidden"}>
          ${[0, 1, 2, 3].map((k) => `<label class="f">보기 ${CIRC[k]}<input type="text" class="c-c" data-k="${k}" value="${esc(q.choices[k] || "")}"></label>`).join("")}
          <label class="f">정답<select class="c-ai">${window.App.opt(0, "정답 없음", !q.answerIndex)}${[1, 2, 3, 4].map((k) => window.App.opt(k, CIRC[k - 1], q.answerIndex === k)).join("")}</select></label>
        </div>
        <label class="f c-disp-l" ${q.type === "mcq" ? "hidden" : ""}>정답 (계산형은 "숫자 단위")<input type="text" class="c-disp" value="${esc(q.answerDisplay)}"></label>
        <details><summary class="hint" style="cursor:pointer">핵심 풀이 보기·수정</summary><textarea class="c-short" rows="3">${esc(q.short)}</textarea></details>
      </div>
    </div>`;
  }
  function bindCard(c, it) {
    const q = it.q;
    const prev = c.querySelector(".c-prev");
    const upd = () => { window.U.rich(prev, q.question.length > 400 ? q.question.slice(0, 400) + "…" : q.question); };
    upd();
    let t = null;
    c.querySelector(".c-q").addEventListener("input", (e) => { q.question = e.target.value; clearTimeout(t); t = setTimeout(upd, 500); });
    c.querySelector(".c-inc").addEventListener("change", (e) => { it.include = e.target.checked; c.classList.toggle("off", !it.include); $("rv-n").textContent = IM.items.filter((x) => x.include).length; });
    c.querySelector(".c-subj").addEventListener("change", (e) => { q.subject = e.target.value; });
    c.querySelector(".c-unit").addEventListener("input", (e) => { q.unit = e.target.value; });
    c.querySelector(".c-type").addEventListener("change", (e) => { q.type = e.target.value; c.querySelector(".c-mcq").hidden = q.type !== "mcq"; c.querySelector(".c-disp-l").hidden = q.type === "mcq"; });
    c.querySelectorAll(".c-c").forEach((inp) => inp.addEventListener("input", () => { q.choices[+inp.dataset.k] = inp.value; }));
    c.querySelector(".c-ai").addEventListener("change", (e) => { q.answerIndex = +e.target.value; q.answerDisplay = q.choices[q.answerIndex - 1] || ""; q.answerSource = "checked"; q.flags = q.flags.filter((f) => !/정답/.test(f)); });
    c.querySelector(".c-disp").addEventListener("input", (e) => { q.answerDisplay = e.target.value; q.answerSource = "checked"; });
    c.querySelector(".c-short").addEventListener("input", (e) => { q.short = e.target.value; });
    c.querySelector(".thumb").addEventListener("click", () => window.App.openDialog(`<div class="row end"><button type="button" id="z-close">닫기</button></div><img src="${it.thumb}" alt="원본 페이지" style="width:100%;background:#fff">`, (b) => b.querySelector("#z-close").addEventListener("click", window.App.closeDialog)));
  }

  return { render };
})();
