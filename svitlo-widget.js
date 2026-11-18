// ТребаСвітло? — віджет для iPhone (програма Scriptable).
// Показує графік на СЬОГОДНІ для вибраної черги: статус зараз, час наступної зміни, смужку доби та відключення дня.
// Працює на головному екрані (малий, середній, великий) і на екрані блокування.
// Налаштування підставляються автоматично, коли скрипт копіюється зі застосунку (Налаштування → Віджет на iPhone).
// Інша черга без редагування: у налаштуваннях віджета в полі Parameter напиши, наприклад: kr 3.1  (kr — Кривий Ріг, dp — Дніпро, kz — Кам’янське)

const CFG = { origin: "__ORIGIN__", city: "__CITY__", group: "__GROUP__", name: "__NAME__" };
const CITY_NAMES = { kr: "Кривий Ріг", dp: "Дніпро", kz: "Кам’янське" };
const TZ = "Europe/Kyiv";

let city = CFG.city, group = CFG.group;
const prm = (args.widgetParameter || "").trim().split(/\s+/);
if (prm.length === 2 && CITY_NAMES[prm[0]] && /^[1-6]\.[12]$/.test(prm[1])) { city = prm[0]; group = prm[1]; }
const cityName = CITY_NAMES[city] || CFG.name;

// ---------- палітра застосунку: чорний, перлинний, м’які фіолетовий / бірюзовий / рожевий відблиски ----------
const C = {
  base: "#07070A",
  pearl: new Color("#F4F1EA"), pearl2: new Color("#C9C5BD"),
  tx: new Color("#F4F1EA"), soft: new Color("#D6D2DC"), mu: new Color("#9C98A8"),
  segOn: new Color("#EFEBE4"), segOff: new Color("#2A2930"), tick: new Color("#5A5763"),
  chip: new Color("#FFFFFF", 0.09), chipOn: new Color("#FFFFFF", 0.16)
};

// ---------- час за Києвом ----------
function kyivNow() {
  const p = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date()).forEach(x => (p[x.type] = x.value));
  const h = +p.hour % 24;
  return { date: `${p.year}-${p.month}-${p.day}`, min: h * 60 + +p.minute, sec: h * 3600 + +p.minute * 60 + +p.second };
}
const addDay = (d, n) => { const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const p2 = n => String(n).padStart(2, "0");
const hm = m => `${p2(Math.floor(m / 60) % 24)}:${p2(m % 60)}`;
const hmE = m => (m >= 1440 ? "24:00" : hm(m));
const dh = m => { const h = Math.floor(m / 60), mm = m % 60; return h ? (mm ? `${h} год ${mm} хв` : `${h} год`) : `${mm} хв`; };
function periods(slots, base = 0) {
  const o = [];
  slots.forEach((v, i) => {
    const on = !!v, a = base + i * 30;
    if (o.length && o[o.length - 1].on === on) o[o.length - 1].to = a + 30;
    else o.push({ from: a, to: a + 30, on });
  });
  return o;
}
const okDay = (d) => d && d.slots && d.slots.length === 48 && !(d.slots.every(v => v === 1) && !d.confirmed);

// ---------- дані (з кешем на випадок, коли немає мережі) ----------
async function load() {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.documentsDirectory(), `svitlo-${city}-${group}.json`);
  try {
    const req = new Request(`${CFG.origin}/api/schedule?group=${group}&city=${city}&t=${Date.now()}`);
    req.timeoutInterval = 12;
    const j = await req.loadJSON();
    if (!j || !j.ok) throw new Error("no data");
    fm.writeString(path, JSON.stringify({ j, at: Date.now() }));
    return { j, stale: false };
  } catch (e) {
    if (fm.fileExists(path)) { const c = JSON.parse(fm.readString(path)); return { j: c.j, stale: true }; }
    return { j: null, stale: true };
  }
}

// ---------- фон: чорний із м’якими відблисками (як живий фон у застосунку) ----------
function glow(ctx, x, y, r, hex, a) {
  const N = 26;
  for (let i = 0; i < N; i++) {
    const k = i / N, rr = r * (1 - k);
    ctx.setFillColor(new Color(hex, (a / N) * (0.55 + k)));
    ctx.fillEllipse(new Rect(x - rr, y - rr, rr * 2, rr * 2));
  }
}
function backdrop(w, h) {
  const ctx = new DrawContext();
  ctx.size = new Size(w, h); ctx.opaque = true; ctx.respectScreenScale = false;
  ctx.setFillColor(new Color(C.base)); ctx.fillRect(new Rect(0, 0, w, h));
  const m = Math.max(w, h);
  glow(ctx, w * 0.08, h * -0.05, m * 0.62, "#6F63D8", 0.42);
  glow(ctx, w * 1.0, h * 0.45, m * 0.5, "#2F9DB0", 0.30);
  glow(ctx, w * 0.55, h * 1.12, m * 0.55, "#B8628F", 0.30);
  return ctx.getImage();
}

