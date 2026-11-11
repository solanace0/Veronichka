// ТребаСвітло? — віджет для iPhone (програма Scriptable).
// Показує графік на СЬОГОДНІ для вибраної черги: статус зараз, час наступної зміни, смужку доби та відключення дня.
// Налаштування підставляються автоматично, коли скрипт копіюється зі застосунку (Налаштування → Віджет на iPhone).
// Інша черга без редагування: у налаштуваннях віджета в полі Parameter напиши, наприклад: kr 3.1  (kr — Кривий Ріг, dp — Дніпро, kz — Кам’янське)

const CFG = { origin: "__ORIGIN__", city: "__CITY__", group: "__GROUP__", name: "__NAME__" };
const CITY_NAMES = { kr: "Кривий Ріг", dp: "Дніпро", kz: "Кам’янське" };
const TZ = "Europe/Kyiv";

let city = CFG.city, group = CFG.group;
const prm = (args.widgetParameter || "").trim().split(/\s+/);
if (prm.length === 2 && CITY_NAMES[prm[0]] && /^[1-6]\.[12]$/.test(prm[1])) { city = prm[0]; group = prm[1]; }
const cityName = CITY_NAMES[city] || CFG.name;

// ---------- час за Києвом ----------
function kyivNow() {
  const p = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date()).forEach(x => (p[x.type] = x.value));
  const h = +p.hour % 24;
  return { date: `${p.year}-${p.month}-${p.day}`, min: h * 60 + +p.minute, sec: h * 3600 + +p.minute * 60 + +p.second };
}
const p2 = n => String(n).padStart(2, "0");
const hm = m => `${p2(Math.floor(m / 60) % 24)}:${p2(m % 60)}`;
const hmE = m => (m >= 1440 ? "24:00" : hm(m));
const dh = m => { const h = Math.floor(m / 60), mm = m % 60; return h ? (mm ? `${h} год ${mm} хв` : `${h} год`) : `${mm} хв`; };
function periods(slots) {
  const o = [];
  slots.forEach((v, i) => {
    const on = !!v, a = i * 30;
    if (o.length && o[o.length - 1].on === on) o[o.length - 1].to = a + 30;
    else o.push({ from: a, to: a + 30, on });
  });
  return o;
}

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

const COL = {
  bg1: new Color("#14111F"), bg2: new Color("#08070C"),
  tx: new Color("#F5F3FA"), mu: new Color("#A9A6B8"),
  on: new Color("#3FD79A"), off: new Color("#FF6B7D"), warn: new Color("#F5C542"),
  barOn: new Color("#2FA676"), barOff: new Color("#FF5D6C"), yellow: new Color("#FFD23F")
};

function bar(slots, nowMin, w, h) {
  const ctx = new DrawContext();
  ctx.size = new Size(w, h + 6); ctx.opaque = false; ctx.respectScreenScale = true;
  const sw = w / 48;
  slots.forEach((v, i) => {
    ctx.setFillColor(v ? COL.barOn : COL.barOff);
    ctx.fillRect(new Rect(i * sw, 4, sw + 0.6, h));
  });
  ctx.setFillColor(Color.white());
  ctx.fillRect(new Rect(Math.min(w - 2, (nowMin / 1440) * w - 1), 0, 2.4, h + 6));
  return ctx.getImage();
}

function text(stack, s, size, color, weight) {
  const t = stack.addText(s);
  t.textColor = color; t.font = weight ? Font.heavySystemFont(size) : Font.systemFont(size);
  t.minimumScaleFactor = 0.7; t.lineLimit = 1;
  return t;
}

async function build() {
  const { j, stale } = await load();
  const w = new ListWidget();
  const g = new LinearGradient(); g.colors = [COL.bg1, COL.bg2]; g.locations = [0, 0.7];
  w.backgroundGradient = g;
  w.setPadding(14, 14, 12, 14);
  w.url = CFG.origin;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  const fam = config.widgetFamily || "medium";
  const small = fam === "small";
  const k = kyivNow();

  const head = w.addStack(); head.centerAlignContent();
  text(head, `💡 ${group} · ${cityName}`, small ? 11 : 12, COL.mu, false);

  const day = j && j.days && j.days[k.date];
  const slots = day && day.slots && day.slots.length === 48 ? day.slots : null;
  const noInfo = !slots || slots.every(v => v === 1) && !day.confirmed;

  if (!j || noInfo) {
    w.addSpacer(6);
    const emg = j && j.emergency;
    text(w, emg ? "Екстрені відключення" : j ? "Графік уточнюється" : "Немає даних", small ? 16 : 20, emg ? COL.off : COL.warn, true);
    w.addSpacer(4);
    text(w, emg ? "Планові графіки зараз не діють" : "Відкрий застосунок або сайт ДТЕК", 11, COL.mu, false);
    return w;
  }

  const pr = periods(slots), cur = pr.find(p => k.min >= p.from && k.min < p.to) || pr[0];
  const on = cur.on, minsLeft = cur.to - k.min;
  const offs = pr.filter(p => !p.on);

  w.addSpacer(small ? 4 : 5);
  text(w, on ? "Світло є" : "Світла немає", small ? 22 : 26, on ? COL.on : COL.off, true);
  const nextTxt = cur.to >= 1440
    ? (on ? "Сьогодні більше відключень немає" : "Світло буде після 24:00")
    : `${on ? "Вимкнення" : "Ввімкнення"} о ${hm(cur.to)} · через ${dh(minsLeft)}`;
  text(w, nextTxt, small ? 10.5 : 12, COL.mu, false);

  w.addSpacer(small ? 6 : 8);
  w.addImage(bar(slots, k.min, small ? 140 : 300, 8)).imageSize = new Size(small ? 140 : 300, 14);

  const maxRows = fam === "large" ? 9 : small ? 2 : 3;
  w.addSpacer(6);
  if (!offs.length) {
    text(w, "Сьогодні без відключень", 12, COL.on, false);
  } else {
    const shown = offs.slice(0, maxRows);
    shown.forEach(p => {
      const row = w.addStack(); row.centerAlignContent(); row.spacing = 6;
      const past = p.to <= k.min, now = k.min >= p.from && k.min < p.to;
      const dot = row.addText("●"); dot.font = Font.systemFont(7); dot.textColor = past ? COL.mu : COL.off;
      const t = text(row, `${hm(p.from)}–${hmE(p.to)}`, small ? 11.5 : 13, past ? COL.mu : COL.tx, true);
      if (!small) { row.addSpacer(); text(row, dh(p.to - p.from), 11, now ? COL.off : COL.mu, false); }
    });
    if (offs.length > shown.length) text(w, `+ ще ${offs.length - shown.length}`, 10.5, COL.mu, false);
  }
  if (fam === "large") {
    w.addSpacer();
    const on_m = slots.filter(Boolean).length * 30;
    text(w, `Зі світлом: ${dh(on_m)} · без світла: ${dh(1440 - on_m)}`, 11, COL.mu, false);
  }
  if (stale) { w.addSpacer(2); text(w, "офлайн: показано збережене", 9.5, COL.warn, false); }
  else if (j.updated) { w.addSpacer(); text(w, `оновлено ${j.updated}`, 9.5, COL.mu, false); }
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
else await widget.presentMedium();
Script.complete();
