/**
 * Extraction and matching of account credentials from supplier lines.
 *
 * Staff receive accounts as a line per account with Chinese labels and noise around them:
 *   ttxx7834 密码 a8dqq9sr 运动switch
 *   游戏 FC26 账号 e8yuh8S9@xiaohu666.com 密码 qw83150220
 *   pptt2207 密码 tk58j6vk 塞尔达传说 买三送一
 *   rrtt8896 密码 45g54pby 朋友收集 梦想生活
 *   bbmm5477 密码 sr2af42m 星球大战 亡命之徒 黄金版
 *
 * Only three things matter: the login (username/email), the password, and the game identifier.
 * Everything else (promotional packaging, Chinese annotations) is stripped and never sent to customers.
 *
 * No AI is used: deterministic parsing and alias-based fuzzy matching.
 */

export interface ParsedAccountLine {
  /** Login: an email or a platform username */
  username: string;
  /** Password */
  password: string;
  /** Cleaned game hint without promotional noise */
  label?: string;
  /** Raw input line */
  raw: string;
}

/** Labels that introduce a value in supplier lines */
const ACCOUNT_MARKERS = [
  "账号",
  "帐号",
  "账户",
  "用户名",
  "account",
  "user",
  "username",
  "id",
  "email",
  "mail",
  "login",
];

const PASSWORD_MARKERS = ["密码", "密碼", "password", "pass", "pwd"];
const GAME_MARKERS = ["游戏", "遊戲", "game", "title", "name"];

/** Chinese / CJK characters pattern */
const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/** Supplier marketing noise words to strip completely */
const SUPPLIER_NOISE_TERMS = [
  "买三送一",
  "买二送一",
  "买一送一",
  "买四送一",
  "买5送1",
  "买3送1",
  "国行",
  "港版",
  "日版",
  "美版",
  "欧版",
  "韩版",
  "全区中文",
  "中文版",
  "中文",
  "普通版",
  "标准版",
  "豪华版",
  "终极版",
  "数字版",
  "黄金版",
  "典藏版",
  "季票",
  "本体",
  "独享",
  "共享",
  "主账号",
  "认证版",
  "非认证",
  "一手",
  "二手",
  "包售后",
  "带邮箱",
  "不可改密",
  "可改密",
  "会员",
  "plus",
  "pass",
  "dlc",
];

function isCjk(token: string): boolean {
  return CJK.test(token);
}

function isMarker(token: string, markers: string[]): boolean {
  const lowered = token.toLowerCase().replace(/[:：=]+$/, "");
  return markers.some((marker) => lowered === marker.toLowerCase());
}

/** Check if token looks like a credential (no Chinese, valid chars) */
export function looksLikeCredential(token: string): boolean {
  if (!token || token.length < 3 || token.length > 190) return false;
  if (isCjk(token)) return false;
  // Exclude bare noise tags like 'switch' or 'ps5' if they stand alone without symbols/digits
  const low = token.toLowerCase();
  if (["switch", "ps4", "ps5", "xbox", "steam"].includes(low)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._%+@-]*$/.test(token);
}

