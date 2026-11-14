// Who's ahead in a match with several riders: private 2v2 / free-for-all and
// the CRANSKI CUP (DESIGN.md, Modes). One place for the rules so every rider's
// game works out the same standings from the same run scores.
//
// riders: [{ uid, tag, team }]: team 0 or 1 for 2v2 (ignored for free-for-all)
// scores: uid -> [run totals in round order] (a round is one run each, or one map)
// teams: '2v2' or 'ffa'
// scoring:
//   'best'   each rider's best run; a team scores its riders' bests added up
//   'total'  every run added up (a team adds up all its riders' runs)
//   'rounds' each round, the side with the most points wins it (a tie is
//            a round for each tied side); most rounds wins, ties broken on
//            total points

const sum = (a) => a.reduce((x, y) => x + (Number(y) || 0), 0);

export function standings({ riders, scores, teams = 'ffa', scoring = 'best', rounds = null }) {
  const runs = (u) => (scores && scores[u]) || [];
  const best = (u) => Math.max(0, ...runs(u).map((v) => Number(v) || 0));
  const sides =
    teams === '2v2'
      ? [0, 1].map((t) => ({ key: `team${t}`, team: t, members: riders.filter((r) => r.team === t) }))
      : riders.map((r) => ({ key: r.uid, team: null, members: [r] }));
  for (const s of sides) {
    s.total = sum(s.members.map((m) => sum(runs(m.uid))));
    s.points = scoring === 'best' ? sum(s.members.map((m) => best(m.uid))) : s.total;
    s.rounds = 0;
  }
  const n = rounds ?? Math.max(0, ...riders.map((r) => runs(r.uid).length));
  if (scoring === 'rounds') {
    for (let i = 0; i < n; i++) {
      // A round counts once everyone has their run in.
      if (!sides.every((s) => s.members.every((m) => runs(m.uid).length > i))) continue;
      const v = sides.map((s) => sum(s.members.map((m) => runs(m.uid)[i])));
      const top = Math.max(...v);
      sides.forEach((s, j) => {
        if (v[j] === top) s.rounds++;
      });
    }
  }
  const keyOf = (s) => (scoring === 'rounds' ? [s.rounds, s.total] : [s.points]);
  const cmp = (a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return 0;
  };
  const ordered = [...sides].sort(cmp);
  ordered.forEach((s, i) => (s.place = i > 0 && cmp(ordered[i - 1], s) === 0 ? ordered[i - 1].place : i + 1));
  const winner = ordered.length > 1 && cmp(ordered[0], ordered[1]) === 0 ? null : ordered[0] || null;
  return { sides: ordered, winner, scoring, teams };
}

// "12,345" or "2 rounds", for one side.
export function sideScore(side, scoring) {
  return scoring === 'rounds' ? `${side.rounds} ${side.rounds === 1 ? 'round' : 'rounds'}` : side.points.toLocaleString('en-US');
}
