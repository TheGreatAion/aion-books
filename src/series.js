// Series names come from each book's publisher, so the same series turns up
// spelled several ways: "The Expanse" and "Expanse", "Red Rising Trilogy" and
// "Red Rising Trilogy #2", "Mr." and "Mr". Books are grouped by a tidied form
// of the name instead, and each group is shown under its fullest spelling.
// (Used by the library window; also loaded by the unit tests.)
(function (root) {
  const ARTICLE = /^(the|a|an)\s+/;
  const KIND = /\s+(series|trilogy|duology|quartet|saga|cycle|sequence|novels|books)$/;
  // A book number written into the name: "#2", "Book 2", "Vol. 2", "(Book 2)", ", Book Two" is left alone.
  const NUMBER_IN_NAME = /\s*[,(\[]?\s*(?:#|no\.?\s*|book\s+|vol\.?\s*|volume\s+|part\s+)(\d+(?:\.\d+)?)\s*[)\]]?\s*$/i;

  // "Red Rising Trilogy #2" → { name: "Red Rising Trilogy", number: 2 }
  function split(raw) {
    const name = String(raw || '').trim();
    const m = NUMBER_IN_NAME.exec(name);
    if (m && m.index > 0) return { name: name.slice(0, m.index).trim(), number: Number(m[1]) };
    return { name, number: null };
  }

  // The form two spellings of one series have in common.
  function key(raw) {
    let k = split(raw)
      .name.normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    k = k.replace(ARTICLE, '');
    for (let i = 0; i < 2 && KIND.test(k) && k.replace(KIND, '').length >= 3; i++) k = k.replace(KIND, '');
    return k;
  }

  // Surnames, to tell apart different authors' series that share a name.
  function surnames(author) {
    return String(author || '')
      .split(/\s*(?:,|&|;|\band\b)\s*/i)
      .map((n) => n.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s-]/g, ' ').trim().split(/\s+/).pop())
      .filter((s) => s && s.length > 1);
  }

  // Adds to every book in a series:
  //   seriesId    which group it belongs to (stable while the books don't change)
  //   seriesName  the group's name, as shown
  //   seriesNo    its number in the series (from the name if the name has one)
  function group(books) {
    const byKey = new Map();
    for (const b of books) {
      delete b.seriesId;
      delete b.seriesName;
      delete b.seriesNo;
      if (!b.series || !String(b.series).trim()) continue;
      const k = key(b.series);
      if (!k) continue;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(b);
    }
    for (const [k, list] of byKey) {
      // Books with exactly the same series name always belong together, whoever
      // wrote them. Different spellings join only when their authors share a
      // surname (or there's no author to go on), so two unrelated series that
      // happen to tidy to the same name stay apart.
      const spellings = new Map();
      for (const b of list) {
        const exact = split(b.series).name.toLowerCase();
        if (!spellings.has(exact)) spellings.set(exact, { books: [], names: new Set() });
        const s = spellings.get(exact);
        s.books.push(b);
        surnames(b.author).forEach((n) => s.names.add(n));
      }
      const clusters = [];
      for (const s of spellings.values()) {
        const hit = clusters.filter((c) => !s.names.size || !c.names.size || [...s.names].some((n) => c.names.has(n)));
        let target = hit[0];
        if (!target) clusters.push((target = { books: [], names: new Set() }));
        for (const extra of hit.slice(1)) {
          target.books.push(...extra.books);
          extra.names.forEach((n) => target.names.add(n));
          clusters.splice(clusters.indexOf(extra), 1);
        }
        target.books.push(...s.books);
        s.names.forEach((n) => target.names.add(n));
      }
      clusters.forEach((c, i) => {
        // Show the fullest spelling: one with "The" if any has it, then the most used, then the longest.
        const counts = new Map();
        for (const b of c.books) {
          const n = split(b.series).name;
          counts.set(n, (counts.get(n) || 0) + 1);
        }
        const name = [...counts].sort(
          ([a, na], [b, nb]) => Number(ARTICLE.test(b.toLowerCase())) - Number(ARTICLE.test(a.toLowerCase())) || nb - na || b.length - a.length
        )[0][0];
        for (const b of c.books) {
          const { number } = split(b.series);
          b.seriesId = i ? `${k}~${i}` : k;
          b.seriesName = name;
          b.seriesNo = number ?? (b.seriesIndex != null && b.seriesIndex !== '' ? Number(b.seriesIndex) : null);
        }
      });
    }
    return books;
  }

  const Series = { split, key, group };
  if (typeof module !== 'undefined' && module.exports) module.exports = Series;
  else root.Series = Series;
})(typeof window !== 'undefined' ? window : globalThis);
