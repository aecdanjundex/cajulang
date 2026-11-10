  // =====================================================================
  // 1. Lexer
  // =====================================================================
  const KEYWORDS = new Set(["let", "const", "if", "else", "while", "for", "to", "and", "or", "not", "true", "false", "import", "from", "export",
    "fn", "return", "extern", "dllexport", "struct", "interface", "nil", "switch", "case", "default", "break", "continue", "fallthrough",
    "defer", "go", "select", "chan", "map", "range"]);
  // A source position ("loc") packs file and line into a single number:
  // file × LOC_BASE + line. The main file is 0, so there loc is just the line.
  const LOC_BASE = 100_000;
  const locFile = (loc) => Math.floor(loc / LOC_BASE);
  const locLine = (loc) => loc % LOC_BASE;
  const OPS3 = ["...", "<<=", ">>=", "&^="];
  const OPS2 = ["==", "!=", "<=", ">=", "->", ":=", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>", "&^", "<-", "**", "&&", "||"];
  const OPS1 = "+-*/%^()=,<>{}:.[]&|!";
  const ESCAPES = { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"', "'": "'", "0": "\0" };

  function lex(src, fileIndex = 0) {
    const toks = [];
    let i = 0, line = fileIndex * LOC_BASE + 1, col = 1;
    const adv = () => { const c = src[i++]; if (c === "\n") { line++; col = 1; } else col++; return c; };
    // \n \t \" \\ é \U0001F600 \x41
    const escape = (l, k) => {
      adv();
      const e = src[i];
      if (e in ESCAPES) { adv(); return ESCAPES[e]; }
      const hex = { x: 2, u: 4, U: 8 }[e];
      if (hex) {
        adv();
        const h = src.substr(i, hex);
        if (!new RegExp(`^[0-9a-fA-F]{${hex}}$`).test(h)) throw new CajuError("lexical", `Escape \\${e} needs ${hex} hex digits`, l, k);
        for (let q = 0; q < hex; q++) adv();
        return String.fromCodePoint(parseInt(h, 16));
      }
      throw new CajuError("lexical", `Unknown escape "\\${e}"`, l, k);
    };
    while (i < src.length) {
      const c = src[i];
      if (c === "#" || (c === "/" && src[i + 1] === "/")) { while (i < src.length && src[i] !== "\n") adv(); continue; }
      if (c === "\n" || c === ";") {
        const l = line, k = col; adv();
        const last = toks[toks.length - 1];
        if (c === ";" || (last && last.type !== "NEWLINE")) toks.push({ type: "NEWLINE", value: c === ";" ? ";" : "↵", line: l, col: k });
        continue;
      }
      if (/\s/.test(c)) { adv(); continue; }
      const l = line, k = col;
      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
        let s = "";
        if (c === "0" && /[xXbBoO]/.test(src[i + 1] || "")) {
          s = adv() + adv();
          while (i < src.length && /[0-9a-fA-F_]/.test(src[i])) s += adv();
          const clean = s.replace(/_/g, "");
          const base = { x: 16, b: 2, o: 8 }[clean[1].toLowerCase()];
          const digits = clean.slice(2);
          if (!digits || [...digits].some((d) => isNaN(parseInt(d, base)))) throw new CajuError("lexical", `Invalid number "${s}"`, l, k);
          toks.push({ type: "NUMBER", value: BigInt({ 16: "0x", 2: "0b", 8: "0o" }[base] + digits).toString(), line: l, col: k });
          continue;
        }
        while (i < src.length && /[0-9._]/.test(src[i])) {
          if (src[i] === "." && src[i + 1] === ".") break;       // a[1..] does not exist, but "..." does
          s += adv();
        }
        if (/[eE]/.test(src[i] || "") && /[0-9+-]/.test(src[i + 1] || "")) {
          s += adv();
          if (/[+-]/.test(src[i])) s += adv();
          while (i < src.length && /[0-9_]/.test(src[i])) s += adv();
        }
        const clean = s.replace(/_/g, "");
        if ((clean.match(/\./g) || []).length > 1 || !isFinite(Number(clean))) throw new CajuError("lexical", `Invalid number "${s}"`, l, k);
        toks.push({ type: "NUMBER", value: clean, line: l, col: k });
        continue;
      }
      if (/[A-Za-z_À-ÿ]/.test(c)) {
        let s = "";
        while (i < src.length && /[A-Za-z0-9_À-ÿ]/.test(src[i])) s += adv();
        toks.push({ type: KEYWORDS.has(s) ? "KEYWORD" : "NAME", value: s, line: l, col: k });
        continue;
      }
      if (c === '"') {
        adv(); let s = "";
        while (i < src.length && src[i] !== '"') {
          if (src[i] === "\n") throw new CajuError("lexical", "String is missing its closing quote", l, k);
          if (src[i] === "\\") { s += escape(l, k); continue; }
          s += adv();
        }
        if (i >= src.length) throw new CajuError("lexical", "String is missing its closing quote", l, k);
        adv();
        toks.push({ type: "STRING", value: s, line: l, col: k });
        continue;
      }
      if (c === "`") {   // raw string, as in Go: no escapes and may span several lines
        adv(); let s = "";
        while (i < src.length && src[i] !== "`") s += adv();
        if (i >= src.length) throw new CajuError("lexical", "Raw string is missing its closing backtick", l, k);
        adv();
        toks.push({ type: "STRING", value: s.replace(/\r/g, ""), line: l, col: k });
        continue;
      }
      if (c === "'") {   // rune: 'a', '\n', 'é'
        adv();
        let ch;
        if (src[i] === "\\") ch = escape(l, k);
        else { const cp = src.codePointAt(i); ch = String.fromCodePoint(cp); adv(); if (cp > 0xffff) adv(); }
        if (src[i] !== "'") throw new CajuError("lexical", "A rune is a single character in single quotes, like 'a'", l, k);
        adv();
        toks.push({ type: "RUNE", value: ch.codePointAt(0), line: l, col: k });
        continue;
      }
      const three = src.substr(i, 3), two = src.substr(i, 2);
      if (OPS3.includes(three)) { adv(); adv(); adv(); toks.push({ type: "OP", value: three, line: l, col: k }); continue; }
      if (OPS2.includes(two)) { adv(); adv(); toks.push({ type: "OP", value: two, line: l, col: k }); continue; }
      if (OPS1.includes(c)) { adv(); toks.push({ type: "OP", value: c, line: l, col: k }); continue; }
      throw new CajuError("lexical", `Unexpected character "${c}"`, l, k);
    }
    toks.push({ type: "EOF", value: "∎", line, col });
    return toks;
  }