/** Split a line into tokens, treating separators as boundaries */
function tokenize(line: string): string[] {
  return line
    .replace(/[|,،;؛\t/]+/g, " ")
    .replace(/([:：=])/g, " $1 ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !/^[:：=]$/.test(token));
}

/** Clean Chinese promotional and edition noise from game label */
export function cleanGameHint(rawHint: string): string {
  let cleaned = rawHint;
  for (const term of SUPPLIER_NOISE_TERMS) {
    const re = new RegExp(term, "gi");
    cleaned = cleaned.replace(re, " ");
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

/**
 * Parse one supplier line into credentials and game hint.
 */
export function parseAccountLine(line: string): ParsedAccountLine | null {
  const raw = line.trim();
  if (!raw || raw.startsWith("#")) return null;

  const tokens = tokenize(raw);
  if (tokens.length === 0) return null;

  let username = "";
  let password = "";
  const labelParts: string[] = [];
  let sawPasswordMarker = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    const next = tokens[i + 1];

    if (isMarker(token, PASSWORD_MARKERS)) {
      sawPasswordMarker = true;
      if (next && looksLikeCredential(next) && !password) {
        password = next;
        i += 1;
      }
      continue;
    }

    if (isMarker(token, ACCOUNT_MARKERS)) {
      if (next && looksLikeCredential(next) && !username) {
        username = next;
        i += 1;
      }
      continue;
    }

    if (isMarker(token, GAME_MARKERS)) {
      if (next && !isMarker(next, PASSWORD_MARKERS) && !isMarker(next, ACCOUNT_MARKERS)) {
        labelParts.push(next);
        i += 1;
      }
      continue;
    }

    if (looksLikeCredential(token)) {
      // Before password marker, an unlabelled credential is username; after, it's password
      if (!sawPasswordMarker && !username) {
        username = token;
      } else if (sawPasswordMarker && !password) {
        password = token;
      } else {
        labelParts.push(token);
      }
      continue;
    }

    labelParts.push(token);
  }

  // Handle plain 'login pass' or 'login:pass' without markers
  if (username && !password && !sawPasswordMarker) {
    const candidate = labelParts.find((part) => looksLikeCredential(part));
    if (candidate) {
      password = candidate;
      labelParts.splice(labelParts.indexOf(candidate), 1);
    }
  }

  if (!username || !password) return null;

  const rawLabel = labelParts.join(" ").trim();
  const label = cleanGameHint(rawLabel);

  return {
    username,
    password,
    ...(label ? { label } : {}),
    raw,
  };
}

export interface ParsedAccountPaste {
  accounts: ParsedAccountLine[];
  /** Lines that carried something but no usable pair */
  skipped: { line: number; raw: string }[];
  /** Logins that appeared more than once (kept when the supplier lines differ). */
  duplicates: string[];
}

/** Parse a whole multi-line paste — one account per line */
export function parseAccountPaste(input: string): ParsedAccountPaste {
  const accounts: ParsedAccountLine[] = [];
  const skipped: { line: number; raw: string }[] = [];
  const duplicates: string[] = [];
  const seenLogins = new Set<string>();
  const seenLines = new Set<string>();

  input.split(/\r?\n/).forEach((raw, index) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const parsed = parseAccountLine(trimmed);
    if (!parsed) {
      skipped.push({ line: index + 1, raw: trimmed });
      return;
    }
    const loginKey = parsed.username.toLowerCase();
    // Passwords are case-sensitive, so the exact-line key must preserve case.
    const lineKey = parsed.raw.trim().replace(/\s+/g, " ");
    if (seenLogins.has(loginKey)) {
      duplicates.push(parsed.username);
    }
    // A repeated username can be valid for two different products. Preserve
    // those independent supplier lines; only an exact repeated line is ignored
    // so it cannot collide with the server's source-fingerprint uniqueness.
    if (seenLines.has(lineKey)) {
      return;
    }
    seenLogins.add(loginKey);
    seenLines.add(lineKey);
    accounts.push(parsed);
  });

  return { accounts, skipped, duplicates };
}

/** Comprehensive Game Alias Dictionary for non-AI matching */
const GAME_ALIAS_CLUSTERS: string[][] = [
  // Zelda
  [
    "zelda",
    "塞尔达",
    "塞尔达传说",
    "旷野之息",
    "荒野之息",
    "王国之泪",
    "织梦岛",
    "御天之剑",
    "智慧的再现",
    "tears of the kingdom",
    "breath of the wild",
    "echoes of wisdom",
    "links awakening",
    "skyward sword",
  ],
  // Switch Sports
  [
    "switch sports",
    "nintendo switch sports",
    "运动",
    "体感",
    "switch运动",
    "运动switch",
    "体感运动",
    "ns运动",
  ],
  // Animal Crossing
  ["animal crossing", "new horizons", "动森", "动物森友会", "集合啦"],
  // Tomodachi Life. Keep this separate from Animal Crossing: suppliers use
  // unrelated Chinese names and combining both creates a confident false hit
  // whenever an order contains the two games together.
  ["朋友收集", "梦想生活", "tomodachi", "tomodachi life"],
  // Star Wars Outlaws
  ["star wars outlaws", "outlaws", "亡命之徒"],
  // Star Wars Jedi
  ["star wars jedi", "绝地", "jedi", "survivor", "fallen order"],
  // EA FC / FIFA
  [
    "fc 26",
    "fc26",
    "fc 25",
    "fc25",
    "fc 24",
    "fc24",
    "ea sports fc",
    "ea sports fc 26",
    "ea sports fc 25",
    "fifa",
    "fifa 24",
    "fifa 25",
    "fifa 26",
    "足球",
  ],
  // Mario Series
  [
    "mario",
    "super mario",
    "马里奥",
    "马力欧",
    "奥德赛",
    "odyssey",
    "惊奇",
    "wonder",
    "赛车8",
    "mario kart",
    "kart",
    "派对",
    "mario party",
    "party",
    "狂欢",
    "jamboree",
    "3d世界",
    "3d world",
    "狂怒世界",
    "bowser",
    "路易吉",
    "luigi",
    "洋馆",
    "mansion",
    "maker",
    "制造",
    "rpg",
    "碧姬",
    "peach",
  ],
  // Pokémon
  [
    "pokemon",
    "pokémon",
    "宝可梦",
    "口袋妖怪",
    "朱紫",
    "scarlet",
    "violet",
    "阿尔宙斯",
    "arceus",
    "剑盾",
    "sword",
    "shield",
    "明亮珍珠",
    "晶灿钻石",
    "皮卡丘",
    "let's go",
    "lets go",
    "za",
    "legends",
  ],
  // It Takes Two
  ["it takes two", "双人成行", "成行"],
  // Monster Hunter
  [
    "monster hunter",
    "怪猎",
    "怪物猎人",
    "崛起",
    "rise",
    "荒野",
    "wilds",
    "世界",
    "world",
    "曙光",
    "sunbreak",
    "now",
  ],
  // Hogwarts Legacy
  ["hogwarts", "hogwarts legacy", "霍格沃茨", "霍格华兹", "哈利波特", "harry potter"],
  // Resident Evil
  ["resident evil", "生化危机", "biohazard", "re4", "re2", "village"],
  // Red Dead Redemption
  ["red dead", "red dead redemption", "rdr", "rdr2", "荒野大镖客", "大镖客"],
  // Black Myth: Wukong
  ["black myth", "wukong", "黑神话", "悟空", "黑悟空"],
  // Elden Ring
  ["elden ring", "elden", "艾尔登", "法环", "黄金树", "erdtree", "shadow of the erdtree"],
  // GTA
  ["gta", "grand theft auto", "侠盗", "侠盗猎车", "gta5", "gta 5", "gta6", "gta 6"],
  // God of War
  ["god of war", "gow", "战神", "诸神黄昏", "ragnarok"],
  // Spider-Man
  ["spider-man", "spiderman", "蜘蛛侠", "miles morales", "迈尔斯"],
  // Cyberpunk
  ["cyberpunk", "cyberpunk 2077", "赛博朋克", "2077", "往日之影", "phantom liberty"],
  // Super Smash Bros
  ["smash bros", "super smash", "大乱斗", "任天堂明星大乱斗", "任天堂大乱斗"],
  // Kirby
  ["kirby", "卡比", "星之卡比", "探索发现", "forgotten land"],
  // Pikmin
  ["pikmin", "皮克敏", "皮克敏4", "pikmin 4"],
  // Splatoon
  ["splatoon", "splatoon 3", "喷射战士", "斯普拉遁", "喷射3"],
  // Xenoblade
  ["xenoblade", "异度之刃", "异度神剑", "xenoblade chronicles"],
  // Persona
  ["persona", "女神异闻录", "p5r", "p3r", "persona 5", "persona 3"],
  // Dark Souls / Sekiro
  ["dark souls", "黑暗之魂", "黑魂", "只狼", "sekiro", "bloodborne", "血源"],
  // Assassin's Creed
  ["assassin's creed", "assassins creed", "刺客信条", "shadows", "mirage", "valhalla"],
  // Call of Duty
  ["call of duty", "cod", "使命召唤", "black ops", "warzone"],
  // Final Fantasy
  ["final fantasy", "ff7", "ff16", "最终幻想", "rebirth", "remake"],
  // Diablo
  ["diablo", "暗黑", "暗黑破坏神", "diablo 4", "暗黑4"],
  // Dragon Ball
  ["dragon ball", "龙珠", "七龙珠", "sparking", "电光炸裂", "kakarot"],
  // Naruto
  ["naruto", "火影", "火影忍者", "connections", "storm"],
  // One Piece
  ["one piece", "海贼王", "航海王", "odyssey"],
  // Sonic
  ["sonic", "索尼克", "音速小子", "shadow", "frontiers"],
  // Minecraft
  ["minecraft", "我的世界"],
  // Overcooked
  ["overcooked", "胡闹厨房", "煮糊了", "分手厨房"],
  // Hollow Knight
  ["hollow knight", "空洞骑士", "silksong", "丝之歌"],
  // Astro Bot
  ["astro bot", "宇宙机器人", "astro"],
  // Silent Hill
  ["silent hill", "寂静岭", "silent hill 2"],
];

export interface OrderItemMatchTarget {
  id: string;
  title: string;
  quantity: number;
  kind?: string;
  /**
   * What was actually sold on this line, for the admin who has to read the
   * match. Two lines of the same game — one offline, one online — are
   * indistinguishable by title alone, which is exactly when a wrong mapping
   * gets confirmed.
   */
  selectionLabel?: string;
}

export interface MatchedAccountResult {
  account: ParsedAccountLine;
  matchedItemId?: string;
  matchedItemTitle?: string;
  slotNumber?: number; // 1, 2, ... for items with quantity > 1
  matchStatus: "matched" | "needs_matching";
  confidence: number;
}

/**
 * A match below this threshold is deliberately left for a human.
 *
 * Supplier text is noisy and a false positive leaks one account to the wrong
 * game.  A missed match only asks the admin to choose a chip, which is the safe
 * side of that trade-off.
 */
export const ACCOUNT_GAME_MATCH_MIN_CONFIDENCE = 0.7;

/**
 * Match a game hint against a list of order items using alias clusters and string similarity.
 */
export function matchHintToOrderItems(
  hint: string,
  orderItems: OrderItemMatchTarget[],
): { item: OrderItemMatchTarget | null; confidence: number } {
  if (!hint || orderItems.length === 0) return { item: null, confidence: 0 };

  const normalizedHint = hint.toLowerCase().trim();

  // 1. Direct contains check, with the same ambiguity guard used below.
  const directCandidates = orderItems.filter((item) => {
    const normTitle = item.title.toLowerCase();
    return normTitle.includes(normalizedHint) || normalizedHint.includes(normTitle);
  });
  if (directCandidates.length === 1) {
    return { item: directCandidates[0]!, confidence: 0.95 };
  }
  if (
    directCandidates.length > 1 &&
    new Set(directCandidates.map((item) => item.title.toLowerCase().trim())).size === 1
  ) {
    return { item: directCandidates[0]!, confidence: 0.95 };
  }

  // 2. Alias clusters check. A cluster is only confident when it identifies
  // one game title (or duplicate slots of the exact same title). Franchise
  // clusters must never pick the first of two different products.
  for (const cluster of GAME_ALIAS_CLUSTERS) {
    const hintMatchesCluster = cluster.some((alias) =>
      normalizedHint.includes(alias.toLowerCase()),
    );
    if (!hintMatchesCluster) continue;

    const candidates = orderItems.filter((item) => {
      const normTitle = item.title.toLowerCase();
      return cluster.some((alias) => normTitle.includes(alias.toLowerCase()));
    });
    if (candidates.length === 1) return { item: candidates[0]!, confidence: 0.9 };
    if (
      candidates.length > 1 &&
      new Set(candidates.map((item) => item.title.toLowerCase().trim())).size === 1
    ) {
      return { item: candidates[0]!, confidence: 0.9 };
    }
  }

  // 3. Token-based word overlap
  let bestItem: OrderItemMatchTarget | null = null;
  let bestScore = 0;
  let bestTitles = new Set<string>();

  const hintTokens = normalizedHint
    .replace(/[^\w\u4e00-\u9fa5]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  for (const item of orderItems) {
    const titleTokens = item.title
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2);

    let matches = 0;
    for (const ht of hintTokens) {
      if (titleTokens.some((tt) => tt.includes(ht) || ht.includes(tt))) {
        matches += 1;
      }
    }

    const score = matches / Math.max(hintTokens.length, 1);
    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
      bestTitles = new Set([item.title.toLowerCase().trim()]);
    } else if (score > 0 && score === bestScore) {
      bestTitles.add(item.title.toLowerCase().trim());
    }
  }

  if (bestScore >= ACCOUNT_GAME_MATCH_MIN_CONFIDENCE && bestItem && bestTitles.size === 1) {
    return { item: bestItem, confidence: bestScore };
  }

  return { item: null, confidence: 0 };
}

