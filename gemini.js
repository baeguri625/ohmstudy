/* Gemini API 클라이언트. 브라우저에서 Google 서버로 직접 요청합니다(키는 이 브라우저에만 저장). */
window.G = (() => {
  "use strict";
  const BASE = "https://generativelanguage.googleapis.com/v1beta";

  class AIError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

  const STYLE = `[작성 규칙]
- 한국어로 씁니다. 독자는 전기공학 전공 학부생이며 기본 전공 용어는 압니다. 바로 핵심으로 들어가세요.
- 수식은 LaTeX로 $...$ 안에 씁니다. 예: $P=\\sqrt{3}V_LI_L\\cos\\theta$
- 계산은 중간값을 적고 모든 값에 단위를 붙입니다.
- 한국 전기기사·전기공사기사 시험의 용어와 관례(KEC, kVA, %임피던스 등)를 따릅니다.
- 확실하지 않은 내용은 확실하지 않다고 밝힙니다.`;

  const S = (type, extra) => Object.assign({ type }, extra || {});
  const STR = S("STRING"), INT = S("INTEGER"), BOOL = S("BOOLEAN");
  const ARR = (items) => S("ARRAY", { items });
  const OBJ = (properties, required) => S("OBJECT", { properties, required: required || Object.keys(properties) });

  const EXPLAIN = OBJ({
    short: STR, steps: ARR(STR), principle: STR, diagram_svg: STR,
    pitfalls: ARR(STR), related: ARR(STR), similar_question: STR, summary: STR
  }, ["short", "steps", "principle", "pitfalls", "related", "summary"]);

  const SUBJECT_ENUM = S("STRING", { enum: window.SUBJ.ALL });
  const TYPE_ENUM = S("STRING", { enum: ["mcq", "calc", "text"] });

  function settings() { return window.DB.getSettings(); }
  function hasKey() { return !!settings().apiKey; }

  async function request(path, init, retries = 2) {
    const s = settings();
    if (!s.apiKey) throw new AIError("Gemini API 키가 없습니다. 설정 메뉴에서 키를 입력하세요.", "no_key");
    let res;
    try {
      res = await fetch(BASE + path, Object.assign({}, init, { headers: Object.assign({ "Content-Type": "application/json", "x-goog-api-key": s.apiKey }, (init && init.headers) || {}) }));
    } catch (e) {
      throw new AIError("Gemini 서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.", "network");
    }
    if (res.status === 429 && retries > 0) {
      onWait && onWait(20);
      await window.U.sleep(20000);
      return request(path, init, retries - 1);
    }
    if (!res.ok) {
      let detail = ""; try { const j = await res.json(); detail = (j.error && j.error.message) || ""; } catch (e) { /* ignore */ }
      if (res.status === 429) throw new AIError("무료 사용량 한도에 걸렸습니다. 1분쯤 뒤에 다시 시도하세요. (하루 한도를 넘었다면 내일 다시 쓸 수 있습니다)", "rate");
      if (res.status === 400 && /API key/i.test(detail)) throw new AIError("API 키가 올바르지 않습니다. 설정에서 키를 다시 확인하세요.", "bad_key");
      if (res.status === 403) throw new AIError("이 키로는 Gemini를 쓸 권한이 없습니다. Google AI Studio에서 키를 다시 발급해 보세요.", "forbidden");
      if (res.status === 404) throw new AIError(`모델 '${s.model}'을 찾을 수 없습니다. 설정에서 [모델 목록 불러오기]로 다른 모델을 고르세요.`, "model");
      if (res.status >= 500) throw new AIError("Gemini 서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도하세요.", "server");
      throw new AIError("요청이 거절되었습니다: " + (detail || res.status), "http");
    }
    return res.json();
  }
  let onWait = null;
  function setWaitHandler(fn) { onWait = fn; }

  function parseJSON(text) {
    let t = (text || "").trim();
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    try { return JSON.parse(t); } catch (e) {
      const a = t.indexOf("{"), b = t.lastIndexOf("}");
      if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e2) { /* fallthrough */ } }
      throw new AIError("AI 응답을 해석하지 못했습니다. 다시 시도하세요.", "parse");
    }
  }

  // parts: [{text}] 또는 [{inlineData:{mimeType,data}}]
  async function generate(parts, { schema, temperature = 0.4 } = {}) {
    const s = settings();
    const body = {
      contents: [{ role: "user", parts }],
      generationConfig: Object.assign({ temperature }, schema ? { responseMimeType: "application/json", responseSchema: schema } : {})
    };
    const j = await request(`/models/${encodeURIComponent(s.model || "gemini-2.5-flash")}:generateContent`, { method: "POST", body: JSON.stringify(body) });
    if (j.promptFeedback && j.promptFeedback.blockReason) throw new AIError("요청 내용이 차단되었습니다: " + j.promptFeedback.blockReason, "blocked");
    const cand = (j.candidates || [])[0];
    const text = cand && cand.content && (cand.content.parts || []).map((p) => p.text || "").join("");
    if (!text) throw new AIError("AI가 빈 답을 보냈습니다" + (cand && cand.finishReason ? ` (${cand.finishReason})` : "") + ". 다시 시도하세요.", "empty");
    if (cand.finishReason === "MAX_TOKENS" && schema) throw new AIError("답이 너무 길어 중간에 잘렸습니다. 문제 수나 페이지 수를 줄여 다시 시도하세요.", "truncated");
    return schema ? parseJSON(text) : text;
  }

  async function listModels() {
    const j = await request("/models?pageSize=200", { method: "GET" });
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent") && /gemini/i.test(m.name))
      .map((m) => ({ id: m.name.replace(/^models\//, ""), label: m.displayName || m.name }));
  }

  /* ---- 문제 생성 ---- */
  async function generateQuestions({ exam, stage, subject, unit, difficulty, count, type }) {
    const typeRule = type === "mcq" ? "모두 객관식(mcq, 보기 4개)으로" : type === "calc" ? "모두 계산형(calc)으로" : (stage === "실기" ? "주로 계산형(calc), 일부 서술형(text)으로" : "주로 객관식(mcq)으로");
    const prompt = `당신은 한국 ${exam === "전공" ? "대학 전기공학과 전공" : exam} 시험 출제위원입니다.
다음 조건으로 새 문제 ${count}개를 만드세요. 기출문제를 그대로 베끼지 말고, 기출 유형과 난이도를 참고한 새 문제를 만드세요.
- 시험: ${exam} ${stage}
- 과목: ${subject}
- 단원: ${unit || "과목 전체에서 자주 출제되는 단원을 고루"}
- 난이도: ${difficulty}
- 유형: ${typeRule}

[필드 규칙]
- unit: 문제의 단원 이름 (짧게)
- type: mcq(객관식) / calc(답이 숫자+단위인 계산형) / text(서술형)
- question: 문제 본문. 필요한 수치와 조건을 모두 포함
- choices: mcq일 때 보기 4개 (번호 없이 내용만). 그 외에는 빈 배열
- answer_index: mcq 정답 번호 1~4. 그 외에는 0
- answer_display: calc는 "5.27 kW"처럼 숫자 하나와 단위만. text는 모범답안. mcq는 정답 보기 내용
- short: 핵심 풀이 2~4줄 (공식 → 대입 → 답)
정답은 반드시 직접 다시 계산해 검산한 뒤 쓰세요.

${STYLE}`;
    const schema = OBJ({ questions: ARR(OBJ({ unit: STR, type: TYPE_ENUM, question: STR, choices: ARR(STR), answer_index: INT, answer_display: STR, short: STR })) });
    const out = await generate([{ text: prompt }], { schema, temperature: 0.8 });
    return out.questions || [];
  }

  /* ---- 자세한 해설 ---- */
  function qAsText(q) {
    let t = `문제: ${q.question}\n`;
    if (q.type === "mcq" && q.choices) t += q.choices.map((c, i) => `${i + 1}) ${c}`).join("\n") + "\n";
    if (q.type === "mcq") t += `정답: ${q.answerIndex ? q.answerIndex + "번 " + (q.choices[q.answerIndex - 1] || "") : "(미정)"}\n`;
    else t += `정답: ${q.answerDisplay || "(미정)"}\n`;
    return t;
  }
  async function explain(q) {
    const prompt = `${q.subject}${q.unit ? " / " + q.unit : ""} 문제의 해설을 쓰세요.
${qAsText(q)}
[필드 규칙]
- short: 핵심 풀이 2~4줄 (공식 → 대입 → 답)
- steps: 단계별 풀이. 한 단계에 한 동작씩, 중간 계산값과 단위 포함
- principle: 왜 그 공식·원리가 성립하는지. 외우기보다 이해할 수 있게 3~6문장
- diagram_svg: 회로도·페이저도·전력삼각형·파형처럼 그림이 이해에 도움이 되면 간단한 SVG 한 개. 규칙: <svg viewBox="0 0 400 240">, 흰 배경 사각형, 선은 검정(#222)과 파랑(#1E5F8C), 글자는 font-size 13 이상, <script>·외부 링크 금지. 그림이 필요 없으면 빈 문자열
- pitfalls: 수험생이 자주 하는 실수·함정 2~4개
- related: 함께 보면 좋은 공식·개념 2~4개 (예: "역률 개선 콘덴서 용량 $Q_C=P(\\tan\\theta_1-\\tan\\theta_2)$")
- similar_question: 같은 원리의 변형 문제 하나와 그 답 (한두 줄)
- summary: 핵심 한 줄 요약
${q.answerSource === "ai" ? "주의: 위 정답은 AI가 추정한 것입니다. 풀이 결과가 다르면 steps 첫 줄에 '⚠ 표시된 정답과 다른 결과가 나왔습니다'라고 쓰고 올바른 풀이를 쓰세요.\n" : ""}
${STYLE}`;
    return generate([{ text: prompt }], { schema: EXPLAIN, temperature: 0.3 });
  }

  /* ---- 손풀이 사진 첨삭 ---- */
  async function checkWork(q, images, note) {
    const prompt = `학생이 아래 문제를 손으로 푼 풀이 사진을 올렸습니다. 첨삭하세요.
${qAsText(q)}
${note ? "학생 메모: " + note + "\n" : ""}
[필드 규칙]
- verdict: correct(풀이와 답 모두 맞음) / partial(방향은 맞지만 계산·단위 등 일부 오류) / wrong(틀림)
- wrong_step: 처음으로 틀린 단계를 사진 속 표현을 인용해 구체적으로 (모두 맞으면 빈 문자열)
- feedback: 고칠 점과 잘한 점 2~5개. 실기 채점 관점(단위, 유효숫자, 계산 과정 표기)도 포함
- corrected: 틀린 부분부터 이어지는 올바른 풀이 (맞으면 빈 문자열)
사진이 흐려 읽을 수 없는 부분은 읽을 수 없다고 말하세요.
${STYLE}`;
    const parts = [{ text: prompt }].concat(images.map((im) => ({ inlineData: { mimeType: im.mime, data: im.b64 } })));
    const schema = OBJ({ verdict: S("STRING", { enum: ["correct", "partial", "wrong"] }), wrong_step: STR, feedback: ARR(STR), corrected: STR });
    return generate(parts, { schema, temperature: 0.2 });
  }

  /* ---- 질문하기 (막힌 문제) ---- */
  async function ask(text, images, subjectHint) {
    const prompt = `학생이 막힌 문제를 보냈습니다(글 또는 사진). 문제를 정리하고 풀어 주세요.
${subjectHint ? "과목 힌트: " + subjectHint + "\n" : ""}학생 입력:
${text || "(사진 참고)"}

[필드 규칙]
- question: 문제 본문을 깔끔하게 정리 (사진이면 읽어서 옮김)
- type: mcq / calc / text
- choices: mcq 보기 (번호 없이). 아니면 빈 배열
- answer_index: mcq 정답 번호 1~4, 아니면 0
- answer_display: calc는 "숫자 단위", text는 모범답안, mcq는 정답 보기 내용
- subject, unit: 과목과 단원
- explanation: 해설. short(핵심 풀이), steps(단계별), principle(원리), diagram_svg(필요할 때만 간단한 SVG, viewBox 0 0 400 240, 흰 배경, 아니면 빈 문자열), pitfalls(자주 하는 실수), related(연결 개념), similar_question(변형 문제와 답), summary(한 줄 요약)
문제가 아닌 개념 질문이면 question에 질문을 쓰고 type은 text, answer_display에 요점을 쓰세요.
${STYLE}`;
    const parts = [{ text: prompt }].concat((images || []).map((im) => ({ inlineData: { mimeType: im.mime, data: im.b64 } })));
    const schema = OBJ({ question: STR, type: TYPE_ENUM, choices: ARR(STR), answer_index: INT, answer_display: STR, subject: SUBJECT_ENUM, unit: STR, explanation: EXPLAIN });
    return generate(parts, { schema, temperature: 0.3 });
  }

  /* ---- 기출 파일 변환 ---- */
  // pages: [{page, text} | {page, image:{mime,b64}}]
  function pageParts(pages) {
    const parts = [];
    pages.forEach((p) => {
      if (p.text) parts.push({ text: `\n[페이지 ${p.page} 시작]\n${p.text}\n[페이지 ${p.page} 끝]` });
      else { parts.push({ text: `\n[페이지 ${p.page} 이미지]` }); parts.push({ inlineData: { mimeType: p.image.mime, data: p.image.b64 } }); }
    });
    return parts;
  }
  async function answerKey(pages) {
    const prompt = `아래는 시험 문제 파일의 마지막 페이지들입니다. 여기에 '정답표'(문항 번호별 정답 목록)가 있으면 모두 옮겨 적으세요.
- found: 정답표가 있으면 true
- answers: [{number, answer}] answer는 객관식이면 1~4 숫자(①→1), 계산형이면 "숫자 단위"
- 과목별로 번호가 1부터 다시 시작하면 subject에 과목명을 쓰고, 아니면 빈 문자열
정답표가 없으면 found=false, answers=[]`;
    const schema = OBJ({ found: BOOL, answers: ARR(OBJ({ number: INT, subject: STR, answer: STR }, ["number", "answer"])) });
    return generate([{ text: prompt }].concat(pageParts(pages)), { schema, temperature: 0 });
  }
  async function extract(pages, meta) {
    const prompt = `아래는 ${meta.exam} ${meta.stage} 기출문제 파일의 일부 페이지입니다. 문제를 하나씩 정확히 옮겨 적으세요.
[규칙]
- 문제 본문과 보기는 원문 그대로 옮깁니다. 수식은 LaTeX($...$)로 바꿉니다. 내용을 바꾸거나 요약하지 마세요.
- number: 문항 번호, page: 문제가 있는 페이지 번호
- subject: 과목 (파일의 과목 표시를 따르고, 없으면 내용으로 판단), unit: 단원 (짧게)
- type: mcq(객관식) / calc(답이 숫자+단위) / text(서술형)
- choices: 객관식 보기 4개 (①②③④ 기호 없이 내용만)
- doc_answer: 이 페이지들 안에 그 문제의 정답이 적혀 있으면 그대로 (객관식은 1~4 숫자). 없으면 빈 문자열
- ai_answer_index / ai_answer_display: 직접 풀어서 구한 정답 (객관식은 번호 1~4, 계산형은 "숫자 단위", 서술형은 모범답안 요약). 객관식이 아니면 ai_answer_index=0
- short: 핵심 풀이 2~4줄. 파일에 해설이 있으면 그것을 바탕으로 정리
- needs_figure: 그림·회로도를 봐야 풀 수 있는 문제면 true (그림의 핵심 정보는 question 끝에 [그림: ...]으로 글로 설명)
- confidence: 글자를 확실히 읽었고 정답도 확실하면 high, 흐리거나 애매하면 low
- cut_off: 문제가 페이지 끝에서 잘려 일부만 보이면 true
- 표지, 안내문, 정답표만 있는 페이지는 건너뜁니다.
${STYLE}`;
    const item = OBJ({
      number: INT, page: INT, subject: SUBJECT_ENUM, unit: STR, type: TYPE_ENUM, question: STR, choices: ARR(STR),
      doc_answer: STR, ai_answer_index: INT, ai_answer_display: STR, short: STR, needs_figure: BOOL, confidence: S("STRING", { enum: ["high", "low"] }), cut_off: BOOL
    });
    const out = await generate([{ text: prompt }].concat(pageParts(pages)), { schema: OBJ({ questions: ARR(item) }), temperature: 0.1 });
    return out.questions || [];
  }

  return { AIError, hasKey, generate, listModels, generateQuestions, explain, checkWork, ask, answerKey, extract, setWaitHandler };
})();
