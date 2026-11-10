  // =====================================================================
  // Campos reservados no recurso VERSIONINFO do runtime: "{{CAJU:CAMPO}}###…",
  // em UTF-16. Cada um é trocado pelo valor escolhido e completado com zeros.
  const VERSION_FIELDS = { COMPANY: 96, DESCRIPTION: 128, FILEVERSION: 32, INTERNAL: 64, COPYRIGHT: 128,
    ORIGINAL: 64, PRODUCT: 96, PRODUCTVERSION: 32, COMMENTS: 160 };
  function parseVersion(v) {
    const parts = String(v || "").trim().split(".");
    if (!parts.length || parts.length > 4 || parts.some((p) => !/^\d{1,5}$/.test(p) || +p > 65535)) return null;
    while (parts.length < 4) parts.push("0");
    return parts.map(Number);
  }
  function patchVersionInfo(exe, info) {
    const out = exe.slice();
    const utf16 = (s) => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { b[i * 2] = s.charCodeAt(i) & 255; b[i * 2 + 1] = s.charCodeAt(i) >> 8; } return b; };
    const find = (needle) => {
      outer: for (let i = 0; i + needle.length <= out.length; i++) {
        for (let k = 0; k < needle.length; k++) if (out[i + k] !== needle[k]) continue outer;
        return i;
      }
      return -1;
    };
    for (const [tag, size] of Object.entries(VERSION_FIELDS)) {
      const at = find(utf16(`{{CAJU:${tag}}}`));
      if (at < 0) throw new Error(`O runtime não tem o campo de versão ${tag}`);
      const value = String(info[tag] ?? "").slice(0, size - 1);
      out.fill(0, at, at + size * 2);
      out.set(utf16(value), at);
    }
    // a versão em binário (VS_FIXEDFILEINFO), que o Windows usa para comparar versões
    const v = parseVersion(info.FILEVERSION) || [1, 0, 0, 0];
    const sig = find(Uint8Array.of(0xBD, 0x04, 0xEF, 0xFE));
    if (sig >= 0) {
      const dv = new DataView(out.buffer, out.byteOffset);
      dv.setUint32(sig + 8, (v[0] << 16) | v[1], true); dv.setUint32(sig + 12, (v[2] << 16) | v[3], true);
      dv.setUint32(sig + 16, (v[0] << 16) | v[1], true); dv.setUint32(sig + 20, (v[2] << 16) | v[3], true);
    }
    return out;
  }
  // posições no cabeçalho PE de 32 bits: checksum e entrada 4 (Security) do diretório de dados
  function peLayout(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (b[0] !== 0x4D || b[1] !== 0x5A) throw new Error("O runtime não é um executável do Windows");
    const pe = dv.getUint32(0x3C, true), opt = pe + 24;
    const magic = dv.getUint16(opt, true);
    const dirs = opt + (magic === 0x20B ? 112 : 96);
    return { dv, checksum: opt + 64, certDir: dirs + 4 * 8 };
  }
  // o mesmo algoritmo do CheckSumMappedFile do Windows
  function setPeChecksum(b) {
    const { dv, checksum } = peLayout(b);
    dv.setUint32(checksum, 0, true);
    let sum = 0;
    const words = Math.floor(b.length / 2);
    for (let i = 0; i < words; i++) {
      sum += dv.getUint16(i * 2, true);
      sum = (sum & 0xFFFF) + Math.floor(sum / 65536);
    }
    if (b.length & 1) { sum += b[b.length - 1]; sum = (sum & 0xFFFF) + Math.floor(sum / 65536); }
    sum = (sum & 0xFFFF) + Math.floor(sum / 65536);
    dv.setUint32(checksum, (sum + b.length) >>> 0, true);
    return b;
  }

  // ---- DER (ASN.1), o formato binário dos certificados e assinaturas ----
  const DER = {
    cat(...parts) { const n = parts.reduce((s, p) => s + p.length, 0), o = new Uint8Array(n); let at = 0; for (const p of parts) { o.set(p, at); at += p.length; } return o; },
    tlv(tag, ...parts) {
      const c = DER.cat(...parts), n = c.length;
      const len = n < 128 ? [n] : n < 256 ? [0x81, n] : n < 65536 ? [0x82, n >> 8, n & 255] : [0x83, n >> 16, (n >> 8) & 255, n & 255];
      return DER.cat(Uint8Array.of(tag, ...len), c);
    },
    seq: (...p) => DER.tlv(0x30, ...p),
    set: (...p) => DER.tlv(0x31, ...p),
    // SET OF em DER precisa dos elementos em ordem crescente de bytes
    setOf: (items) => DER.tlv(0x31, ...[...items].sort((a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; })),
    ctx: (n, ...p) => DER.tlv(0xA0 + n, ...p),
    int(bytes) { let b = typeof bytes === "number" ? Uint8Array.of(bytes) : bytes; if (b[0] & 0x80) b = DER.cat(Uint8Array.of(0), b); return DER.tlv(0x02, b); },
    oid(s) {
      const a = s.split(".").map(Number), out = [40 * a[0] + a[1]];
      for (const v of a.slice(2)) { const t = [v & 127]; let x = Math.floor(v / 128); while (x) { t.unshift((x & 127) | 128); x = Math.floor(x / 128); } out.push(...t); }
      return DER.tlv(0x06, Uint8Array.from(out));
    },
    nul: () => Uint8Array.of(0x05, 0x00),
    octet: (b) => DER.tlv(0x04, b),
    bits: (b) => DER.tlv(0x03, Uint8Array.of(0), b),
    utf8: (s) => DER.tlv(0x0C, new TextEncoder().encode(s)),
    bmp(s, tag = 0x1E) { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { b[i * 2] = s.charCodeAt(i) >> 8; b[i * 2 + 1] = s.charCodeAt(i) & 255; } return DER.tlv(tag, b); },
    time(d) {
      const p = (n) => String(n).padStart(2, "0");
      const y = d.getUTCFullYear(), body = `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
      return y < 2050 ? DER.tlv(0x17, new TextEncoder().encode(String(y).slice(2) + body)) : DER.tlv(0x18, new TextEncoder().encode(y + body));
    },
    // leitura: devolve { tag, start, hdr, len, end } de um elemento
    read(b, at) {
      const tag = b[at];
      let len = b[at + 1], hdr = 2;
      if (len & 0x80) { const n = len & 127; len = 0; for (let i = 0; i < n; i++) len = len * 256 + b[at + 2 + i]; hdr = 2 + n; }
      return { tag, start: at, hdr, len, end: at + hdr + len };
    },
    children(b, el) { const out = []; for (let at = el.start + el.hdr; at < el.end;) { const c = DER.read(b, at); out.push(c); at = c.end; } return out; },
  };
  const OIDS = {
    sha256: "2.16.840.1.101.3.4.2.1", rsa: "1.2.840.113549.1.1.1", sha256rsa: "1.2.840.113549.1.1.11",
    signedData: "1.2.840.113549.1.7.2", contentType: "1.2.840.113549.1.9.3", messageDigest: "1.2.840.113549.1.9.4",
    spcIndirect: "1.3.6.1.4.1.311.2.1.4", spcPeImage: "1.3.6.1.4.1.311.2.1.15", spcOpus: "1.3.6.1.4.1.311.2.1.12",
    spcStatement: "1.3.6.1.4.1.311.2.1.11", spcIndividual: "1.3.6.1.4.1.311.2.1.21", codeSigning: "1.3.6.1.5.5.7.3.3",
    cn: "2.5.4.3", org: "2.5.4.10", country: "2.5.4.6",
  };
  const algId = (oid) => DER.seq(DER.oid(oid), DER.nul());
  const sha = async (algo, data) => new Uint8Array(await crypto.subtle.digest(algo, data));
  const SIGN_ALGO = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  const b64 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

  // Certificado autoassinado de assinatura de código, gerado com a WebCrypto do navegador
  async function makeSelfSignedCert(publisher) {
    const keys = await crypto.subtle.generateKey({ ...SIGN_ALGO, modulusLength: 3072, publicExponent: Uint8Array.of(1, 0, 1) }, true, ["sign", "verify"]);
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey));
    const serial = crypto.getRandomValues(new Uint8Array(16));
    serial[0] = (serial[0] & 0x7F) | 0x40;
    const name = DER.seq(DER.set(DER.seq(DER.oid(OIDS.cn), DER.utf8(publisher))), DER.set(DER.seq(DER.oid(OIDS.org), DER.utf8(publisher))));
    const now = new Date(), from = new Date(now.getTime() - 86400000), until = new Date(now.getTime() + 5 * 365.25 * 86400000);
    const keyId = (await sha("SHA-1", spki)).slice(0, 20);
    const ext = (oid, critical, value) => DER.seq(DER.oid(oid), ...(critical ? [Uint8Array.of(0x01, 0x01, 0xFF)] : []), DER.octet(value));
    const extensions = DER.ctx(3, DER.seq(
      ext("2.5.29.19", false, DER.seq()),                                   // não é autoridade certificadora
      ext("2.5.29.15", true, Uint8Array.of(0x03, 0x02, 0x07, 0x80)),        // uso: assinatura digital
      ext("2.5.29.37", false, DER.seq(DER.oid(OIDS.codeSigning))),          // finalidade: assinatura de código
      ext("2.5.29.14", false, DER.octet(keyId)),
      ext("2.5.29.35", false, DER.seq(DER.tlv(0x80, keyId))),
    ));
    const tbs = DER.seq(DER.ctx(0, DER.int(2)), DER.int(serial), algId(OIDS.sha256rsa), name, DER.seq(DER.time(from), DER.time(until)), name, spki, extensions);
    const sig = new Uint8Array(await crypto.subtle.sign(SIGN_ALGO, keys.privateKey, tbs));
    const cert = DER.seq(tbs, algId(OIDS.sha256rsa), DER.bits(sig));
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
    return { publisher, cert, pkcs8, until: until.toISOString() };
  }
  // emissor e número de série do certificado, como aparecem dentro do certificado
  function certIssuerSerial(cert) {
    const tbs = DER.children(cert, DER.read(cert, 0))[0];
    const f = DER.children(cert, tbs);
    const i = f[0].tag === 0xA0 ? 1 : 0;
    return { serial: cert.slice(f[i].start, f[i].end), issuer: cert.slice(f[i + 2].start, f[i + 2].end) };
  }
  // Hash Authenticode: o arquivo todo, menos o checksum, a entrada Security e a própria assinatura
  async function authenticodeHash(b) {
    const { checksum, certDir } = peLayout(b);
    return sha("SHA-256", DER.cat(b.subarray(0, checksum), b.subarray(checksum + 4, certDir), b.subarray(certDir + 8)));
  }
  async function signExe(exe, signer, programName) {
    const key = await crypto.subtle.importKey("pkcs8", signer.pkcs8, SIGN_ALGO, false, ["sign"]);
    // a tabela de certificados começa num múltiplo de 8 bytes
    const pad = (8 - (exe.length % 8)) % 8;
    const body = DER.cat(exe, new Uint8Array(pad));
    const { dv, certDir } = peLayout(body);
    if (dv.getUint32(certDir, true) !== 0) throw new Error("Este executável já está assinado");
    const digest = await authenticodeHash(body);
    // SpcIndirectDataContent: "isto é uma imagem PE e este é o hash dela"
    const obsolete = DER.bmp("<<<Obsolete>>>", 0x80);
    const peImage = DER.seq(Uint8Array.of(0x03, 0x01, 0x00), DER.ctx(0, DER.ctx(2, obsolete)));
    const indirect = DER.seq(DER.seq(DER.oid(OIDS.spcPeImage), peImage), DER.seq(algId(OIDS.sha256), DER.octet(digest)));
    const indirectBody = indirect.subarray(DER.read(indirect, 0).hdr);   // o hash assinado não inclui a etiqueta nem o tamanho
    const attr = (oid, value) => DER.seq(DER.oid(oid), DER.set(value));
    const attrs = [
      attr(OIDS.contentType, DER.oid(OIDS.spcIndirect)),
      attr(OIDS.spcOpus, DER.seq(DER.ctx(0, DER.bmp(programName, 0x80)))),
      attr(OIDS.spcStatement, DER.seq(DER.oid(OIDS.spcIndividual))),
      attr(OIDS.messageDigest, DER.octet(await sha("SHA-256", indirectBody))),
    ];
    const signedAttrs = DER.setOf(attrs);                                   // assinado como SET…
    const signature = new Uint8Array(await crypto.subtle.sign(SIGN_ALGO, key, signedAttrs));
    const implicitAttrs = DER.cat(Uint8Array.of(0xA0), signedAttrs.subarray(1)); // …e guardado como [0]
    const { issuer, serial } = certIssuerSerial(signer.cert);
    const signerInfo = DER.seq(DER.int(1), DER.seq(issuer, serial), algId(OIDS.sha256), implicitAttrs, algId(OIDS.rsa), DER.octet(signature));
    const signedData = DER.seq(DER.int(1), DER.set(algId(OIDS.sha256)), DER.seq(DER.oid(OIDS.spcIndirect), DER.ctx(0, indirect)),
      DER.ctx(0, signer.cert), DER.set(signerInfo));
    const pkcs7 = DER.seq(DER.oid(OIDS.signedData), DER.ctx(0, signedData));
    // WIN_CERTIFICATE: tamanho, revisão 2.0, tipo PKCS#7, assinatura, zeros até múltiplo de 8
    const total = 8 + pkcs7.length + ((8 - (pkcs7.length % 8)) % 8);
    const winCert = new Uint8Array(total);
    const wv = new DataView(winCert.buffer);
    wv.setUint32(0, total, true); wv.setUint16(4, 0x0200, true); wv.setUint16(6, 0x0002, true);
    winCert.set(pkcs7, 8);
    const signed = DER.cat(body, winCert);
    const lay = peLayout(signed);
    lay.dv.setUint32(lay.certDir, body.length, true);
    lay.dv.setUint32(lay.certDir + 4, total, true);
    return setPeChecksum(signed);
  }
  // certificado em PEM, para quem quiser instalar como confiável
  const certPem = (cert) => `-----BEGIN CERTIFICATE-----\n${b64(cert).replace(/.{64}/g, "$&\n").replace(/\n?$/, "\n")}-----END CERTIFICATE-----\n`;

  // =====================================================================

const fs = require("fs");
(async () => {
  const runtime = new Uint8Array(fs.readFileSync(process.argv[2] || "./caju-runtime-x86.exe"));
  const src = 'fn fatorial(n) {\n  if n <= 1 { return 1 }\n  return n * fatorial(n - 1)\n}\nprint("Olá do .exe assinado!", fatorial(12))';
  const prog = optimizeProgram(link([{ name: "main.caju", src }]));
  let exe = buildExe(runtime, serializeProgram(prog, {}));
  exe = patchVersionInfo(exe, { COMPANY: "Pizzaria Caju Ltda.", DESCRIPTION: "Calculadora de fatoriais", FILEVERSION: "2.5.1.7", INTERNAL: "fatorial",
    COPYRIGHT: "© 2026 Pizzaria Caju", ORIGINAL: "fatorial.exe", PRODUCT: "Fatorial Caju", PRODUCTVERSION: "2.5.1.7", COMMENTS: "Gerado pela linguagem Caju" });
  setPeChecksum(exe);
  fs.writeFileSync(CAJU_TMP + "/unsigned.exe", exe);
  const t0 = Date.now();
  const signer = await makeSelfSignedCert("Pizzaria Caju Ltda.");
  console.log("certificado gerado em", Date.now() - t0, "ms; válido até", signer.until.slice(0, 10));
  const signed = await signExe(exe, signer, "Calculadora de fatoriais");
  fs.writeFileSync(CAJU_TMP + "/signed.exe", signed);
  fs.writeFileSync(CAJU_TMP + "/editor.cer", signer.cert);
  fs.writeFileSync(CAJU_TMP + "/editor.pem", certPem(signer.cert));
  console.log("sem assinatura:", exe.length, "bytes; assinado:", signed.length, "bytes");
})();