/**
 * Match a batch of parsed accounts against all items in an order,
 * distributing copies across multiple quantities.
 */
export function matchAccountsToOrder(
  parsedAccounts: ParsedAccountLine[],
  orderItems: OrderItemMatchTarget[],
): MatchedAccountResult[] {
  // Track how many accounts assigned to each item id
  const assignedCounts: Record<string, number> = {};

  return parsedAccounts.map((account) => {
    const hint = account.label || "";
    // Remove filled targets before matching. This makes quantity a hard
    // capacity and also lets two separate order lines with the same title each
    // receive exactly one matching account.
    const availableItems = orderItems.filter(
      (item) => (assignedCounts[item.id] ?? 0) < Math.max(1, item.quantity || 1),
    );
    const { item, confidence } = matchHintToOrderItems(hint, availableItems);

    if (item && confidence >= ACCOUNT_GAME_MATCH_MIN_CONFIDENCE) {
      const currentCount = assignedCounts[item.id] || 0;
      const nextCount = currentCount + 1;
      assignedCounts[item.id] = nextCount;

      return {
        account,
        matchedItemId: item.id,
        matchedItemTitle: item.title,
        slotNumber: nextCount,
        matchStatus: "matched",
        confidence,
      };
    }

    return {
      account,
      matchStatus: "needs_matching",
      confidence: 0,
    };
  });
}
