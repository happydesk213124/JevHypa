//@name jevhypa
//@display-name JevHypa
//@api 3.0
//@version 1.1.0
//@update-url https://raw.githubusercontent.com/happydesk213124/JevHypa/main/jevhypa.js
//@arg jev_api_key string (선택) OpenRouter API 키. 🧠 JevHypa 화면의 시작 안내에서 넣어도 됩니다.

// ============================================================================
// JevHypa — 대단원 › 장면 › 사건 메모로 쌓는 장기기억 (텍스트 생성 모델 없이)
//
//  쓰기 (응답이 끝난 뒤 백그라운드)
//    ① 정규식: 대사 줄 화자, 상태줄 날짜·시간·장소, 자기소개 별명
//    ② Jev 호출 A: 메시지마다 "장면이 바뀌었나/대단원이 바뀌었나", 시간 흐름,
//                  문장마다 "어떤 기억인가(버림/관계/약속/비밀…)", 처음 보는 단어의 종류
//    ③ 장면마다 상위 몇 개만 "사건 메모"로 남긴다 (나머지는 버림 → 쓸모없는 기억이 쌓이지 않음)
//    ④ 임베딩: 남긴 메모만 벡터로
//    ⑤ Jev 호출 B: 메모 주인공, 옛 메모와 충돌·반복 검사, 단어 고르기 압축
//    ⑥ 대단원 카드: 등장인물·장소·키워드·대표 벡터를 코드로 갱신
//
//  읽기 (요청 직전, Jev 1회)
//    현재 챗 → 임베딩으로 대단원 후보 → 그 안의 사건 메모 후보 → Jev 한 번에
//    "어느 대단원?"(choice) + "이 메모 필요해?"(noul) → 인물별로 묶어 최신 입력에 주입
//    메모는 Jev가 원문에서 단어만 골라 만든 것이라 어색할 수 있다고 메인 모델에게 알려 준다.
// ============================================================================