// ---------- смужка доби ----------
function bar(slots, nowMin, w, h, ticks) {
  const th = ticks ? 14 : 0, pad = 5;
  const ctx = new DrawContext();
  ctx.size = new Size(w, h + pad * 2 + th); ctx.opaque = false; ctx.respectScreenScale = true;
  const px = w / 1440, r = Math.min(4, h / 2);
  // основа (немає світла)
  let path = new Path(); path.addRoundedRect(new Rect(0, pad, w, h), r, r); ctx.addPath(path); ctx.setFillColor(C.segOff); ctx.fillPath();
  // світло є
  periods(slots).filter(p => p.on).forEach(p => {
    const x = p.from * px, ww = (p.to - p.from) * px - 1.2;
    path = new Path(); path.addRoundedRect(new Rect(x + 0.6, pad, Math.max(2, ww), h), r, r); ctx.addPath(path); ctx.setFillColor(C.segOn); ctx.fillPath();
  });
  // «зараз»
  const nx = Math.min(w - 2, Math.max(2, nowMin * px));
  ctx.setFillColor(new Color("#000000", 0.75)); ctx.fillRect(new Rect(nx - 2.6, 1, 5.2, h + pad * 2 - 2));
  ctx.setFillColor(Color.white()); ctx.fillRect(new Rect(nx - 1.3, 2, 2.6, h + pad * 2 - 4));
  if (ticks) {
    ctx.setTextColor(C.mu); ctx.setFont(Font.mediumSystemFont(9.5)); ctx.setTextAlignedCenter();
    [0, 6, 12, 18, 24].forEach(t => {
      const tx = t * 60 * px, bw = 26, x0 = t === 0 ? 0 : t === 24 ? w - bw : tx - bw / 2;
      ctx.setTextAlignedCenter();
      ctx.drawTextInRect(String(t), new Rect(x0, h + pad * 2 + 1, bw, 12));
    });
  }
  return ctx.getImage();
}

function text(stack, s, size, color, weight) {
  const t = stack.addText(s);
  t.textColor = color; t.font = weight === "r" ? Font.boldRoundedSystemFont(size) : weight ? Font.heavySystemFont(size) : Font.mediumSystemFont(size);
  t.minimumScaleFactor = 0.6; t.lineLimit = 1;
  return t;
}

// наступна зміна з урахуванням завтрашнього графіка
function nextChange(j, k) {
  const today = j.days[k.date], tom = j.days[addDay(k.date, 1)];
  let tl = periods(today.slots);
  if (okDay(tom)) {
    const t2 = periods(tom.slots, 1440);
    if (tl[tl.length - 1].on === t2[0].on) { tl[tl.length - 1].to = t2[0].to; t2.shift(); }
    tl = tl.concat(t2);
  }
  const cur = tl.find(p => k.min >= p.from && k.min < p.to) || tl[0];
  const known = cur.to < 1440 || (okDay(tom) && cur.to < 2880);
  const after = tl.find(p => p.from === cur.to);
  return { cur, known, left: cur.to - k.min, after };
}

