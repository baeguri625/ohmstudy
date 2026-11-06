/* 옴스터디 메인 앱 */
(() => {
  "use strict";
  const { $, esc, uid, rich, math, svgImg, toast, CIRC } = window.U;
  const SUBJ = window.SUBJ;

  /* =========================================================
     상태와 저장
     ========================================================= */
  const A = { qs: new Map(), attempts: [], settings: window.DB.getSettings() };
  const saveSettings = () => window.DB.saveSettings(A.settings);

  async function saveQs(list) { list.forEach((q) => A.qs.set(q.id, q)); await window.DB.putMany("questions", list); }
  const saveQ = (q) => saveQs([q]);
  async function delQs(ids) {
    ids.forEach((id) => A.qs.delete(id));
    await window.DB.delMany("questions", ids);
    const rm = A.attempts.filter((a) => ids.includes(a.qid)).map((a) => a.id);
    A.attempts = A.attempts.filter((a) => !ids.includes(a.qid));
    if (rm.length) await window.DB.delMany("attempts", rm);
  }
  async function addAttempt(q, ok, given) {
    const a = { id: uid(), qid: q.id, ok: !!ok, given: given == null ? "" : String(given), at: Date.now(), day: window.U.today(), subject: q.subject, unit: q.unit || "" };
    A.attempts.push(a);
    await window.DB.put("attempts", a);
  }
  function lastByQ() {
    const m = new Map();
    A.attempts.forEach((a) => { const p = m.get(a.qid); if (!p || p.at < a.at) m.set(a.qid, a); });
    return m;
  }
  function accBy(keyFn) {
    const m = new Map();
    A.attempts.forEach((a) => {
      const k = keyFn(a); if (!k) return;
      const s = m.get(k) || { n: 0, ok: 0 }; s.n++; if (a.ok) s.ok++; m.set(k, s);
    });
    return m;
  }
  function makeQ(base) {
    return Object.assign({
      id: uid(), source: "ai", sourceName: "", exam: "전공", stage: "필기", subject: "회로이론", unit: "", type: "mcq",
      question: "", choices: [], answerIndex: 0, answerDisplay: "", answerSource: "ai", short: "", detail: null, flags: [], createdAt: Date.now()
    }, base);
  }

  /* =========================================================
     공통 UI
     ========================================================= */
  const dlg = $("dlg");
  function openDialog(html, onMount) {
    $("dlg-body").innerHTML = html;
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    onMount && onMount($("dlg-body"));
  }
  function closeDialog() { if (dlg.open) dlg.close(); }
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closeDialog(); });

  function armed(btn, fn, label = "한 번 더 누르면 실행됩니다") {
    btn.addEventListener("click", () => {
      if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; fn(); return; }
      btn.dataset.label = btn.textContent; btn.dataset.armed = "1"; btn.textContent = label;
      setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; } }, 4000);
    });
  }
  const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(label == null ? v : label)}</option>`;
  const opts = (list, sel, all) => (all ? opt("", all, !sel) : "") + list.map((v) => opt(v, v, v === sel)).join("");
  const noKeyNotice = () => `<div class="notice warn">AI 기능을 쓰려면 Gemini API 키가 필요합니다. <a href="#settings">설정</a>에서 키를 입력하세요. 키 없이도 기본 문제 풀이, 오답노트, 도구는 쓸 수 있습니다.</div>`;
  function aiErr(el, e) {
    el.innerHTML = `<div class="notice warn">${esc(e && e.message ? e.message : "알 수 없는 오류가 났습니다.")}</div>`;
  }
  window.G.setWaitHandler((s) => toast(`무료 한도에 잠시 걸려 ${s}초 기다렸다가 다시 시도합니다…`, 5000));

  function qTags(q) {
    const t = [];
    t.push(`<span class="tag">${esc(q.exam)} ${esc(q.stage)}</span>`);
    t.push(`<span class="tag">${esc(q.subject)}${q.unit ? " · " + esc(q.unit) : ""}</span>`);
    t.push(`<span class="tag">${SUBJ.TYPE_LABEL[q.type] || q.type}</span>`);
    if (q.source === "file") t.push(`<span class="tag file" title="${esc(q.sourceName)}">기출 · ${esc((q.sourceName || "").slice(0, 24))}</span>`);
    else if (q.source === "ai") t.push(`<span class="tag ai">AI 생성</span>`);
    else if (q.source === "custom") t.push(`<span class="tag ai">내가 저장</span>`);
    else t.push(`<span class="tag">기본 문제</span>`);
    if (q.answerSource === "ai" && q.source === "file") t.push(`<span class="tag warn">⚠ AI 추정 정답</span>`);
    (q.flags || []).forEach((f) => t.push(`<span class="tag warn">⚠ ${esc(f)}</span>`));
    return t.join("");
  }

  /* ---------- 해설 ---------- */
  function renderExplanation(el, q, startOpen) {
    el.innerHTML = `<div class="exp">
      <div class="exp-short"><div class="lbl">핵심 풀이</div><div class="x-short"></div></div>
      <button class="exp-more" type="button">▼ 더 자세히</button>
      <div class="exp-detail" hidden></div>
    </div>`;
    const shortEl = el.querySelector(".x-short");
    rich(shortEl, q.short || (q.detail && q.detail.short) || "핵심 풀이가 아직 없습니다. [더 자세히]를 누르면 AI가 해설을 만듭니다.");
    const btn = el.querySelector(".exp-more"), det = el.querySelector(".exp-detail");
    const show = () => { fillDetail(det, q.detail); det.hidden = false; btn.textContent = "▲ 접기"; };
    btn.addEventListener("click", async () => {
      if (!det.hidden) { det.hidden = true; btn.textContent = "▼ 더 자세히"; return; }
      if (q.detail) return show();
      if (!window.G.hasKey()) { det.hidden = false; det.innerHTML = `<div class="exp-sec">${noKeyNotice()}</div>`; return; }
      btn.disabled = true; btn.innerHTML = `<span class="spin"></span> 해설을 만드는 중…`;
      try {
        q.detail = await window.G.explain(q);
        if (!q.short && q.detail.short) q.short = q.detail.short;
        if (A.qs.has(q.id)) await saveQ(q);
        show();
      } catch (e) { det.hidden = false; det.innerHTML = `<div class="exp-sec"></div>`; aiErr(det.firstChild, e); btn.textContent = "▼ 다시 시도"; }
      btn.disabled = false;
    });
    if (startOpen && q.detail) show();
  }
  function fillDetail(det, d) {
    const sec = (label, body) => `<div class="exp-sec"><div class="lbl">${label}</div>${body}</div>`;
    const list = (arr, tag) => `<${tag}>${(arr || []).map((_, i) => `<li data-i="${i}"></li>`).join("")}</${tag}>`;
    let h = "";
    if (d.steps && d.steps.length) h += sec("단계별 풀이", list(d.steps, "ol")).replace('class="exp-sec"', 'class="exp-sec" data-k="steps"');
    if (d.principle) h += `<div class="exp-sec" data-k="principle"><div class="lbl">원리: 왜 그런가요?</div><div class="x"></div></div>`;
    if (d.diagram_svg) h += sec("그림", svgImg(d.diagram_svg));
    if (d.pitfalls && d.pitfalls.length) h += sec("자주 하는 실수·함정", list(d.pitfalls, "ul")).replace('class="exp-sec"', 'class="exp-sec" data-k="pitfalls"');
    if (d.related && d.related.length) h += sec("연결 개념", list(d.related, "ul")).replace('class="exp-sec"', 'class="exp-sec" data-k="related"');
    if (d.similar_question) h += `<div class="exp-sec" data-k="similar"><div class="lbl">비슷한 문제</div><div class="x"></div></div>`;
    if (d.summary) h += `<div class="exp-summary" data-k="summary"></div>`;
    det.innerHTML = h;
    ["steps", "pitfalls", "related"].forEach((k) => det.querySelectorAll(`[data-k="${k}"] li`).forEach((li) => { li.innerHTML = window.U.richHtml(d[k][+li.dataset.i]); }));
    const p = det.querySelector('[data-k="principle"] .x'); if (p) p.innerHTML = window.U.richHtml(d.principle);
    const s = det.querySelector('[data-k="similar"] .x'); if (s) s.innerHTML = window.U.richHtml(d.similar_question);
    const sm = det.querySelector('[data-k="summary"]'); if (sm) sm.innerHTML = "📌 " + window.U.richHtml(d.summary);
    det.classList.add("rich"); math(det);
  }

  /* ---------- 문제 카드 ---------- */
  // opts: { reveal: 정답을 바로 보여줌, onDone(ok) }
  function renderCard(el, q, o = {}) {
    el.innerHTML = `<div class="panel stack">
      <div class="q-meta">${qTags(q)}</div>
      <div class="q-text"></div>
      ${q.flags && q.flags.includes("그림 필요") ? `<div class="notice warn">이 문제는 원본 그림을 봐야 정확히 풀 수 있습니다. 그림 내용은 문제 끝 [그림: …]에 글로 적어 두었습니다.</div>` : ""}
      <div class="ans"></div>
      <div class="after" hidden></div>
    </div>`;
    rich(el.querySelector(".q-text"), q.question);
    const ans = el.querySelector(".ans"), after = el.querySelector(".after");
    let done = false;
    const finish = (ok, msg) => {
      if (done) return; done = true;
      let v = "";
      if (ok === true) v = `<div class="verdict ok">정답입니다.${msg ? " " + esc(msg) : ""}</div>`;
      else if (ok === false) v = `<div class="verdict no">오답입니다. ${q.type === "mcq" ? "정답은 " + CIRC[q.answerIndex - 1] + "번입니다." : "정답: " + esc(q.answerDisplay)}${msg ? "<br><small>" + esc(msg) + "</small>" : ""}</div>`;
      else if (o.reveal) v = "";
      else v = `<div class="verdict mid">${esc(msg || "")}</div>`;
      after.hidden = false;
      after.innerHTML = `${v}
        ${q.type !== "mcq" ? `<div class="notice"><b>정답 / 모범답안</b><div class="x-ans"></div></div>` : ""}
        <div class="x-exp" style="margin-top:12px"></div>
        <details class="x-work" style="margin-top:12px"><summary style="cursor:pointer;color:var(--blue);font-weight:600">손풀이 사진 첨삭 받기</summary>
          <div class="stack" style="margin-top:10px">
            <p class="hint">공책에 쓴 풀이를 찍어 올리면 AI가 틀린 단계를 짚어 줍니다. 여러 장 올릴 수 있습니다.</p>
            <input type="file" accept="image/*" multiple class="x-imgs" aria-label="풀이 사진">
            <input type="text" class="x-note" placeholder="메모 (선택): 어디서 막혔는지 적어 주세요">
            <div class="row"><button class="primary x-check" type="button">첨삭 받기</button></div>
            <div class="x-result"></div>
          </div>
        </details>
        <div class="row end" style="margin-top:12px"><button class="small x-edit" type="button">문제·정답 수정</button></div>`;
      if (q.type !== "mcq") rich(after.querySelector(".x-ans"), q.answerDisplay || "(정답 없음)");
      renderExplanation(after.querySelector(".x-exp"), q, o.reveal);
      after.querySelector(".x-check").addEventListener("click", () => doCheck(q, after));
      after.querySelector(".x-edit").addEventListener("click", () => editQuestion(q, () => renderCard(el, q, Object.assign({}, o, { reveal: true }))));
      o.onDone && o.onDone(ok);
    };

    if (q.type === "mcq") {
      ans.innerHTML = `<div class="choices">${(q.choices || []).map((c, i) => `<button class="choice" type="button" data-i="${i + 1}"><span class="lt">${CIRC[i]}</span><span class="c"></span></button>`).join("")}</div>`;
      ans.querySelectorAll(".choice").forEach((b) => {
        b.querySelector(".c").innerHTML = window.U.richHtml(q.choices[+b.dataset.i - 1]);
        b.addEventListener("click", async () => {
          if (done) return;
          const i = +b.dataset.i, ok = i === q.answerIndex;
          ans.querySelectorAll(".choice").forEach((x) => { const k = +x.dataset.i; if (k === q.answerIndex) x.classList.add("right"); else if (k === i) x.classList.add("wrong"); x.disabled = true; });
          if (!o.reveal) await addAttempt(q, ok, i);
          finish(ok);
        });
      });
      math(ans);
      if (o.reveal) { ans.querySelectorAll(".choice").forEach((x) => { if (+x.dataset.i === q.answerIndex) x.classList.add("right"); x.disabled = true; }); finish(null); }
    } else if (q.type === "calc") {
      ans.innerHTML = `<div class="row"><input type="text" class="mono x-in" placeholder="답과 단위 예: 5.27 kW" style="flex:1 1 200px" aria-label="답 입력"><button class="primary x-go" type="button">채점</button></div>
        <p class="hint" style="margin-top:6px">단위 접두어(k, M, m)를 써도 됩니다. 반올림 차이(약 2%)는 정답으로 봅니다.</p>`;
      const go = async () => {
        if (done) return;
        const v = ans.querySelector(".x-in").value.trim(); if (!v) { toast("답을 입력하세요."); return; }
        const g = window.U.grade(v, q.answerDisplay);
        if (g.ok === null) { await addAttempt(q, false, v); finish(null, g.msg); selfGrade(after, q, v); return; }
        if (g.ok === false && /숫자로 시작/.test(g.msg)) { toast(g.msg); return; }
        await addAttempt(q, g.ok, v); finish(g.ok, g.msg);
      };
      ans.querySelector(".x-go").addEventListener("click", go);
      ans.querySelector(".x-in").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      if (o.reveal) finish(null);
    } else {
      ans.innerHTML = `<textarea rows="4" class="x-in" placeholder="답안을 써 보세요 (선택). 다 쓰면 모범답안과 비교해 스스로 채점합니다." aria-label="답안"></textarea>
        <div class="row" style="margin-top:8px"><button class="primary x-go" type="button">모범답안 보기</button></div>`;
      ans.querySelector(".x-go").addEventListener("click", () => { const v = ans.querySelector(".x-in").value; finish(null, "모범답안과 비교해 스스로 채점하세요."); selfGrade(after, q, v); });
      if (o.reveal) finish(null);
    }
  }
  function selfGrade(after, q, given) {
    const box = document.createElement("div");
    box.className = "row"; box.style.marginTop = "10px";
    box.innerHTML = `<span class="msg">내 답은</span><button class="small" data-v="1">맞았어요</button><button class="small" data-v="0">틀렸어요</button>`;
    after.prepend(box);
    box.querySelectorAll("button").forEach((b) => b.addEventListener("click", async () => {
      const ok = b.dataset.v === "1";
      const last = A.attempts.filter((a) => a.qid === q.id).sort((x, y) => y.at - x.at)[0];
      if (last && Date.now() - last.at < 3600e3 && last.given === String(given || "")) { last.ok = ok; await window.DB.put("attempts", last); }
      else await addAttempt(q, ok, given);
      box.innerHTML = `<span class="tag ${ok ? "good" : "bad"}">${ok ? "맞음으로 기록" : "틀림으로 기록 → 오답노트"}</span>`;
    }));
  }
  async function doCheck(q, after) {
    const files = [...after.querySelector(".x-imgs").files];
    const out = after.querySelector(".x-result");
    if (!files.length) { toast("풀이 사진을 먼저 고르세요."); return; }
    if (!window.G.hasKey()) { out.innerHTML = noKeyNotice(); return; }
    out.innerHTML = `<span class="spin"></span> 사진을 읽고 첨삭하는 중…`;
    try {
      const imgs = await Promise.all(files.slice(0, 4).map((f) => window.U.imageToJpeg(f, 1600)));
      const r = await window.G.checkWork(q, imgs, after.querySelector(".x-note").value.trim());
      const vmap = { correct: ["ok", "풀이와 답이 모두 맞습니다."], partial: ["mid", "방향은 맞지만 고칠 부분이 있습니다."], wrong: ["no", "풀이에 틀린 부분이 있습니다."] };
      const v = vmap[r.verdict] || vmap.partial;
      out.innerHTML = `<div class="stack"><div class="verdict ${v[0]}">${v[1]}</div>
        ${r.wrong_step ? `<div class="notice warn"><b>처음 틀린 곳</b><div class="w"></div></div>` : ""}
        <div class="exp"><div class="exp-sec" style="border-top:0"><div class="lbl">첨삭</div><ul class="fb"></ul></div>
        ${r.corrected ? `<div class="exp-sec"><div class="lbl">올바른 풀이</div><div class="cr"></div></div>` : ""}</div></div>`;
      if (r.wrong_step) out.querySelector(".w").innerHTML = window.U.richHtml(r.wrong_step);
      out.querySelector(".fb").innerHTML = (r.feedback || []).map((f) => `<li>${window.U.richHtml(f)}</li>`).join("");
      if (r.corrected) out.querySelector(".cr").innerHTML = window.U.richHtml(r.corrected);
      math(out);
    } catch (e) { aiErr(out, e); }
  }

  /* ---------- 문제 수정 ---------- */
  function editQuestion(q, after) {
    const subjects = SUBJ.ALL;
    openDialog(`<h3 style="margin-top:0">문제 수정</h3>
      <div class="stack">
        <div class="fields">
          <label class="f">시험<select id="e-exam">${opts(Object.keys(SUBJ.EXAMS), q.exam)}</select></label>
          <label class="f">단계<select id="e-stage">${opts(["필기", "실기"], q.stage)}</select></label>
          <label class="f">과목<select id="e-subj">${opts(subjects, q.subject)}</select></label>
          <label class="f">단원<input type="text" id="e-unit" value="${esc(q.unit)}"></label>
          <label class="f">유형<select id="e-type">${opt("mcq", "객관식", q.type === "mcq")}${opt("calc", "계산형", q.type === "calc")}${opt("text", "서술형", q.type === "text")}</select></label>
        </div>
        <label class="f">문제 (수식은 $...$)<textarea id="e-q" rows="5">${esc(q.question)}</textarea></label>
        <div id="e-mcq" class="stack">
          ${[0, 1, 2, 3].map((i) => `<label class="f">보기 ${CIRC[i]}<input type="text" id="e-c${i}" value="${esc((q.choices || [])[i] || "")}"></label>`).join("")}
          <label class="f">정답 번호<select id="e-ai">${[1, 2, 3, 4].map((i) => opt(i, CIRC[i - 1], q.answerIndex === i)).join("")}</select></label>
        </div>
        <label class="f" id="e-disp-l">정답 (계산형은 "숫자 단위", 서술형은 모범답안)<textarea id="e-disp" rows="2">${esc(q.answerDisplay)}</textarea></label>
        <label class="f">핵심 풀이<textarea id="e-short" rows="3">${esc(q.short)}</textarea></label>
        <label class="row"><input type="checkbox" id="e-ok" ${q.answerSource === "ai" && q.source === "file" ? "" : "checked"}> 정답을 확인했습니다 (⚠ 표시 지우기)</label>
        <div class="row end"><button type="button" id="e-cancel">취소</button><button type="button" class="primary" id="e-save">저장</button></div>
      </div>`, (b) => {
      const syncType = () => { const t = b.querySelector("#e-type").value; b.querySelector("#e-mcq").hidden = t !== "mcq"; };
      b.querySelector("#e-type").addEventListener("change", syncType); syncType();
      b.querySelector("#e-cancel").addEventListener("click", closeDialog);
      b.querySelector("#e-save").addEventListener("click", async () => {
        const before = JSON.stringify([q.question, q.choices, q.answerIndex, q.answerDisplay, q.type]);
        q.exam = b.querySelector("#e-exam").value; q.stage = b.querySelector("#e-stage").value;
        q.subject = b.querySelector("#e-subj").value; q.unit = b.querySelector("#e-unit").value.trim();
        q.type = b.querySelector("#e-type").value; q.question = b.querySelector("#e-q").value.trim();
        q.choices = q.type === "mcq" ? [0, 1, 2, 3].map((i) => b.querySelector("#e-c" + i).value.trim()) : [];
        q.answerIndex = q.type === "mcq" ? +b.querySelector("#e-ai").value : 0;
        q.answerDisplay = b.querySelector("#e-disp").value.trim();
        if (q.type === "mcq" && !q.answerDisplay) q.answerDisplay = q.choices[q.answerIndex - 1] || "";
        q.short = b.querySelector("#e-short").value.trim();
        if (b.querySelector("#e-ok").checked) { if (q.answerSource === "ai") q.answerSource = "checked"; q.flags = []; }
        if (before !== JSON.stringify([q.question, q.choices, q.answerIndex, q.answerDisplay, q.type])) q.detail = null;
        await saveQ(q); closeDialog(); toast("저장했습니다."); after && after();
      });
    });
  }

  /* =========================================================
     라우팅
     ========================================================= */
  const VIEWS = ["home", "practice", "make", "import", "ask", "wrong", "stats", "bank", "tools", "settings"];
  const RENDER = {};
  function route() {
    const h = location.hash.replace("#", "");
    const cur = VIEWS.includes(h) ? h : "home";
    VIEWS.forEach((v) => { $("v-" + v).hidden = v !== cur; });
    document.querySelectorAll("#tabbar a").forEach((a) => {
      if (a.dataset.view === cur) { a.setAttribute("aria-current", "page"); a.scrollIntoView({ block: "nearest", inline: "nearest" }); }
      else a.removeAttribute("aria-current");
    });
    try { RENDER[cur] && RENDER[cur]($("v-" + cur)); } catch (e) { console.error(e); $("v-" + cur).innerHTML = `<div class="notice warn">화면을 그리는 중 오류가 났습니다: ${esc(e.message)}</div>`; }
    window.scrollTo(0, 0);
  }
  const go = (v) => { if (location.hash === "#" + v) route(); else location.hash = v; };

  /* =========================================================
     홈
     ========================================================= */
  RENDER.home = (el) => {
    const td = window.U.today();
    const todayN = A.attempts.filter((a) => a.day === td).length;
    const tot = A.attempts.length, ok = A.attempts.filter((a) => a.ok).length;
    const wrongN = wrongList().length;
    const plan = A.settings.plan; const pd = plan ? buildPlan(plan) : null;
    const todayTask = pd && pd.days && pd.days.find((d) => d.date === td);
    const backupOld = tot > 20 && (!A.settings.lastBackup || Date.now() - A.settings.lastBackup > 7 * 864e5);
    el.innerHTML = `
      ${!window.G.hasKey() ? `<div class="panel stack"><h3>처음 오셨나요? 3단계만 하면 AI 기능까지 씁니다</h3>
        <ol style="margin:0;padding-left:1.3em;display:grid;gap:4px">
          <li>Google AI Studio(<span class="mono-inline">aistudio.google.com</span>)에 Google 계정으로 들어갑니다.</li>
          <li><b>Get API key</b> → <b>Create API key</b>로 키를 만들고 복사합니다.</li>
          <li>이 앱의 <a href="#settings">설정</a>에 붙여 넣고 [저장]을 누릅니다.</li>
        </ol>
        <p class="hint">키가 없어도 기본 문제 ${A.qs.size}개 풀이, 오답노트, 공식집·계산기는 바로 쓸 수 있습니다.</p></div>` : ""}
      ${backupOld ? `<div class="notice warn">기록이 이 브라우저에만 있습니다. <a href="#settings">설정 → 백업 파일 내보내기</a>로 백업해 두세요.</div>` : ""}
      <div class="grid2">
        <div class="panel stack">
          <h3>시험 D-day</h3>
          ${pd && pd.dday != null ? `<div class="row"><span class="big" style="color:var(--copper)">${pd.dday > 0 ? "D-" + pd.dday : pd.dday === 0 ? "D-DAY" : "종료"}</span><span class="msg">${esc(plan.exam)} ${esc(plan.stage)} · ${esc(plan.date)}</span></div>
            ${todayTask ? `<div class="notice"><b>오늘 할 일</b><br>${esc(todayTask.task)}</div>
              <div class="row"><button class="primary" id="h-today">오늘 계획대로 풀기</button></div>` : `<p class="msg">${pd.dday < 0 ? "시험일이 지났습니다. 분석·계획에서 새 시험일을 넣으세요." : ""}</p>`}`
            : `<p class="msg">시험 날짜를 넣으면 남은 기간에 맞춰 과목별 일정을 짜 드립니다.</p><div class="row"><a class="btn primary" href="#stats">학습계획 만들기</a></div>`}
        </div>
        <div class="panel stack">
          <h3>내 공부 현황</h3>
          <div class="results">
            <div><div class="k">오늘 푼 문제</div><div class="v hl">${todayN}</div></div>
            <div><div class="k">전체 정답률</div><div class="v">${tot ? Math.round(ok / tot * 100) + "%" : "—"}</div></div>
            <div><div class="k">오답노트</div><div class="v">${wrongN}문제</div></div>
            <div><div class="k">문제은행</div><div class="v">${A.qs.size}문제</div></div>
          </div>
        </div>
      </div>
      <div class="grid3">
        <a class="btn" href="#practice" style="justify-content:center;padding:14px">📝 문제 풀기</a>
        <a class="btn" href="#make" style="justify-content:center;padding:14px">✨ AI 새 문제 만들기</a>
        <a class="btn" href="#import" style="justify-content:center;padding:14px">📄 기출 파일 변환</a>
        <a class="btn" href="#wrong" style="justify-content:center;padding:14px">🔁 오답 복습 (${wrongN})</a>
        <a class="btn" href="#ask" style="justify-content:center;padding:14px">❓ 막힌 문제 질문</a>
        <a class="btn" href="#tools" style="justify-content:center;padding:14px">🧮 공식집·계산기</a>
      </div>`;
    const b = $("h-today");
    if (b) b.addEventListener("click", () => {
      const ids = [...A.qs.values()].filter((q) => q.subject === todayTask.subject && (!todayTask.unit || q.unit === todayTask.unit)).map((q) => q.id);
      const ids2 = ids.length ? ids : [...A.qs.values()].filter((q) => q.subject === todayTask.subject).map((q) => q.id);
      if (!ids2.length) { MK.prefill = { subject: todayTask.subject, unit: todayTask.unit }; toast("이 과목 문제가 없어서 AI 문제 만들기로 이동합니다."); go("make"); return; }
      startPractice(window.U.shuffle(ids2).slice(0, 20), `오늘 계획: ${todayTask.subject}`);
    });
  };

  /* =========================================================
     문제 풀기
     ========================================================= */
  const P = { phase: "setup", f: { source: "", exam: "", stage: "", subject: "", unit: "", order: "random", count: "20" }, ids: [], i: 0, res: [], label: "" };
  function matchQ(q, f) {
    return (!f.source || q.source === f.source) && (!f.exam || q.exam === f.exam) && (!f.stage || q.stage === f.stage) &&
      (!f.subject || q.subject === f.subject) && (!f.unit || q.unit === f.unit);
  }
  function startPractice(ids, label) {
    P.phase = "run"; P.ids = ids; P.i = 0; P.res = []; P.label = label || "";
    go("practice");
  }
  RENDER.practice = (el) => {
    if (P.phase === "run" && P.i < P.ids.length) return practiceRun(el);
    if (P.phase === "run") P.phase = "done";
    if (P.phase === "done") return practiceDone(el);
    const f = P.f, all = [...A.qs.values()];
    const units = [...new Set(all.filter((q) => !f.subject || q.subject === f.subject).map((q) => q.unit).filter(Boolean))].sort();
    const subjects = [...new Set(all.map((q) => q.subject))].sort((a, b) => SUBJ.ALL.indexOf(a) - SUBJ.ALL.indexOf(b));
    const sources = [...new Set(all.map((q) => q.source))];
    const srcLabel = { seed: "기본 문제", ai: "AI 생성", file: "기출 파일", custom: "내가 저장" };
    el.innerHTML = `<div class="view-head"><h2>문제 풀기</h2><p>조건을 고르고 시작하세요. 틀린 문제는 오답노트에 자동으로 모입니다.</p></div>
      <div class="panel stack">
        <div class="fields">
          <label class="f">출처<select id="p-source">${opt("", "전체", !f.source)}${sources.map((s) => opt(s, srcLabel[s] || s, f.source === s)).join("")}</select></label>
          <label class="f">시험<select id="p-exam">${opts(Object.keys(SUBJ.EXAMS), f.exam, "전체")}</select></label>
          <label class="f">필기/실기<select id="p-stage">${opts(["필기", "실기"], f.stage, "전체")}</select></label>
          <label class="f">과목<select id="p-subject">${opts(subjects, f.subject, "전체")}</select></label>
          <label class="f">단원<select id="p-unit">${opts(units, f.unit, "전체")}</select></label>
          <label class="f">순서<select id="p-order">${opt("random", "무작위", f.order === "random")}${opt("weak", "약한 단원 먼저", f.order === "weak")}${opt("new", "안 푼 문제 먼저", f.order === "new")}</select></label>
          <label class="f">문제 수<select id="p-count">${["10", "20", "40", "all"].map((c) => opt(c, c === "all" ? "전부" : c + "문제", f.count === c)).join("")}</select></label>
        </div>
        <div class="row"><span class="msg" id="p-n"></span><span class="spacer"></span><button class="primary" id="p-start">시작</button></div>
      </div>`;
    const read = () => { ["source", "exam", "stage", "subject", "unit", "order", "count"].forEach((k) => { f[k] = $("p-" + k).value; }); };
    const count = () => { read(); const n = all.filter((q) => matchQ(q, f)).length; $("p-n").innerHTML = n ? `조건에 맞는 문제 <b>${n}</b>개` : `조건에 맞는 문제가 없습니다. <a href="#make">AI로 만들기</a> 또는 <a href="#import">기출 파일 변환</a>을 이용하세요.`; $("p-start").disabled = !n; };
    ["source", "exam", "stage", "unit", "order", "count"].forEach((k) => $("p-" + k).addEventListener("change", count));
    $("p-subject").addEventListener("change", () => { read(); f.unit = ""; RENDER.practice(el); });
    count();
    $("p-start").addEventListener("click", () => {
      read();
      let list = all.filter((q) => matchQ(q, f));
      const last = lastByQ();
      if (f.order === "weak") {
        const acc = accBy((a) => a.subject + "|" + a.unit);
        const sc = (q) => { const s = acc.get(q.subject + "|" + (q.unit || "")); return s ? s.ok / s.n : 0.5; };
        list = window.U.shuffle(list).sort((a, b) => sc(a) - sc(b));
      } else if (f.order === "new") {
        list = window.U.shuffle(list).sort((a, b) => (last.has(a.id) ? 1 : 0) - (last.has(b.id) ? 1 : 0));
      } else list = window.U.shuffle(list);
      if (f.count !== "all") list = list.slice(0, +f.count);
      startPractice(list.map((q) => q.id), "");
    });
  };
  function practiceRun(el) {
    const q = A.qs.get(P.ids[P.i]);
    if (!q) { P.i++; return RENDER.practice(el); }
    el.innerHTML = `<div class="stack">
      <div class="row"><span class="msg">${P.label ? esc(P.label) + " · " : ""}${P.i + 1} / ${P.ids.length} · 맞힘 ${P.res.filter((r) => r.ok).length}</span><span class="spacer"></span><button class="small" id="r-stop">그만 풀기</button></div>
      <div class="progress"><i style="width:${P.i / P.ids.length * 100}%"></i></div>
      <div id="r-card"></div>
      <div class="row end" id="r-next-row" hidden><button class="primary" id="r-next">${P.i + 1 < P.ids.length ? "다음 문제" : "결과 보기"}</button></div>
    </div>`;
    renderCard($("r-card"), q, { onDone: (ok) => { P.res.push({ qid: q.id, ok }); $("r-next-row").hidden = false; } });
    $("r-next").addEventListener("click", () => { P.i++; RENDER.practice(el); });
    $("r-stop").addEventListener("click", () => { P.phase = "done"; RENDER.practice(el); });
  }
  function practiceDone(el) {
    const graded = P.res.filter((r) => r.ok !== null);
    const ok = graded.filter((r) => r.ok).length;
    const wrongIds = P.res.filter((r) => r.ok === false).map((r) => r.qid);
    const bySub = new Map();
    P.res.forEach((r) => { const q = A.qs.get(r.qid); if (!q || r.ok === null) return; const s = bySub.get(q.subject) || { n: 0, ok: 0 }; s.n++; if (r.ok) s.ok++; bySub.set(q.subject, s); });
    el.innerHTML = `<div class="view-head"><h2>결과</h2></div>
      <div class="panel stack">
        <div class="row"><span class="big" style="color:var(--copper)">${ok} / ${graded.length}</span><span class="msg">정답률 ${graded.length ? Math.round(ok / graded.length * 100) : 0}%${P.res.length > graded.length ? ` · 스스로 채점 대기 ${P.res.length - graded.length}문제` : ""}</span></div>
        ${[...bySub].map(([s, v]) => `<div><div class="row"><span>${esc(s)}</span><span class="spacer"></span><span class="mono">${v.ok}/${v.n}</span></div><div class="bar"><i style="width:${v.ok / v.n * 100}%;background:${v.ok / v.n >= 0.6 ? "var(--good)" : "var(--bad)"}"></i></div></div>`).join("")}
        ${P.stage === "필기" ? "" : ""}
        <p class="hint">필기 합격 기준: 과목마다 40점 이상, 전체 평균 60점 이상.</p>
        <div class="row">${wrongIds.length ? `<button class="primary" id="d-retry">틀린 ${wrongIds.length}문제 다시 풀기</button>` : ""}<button id="d-new">새로 풀기</button><a class="btn" href="#wrong">오답노트</a></div>
      </div>`;
    if (wrongIds.length) $("d-retry").addEventListener("click", () => startPractice(window.U.shuffle(wrongIds.slice()), "틀린 문제 다시"));
    $("d-new").addEventListener("click", () => { P.phase = "setup"; RENDER.practice(el); });
  }

  /* =========================================================
     AI 문제 만들기
     ========================================================= */
  const MK = { exam: "전기기사", stage: "필기", subject: "회로이론", unit: "", difficulty: "보통 (실제 시험 수준)", type: "auto", count: "5", made: [], prefill: null };
  RENDER.make = (el) => {
    if (MK.prefill) { Object.assign(MK, MK.prefill); MK.prefill = null; }
    const subs = SUBJ.subjectsFor(MK.exam, MK.stage);
    if (!subs.includes(MK.subject)) MK.subject = subs[0];
    const units = SUBJ.unitsFor(MK.subject);
    el.innerHTML = `<div class="view-head"><h2>AI 새 문제 만들기</h2><p>Gemini가 기출 유형을 참고해 새 문제를 만들고 문제은행에 저장합니다. 무료 한도를 아끼려면 한 번에 5문제 정도가 적당합니다.</p></div>
      ${window.G.hasKey() ? "" : noKeyNotice()}
      <div class="panel stack">
        <div class="fields">
          <label class="f">시험<select id="m-exam">${opts(Object.keys(SUBJ.EXAMS), MK.exam)}</select></label>
          <label class="f">필기/실기<select id="m-stage">${opts(["필기", "실기"], MK.stage)}</select></label>
          <label class="f">과목<select id="m-subject">${subs.map((s) => opt(s, s + (SUBJ.PRIORITY.includes(s) ? " ★" : ""), s === MK.subject)).join("")}</select></label>
          <label class="f">단원<select id="m-unit">${opt("", "과목 전체", !MK.unit)}${units.map((u) => opt(u, u, u === MK.unit)).join("")}${MK.unit && !units.includes(MK.unit) ? opt(MK.unit, MK.unit, true) : ""}</select></label>
          <label class="f">난이도<select id="m-diff">${opts(["쉬움 (개념 확인)", "보통 (실제 시험 수준)", "어려움 (고득점용)"], MK.difficulty)}</select></label>
          <label class="f">유형<select id="m-type">${opt("auto", "자동", MK.type === "auto")}${opt("mcq", "객관식만", MK.type === "mcq")}${opt("calc", "계산형만", MK.type === "calc")}</select></label>
          <label class="f">문제 수<select id="m-count">${["3", "5", "10"].map((c) => opt(c, c + "문제", c === MK.count)).join("")}</select></label>
        </div>
        <p class="hint">★ 표시는 처음 버전에서 우선으로 정한 공통 계산과목입니다.</p>
        <div class="row"><button class="primary" id="m-go" ${window.G.hasKey() ? "" : "disabled"}>문제 만들기</button><span class="msg" id="m-msg"></span></div>
      </div>
      <div id="m-out"></div>`;
    const read = () => { MK.exam = $("m-exam").value; MK.stage = $("m-stage").value; MK.subject = $("m-subject").value; MK.unit = $("m-unit").value; MK.difficulty = $("m-diff").value; MK.type = $("m-type").value; MK.count = $("m-count").value; };
    ["m-exam", "m-stage", "m-subject"].forEach((id) => $(id).addEventListener("change", () => { read(); if (id !== "m-subject") MK.subject = ""; MK.unit = ""; RENDER.make(el); }));
    ["m-unit", "m-diff", "m-type", "m-count"].forEach((id) => $(id).addEventListener("change", read));
    const showMade = () => {
      if (!MK.made.length) return;
      $("m-out").innerHTML = `<div class="panel stack"><h3>방금 만든 문제 ${MK.made.length}개 <small>문제은행에 저장됨</small></h3>
        <div class="list">${MK.made.map((id, i) => { const q = A.qs.get(id); return q ? `<div class="item"><div class="q-meta">${qTags(q)}</div><div class="t" data-i="${i}"></div></div>` : ""; }).join("")}</div>
        <div class="row"><button class="primary" id="m-solve">바로 풀기</button></div></div>`;
      $("m-out").querySelectorAll(".t").forEach((t) => { const q = A.qs.get(MK.made[+t.dataset.i]); rich(t, q.question.length > 140 ? q.question.slice(0, 140) + "…" : q.question); });
      $("m-solve").addEventListener("click", () => startPractice(MK.made.slice(), "AI 새 문제"));
    };
    showMade();
    $("m-go").addEventListener("click", async () => {
      read();
      const b = $("m-go"); b.disabled = true; $("m-msg").innerHTML = `<span class="spin"></span> 문제를 만드는 중… (10~40초)`;
      try {
        const out = await window.G.generateQuestions({ exam: MK.exam, stage: MK.stage, subject: MK.subject, unit: MK.unit, difficulty: MK.difficulty, count: +MK.count, type: MK.type });
        const qs = out.filter((x) => x.question).map((x) => makeQ({
          source: "ai", exam: MK.exam, stage: MK.stage, subject: MK.subject, unit: x.unit || MK.unit, type: x.type,
          question: x.question, choices: x.type === "mcq" ? (x.choices || []).slice(0, 4) : [], answerIndex: x.type === "mcq" ? x.answer_index : 0,
          answerDisplay: x.answer_display || "", answerSource: "ai", short: x.short || ""
        })).filter((q) => q.type !== "mcq" || (q.choices.length === 4 && q.answerIndex >= 1 && q.answerIndex <= 4));
        await saveQs(qs);
        MK.made = qs.map((q) => q.id);
        $("m-msg").textContent = `${qs.length}문제를 만들었습니다.`;
        showMade();
      } catch (e) { $("m-msg").textContent = ""; aiErr($("m-out"), e); }
      b.disabled = false;
    });
  };

  /* =========================================================
     질문하기
     ========================================================= */
  const ASK = { last: null };
  RENDER.ask = (el) => {
    el.innerHTML = `<div class="view-head"><h2>막힌 문제 질문하기</h2><p>교재나 기출에서 막힌 문제를 글로 쓰거나 사진으로 올리세요. 풀이와 해설을 받고, 원하면 문제은행에 저장해 다시 풀 수 있습니다.</p></div>
      ${window.G.hasKey() ? "" : noKeyNotice()}
      <div class="panel stack">
        <label class="f">과목 (모르면 비워 두세요)<select id="a-sub">${opts(SUBJ.ALL, "", "자동 판단")}</select></label>
        <label class="f">문제 또는 질문<textarea id="a-text" rows="5" placeholder="예: 정격용량 100 kVA, %임피던스 5%인 변압기 2차 측에서 3상 단락이 났을 때 단락용량은?"></textarea></label>
        <label class="f">사진 (선택, 최대 4장)<input type="file" id="a-img" accept="image/*" multiple></label>
        <div class="row"><button class="primary" id="a-go" ${window.G.hasKey() ? "" : "disabled"}>풀이 받기</button><span class="msg" id="a-msg"></span></div>
      </div>
      <div id="a-out"></div>`;
    const show = () => {
      if (!ASK.last) return;
      const q = ASK.last;
      $("a-out").innerHTML = `<div id="a-card"></div><div class="row end" style="margin-top:10px"><button id="a-save" ${A.qs.has(q.id) ? "disabled" : ""}>${A.qs.has(q.id) ? "문제은행에 저장됨" : "문제은행에 저장"}</button></div>`;
      renderCard($("a-card"), q, { reveal: true });
      $("a-save").addEventListener("click", async () => { await saveQ(q); $("a-save").disabled = true; $("a-save").textContent = "문제은행에 저장됨"; toast("저장했습니다. 오답노트·문제 풀기에서 다시 풀 수 있습니다."); });
    };
    show();
    $("a-go").addEventListener("click", async () => {
      const text = $("a-text").value.trim(), files = [...$("a-img").files].slice(0, 4);
      if (!text && !files.length) { toast("문제를 쓰거나 사진을 올려 주세요."); return; }
      $("a-go").disabled = true; $("a-msg").innerHTML = `<span class="spin"></span> 푸는 중…`;
      try {
        const imgs = await Promise.all(files.map((f) => window.U.imageToJpeg(f, 1600)));
        const r = await window.G.ask(text, imgs, $("a-sub").value);
        ASK.last = makeQ({
          source: "custom", exam: "전공", stage: r.type === "mcq" ? "필기" : "실기", subject: SUBJ.ALL.includes(r.subject) ? r.subject : ($("a-sub").value || "회로이론"),
          unit: r.unit || "", type: r.type || "text", question: r.question || text, choices: r.type === "mcq" ? (r.choices || []).slice(0, 4) : [],
          answerIndex: r.type === "mcq" ? r.answer_index : 0, answerDisplay: r.answer_display || "", answerSource: "ai",
          short: (r.explanation && r.explanation.short) || "", detail: r.explanation || null
        });
        $("a-msg").textContent = "";
        show();
      } catch (e) { $("a-msg").textContent = ""; aiErr($("a-out"), e); }
      $("a-go").disabled = false;
    });
  };

  /* =========================================================
     오답노트
     ========================================================= */
  function wrongList() {
    const last = lastByQ(), cnt = new Map();
    A.attempts.forEach((a) => { if (!a.ok) cnt.set(a.qid, (cnt.get(a.qid) || 0) + 1); });
    return [...last.values()].filter((a) => !a.ok && A.qs.has(a.qid)).map((a) => ({ q: A.qs.get(a.qid), at: a.at, n: cnt.get(a.qid) || 1 }))
      .sort((x, y) => y.at - x.at);
  }
  const W = { subject: "" };
  RENDER.wrong = (el) => {
    const all = wrongList();
    const subs = [...new Set(all.map((w) => w.q.subject))];
    const list = all.filter((w) => !W.subject || w.q.subject === W.subject);
    el.innerHTML = `<div class="view-head"><h2>오답노트</h2><p>마지막으로 풀었을 때 틀린 문제가 모입니다. 다시 풀어서 맞히면 자동으로 빠집니다.</p></div>
      ${all.length ? `<div class="row">${["", ...subs].map((s) => `<button class="chip" aria-pressed="${s === W.subject}" data-s="${esc(s)}">${s || "전체"} ${s ? all.filter((w) => w.q.subject === s).length : all.length}</button>`).join("")}</div>
      <div class="row"><button class="primary" id="w-all">${list.length}문제 모두 다시 풀기</button></div>
      <div class="list">${list.map((w, i) => `<div class="item"><div class="q-meta">${qTags(w.q)}<span class="tag bad">${w.n}번 틀림</span></div>
        <div class="t" data-i="${i}"></div>
        <div class="row"><button class="small" data-retry="${i}">다시 풀기</button><button class="small" data-view="${i}">정답·해설 보기</button><span class="spacer"></span><span class="msg">${new Date(w.at).toLocaleDateString("ko-KR")}</span></div></div>`).join("")}</div>`
      : `<div class="empty">아직 틀린 문제가 없습니다. <a href="#practice">문제를 풀어 보세요.</a></div>`}`;
    el.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => { W.subject = b.dataset.s; RENDER.wrong(el); }));
    el.querySelectorAll(".t").forEach((t) => { const q = list[+t.dataset.i].q; rich(t, q.question.length > 160 ? q.question.slice(0, 160) + "…" : q.question); });
    if ($("w-all")) $("w-all").addEventListener("click", () => startPractice(window.U.shuffle(list.map((w) => w.q.id)), "오답 복습"));
    el.querySelectorAll("[data-retry]").forEach((b) => b.addEventListener("click", () => startPractice([list[+b.dataset.retry].q.id], "오답 복습")));
    el.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
      openDialog(`<div class="row end"><button type="button" id="dv-close">닫기</button></div><div id="dv-card"></div>`, (box) => {
        box.querySelector("#dv-close").addEventListener("click", closeDialog);
        renderCard(box.querySelector("#dv-card"), list[+b.dataset.view].q, { reveal: true });
      });
    }));
  };

  /* =========================================================
     분석·계획
     ========================================================= */
  function daysBetween(a, b) { return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 864e5); }
  function addDays(d, n) { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); }
  function buildPlan(plan) {
    const td = window.U.today();
    if (!plan.date) return { dday: null, days: [] };
    const dday = daysBetween(td, plan.date);
    if (dday < 0) return { dday, days: [] };
    const D = dday + 1;
    const review = D >= 8 ? Math.min(7, Math.ceil(D * 0.2)) : Math.max(1, Math.floor(D / 3));
    const study = D - review;
    const subs = (plan.subjects && plan.subjects.length ? plan.subjects : SUBJ.subjectsFor(plan.exam, plan.stage));
    const sAcc = accBy((a) => a.subject), uAcc = accBy((a) => a.subject + "|" + a.unit);
    const w = {}; subs.forEach((s) => { const v = sAcc.get(s); const acc = v && v.n >= 3 ? v.ok / v.n : 0.5; w[s] = 1 + 2 * (1 - acc); });
    const unitOrder = {}; subs.forEach((s) => {
      const us = SUBJ.unitsFor(s).slice();
      us.sort((a, b) => { const x = uAcc.get(s + "|" + a), y = uAcc.get(s + "|" + b); return (x ? x.ok / x.n : 0.5) - (y ? y.ok / y.n : 0.5); });
      unitOrder[s] = us.length ? us : [""];
    });
    const credit = {}; subs.forEach((s) => (credit[s] = 0));
    const used = {}; subs.forEach((s) => (used[s] = 0));
    const total = subs.reduce((t, s) => t + w[s], 0);
    const nQ = Math.max(5, Math.round((+plan.hours || 2) * 10));
    const days = [];
    for (let i = 0; i < D; i++) {
      const date = addDays(td, i);
      if (i >= study) { days.push({ date, subject: "", unit: "", task: `총정리: 오답노트 전체 다시 풀기 → 약한 단원 집중 → 전 과목 섞어서 실전처럼 ${nQ}문제` }); continue; }
      subs.forEach((s) => (credit[s] += w[s]));
      const s = subs.reduce((m, x) => (credit[x] > credit[m] ? x : m), subs[0]);
      credit[s] -= total;
      const u = unitOrder[s][used[s] % unitOrder[s].length]; used[s]++;
      days.push({ date, subject: s, unit: u, task: `${s}${u ? " · " + u : ""}: 개념·공식 정리 → 문제 ${nQ}개 → 틀린 문제 해설 확인` });
    }
    return { dday, days, review, study };
  }
  RENDER.stats = (el) => {
    const tot = A.attempts.length, ok = A.attempts.filter((a) => a.ok).length;
    const sAcc = accBy((a) => a.subject), uAcc = accBy((a) => a.subject + "|" + a.unit);
    const weak = [...uAcc].filter(([k, v]) => v.n >= 2 && k.split("|")[1]).map(([k, v]) => ({ s: k.split("|")[0], u: k.split("|")[1], n: v.n, acc: v.ok / v.n })).sort((a, b) => a.acc - b.acc || b.n - a.n).slice(0, 8);
    const last14 = []; for (let i = 13; i >= 0; i--) { const d = addDays(window.U.today(), -i); last14.push({ d, n: A.attempts.filter((a) => a.day === d).length }); }
    const mx = Math.max(1, ...last14.map((x) => x.n));
    const plan = A.settings.plan || { exam: "전기기사", stage: "필기", date: "", hours: "3", subjects: [] };
    const planSubs = SUBJ.subjectsFor(plan.exam, plan.stage);
    const pd = plan.date ? buildPlan(plan) : null;
    el.innerHTML = `<div class="view-head"><h2>분석·계획</h2><p>과목·단원별 정답률로 약한 곳을 찾고, 시험일까지 일정을 짭니다. 일정은 약한 과목에 날을 더 배정하고, 풀수록 자동으로 다시 계산됩니다.</p></div>
      <div class="grid2">
        <div class="panel stack"><h3>과목별 정답률 <small>전체 ${tot}문제 · ${tot ? Math.round(ok / tot * 100) : 0}%</small></h3>
          ${sAcc.size ? [...sAcc].sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n).map(([s, v]) => { const p = Math.round(v.ok / v.n * 100); return `<div><div class="row"><span>${esc(s)}</span><span class="spacer"></span><span class="mono">${p}% · ${v.n}문제</span></div><div class="bar"><i style="width:${p}%;background:${p >= 60 ? "var(--good)" : p >= 40 ? "var(--warn)" : "var(--bad)"}"></i></div></div>`; }).join("") : `<p class="msg">문제를 풀면 여기에 과목별 정답률이 나타납니다.</p>`}
          <p class="hint">초록 60% 이상(합격권), 노랑 40~60%, 빨강 40% 미만(과락 위험)</p>
        </div>
        <div class="panel stack"><h3>약한 단원 <small>2문제 이상 푼 단원</small></h3>
          ${weak.length ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>단원</th><th>정답률</th><th></th></tr></thead><tbody>
            ${weak.map((w, i) => `<tr><td>${esc(w.u)}<br><small class="msg">${esc(w.s)}</small></td><td class="num">${Math.round(w.acc * 100)}% (${w.n})</td><td><button class="small" data-w="${i}">연습</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="msg">아직 데이터가 부족합니다.</p>`}
        </div>
      </div>
      <div class="panel stack"><h3>최근 14일 푼 문제 수</h3>
        <div style="display:grid;grid-template-columns:repeat(14,1fr);gap:4px;align-items:end;height:90px">${last14.map((x) => `<div title="${x.d}: ${x.n}문제" style="height:${Math.max(3, x.n / mx * 80)}px;background:${x.n ? "var(--copper)" : "var(--line)"};border-radius:2px"></div>`).join("")}</div>
        <div class="row msg"><span>${last14[0].d.slice(5)}</span><span class="spacer"></span><span>오늘</span></div>
      </div>
      <div class="panel stack"><h3>시험 D-day 학습계획</h3>
        <div class="fields">
          <label class="f">시험<select id="pl-exam">${opts(Object.keys(SUBJ.EXAMS), plan.exam)}</select></label>
          <label class="f">필기/실기<select id="pl-stage">${opts(["필기", "실기"], plan.stage)}</select></label>
          <label class="f">시험일<input type="date" id="pl-date" value="${esc(plan.date)}"></label>
          <label class="f">하루 공부 시간<select id="pl-hours">${["1", "2", "3", "4", "6", "8"].map((h) => opt(h, h + "시간", String(plan.hours) === h)).join("")}</select></label>
        </div>
        <div class="row" id="pl-subs">${planSubs.map((s) => `<label class="row" style="gap:4px"><input type="checkbox" value="${esc(s)}" ${!plan.subjects || !plan.subjects.length || plan.subjects.includes(s) ? "checked" : ""}> ${esc(s)}</label>`).join("")}</div>
        <div class="row"><button class="primary" id="pl-save">계획 저장</button>${A.settings.plan ? `<button id="pl-del">계획 삭제</button>` : ""}</div>
        <div id="pl-out"></div>
      </div>`;
    el.querySelectorAll("[data-w]").forEach((b) => b.addEventListener("click", () => {
      const w = weak[+b.dataset.w];
      const ids = [...A.qs.values()].filter((q) => q.subject === w.s && q.unit === w.u).map((q) => q.id);
      if (ids.length) startPractice(window.U.shuffle(ids), `약한 단원: ${w.u}`);
      else { MK.prefill = { subject: w.s, unit: w.u }; go("make"); }
    }));
    const readPlan = () => ({ exam: $("pl-exam").value, stage: $("pl-stage").value, date: $("pl-date").value, hours: $("pl-hours").value, subjects: [...$("pl-subs").querySelectorAll("input:checked")].map((i) => i.value) });
    ["pl-exam", "pl-stage"].forEach((id) => $(id).addEventListener("change", () => { const p = readPlan(); p.subjects = []; A.settings.plan = Object.assign({}, p, { date: p.date }); saveSettings(); RENDER.stats(el); }));
    $("pl-save").addEventListener("click", () => {
      const p = readPlan();
      if (!p.date) { toast("시험일을 넣어 주세요."); return; }
      if (!p.subjects.length) { toast("과목을 하나 이상 고르세요."); return; }
      A.settings.plan = p; saveSettings(); toast("계획을 저장했습니다."); RENDER.stats(el);
    });
    if ($("pl-del")) armed($("pl-del"), () => { A.settings.plan = null; saveSettings(); RENDER.stats(el); });
    if (pd) {
      const td = window.U.today();
      if (pd.dday < 0) $("pl-out").innerHTML = `<p class="msg">시험일이 지났습니다. 새 시험일을 넣으세요.</p>`;
      else {
        const cnt = {}; pd.days.forEach((d) => { const k = d.subject || "총정리"; cnt[k] = (cnt[k] || 0) + 1; });
        $("pl-out").innerHTML = `<p class="msg">남은 ${pd.days.length}일 중 과목 공부 ${pd.study}일, 총정리 ${pd.review}일 · ${Object.entries(cnt).map(([k, v]) => `${esc(k)} ${v}일`).join(", ")}</p>
          <div class="scroll-x"><table class="tbl"><thead><tr><th>날짜</th><th>D-day</th><th>할 일</th></tr></thead><tbody>
          ${pd.days.slice(0, 21).map((d) => `<tr class="${d.date === td ? "today" : ""}"><td class="num">${d.date.slice(5)}</td><td class="num">D-${daysBetween(d.date, A.settings.plan.date)}</td><td>${esc(d.task)}</td></tr>`).join("")}
          </tbody></table></div>${pd.days.length > 21 ? `<p class="hint">앞으로 3주만 보여 줍니다. 정답률이 바뀌면 일정도 다시 계산됩니다.</p>` : ""}`;
      }
    }
  };

  /* =========================================================
     문제은행
     ========================================================= */
  const BK = { q: "", source: "", subject: "", limit: 40 };
  RENDER.bank = (el) => {
    const all = [...A.qs.values()].sort((a, b) => b.createdAt - a.createdAt);
    const files = [...new Set(all.filter((q) => q.source === "file").map((q) => q.sourceName))];
    const srcLabel = { seed: "기본 문제", ai: "AI 생성", file: "기출 파일", custom: "내가 저장" };
    const list = all.filter((q) => (!BK.source || q.source === BK.source) && (!BK.subject || q.subject === BK.subject) &&
      (!BK.q || (q.question + " " + q.unit + " " + q.sourceName).toLowerCase().includes(BK.q.toLowerCase())));
    el.innerHTML = `<div class="view-head"><h2>문제은행</h2><p>저장된 문제 ${all.length}개. 변환이 잘못된 문제는 여기서 고치거나 지우세요.</p></div>
      <div class="panel stack">
        <div class="fields">
          <label class="f">검색<input type="text" id="b-q" value="${esc(BK.q)}" placeholder="문제 내용, 단원, 파일명"></label>
          <label class="f">출처<select id="b-src">${opt("", "전체", !BK.source)}${Object.keys(srcLabel).map((s) => opt(s, srcLabel[s], BK.source === s)).join("")}</select></label>
          <label class="f">과목<select id="b-sub">${opts(SUBJ.ALL, BK.subject, "전체")}</select></label>
        </div>
        ${files.length ? `<div class="row"><select id="b-file" style="width:auto;max-width:100%">${files.map((f) => opt(f, f + " (" + all.filter((q) => q.sourceName === f).length + ")")).join("")}</select><button class="danger" id="b-file-del">이 파일 문제 모두 삭제</button></div>` : ""}
      </div>
      <p class="msg">${list.length}개 표시</p>
      <div class="list">${list.slice(0, BK.limit).map((q, i) => `<div class="item"><div class="q-meta">${qTags(q)}</div><div class="t" data-i="${i}"></div>
        <div class="row"><button class="small" data-view="${i}">보기</button><button class="small" data-edit="${i}">수정</button><button class="small danger" data-del="${i}">삭제</button></div></div>`).join("")}</div>
      ${list.length > BK.limit ? `<div class="row"><button id="b-more">더 보기</button></div>` : ""}`;
    el.querySelectorAll(".t").forEach((t) => { const q = list[+t.dataset.i]; rich(t, q.question.length > 160 ? q.question.slice(0, 160) + "…" : q.question); });
    let timer = null;
    $("b-q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { BK.q = $("b-q").value; BK.limit = 40; RENDER.bank(el); $("b-q").focus(); $("b-q").setSelectionRange(BK.q.length, BK.q.length); }, 300); });
    $("b-src").addEventListener("change", () => { BK.source = $("b-src").value; RENDER.bank(el); });
    $("b-sub").addEventListener("change", () => { BK.subject = $("b-sub").value; RENDER.bank(el); });
    if ($("b-more")) $("b-more").addEventListener("click", () => { BK.limit += 40; RENDER.bank(el); });
    if ($("b-file-del")) armed($("b-file-del"), async () => { const f = $("b-file").value; await delQs(all.filter((q) => q.sourceName === f).map((q) => q.id)); toast("삭제했습니다."); RENDER.bank(el); });
    el.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => openDialog(`<div class="row end"><button type="button" id="dv-close">닫기</button></div><div id="dv-card"></div>`, (box) => {
      box.querySelector("#dv-close").addEventListener("click", closeDialog); renderCard(box.querySelector("#dv-card"), list[+b.dataset.view], { reveal: true });
    })));
    el.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => editQuestion(list[+b.dataset.edit], () => RENDER.bank(el))));
    el.querySelectorAll("[data-del]").forEach((b) => armed(b, async () => { await delQs([list[+b.dataset.del].id]); toast("삭제했습니다."); RENDER.bank(el); }, "정말 삭제?"));
  };

  /* =========================================================
     설정
     ========================================================= */
  RENDER.settings = (el) => {
    const s = A.settings;
    el.innerHTML = `<div class="view-head"><h2>설정</h2></div>
      ${window.DB.isMemory() ? `<div class="notice warn">이 브라우저에서는 저장소를 쓸 수 없어 창을 닫으면 기록이 사라집니다. 일반(시크릿 아님) 창에서 열어 주세요.</div>` : ""}
      <div class="panel stack"><h3>Gemini API 키</h3>
        <ol style="margin:0;padding-left:1.3em;display:grid;gap:4px" class="hint">
          <li>Google AI Studio(<span class="mono-inline">aistudio.google.com</span>)에 Google 계정으로 로그인합니다.</li>
          <li>왼쪽 메뉴 또는 상단의 <b>Get API key</b> → <b>Create API key</b>를 누릅니다.</li>
          <li>만들어진 키(AIza로 시작)를 복사해 아래에 붙여 넣고 [저장]을 누릅니다.</li>
        </ol>
        <div class="row"><input type="password" id="s-key" value="${esc(s.apiKey)}" placeholder="AIza…" autocomplete="off" style="flex:1 1 240px" aria-label="API 키"><button id="s-show" type="button">보기</button></div>
        <div class="row"><button class="primary" id="s-save">저장</button><button id="s-test">연결 테스트</button>${s.apiKey ? `<button id="s-clear" class="danger">키 지우기</button>` : ""}<span class="msg" id="s-msg"></span></div>
        <p class="hint">키는 이 브라우저에만 저장되고 Google 서버 외에는 보내지 않습니다. 백업 파일에도 넣지 않습니다. 다른 사람과 같이 쓰는 컴퓨터라면 다 쓴 뒤 [키 지우기]를 누르세요. 무료 등급에서는 보낸 내용이 Google 서비스 개선에 쓰일 수 있으니 개인정보가 담긴 사진은 올리지 마세요.</p>
      </div>
      <div class="panel stack"><h3>AI 모델</h3>
        <div class="row"><select id="s-model" style="flex:1 1 220px">${opt(s.model, s.model, true)}</select><button id="s-models">모델 목록 불러오기</button></div>
        <p class="hint">기본값은 gemini-2.5-flash입니다. 이 모델이 없어졌다는 오류가 나면 목록을 불러와 이름에 flash가 들어간 최신 모델을 고르세요(무료 한도가 넉넉한 편).</p>
      </div>
      <div class="panel stack"><h3>백업 · 기기 간 옮기기</h3>
        <p class="hint">휴대폰과 PC의 기록은 따로 저장됩니다. 한쪽에서 [내보내기]로 파일을 만들고, 카톡 나에게 보내기나 메일로 옮긴 뒤 다른 쪽에서 [불러오기]를 누르세요. 불러오면 기존 기록과 합쳐집니다.</p>
        <div class="row"><button class="primary" id="s-export">백업 파일 내보내기</button><label class="btn" for="s-import">백업 파일 불러오기</label><input type="file" id="s-import" accept=".json,application/json" hidden></div>
        <p class="msg">${s.lastBackup ? "마지막 백업: " + new Date(s.lastBackup).toLocaleString("ko-KR") : "아직 백업하지 않았습니다."}</p>
      </div>
      <div class="panel stack"><h3>데이터 관리</h3>
        <div class="row"><button id="s-seed">기본 문제 다시 넣기</button><button class="danger" id="s-reset">모든 기록과 문제 지우기</button></div>
        <p class="hint">문제 ${A.qs.size}개 · 풀이 기록 ${A.attempts.length}개</p>
      </div>`;
    $("s-show").addEventListener("click", () => { const k = $("s-key"); k.type = k.type === "password" ? "text" : "password"; $("s-show").textContent = k.type === "password" ? "보기" : "숨기기"; });
    $("s-save").addEventListener("click", () => { s.apiKey = $("s-key").value.trim(); s.model = $("s-model").value || s.model; saveSettings(); $("s-msg").textContent = s.apiKey ? "저장했습니다. [연결 테스트]로 확인해 보세요." : "키를 지웠습니다."; });
    if ($("s-clear")) armed($("s-clear"), () => { s.apiKey = ""; saveSettings(); RENDER.settings(el); toast("키를 지웠습니다."); });
    $("s-test").addEventListener("click", async () => {
      s.apiKey = $("s-key").value.trim(); saveSettings();
      $("s-msg").innerHTML = `<span class="spin"></span> 확인 중…`;
      try {
        const ms = await window.G.listModels();
        const has = ms.some((m) => m.id === s.model);
        $("s-msg").textContent = `연결됐습니다. 쓸 수 있는 모델 ${ms.length}개.` + (has ? ` 현재 모델(${s.model}) 사용 가능.` : ` 현재 모델(${s.model})이 목록에 없습니다. 모델 목록을 불러와 다른 모델을 고르세요.`);
      } catch (e) { $("s-msg").textContent = e.message; }
    });
    $("s-models").addEventListener("click", async () => {
      try {
        const ms = await window.G.listModels();
        $("s-model").innerHTML = ms.map((m) => opt(m.id, m.id, m.id === s.model)).join("") || opt(s.model, s.model, true);
        if (!ms.some((m) => m.id === s.model)) { const f = ms.find((m) => /flash/.test(m.id) && !/lite|image|tts|audio|live/.test(m.id)); if (f) $("s-model").value = f.id; }
        toast("목록을 불러왔습니다. 고른 뒤 위의 [저장]을 누르세요.");
      } catch (e) { toast(e.message, 4000); }
    });
    $("s-model").addEventListener("change", () => { s.model = $("s-model").value; saveSettings(); toast("모델을 바꿨습니다: " + s.model); });
    $("s-export").addEventListener("click", () => {
      const data = { app: "ohmstudy", version: 1, exportedAt: new Date().toISOString(), questions: [...A.qs.values()], attempts: A.attempts, plan: s.plan };
      window.U.download(`옴스터디-백업-${window.U.today()}.json`, JSON.stringify(data));
      s.lastBackup = Date.now(); saveSettings(); setTimeout(() => RENDER.settings(el), 300);
    });
    $("s-import").addEventListener("change", async () => {
      const f = $("s-import").files[0]; if (!f) return;
      try {
        const d = JSON.parse(await f.text());
        if (d.app !== "ohmstudy") throw new Error("옴스터디 백업 파일이 아닙니다.");
        const qs = (d.questions || []).filter((q) => q && q.id && q.question);
        const ats = (d.attempts || []).filter((a) => a && a.id && a.qid);
        const known = new Set(A.attempts.map((a) => a.id));
        const newAts = ats.filter((a) => !known.has(a.id));
        await saveQs(qs); await window.DB.putMany("attempts", newAts); A.attempts.push(...newAts);
        if (d.plan && !s.plan) { s.plan = d.plan; saveSettings(); }
        toast(`불러왔습니다: 문제 ${qs.length}개, 새 풀이 기록 ${newAts.length}개`, 4000);
        RENDER.settings(el);
      } catch (e) { toast("불러오지 못했습니다: " + e.message, 4000); }
    });
    $("s-seed").addEventListener("click", async () => { await saveQs(window.SEED.map((x) => Object.assign(makeQ({}), x))); toast("기본 문제를 다시 넣었습니다."); RENDER.settings(el); });
    armed($("s-reset"), async () => {
      await window.DB.clear("questions"); await window.DB.clear("attempts"); A.qs.clear(); A.attempts = [];
      toast("모두 지웠습니다."); RENDER.settings(el);
    }, "정말 모두 지울까요? 한 번 더 누르세요");
  };

  /* 도구 · 기출 변환 */
  RENDER.tools = (el) => window.Tools.render(el);
  RENDER.import = (el) => window.ImportView.render(el);

  /* =========================================================
     시작
     ========================================================= */
  window.App = { makeQ, saveQs, startPractice, renderCard, editQuestion, openDialog, closeDialog, armed, opt, opts, noKeyNotice, aiErr, qTags, go, get qs() { return A.qs; } };

  (async () => {
    await window.DB.open();
    const [qs, ats] = await Promise.all([window.DB.all("questions"), window.DB.all("attempts")]);
    qs.forEach((q) => A.qs.set(q.id, q)); A.attempts = ats;
    if (!A.settings.seeded) {
      await saveQs(window.SEED.map((x) => Object.assign(makeQ({}), x)));
      A.settings.seeded = true; saveSettings();
    }
    window.addEventListener("hashchange", route);
    route();
  })();
})();