(async () => {
  'use strict';

  const R = globalThis.risuai ?? globalThis.Risuai;
  const LOG = '[JevHypa]';
  const STORE = 'jm2_';
  const SETTINGS_KEY = 'jm2_settings';
  const PLACEHOLDER = /\[(?:jevhypa|jevmemory)\]/gi;
  const WORLD = '세계관';

  // ── 프로바이더 ──────────────────────────────────────────────────────────

  const JEV_PRESETS = {
    openrouter: {
      label: 'OpenRouter', badge: '추천', desc: 'OpenRouter 키 하나로 Jev와 임베딩을 같이 써요.', endpoint: 'https://openrouter.ai/api/v1/systemone', model: 'typesafe/jev-1.14', keyHint: 'sk-or-v1-…', keyUrl: 'https://openrouter.ai/keys',
      models: [
        { id: 'typesafe/jev-1.14', label: 'Jev 1.14' },
        { id: '~typesafe/jev-latest', label: 'Jev 최신 (새 버전 나오면 자동으로 바뀜)' },
        { id: 'typesafe/jev-1.13', label: 'Jev 1.13 (이전 버전)' },
      ],
    },
    typesafe: {
      label: 'TypeSafe 직결', desc: 'TypeSafe 콘솔에서 받은 키를 써요.', endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest', keyHint: 'TypeSafe API 키', keyUrl: 'https://console.typesafe.ai',
      models: [
        { id: 'jev-latest', label: 'Jev 최신 (새 버전 나오면 자동으로 바뀜)' },
        { id: 'jev-1.14.0', label: 'Jev 1.14' },
        { id: 'jev-1.13.0', label: 'Jev 1.13 (이전 버전)' },
        { id: 'jev-preview', label: 'Jev 미리보기 (실험용)' },
      ],
    },
    custom: { label: '직접 입력', desc: 'System One 형식을 받는 다른 주소.', endpoint: '', model: '', keyHint: 'API 키', models: [] },
  };

  const EMBED_PRESETS = {
    openrouter: { label: 'OpenRouter', badge: 'Jev와 같은 키', desc: '키를 따로 넣을 필요가 없어요. 아주 싸요.', format: 'openai', endpoint: 'https://openrouter.ai/api/v1/embeddings', model: 'openai/text-embedding-3-small', models: ['openai/text-embedding-3-small', 'openai/text-embedding-3-large', 'qwen/qwen3-embedding-0.6b'], key: 'jev', mrl: true },
    local: { label: '무료 · API 없음', badge: '설정 없음', desc: '글자 조각으로 비슷한 정도를 계산해요. 표현이 많이 다르면 놓쳐요.', format: 'local', key: 'none' },
    openai: { label: 'OpenAI', desc: 'OpenAI 키를 써요.', format: 'openai', endpoint: 'https://api.openai.com/v1/embeddings', model: 'text-embedding-3-small', models: ['text-embedding-3-small', 'text-embedding-3-large'], key: 'own', mrl: true, keyUrl: 'https://platform.openai.com/api-keys' },
    gemini: { label: 'Google Gemini', desc: '무료 한도가 넉넉해요.', format: 'gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-embedding-001', models: ['gemini-embedding-001'], key: 'own', mrl: true, keyUrl: 'https://aistudio.google.com/apikey' },
    voyage: { label: 'Voyage AI', desc: '검색 품질이 좋은 편이에요.', format: 'openai', endpoint: 'https://api.voyageai.com/v1/embeddings', model: 'voyage-4-lite', models: ['voyage-4-lite', 'voyage-4', 'voyage-4-large'], key: 'own', keyUrl: 'https://dashboard.voyageai.com' },
    jina: { label: 'Jina AI', desc: '다국어에 강해요.', format: 'openai', endpoint: 'https://api.jina.ai/v1/embeddings', model: 'jina-embeddings-v3', models: ['jina-embeddings-v3'], key: 'own', keyUrl: 'https://jina.ai/api-dashboard' },
    ollama: { label: 'Ollama', badge: '내 컴퓨터', desc: '내 컴퓨터에서 돌려요. 무료.', format: 'ollama', endpoint: 'http://localhost:11434', model: 'bge-m3', models: ['bge-m3', 'nomic-embed-text', 'mxbai-embed-large'], key: 'none' },
    lmstudio: { label: 'LM Studio', badge: '내 컴퓨터', desc: '내 컴퓨터에서 돌려요. 무료.', format: 'openai', endpoint: 'http://localhost:1234/v1/embeddings', model: 'text-embedding-bge-m3', key: 'none' },
    custom: { label: '직접 입력', desc: 'OpenAI 형식(/embeddings)을 받는 주소.', format: 'openai', endpoint: '', model: '', key: 'own' },
  };

  const MODES = {
    save: { label: '절약', desc: '원문을 적게 남기고 메모도 짧게. 토큰이 가장 적어요.', rawBudget: 3000, minRaw: 4, recallBudget: 700, eventsPerScene: 2, candidates: 16, arcs: 2 },
    balanced: { label: '균형', badge: '추천', desc: '대부분의 롤플에 맞는 기본값.', rawBudget: 6000, minRaw: 6, recallBudget: 1200, eventsPerScene: 4, candidates: 24, arcs: 3 },
    quality: { label: '품질', desc: '원문을 많이 남기고 메모도 넉넉히. 토큰이 더 들어요.', rawBudget: 12000, minRaw: 10, recallBudget: 2000, eventsPerScene: 6, candidates: 40, arcs: 4 },
  };
  const MODE_KEYS = ['rawBudget', 'minRaw', 'recallBudget', 'eventsPerScene', 'candidates', 'arcs'];

  // 메인 모델에게 하는 안내. 영어가 토큰이 적게 든다(한국어 문장의 약 1/3).
  const DEFAULT_NOTE = 'Auto-extracted notes from earlier chat; words were picked, so grammar may be choppy. Infer the meaning. If they conflict with the current chat, the current chat wins.';
  // 예전 기본값(한국어)이 저장돼 있으면 새 기본값으로 바꾼다. 직접 고친 문구는 그대로 둔다.
  const OLD_DEFAULT_NOTE = '아래는 JevMemory가 지난 대화 원문에서 단어만 골라 만든 메모입니다. 문법이 어색하거나 끊겨 있을 수 있으니 뜻을 추론해서 참고하세요. 지금 대화와 다르면 지금 대화가 우선입니다.';

  const DEFAULT_SETTINGS = {
    enabled: true,
    onboarded: false,
    // 주소·모델은 비워 두면 고른 프리셋 값으로 채워진다(sanitizeSettings)
    jevPreset: 'openrouter', jevKey: '', jevEndpoint: '', jevModel: '',
    embedPreset: 'openrouter', embedKey: '', embedEndpoint: '', embedModel: '', embedDims: 512,
    mode: 'balanced', ...Object.fromEntries(MODE_KEYS.map(k => [k, MODES.balanced[k]])),
    recallThreshold: 50, saveThreshold: 55,
    parseSpeakers: true, parseStatus: true, classifyWords: true, compress: true, supersede: true,
    rejAutoClear: false, rejClearEvery: 100,
    injectMode: 'last_user', injectStyle: 'memo', injectLabel: 'Memory', note: DEFAULT_NOTE, showStoryTime: true,
    cards: true,
    translate: 'off', translateKey: '', translateModel: 'google/gemini-2.5-flash-lite',
    showButton: true,
  };

  // ── 상수 ──
  const MAX_STATE_CHARS = 9000;          // Jev는 state가 32KB를 넘으면 long-context 모드(느리고 부정확)
  const MAX_QUESTIONS = 120;
  const SETTLE = 2;                      // 최근 2개(리롤될 수 있는 것)는 저장하지 않는다
  const SYNC_BATCHES = 2;
  const BACKGROUND_BATCHES = 4;
  const MAX_EVENTS = 3000;
  const MAX_SEEN = 8000;
  const JEV_TIMEOUT_MS = 15000;
  const EMBED_TIMEOUT_MS = 15000;
  const EMBED_CHUNK = 64;
  const LOCAL_DIMS = 384;
  const SUPERSEDE_P = 0.7;
  const DUPLICATE_P = 0.8;
  const DIVERSITY_DICE = 0.6;
  const CORE_FACTOR = 0.6;
  const COMPRESS_MIN_CHARS = 25;
  const COMPRESS_DELETE_P = 0.7;
  const COMPRESS_MAX_RATIO = 0.7;
  const MAX_COMPRESS_QUESTIONS = 70;
  const MAX_WORD_QUESTIONS = 20;
  const SPEAKER_ACTIVE_COUNT = 2;
  const QUERY_MESSAGES = 6;
  const SECOND_SEARCH = 6;            // 빠진 근거를 찾을 때 더 볼 메모 수
  const RECALL_STATE_CHARS = 6000;    // 회상 판정 때 Jev에 보내는 최근 대화 (최신 메시지가 끝에 온다)           // 회상할 때 "지금 장면"으로 보는 최근 메시지 수

  const KINDS = {
    profile: { label: '인물정보', desc: 'lasting fact about a character (identity, past, personality, job)' },
    look: { label: '외형', desc: 'lasting appearance (hair, eyes, body, scars, tattoos)' },
    outfit: { label: '옷·상태', desc: 'what someone is wearing now, or their current condition (injured, wet, undressed)' },
    relation: { label: '관계', desc: 'feelings or relationship between characters, or its change' },
    event: { label: '사건', desc: 'plot event, decision, conflict, consequence' },
    promise: { label: '약속', desc: 'promise, plan, deal, goal for the future' },
    secret: { label: '비밀', desc: 'secret, confession, lie, hidden truth' },
    item: { label: '물건', desc: 'important object gained, lost, given, or special' },
    world: { label: '세계관', desc: 'world rules, places, groups, history, creatures' },
  };
  const KIND_IDS = Object.keys(KINDS);
  const CORE_KINDS = new Set(['profile', 'look', 'outfit', 'relation', 'secret', 'promise']);
  const KIND_OPTIONS = {
    trivial: 'filler, scenery, small talk, momentary reaction',
    minor: 'small detail, will not matter later',
    ...Object.fromEntries(KIND_IDS.map(k => [k, KINDS[k].desc])),
  };
  // 카드 칸: 메모가 어떤 종류의 말·사실인지, 지금도 유효한지
  const FORMS = {
    did: 'something that happened or someone did',
    said: 'what a character said, told, or explained',
    rule: 'a rule, condition, signal, or instruction',
    state: 'a fact or current state (where, what, who, how much)',
    plan: 'a plan, promise, or intention',
    rumor: 'an unverified rumor or claim',
    thought: 'a private thought or feeling',
  };
  const FORM_TAG = { said: 'said', rule: 'rule', plan: 'plan', rumor: 'unverified', thought: 'thought' };
  const TENSES = {
    current: 'still true or in effect now',
    past: 'a past record, or replaced by newer information',
    future: 'scheduled or planned',
  };
  const KEEP_IMP = 0.8; // 이만큼 중요한 메모는 장면 상한을 넘어도 상한만큼 더 남긴다
  const RANK_LEVELS = ['unrelated', 'background only', 'useful context', 'answers or explains the latest message']; // 후보마다 붙으니 짧게
  const SEARCH_NEEDS = {
    none: 'nothing important is missing',
    fact: 'a specific earlier fact the latest message asks about (name, number, place, wording)',
    cause: 'the earlier promise, instruction, or motive behind the current action',
    change: 'a later update or correction to a recorded state or plan',
    knowledge: 'who learned, heard, or believes the information',
  };
  const NEED_QUERY = { fact: 'earlier record of', cause: 'earlier reason or promise behind', change: 'latest update or correction about', knowledge: 'who knows or told about' };
  const TRANSLATORS = { off: '끄기', deepl: 'DeepL', llm: 'LLM (OpenRouter)', google: '구글 무료 (비공식)' };
  const TRANSLATE_TIMEOUT_MS = 8000;

  const ENTITY_TYPES = {
    person: { label: '인물', desc: 'name of a person or character' },
    place: { label: '장소', desc: 'name of a specific place' },
    item: { label: '물건', desc: 'specific important object' },
    other: { label: '기타', desc: 'common word, fragment, or anything else' },
  };
  const BOUNDARY = {
    continue: 'same scene continues',
    scene: 'new scene, same storyline',
    arc: 'new chapter: big time skip, new stage, or new main goal',
    flashback: 'flashback or dream',
  };
  const TIME_FLOWS = {
    same: 'no time passed',
    hours: 'later the same day',
    next_day: 'next day',
    days: 'a few days later',
    weeks: 'weeks or more later',
  };

  const stats = { jevCalls: 0, jevTokens: 0, embedCalls: 0, lastError: '', lastErrorAt: 0 };

  // ── 유틸 ────────────────────────────────────────────────────────────────

  function hashText(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  function estimateTokens(text) {
    let t = 0;
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      if (c >= 0xac00 && c <= 0xd7af) t += 0.8;
      else if (c >= 0x3040 && c <= 0x9fff) t += 0.9;
      else t += 0.25;
    }
    return Math.ceil(t);
  }

  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function contentOf(message) {
    const c = message?.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(p => (typeof p === 'string' ? p : p?.text ?? '')).join('\n');
    return '';
  }

  function cleanText(text) {
    return String(text ?? '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|li|tr|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\{\{[^}]*\}\}/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  /**
   * 응답에 섞인 모델의 생각·계획·지시문을 뺀다(메모로 남지 않게).
   * <thinking>…</thinking> 같은 블록, [OOC …], "# 응답" 같은 제목, 한국어 이야기 속 영어 지시문 줄.
   */
  const META_BLOCK = /<(thinking|think|thoughts?|reasoning|scratchpad|plan|planning|ooc|analysis|reflection)\b[^>]*>[\s\S]*?<\/\1>/gi;
  function stripMeta(text) {
    const t = String(text ?? '').replace(META_BLOCK, ' ')
      .replace(/\[(?:OOC|ooc|System|SYSTEM|Note|NOTE|Director|DIRECTOR)[^\]]*\]/g, ' ')
      .replace(/\((?:OOC|ooc)[^)]*\)/g, ' ');
    const hangul = (x) => { const h = (x.match(/[가-힣]/g) || []).length; const l = (x.match(/[A-Za-z]/g) || []).length; return h / Math.max(1, h + l); };
    const hc = (t.match(/[가-힣]/g) || []).length;
    const korean = hangul(t) > 0.4 || (hc >= 40 && hangul(t) > 0.2); // 한국어 이야기일 때만 영어 지시문 줄을 뺀다(영어 봇은 건드리지 않음)
    return t.split('\n').filter(line => {
      const x = line.trim();
      if (!x) return true;
      if (/^#{1,6}\s/.test(x)) return false;                                    // 마크다운 제목
      if (/^(?:\d+[.)]|[-*•])\s*[A-Za-z]/.test(x) && korean) return false;         // 영어 계획 목록
      if (korean && hangul(x) < 0.2 && /[A-Za-z]{3,}/.test(x) && x.split(/\s+/).length >= 4) return false; // 이야기 속 영어 지시문
      return true;
    }).join('\n');
  }

  function bigrams(text) {
    const s = text.toLowerCase().replace(/[^0-9a-z぀-鿿가-힯]/g, '');
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  }

  function dice(a, b) {
    if (!a.size || !b.size) return 0;
    let n = 0;
    for (const g of a) if (b.has(g)) n++;
    return (2 * n) / (a.size + b.size);
  }

  function coverage(memGrams, queryGrams) {
    if (!memGrams.size) return 0;
    let n = 0;
    for (const g of memGrams) if (queryGrams.has(g)) n++;
    return n / memGrams.size;
  }

  function clampNum(v, fallback, min, max) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return `${s}초 전`;
    if (s < 3600) return `${Math.round(s / 60)}분 전`;
    if (s < 86400) return `${Math.round(s / 3600)}시간 전`;
    return `${Math.round(s / 86400)}일 전`;
  }

  function setError(where, error) {
    stats.lastError = `${where}: ${String(error?.message ?? error)}`;
    stats.lastErrorAt = Date.now();
    console.error(LOG, where, error);
  }

  // ── 날짜 ──

  function dateToDays(d) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? '');
    return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : NaN;
  }
  function daysToDate(n) {
    const dt = new Date(n * 86400000);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  }
  const addDays = (d, n) => (Number.isFinite(dateToDays(d)) ? daysToDate(dateToDays(d) + n) : d);
  function toMinutes(t) {
    const m = /^(\d{2}):(\d{2})$/.exec(t ?? '');
    return m ? +m[1] * 60 + +m[2] : NaN;
  }
  /** 실제 날짜가 있으면 날짜로, 없으면 "N일차"로 (상태줄 없는 봇도 시간 순서를 가진다). */
  /** 모델에 넣는 날짜 표시(영어, 짧게): 04-03 09:15 / Day 3 */
  function whenTag(w) {
    if (!w || (!w.d && !w.t && !w.day)) return '';
    const d = w.d ? w.d.slice(5) : (w.day ? `Day ${w.day}` : '');
    return `${w.approx ? '~' : ''}${[d, w.t].filter(Boolean).join(' ')}`;
  }

  function formatWhen(w, withYear = false) {
    if (!w || (!w.d && !w.t && !w.day)) return '';
    const d = w.d ? (withYear ? w.d : w.d.slice(5)) : (w.day ? `${w.day}일차` : '');
    return `${w.approx ? '~' : ''}${[d, w.t].filter(Boolean).join(' ')}`;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  ① 정규식 추출
  // ══════════════════════════════════════════════════════════════════════

  const SPEAKER_LINE = /^[ \t]*(?:[-*•>]+[ \t]*)?(?:\*\*|__)?([가-힣A-Za-z][가-힣A-Za-z0-9·._ -]{0,14}?)(?:\*\*|__)?[ \t]*(?:\(([^)\n]{1,20})\))?[ \t]*(?:\*\*|__)?[ \t]*[:：][ \t]*(["“”'‘’「『][\s\S]*)$/u;
  const SPEAKER_STOP = new Set([
    '시간', '장소', '날짜', '위치', '상태', '메모', '참고', '시스템', '나레이션', '해설', '날씨', '요일', '현재', '목표', '퀘스트',
    'narrator', 'narration', 'ooc', 'system', 'note', 'time', 'date', 'location', 'status',
  ]);
  const PRONOUN_START = /^(그|그녀|그는|그가|그녀는|그녀가|그들|이|저|나|너|우리|당신)(\s|$)/u;

  function validSpeakerName(name) {
    if (!name || name.length > 15) return false;
    if (SPEAKER_STOP.has(name.toLowerCase())) return false;
    if (/\s/.test(name) && (PRONOUN_START.test(name) || /다$/.test(name))) return false;
    if (/^(he|she|they|i|we|you|it|his|her|their)\b/i.test(name) || /\b(says|said|asks|asked|replies|replied|whispers|whispered|shouts|shouted|adds|added|continues|continued|mutters|muttered)$/i.test(name)) return false;
    return !/^[\d\s]+$/.test(name);
  }

  function parseSpeakerLine(line) {
    const m = SPEAKER_LINE.exec(line);
    if (!m) return null;
    const name = m[1].trim();
    return validSpeakerName(name) ? { name, tone: m[2]?.trim() ?? null, quote: m[3].trim() } : null;
  }

  const DATE_RE = /(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?(?:\s*\(([월화수목금토일])\))?/u;
  const TIME_RE = /(?:^|[^\d])(\d{1,2})\s*:\s*(\d{2})(?!\d)/u;
  const AMPM_RE = /(오전|오후|AM|PM|am|pm)\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/u;
  const WEATHER_WORD = /^(?:[\p{Extended_Pictographic}️]\s*)*(맑음|화창|쾌청|흐림|흐린|비|소나기|폭우|이슬비|눈|폭설|진눈깨비|안개|천둥|번개|뇌우|우박|황사|태풍|바람|강풍|구름\s*조금|구름\s*많음|sunny|clear|cloudy|rain|rainy|snow|snowy|fog|foggy|storm|windy)(?:\s*[\d.]+\s*°?C?)?$/iu;
  const STATUS_SEP = /[◆◇■□●○|│¦/·•]/u;
  const PLACE_LABEL = /(?:^|[\s\[|◆])(?:장소|위치|📍)\s*[:：]?\s*([^\n◆|│\]]{2,24})/u;

  const STATUS_TITLE = /status|window|상태창|정보창|스테이터스|^info/i;

  function parseStatus(text) {
    const lines = text.split('\n');
    const out = { d: null, t: null, weather: null, place: null, lines: new Set() };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.length > 160) continue;
      const date = DATE_RE.exec(line);
      const time = TIME_RE.exec(line);
      const ampm = AMPM_RE.exec(line);
      const label = PLACE_LABEL.exec(line);
      const hasSep = STATUS_SEP.test(line.replace(DATE_RE, ''));
      const isStatus = !!date || ((time || ampm) && hasSep) || (label && hasSep);
      if (!isStatus) {
        if (label && !out.place && line.length < 40) { out.place = label[1].trim(); out.lines.add(i); }
        continue;
      }
      out.lines.add(i);
      if (date && !out.d) out.d = `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`;
      if (!out.t) {
        if (ampm) {
          let h = +ampm[2] % 12;
          if (/오후|pm/i.test(ampm[1])) h += 12;
          out.t = `${String(h).padStart(2, '0')}:${String(ampm[3] ?? '0').padStart(2, '0')}`;
        } else if (time && +time[1] < 24 && +time[2] < 60) {
          out.t = `${time[1].padStart(2, '0')}:${time[2]}`;
        }
      }
      if (label && !out.place) out.place = label[1].trim();
      for (const raw of line.replace(/^\[|\]$/g, '').split(STATUS_SEP)) {
        const seg = raw.trim();
        if (!seg) continue;
        if (!out.weather && WEATHER_WORD.test(seg)) { out.weather = WEATHER_WORD.exec(seg)[1]; continue; }
        if (out.place || /\d/.test(seg) || seg.length < 2 || seg.length > 20) continue;
        if (/^\(?[월화수목금토일]\)?(요일)?$/.test(seg) || /^(장소|위치|날씨|시간)\s*[:：]/.test(seg)) continue;
        if (STATUS_TITLE.test(seg)) continue;
        out.place = seg.replace(/^[\p{Extended_Pictographic}️\s]+/u, '').trim() || null;
      }
    }
    if (out.place) out.place = clip(out.place.replace(/[\]\)]+$/, '').trim(), 20);
    return out;
  }

  const DANGLING_START = /^["'「『(]?\s*(?:그것|이것|저것|그곳|이곳|거기|그건|이건|그는|그녀|그가|그의|그를|그에게|그들|이는|그래서|그러나|하지만|그러자|그런데|(?:It|He|She|They|This|That|There|Then|But|His|Her|Their)\b)/u;

  function splitSentences(text) {
    const out = [];
    for (const line of text.split('\n')) {
      for (let part of line.split(/(?<=[.!?。！？…~](?:["'」』”’)\]]+)?)\s+/u)) {
        part = part.trim();
        if (!part) continue;
        if (out.length && part.length < 12 && out[out.length - 1].length < 240) out[out.length - 1] += ' ' + part;
        else out.push(part);
      }
    }
    const kept = out.filter(s => s.replace(/[^0-9a-zA-Z぀-鿿가-힯]/g, '').length >= 6);
    // "그것은 ~였다"처럼 앞 문장 없이는 뜻이 사라지는 문장은 앞 문장과 합친다.
    const merged = [];
    for (const s of kept) {
      if (merged.length && DANGLING_START.test(s) && merged[merged.length - 1].length + s.length < 280) merged[merged.length - 1] += ` ${s}`;
      else merged.push(s);
    }
    return merged.map(s => clip(s, 280));
  }

  function stripQuotes(q) {
    return q.replace(/\s+/g, ' ').trim().replace(/^["“”'‘’「『]+/u, '').replace(/["“”'‘’」』]+$/u, '').trim();
  }

  const FIRST_PERSON = /(?:^|[\s"“'‘「『(])(?:나는|난|저는|전|나야|저예요|내가|제가|내\s*이름|제\s*이름)/u;
  const INTRO_PATTERNS = [
    /(?:내|제)\s*이름은\s*([가-힣A-Za-z]{2,10}?)(?:이야|야|입니다|이에요|예요|이고|고|이라고|라고|이)?(?=[\s.,!?~…]|$)/u,
    /(?:^|\s)([가-힣A-Za-z]{2,10}?)(?:이)?라고\s*(?:해|합니다|해요|하지|하는|불러|부르면|부르세요)/u,
    /\b(?:I'm|I am|my name is|My name is|call me|Call me|name's)\s+([A-Z][a-zA-Z]{1,15})\b/u,
  ];

  function findIntros(speaker, body) {
    const out = [];
    for (const sentence of splitSentences(body)) {
      if (!FIRST_PERSON.test(sentence) && !/\b(I'm|I am|my name|call me|name's)\b/i.test(sentence)) continue;
      for (const re of INTRO_PATTERNS) {
        const name = re.exec(sentence)?.[1];
        if (!name || name === speaker || !validSpeakerName(name) || WORD_STOP.has(name)) continue;
        out.push({ from: speaker, to: name, quote: clip(sentence, 80) });
        break;
      }
    }
    return out;
  }

  // 대사는 짧은 문장끼리 이 길이까지 묶는다. "규칙이 하나 있어. 해가 지면 숲에 가지 마."처럼 뒷문장만으로는 뜻이 안 남는 경우가 많다.
  const QUOTE_UNIT = 90;
  function packSentences(list, max) {
    const out = [];
    for (const s of list) {
      if (out.length && out[out.length - 1].length + 1 + s.length <= max) out[out.length - 1] += ' ' + s;
      else out.push(s);
    }
    return out;
  }

  /** 메시지 하나 → { 상태줄 정보, 기억 후보 문장들, 화자들, 자기소개 } */
  function analyzeEntry(text, cfg) {
    const clean = cleanText(stripMeta(text));
    const status = cfg.parseStatus ? parseStatus(clean) : { lines: new Set() };
    const units = [];
    const speakers = new Set();
    const intros = [];
    let narrative = [];
    const flush = () => {
      if (!narrative.length) return;
      for (const s of splitSentences(narrative.join('\n'))) units.push({ text: s, speaker: null });
      narrative = [];
    };
    clean.split('\n').forEach((line, i) => {
      if (status.lines.has(i)) return;
      const sp = cfg.parseSpeakers ? parseSpeakerLine(line) : null;
      if (!sp) { narrative.push(line); return; }
      flush();
      speakers.add(sp.name);
      const body = stripQuotes(sp.quote);
      for (const s of packSentences(splitSentences(body), QUOTE_UNIT)) units.push({ text: `${sp.name}: "${s}"`, speaker: sp.name });
      intros.push(...findIntros(sp.name, body));
    });
    flush();
    units.forEach((u, i) => { if (i) u.prev = clip(units[i - 1].text, 90); });
    return { status, units: pickUnits(units, cfg), speakers: [...speakers], intros };
  }

  // 장면당 남기는 메모는 몇 개뿐이라, 메시지마다 가능성 높은 문장만 Jev에게 묻는다(토큰 절약).
  const SIGNAL = /(약속|맹세|비밀|고백|사실은|정체|사랑|좋아해|싫어|미워|배신|죽|다쳤|상처|잃어|얻었|선물|반지|열쇠|계약|빚|결혼|이별|헤어|처음|이름|기억|규칙|금지|입고|입은|입었|걸치|벗|옷|셔츠|치마|바지|드레스|교복|정장|잠옷|속옷|원피스|코트|외투|신발|맨발|모자|안경|머리카락|머리칼|단발|장발|눈동자|흉터|문신|피투성이|젖은|찢어|promise|secret|love|hate|betray|swear|die|dead|name|wearing|wore|dress|shirt|hair|eyes|scar|tattoo)/iu;
  function unitScore(u) {
    const f = findEntities(u.text);
    return Math.min(2, f.person.length) * 1.5 + (f.place.length || f.item.length ? 1 : 0) + (u.speaker ? 0.8 : 0) +
      (SIGNAL.test(u.text) ? 2 : 0) + Math.min(1, u.text.length / 120) - (u.text.length > 220 ? 1 : 0); // 너무 긴 묘사 문장은 덜
  }
  // 서술 문장의 주어: 앞쪽 몇 어절 안의 "○○은/는/이/가". 1인칭 서술(나는, 내 …)은 유저 캐릭터.
  const SUBJ_TOKEN = /^([가-힣]{2,6}|[A-Z][a-zA-Z]{1,15})(은|는|이|가)$/u;
  const NARRATOR_I = /(?:^|[\s"“(])(?:나는|내가|나를|나의|나도|나에게|나한테|내|날)(?=\s)/u;
  function subjectOf(text) {
    if (/^[^:"“]{1,15}:\s/.test(text)) return null; // 대사 줄은 화자가 있다
    for (const tok of text.replace(/^[\s"“'‘(\[]+/u, '').split(/\s+/).slice(0, 4)) {
      const m = SUBJ_TOKEN.exec(tok.replace(/[,.!?…~]+$/u, ''));
      if (m && !WORD_STOP.has(m[1]) && !EN_STOP.has(m[1])) return m[1];
    }
    return null;
  }

  function pickUnits(units, cfg) {
    const k = Math.max(4, (cfg.eventsPerScene ?? 4) + 2);
    if (units.length <= k) return units;
    return units.map((u, i) => ({ u, i, s: unitScore(u) })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, k).sort((a, b) => a.i - b.i).map(x => x.u);
  }

  // ── 단어 후보 ──

  const PARTICLE = /(에게서|한테서|으로부터|로부터|에게|한테|에서|으로|부터|까지|처럼|보다|이랑|하고|께서|은|는|이|가|을|를|의|에|로|와|과|도|만|랑|께)$/u;
  const COPULA = /(이었다|였다|이잖아|잖아|이었어|였어|이야|이에요|예요|이다|이라고|라고|이라는|라는|이란|란|이지|이네|이군)$/u;
  const VERBISH = /(다|요|죠|지|네|까|고|며|서|면|게|던|데|았|었|했|겠|자|라|냐|니|군|어|아|여|해|된|한|운|는|인|을|은)$/u;
  const WORD_STOP = new Set([
    '너', '나', '내', '네', '그', '그녀', '이', '저', '것', '거', '수', '좀', '잠깐', '잠깐만', '어라', '아까', '정말', '그냥', '같이', '다시', '지금',
    '오늘', '내일', '어제', '여기', '거기', '저기', '이곳', '그곳', '우리', '너희', '당신', '자신', '서로', '모두', '사람', '생각', '마음', '목소리',
    '얼굴', '눈', '손', '말', '때', '곳', '뒤', '앞', '안', '밖', '위', '아래', '옆', '순간', '정도', '처음', '마지막', '다음', '하나', '조금',
  ]);
  const EN_STOP = new Set([
    'The', 'A', 'An', 'He', 'She', 'It', 'They', 'I', 'You', 'We', 'His', 'Her', 'Their', 'My', 'Your', 'Our', 'This', 'That', 'These',
    'Those', 'There', 'Here', 'But', 'And', 'Or', 'So', 'Then', 'When', 'What', 'Why', 'How', 'Who', 'Where', 'If', 'Yes', 'No', 'Oh',
    'Well', 'Just', 'Still', 'Maybe', 'Now', 'Okay', 'OK', 'Hey', 'Mr', 'Mrs', 'Ms', 'Sir', 'Please', 'Thank', 'Thanks', 'Not', 'Do', 'Don',
  ]);

  function englishCandidates(words) {
    const out = [];
    let run = [];
    const flush = () => { if (run.length > 1) out.push(run.join(' ')); out.push(...run); run = []; };
    for (const raw of words) {
      const w = raw.replace(/'s$/, '');
      if (/^[A-Z][a-zA-Z-]{1,20}$/.test(w) && !EN_STOP.has(w)) run.push(w);
      else flush();
    }
    flush();
    return out;
  }

  function wordCandidates(sentence) {
    const cleaned = sentence.replace(/\([^)]{0,20}\)/g, ' ').replace(/[“”"‘’「」『』!?…,.~:;*\-—()[\]]/g, ' ');
    const words = cleaned.split(/\s+/).filter(Boolean);
    const english = englishCandidates(words);
    const info = words.map(w => {
      if (/^[\x00-\x7f]+$/.test(w)) return null;
      w = w.replace(/'/g, '');
      let base = w;
      let hadParticle = false;
      if (COPULA.test(base)) base = base.replace(COPULA, '');
      else if (PARTICLE.test(base)) {
        base = base.replace(PARTICLE, '');
        if (base.length > 2 && /(과|와|이|에)$/u.test(base) && PARTICLE.test(base)) base = base.replace(PARTICLE, ''); // "상현과의" → 상현
        hadParticle = true;
      }
      else if (VERBISH.test(base)) return null;
      if (base.length < 2 || base.length > 12 || WORD_STOP.has(base) || /\d/.test(base)) return null;
      return { base, raw: w, hadParticle };
    });
    const out = [];
    info.forEach((w, i) => {
      if (!w) return;
      const next = info[i + 1];
      if (next && !w.hadParticle && w.raw === w.base) out.push(`${w.base} ${next.base}`);
      out.push(w.base);
    });
    return [...english, ...out];
  }

  // ── 무료 압축 ──

  const FILLERS = new Set([
    '그냥', '정말', '정말로', '진짜', '진짜로', '완전', '좀', '막', '뭐', '아주', '되게', '엄청', '약간', '일단', '어쩌면', '아마', '살짝',
    '그러니까', '있잖아', '말야', '말이야', '어라', '아', '어', '음', '흠', '헉', '와', '오', '에이', '저기', '하하', '후', '흐음', '에휴', '휴', '참',
    'just', 'really', 'very', 'actually', 'basically', 'literally', 'well', 'um', 'uh', 'oh', 'hmm', 'like',
  ]);
  const DIALOGUE_FORM = /^([^:"“]{1,15}):\s*"([\s\S]*)"$/u;

  function splitDialogue(text) {
    const m = DIALOGUE_FORM.exec(text);
    return m ? { head: `${m[1]}: "`, body: m[2], tail: '"' } : { head: '', body: text, tail: '' };
  }

  function tidy(s) {
    return s.replace(/\s+([,.!?])/g, '$1').replace(/,(\s*[,.!?])/g, '$1').replace(/…+/g, '').replace(/^[,\s]+/, '').replace(/\s{2,}/g, ' ').trim();
  }

  function freeTrim(text) {
    const parts = splitDialogue(text);
    const out = [];
    for (const tok of parts.body.split(/\s+/).filter(Boolean)) {
      const core = tok.replace(/[.,!?…~]+$/u, '');
      const punct = tok.slice(core.length);
      if (FILLERS.has(core.toLowerCase())) {
        if (/[.!?]/.test(punct) && out.length && !/[.!?]$/.test(out[out.length - 1])) out[out.length - 1] += punct.replace(/[,~…]/g, '');
        continue;
      }
      const pm = /^(.{2,}?)(은|는|도)$/u.exec(core);
      if (pm && isEntityName(pm[1])) { out.push(pm[1] + punct); continue; }
      out.push(tok);
    }
    const body = tidy(out.join(' '));
    return body.length >= 4 ? parts.head + body + parts.tail : text;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  설정
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 붙여넣은 키 정리: 앞의 "Bearer", 따옴표, 모든 공백(전각·폭 없는 공백 포함), 줄바꿈을 뺀다.
   * OpenRouter는 "Bearer Bearer sk-…"나 "Bearer 　sk-…"를 받으면 "Missing Authentication header"를 돌려준다.
   */
  function cleanKey(k) {
    return String(k ?? '')
      .replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, ' ')
      .trim()
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/^bearer\s+/i, '')
      .replace(/\s+/g, '');
  }

  /** 키에 영문·숫자·기호가 아닌 글자(한글 등)가 섞였으면 이유를 돌려준다. */
  function keyProblem(k, label) {
    if (!k) return `${label} 키가 비어 있어요.`;
    if (/[^\x21-\x7e]/.test(k)) return `${label} 키에 영문·숫자가 아닌 글자가 섞여 있어요. 한글 입력 상태로 붙여넣지 않았는지 확인하고 키를 다시 복사해 붙여넣어 주세요.`;
    return '';
  }

  /** 응답 오류를 알아듣기 쉬운 말로. */
  function friendlyHttpError(label, status, body) {
    const b = String(body ?? '');
    const raw = b.slice(0, 160);
    if (status === 401 && /Missing Authentication|No cookie auth/i.test(b)) return `${label}: 키가 제대로 전달되지 않았어요. 키 앞뒤에 공백이나 "Bearer"가 붙어 있지 않은지 확인해 주세요. (${raw})`;
    if (status === 401) return `${label}: 키가 맞지 않아요. 키를 다시 확인해 주세요. (${raw})`;
    if (status === 402) return `${label}: 크레딧이 부족해요. (${raw})`;
    if (status === 403) return `${label}: 이 키로는 쓸 수 없는 모델이거나 권한이 없어요. (${raw})`;
    if (status === 404) return `${label}: 주소나 모델 이름을 찾을 수 없어요. 주소·모델을 확인해 주세요. (${raw})`;
    if (status === 429) return `${label}: 요청이 너무 많아요. 잠시 뒤 다시 해 주세요. (${raw})`;
    if (status >= 500) return `${label}: 서버 쪽 문제예요. 잠시 뒤 다시 해 주세요. (${status} ${raw})`;
    return `${label} ${status}: ${raw}`;
  }

  let settings = { ...DEFAULT_SETTINGS };

  function sanitizeSettings(raw) {
    const s = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
    const str = (v, d = '') => (typeof v === 'string' ? v.trim() : d);
    const bool = (k) => s[k] !== false;
    const out = {
      enabled: bool('enabled'),
      onboarded: s.onboarded === true,
      jevPreset: JEV_PRESETS[s.jevPreset] ? s.jevPreset : 'openrouter',
      jevKey: cleanKey(s.jevKey),
      jevEndpoint: str(s.jevEndpoint),
      jevModel: str(s.jevModel),
      embedPreset: EMBED_PRESETS[s.embedPreset] ? s.embedPreset : 'openrouter',
      embedKey: cleanKey(s.embedKey),
      embedEndpoint: str(s.embedEndpoint),
      embedModel: str(s.embedModel),
      embedDims: clampNum(s.embedDims, 512, 64, 4096),
      mode: MODES[s.mode] || s.mode === 'custom' ? s.mode : 'balanced',
      rawBudget: clampNum(s.rawBudget, 6000, 500, 200000),
      minRaw: clampNum(s.minRaw, 6, 2, 100),
      recallBudget: clampNum(s.recallBudget, 1200, 0, 20000),
      eventsPerScene: clampNum(s.eventsPerScene, 4, 1, 20),
      candidates: clampNum(s.candidates, 24, 4, 200),
      arcs: clampNum(s.arcs, 3, 1, 10),
      recallThreshold: clampNum(s.recallThreshold, 50, 1, 99),
      saveThreshold: clampNum(s.saveThreshold, 55, 1, 99),
      parseSpeakers: bool('parseSpeakers'),
      parseStatus: bool('parseStatus'),
      classifyWords: bool('classifyWords'),
      compress: bool('compress'),
      supersede: bool('supersede'),
      rejAutoClear: s.rejAutoClear === true,
      rejClearEvery: clampNum(s.rejClearEvery, 100, 10, 10000),
      injectMode: s.injectMode === 'system' ? 'system' : 'last_user',
      injectStyle: s.injectStyle === 'original' ? 'original' : 'memo',
      injectLabel: (str(s.injectLabel) === '기억 메모' ? '' : str(s.injectLabel)) || DEFAULT_SETTINGS.injectLabel,
      note: typeof s.note === 'string' && s.note.trim() !== OLD_DEFAULT_NOTE ? s.note.trim() : DEFAULT_NOTE,
      showStoryTime: bool('showStoryTime'),
      cards: bool('cards'),
      translate: TRANSLATORS[s.translate] ? s.translate : 'off',
      translateKey: cleanKey(str(s.translateKey)),
      translateModel: str(s.translateModel) || DEFAULT_SETTINGS.translateModel,
      showButton: bool('showButton'),
    };
    if (out.jevPreset !== 'custom') { out.jevEndpoint ||= JEV_PRESETS[out.jevPreset].endpoint; out.jevModel ||= JEV_PRESETS[out.jevPreset].model; }
    const ep = EMBED_PRESETS[out.embedPreset];
    if (out.embedPreset !== 'custom' && ep.format !== 'local') { out.embedEndpoint ||= ep.endpoint; out.embedModel ||= ep.model; }
    return out;
  }

  async function loadSettings() {
    let stored = null;
    try { stored = await R.pluginStorage.getItem(SETTINGS_KEY); } catch { }
    if (typeof stored === 'string') { try { stored = JSON.parse(stored); } catch { stored = null; } }
    settings = sanitizeSettings(stored);
    if (!settings.jevKey) {
      try {
        const arg = await R.getArgument('jev_api_key');
        if (typeof arg === 'string' && arg.trim()) settings.jevKey = cleanKey(arg);
      } catch { }
    }
  }

  async function saveSettings(next) {
    const before = embedProfile(settings);
    settings = sanitizeSettings(next);
    await R.pluginStorage.setItem(SETTINGS_KEY, { ...settings });
    try { await R.setArgument?.('jev_api_key', settings.jevKey); } catch { }
    if (embedProfile(settings) !== before) { queryVecCache.clear(); vecCache.clear(); }
    recallCache.clear();
    await syncButton();
  }

  function applyMode(draft, mode) {
    if (!MODES[mode]) return { ...draft, mode: 'custom' };
    return { ...draft, mode, ...Object.fromEntries(MODE_KEYS.map(k => [k, MODES[mode][k]])) };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Jev · 임베딩 호출
  // ══════════════════════════════════════════════════════════════════════

  const doFetch = R.nativeFetch ? (url, init) => R.nativeFetch(url, init) : (url, init) => fetch(url, init);

  async function fetchJson(url, init, timeoutMs, label) {
    let timer;
    try {
      const resp = await Promise.race([
        doFetch(url, init),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} 응답 시간 초과`)), timeoutMs); }),
      ]);
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        const err = new Error(friendlyHttpError(label, resp.status, text));
        err.status = resp.status;
        throw err;
      }
      return await resp.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function jevConfig(cfg = settings) {
    return { endpoint: cfg.jevEndpoint, model: cfg.jevModel, key: cleanKey(cfg.jevKey) };
  }

  async function callJev(state, questions, cfg = settings) {
    const j = jevConfig(cfg);
    const kp = keyProblem(j.key, 'Jev');
    if (kp) throw new Error(kp);
    if (!j.endpoint || !j.model) throw new Error('Jev 주소나 모델이 비어 있어요.');
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${j.key}` },
      body: JSON.stringify({ model: j.model, state, questions }),
    };
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await new Promise(r => setTimeout(r, 800));
      try {
        const data = await fetchJson(j.endpoint, init, JEV_TIMEOUT_MS, 'Jev');
        const answers = data?.answers ?? data;
        if (!answers || typeof answers !== 'object') throw new Error('Jev 응답 형식이 이상해요.');
        stats.jevCalls++;
        stats.jevTokens += Number(data?.usage?.input_tokens ?? 0) || 0;
        return { answers, model: data?.model ?? j.model };
      } catch (error) {
        lastError = error;
        const retry = error.status === 429 || error.status >= 500 || /시간 초과|fetch|network/i.test(String(error?.message));
        if (!retry) throw error;
      }
    }
    throw lastError;
  }

  const noulProb = (a) => (Number.isFinite(Number(a?.noul)) ? Number(a.noul) : 0);

  function choiceProbs(answer, options) {
    const out = Object.fromEntries(options.map(o => [o, 0]));
    const probs = answer?.probabilities;
    if (probs && typeof probs === 'object' && Object.keys(probs).length) {
      for (const o of options) out[o] = Number(probs[o]) || 0;
    } else if (answer?.choice && answer.choice in out) {
      out[answer.choice] = Number.isFinite(Number(answer.confidence)) ? Number(answer.confidence) : 1;
    }
    return out;
  }

  function argmax(probs) {
    let best = null, bp = -1;
    for (const [k, v] of Object.entries(probs)) if (v > bp) { bp = v; best = k; }
    return best;
  }

  // ── 임베딩 ──

  function embedConfig(cfg = settings) {
    const p = EMBED_PRESETS[cfg.embedPreset] ?? EMBED_PRESETS.local;
    const key = cleanKey(p.key === 'jev' ? (cfg.embedKey || cfg.jevKey) : cfg.embedKey);
    return { preset: cfg.embedPreset, format: p.format, endpoint: cfg.embedEndpoint || p.endpoint, model: cfg.embedModel || p.model, key, dims: cfg.embedDims, mrl: !!p.mrl, needsKey: p.key === 'own' };
  }

  function embedProfile(cfg = settings) {
    const e = embedConfig(cfg);
    return e.format === 'local' ? `local:${LOCAL_DIMS}` : `${e.format}:${e.endpoint}:${e.model}:${e.mrl ? e.dims : 'full'}`;
  }

  function normalize(v) {
    let n = 0;
    for (let i = 0; i < v.length; i++) n += v[i] * v[i];
    n = Math.sqrt(n) || 1;
    const out = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
    return out;
  }

  function dot(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  function fnv(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }

  /** API 없이 쓰는 벡터: 단어(조사 뗀 것)와 글자 두 개 조각을 해시해서 384칸에 뿌린다. */
  function hashEmbed(text) {
    const v = new Float32Array(LOCAL_DIMS);
    const add = (feat, w) => {
      const h = fnv(feat);
      v[h % LOCAL_DIMS] += (h & 0x80000000 ? -1 : 1) * w;
    };
    const lower = cleanText(text).toLowerCase();
    for (const raw of lower.split(/[^0-9a-z぀-鿿가-힯]+/).filter(Boolean)) {
      const w = raw.replace(PARTICLE, '');
      if (w.length >= 2) add(`w:${w}`, 1);
    }
    const g = lower.replace(/[^0-9a-z぀-鿿가-힯]/g, '');
    for (let i = 0; i < g.length - 1; i++) add(`g:${g.slice(i, i + 2)}`, 0.5);
    return normalize(v);
  }

  async function embedTexts(texts, cfg = settings) {
    const e = embedConfig(cfg);
    if (e.format === 'local') return texts.map(hashEmbed);
    if (e.needsKey || e.key) { const kp = keyProblem(e.key, '임베딩'); if (kp) throw new Error(kp); }
    if (!e.endpoint || !e.model) throw new Error('임베딩 주소나 모델이 비어 있어요.');
    const out = [];
    for (let i = 0; i < texts.length; i += EMBED_CHUNK) {
      const chunk = texts.slice(i, i + EMBED_CHUNK).map(t => clip(t, 2000));
      let vectors;
      if (e.format === 'gemini') {
        const url = `${e.endpoint.replace(/\/$/, '')}/models/${encodeURIComponent(e.model)}:batchEmbedContents?key=${encodeURIComponent(e.key)}`;
        const data = await fetchJson(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests: chunk.map(t => ({ model: `models/${e.model}`, content: { parts: [{ text: t }] }, outputDimensionality: e.dims })) }),
        }, EMBED_TIMEOUT_MS, '임베딩');
        vectors = (data?.embeddings ?? []).map(x => x?.values);
      } else if (e.format === 'ollama') {
        const data = await fetchJson(`${e.endpoint.replace(/\/$/, '')}/api/embed`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: e.model, input: chunk }),
        }, EMBED_TIMEOUT_MS, '임베딩');
        vectors = data?.embeddings ?? [];
      } else {
        const headers = { 'Content-Type': 'application/json' };
        if (e.key) headers.Authorization = `Bearer ${e.key}`;
        const data = await fetchJson(e.endpoint, { method: 'POST', headers, body: JSON.stringify({ model: e.model, input: chunk }) }, EMBED_TIMEOUT_MS, '임베딩');
        vectors = (data?.data ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(x => x?.embedding);
      }
      if (vectors.length !== chunk.length || vectors.some(v => !Array.isArray(v) || !v.length)) throw new Error('임베딩 응답 개수나 형식이 맞지 않아요.');
      stats.embedCalls++;
      for (const v of vectors) out.push(normalize(e.mrl && v.length > e.dims ? v.slice(0, e.dims) : v));
    }
    return out;
  }

  // 벡터는 8비트로 줄여 base64로 저장한다 (512칸 → 약 0.7KB).
  function encodeVec(v) {
    let max = 0;
    for (let i = 0; i < v.length; i++) max = Math.max(max, Math.abs(v[i]));
    const scale = max || 1;
    const q = new Int8Array(v.length);
    for (let i = 0; i < v.length; i++) q[i] = Math.round((v[i] / scale) * 127);
    let bin = '';
    const bytes = new Uint8Array(q.buffer);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function decodeVec(s) {
    const bin = atob(s);
    const q = new Int8Array(bin.length);
    for (let i = 0; i < bin.length; i++) q[i] = (bin.charCodeAt(i) << 24) >> 24;
    return normalize(q);
  }

  const vecCache = new Map();
  function vecOf(obj) {
    if (!obj?.vec || obj.vp !== embedProfile()) return null;
    const key = `${obj.vp}|${obj.vec.length}|${obj.vec.slice(0, 24)}|${obj.id}`;
    let v = vecCache.get(key);
    if (!v) { v = decodeVec(obj.vec); vecCache.set(key, v); if (vecCache.size > 20000) vecCache.clear(); }
    return v;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  채팅별 상태
  // ══════════════════════════════════════════════════════════════════════
  //
  // arc:   { id, title, sceneIds, from, to, cast, places, kw, vec, vp, at }
  // scene: { id, arc, turns, from, to, place, cast }
  // event: { id, scene, arc, kind, who, place, when, t(원문), c(압축), r, imp, src, pin, hits, lastHit, at, old?, vec, vp }

  function emptyState() {
    return {
      v: 1, seq: 0, turn: 0, seen: [], off: false,
      arcs: [], scenes: [], events: [],
      dict: { e: {}, rej: [], sug: [], nosug: [] },
      clock: { d: null, t: null, place: null, approx: false, day: 1 },
      open: { arc: null, scene: null },
      savedTokens: 0, lastRecall: null, scene: null, pending: 0, loreSeeded: false,
    };
  }

  let chatKey = '';
  let chatLabel = { char: '', chat: '' };
  let state = emptyState();
  let seenSet = new Set();
  let rejSet = new Set();
  let gramCache = new Map();
  let matcherCache = null;
  const characterCache = { index: -1, chaId: '', name: '', lore: [], firstMessage: '', alternateGreetings: [] };
  let rawChatObj = null;    // Risu에 저장된 채팅 원본 (요청에는 최근 메시지만 오므로 오래된 메시지는 여기서 읽는다)
  let personaCache = '';

  function migrateState(loaded) {
    const s = { ...emptyState(), ...loaded };
    s.dict = { e: { ...(loaded.dict?.e ?? {}) }, rej: [...(loaded.dict?.rej ?? [])], sug: [...(loaded.dict?.sug ?? [])], nosug: [...(loaded.dict?.nosug ?? [])] };
    s.clock = { ...emptyState().clock, ...(loaded.clock ?? {}) };
    s.open = { ...emptyState().open, ...(loaded.open ?? {}) };
    for (const e of s.events) { e.who ??= []; e.hits ??= 0; e.lastHit ??= 0; e.pin = !!e.pin; }
    return s;
  }

  async function readChatIdentity() {
    const charIndex = await R.getCurrentCharacterIndex();
    if (charIndex == null || charIndex < 0) return null;
    const chatIndex = await R.getCurrentChatIndex();
    if (characterCache.index !== charIndex) {
      let character = null;
      try { character = R.getCharacterFromIndex ? await R.getCharacterFromIndex(charIndex) : await R.getCharacter(); } catch { }
      characterCache.index = charIndex;
      characterCache.chaId = character?.chaId ?? `idx${charIndex}`;
      characterCache.name = character?.name ?? '';
      characterCache.lore = (character?.globalLore ?? []).filter(l => l?.mode !== 'folder');
      characterCache.firstMessage = character?.firstMessage ?? '';
      characterCache.alternateGreetings = character?.alternateGreetings ?? [];
    }
    let chat = null;
    try { chat = await R.getChatFromIndex(charIndex, chatIndex); } catch { }
    return { key: `${characterCache.chaId}_${chat?.id || `idx${chatIndex}`}`, char: characterCache.name, chat: chat?.name ?? '', chatObj: chat };
  }

  async function personaName(chat) {
    try {
      const db = await R.getDatabase?.(['personas', 'selectedPersona']);
      const personas = db?.personas ?? [];
      const bound = chat?.bindedPersona ? personas.find(p => p.id === chat.bindedPersona) : null;
      return bound?.name ?? personas[db?.selectedPersona]?.name ?? '';
    } catch { return ''; }
  }

  async function ensureChat() {
    const id = await readChatIdentity();
    if (!id) return false;
    chatLabel = { char: id.char, chat: id.chat };
    rawChatObj = id.chatObj;
    if (id.key === chatKey) return true;
    chatKey = id.key;
    let loaded = null;
    try { loaded = await R.pluginStorage.getItem(STORE + id.key); } catch (e) { setError('불러오기', e); }
    if (typeof loaded === 'string') { try { loaded = JSON.parse(loaded); } catch { loaded = null; } }
    state = loaded && Array.isArray(loaded.events) ? migrateState(loaded) : emptyState();
    seenSet = new Set(state.seen);
    rejSet = new Set(state.dict.rej);
    gramCache = new Map();
    matcherCache = null;
    recallCache.clear();
    const persona = await personaName(id.chatObj);
    personaCache = persona && persona !== 'User' ? persona : '';
    if (personaCache) addEntity(personaCache, 'person', 'persona', 99);
    if (!state.loreSeeded) {
      const lore = [...characterCache.lore, ...(id.chatObj?.localLore ?? [])];
      state.loreQueue = [...new Set([...(id.char && !state.dict.e[id.char] ? [id.char] : []), ...lore.flatMap(l => String(l?.key ?? '').split(',')).map(k => k.trim()).filter(k => k.length >= 2 && k.length <= 12)])].slice(0, 60);
    }
    return true;
  }

  let saveChain = Promise.resolve();
  function persist() {
    const key = chatKey;
    if (!key) return Promise.resolve();
    state.seen = [...seenSet].slice(-MAX_SEEN);
    state.dict.rej = [...rejSet].slice(-4000);
    const snapshot = JSON.parse(JSON.stringify(state));
    saveChain = saveChain.catch(() => {}).then(() => R.pluginStorage.setItem(STORE + key, snapshot));
    return saveChain;
  }

  function gramsOf(ev) {
    let g = gramCache.get(ev.id);
    if (!g) { g = bigrams(ev.t); gramCache.set(ev.id, g); }
    return g;
  }

  const isActive = (e) => !e.old;
  const eventById = (id) => state.events.find(e => e.id === id);
  const arcById = (id) => state.arcs.find(a => a.id === id);
  const sceneById = (id) => state.scenes.find(s => s.id === id);

  function arcTitle(a) {
    if (!a) return '';
    if (a.title) return a.title;
    const n = state.arcs.indexOf(a) + 1;
    return `대단원 ${n}${a.kw?.length ? ` · ${a.kw.slice(0, 2).join(', ')}` : ''}`;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  ② 사전 (인물·장소·물건)
  // ══════════════════════════════════════════════════════════════════════

  function canonical(name) {
    let n = name;
    for (let i = 0; i < 5; i++) {
      const e = state.dict.e[n];
      if (!e?.alias || !state.dict.e[e.alias]) break;
      n = e.alias;
    }
    return n;
  }

  function addEntity(name, type, src, n = 1) {
    name = String(name ?? '').trim();
    if (!name || (name.length < 2 && type !== 'person')) return;
    const cur = state.dict.e[name];
    if (cur) {
      if (cur.alias) return;
      cur.n = src === 'card' || src === 'persona' ? Math.max(cur.n ?? 0, n) : Math.min(9999, (cur.n ?? 0) + n);
      if (src !== 'speaker' && cur.src === 'speaker') cur.src = src;
    } else {
      state.dict.e[name] = { type, n, src };
    }
    rejSet.delete(name);
    matcherCache = null;
  }

  function isActiveEntity(e) {
    if (!e || e.hidden) return false;
    if (e.type !== 'person') return true;
    return e.src !== 'speaker' || e.n >= SPEAKER_ACTIVE_COUNT;
  }

  function matcher() {
    if (matcherCache) return matcherCache;
    const list = [];
    for (const [name, e] of Object.entries(state.dict.e)) {
      const target = e.alias ? state.dict.e[canonical(name)] : e;
      if (!target || !isActiveEntity(target) || target.type === 'other' || name.length < 2) continue;
      list.push({ name, canon: canonical(name), type: target.type, ascii: /^[\x00-\x7f]+$/.test(name) });
    }
    list.sort((a, b) => b.name.length - a.name.length);
    return (matcherCache = list);
  }

  function isEntityName(word) {
    return matcher().some(m => m.name === word);
  }

  function findEntities(text) {
    const found = { person: [], place: [], item: [] };
    const seen = new Set();
    const lower = text.toLowerCase();
    for (const m of matcher()) {
      if (seen.has(m.canon)) continue;
      const hit = m.ascii ? new RegExp(`\\b${m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text) : lower.includes(m.name.toLowerCase());
      if (!hit) continue;
      seen.add(m.canon);
      found[m.type]?.push(m.canon);
    }
    for (const k of Object.keys(found)) found[k].sort((a, b) => lower.indexOf(a.toLowerCase()) - lower.indexOf(b.toLowerCase()));
    return found;
  }

  function knownWord(w) {
    if (rejSet.has(w) || state.dict.e[w]) return true;
    return matcher().some(m => m.name.includes(w) || w.includes(m.name));
  }

  function personList(limit = 40) {
    return Object.entries(state.dict.e)
      .filter(([, e]) => !e.alias && e.type === 'person' && isActiveEntity(e))
      .sort((a, b) => b[1].n - a[1].n).slice(0, limit).map(([n]) => n);
  }

  // ── 같은 인물 찾기 ──
  //  한글 이름은 로마자로 바꿔 영어 표기와 비교한다(명호 = Myeongho = Myeong-ho).
  //  호칭·조사를 뗀 형태(보민이 = 보민, 상현과 = 상현), 성 붙은 이름(박명호 ⊃ 명호)도 같은 사람 후보로 본다.
  const RR_I = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
  const RR_V = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
  const RR_F = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
  function romanize(str) {
    let out = '';
    for (const ch of str) {
      const c = ch.charCodeAt(0) - 0xac00;
      out += c >= 0 && c < 11172 ? RR_I[Math.floor(c / 588)] + RR_V[Math.floor((c % 588) / 28)] + RR_F[c % 28] : ch;
    }
    return out.toLowerCase();
  }
  const hasFinal = (ch) => { const c = (ch?.charCodeAt(0) ?? 0) - 0xac00; return c >= 0 && c < 11172 && c % 28 !== 0; };
  function nameKey(name) {
    let k = name.trim().replace(/(과의|와의|에게|한테|과|와|의)$/u, '');
    if (/[가-힣]{2,}(씨|님)$/u.test(k)) k = k.slice(0, -1);
    else if (/[가-힣]{2,}이$/u.test(k) && hasFinal(k[k.length - 2])) k = k.slice(0, -1);   // 보민이 → 보민
    const words = [...new Set(k.split(/\s+/))];                                         // "Sanghyun Sanghyun" → Sanghyun
    const full = romanize(words.join('')).replace(/[^a-z]/g, '');
    return { kor: /[가-힣]/.test(k) ? words.join(' ') : '', full, skel: full.replace(/[aeiouwy]/g, '') };
  }
  function samePerson(a, b) {
    const x = nameKey(a), y = nameKey(b);
    if (x.kor && y.kor) {
      if (x.kor === y.kor) return true;
      const [s, l] = x.kor.length <= y.kor.length ? [x.kor, y.kor] : [y.kor, x.kor];
      if (s.length >= 2 && l.endsWith(s) && l.length - s.length <= 2) return true;       // 박명호 ⊃ 명호
    }
    if (x.full && x.full === y.full) return true;
    const [s, l] = x.skel.length <= y.skel.length ? [x.skel, y.skel] : [y.skel, x.skel];
    return s.length >= 3 && x.full[0] === y.full[0] && s === l || (s.length >= 4 && l.endsWith(s));
  }
  /** 같은 사람 같아 보이는 이름 묶음들. "아니에요"로 넘긴 묶음은 빼고. */
  function duplicateGroups() {
    const names = Object.entries(state.dict.e).filter(([, e]) => !e.alias && !e.hidden && e.type === 'person').map(([n]) => n);
    const parent = new Map(names.map(n => [n, n]));
    const find = (n) => { while (parent.get(n) !== n) n = parent.get(n); return n; };
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (samePerson(names[i], names[j])) parent.set(find(names[i]), find(names[j]));
    const groups = new Map();
    for (const n of names) { const r = find(n); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(n); }
    return [...groups.values()].filter(g => g.length > 1 && !state.dict.nosug.includes(`dup:${[...g].sort().join('|')}`));
  }
  /** 대표 이름 고르기: 한글 이름 중 메모가 많고 자주 나온 것. */
  function mainName(names) {
    const memos = (n) => state.events.filter(e => e.who.includes(n)).length;
    return [...names].sort((a, b) => (/[가-힣]/.test(b) - /[가-힣]/.test(a)) || memos(b) - memos(a) || (state.dict.e[b]?.n ?? 0) - (state.dict.e[a]?.n ?? 0) || a.length - b.length)[0];
  }
  /** 여러 이름을 main 하나로 묶는다. 나머지는 main의 별명이 되고 메모 태그도 합쳐진다. */
  function mergePeople(names, main) {
    for (const n of names) if (n !== main && state.dict.e[n]) mergeAlias(n, main);
    for (const e of state.events) e.who = [...new Set(e.who.map(canonical))];
    retagAll();
  }

  function mergeAlias(name, target) {
    if (!state.dict.e[target]) addEntity(target, 'person', 'manual', 2);
    if (!state.dict.e[name]) addEntity(name, state.dict.e[target].type, 'manual', 1);
    if (canonical(target) === name) delete state.dict.e[target].alias;
    state.dict.e[name].alias = target;
    state.dict.e[target].n += state.dict.e[name].n;
    for (const e of state.events) e.who = [...new Set(e.who.map(w => (w === name ? target : w)))];
    for (const a of state.arcs) a.cast = [...new Set(a.cast.map(w => (w === name ? target : w)))];
    for (const s of state.scenes) s.cast = [...new Set(s.cast.map(w => (w === name ? target : w)))];
    state.dict.sug = state.dict.sug.filter(s => !(s.from === name && s.to === target));
    matcherCache = null;
    recallCache.clear();
  }

  function registerIntros(intros) {
    for (const { from, to, quote } of intros) {
      addEntity(to, 'person', 'intro', SPEAKER_ACTIVE_COUNT);
      const key = `${from}>${to}`;
      if (canonical(from) === canonical(to) || state.dict.nosug.includes(key)) continue;
      if (state.dict.sug.some(s => s.from === from && s.to === to)) continue;
      state.dict.sug.push({ from, to, quote });
    }
  }

  function retagAll() {
    matcherCache = null;
    let changed = 0;
    for (const e of state.events) {
      const found = findEntities(e.t);
      const speaker = /^([^:]{1,15}):\s/.exec(e.t)?.[1];
      const who = [];
      for (const w of [...(speaker ? [canonical(speaker)] : []), ...e.who.map(canonical), ...found.person]) {
        if (state.dict.e[w] && !state.dict.e[w].hidden && !who.includes(w)) who.push(w);
      }
      if (who.join() !== e.who.join()) { e.who = who.slice(0, 4); changed++; }
    }
    for (const a of state.arcs) refreshArc(a);
    return changed;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  쓰기: 메시지 → 장면 · 대단원 · 사건 메모
  // ══════════════════════════════════════════════════════════════════════

  function chatEntries(messages) {
    const out = [];
    messages.forEach((m, index) => {
      if (m && m.removable === true && (m.role === 'user' || m.role === 'assistant')) {
        const text = contentOf(m);
        const hash = hashText(m.role + '\u0000' + text);
        out.push({ index, role: m.role, text, hash, key: `h:${hash}` });
      }
    });
    return out;
  }

  // ── 채팅 원본 ──
  //  처리 기록은 메시지 고유 번호(chatId)로 남긴다. 요청 속 메시지는 원본과 끝에서부터 내용을 맞춰 보고 짝짓는다.

  const GREETING_KEY = 'c:__greeting__';

  function resolveNames(text) {
    const c = characterCache.name || 'char';
    const u = personaCache || 'user';
    return String(text ?? '').replace(/\{\{\s*char\s*\}\}|<char>/gi, c).replace(/\{\{\s*user\s*\}\}|<user>/gi, u);
  }

  /** 첫 인사말 + chat.message 전체를 오래된 순으로. */
  function rawEntries() {
    const chat = rawChatObj;
    if (!chat || !Array.isArray(chat.message)) return [];
    const out = [];
    const fm = Number(chat.fmIndex ?? -1);
    const greet = fm >= 0 && characterCache.alternateGreetings?.[fm] != null ? characterCache.alternateGreetings[fm] : characterCache.firstMessage;
    if (greet && String(greet).trim()) out.push({ key: GREETING_KEY, role: 'assistant', text: resolveNames(greet) });
    chat.message.forEach((m, i) => {
      const text = String(m?.data ?? '');
      if (!text.trim()) return;
      out.push({ key: m?.chatId ? `c:${m.chatId}` : `r:${i}:${hashText(text)}`, role: m?.role === 'user' ? 'user' : 'assistant', text: resolveNames(text) });
    });
    return out;
  }

  /** 요청 속 메시지에 원본 키를 붙인다. 원본에만 있거나(숨김) 요청에만 있는(삽입) 메시지는 건너뛴다. */
  function alignKeys(entries, raw) {
    const sim = (a, b) => dice(bigrams(clip(cleanText(a), 400)), bigrams(clip(cleanText(b), 400)));
    let i = entries.length - 1, j = raw.length - 1, skips = 0;
    while (i >= 0 && j >= 0 && skips < 12) {
      const e = entries[i], r = raw[j];
      if (e.role === r.role && sim(e.text, r.text) >= 0.3) { e.key = r.key; i--; j--; continue; }
      if (j > 0 && raw[j - 1].role === e.role && sim(e.text, raw[j - 1].text) >= 0.3) { j--; skips++; continue; }
      i--; skips++;
    }
  }

  /** 처리했나? 1.0.0 기록(요청 글 해시)도 인정하고, 인정하면 새 키로 옮겨 적는다. */
  function isSeen(e) {
    if (seenSet.has(e.key)) return true;
    if (e.hash && seenSet.has(e.hash)) { seenSet.add(e.key); return true; }
    return false;
  }

  function lastSeenIndex(list) {
    let last = -1;
    list.forEach((e, i) => { if (seenSet.has(e.key)) last = i; });
    return last;
  }

  /** 앞에 처리 안 된 메시지가 있는데 그 뒤가 처리돼 있으면 순서가 꼬인 것. 꼬인(앞부분) 개수. */
  function orderGap(raw) {
    const list = raw.slice(0, Math.max(0, raw.length - SETTLE));
    return list.slice(0, lastSeenIndex(list) + 1).filter(e => !seenSet.has(e.key)).length;
  }

  /** 다음에 처리할 메시지들(오래된 순). 순서가 꼬였으면 마지막으로 처리한 것 이후만. */
  function ingestTargets(raw) {
    const list = raw.slice(0, Math.max(0, raw.length - SETTLE));
    const from = orderGap(raw) ? lastSeenIndex(list) + 1 : 0;
    return list.slice(from).filter(e => !seenSet.has(e.key));
  }

  function refreshPending() {
    const raw = rawEntries();
    if (!raw.length) return;
    state.pending = ingestTargets(raw).length;
    state.gap = orderGap(raw);
    state.total = Math.max(0, raw.length - SETTLE);
  }

  function labelled(entry, maxChars = 1500) {
    const body = cleanText(stripMeta(entry.text));
    return `${entry.role === 'user' ? '[USER]' : '[STORY]'}\n${body.length > maxChars ? '...' + body.slice(-maxChars) : body}`;
  }

  function nowWhen() {
    const c = state.clock;
    return { d: c.d, t: c.t, day: c.day, approx: c.approx || undefined };
  }

  function openArc() {
    const arc = { id: ++state.seq, title: '', sceneIds: [], from: nowWhen(), to: nowWhen(), cast: [], places: [], kw: [], vec: null, vp: null, at: Date.now() };
    state.arcs.push(arc);
    state.open.arc = arc.id;
    state.open.scene = null;
    return arc;
  }

  function openScene() {
    if (!state.open.arc || !arcById(state.open.arc)) openArc();
    const scene = { id: ++state.seq, arc: state.open.arc, turns: 0, from: nowWhen(), to: nowWhen(), place: state.clock.place, cast: [] };
    state.scenes.push(scene);
    arcById(scene.arc).sceneIds.push(scene.id);
    state.open.scene = scene.id;
    return scene;
  }

  /** Jev가 경계를 판단할 때 보는 "지금 장면" 요약. 원문(t)만 쓴다(압축 여부와 상관없이 같은 입력이 되도록). */
  function currentSceneBrief() {
    const s = sceneById(state.open.scene);
    if (!s) return '';
    const evs = state.events.filter(e => e.scene === s.id && isActive(e)).slice(-3);
    const bits = [formatWhen(s.to, true), s.place, s.cast.length ? `present: ${s.cast.join(', ')}` : ''].filter(Boolean).join(' · ');
    return `[CURRENT SCENE SO FAR] ${bits}\n${evs.map(e => `- ${e.t}`).join('\n')}\n\n`;
  }

  // ── 처리 속도 ──
  //  배치 하나 = Jev A → (임베딩) → Jev B. 예전엔 셋을 줄줄이 기다렸다.
  //  · 임베딩은 Jev A와 동시에 보낸다: 남길 문장을 아직 몰라도, 같은 문장은 언제 임베딩해도 같은 벡터다.
  //  · 다음 배치의 Jev A는 앞 배치의 A를 반영한 직후 준비해서 바로 보낸다(앞 배치의 B와 동시에).
  //    준비 시점은 순차 처리와 똑같고 "보내는 시점"만 당기므로 입력·결과가 같다.
  let PIPELINE = true;

  /** 배치 하나 준비: 메시지 묶기, 화자·자기소개 등록, Jev A 질문 만들기 */
  function prepareBatch(entries, from, cfg) {
    const batch = [];
    let chars = 0, qs = 0, i = from;
    while (i < entries.length) {
      const entry = entries[i];
      const a = analyzeEntry(entry.text, cfg);
      const block = labelled(entry, 3000);
      const need = a.units.length + 2;
      if (batch.length && (chars + block.length > MAX_STATE_CHARS || qs + need > MAX_QUESTIONS - MAX_WORD_QUESTIONS)) break;
      batch.push({ entry, ...a, units: a.units.slice(0, MAX_QUESTIONS - MAX_WORD_QUESTIONS - 2) });
      chars += block.length;
      qs += need;
      i++;
    }
    if (!batch.length) return null;
    const context = currentSceneBrief() + batch.map(b => labelled(b.entry, 3000)).join('\n\n');

    for (const b of batch) {
      for (const name of b.speakers) addEntity(name, 'person', 'speaker');
      registerIntros(b.intros);
    }

    // Jev 호출 A: 경계 · 시간 흐름 · 문장 종류 · 새 단어
    const qa = {};
    batch.forEach((b, k) => {
      if (b.entry.role !== 'assistant') return;
      if (state.open.scene) {
        qa[`b${k}`] = {
          type: 'choice',
          instructions: `How does this message start? «${clip(cleanText(stripMeta(b.entry.text)), 200)}»`,
          criteria: BOUNDARY,
        };
      }
      if (!b.status.d && !b.status.t) {
        qa[`f${k}`] = {
          type: 'choice',
          instructions: `Story time passed before this message? «${clip(cleanText(stripMeta(b.entry.text)), 200)}»`,
          criteria: TIME_FLOWS,
        };
      }
    });
    const units = batch.flatMap((b, bi) => b.units.map(u => ({ ...u, bi })));
    units.forEach((u, j) => {
      qa[`k${j}`] = {
        type: 'choice',
        instructions: `Long-term memory type of «${u.text}»`,
        criteria: KIND_OPTIONS,
      };
    });
    let words = [];
    if (cfg.classifyWords) {
      const pool = new Set();
      if (!state.loreSeeded) for (const w of state.loreQueue ?? []) pool.add(w);
      for (const u of units) for (const w of wordCandidates(u.text.replace(/^[^:]{1,15}:\s*/, ''))) pool.add(w);
      // 한 번 스쳐 간 단어는 묻지 않는다: 이 배치에서 두 번 이상 나왔거나, 부름말(○○ 씨/님/야)이거나, 로어북 키일 때만
      const lore = new Set(state.loreSeeded ? [] : state.loreQueue ?? []);
      const text = batch.map(b => cleanText(stripMeta(b.entry.text))).join('\n');
      const count = (w) => text.split(w).length - 1;
      const vocative = (w) => new RegExp(`${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(씨|님|야|아)(?![가-힣])`, 'u').test(text);
      words = [...pool].filter(w => !knownWord(w) && (lore.has(w) || count(w) >= 2 || vocative(w))).slice(0, MAX_WORD_QUESTIONS);
      words.forEach((w, j) => {
        qa[`e${j}`] = {
          type: 'choice',
          instructions: `What is «${w}» in this story?`,
          criteria: Object.fromEntries(Object.entries(ENTITY_TYPES).map(([k, v]) => [k, v.desc])),
        };
      });
    }
    return { batch, units, words, qa, context, end: i };
  }

  /** Jev A를 보낸다. 파이프라인이면 문장 임베딩도 동시에 미리 보낸다. */
  function sendBatch(job, cfg) {
    job.aPromise = Object.keys(job.qa).length ? callJev(job.context, job.qa, cfg).then(r => r.answers) : Promise.resolve({});
    job.aPromise.catch(() => {}); // 기다릴 때 다시 던진다. 미리 보낸 요청이 실패해도 경고만 남지 않게.
    if (PIPELINE && job.units.length) {
      job.embedPromise = embedTexts([...new Set(job.units.map(u => embedText(u.text, u.prev)))], cfg).then(vecs => ({ vecs }), error => ({ error }));
    }
  }

  /** Jev A 결과 반영: 사전 · 시계 · 장면 · 대단원 · 메모 후보 · 장면당 상한 */
  function applyA(job, A, cfg) {
    const { batch, units, words } = job;
    words.forEach((w, j) => {
      const p = choiceProbs(A[`e${j}`], Object.keys(ENTITY_TYPES));
      const type = argmax(p);
      if (type && type !== 'other' && p[type] >= 0.6) addEntity(w, type, 'jev');
      else rejSet.add(w);
    });
    if (words.length) state.loreSeeded = true;

    const touchedScenes = new Set();
    const touchedArcs = new Set();
    batch.forEach((b, k) => {
      const c = state.clock;
      const s = b.status;
      let boundary = 'continue';
      if (b.entry.role === 'assistant' && A[`b${k}`]) boundary = argmax(choiceProbs(A[`b${k}`], Object.keys(BOUNDARY))) ?? 'continue';
      if (s.d || s.t) {
        let d = s.d ?? c.d;
        let day = c.day;
        if (s.d && c.d) day += Math.max(0, dateToDays(s.d) - dateToDays(c.d));
        if (!s.d && s.t && c.t && toMinutes(s.t) + 60 < toMinutes(c.t)) { day += 1; if (d) d = addDays(d, 1); }
        if (day > c.day && boundary === 'continue') boundary = 'scene';           // 날이 바뀌면 최소한 새 장면
        if (day - c.day >= 7 && boundary === 'scene') boundary = 'arc';           // 일주일 넘게 뛰면 새 대단원
        state.clock = { d, t: s.t ?? (s.d ? null : c.t), place: s.place ?? c.place, approx: !s.d && c.approx, day };
      } else if (A[`f${k}`]) {
        const flow = argmax(choiceProbs(A[`f${k}`], Object.keys(TIME_FLOWS)));
        const jump = { next_day: 1, days: 3, weeks: 14 }[flow];
        if (flow === 'hours') state.clock = { ...c, t: null };
        else if (jump) {
          state.clock = { ...c, d: c.d ? addDays(c.d, jump) : null, t: null, day: c.day + jump, approx: c.approx || jump > 1 };
          if (boundary === 'continue') boundary = jump >= 14 ? 'arc' : 'scene';
        }
      }
      if (s.place && c.place && s.place !== c.place && boundary === 'continue') boundary = 'scene';
      if (s.place) state.clock.place = s.place;
      // 상태줄 없이 장면·대단원이 바뀌면 예전 장소를 끌고 가지 않는다. 메시지에 나온 장소 이름을 쓰거나 비워 둔다.
      else if (boundary === 'scene' || boundary === 'arc') state.clock.place = findEntities(cleanText(b.entry.text)).place[0] ?? null;
      b.flashback = boundary === 'flashback';
      if (!state.open.arc || !arcById(state.open.arc) || boundary === 'arc') openArc();
      if (!state.open.scene || !sceneById(state.open.scene) || boundary === 'scene' || boundary === 'arc') openScene();
      const scene = sceneById(state.open.scene);
      scene.turns++;
      if (!b.flashback) { scene.to = nowWhen(); scene.place = state.clock.place ?? scene.place; }
      b.scene = scene.id;
      b.arc = scene.arc;
      b.when = b.flashback ? null : nowWhen();
      b.place = state.clock.place;
      touchedScenes.add(scene.id);
      touchedArcs.add(scene.arc);
    });

    // 사건 메모 후보 → 장면마다 상위 N개만
    matcherCache = null;
    const recent = state.events.slice(-300).map(ev => ({ ev, g: gramsOf(ev) }));
    const added = [];
    units.forEach((u, j) => {
      const p = choiceProbs(A[`k${j}`], Object.keys(KIND_OPTIONS));
      const imp = Math.max(0, Math.min(1, 1 - p.trivial - 0.6 * p.minor));
      if (imp < cfg.saveThreshold / 100) return;
      const kind = argmax(Object.fromEntries(KIND_IDS.map(k => [k, p[k]]))) ?? 'event';
      const b = batch[u.bi];
      const found = findEntities(u.text);
      const who = [];
      let subj = null;
      if (u.speaker) who.push(canonical(u.speaker));
      else if (personaCache && b.entry.role === 'assistant' && NARRATOR_I.test(u.text)) who.push(canonical(personaCache));
      else {
        const sj = subjectOf(u.text);
        if (sj && state.dict.e[canonical(sj)]?.type === 'person') who.push(canonical(sj));
        else if (sj && !knownWord(sj)) subj = sj; // 처음 보는 주어: Jev B에게 이 사람이 주인공인지 묻는다
      }
      for (const pn of found.person) if (!who.includes(pn)) who.push(pn);
      const ev = addEvent({
        t: u.text, r: b.entry.role === 'user' ? 'u' : 'c', imp: Math.round(imp * 100) / 100, kind, who: who.slice(0, 4),
        place: found.place[0] ?? b.place ?? null, when: b.when, src: b.entry.key, scene: b.scene, arc: b.arc,
      }, recent);
      if (ev && subj) ev.subj = subj;
      if (ev && u.prev) ev.ctx = u.prev;
      if (ev) added.push(ev);
    });
    // 옷·상태는 사람마다 최신 하나만: 같은 사람의 예전 옷·상태 메모는 "지난 기억"으로
    for (const ev of added) {
      if (ev.kind !== 'outfit' || !ev.who[0]) continue;
      for (const o of state.events) if (o !== ev && o.kind === 'outfit' && !o.old && o.who[0] === ev.who[0] && o.id < ev.id) o.old = { by: ev.id, at: Date.now() };
    }
    const kept = capScenes(touchedScenes, cfg, new Set(added.map(e => e.id)));
    Object.assign(job, { added, fresh: added.filter(e => kept.has(e.id)), touchedScenes, touchedArcs });
  }

  /** 임베딩 붙이기 + Jev B(주인공 · 충돌/반복 · 압축) + 장면·대단원 갱신 + 처리 기록. 채팅이 바뀌었으면 false. */
  async function finishBatch(job, cfg, owner) {
    const { fresh, batch } = job;
    if (fresh.length) {
      try {
        let vecOfText;
        if (job.embedPromise) {
          const r = await job.embedPromise;
          if (r.error) throw r.error;
          const texts = [...new Set(job.units.map(u => embedText(u.text, u.prev)))];
          vecOfText = new Map(texts.map((t, i) => [t, r.vecs[i]]));
        } else {
          const vecs = await embedTexts(fresh.map(e => embedText(e.t, e.ctx)), cfg);
          vecOfText = new Map(fresh.map((e, i) => [embedText(e.t, e.ctx), vecs[i]]));
        }
        if (owner !== state) return false;
        const vp = embedProfile(cfg);
        for (const e of fresh) { const v = vecOfText.get(embedText(e.t, e.ctx)); if (v) { e.vec = encodeVec(v); e.vp = vp; } }
      } catch (error) {
        setError('임베딩', error); // 벡터 없이도 저장은 한다. 나중에 "임베딩 다시 계산"으로 채움
      }

      if (cfg.compress) for (const e of fresh) applyFreeTrim(e);
      const persons = personList();
      const whoAsk = fresh.filter(e => e.subj || (!e.who.length && e.kind !== 'world' && persons.length));
      const whoOptions = (e) => Object.fromEntries([
        ...persons.map(n => [n, n]),
        ...(e.subj ? [['__subj', `${e.subj} (a character named in the sentence)`]] : []),
        [WORLD, 'the world, a place, or a group'],
        ['__other', 'someone else'],
      ]);
      const qb = {};
      whoAsk.forEach((e, j) => { qb[`w${j}`] = { type: 'choice', instructions: `Main subject of «${e.t}»`, criteria: whoOptions(e) }; });
      const rec = cfg.supersede ? buildReconcile(fresh) : { pairs: [], questions: {} };
      Object.assign(qb, rec.questions);
      const comp = { plan: [], questions: {} }; // Jev 압축은 메모가 처음 쓰일 때 한다(compressRecalled)
      // 카드 칸: 형식(말·행동·규칙·소문…) · 시점(현재·과거·예정) · 대사가 누구 얘기인지
      const cardAsk = cfg.cards ? fresh.filter(e => e.kind !== 'outfit') : [];
      const aboutOpts = new Map();
      cardAsk.forEach((e, j) => {
        qb[`c${j}`] = { type: 'choice', instructions: `Form of «${e.t}»`, criteria: FORMS };
        qb[`n${j}`] = { type: 'choice', instructions: `Is «${e.t}» still true now?`, criteria: TENSES };
        const sp = /^([^:"“]{1,15}):\s/.exec(e.t)?.[1];
        if (!sp) return;
        const speaker = canonical(sp);
        const others = [...new Set([...e.who, ...(state.scene?.cast ?? [])])].filter(n => n !== speaker && state.dict.e[n]?.type === 'person').slice(0, 6);
        if (!others.length) return;
        const opts = { __self: `${speaker} (the speaker)`, ...Object.fromEntries(others.map(n => [n, n])), __world: 'a place, thing, or the world' };
        aboutOpts.set(j, { speaker, opts });
        qb[`o${j}`] = { type: 'choice', instructions: `Who or what is «${e.t}» mainly about?`, criteria: opts };
      });
      if (Object.keys(qb).length) {
        try {
          const B = (await callJev(job.context, qb, cfg)).answers;
          if (owner !== state) return false;
          whoAsk.forEach((e, j) => {
            const p = choiceProbs(B[`w${j}`], Object.keys(whoOptions(e)));
            if (e.subj && argmax(p) === '__subj' && p.__subj >= 0.5) {
              addEntity(e.subj, 'person', 'jev');
              const name = canonical(e.subj);
              e.who = [name, ...e.who.filter(w => w !== name)].slice(0, 4);
            } else if (!e.who.length) {
              e.who = persons.filter(n => p[n] >= 0.3).sort((a, b) => p[b] - p[a]).slice(0, 3);
            }
          });
          applyReconcile(rec.pairs, B);
          applyCompress(comp.plan, B);
          cardAsk.forEach((e, j) => {
            const pf = choiceProbs(B[`c${j}`], Object.keys(FORMS));
            const f = argmax(pf);
            if (f && pf[f] >= 0.35) e.form = f;
            const pt = choiceProbs(B[`n${j}`], Object.keys(TENSES));
            const t = argmax(pt);
            if (t && pt[t] >= 0.35) e.tense = t;
            const ab = aboutOpts.get(j);
            if (!ab) return;
            const pa = choiceProbs(B[`o${j}`], Object.keys(ab.opts));
            const a = argmax(pa);
            if (a && a !== '__self' && a !== '__world' && pa[a] >= 0.5) {
              e.about = a;
              e.who = [a, ...e.who.filter(w => w !== a)].slice(0, 4); // 남 얘기면 그 사람 밑으로
            }
          });
        } catch (error) {
          setError('메모 정리', error); // 실패해도 메모는 원문 그대로 남는다
        }
      }
    }
    for (const e of fresh) delete e.subj;
    for (const sid of job.touchedScenes) refreshScene(sceneById(sid));
    for (const aid of job.touchedArcs) refreshArc(arcById(aid));
    for (const b of batch) seenSet.add(b.entry.key);
    return true;
  }

  /**
   * entries(오래된 순)를 처리한다. 처리한 메시지는 seen에 들어간다. 처리를 끝낸 entries 개수를 돌려준다.
   * onBatch(done): 배치가 끝날 때마다 (진행 표시용)
   */
  async function ingest(entries, cfg = settings, maxBatches = BACKGROUND_BATCHES, onBatch = null) {
    const owner = state;
    let batches = 0;
    let done = 0;
    let cur = prepareBatch(entries, 0, cfg);
    if (cur) sendBatch(cur, cfg);
    try {
      while (cur) {
        const A = await cur.aPromise; // 실패하면 여기서 멈춘다(이 배치부터는 다음에 다시)
        if (owner !== state) return done;
        applyA(cur, A, cfg);
        batches++;
        // 다음 배치는 항상 여기서 준비한다(순차든 파이프라인이든 같은 입력). 파이프라인이면 바로 보낸다.
        const next = cur.end < entries.length && batches < maxBatches ? prepareBatch(entries, cur.end, cfg) : null;
        if (next && PIPELINE) sendBatch(next, cfg);
        if (!await finishBatch(cur, cfg, owner)) return done;
        if (next && !PIPELINE) sendBatch(next, cfg);
        done = cur.end;
        onBatch?.(done);
        if (batches % 10 === 0) { pruneGlobal(); await persist(); }
        cur = next;
      }
    } finally {
      if (owner === state) { pruneGlobal(); await persist(); }
    }
    return done;
  }

  const embedText = (text, ctx) => (ctx ? `${ctx} ${text}` : text);

  function addEvent(fields, recent) {
    const grams = bigrams(fields.t);
    for (const r of recent) {
      if (dice(grams, r.g) >= 0.85) {
        r.ev.imp = Math.max(r.ev.imp, fields.imp);
        for (const w of fields.who) if (!r.ev.who.includes(w)) r.ev.who.push(w);
        return null;
      }
    }
    const ev = { id: ++state.seq, ...fields, pin: false, hits: 0, lastHit: 0, at: Date.now(), vec: null, vp: null };
    state.events.push(ev);
    gramCache.set(ev.id, grams);
    recent.push({ ev, g: grams });
    return ev;
  }

  const rankOf = (e) => e.imp + (CORE_KINDS.has(e.kind) ? 0.1 : 0) + (e.pin ? 10 : 0);

  // 장면 경계가 잘 안 잡히는 채팅(상태줄 없음)은 한 장면이 수십 턴이 된다. 긴 장면은 메시지 4개마다 한 자리씩 더 준다.
  const sceneCap = (scene, cfg) => cfg.eventsPerScene + Math.floor(Math.max(0, (scene?.turns ?? 0) - 8) / 4);

  /** 장면마다 활성 메모를 상위 N개만 남긴다. 남은 것 중 이번에 새로 생긴 것의 id를 돌려준다. */
  function capScenes(sceneIds, cfg, newIds) {
    const drop = new Set();
    for (const sid of sceneIds) {
      const evs = state.events.filter(e => e.scene === sid && isActive(e) && e.kind !== 'outfit'); // 옷·상태는 사람당 하나라 상한에서 뺀다
      const cap = sceneCap(sceneById(sid), cfg);
      if (evs.length <= cap) continue;
      evs.sort((a, b) => rankOf(b) - rankOf(a) || b.id - a.id);
      // 상한을 넘은 것 중 아주 중요한 것은 상한의 2배까지 남긴다(정보가 몰린 장면에서 사실이 잘려 나가지 않게)
      let spare = cap;
      for (const e of evs.slice(cap)) { if (e.pin) continue; if (e.imp >= KEEP_IMP && spare > 0) { spare--; continue; } drop.add(e.id); }
    }
    if (drop.size) {
      state.events = state.events.filter(e => !drop.has(e.id));
      for (const id of drop) gramCache.delete(id);
    }
    return new Set([...newIds].filter(id => !drop.has(id)));
  }

  function pruneGlobal() {
    if (state.events.length <= MAX_EVENTS) return;
    const newest = state.seq || 1;
    const strength = (e) => (e.pin ? Infinity : (e.old ? -1 : 0) + e.imp * 0.5 + Math.min(e.hits, 10) * 0.03 + (e.id / newest) * 0.2);
    const sorted = [...state.events].sort((a, b) => strength(a) - strength(b));
    const drop = new Set(sorted.slice(0, state.events.length - MAX_EVENTS).map(e => e.id));
    state.events = state.events.filter(e => !drop.has(e.id));
  }

  function refreshScene(s) {
    if (!s) return;
    const evs = state.events.filter(e => e.scene === s.id && isActive(e));
    const count = new Map();
    for (const e of evs) for (const w of e.who) count.set(w, (count.get(w) ?? 0) + 1);
    s.cast = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 6);
  }

  // 키워드에서 뺄 것: 부사(~히, ~게), 꾸밈말로 끝난 동사(~간, ~던, ~된, ~진…), 접속·기능어
  const KW_STOP = /(히|게|간|던|된|진|난|친|운|른|한|는|은|을|던|면|서|고|며|지)$/u;
  const KW_STOP_WORDS = new Set(['대신', '원래', '사실', '이제', '아직', '벌써', '역시', '그대로', '모두', '전부', '정도', '때문', '이번', '다음', '먼저']);

  /** 대단원 카드: 등장인물, 장소, 키워드(메모 단어의 중요도 가중 빈도 ÷ 다른 대단원에도 흔한 정도), 대표 벡터 */
  function refreshArc(a) {
    if (!a) return;
    const evs = state.events.filter(e => e.arc === a.id && isActive(e));
    const scenes = a.sceneIds.map(sceneById).filter(Boolean);
    const cast = new Map(), places = new Map(), words = new Map(), wordEvents = new Map();
    for (const e of evs) {
      for (const w of e.who) cast.set(w, (cast.get(w) ?? 0) + 1 + e.imp);
      if (e.place) places.set(e.place, (places.get(e.place) ?? 0) + 1);
      for (const w of new Set(e.kind === 'outfit' ? [] : wordCandidates((e.c ?? e.t).replace(/^[^:]{1,15}:\s*/, '')).filter(x => !x.includes(' ')))) {
        // 옷·상태는 자주 바뀌어서 대단원 키워드로 쓰지 않는다
        if (state.dict.e[canonical(w)]?.type === 'person') continue; // 인물은 cast에 따로
        if (KW_STOP.test(w) || KW_STOP_WORDS.has(w)) continue;
        words.set(w, (words.get(w) ?? 0) + e.imp);
        wordEvents.set(w, (wordEvents.get(w) ?? 0) + 1);
      }
    }
    for (const s of scenes) if (s.place) places.set(s.place, (places.get(s.place) ?? 0) + 0.5);
    const df = (w) => state.arcs.filter(x => x !== a && x.kw?.includes(w)).length;
    a.cast = [...cast.entries()].sort((x, y) => y[1] - x[1]).map(([n]) => n).slice(0, 6);
    a.places = [...places.entries()].sort((x, y) => y[1] - x[1]).map(([n]) => n).slice(0, 4);
    a.kw = [...words.entries()].filter(([w]) => evs.length < 4 || wordEvents.get(w) >= 2).map(([w, v]) => [w, v / (1 + df(w))]).sort((x, y) => y[1] - x[1]).map(([w]) => w).slice(0, 8);
    if (scenes.length) { a.from = scenes[0].from; a.to = scenes[scenes.length - 1].to; }
    const vecs = evs.map(vecOf).filter(Boolean);
    if (vecs.length) {
      const sum = new Float32Array(vecs[0].length);
      for (const v of vecs) for (let i = 0; i < v.length; i++) sum[i] += v[i];
      a.vec = encodeVec(normalize(sum));
      a.vp = embedProfile();
    } else {
      a.vec = null;
      a.vp = null;
    }
  }

  // ── 충돌 · 반복 ──

  function buildReconcile(added) {
    const all = state.events.filter(isActive);
    const pairs = [];
    for (const neu of added) {
      const pool = all.filter(o => o.id < neu.id);
      if (!pool.length) continue;
      const peers = new Map();
      if (neu.who.length && neu.kind !== 'event') {
        pool.filter(o => o.kind === neu.kind && o.who.some(w => neu.who.includes(w)))
          .sort((a, b) => b.id - a.id).slice(0, 2).forEach(o => peers.set(o.id, o));
      }
      const nv = vecOf(neu);
      const g = gramsOf(neu);
      pool.map(o => ({ o, s: Math.max(dice(g, gramsOf(o)), nv ? dot(nv, vecOf(o) ?? new Float32Array(0)) - 0.5 : 0) }))
        .filter(x => x.s >= 0.25).sort((a, b) => b.s - a.s).slice(0, 2).forEach(x => peers.set(x.o.id, x.o));
      for (const old of peers.values()) pairs.push({ neu, old });
    }
    const used = pairs.slice(0, 30);
    const questions = {};
    used.forEach((p, k) => {
      const both = `OLD: «${p.old.t}»\nNEW: «${p.neu.t}»`;
      questions[`x${k}`] = { type: 'noul', instructions: `NEW happened after OLD. Is OLD now outdated or contradicted?\n${both}` };
      questions[`d${k}`] = { type: 'noul', instructions: `Does NEW only repeat OLD?\n${both}` };
    });
    return { pairs: used, questions };
  }

  function applyReconcile(used, answers) {
    const dropped = new Set();
    used.forEach((p, k) => {
      if (dropped.has(p.neu.id) || p.old.old || !state.events.includes(p.old)) return;
      if (noulProb(answers[`x${k}`]) >= SUPERSEDE_P) p.old.old = { by: p.neu.id, at: Date.now() };
      else if (noulProb(answers[`d${k}`]) >= DUPLICATE_P) { p.old.imp = Math.max(p.old.imp, p.neu.imp); dropped.add(p.neu.id); }
    });
    if (dropped.size) state.events = state.events.filter(e => !dropped.has(e.id));
  }

  // ── 단어 고르기 압축 ──

  /**
   * Jev 단어 고르기 압축은 메모가 처음 실제로 주입됐을 때만 한다.
   * 대부분의 메모는 한 번도 안 꺼내지므로, 저장할 때 전부 압축하는 것보다 토큰이 훨씬 적다.
   */
  async function compressRecalled(cfg = settings) {
    if (!cfg.compress) return;
    const ids = new Set((state.lastRecall?.picks ?? []).map(p => p.id));
    const todo = state.events.filter(e => ids.has(e.id) && !e.cz && (e.c ?? e.t).length >= COMPRESS_MIN_CHARS);
    if (!todo.length) return;
    const owner = state;
    const comp = buildCompress(todo, MAX_COMPRESS_QUESTIONS);
    if (!comp.plan.length) { for (const e of todo) e.cz = true; return; }
    const { answers } = await callJev('[MEMORY NOTES]\n' + comp.plan.map(p => p.e.t).join('\n'), comp.questions, cfg);
    if (owner !== state) return;
    applyCompress(comp.plan, answers);
    for (const p of comp.plan) p.e.cz = true;
    await persist();
  }

  function applyFreeTrim(e) {
    const c = freeTrim(e.t);
    if (c.length < e.t.length - 1) e.c = c;
    else delete e.c;
  }

  const NEGATION = /^(안|못|않|없|아니|아닌|말고|never|not|no|don't|didn't|can't|won't)/iu;

  function buildCompress(evs, budget) {
    const plan = [];
    const questions = {};
    let used = 0;
    for (const e of [...evs].sort((a, b) => (b.c ?? b.t).length - (a.c ?? a.t).length)) {
      const base = e.c ?? e.t;
      if (base.length < COMPRESS_MIN_CHARS) continue;
      const parts = splitDialogue(base);
      const toks = parts.body.split(/\s+/).filter(Boolean);
      const ask = toks.map((_, i) => i).filter(i => {
        if (i === toks.length - 1) return false;
        const core = toks[i].replace(/[^\p{L}\p{N}'-]/gu, '');
        if (!core || /\d/.test(core) || NEGATION.test(core)) return false;
        const f = findEntities(toks[i]);
        return !(f.person.length || f.place.length || f.item.length);
      });
      if (!ask.length || used + ask.length > budget) continue;
      const entry = { e, parts, toks, keys: [] };
      for (const i of ask) {
        const key = `z${plan.length}_${i}`;
        questions[key] = {
          type: 'noul',
          instructions: `Can ⟦${toks[i]}⟧ be deleted without losing a story fact? «${toks.map((t, j) => (j === i ? `⟦${t}⟧` : t)).join(' ')}»`,
        };
        entry.keys.push([i, key]);
      }
      used += ask.length;
      plan.push(entry);
    }
    return { plan, questions };
  }

  function applyCompress(plan, answers) {
    for (const p of plan) {
      if (!state.events.includes(p.e)) continue;
      const drop = new Set(p.keys.filter(([, k]) => noulProb(answers[k]) >= COMPRESS_DELETE_P).map(([i]) => i));
      if (!drop.size) continue;
      const body = tidy(p.toks.filter((_, i) => !drop.has(i)).join(' '));
      if (body.length < 4 || 1 - body.length / p.parts.body.length > COMPRESS_MAX_RATIO) continue;
      const c = p.parts.head + body + p.parts.tail;
      if (c.length < p.e.t.length) p.e.c = c;
    }
  }

  /** 임베딩 설정을 바꾼 뒤 옛 벡터를 새로 계산한다. */
  async function reembedAll(onProgress) {
    const owner = state;
    const vp = embedProfile();
    const todo = state.events.filter(e => e.vp !== vp);
    for (let i = 0; i < todo.length; i += EMBED_CHUNK) {
      const chunk = todo.slice(i, i + EMBED_CHUNK);
      const vecs = await embedTexts(chunk.map(e => embedText(e.t, e.ctx)));
      if (owner !== state) return;
      chunk.forEach((e, j) => { e.vec = encodeVec(vecs[j]); e.vp = vp; });
      onProgress?.(Math.min(todo.length, i + EMBED_CHUNK), todo.length);
    }
    for (const a of state.arcs) refreshArc(a);
    await persist();
  }

  // ══════════════════════════════════════════════════════════════════════
  //  읽기: 대단원 → 사건 메모 (Jev 1회)
  // ══════════════════════════════════════════════════════════════════════

  const recallCache = new Map();
  const queryVecCache = new Map();

  const TIME_HINTS = [
    [/어제|어젯밤|전날|yesterday|last\s+night/iu, 1, 1],
    [/그저께|그제|day\s+before\s+yesterday/iu, 2, 2],
    [/며칠\s*전|요\s*며칠|few\s+days\s+ago/iu, 2, 6],
    [/지난\s*주|저번\s*주|일주일\s*전|last\s+week|a\s+week\s+ago/iu, 6, 14],
    [/지난\s*달|저번\s*달|한\s*달\s*전|last\s+month|a\s+month\s+ago/iu, 25, 62],
    [/작년|지난\s*해|일\s*년\s*전|last\s+year|a\s+year\s+ago/iu, 300, 430],
  ];

  function readScene(entries, cfg) {
    const recent = entries.slice(-QUERY_MESSAGES);
    const queryText = recent.map(e => cleanText(e.text)).join('\n');
    const lastTwo = entries.slice(-2).map(e => cleanText(e.text)).join('\n');
    const cast = new Set(findEntities(lastTwo).person);
    if (cfg.parseSpeakers) for (const line of lastTwo.split('\n')) { const sp = parseSpeakerLine(line); if (sp) cast.add(canonical(sp.name)); }
    const found = findEntities(queryText);
    const latest = entries.slice(-1).map(e => cleanText(e.text)).join('\n');
    const now = state.clock.day ?? 1;
    const ranges = TIME_HINTS.filter(([re]) => re.test(latest)).map(([, from, to]) => [now - to, now - from]);
    const firstMeet = /처음\s*(만났|봤)|첫\s*만남|first\s+(met|time\s+we\s+met)/iu.test(latest);
    const place = state.clock.place ?? findEntities(lastTwo).place[0] ?? null;
    // 질문은 최신 메시지가 중심이다. 최근 장면은 끝부분만(앞부분을 쓰면 긴 메시지에서 최신 메시지가 잘려 나간다).
    return { cast: [...cast], persons: found.person, places: found.place, items: found.item, d: state.clock.d, t: state.clock.t, day: state.clock.day, place, ranges, firstMeet, queryText, focusText: latest, contextText: queryText.slice(-1500) };
  }

  function sceneHeader(sc) {
    const parts = [];
    const when = formatWhen({ d: sc.d, t: sc.t, day: sc.day }, true);
    if (when) parts.push(`time: ${when}`);
    if (sc.place) parts.push(`place: ${sc.place}`);
    if (sc.cast.length) parts.push(`present: ${sc.cast.join(', ')}`);
    return parts.length ? `[SCENE] ${parts.join(' · ')}\n\n` : '';
  }

  function eventLabel(e) {
    const a = arcById(e.arc);
    const bits = [KINDS[e.kind]?.label ?? '사건', e.who.join(', '), formatWhen(e.when, true), e.place, e.form, e.old ? 'past' : e.tense].filter(Boolean);
    return `(${bits.join(' · ')}${a ? ` · ${arcTitle(a)}` : ''}) ${clip(e.t, 200)}`; // 후보마다 붙으니 긴 묘사는 자른다
  }

  function arcCardText(a) {
    return [arcTitle(a), fmtSpan(a.from, a.to),
      a.cast.length && `cast: ${a.cast.join(', ')}`, a.places.length && `places: ${a.places.join(', ')}`, a.kw.length && `keywords: ${a.kw.join(', ')}`]
      .filter(Boolean).join(' · ');
  }

  /** Jev 점수 답 → 0~1. score가 없으면 확률 기대값, 그것도 없으면 noul. */
  function rankProb(a) {
    const max = RANK_LEVELS.length - 1;
    if (Number.isFinite(Number(a?.score))) return Math.max(0, Math.min(1, Number(a.score) / max));
    const pr = a?.probabilities;
    if (pr && typeof pr === 'object' && Object.keys(pr).length) {
      let sum = 0, tot = 0;
      for (const [k, v] of Object.entries(pr)) { const lv = Number.isFinite(Number(k)) ? Number(k) : RANK_LEVELS.indexOf(k); if (lv >= 0) { sum += lv * Number(v); tot += Number(v); } }
      if (tot > 0) return Math.max(0, Math.min(1, sum / tot / max));
    }
    return noulProb(a);
  }
  const rankQuestion = (e) => ({ type: 'score', instructions: `How useful for replying to the latest message? «${eventLabel(e)}»`, criteria: RANK_LEVELS });

  async function queryVector(text, cfg) {
    const key = hashText(embedProfile(cfg) + '|' + text);
    if (queryVecCache.has(key)) return queryVecCache.get(key);
    const [v] = await embedTexts([text], cfg);
    queryVecCache.set(key, v);
    if (queryVecCache.size > 30) queryVecCache.delete(queryVecCache.keys().next().value);
    return v;
  }

  /** 질문 벡터: 최신 메시지 0.6 + 최근 장면 끝부분 0.4. 최신 메시지가 짧은 질문이어도 묻히지 않게. */
  async function sceneVector(sc, cfg) {
    const focus = clip(sc.focusText.trim(), 1000);
    if (focus.length < 4 || sc.contextText.endsWith(focus) && sc.contextText.length - focus.length < 40) return queryVector(sc.contextText, cfg);
    const [f, c] = await Promise.all([queryVector(focus, cfg), queryVector(sc.contextText, cfg)]);
    return normalize(f.map((x, i) => x * 0.6 + (c[i] ?? 0) * 0.4));
  }

  /**
   * 현재 챗 → (임베딩) 대단원 후보 → 그 안의 메모 후보 → Jev 1회 → 고른 메모
   * dry: true면 회상 횟수 등을 바꾸지 않는다(질문 넣어보기).
   */
  async function recall(entries, visibleHashes, cfg = settings, { dry = false } = {}) {
    const started = Date.now();
    const sc = readScene(entries, cfg);
    const trace = { at: Date.now(), query: clip(sc.focusText, 400), arcs: [], cands: [], usedJev: false, usedEmbed: false, ms: 0, note: '' };
    const pool = state.events.filter(e => isActive(e) && !visibleHashes.has(e.src));
    if (!pool.length || cfg.recallBudget === 0) { trace.note = pool.length ? '회상 꺼짐' : '아직 꺼낼 메모가 없어요'; return { picks: [], trace, sc }; }

    const queryState = (sceneHeader(sc) + entries.slice(-QUERY_MESSAGES).map(e => labelled(e)).join('\n\n')).slice(-RECALL_STATE_CHARS);
    let qv = null;
    try { qv = await sceneVector(sc, cfg); trace.usedEmbed = true; }
    catch (error) { setError('질문 임베딩', error); }

    const qGrams = bigrams(sc.contextText);
    const fGrams = bigrams(sc.focusText);
    // 단어 겹침: 최신 메시지와는 양방향(짧은 질문을 메모가 얼마나 덮는지도), 최근 장면과는 약하게
    const lexOf = (g) => Math.max((coverage(g, fGrams) + coverage(fGrams, g)) / 2, coverage(g, qGrams) * 0.6);
    const named = new Set([...sc.cast, ...sc.persons]);
    const asked = new Set(findEntities(sc.focusText).person);
    const placeSet = new Set([...sc.places, sc.place].filter(Boolean));

    // ── 1단계: 대단원 ──
    const poolArcs = new Set(pool.map(e => e.arc));
    const arcScores = state.arcs.filter(a => poolArcs.has(a.id)).map(a => {
      const av = vecOf(a);
      const sem = qv && av ? Math.max(0, dot(qv, av)) : 0;
      const castHit = a.cast.filter(n => named.has(n)).length / Math.max(1, Math.min(3, named.size || 1));
      const lex = lexOf(bigrams(a.kw.join(' ') + ' ' + a.places.join(' ')));
      const open = a.id === state.open.arc ? 0.15 : 0;
      const s = (av && qv ? sem * 0.55 : lex * 0.4) + Math.min(1, castHit) * 0.25 + lex * 0.15 + open;
      return { a, s };
    }).sort((x, y) => y.s - x.s);
    const chosenArcs = arcScores.slice(0, cfg.arcs);
    const chosenIds = new Set(chosenArcs.map(x => x.a.id));

    // ── 2단계: 메모 후보 ──
    const coreOfCast = (e) => CORE_KINDS.has(e.kind) && e.who.some(w => sc.cast.includes(w));
    const inRange = (e) => Number.isFinite(e.when?.day) && sc.ranges.some(([a, b]) => e.when.day >= a && e.when.day <= b);
    const scored = pool.map(e => {
      const ev = vecOf(e);
      const sem = qv && ev ? Math.max(0, dot(qv, ev)) : 0;
      const lex = lexOf(gramsOf(e));
      const ent = (e.who.some(w => named.has(w)) ? 1 : 0) * 0.6 + (e.place && placeSet.has(e.place) ? 0.4 : 0) + (e.who.some(w => asked.has(w)) ? 0.5 : 0);
      const base = (ev && qv ? sem * 0.5 + lex * 0.15 : lex * 0.5) + ent * 0.2 + e.imp * 0.1 + (chosenIds.has(e.arc) ? 0.1 : 0);
      return { e, s: base + (e.pin ? 5 : 0) + (coreOfCast(e) ? 0.15 : 0) + (inRange(e) ? 0.3 : 0) + (sc.firstMeet ? (1 - e.id / (state.seq || 1)) * 0.2 : 0), sem, lex };
    });
    // 고른 대단원 안의 것 + (어느 대단원이든) 고정·등장인물 핵심·날짜 범위
    const inChosen = scored.filter(x => chosenIds.has(x.e.arc) || x.e.pin || coreOfCast(x.e) || inRange(x.e));
    const cands = (inChosen.length >= Math.min(8, scored.length) ? inChosen : scored).sort((x, y) => y.s - x.s).slice(0, cfg.candidates);

    // ── Jev 1회: 대단원 고르기 + 메모 필요? ──
    const cacheKey = hashText(queryState + '|' + cands.map(x => x.e.id).join(',') + '|' + chosenArcs.map(x => x.a.id).join(','));
    let judged = dry ? null : recallCache.get(cacheKey);
    if (judged) { trace.usedJev = true; }
    else {
      try {
        const q = {};
        const arcOpts = {};
        chosenArcs.forEach((x, k) => { arcOpts[`a${k}`] = arcCardText(x.a); });
        if (chosenArcs.length > 1) {
          q.arc = { type: 'choice', instructions: 'Most relevant past chapter for the current scene?', criteria: { ...arcOpts, none: 'none of these' } };
        }
        for (const x of cands) q[`r${x.e.id}`] = rankQuestion(x.e);
        // 후보에 없는 근거가 필요해 보이면 그 목적으로 한 번 더 찾는다(Archive Center 방식)
        if (pool.length > cands.length) q.need = { type: 'choice', instructions: 'Which earlier record, if any, is still missing to answer the latest message?', criteria: SEARCH_NEEDS };
        const { answers } = await callJev(queryState, q, cfg);
        const pArc = q.arc ? choiceProbs(answers.arc, [...Object.keys(arcOpts), 'none']) : { a0: 1 };
        const arcP = new Map(chosenArcs.map((x, k) => [x.a.id, pArc[`a${k}`] ?? 0]));
        const maxArc = Math.max(0.0001, ...arcP.values());
        const judge = (list, ans) => list.map(x => {
          const pm = rankProb(ans[`r${x.e.id}`]);
          const pa = arcP.has(x.e.arc) ? arcP.get(x.e.arc) / maxArc : 0.5;
          return { ...x, pm, p: pm * (0.75 + 0.25 * pa) };
        });
        judged = judge(cands, answers);
        const need = q.need ? argmax(choiceProbs(answers.need, Object.keys(SEARCH_NEEDS))) : null;
        if (need && need !== 'none') {
          trace.need = need;
          const seenIds = new Set(cands.map(x => x.e.id));
          const nq = `${NEED_QUERY[need] ?? ''} ${clip(sc.focusText, 600)}`;
          let nv = null;
          try { nv = await queryVector(nq, cfg); } catch { /* 단어 겹침만으로 */ }
          const ng = bigrams(nq);
          const extra = pool.filter(e => !seenIds.has(e.id)).map(e => {
            const ev = vecOf(e);
            const sem = nv && ev ? Math.max(0, dot(nv, ev)) : 0;
            const lex = (coverage(gramsOf(e), ng) + coverage(ng, gramsOf(e))) / 2;
            return { e, s: (nv && ev ? sem * 0.7 : 0) + lex * 0.5, sem, lex, second: true };
          }).sort((a, b) => b.s - a.s).slice(0, SECOND_SEARCH);
          if (extra.length) {
            const q2 = Object.fromEntries(extra.map(x => [`r${x.e.id}`, rankQuestion(x.e)]));
            const a2 = (await callJev(queryState, q2, cfg)).answers;
            judged.push(...judge(extra, a2));
          }
        }
        trace.usedJev = true;
        trace.arcP = Object.fromEntries(arcP);
        if (!dry) { recallCache.set(cacheKey, judged); if (recallCache.size > 20) recallCache.delete(recallCache.keys().next().value); }
      } catch (error) {
        setError('회상 판정', error);
        // Jev가 안 되면: 임베딩/단어 겹침 점수가 충분히 높은 것만 조금
        judged = cands.map(x => ({ ...x, pm: null, p: x.e.pin ? 1 : (qv ? x.sem : x.lex) >= (qv ? 0.5 : 0.35) ? 0.6 : 0 }));
      }
    }

    // ── 선택 ──
    const threshold = (e) => cfg.recallThreshold / 100 * (coreOfCast(e) ? CORE_FACTOR : 1);
    const ordered = [...judged.filter(x => x.e.pin), ...judged.filter(x => !x.e.pin && x.p >= threshold(x.e)).sort((a, b) => b.p - a.p)];
    const picks = [];
    let budget = cfg.recallBudget;
    for (const x of ordered) {
      const cost = estimateTokens(lineText(x.e, cfg)) + 6;
      if (cost > budget) continue;
      if (!x.e.pin && picks.some(p => dice(gramsOf(p.e), gramsOf(x.e)) >= DIVERSITY_DICE)) continue;
      budget -= cost;
      picks.push(x);
    }
    // 지금 장면에 나온 인물의 최신 옷·상태는 (원문에서 잘려 나갔다면) 항상 넣는다. 장면이 이어질 때 옷이 바뀌는 실수를 막는다.
    for (const name of sc.cast) {
      const o = pool.filter(e => e.kind === 'outfit' && e.who[0] === name && e.arc === state.open.arc).sort((a, b) => b.id - a.id)[0];
      if (!o || picks.some(x => x.e === o)) continue;
      const cost = estimateTokens(lineText(o, cfg)) + 6;
      if (cost > budget) continue;
      budget -= cost;
      picks.push({ e: o, s: 1, pm: null, p: 1, forced: true });
    }
    picks.sort((a, b) => a.e.id - b.e.id);
    const pickIds = new Set(picks.map(x => x.e.id));
    trace.arcs = arcScores.slice(0, 6).map(x => ({ id: x.a.id, title: arcTitle(x.a), s: round2(x.s), chosen: chosenIds.has(x.a.id), p: trace.arcP?.[x.a.id] != null ? round2(trace.arcP[x.a.id]) : null }));
    trace.cands = judged.map(x => ({ id: x.e.id, s: round2(x.s), p: x.pm == null ? null : round2(x.p), pick: pickIds.has(x.e.id), second: !!x.second })).sort((a, b) => (b.p ?? -1) - (a.p ?? -1));
    trace.ms = Date.now() - started;
    return { picks, trace, sc };
  }

  const round2 = (n) => Math.round(n * 100) / 100;
  const fmtTokens = (n) => (n >= 1000 ? `~${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`);
  /** 기간 표시: 같은 날이면 한 번만 */
  function fmtSpan(from, to) {
    const a = formatWhen(from, true), b = formatWhen(to, true);
    if (!a) return b;
    if (!b || a === b || a.split(' ')[0] === b.split(' ')[0]) return a;
    return `${a} – ${b}`;
  }

  function lineText(e, cfg = settings) {
    const text = cfg.injectStyle === 'original' ? e.t : (e.c ?? e.t);
    return e.kind === 'outfit' ? outfitSnippet(text) : text;
  }

  // 옷·상태 메모가 긴 묘사 문장이면 옷·상태가 나온 마디만 남긴다.
  const WEAR = /(입고|입은|입었|걸치|걸친|벗|옷|셔츠|블라우스|치마|스커트|바지|반바지|드레스|교복|정장|잠옷|속옷|원피스|코트|외투|재킷|자켓|후드|니트|스타킹|양말|신발|구두|운동화|부츠|맨발|모자|안경|장갑|목도리|머리띠|리본|앞치마|수영복|비키니|젖은|젖어|찢어|다친|붕대|wearing|wore|dress|shirt|skirt|pants|jacket|coat|shoes|uniform)/iu;
  function outfitSnippet(text) {
    if (text.length <= 100) return text;
    const parts = text.split(/(?<=[,.!?])\s+|(?<=(?:며|면서|고|채))\s+/u).filter(Boolean);
    const keep = parts.filter(p => WEAR.test(p));
    return clip((keep.length ? keep : parts.slice(0, 1)).join(' '), 140);
  }

  function formatMemories(picks, sc, cfg = settings) {
    const arc = arcById(state.open.arc);
    const arcLine = arc && (arc.kw.length || arc.cast.length)
      ? `<current chapter> ${arc.title || `#${state.arcs.indexOf(arc) + 1}`}${whenTag(arc.from) ? ` · from ${whenTag(arc.from)}` : ''}${arc.places.length ? ` · ${arc.places.slice(0, 2).join(', ')}` : ''}${arc.kw.length ? ` · ${arc.kw.slice(0, 6).join(', ')}` : ''}`
      : '';
    if (!picks.length && !arcLine) return '';
    const label = cfg.injectLabel;
    const line = (e, group) => {
      const w = cfg.showStoryTime ? whenTag(e.when) : '';
      let text = lineText(e, cfg);
      const sp = /^([^:"“]{1,15}):\s/.exec(text);
      if (sp) {
        const canon = canonical(sp[1]);
        text = canon === group ? text.slice(sp[0].length) : `${canon}: ${text.slice(sp[0].length)}`;
      }
      const tags = [];
      if (e.r === 'u') tags.push('user');
      if (e.form && FORM_TAG[e.form]) tags.push(FORM_TAG[e.form]);
      if (e.old || e.tense === 'past') tags.push('past');
      else if (e.tense === 'future') tags.push('planned');
      else if (e.tense === 'current' && (e.form === 'state' || e.form === 'rule' || e.form === 'plan')) tags.push('current');
      // 앞 문장은 메모에 이름(인물·장소·물건)이 하나도 없어서 무엇에 관한 말인지 모를 때만 붙인다
      const bare = (() => { const f = findEntities(text.replace(/^[^:"“]{1,15}:s/, '')); return !f.person.length && !f.place.length && !f.item.length; })();
      const ctx = cfg.cards && e.ctx && bare && !pickedTexts.has(e.ctx) ? ` (context: ${clip(e.ctx, 60)})` : '';
      return `- ${w ? `[${w}] ` : ''}${tags.length ? `(${tags.join(', ')}) ` : ''}${text}${ctx}`;
    };
    const pickedTexts = new Set(picks.map(x => clip(x.e.t, 90)));
    const groups = new Map();
    for (const { e } of picks) {
      const key = e.who[0] ?? (e.kind === 'world' ? WORLD : '기타');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    const cast = new Set(sc?.cast ?? []);
    const order = [...groups.keys()].sort((a, b) => (a === WORLD) - (b === WORLD) || (a === '기타') - (b === '기타') || cast.has(b) - cast.has(a));
    const groupName = (k) => (k === WORLD ? 'World' : k === '기타' ? 'Other' : k);
    const body = order.map(k => `<${groupName(k)}>\n${groups.get(k).map(e => line(e, k)).join('\n')}`).join('\n');
    const note = cfg.note && cfg.translate !== 'off' ? `${cfg.note} Names may be romanized.` : cfg.note;
    return [`[${label}]`, note, arcLine, body, `[/${label}]`].filter(Boolean).join('\n');
  }

  // 메모 줄만 영어로. 같은 줄은 이번 실행 동안만 기억해 두고 다시 번역하지 않는다(저장하지 않음).
  const transCache = new Map();
  const HANGUL = /[가-힣]/;
  async function viaDeepl(texts, cfg) {
    const key = cleanKey(cfg.translateKey);
    if (!key) throw new Error('DeepL 키가 비어 있어요.');
    const host = /:fx$/.test(key) ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
    const data = await fetchJson(`${host}/v2/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `DeepL-Auth-Key ${key}` }, body: JSON.stringify({ text: texts, target_lang: 'EN-US' }) }, TRANSLATE_TIMEOUT_MS, 'DeepL');
    return texts.map((_, i) => String(data?.translations?.[i]?.text ?? ''));
  }
  async function viaGoogle(texts) {
    const out = [];
    for (let i = 0; i < texts.length;) {
      const chunk = [];
      let len = 0;
      while (i < texts.length && (chunk.length === 0 || len + texts[i].length < 1500)) { len += texts[i].length + 1; chunk.push(texts[i++]); }
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(chunk.join('\n'))}`;
      const data = await fetchJson(url, { method: 'GET' }, TRANSLATE_TIMEOUT_MS, '구글 번역');
      const parts = (Array.isArray(data?.[0]) ? data[0] : []).map(seg => (Array.isArray(seg) ? String(seg[0] ?? '') : '')).join('').split('\n');
      out.push(...(parts.length === chunk.length ? parts.map(p => p.trim()) : chunk.map(() => ''))); // 줄이 안 맞으면 그 묶음은 원문
    }
    return out;
  }
  async function viaLlm(texts, cfg) {
    const key = cleanKey(cfg.translateKey || (cfg.jevPreset === 'openrouter' ? cfg.jevKey : ''));
    if (!key) throw new Error('LLM 번역 키가 비어 있어요. (OpenRouter 키)');
    const data = await fetchJson('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: cfg.translateModel || DEFAULT_SETTINGS.translateModel, temperature: 0,
        messages: [
          { role: 'system', content: 'Translate each numbered line into concise English. Keep the numbering and the number of lines. Fix choppy wording, but do not add facts or explanations.' },
          { role: 'user', content: texts.map((t, i) => `${i + 1}. ${t}`).join('\n') },
        ],
      }),
    }, TRANSLATE_TIMEOUT_MS * 2, 'LLM 번역');
    const got = new Map();
    for (const line of String(data?.choices?.[0]?.message?.content ?? '').split('\n')) { const m = /^\s*(\d+)[.)]\s*(.+)$/.exec(line); if (m) got.set(Number(m[1]), m[2].trim()); }
    return texts.map((_, i) => got.get(i + 1) ?? '');
  }
  async function translateBlock(block, cfg = settings) {
    if (!block || cfg.translate === 'off') return block;
    const lines = block.split('\n');
    const slots = [];
    lines.forEach((l, i) => {
      const m = /^(- (?:\[[^\]]*\] )?(?:\([^)]*\) )?)(.+)$/.exec(l);
      if (m && HANGUL.test(m[2])) slots.push({ i, head: m[1], text: m[2] });
    });
    if (!slots.length) return block;
    try {
      const need = [...new Set(slots.map(x => x.text).filter(t => !transCache.has(t)))];
      if (need.length) {
        const fn = cfg.translate === 'deepl' ? viaDeepl : cfg.translate === 'llm' ? viaLlm : viaGoogle;
        const out = await fn(need, cfg);
        need.forEach((t, k) => { if (out[k]) transCache.set(t, out[k]); });
        while (transCache.size > 800) transCache.delete(transCache.keys().next().value);
      }
      for (const x of slots) lines[x.i] = x.head + (transCache.get(x.text) ?? x.text);
      stats.translatedLines = (stats.translatedLines ?? 0) + slots.length;
    } catch (error) {
      setError('번역', error); // 실패하면 한국어 그대로 보낸다
    }
    return lines.join('\n');
  }

  function inject(messages, block, cfg = settings) {
    const out = messages.map(m => ({ ...m }));
    let placed = false;
    for (const m of out) {
      if (typeof m.content === 'string' && m.content.search(PLACEHOLDER) >= 0) {
        m.content = m.content.replace(PLACEHOLDER, () => (placed ? '' : (placed = true, block)));
      }
    }
    if (placed || !block) return out;
    let last = -1;
    for (let i = out.length - 1; i >= 0; i--) if (out[i].removable === true && (out[i].role === 'user' || out[i].role === 'assistant')) { last = i; break; }
    if (cfg.injectMode === 'last_user' && last >= 0 && out[last].role === 'user' && typeof out[last].content === 'string') out[last].content = `${block}\n\n${out[last].content}`;
    else if (last >= 0) out.splice(last, 0, { role: 'system', content: block });
    else out.push({ role: 'system', content: block });
    return out;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  훅
  // ══════════════════════════════════════════════════════════════════════

  let lastEntries = null;   // 마지막 요청의 채팅 메시지 (질문 넣어보기 · 지금 전부 처리에 씀)
  let job = null;           // 백그라운드 작업 (하나만)
  let busy = false;

  /** 원문으로 남길 범위: 최근부터 토큰 예산까지(최소 minRaw개). 그 앞은 "밖". */
  function splitRaw(entries, cfg) {
    let tokens = 0;
    let keep = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      const t = estimateTokens(entries[i].text);
      if (keep >= cfg.minRaw && tokens + t > cfg.rawBudget) break;
      tokens += t;
      keep++;
    }
    return { outside: entries.slice(0, entries.length - keep), inside: entries.slice(entries.length - keep) };
  }

  const ready = (cfg = settings) => cfg.enabled && !!cfg.jevKey;

  async function beforeRequestHandler(messages, type) {
    if ((type !== 'model' && type !== 'main') || busy) return messages;
    busy = true;
    try {
      if (!ready() || !await ensureChat() || state.off) return messages;
      const cfg = settings;
      const entries = chatEntries(messages);
      const raw = rawEntries();
      alignKeys(entries, raw);
      for (const e of entries) isSeen(e); // 1.0.0 기록을 새 키로 옮김
      state.turn = (state.turn ?? 0) + 1;
      if (cfg.rejAutoClear && state.turn - (state.rejClearedTurn ?? 0) >= cfg.rejClearEvery) { rejSet = new Set(); state.rejClearedTurn = state.turn; }
      lastEntries = { key: chatKey, entries, raw };
      const { outside } = splitRaw(entries, cfg);

      // 잘라내야 하는 메시지가 "다음 처리 순서"의 맨 앞이면 지금 처리한다.
      // 더 오래된 메시지가 밀려 있으면 순서를 지키려고 기다린다(그동안은 원문 그대로 보냄).
      if (!job) {
        const outsideKeys = new Set(outside.map(e => e.key));
        const now = [];
        for (const t of (raw.length ? ingestTargets(raw) : outside.filter(e => !isSeen(e)))) {
          if (!outsideKeys.has(t.key)) break;
          now.push(t);
        }
        if (now.length) {
          try { await ingest(now, cfg, SYNC_BATCHES); }
          catch (error) { setError('저장', error); }
        }
      }

      // 원문이 남는 최근 메시지로 이야기 시계(표시용)만 맞춘다
      if (cfg.parseStatus) {
        for (const e of entries.slice(-cfg.minRaw)) {
          const s = parseStatus(cleanText(e.text));
          if (s.d) state.clock = { ...state.clock, d: s.d, approx: false };
          if (s.t) state.clock = { ...state.clock, t: s.t };
          if (s.place) state.clock = { ...state.clock, place: s.place };
        }
      }

      const drop = new Set();
      let droppedTokens = 0;
      for (const e of outside) {
        if (!isSeen(e)) break;
        drop.add(e.index);
        droppedTokens += estimateTokens(e.text);
      }
      const kept = entries.filter(e => !drop.has(e.index));
      const visible = new Set(kept.flatMap(e => [e.key, e.hash]));

      const { picks, trace, sc } = await recall(entries, visible, cfg);
      for (const { e } of picks) { e.hits++; e.lastHit = state.turn; }
      const block = await translateBlock(formatMemories(picks, sc, cfg), cfg);
      const injectedTokens = block ? estimateTokens(block) : 0;
      state.savedTokens = (state.savedTokens ?? 0) + Math.max(0, droppedTokens - injectedTokens);
      state.scene = { cast: sc.cast, d: sc.d, t: sc.t, day: sc.day, place: sc.place };
      refreshPending();
      state.lastRecall = { ...trace, trimmed: drop.size, kept: kept.length, droppedTokens, injectedTokens, preview: block, picks: picks.map(x => ({ id: x.e.id, p: round2(x.p) })) };
      void persist();
      return inject(messages.filter((_, i) => !drop.has(i)), block, cfg);
    } catch (error) {
      setError('요청 처리', error);
      return messages;
    } finally {
      busy = false;
    }
  }

  async function afterRequestHandler(content, type) {
    if ((type !== 'model' && type !== 'main') || !content || job || !lastEntries || !ready()) return content;
    const snap = lastEntries;
    if (snap.key !== chatKey || state.off) return content;
    // 원본 기준으로 오래된 것부터. (원본을 못 읽으면 요청 속 메시지로)
    const pending = snap.raw?.length ? ingestTargets(snap.raw) : snap.entries.slice(0, -SETTLE).filter(e => !isSeen(e));
    job = (async () => {
      if (pending.length) await ingest(pending, settings, BACKGROUND_BATCHES);
      await compressRecalled(settings);
    })()
      .catch(error => setError('백그라운드 저장', error))
      .finally(() => { job = null; refreshPending(); void persist(); });
    return content;
  }

  /** 메모·장면·대단원·처리 기록을 지운다. 사전은 남긴다. */
  function resetMemories() {
    const keep = state.dict;
    state = { ...emptyState(), dict: keep, off: state.off, loreSeeded: state.loreSeeded };
    seenSet = new Set();
    gramCache = new Map();
    recallCache.clear();
  }

  /**
   * 지금 전부 처리: Risu 채팅 원본을 처음부터 끝까지(최근 2개 제외) 오래된 순서대로 처리한다.
   * 이미 정리된 기억보다 앞부분이 비어 있으면(순서 꼬임) ORDER_GAP 오류 → rebuild: true로 다시 부른다.
   */
  async function processAll(onProgress, { rebuild = false } = {}) {
    if (!await ensureChat()) throw new Error('채팅방을 먼저 열어 주세요.');
    if (job) await job;
    const raw = rawEntries();
    if (!raw.length) {
      // 원본을 못 읽는 환경이면 마지막 요청에서 본 메시지로라도 처리한다.
      if (!lastEntries || lastEntries.key !== chatKey) throw new Error('채팅 원본을 읽지 못했어요. 채팅방에서 메시지를 한 번 보낸 뒤 다시 눌러 주세요.');
      if (rebuild) resetMemories();
      const list = lastEntries.entries.slice(0, -SETTLE);
      const pending = list.filter(e => !isSeen(e));
      await ingest(pending, settings, Infinity, (done) => onProgress?.(done, pending.length));
      state.pending = list.filter(e => !isSeen(e)).length;
      await persist();
      return;
    }
    if (rebuild) resetMemories();
    else if (orderGap(raw)) throw Object.assign(new Error('앞부분이 정리 안 된 채로 뒷부분이 정리돼 있어요.'), { code: 'ORDER_GAP', count: orderGap(raw) });
    const pending = ingestTargets(raw);
    onProgress?.(0, pending.length);
    await ingest(pending, settings, Infinity, (done) => onProgress?.(done, pending.length));
    refreshPending();
    await persist();
  }

  // ══════════════════════════════════════════════════════════════════════
  //  화면
  // ══════════════════════════════════════════════════════════════════════

  const ui = { tab: 'home', bound: false, draft: null, wiz: null, test: {}, query: '', who: '', openArcs: new Set(), showOrig: new Set(), editing: null, dry: null, progress: '' };

  const CSS = `
    :root{--a:#5b7cfa;--ok:#3fae7a;--warn:#e0a03a;--bad:#e0605a}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bgcolor,#121317);color:var(--textcolor,#e6e6ea);font:14px/1.55 system-ui,-apple-system,'Segoe UI','Apple SD Gothic Neo',sans-serif}
    button,input,select,textarea{font:inherit;color:inherit}
    a{color:var(--a)}
    .w{display:flex;flex-direction:column;height:100vh}
    .hd{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--borderc,#2c2e36)}
    .hd b{font-size:16px;white-space:nowrap}
    .sub{color:var(--textcolor2,#8d909a);font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .x{background:none;border:none;font-size:20px;cursor:pointer;color:var(--textcolor2,#8d909a);padding:2px 8px}
    .tabs{display:flex;gap:2px;padding:0 10px;border-bottom:1px solid var(--borderc,#2c2e36);overflow-x:auto}
    .tab{background:none;border:none;border-bottom:2px solid transparent;color:var(--textcolor2,#8d909a);padding:10px 11px;cursor:pointer;white-space:nowrap}
    .tab.on{color:var(--a);border-bottom-color:var(--a);font-weight:600}
    .bd{flex:1;overflow-y:auto;padding:16px}
    .in{max-width:880px;margin:0 auto}
    .card{background:var(--darkbg,#1b1c22);border:1px solid var(--borderc,#2c2e36);border-radius:12px;padding:14px;margin-bottom:12px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:12px}
    .kpi{font-size:22px;font-weight:700}
    .muted{color:var(--textcolor2,#8d909a)}
    .small{font-size:12px}
    .sec{font-size:13px;font-weight:700;color:var(--textcolor2,#8d909a);margin:18px 0 8px}
    .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .btn{background:var(--darkbg,#24262e);border:1px solid var(--borderc,#383b46);border-radius:8px;padding:7px 12px;cursor:pointer;white-space:nowrap}
    .btn:hover{border-color:var(--a)}
    .btn.p{background:var(--a);border-color:var(--a);color:#fff}
    .btn.d{color:var(--bad)}
    .btn.sm{padding:4px 9px;font-size:12px}
    .btn:disabled{opacity:.5;cursor:default}
    .inp,.sel,.ta{background:var(--bgcolor,#121317);border:1px solid var(--borderc,#383b46);border-radius:8px;padding:8px 10px;width:100%}
    .inp:focus,.sel:focus,.ta:focus{outline:none;border-color:var(--a)}
    .ta{min-height:80px;resize:vertical}
    .banner{border-radius:12px;padding:12px 14px;margin-bottom:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
    .banner .g{flex:1;min-width:180px}
    .banner.ok{background:rgba(63,174,122,.12);border:1px solid rgba(63,174,122,.4)}
    .banner.warn{background:rgba(224,160,58,.12);border:1px solid rgba(224,160,58,.4)}
    .banner.bad{background:rgba(224,96,90,.12);border:1px solid rgba(224,96,90,.4)}
    .opts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px}
    .opt{border:1px solid var(--borderc,#383b46);border-radius:10px;padding:10px 12px;cursor:pointer;background:none;text-align:left}
    .opt:hover{border-color:var(--a)}
    .opt.on{border-color:var(--a);background:rgba(91,124,250,.1)}
    .opt b{display:block}
    .badge{display:inline-block;border-radius:5px;padding:0 6px;font-size:11px;font-weight:600;background:rgba(91,124,250,.18);color:#9fb3ff;margin-left:4px;vertical-align:1px}
    .chip{display:inline-block;border-radius:999px;padding:1px 9px;font-size:12px;border:1px solid var(--borderc,#383b46);margin:2px 3px 2px 0;cursor:pointer;background:none}
    .chip.k{background:rgba(160,120,240,.15);color:#c6adff;border-color:transparent;cursor:default}
    .chip.t{background:rgba(139,141,151,.14);color:var(--textcolor2,#a6a9b3);border-color:transparent;cursor:default}
    .chip.h{background:rgba(63,174,122,.16);color:#86d9ad;border-color:transparent;cursor:default}
    .chip.o{background:rgba(139,141,151,.2);color:#9a9da6;border-color:transparent;cursor:default}
    .arc{border:1px solid var(--borderc,#2c2e36);border-radius:12px;margin-bottom:10px;overflow:hidden}
    .arch{display:flex;gap:10px;align-items:center;padding:12px 14px;cursor:pointer;background:var(--darkbg,#1b1c22);flex-wrap:wrap}
    .arch .t{font-weight:700;flex:1;min-width:160px}
    .scene{padding:10px 14px;border-top:1px solid var(--borderc,#2c2e36)}
    .sceneh{font-size:12px;color:var(--textcolor2,#8d909a);margin-bottom:6px}
    .ev{padding:7px 0 7px 10px;border-left:2px solid var(--borderc,#383b46);margin:4px 0}
    .ev.old{opacity:.55}
    .ev.pin{border-left-color:var(--a)}
    .ev .l{white-space:pre-wrap;word-break:break-word}
    .ev .orig{font-size:12px;color:var(--textcolor2,#8d909a);margin-top:3px;white-space:pre-wrap}
    .ev .act{display:flex;gap:4px;margin-top:4px;flex-wrap:wrap}
    .bar{height:6px;background:var(--borderc,#2c2e36);border-radius:4px;overflow:hidden}
    .bar>i{display:block;height:100%;background:var(--a)}
    .pre{white-space:pre-wrap;font-family:ui-monospace,Consolas,monospace;font-size:12px;background:var(--bgcolor,#121317);border:1px solid var(--borderc,#2c2e36);border-radius:8px;padding:10px;max-height:340px;overflow:auto}
    table{width:100%;border-collapse:collapse;font-size:13px}
    td,th{padding:6px 8px;border-bottom:1px solid var(--borderc,#2c2e36);text-align:left;vertical-align:top}
    th{color:var(--textcolor2,#8d909a);font-weight:600;font-size:12px}
    .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    .f{display:grid;grid-template-columns:minmax(150px,210px) 1fr;gap:6px 16px;padding:10px 0;border-bottom:1px solid var(--borderc,#2c2e36)}
    .f:last-child{border-bottom:none}
    .f label{font-weight:600}
    .help{font-size:12px;color:var(--textcolor2,#8d909a);margin-top:2px}
    .sw{position:relative;display:inline-block;width:42px;height:24px}
    .sw input{opacity:0;width:0;height:0}
    .sw span{position:absolute;inset:0;background:#555;border-radius:24px;cursor:pointer;transition:.15s}
    .sw span:before{content:"";position:absolute;width:18px;height:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.15s}
    .sw input:checked+span{background:var(--a)}
    .sw input:checked+span:before{transform:translateX(18px)}
    .foot{position:sticky;bottom:-16px;background:var(--bgcolor,#121317);padding:12px 0;border-top:1px solid var(--borderc,#2c2e36);display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
    .steps{display:flex;gap:6px;margin-bottom:14px}
    .steps i{flex:1;height:4px;border-radius:3px;background:var(--borderc,#383b46)}
    .steps i.on{background:var(--a)}
    .ov{position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px}
    .dlg{background:var(--bgcolor,#17181d);border:1px solid var(--borderc,#383b46);border-radius:12px;padding:18px;width:100%;max-width:560px;max-height:90vh;overflow-y:auto}
    .toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#2b2e38;color:#fff;padding:9px 16px;border-radius:8px;font-size:13px;z-index:60;box-shadow:0 4px 18px rgba(0,0,0,.4)}
    .ok{color:var(--ok)} .err{color:var(--bad)}
    details summary{cursor:pointer;color:var(--textcolor2,#8d909a);font-size:13px;margin:8px 0}
    @media (max-width:560px){.f{grid-template-columns:1fr}.bd{padding:12px}.tab{padding:10px 8px}}
  `;

  async function openPanel(tab) {
    await R.showContainer('fullscreen');
    if (tab) ui.tab = tab;
    ui.draft = null;
    ui.editing = null;
    if (!settings.onboarded || !settings.jevKey) ui.wiz = ui.wiz ?? { step: 1, d: { ...settings } };
    else if (!ui.wiz?.manual) ui.wiz = null; // 설정이 끝났으면 사용자가 직접 연 경우가 아니면 안내를 닫는다
    try { if (await ensureChat()) refreshPending(); } catch (error) { setError('채팅 확인', error); }
    render();
  }

  function render() {
    const body = document.getElementById('bd');
    const keepScroll = body && body.dataset.tab === (ui.wiz ? 'wiz' : ui.tab);
    const scroll = body ? body.scrollTop : 0;
    const tabs = [['home', '🏠 홈'], ['timeline', '📚 타임라인'], ['people', '👥 인물'], ['trace', '🔍 회상 기록'], ['settings', '⚙️ 설정'], ['tools', '🧰 도구']];
    document.body.innerHTML = `<style>${CSS}</style>
      <div class="w">
        <div class="hd"><b>🧠 JevHypa</b><span class="sub">${escapeHtml([chatLabel.char, chatLabel.chat].filter(Boolean).join(' · ') || '채팅방을 열면 기억이 보여요')}</span><button class="x" data-act="close" title="닫기">✕</button></div>
        ${ui.wiz ? '' : `<div class="tabs">${tabs.map(([id, l]) => `<button class="tab${ui.tab === id ? ' on' : ''}" data-act="tab" data-tab="${id}">${l}</button>`).join('')}</div>`}
        <div class="bd" id="bd" data-tab="${ui.wiz ? 'wiz' : ui.tab}"><div class="in">${ui.wiz ? renderWizard() : ({ home: renderHome, timeline: renderTimeline, people: renderPeople, trace: renderTrace, settings: renderSettings, tools: renderTools }[ui.tab] ?? renderHome)()}</div></div>
      </div>
      ${ui.editing ? renderEditor() : ''}`;
    const nb = document.getElementById('bd');
    if (nb && keepScroll) nb.scrollTop = scroll;
    bindOnce();
  }

  function toast(msg) {
    document.querySelector('.toast')?.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }

  function confirmDialog(msg, yes = '확인') {
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.className = 'ov';
      ov.innerHTML = `<div class="dlg" style="max-width:420px;text-align:center"><p style="white-space:pre-wrap;margin:6px 0 16px">${escapeHtml(msg)}</p><div class="row" style="justify-content:center"><button class="btn" data-c="0">취소</button><button class="btn p" data-c="1">${escapeHtml(yes)}</button></div></div>`;
      ov.addEventListener('click', (e) => {
        const c = e.target.closest?.('[data-c]')?.dataset.c;
        if (c == null && e.target !== ov) return;
        e.stopPropagation();
        ov.remove();
        resolve(c === '1');
      });
      document.body.appendChild(ov);
    });
  }

  /** 같은 인물로 묶을 때 대표 이름을 고른다. */
  function mergeDialog(names) {
    return new Promise(resolve => {
      const def = mainName(names);
      const ov = document.createElement('div');
      ov.className = 'ov';
      ov.innerHTML = `<div class="dlg" style="max-width:440px"><b>같은 인물로 묶기</b><div class="help" style="margin:2px 0 10px">대표 이름을 고르세요. 나머지는 별명이 되고, 메모의 인물 태그도 대표 이름으로 합쳐져요.</div>
        ${names.map(n => `<label class="row" style="padding:6px 0"><input type="radio" name="jm-main" value="${escapeHtml(n)}"${n === def ? ' checked' : ''}> ${escapeHtml(n)}</label>`).join('')}
        <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-c="0">취소</button><button class="btn p" data-c="1">묶기</button></div></div>`;
      ov.addEventListener('click', (e) => {
        const c = e.target.closest?.('[data-c]')?.dataset.c;
        if (c == null && e.target !== ov) return;
        e.stopPropagation();
        const v = ov.querySelector('input[name="jm-main"]:checked')?.value ?? null;
        ov.remove();
        resolve(c === '1' ? v : null);
      });
      document.body.appendChild(ov);
    });
  }

  /** prompt()는 플러그인 창에서 막힐 수 있어서 직접 그린다. */
  function inputDialog(title, help, value) {
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.className = 'ov';
      ov.innerHTML = `<div class="dlg" style="max-width:420px"><b>${escapeHtml(title)}</b><div class="help" style="margin:2px 0 10px">${escapeHtml(help)}</div><input class="inp" id="dlg-in" value="${escapeHtml(value)}"><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-c="0">취소</button><button class="btn p" data-c="1">확인</button></div></div>`;
      const done = (ok) => { const v = ov.querySelector('#dlg-in').value; ov.remove(); resolve(ok ? v : null); };
      ov.addEventListener('click', (e) => {
        const c = e.target.closest?.('[data-c]')?.dataset.c;
        if (c == null && e.target !== ov) return;
        e.stopPropagation();
        done(c === '1');
      });
      ov.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); done(true); } if (e.key === 'Escape') done(false); });
      document.body.appendChild(ov);
      ov.querySelector('#dlg-in').focus();
    });
  }

  const opt = (field, value, cur, title, desc, badge) =>
    `<button class="opt${cur === value ? ' on' : ''}" data-act="pick" data-field="${field}" data-value="${value}"><b>${escapeHtml(title)}${badge ? `<span class="badge">${escapeHtml(badge)}</span>` : ''}</b><span class="small muted">${escapeHtml(desc ?? '')}</span></button>`;

  const sw = (field, on) => `<label class="sw"><input type="checkbox" data-field="${field}"${on ? ' checked' : ''}><span></span></label>`;

  // ── 시작 안내 (3단계) ──

  /** 키 모양 확인 (저장된 값 기준). OpenRouter 키는 sk-or- 로 시작한다. */
  function keyHint(d) {
    const k = cleanKey(d.jevKey);
    if (!k) return '';
    const bad = keyProblem(k, 'Jev');
    if (bad) return `<div class="help err">${escapeHtml(bad)}</div>`;
    if (d.jevPreset === 'openrouter' && !/^sk-or-/.test(k)) return '<div class="help" style="color:var(--warn)">OpenRouter 키는 보통 sk-or- 로 시작해요. 다른 키를 넣은 건 아닌지 확인해 주세요.</div>';
    return `<div class="help">${escapeHtml(k.slice(0, 8))}…${escapeHtml(k.slice(-4))} (${k.length}자)</div>`;
  }

  /**
   * 모델 고르기: 프리셋의 기본 모델 목록 + "직접 입력…".
   * 실제 값은 아래 입력칸(data-field)에 있고, 목록은 그 칸을 채워 주는 역할만 한다.
   */
  function modelPicker(field, preset, value) {
    const items = (preset.models ?? []).map(m => (typeof m === 'string' ? { id: m, label: m } : m));
    const known = items.some(m => m.id === value);
    const custom = !known || !items.length;
    const options = items.map(m => `<option value="${escapeHtml(m.id)}"${m.id === value ? ' selected' : ''}>${escapeHtml(m.label)}${m.id === preset.model ? ' · 기본' : ''}${m.label !== m.id ? ` — ${escapeHtml(m.id)}` : ''}</option>`).join('');
    return `${items.length ? `<select class="sel" data-model-for="${field}">${options}<option value="__custom"${custom ? ' selected' : ''}>직접 입력…</option></select>` : ''}
      <input class="inp" data-field="${field}" placeholder="모델 이름 (예: ${escapeHtml(preset.model || 'vendor/model')})" value="${escapeHtml(value)}" style="${custom ? '' : 'display:none;'}${items.length ? 'margin-top:6px' : ''}">`;
  }

  function jevFields(d) {
    const p = JEV_PRESETS[d.jevPreset];
    return `<div class="opts">${Object.entries(JEV_PRESETS).map(([k, v]) => opt('jevPreset', k, d.jevPreset, v.label, v.desc, v.badge)).join('')}</div>
      <div class="f" style="border:none"><div><label>API 키</label>${p.keyUrl ? `<div class="help"><a href="${p.keyUrl}" target="_blank" rel="noopener">키 받는 곳 ↗</a></div>` : ''}</div>
        <div><input class="inp" type="password" autocomplete="off" data-field="jevKey" placeholder="${escapeHtml(p.keyHint)}" value="${escapeHtml(d.jevKey)}">${keyHint(d)}</div></div>
      <div class="f" style="border:none"><div><label>모델</label><div class="help">모르겠으면 기본 그대로 두세요.</div></div><div>${modelPicker('jevModel', p, d.jevModel)}</div></div>
      <details${d.jevPreset === 'custom' ? ' open' : ''}><summary>주소 (보통은 안 바꿔도 돼요)</summary>
        <div class="f"><label>주소</label><input class="inp" data-field="jevEndpoint" value="${escapeHtml(d.jevEndpoint)}"></div>
      </details>
      <div class="row"><button class="btn" data-act="test-jev">연결 테스트</button>${testLine('jev')}</div>`;
  }

  function embedFields(d) {
    const p = EMBED_PRESETS[d.embedPreset];
    return `<div class="opts">${Object.entries(EMBED_PRESETS).map(([k, v]) => opt('embedPreset', k, d.embedPreset, v.label, v.desc, v.badge)).join('')}</div>
      ${p.key === 'own' ? `<div class="f" style="border:none"><div><label>임베딩 API 키</label>${p.keyUrl ? `<div class="help"><a href="${p.keyUrl}" target="_blank" rel="noopener">키 받는 곳 ↗</a></div>` : ''}</div><input class="inp" type="password" autocomplete="off" data-field="embedKey" value="${escapeHtml(d.embedKey)}"></div>` : ''}
      ${p.key === 'jev' ? '<div class="help" style="margin:8px 0">Jev에 넣은 OpenRouter 키를 같이 써요.</div>' : ''}
      ${p.format !== 'local' ? `<div class="f" style="border:none"><div><label>모델</label><div class="help">모르겠으면 기본 그대로 두세요.</div></div><div>${modelPicker('embedModel', p, d.embedModel)}</div></div>` : ''}
      ${p.format !== 'local' ? `<details${d.embedPreset === 'custom' ? ' open' : ''}><summary>주소 · 크기</summary>
        <div class="f"><label>주소</label><input class="inp" data-field="embedEndpoint" value="${escapeHtml(d.embedEndpoint)}"></div>
        ${p.mrl ? `<div class="f"><div><label>벡터 크기</label><div class="help">작을수록 저장 공간이 줄어요. 512면 충분해요.</div></div><select class="sel" data-field="embedDims">${[256, 512, 768, 1024].map(n => `<option value="${n}"${+d.embedDims === n ? ' selected' : ''}>${n}</option>`).join('')}</select></div>` : ''}
      </details>` : ''}
      <div class="row"><button class="btn" data-act="test-embed">연결 테스트</button>${testLine('embed')}</div>`;
  }

  function modeFields(d) {
    return `<div class="opts">${Object.entries(MODES).map(([k, v]) => opt('mode', k, d.mode, v.label, v.desc, v.badge)).join('')}</div>
      ${d.mode === 'custom' ? '<div class="help" style="margin-top:6px">직접 바꾼 값을 쓰는 중이에요.</div>' : ''}`;
  }

  function testLine(which) {
    const t = ui.test[which];
    if (!t) return '';
    if (t.running) return '<span class="muted small">확인 중…</span>';
    if (t.warn) return `<span class="small" style="color:var(--warn)">⚠️ ${escapeHtml(t.msg)}</span>`;
    return t.ok ? `<span class="ok small">✅ ${escapeHtml(t.msg)}</span>` : `<span class="err small">❌ ${escapeHtml(t.msg)}</span>`;
  }

  function renderWizard() {
    const w = ui.wiz;
    const d = w.d;
    const steps = `<div class="steps">${[1, 2, 3].map(n => `<i class="${n <= w.step ? 'on' : ''}"></i>`).join('')}</div>`;
    const nav = (back, next, label = '다음') => `<div class="row" style="justify-content:space-between;margin-top:16px">${back ? '<button class="btn" data-act="wiz-back">이전</button>' : '<span></span>'}<button class="btn p" data-act="${next}">${label}</button></div>`;
    if (w.step === 1) {
      return `${steps}<h3 style="margin:0 0 4px">1. Jev 연결</h3><p class="muted small" style="margin:0 0 12px">Jev는 글을 쓰지 않고 "이건 중요해? 이 장면에 필요해?"만 판단하는 아주 싼 모델이에요. 기억을 고르는 데 써요.</p>
        <div class="card">${jevFields(d)}</div>${nav(false, 'wiz-next')}`;
    }
    if (w.step === 2) {
      return `${steps}<h3 style="margin:0 0 4px">2. 임베딩 고르기</h3><p class="muted small" style="margin:0 0 12px">임베딩은 "뜻이 비슷한 기억"을 빠르게 찾는 데 써요. 단어가 달라도 같은 얘기면 찾아요. 모르겠으면 첫 번째를 고르세요.</p>
        <div class="card">${embedFields(d)}</div>${nav(true, 'wiz-next')}`;
    }
    return `${steps}<h3 style="margin:0 0 4px">3. 얼마나 아낄까요?</h3><p class="muted small" style="margin:0 0 12px">나중에 설정에서 언제든 바꿀 수 있어요.</p>
      <div class="card">${modeFields(d)}</div>
      <div class="card small muted">이렇게 동작해요<br>· 최근 대화는 원문 그대로 보내요.<br>· 그보다 오래된 대화는 <b>장면 → 대단원</b>으로 묶어 중요한 사건 메모만 남기고 원문은 요청에서 빼요.<br>· 매 턴 지금 장면에 필요한 메모만 골라 넣어요.</div>
      ${nav(true, 'wiz-finish', '시작하기')}`;
  }

  // ── 홈 ──

  function statusBanner() {
    if (!settings.jevKey) return `<div class="banner bad"><div class="g"><b>Jev 키가 없어요</b><div class="small muted">시작 안내에서 키를 넣으면 바로 동작해요.</div></div><button class="btn p" data-act="wizard">시작 안내 열기</button></div>`;
    if (!settings.enabled) return `<div class="banner warn"><div class="g"><b>전체 꺼짐</b><div class="small muted">모든 채팅에서 요청을 건드리지 않아요.</div></div><button class="btn" data-act="toggle-global">켜기</button></div>`;
    if (!chatKey) return `<div class="banner warn"><div class="g"><b>채팅방을 열어 주세요</b></div></div>`;
    if (state.off) return `<div class="banner warn"><div class="g"><b>이 채팅에서는 꺼짐</b></div><button class="btn" data-act="toggle-chat">이 채팅에서 켜기</button></div>`;
    if (stats.lastError && Date.now() - stats.lastErrorAt < 10 * 60 * 1000) {
      return `<div class="banner bad"><div class="g"><b>최근 오류</b> <span class="small muted">${timeAgo(stats.lastErrorAt)}</span><div class="small err">${escapeHtml(stats.lastError)}</div><div class="small muted">처리 못 한 메시지는 원문 그대로 보냈어요.</div></div><button class="btn" data-act="tab" data-tab="settings">연결 확인</button></div>`;
    }
    const embedStale = state.events.some(e => e.vp !== embedProfile());
    if (embedStale) return `<div class="banner warn"><div class="g"><b>임베딩 다시 계산 필요</b><div class="small muted">임베딩 설정이 바뀌었거나 일부 메모에 벡터가 없어요. 그동안은 단어 겹침으로 찾아요.</div></div><button class="btn p" data-act="reembed">지금 계산</button></div>`;
    return `<div class="banner ok"><div class="g"><b>작동 중</b><div class="small muted">${MODES[settings.mode]?.label ?? '직접 설정'} 모드 · 최근 약 ${settings.rawBudget.toLocaleString()}토큰은 원문, 그 이전은 메모로</div></div><button class="btn" data-act="toggle-chat">이 채팅에서 끄기</button></div>`;
  }

  function renderHome() {
    const active = state.events.filter(isActive);
    const kpi = (v, l) => `<div class="card" style="margin:0"><div class="kpi">${v}</div><div class="small muted">${l}</div></div>`;
    const last = state.lastRecall;
    const sc = state.scene;
    const when = formatWhen({ d: state.clock.d, t: state.clock.t, day: state.clock.day, approx: state.clock.approx }, true);
    const arc = arcById(state.open.arc);
    const picks = (last?.picks ?? []).map(p => {
      const e = eventById(p.id);
      return e ? `<div class="row" style="padding:5px 0;border-bottom:1px solid var(--borderc,#2c2e36);flex-wrap:nowrap"><span class="ok num" style="width:42px">${Math.round(p.p * 100)}%</span><span class="chip k">${KINDS[e.kind]?.label}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(lineText(e))}</span></div>` : '';
    }).join('');
    return `${statusBanner()}
      <div class="grid">${kpi(active.length, '사건 메모')}${kpi(state.scenes.length, '장면')}${kpi(state.arcs.length, '대단원')}${kpi(fmtTokens(state.savedTokens ?? 0), '아낀 토큰(추정)')}</div>
      ${state.gap ? `<div class="banner bad"><div class="g"><b>앞부분 ${state.gap}개가 정리 안 됐어요</b><div class="small muted">뒷부분이 먼저 정리돼서 이야기 순서가 꼬였어요. 처음부터 다시 정리하면 순서대로 맞춰져요. (사전은 남아요)</div></div><button class="btn p" data-act="process-all" data-rebuild="1">처음부터 다시 정리</button></div>` : ''}
      ${!state.gap && state.pending ? `<div class="banner warn"><div class="g"><b>아직 정리 안 된 메시지 ${state.pending}개</b><div class="small muted">대화할 때마다 오래된 것부터 조금씩 정리돼요. 다 정리되기 전에는 원문을 자르지 않아요.</div></div><button class="btn" data-act="process-all">지금 전부 처리</button></div>` : ''}
      ${ui.progress ? `<div class="card small">${escapeHtml(ui.progress)}</div>` : ''}
      <div class="sec">지금</div>
      <div class="card">
        <div class="row">${when ? `<span>🕒 ${escapeHtml(when)}</span>` : ''}${sc?.place ? `<span>📍 ${escapeHtml(sc.place)}</span>` : ''}${(sc?.cast ?? []).map(n => `<button class="chip" data-act="who" data-who="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join('')}</div>
        ${arc ? `<div style="margin-top:8px"><b>${escapeHtml(arcTitle(arc))}</b> <span class="small muted">· 장면 ${arc.sceneIds.length}개</span><div>${arc.kw.map(k => `<span class="chip t">${escapeHtml(k)}</span>`).join('')}</div></div>` : '<div class="small muted">아직 대단원이 없어요. 대화가 쌓이면 생겨요.</div>'}
      </div>
      <div class="sec">마지막 회상 ${last ? `<span class="small" style="font-weight:400">· ${timeAgo(last.at)} · ${last.ms}ms</span>` : ''}</div>
      ${last ? `<div class="card">
        <div class="row small muted" style="gap:14px"><span>원문 ${last.kept}개 유지</span><span>${last.trimmed}개 메모로 대체 (~${last.droppedTokens}토큰)</span><span>메모 ${last.picks.length}개 주입 (~${last.injectedTokens}토큰)</span><span>${last.usedEmbed ? '임베딩 ✓' : '임베딩 ✕'} · ${last.usedJev ? 'Jev ✓' : '<span class="err">Jev ✕</span>'}</span></div>
        <div style="margin-top:8px">${picks || `<div class="small muted">${escapeHtml(last.note || '이번엔 넣을 만한 메모가 없었어요.')}</div>`}</div>
        <div class="row" style="margin-top:8px"><button class="btn sm" data-act="tab" data-tab="trace">자세히 보기</button></div>
      </div>` : '<div class="card small muted">이 채팅에서 메시지를 보내면 여기에 무엇을 넣었는지 보여요.</div>'}
      <div class="card small muted">이번 세션 · Jev ${stats.jevCalls}회 (입력 ${stats.jevTokens.toLocaleString()}토큰) · 임베딩 ${stats.embedCalls}회</div>`;
  }

  // ── 타임라인 ──

  function evRow(e, lastP) {
    const orig = ui.showOrig.has(e.id);
    const when = formatWhen(e.when, true);
    return `<div class="ev${e.old ? ' old' : ''}${e.pin ? ' pin' : ''}">
      <div class="row" style="gap:4px"><span class="chip k">${KINDS[e.kind]?.label}</span>${e.who.map(w => `<button class="chip" data-act="who" data-who="${escapeHtml(w)}">${escapeHtml(w)}</button>`).join('')}${when ? `<span class="chip t">🕒 ${escapeHtml(when)}</span>` : ''}${e.place ? `<span class="chip t">📍 ${escapeHtml(e.place)}</span>` : ''}${lastP != null ? `<span class="chip h">이번 턴 ${Math.round(lastP * 100)}%</span>` : ''}${e.old ? '<span class="chip o">지난 기억</span>' : ''}${e.pin ? '<span class="chip h">고정</span>' : ''}<span class="small muted">중요도 ${Math.round(e.imp * 100)}%</span></div>
      <div class="l">${escapeHtml(e.c ?? e.t)}</div>
      ${orig && e.c ? `<div class="orig">원문: ${escapeHtml(e.t)}</div>` : ''}
      <div class="act">${e.c ? `<button class="btn sm" data-act="orig" data-id="${e.id}">${orig ? '원문 접기' : '원문 보기'}</button>` : ''}<button class="btn sm" data-act="pin" data-id="${e.id}">${e.pin ? '고정 해제' : '📌 항상 넣기'}</button><button class="btn sm" data-act="edit" data-id="${e.id}">수정</button>${e.old ? `<button class="btn sm" data-act="restore" data-id="${e.id}">되살리기</button>` : ''}<button class="btn sm d" data-act="del" data-id="${e.id}">삭제</button></div>
    </div>`;
  }

  function renderTimeline() {
    const q = ui.query.trim().toLowerCase();
    const lastP = new Map((state.lastRecall?.picks ?? []).map(p => [p.id, p.p]));
    const match = (e) => (!q || e.t.toLowerCase().includes(q) || (e.c ?? '').toLowerCase().includes(q)) && (!ui.who || e.who.includes(ui.who));
    const filtering = !!(q || ui.who);
    const arcs = [...state.arcs].reverse();
    const html = arcs.map(a => {
      const scenes = a.sceneIds.map(sceneById).filter(Boolean);
      const evCount = state.events.filter(e => e.arc === a.id && isActive(e)).length;
      // 지금 대단원은 기본으로 펼침, 다른 대단원은 기본으로 접힘. 누르면 반대로.
      const open = filtering || (ui.openArcs.has(a.id) !== (a.id === state.open.arc));
      const sceneHtml = open ? [...scenes].reverse().map(s => {
        const evs = state.events.filter(e => e.scene === s.id && match(e));
        if (!evs.length) return filtering ? '' : `<div class="scene"><div class="sceneh">${escapeHtml([formatWhen(s.from, true), s.place].filter(Boolean).join(' · ') || '장면')} · 남길 메모 없음</div></div>`;
        return `<div class="scene"><div class="sceneh">🎬 ${escapeHtml([formatWhen(s.from, true), s.place, s.cast.join(', ')].filter(Boolean).join(' · ') || '장면')}</div>${evs.map(e => evRow(e, lastP.get(e.id))).join('')}</div>`;
      }).join('') : '';
      if (filtering && !sceneHtml.trim()) return '';
      return `<div class="arc"><div class="arch" data-act="arc-toggle" data-id="${a.id}">
          <span class="t">${open ? '▾' : '▸'} ${escapeHtml(arcTitle(a))}${a.id === state.open.arc ? '<span class="badge">지금</span>' : ''}</span>
          <span class="small muted">${escapeHtml([fmtSpan(a.from, a.to), `장면 ${scenes.length}`, `메모 ${evCount}`].filter(Boolean).join(' · '))}</span>
          <button class="btn sm" data-act="arc-rename" data-id="${a.id}">✏️ 이름</button>
        </div>
        ${open ? `<div style="padding:8px 14px 0">${a.cast.map(n => `<button class="chip" data-act="who" data-who="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join('')}${a.kw.map(k => `<span class="chip t">${escapeHtml(k)}</span>`).join('')}</div>` : ''}
        ${sceneHtml}</div>`;
    }).join('');
    return `<div class="row" style="margin-bottom:10px"><input class="inp" id="q" style="flex:1;min-width:160px" placeholder="🔍 메모 검색" value="${escapeHtml(ui.query)}">
        <select class="sel" data-act="who-select" style="width:auto;min-width:120px"><option value="">👥 모든 인물</option>${personList(200).map(n => `<option value="${escapeHtml(n)}"${ui.who === n ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select>
        <button class="btn p" data-act="new">+ 메모 추가</button></div>
      ${html || `<div class="card muted" style="text-align:center">${state.events.length ? '조건에 맞는 메모가 없어요.' : '아직 메모가 없어요.<br>대화가 쌓여 오래된 메시지가 생기면 장면과 대단원으로 정리돼요.'}</div>`}`;
  }

  function renderEditor() {
    const isNew = ui.editing === 'new';
    const e = isNew ? null : eventById(ui.editing);
    if (!isNew && !e) return '';
    const imp = Math.round((e?.imp ?? 0.9) * 100);
    return `<div class="ov" data-act="overlay"><div class="dlg">
      <h3 style="margin:0 0 10px">${isNew ? '메모 추가' : '메모 수정'}</h3>
      <textarea class="ta" id="ed-t" placeholder="누가 무엇을 했는지 이름을 넣어 한 문장으로">${escapeHtml(e?.t ?? '')}</textarea>
      <div class="f"><label>칸</label><select class="sel" id="ed-kind">${KIND_IDS.map(k => `<option value="${k}"${(e?.kind ?? 'event') === k ? ' selected' : ''}>${KINDS[k].label}</option>`).join('')}</select></div>
      <div class="f"><label>인물</label><input class="inp" id="ed-who" placeholder="쉼표로 구분" value="${escapeHtml((e?.who ?? []).join(', '))}"></div>
      <div class="f"><label>중요도 <span class="muted" id="ed-imp-v">${imp}%</span></label><input type="range" min="0" max="100" value="${imp}" id="ed-imp"></div>
      <label class="row" style="margin:8px 0 14px"><span class="sw"><input type="checkbox" id="ed-pin"${(e?.pin ?? isNew) ? ' checked' : ''}><span></span></span> 항상 넣기 (고정)</label>
      <div class="row" style="justify-content:flex-end"><button class="btn" data-act="edit-cancel">취소</button><button class="btn p" data-act="edit-save">저장</button></div>
    </div></div>`;
  }

  // ── 인물 ──

  function renderPeople() {
    const entries = Object.entries(state.dict.e);
    const aliasesOf = (n) => entries.filter(([, e]) => e.alias === n).map(([x]) => x);
    const SRC = { card: '캐릭터 카드', persona: '페르소나', speaker: '대사 줄', jev: 'Jev 분류', manual: '직접 추가', intro: '자기소개' };
    const sheet = (n) => state.events.filter(e => isActive(e) && CORE_KINDS.has(e.kind) && e.who.includes(n)).sort((a, b) => rankOf(b) - rankOf(a) || b.id - a.id).slice(0, 3);
    const memoCount = new Map();
    for (const x of state.events) if (isActive(x)) for (const w of x.who) memoCount.set(w, (memoCount.get(w) ?? 0) + 1);
    const row = (n, e, pending) => {
      const al = aliasesOf(n);
      const picked = ui.selPeople?.has(n);
      const others = entries.filter(([x, y]) => x !== n && !y.alias && y.type === e.type);
      const sh = e.type === 'person' && !pending ? sheet(n) : [];
      return `<div class="card" style="margin-bottom:8px">
        <div class="row">${e.type === 'person' ? `<button class="btn sm${picked ? ' p' : ''}" data-act="sel" data-name="${escapeHtml(n)}" title="같은 인물로 묶을 이름 고르기">${picked ? '☑' : '☐'}</button>` : ''}<b style="min-width:80px">${escapeHtml(n)}</b><span class="small muted" style="flex:1">${SRC[e.src] ?? e.src}${e.src === 'card' || e.src === 'persona' ? '' : ` · ${e.n}회`}${al.length ? ` · 별명: ${al.map(escapeHtml).join(', ')}` : ''}</span>
          ${pending ? `<button class="btn sm p" data-act="ent-confirm" data-name="${escapeHtml(n)}">인물로 등록</button>` : ''}
          ${e.type === 'person' && !pending ? `<button class="btn sm" data-act="who" data-who="${escapeHtml(n)}">메모 보기</button>` : ''}
          <select class="sel" data-act="ent-type" data-name="${escapeHtml(n)}" style="width:auto;padding:4px 6px">${Object.entries(ENTITY_TYPES).filter(([k]) => k !== 'other').map(([k, v]) => `<option value="${k}"${e.type === k ? ' selected' : ''}>${v.label}</option>`).join('')}</select>
          ${others.length ? `<select class="sel" data-act="ent-alias" data-name="${escapeHtml(n)}" style="width:auto;max-width:150px;padding:4px 6px"><option value="">별명으로 묶기…</option>${others.map(([x]) => `<option value="${escapeHtml(x)}">→ ${escapeHtml(x)}</option>`).join('')}</select>` : ''}
          <button class="btn sm d" data-act="ent-del" data-name="${escapeHtml(n)}">${pending ? '무시' : '삭제'}</button></div>
        ${sh.length ? `<div class="small" style="margin-top:6px">${sh.map(x => `<div>· <span class="chip k">${KINDS[x.kind].label}</span> ${escapeHtml(x.c ?? x.t)}</div>`).join('')}</div>` : ''}
      </div>`;
    };
    const top = (type) => entries.filter(([, e]) => !e.alias && e.type === type && isActiveEntity(e)).sort((a, b) => b[1].n - a[1].n);
    const pending = entries.filter(([, e]) => !e.alias && e.type === 'person' && !e.hidden && !isActiveEntity(e));
    const chips = (type) => top(type).map(([n, e]) => `<span class="chip t" title="${e.n}회">${escapeHtml(n)}</span>`).join('') || '<span class="small muted">아직 없어요</span>';
    return `<div class="row" style="margin-bottom:12px"><input class="inp" id="ent-name" style="flex:1;min-width:140px" placeholder="이름 추가"><select class="sel" id="ent-type" style="width:auto">${Object.entries(ENTITY_TYPES).filter(([k]) => k !== 'other').map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select><button class="btn p" data-act="ent-add">추가</button></div>
      ${state.dict.sug.length ? `<div class="sec">🔗 별명 제안</div>${state.dict.sug.map((s, i) => `<div class="card row"><b>${escapeHtml(s.from)} = ${escapeHtml(s.to)}?</b><span class="small muted" style="flex:1">"${escapeHtml(s.quote)}"</span><button class="btn sm p" data-act="sug-yes" data-i="${i}">같은 사람</button><button class="btn sm" data-act="sug-no" data-i="${i}">다른 사람</button></div>`).join('')}` : ''}
      ${pending.length ? `<div class="sec">🆕 새 인물 후보 <span class="small" style="font-weight:400">대사 줄에 한 번 나온 이름</span></div>${pending.map(([n, e]) => row(n, e, true)).join('')}` : ''}
      ${(() => {
        const sel = [...(ui.selPeople ?? [])].filter(n => state.dict.e[n] && !state.dict.e[n].alias);
        return sel.length ? `<div class="card row" style="position:sticky;top:-16px;z-index:5;border-color:var(--a)"><b style="flex:1">${sel.length}명 선택됨: ${sel.map(escapeHtml).join(', ')}</b><button class="btn p" data-act="merge-selected"${sel.length < 2 ? ' disabled' : ''}>같은 인물로 묶기</button><button class="btn" data-act="sel-clear">선택 해제</button></div>` : '';
      })()}
      ${(() => {
        const groups = duplicateGroups();
        ui.dupGroups = groups;
        return groups.length ? `<div class="sec">🧩 같은 인물 같아요 <span class="small" style="font-weight:400">이름이 비슷하거나 한글·영어 표기가 같아요</span></div>${groups.map((g, i) => `<div class="card row"><span style="flex:1">${g.map(n => `<span class="chip t">${escapeHtml(n)}</span>`).join('')}</span><button class="btn sm p" data-act="dup-merge" data-i="${i}">같은 인물로 묶기</button><button class="btn sm" data-act="dup-no" data-i="${i}">아니에요</button></div>`).join('')}` : '';
      })()}
      <div class="sec">👥 인물 · 인물 시트 <span class="small" style="font-weight:400">☐를 눌러 여러 이름을 고른 뒤 한 사람으로 묶을 수 있어요</span></div>
      ${(() => {
        const people = top('person');
        const main = people.filter(([n, e]) => (memoCount.get(n) ?? 0) > 0 || e.n >= 2 || ['manual', 'persona', 'intro'].includes(e.src));
        const quiet = people.filter(x => !main.includes(x));
        return (main.map(([n, e]) => row(n, e, false)).join('') || '<div class="card small muted">아직 없어요. 대화가 쌓이면 자동으로 채워져요.</div>') +
          (quiet.length ? `<details><summary>메모 없이 한 번만 나온 이름 ${quiet.length}개</summary>${quiet.map(([n, e]) => row(n, e, false)).join('')}</details>` : '');
      })()}
      <div class="sec">📍 장소</div><div class="card">${chips('place')}</div>
      <div class="sec">🎒 물건</div><div class="card">${chips('item')}</div>
      <div class="small muted">Jev가 "기타"로 판정해 다시 묻지 않는 단어 ${rejSet.size}개${settings.rejAutoClear ? ` · ${settings.rejClearEvery}턴마다 자동으로 비워요` : ''} <button class="btn sm" data-act="rej-clear">지금 비우기</button></div>`;
  }

  // ── 회상 기록 ──

  function renderTrace() {
    const t = ui.dry ?? state.lastRecall;
    const dryForm = `<div class="card"><b>질문 넣어보기</b><div class="small muted" style="margin:2px 0 8px">이 말을 보내면 어떤 메모가 떠오르는지 미리 봐요. 실제로 보내지는 않아요. (Jev 1회 · 임베딩 1회 사용)</div>
      <div class="row"><input class="inp" id="dry" style="flex:1;min-width:180px" placeholder="예: 유나가 말한 아카데미 규칙 기억나?"><button class="btn p" data-act="dry-run">미리 보기</button></div>
      ${ui.dry ? '<div class="small muted" style="margin-top:6px">아래는 미리 보기 결과예요. <button class="btn sm" data-act="dry-clear">마지막 실제 회상 보기</button></div>' : ''}</div>`;
    if (!t) return `${dryForm}<div class="card muted small">아직 회상 기록이 없어요.</div>`;
    const arcs = (t.arcs ?? []).map(a => `<tr><td>${a.chosen ? '✅' : ''}</td><td>${escapeHtml(a.title)}</td><td class="num">${a.s}</td><td class="num">${a.p == null ? '-' : Math.round(a.p * 100) + '%'}</td></tr>`).join('');
    const cands = (t.cands ?? []).map(c => {
      const e = eventById(c.id);
      return e ? `<tr><td>${c.pick ? '✅' : ''}</td><td><span class="chip k">${KINDS[e.kind]?.label}</span> ${escapeHtml(clip(e.c ?? e.t, 90))}</td><td class="num">${c.s}</td><td class="num">${c.p == null ? '-' : Math.round(c.p * 100) + '%'}</td></tr>` : '';
    }).join('');
    return `${dryForm}
      <div class="card small muted">${timeAgo(t.at)} · ${t.ms}ms · ${t.usedEmbed ? '임베딩 ✓' : '임베딩 ✕ (단어 겹침으로 대신)'} · ${t.usedJev ? 'Jev ✓' : 'Jev ✕ (점수만으로 대신)'}${t.note ? ` · ${escapeHtml(t.note)}` : ''}</div>
      <div class="sec">① 대단원 고르기</div>
      <div class="card">${arcs ? `<table><tr><th></th><th>대단원</th><th class="num">점수</th><th class="num">Jev</th></tr>${arcs}</table>` : '<span class="small muted">대단원이 하나뿐이거나 없어요.</span>'}</div>
      <div class="sec">② 메모 판정 <span class="small" style="font-weight:400">점수 = 임베딩·단어·인물 / Jev = 이 장면에 필요할 확률 (기준 ${settings.recallThreshold}%)</span></div>
      <div class="card">${cands ? `<table><tr><th></th><th>메모</th><th class="num">점수</th><th class="num">Jev</th></tr>${cands}</table>` : '<span class="small muted">후보가 없어요.</span>'}</div>
      <div class="sec">③ 실제로 들어간 내용</div>
      <div class="pre">${escapeHtml(t.preview || '(없음)')}</div>`;
  }

  async function dryRun(text) {
    // 마지막 요청이 있으면 그걸, 없으면 채팅 원본의 최근 메시지로 "지금 대화"를 만든다.
    let base = lastEntries?.key === chatKey ? lastEntries.entries : null;
    if (!base) {
      if (!await ensureChat()) throw new Error('채팅방을 먼저 열어 주세요.');
      base = rawEntries().slice(-40).map((e, i) => ({ ...e, index: i }));
      if (!base.length) throw new Error('채팅 원본을 읽지 못했어요. 채팅방이 열려 있는지 확인해 주세요.');
    }
    const dryHash = hashText('dry\u0000' + text);
    const entries = [...base, { index: -1, role: 'user', text, hash: dryHash, key: `h:${dryHash}` }];
    const { outside } = splitRaw(entries, settings);
    const visible = new Set(entries.filter(e => !outside.includes(e) || !isSeen(e)).flatMap(e => [e.key, e.hash]));
    const { picks, trace, sc } = await recall(entries, visible, settings, { dry: true });
    const preview = await translateBlock(formatMemories(picks, sc, settings), settings);
    return { ...trace, preview, picks: picks.map(x => ({ id: x.e.id, p: round2(x.p) })) };
  }

  // ── 설정 ──

  function renderSettings() {
    const d = ui.draft ?? (ui.draft = { ...settings });
    const field = (label, help, input) => `<div class="f"><div><label>${label}</label>${help ? `<div class="help">${help}</div>` : ''}</div><div>${input}</div></div>`;
    const num = (k, min, max) => `<input class="inp" type="number" inputmode="numeric" min="${min}" max="${max}" data-field="${k}" value="${escapeHtml(d[k])}">`;
    return `<div class="sec">Jev 연결</div><div class="card">${jevFields(d)}</div>
      <div class="sec">임베딩</div><div class="card">${embedFields(d)}</div>
      <div class="sec">모드</div><div class="card">${modeFields(d)}
        <details${d.mode === 'custom' ? ' open' : ''}><summary>숫자로 직접 조절</summary>
          ${field('원문 예산 (토큰)', '최근 대화를 이만큼 원문으로 보내요. 그보다 오래된 건 메모로 대체돼요.', num('rawBudget', 500, 200000))}
          ${field('원문 최소 개수', '예산과 상관없이 최근 이만큼은 꼭 원문으로.', num('minRaw', 2, 100))}
          ${field('메모 주입 예산 (토큰)', '0이면 회상을 끕니다.', num('recallBudget', 0, 20000))}
          ${field('장면당 메모 수', '장면마다 중요한 사건 몇 개만 남길지. 적을수록 쓸모없는 메모가 줄어요.', num('eventsPerScene', 1, 20))}
          ${field('Jev 후보 수', '매 턴 Jev에게 물어볼 메모 수.', num('candidates', 4, 200))}
          ${field('대단원 후보 수', '먼저 고를 대단원 수.', num('arcs', 1, 10))}
          ${field('회상 기준 (%)', 'Jev가 "필요"라고 본 확률이 이 이상이면 넣어요. 등장인물의 인물정보·관계·약속·비밀은 기준을 낮춰 줘요.', num('recallThreshold', 1, 99))}
          ${field('저장 기준 (%)', '"잡담·사소함"이 아니라고 본 확률이 이 이상인 문장만 메모 후보가 돼요.', num('saveThreshold', 1, 99))}
        </details></div>
      <div class="sec">추출 · 정리</div><div class="card">
        ${field('대사 줄에서 이름 뽑기', '이름(억양): "대사" 같은 줄이 있으면 화자를 인물로 등록해요.', sw('parseSpeakers', d.parseSpeakers))}
        ${field('상태줄에서 날짜·장소 뽑기', '2023-04-03 ◆ 09:15 ◆ 장소 같은 줄이 있으면 읽어요. 없으면 Jev가 시간 흐름을 판단해 N일차로 세요.', sw('parseStatus', d.parseStatus))}
        ${field('새 단어 분류', '처음 보는 단어가 인물·장소·물건인지 Jev가 한 번만 판정해요.', sw('classifyWords', d.classifyWords))}
        ${field('"기타" 단어 자동 비우기', 'Jev가 그냥 단어라고 판정해서 다시 묻지 않는 목록을 정해진 턴마다 비워요. 잘못 판정된 이름이 다시 기회를 얻지만, 다시 묻느라 토큰이 조금 더 들어요.', sw('rejAutoClear', d.rejAutoClear))}
        ${field('비우는 간격 (턴)', '', `<input class="inp" type="number" inputmode="numeric" min="10" max="10000" data-field="rejClearEvery" value="${escapeHtml(d.rejClearEvery)}">`)}
        ${field('메모 압축', '말버릇을 빼고, 메모가 처음 쓰일 때 Jev가 원문에서 필요한 단어만 골라 짧게 만들어요. 원문은 보관돼요.', sw('compress', d.compress))}
        ${field('카드로 정리', '메모마다 형식(말·규칙·소문…), 지금도 유효한지, 누구 얘기인지, 앞 문장을 Jev로 붙여요. 메모당 Jev 문항이 2~3개 늘어요.', sw('cards', d.cards))}
        ${field('바뀐 기억 정리', '새 메모가 옛 메모를 뒤집으면 옛 것을 "지난 기억"으로 내려요. 같은 말 반복도 걸러요.', sw('supersede', d.supersede))}
      </div>
      <div class="sec">주입</div><div class="card">
        ${field('넣는 위치', '프롬프트에 [jevhypa]를 써 두면 그 자리에 들어가요.', `<select class="sel" data-field="injectMode"><option value="last_user"${d.injectMode === 'last_user' ? ' selected' : ''}>최신 유저 입력 앞</option><option value="system"${d.injectMode === 'system' ? ' selected' : ''}>최신 메시지 앞 system</option></select>`)}
        ${field('메모 모양', '압축 메모가 짧고, 원문 문장은 자연스러워요.', `<select class="sel" data-field="injectStyle"><option value="memo"${d.injectStyle === 'memo' ? ' selected' : ''}>압축 메모</option><option value="original"${d.injectStyle === 'original' ? ' selected' : ''}>원문 문장</option></select>`)}
        ${field('메인 모델에게 하는 안내', '메모가 어색할 수 있으니 뜻을 추론하라고 알려 주는 문장. 비우면 안 넣어요.', `<textarea class="ta" data-field="note" style="min-height:70px">${escapeHtml(d.note)}</textarea>`)}
        ${field('블록 이름', '', `<input class="inp" data-field="injectLabel" value="${escapeHtml(d.injectLabel)}">`)}
        ${field('이야기 날짜 붙이기', '[04-03 09:15] / [2일차]', sw('showStoryTime', d.showStoryTime))}
        ${field('메모 번역 (보낼 때만)', '메인 모델에 보내기 직전에 메모 줄만 영어로 바꿔 토큰을 아껴요. 저장된 메모는 한국어 그대로예요. 구글 무료는 공식 API가 아니라 언제든 막힐 수 있어요.', `<select class="sel" data-field="translate">${Object.entries(TRANSLATORS).map(([k, v]) => `<option value="${k}"${d.translate === k ? ' selected' : ''}>${v}</option>`).join('')}</select>`)}
        <div data-tr="deepl llm" style="${d.translate === 'deepl' || d.translate === 'llm' ? '' : 'display:none'}">${field('번역 키', 'DeepL: API 키 (무료 키는 :fx로 끝나요) · LLM: OpenRouter 키 (비우면 Jev 키)', `<input class="inp" type="password" autocomplete="off" data-field="translateKey" value="${escapeHtml(d.translateKey)}">`)}</div>
        <div data-tr="llm" style="${d.translate === 'llm' ? '' : 'display:none'}">${field('번역 모델', 'OpenRouter 모델 ID', `<input class="inp" data-field="translateModel" value="${escapeHtml(d.translateModel)}">`)}</div>
      </div>
      <div class="sec">화면</div><div class="card">
        ${field('우측 상단 바로가기', '채팅 화면에 🧠 버튼을 띄워요.', sw('showButton', d.showButton))}
        ${field('전체 사용', '끄면 모든 채팅에서 요청을 건드리지 않아요.', sw('enabled', d.enabled))}
      </div>
      <div class="foot"><span id="save-state" class="small muted" style="margin-right:auto;align-self:center">바꾸면 바로 저장돼요</span><button class="btn" data-act="settings-reset">기본값으로</button><button class="btn" data-act="wizard">시작 안내 다시 보기</button></div>`;
  }

  // ── 설정 자동 저장 ──
  //  설정 탭에서 무엇이든 바꾸면 잠깐 뒤(입력 중이면 멈춘 뒤) 저장한다. 탭을 옮기거나 창을 닫으면 바로 저장한다.

  function setSaveState(text) {
    const el = document.getElementById('save-state');
    if (el) el.textContent = text;
  }

  function scheduleSettingsSave(delay = 500) {
    if (ui.wiz || ui.tab !== 'settings') return;
    ui.draft = readForm(ui.draft ?? settings);
    setSaveState('저장 중…');
    clearTimeout(ui.saveTimer);
    ui.saveTimer = setTimeout(() => { void flushSettingsSave(); }, delay);
  }

  async function flushSettingsSave() {
    clearTimeout(ui.saveTimer);
    ui.saveTimer = null;
    if (!ui.draft) return;
    const before = embedProfile();
    const draft = ui.draft;
    await saveSettings(draft);
    if (ui.draft === draft) ui.draft = { ...settings };
    setSaveState('저장됨 ✓');
    if (embedProfile() !== before && state.events.some(e => e.vp && e.vp !== embedProfile())) toast('임베딩 설정이 바뀌었어요. 홈에서 "다시 계산"을 눌러 주세요.');
  }

  /** 화면에 있는 입력값을 초안(draft)에 반영한다. */
  function readForm(base) {
    const d = { ...base };
    for (const el of document.querySelectorAll('[data-field]')) {
      if (el.tagName === 'BUTTON') continue;
      const k = el.dataset.field;
      if (el.type === 'checkbox') d[k] = el.checked;
      else if (el.type === 'number' || k === 'embedDims') d[k] = Number(el.value);
      else d[k] = el.value;
    }
    if (MODE_KEYS.some(k => d[k] !== base[k]) && d.mode !== 'custom' && MODES[d.mode] && MODE_KEYS.some(k => d[k] !== MODES[d.mode][k])) d.mode = 'custom';
    return d;
  }

  function currentDraft() {
    if (ui.wiz) return (ui.wiz.d = readForm(ui.wiz.d));
    if (ui.tab === 'settings') return (ui.draft = readForm(ui.draft ?? settings));
    return settings;
  }

  function pickPreset(d, field, value) {
    if (field === 'jevPreset') {
      const p = JEV_PRESETS[value];
      return { ...d, jevPreset: value, jevEndpoint: p.endpoint, jevModel: p.model };
    }
    if (field === 'embedPreset') {
      const p = EMBED_PRESETS[value];
      return { ...d, embedPreset: value, embedEndpoint: p.endpoint ?? '', embedModel: p.model ?? '' };
    }
    if (field === 'mode') return applyMode(d, value);
    return { ...d, [field]: value };
  }

  async function runTest(which) {
    const d = sanitizeSettings(currentDraft());
    ui.test[which] = { running: true };
    render();
    const started = Date.now();
    try {
      if (which === 'jev') {
        const { answers, model } = await callJev('[STORY]\n서진은 민우에게 토요일에 바다에 가자고 약속했다.', { t: { type: 'noul', instructions: 'Did 서진 make a promise about going to the sea?' } }, d);
        const p = noulProb(answers.t);
        ui.test.jev = p > 0.5 ? { ok: true, msg: `연결됨 · ${Date.now() - started}ms · ${model}` } : { warn: true, msg: `연결은 됐지만 판단이 이상해요 (${Math.round(p * 100)}%). 모델 이름을 확인해 보세요.` };
      } else {
        const [a, b, c] = await embedTexts(['토요일에 바다에 가기로 약속했다', '주말에 해변 가자고 했다', '검은 성의 기사단'], d);
        const near = dot(a, b), far = dot(a, c);
        ui.test.embed = near > far
          ? { ok: true, msg: `연결됨 · ${Date.now() - started}ms · ${a.length}차원 · 비슷한 말 ${near.toFixed(2)} > 다른 말 ${far.toFixed(2)}` }
          : { warn: true, msg: `연결은 됐지만 뜻 구분이 약해요 (비슷한 말 ${near.toFixed(2)}, 다른 말 ${far.toFixed(2)}). 다른 모델을 써 보세요.` };
      }
    } catch (error) {
      ui.test[which] = { ok: false, msg: String(error?.message ?? error) };
    }
    render();
  }

  // ── 도구 ──

  function renderTools() {
    const tool = (title, desc, act, label, danger) => `<div class="card row" style="justify-content:space-between"><div style="flex:1;min-width:200px"><b>${title}</b><div class="help">${desc}</div></div><button class="btn${danger ? ' d' : ''}" data-act="${act}">${label}</button></div>`;
    const size = (() => { try { return Math.round(JSON.stringify(state).length / 1024); } catch { return 0; } })();
    return `${ui.progress ? `<div class="card small">${escapeHtml(ui.progress)}</div>` : ''}
      ${tool('지금 전부 처리', `채팅 원본 ${state.total ?? 0}개 중 ${Math.max(0, (state.total ?? 0) - (state.pending ?? 0) - (state.gap ?? 0))}개 정리됨 · 남은 것 ${(state.pending ?? 0) + (state.gap ?? 0)}개. 오래된 것부터 순서대로 처리해요. (최근 ${SETTLE}개는 리롤될 수 있어서 빼요)`, 'process-all', '처리')}
      ${tool('임베딩 다시 계산', '임베딩 설정을 바꿨거나 벡터가 없는 메모를 새로 계산해요.', 'reembed', '계산')}
      ${tool('인물 태그 다시 붙이기', '별명을 묶거나 인물을 추가한 뒤 쓰면 좋아요. Jev 호출 없음.', 'retag', '다시 붙이기')}
      ${tool('내보내기', `이 채팅의 대단원·장면·메모·사전을 파일로 저장해요. (지금 약 ${size}KB)`, 'export', '내보내기')}
      <div class="card row" style="justify-content:space-between"><div style="flex:1;min-width:200px"><b>가져오기</b><div class="help">내보낸 파일로 이 채팅의 기억을 바꿔요. 지금 것은 덮어써져요.</div></div><label class="btn">파일 선택<input type="file" id="imp" accept=".json,application/json" style="display:none"></label></div>
      ${tool('지난 기억 비우기', '"지난 기억"으로 내려간 메모를 지워요.', 'purge-old', '비우기')}
      ${tool('처음부터 다시 정리', '메모·장면·대단원을 지우고 처리 기록을 초기화해요. 사전은 남아요. 다음 대화부터 다시 정리돼요.', 'rebuild', '다시 정리', true)}
      ${tool('이 채팅 기억 전부 삭제', '메모, 장면, 대단원, 사전, 처리 기록을 모두 지워요. 되돌릴 수 없어요.', 'clear', '전부 삭제', true)}`;
  }

  function downloadJson(value, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── 이벤트 ──

  function bindOnce() {
    if (ui.bound) return;
    ui.bound = true;
    document.body.addEventListener('click', (e) => { void onClick(e); });
    document.body.addEventListener('change', (e) => { void onChange(e); });
    document.body.addEventListener('input', (e) => {
      if (e.target.id === 'q') {
        ui.query = e.target.value;
        clearTimeout(ui.qTimer);
        ui.qTimer = setTimeout(() => { const pos = e.target.selectionStart; render(); const q = document.getElementById('q'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } }, 250);
      }
      if (e.target.id === 'ed-imp') { const v = document.getElementById('ed-imp-v'); if (v) v.textContent = `${e.target.value}%`; }
      if (e.target.dataset?.field && ui.tab === 'settings' && !ui.wiz) scheduleSettingsSave(800); // 키·주소 입력 중이면 멈춘 뒤 저장
    });
    document.body.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && ui.editing) { ui.editing = null; render(); }
      if (e.key === 'Enter' && e.target.id === 'dry') document.querySelector('[data-act="dry-run"]')?.click();
      if (e.key === 'Enter' && e.target.id === 'ent-name') document.querySelector('[data-act="ent-add"]')?.click();
    });
  }

  async function onChange(e) {
    const el = e.target;
    const act = el.dataset?.act;
    if (el.dataset?.modelFor) {
      // 목록에서 고르면 입력칸을 채우고 숨긴다. "직접 입력…"이면 입력칸을 보여 준다.
      const input = el.parentElement?.querySelector(`[data-field="${el.dataset.modelFor}"]`);
      if (!input) return;
      if (el.value === '__custom') { input.style.display = ''; input.focus(); input.select?.(); }
      else { input.value = el.value; input.style.display = 'none'; }
      ui.test[el.dataset.modelFor === 'jevModel' ? 'jev' : 'embed'] = null;
      scheduleSettingsSave();
      return;
    }
    if (el.dataset?.field === 'translate') document.querySelectorAll('[data-tr]').forEach(r => { r.style.display = r.dataset.tr.split(' ').includes(el.value) ? '' : 'none'; });
    if (el.dataset?.field && ui.tab === 'settings' && !ui.wiz) { scheduleSettingsSave(); return; }
    if (act === 'who-select') { ui.who = el.value; render(); return; }
    if (act === 'ent-type') { const x = state.dict.e[el.dataset.name]; if (x) { x.type = el.value; matcherCache = null; await persist(); render(); } return; }
    if (act === 'ent-alias' && el.value) {
      const name = el.dataset.name, target = el.value;
      if (!await confirmDialog(`"${name}"을(를) "${target}"의 별명으로 묶을까요?`, '묶기')) { el.value = ''; return; }
      mergeAlias(name, target);
      retagAll();
      await persist();
      render();
      toast(`${name} → ${target}`);
      return;
    }
    if (el.id === 'imp' && el.files?.[0]) {
      try {
        const data = JSON.parse(await el.files[0].text());
        if (!data || !Array.isArray(data.events) || !Array.isArray(data.arcs)) throw new Error('JevHypa 내보내기 파일이 아니에요.');
        if (!await confirmDialog(`메모 ${data.events.length}개로 이 채팅의 기억을 덮어쓸까요?`, '덮어쓰기')) return;
        state = migrateState(data);
        seenSet = new Set(state.seen);
        rejSet = new Set(state.dict.rej);
        gramCache = new Map();
        matcherCache = null;
        recallCache.clear();
        await persist();
        render();
        toast('가져왔어요.');
      } catch (error) { toast(String(error?.message ?? error)); }
      finally { el.value = ''; }
    }
  }

  async function onClick(e) {
    const el = e.target.closest?.('[data-act]');
    if (!el || el.tagName === 'SELECT') return;
    const act = el.dataset.act;
    const id = Number(el.dataset.id);
    const ev = Number.isFinite(id) ? eventById(id) : null;
    const changed = async (msg) => { recallCache.clear(); await persist(); render(); if (msg) toast(msg); };

    switch (act) {
      case 'close': if (ui.tab === 'settings' && !ui.wiz) { ui.draft = readForm(ui.draft ?? settings); await flushSettingsSave(); } await R.hideContainer(); return;
      case 'tab':
        if (ui.tab === 'settings' && el.dataset.tab !== 'settings' && !ui.wiz) { ui.draft = readForm(ui.draft ?? settings); await flushSettingsSave(); ui.draft = null; }
        ui.tab = el.dataset.tab; render(); return;
      case 'pick': {
        const d = currentDraft();
        const next = pickPreset(d, el.dataset.field, el.dataset.value);
        if (ui.wiz) ui.wiz.d = next; else ui.draft = next;
        if (el.dataset.field !== 'mode') ui.test[el.dataset.field === 'jevPreset' ? 'jev' : 'embed'] = null;
        render();
        if (!ui.wiz && ui.tab === 'settings') { setSaveState('저장 중…'); await flushSettingsSave(); }
        return;
      }
      case 'test-jev': await runTest('jev'); return;
      case 'test-embed': await runTest('embed'); return;
      case 'wizard': ui.wiz = { step: 1, d: { ...settings }, manual: true }; render(); return;
      case 'wiz-back': currentDraft(); ui.wiz.step--; render(); return;
      case 'wiz-next': {
        const d = currentDraft();
        if (ui.wiz.step === 1 && !d.jevKey) { toast('Jev API 키를 넣어 주세요.'); return; }
        if (ui.wiz.step === 2 && EMBED_PRESETS[d.embedPreset].key === 'own' && !d.embedKey) { toast('임베딩 API 키를 넣거나 다른 걸 골라 주세요.'); return; }
        ui.wiz.step++;
        render();
        return;
      }
      case 'wiz-finish': {
        const d = currentDraft();
        await saveSettings({ ...d, onboarded: true });
        ui.wiz = null;
        ui.tab = 'home';
        render();
        toast('준비됐어요. 대화를 이어가면 기억이 쌓여요.');
        return;
      }
      case 'settings-save': ui.draft = readForm(ui.draft ?? settings); await flushSettingsSave(); return;
      case 'settings-reset':
        if (await confirmDialog('키는 그대로 두고 나머지 설정을 기본값으로 돌릴까요?', '돌리기')) {
          const d = currentDraft();
          ui.draft = { ...DEFAULT_SETTINGS, jevKey: d.jevKey, embedKey: d.embedKey, onboarded: true };
          render();
          await flushSettingsSave();
        }
        return;
      case 'toggle-chat': state.off = !state.off; await changed(state.off ? '이 채팅에서 껐어요.' : '이 채팅에서 켰어요.'); return;
      case 'toggle-global': await saveSettings({ ...settings, enabled: !settings.enabled }); render(); return;
      case 'who': ui.tab = 'timeline'; ui.who = el.dataset.who; ui.query = ''; render(); return;
      case 'arc-toggle': {
        if (e.target.closest('[data-act="arc-rename"]')) return;
        const aid = Number(el.dataset.id);
        if (ui.openArcs.has(aid)) ui.openArcs.delete(aid); else ui.openArcs.add(aid);
        render();
        return;
      }
      case 'arc-rename': {
        e.stopPropagation();
        const a = arcById(id);
        if (!a) return;
        const name = await inputDialog('대단원 이름', '비우면 자동 이름을 써요.', a.title ?? '');
        if (name == null) return;
        a.title = name.trim();
        await changed('이름을 바꿨어요.');
        return;
      }
      case 'orig': if (ui.showOrig.has(id)) ui.showOrig.delete(id); else ui.showOrig.add(id); render(); return;
      case 'pin': if (ev) { ev.pin = !ev.pin; await changed(ev.pin ? '항상 넣도록 고정했어요.' : '고정을 풀었어요.'); } return;
      case 'restore': if (ev) { delete ev.old; await changed('다시 회상 대상에 넣었어요.'); } return;
      case 'del':
        if (ev && await confirmDialog('이 메모를 지울까요?', '삭제')) {
          state.events = state.events.filter(x => x.id !== id);
          refreshArc(arcById(ev.arc));
          await changed('지웠어요.');
        }
        return;
      case 'new': ui.editing = 'new'; render(); return;
      case 'edit': ui.editing = id; render(); return;
      case 'overlay': if (e.target === el) { ui.editing = null; render(); } return;
      case 'edit-cancel': ui.editing = null; render(); return;
      case 'edit-save': {
        const val = (s) => document.getElementById(s)?.value.trim() ?? '';
        const t = val('ed-t');
        if (!t) { toast('내용을 입력하세요.'); return; }
        const fields = {
          t, kind: KINDS[val('ed-kind')] ? val('ed-kind') : 'event', imp: Number(val('ed-imp') || 90) / 100,
          pin: !!document.getElementById('ed-pin')?.checked,
          who: [...new Set(val('ed-who').split(',').map(s => s.trim()).filter(Boolean).map(canonical))].slice(0, 4),
        };
        for (const w of fields.who) if (!state.dict.e[w]) addEntity(w, 'person', 'manual', 2);
        let target;
        if (ui.editing === 'new') {
          if (!chatKey) { toast('채팅방을 먼저 여세요.'); return; }
          if (!state.open.scene || !sceneById(state.open.scene)) openScene();
          target = { id: ++state.seq, ...fields, r: 'c', place: state.clock.place, when: nowWhen(), src: 'manual', scene: state.open.scene, arc: state.open.arc, hits: 0, lastHit: 0, at: Date.now(), vec: null, vp: null };
          state.events.push(target);
        } else {
          target = eventById(ui.editing);
          if (target) { Object.assign(target, fields); gramCache.delete(target.id); target.vec = null; target.vp = null; }
        }
        if (target) {
          delete target.c;
          delete target.cz;
          if (settings.compress) applyFreeTrim(target);
          try { const [v] = await embedTexts([target.t]); target.vec = encodeVec(v); target.vp = embedProfile(); } catch (error) { setError('임베딩', error); }
          refreshArc(arcById(target.arc));
        }
        ui.editing = null;
        await changed('저장했어요.');
        return;
      }
      case 'ent-add': {
        const name = document.getElementById('ent-name')?.value.trim();
        if (!name) { toast('이름을 입력하세요.'); return; }
        if (!chatKey) { toast('채팅방을 먼저 여세요.'); return; }
        addEntity(name, document.getElementById('ent-type')?.value ?? 'person', 'manual', 2);
        const n = retagAll();
        await changed(`${name} 추가${n ? ` · 메모 ${n}개 태그` : ''}`);
        return;
      }
      case 'ent-confirm': { const x = state.dict.e[el.dataset.name]; if (x) { x.src = 'manual'; x.n = Math.max(x.n, SPEAKER_ACTIVE_COUNT); retagAll(); await changed('인물로 등록했어요.'); } return; }
      case 'ent-del': {
        const name = el.dataset.name;
        delete state.dict.e[name];
        for (const [n, x] of Object.entries(state.dict.e)) if (x.alias === name) delete state.dict.e[n];
        rejSet.add(name);
        for (const x of state.events) x.who = x.who.filter(w => w !== name);
        matcherCache = null;
        for (const a of state.arcs) refreshArc(a);
        await changed(`${name}을(를) 뺐어요.`);
        return;
      }
      case 'sug-yes': { const s = state.dict.sug[Number(el.dataset.i)]; if (s) { mergeAlias(s.from, s.to); retagAll(); await changed(`${s.from} → ${s.to}의 별명`); } return; }
      case 'sug-no': { const i = Number(el.dataset.i); const s = state.dict.sug[i]; if (s) { state.dict.sug.splice(i, 1); state.dict.nosug.push(`${s.from}>${s.to}`); await changed('다시 묻지 않을게요.'); } return; }
      case 'rej-clear': rejSet = new Set(); state.rejClearedTurn = state.turn; await changed('비웠어요.'); return;
      case 'sel': {
        ui.selPeople ??= new Set();
        const n = el.dataset.name;
        if (ui.selPeople.has(n)) ui.selPeople.delete(n); else ui.selPeople.add(n);
        render();
        return;
      }
      case 'sel-clear': ui.selPeople = new Set(); render(); return;
      case 'merge-selected': {
        const names = [...(ui.selPeople ?? [])].filter(n => state.dict.e[n] && !state.dict.e[n].alias);
        if (names.length < 2) { toast('두 명 이상 골라 주세요.'); return; }
        const main = await mergeDialog(names);
        if (!main) return;
        mergePeople(names, main);
        ui.selPeople = new Set();
        await changed(`${names.length}개 이름을 ${main}(으)로 묶었어요.`);
        return;
      }
      case 'dup-merge': {
        const g = ui.dupGroups?.[Number(el.dataset.i)];
        if (!g) return;
        const main = await mergeDialog(g);
        if (!main) return;
        mergePeople(g, main);
        await changed(`${g.length}개 이름을 ${main}(으)로 묶었어요.`);
        return;
      }
      case 'dup-no': {
        const g = ui.dupGroups?.[Number(el.dataset.i)];
        if (g) { state.dict.nosug.push(`dup:${[...g].sort().join('|')}`); await changed('다시 제안하지 않을게요.'); }
        return;
      }
      case 'dry-run': {
        const text = document.getElementById('dry')?.value.trim();
        if (!text) { toast('보낼 말을 입력하세요.'); return; }
        toast('미리 보는 중…');
        try { ui.dry = await dryRun(text); render(); } catch (error) { toast(String(error?.message ?? error)); }
        return;
      }
      case 'dry-clear': ui.dry = null; render(); return;
      case 'process-all': {
        let rebuild = el.dataset.rebuild === '1';
        if (rebuild && !await confirmDialog('메모·장면·대단원을 지우고 채팅 처음부터 순서대로 다시 정리할까요?\n사전(인물·장소)은 남아요. 긴 채팅은 시간이 걸려요.', '다시 정리')) return;
        const progress = (done, total) => { ui.progress = `정리 중… ${done} / ${total}개`; render(); };
        try {
          ui.progress = '정리 중…';
          render();
          try {
            await processAll(progress, { rebuild });
          } catch (error) {
            if (error?.code !== 'ORDER_GAP') throw error;
            ui.progress = '';
            render();
            if (!await confirmDialog(`뒷부분이 먼저 정리돼 있어서, 앞부분 ${error.count}개를 지금 넣으면 이야기 순서가 꼬여요.\n처음부터 순서대로 다시 정리할까요? (사전은 남아요)`, '처음부터 다시 정리')) return;
            rebuild = true;
            await processAll(progress, { rebuild });
          }
          ui.progress = '';
          await changed(state.pending ? `일부만 정리했어요. 남은 것 ${state.pending}개는 오류 기록을 확인해 주세요.` : '다 정리했어요.');
        } catch (error) { ui.progress = ''; refreshPending(); render(); toast(String(error?.message ?? error)); }
        return;
      }
      case 'reembed': {
        try {
          ui.progress = '임베딩 계산 중…';
          render();
          await reembedAll((done, total) => { ui.progress = `임베딩 계산 중… ${done} / ${total}`; render(); });
          ui.progress = '';
          await changed('임베딩을 다시 계산했어요.');
        } catch (error) { ui.progress = ''; render(); toast(String(error?.message ?? error)); }
        return;
      }
      case 'retag': { const n = retagAll(); await changed(n ? `메모 ${n}개 태그를 고쳤어요.` : '바뀐 태그가 없어요.'); return; }
      case 'export': downloadJson(state, `jevhypa_${(chatLabel.char || 'chat').replace(/[\\/:*?"<>|]/g, '_')}.json`); return;
      case 'purge-old': {
        const n = state.events.filter(x => x.old && !x.pin).length;
        if (!n) { toast('지난 기억이 없어요.'); return; }
        if (await confirmDialog(`지난 기억 ${n}개를 지울까요?`, '지우기')) { state.events = state.events.filter(x => !x.old || x.pin); await changed(`${n}개를 지웠어요.`); }
        return;
      }
      case 'rebuild':
        if (await confirmDialog('메모·장면·대단원을 지우고 처음부터 다시 정리할까요?\n사전(인물·장소)은 남아요.', '다시 정리')) {
          resetMemories();
          refreshPending();
          await changed('지웠어요. "지금 전부 처리"를 누르면 처음부터 순서대로 정리해요.');
        }
        return;
      case 'clear':
        if (await confirmDialog('이 채팅의 기억을 모두 지울까요?\n되돌릴 수 없어요.', '전부 삭제')) {
          state = { ...emptyState(), off: state.off };
          seenSet = new Set();
          rejSet = new Set();
          gramCache = new Map();
          matcherCache = null;
          await changed('모두 지웠어요.');
        }
        return;
    }
  }

  // ── 바로가기 버튼 ──

  let buttonPartId = null;
  async function syncButton() {
    try {
      if (settings.showButton && !buttonPartId && R.registerButton) {
        const part = await R.registerButton({ name: 'JevHypa', icon: '🧠', iconType: 'html', location: 'action', id: 'jevhypa-gui' }, async () => { await openPanel('home'); });
        buttonPartId = part?.id ?? 'jevhypa-gui';
      } else if (!settings.showButton && buttonPartId && R.unregisterUIPart) {
        await R.unregisterUIPart(buttonPartId);
        buttonPartId = null;
      }
    } catch (error) { console.error(LOG, '바로가기 버튼 등록 실패', error); }
  }

  // ── 시작 ──

  await loadSettings();
  await R.registerSetting('JevHypa', () => openPanel(), '🧠', 'html', 'jevhypa-settings');
  await R.addRisuReplacer('beforeRequest', beforeRequestHandler);
  await R.addRisuReplacer('afterRequest', afterRequestHandler);
  if (R.onUnload) {
    await R.onUnload(async () => {
      await Promise.allSettled([
        R.removeRisuReplacer('beforeRequest', beforeRequestHandler),
        R.removeRisuReplacer('afterRequest', afterRequestHandler),
        buttonPartId && R.unregisterUIPart ? R.unregisterUIPart(buttonPartId) : null,
      ]);
    });
  }
  await syncButton();
  try { await ensureChat(); } catch { }
  console.log(LOG, '준비 완료 · 메모', state.events.length, '개');

  if (globalThis.__JM2_TEST__) {
    globalThis.__JM2_TEST__.x = {
      analyzeEntry, parseStatus, subjectOf, outfitSnippet, sceneCap, translateBlock, rankProb, packSentences, parseSpeakerLine, findIntros, wordCandidates, freeTrim, hashEmbed, embedTexts, encodeVec, decodeVec, dot,
      ingest, recall, formatMemories, splitRaw, stripMeta, pickUnits, compressRecalled, duplicateGroups, samePerson, mergePeople, romanize, setPipeline: (v) => { PIPELINE = v; }, rawEntries, alignKeys, refreshPending, ensureChat, beforeRequestHandler, afterRequestHandler, processAll, reembedAll, dryRun,
      saveSettings, sanitizeSettings, embedProfile, cleanKey, keyProblem, callJev, mergeAlias, retagAll, addEntity, openPanel, render,
      getState: () => state, getSettings: () => settings, getSeen: () => seenSet, stats, ui, waitJob: () => job ?? Promise.resolve(),
    };
  }
})();