async function build() {
  const { j, stale } = await load();
  const fam = config.widgetFamily || "medium";
  const w = new ListWidget();
  w.url = CFG.origin;
  w.refreshAfterDate = new Date(Date.now() + 10 * 60 * 1000);
  const k = kyivNow();
  const day = j && j.days && j.days[k.date];
  const known = okDay(day);

  // ---- екран блокування ----
  if (fam.startsWith("accessory")) {
    w.setPadding(0, 0, 0, 0);
    if (!known) { text(w, j && j.emergency ? "Екстрені відключення" : "Графік уточнюється", 12, Color.white(), true); return w; }
    const n = nextChange(j, k), on = n.cur.on;
    const nt = n.known ? `${on ? "Вимкнення" : "Ввімкнення"} о ${hm(n.cur.to % 1440)}` : "Змін поки немає";
    if (fam === "accessoryInline") { text(w, `${on ? "💡" : "🌙"} ${nt}`, 12, Color.white(), true); return w; }
    if (fam === "accessoryCircular") { w.addSpacer(); text(w, on ? "💡" : "🌙", 16, Color.white(), true); text(w, n.known ? hm(n.cur.to % 1440) : "—", 11, Color.white(), true); w.addSpacer(); return w; }
    text(w, `${on ? "💡 Світло є" : "🌙 Світла немає"}`, 15, Color.white(), "r");
    text(w, nt, 12, Color.white(), false);
    if (n.known) text(w, `через ${dh(n.left)}`, 11, Color.lightGray(), false);
    return w;
  }

  const small = fam === "small", large = fam === "large";
  const dim = small ? [320, 320] : large ? [640, 680] : [640, 300];
  w.backgroundImage = backdrop(dim[0], dim[1]);
  w.setPadding(small ? 14 : 16, small ? 14 : 18, small ? 12 : 14, small ? 14 : 18);

  const head = w.addStack(); head.centerAlignContent();
  text(head, "ТребаСвітло?", small ? 11 : 12, C.pearl2, true);
  head.addSpacer();
  text(head, `${small ? "" : cityName + " · "}черга ${group}`, small ? 11 : 12, C.mu, false);

  if (!j || !known) {
    w.addSpacer();
    const emg = j && j.emergency;
    text(w, emg ? "🚨 Екстрені відключення" : j ? "Графік уточнюється" : "Немає даних", small ? 17 : 22, C.tx, "r");
    w.addSpacer(4);
    text(w, emg ? "Планові графіки зараз не діють" : "Відкрий застосунок або сайт ДТЕК", small ? 11 : 13, C.soft, false);
    w.addSpacer();
    return w;
  }

  const slots = day.slots, n = nextChange(j, k), on = n.cur.on;
  const offs = periods(slots).filter(p => !p.on);

  w.addSpacer(small ? 6 : 8);
  text(w, on ? "💡 Світло є" : "🌙 Світла немає", small ? 23 : large ? 32 : 30, C.tx, "r");
  w.addSpacer(2);
  if (n.known) {
    text(w, `${on ? "Вимкнення" : "Ввімкнення"} о ${hm(n.cur.to % 1440)}`, small ? 14 : 16, C.tx, true);
    const sub = `через ${dh(n.left)}` + (!small && n.after ? ` · потім ${on ? "без світла" : "світло"} ${dh(Math.min(n.after.to, 2880) - n.after.from)}` : "");
    text(w, sub, small ? 12 : 13.5, C.soft, false);
  } else {
    text(w, on ? "Більше відключень немає" : "Світло буде після 24:00", small ? 13 : 15, C.soft, false);
  }

  w.addSpacer(small ? 8 : 10);
  const bw = small ? 140 : large ? 296 : 296;
  const img = w.addImage(bar(slots, k.min, bw, small ? 9 : 11, !small));
  img.imageSize = new Size(bw, (small ? 9 : 11) + 10 + (small ? 0 : 14)); img.resizable = true;

  if (!small) {
    const maxRows = large ? 6 : 2;
    w.addSpacer(large ? 8 : 4);
    if (!offs.length) {
      text(w, "Сьогодні без відключень 🎉", 13, C.soft, false);
    } else {
      const shown = offs.slice(0, maxRows);
      const row = large ? null : w.addStack();
      shown.forEach(p => {
        const past = p.to <= k.min, nowOff = k.min >= p.from && k.min < p.to;
        const host = large ? w.addStack() : row;
        if (!large) host.spacing = 6; else { host.centerAlignContent(); host.setPadding(5, 10, 5, 10); host.cornerRadius = 10; host.backgroundColor = nowOff ? C.chipOn : C.chip; }
        const t = text(host, `${hm(p.from)}–${hmE(p.to)}`, 13.5, past ? C.mu : C.tx, true);
        if (large) { host.addSpacer(); text(host, dh(p.to - p.from), 12, nowOff ? C.tx : C.mu, false); w.addSpacer(4); }
        else { const t2 = text(host, dh(p.to - p.from), 11.5, C.mu, false); host.addSpacer(4); }
      });
      if (offs.length > shown.length) text(w, `+ ще ${offs.length - shown.length}`, 11, C.mu, false);
    }
    if (large) {
      w.addSpacer();
      const onM = slots.filter(Boolean).length * 30;
      text(w, `Зі світлом ${dh(onM)} · без світла ${dh(1440 - onM)}`, 12, C.soft, false);
    }
  }
  w.addSpacer(small ? 4 : 6);
  if (stale) text(w, "офлайн: показано збережене", 10, C.mu, false);
  else if (j.updated) text(w, `оновлено ${j.updated}`, 10, C.mu, false);
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
