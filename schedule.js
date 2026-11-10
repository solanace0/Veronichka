// Реальні дані графіків з YASNO (відкритий API). Без вигаданих даних.
const DSO = { kr: 303, dp: 301, kz: 301 }; // 303 = ЦЕК (Кривий Ріг), 301 = ДТЕК ДніпроЕМ (Дніпро, Кам’янське)

module.exports = async (req, res) => {
  const city = String(req.query.city || '');
  const queue = String(req.query.queue || '');
  const dso = DSO[city];
  if (!dso || !/^[1-6]\.[12]$/.test(queue)) {
    res.status(400).json({ ok: false, error: 'Невірні параметри' });
    return;
  }
  try {
    const url = `https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/3/dsos/${dso}/planned-outages`;
    const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('YASNO відповів ' + r.status);
    const j = await r.json();
    const g = j[queue];
    if (!g) throw new Error('Черги ' + queue + ' немає у відповіді YASNO');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    res.status(200).json({
      ok: true,
      city, queue,
      today: g.today || null,
      tomorrow: g.tomorrow || null,
      updatedOn: g.updatedOn || j.updatedOn || null,
      fetchedAt: new Date().toISOString(),
      source: 'YASNO'
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
};
