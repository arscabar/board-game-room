import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = join(process.cwd(), "public", "board-assets", "game-covers");
mkdirSync(outDir, { recursive: true });

const palette = {
  walnut0: "#100906",
  walnut1: "#24140c",
  walnut2: "#4e2f1c",
  walnut3: "#795031",
  felt0: "#073125",
  felt1: "#0b5a42",
  cream: "#f5ead1",
  brass: "#d4a761",
  ink: "#21140d",
  line: "#ead0a0"
};

function cover(id, accent, body, options = {}) {
  const felt = options.felt ?? palette.felt1;
  const feltDark = options.feltDark ?? palette.felt0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" role="img" aria-labelledby="${id}-title ${id}-desc">
  <title id="${id}-title">${id} tabletop cover</title>
  <desc id="${id}-desc">A custom tabletop representative image focused on the physical board-game components.</desc>
  <defs>
    <linearGradient id="table" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.walnut2}"/>
      <stop offset=".38" stop-color="${palette.walnut1}"/>
      <stop offset="1" stop-color="${palette.walnut0}"/>
    </linearGradient>
    <linearGradient id="rail" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${palette.walnut3}"/>
      <stop offset=".5" stop-color="${palette.walnut2}"/>
      <stop offset="1" stop-color="${palette.walnut1}"/>
    </linearGradient>
    <linearGradient id="felt" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${felt}"/>
      <stop offset="1" stop-color="${feltDark}"/>
    </linearGradient>
    <radialGradient id="spot" cx="50%" cy="42%" r="70%">
      <stop offset="0" stop-color="${accent}" stop-opacity=".32"/>
      <stop offset=".64" stop-color="${accent}" stop-opacity=".08"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000" flood-opacity=".42"/>
    </filter>
    <filter id="chipShadow" x="-35%" y="-35%" width="170%" height="170%">
      <feDropShadow dx="0" dy="7" stdDeviation="7" flood-color="#000" flood-opacity=".32"/>
    </filter>
    <pattern id="woodgrain" width="90" height="46" patternUnits="userSpaceOnUse">
      <path d="M0 9c22-10 47 10 90 0M0 25c30 12 59-12 90 0M0 41c24-8 52 9 90 0" fill="none" stroke="#ffe2aa" stroke-opacity=".055" stroke-width="2"/>
    </pattern>
    <pattern id="feltthread" width="38" height="38" patternUnits="userSpaceOnUse" patternTransform="rotate(25)">
      <path d="M0 0h38" stroke="#fff" stroke-opacity=".045" stroke-width="2"/>
    </pattern>
  </defs>
  <rect width="960" height="540" rx="34" fill="url(#table)"/>
  <rect width="960" height="540" rx="34" fill="url(#woodgrain)"/>
  <rect x="42" y="34" width="876" height="472" rx="38" fill="url(#rail)" filter="url(#shadow)"/>
  <rect x="70" y="62" width="820" height="416" rx="28" fill="url(#felt)"/>
  <rect x="70" y="62" width="820" height="416" rx="28" fill="url(#feltthread)"/>
  <rect x="70" y="62" width="820" height="416" rx="28" fill="url(#spot)"/>
  <rect x="91" y="83" width="778" height="374" rx="20" fill="none" stroke="${palette.line}" stroke-opacity=".28" stroke-width="2"/>
  ${body}
</svg>
`;
}

function rect(x, y, w, h, fill, extra = "") {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${fill}" ${extra}/>`;
}

function circle(cx, cy, r, fill, extra = "") {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${extra}/>`;
}

function die(x, y, value, size = 86, rotation = 0) {
  const pips = {
    1: [[0.5, 0.5]],
    2: [[0.28, 0.28], [0.72, 0.72]],
    3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
    4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
    5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
    6: [[0.28, 0.24], [0.72, 0.24], [0.28, 0.5], [0.72, 0.5], [0.28, 0.76], [0.72, 0.76]]
  }[value];
  const pipSvg = pips.map(([px, py]) => circle(px * size, py * size, size * 0.075, "#54241f")).join("");
  return `<g transform="translate(${x} ${y}) rotate(${rotation} ${size / 2} ${size / 2})" filter="url(#chipShadow)">
    <rect width="${size}" height="${size}" rx="${size * 0.18}" fill="#f7edd8"/>
    <rect x="${size * 0.07}" y="${size * 0.07}" width="${size * 0.86}" height="${size * 0.86}" rx="${size * 0.13}" fill="none" stroke="#ceb990" stroke-width="2"/>
    ${pipSvg}
  </g>`;
}

function tile(x, y, w, h, fill, text = "", color = palette.ink, rotation = 0) {
  return `<g transform="translate(${x} ${y}) rotate(${rotation} ${w / 2} ${h / 2})" filter="url(#chipShadow)">
    <rect width="${w}" height="${h}" rx="14" fill="${fill}" stroke="#e3c17c" stroke-opacity=".45" stroke-width="2"/>
    ${text ? `<text x="${w / 2}" y="${h * 0.62}" text-anchor="middle" font-family="Georgia,serif" font-size="${Math.min(w, h) * 0.46}" font-weight="800" fill="${color}">${text}</text>` : ""}
  </g>`;
}

function guryongtu() {
  const bottom = Array.from({ length: 9 }, (_, index) => {
    const x = 205 + index * 62;
    const active = index === 0 || index === 8;
    return tile(x, 356, 48, 70, active ? "#d7a54d" : "#efe2bf", String(index + 1), active ? "#24150a" : "#342015", active ? -4 + index : 0);
  }).join("");
  return cover("guryongtu", "#d7a54d", `
    <path d="M210 142h540l-56 154H266z" fill="#151316" stroke="${palette.brass}" stroke-opacity=".65" stroke-width="4" filter="url(#chipShadow)"/>
    <path d="M266 296h428" stroke="#f0c56e" stroke-opacity=".5" stroke-width="4"/>
    ${tile(323, 137, 116, 156, "#f2dfb8", "9", "#18130f", -7)}
    ${tile(522, 137, 116, 156, "#f2dfb8", "1", "#18130f", 8)}
    <path d="M461 202h44m-22-22l22 22-22 22" fill="none" stroke="#d7a54d" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
    ${bottom}
  `);
}

function quoridor() {
  const cells = [];
  for (let r = 0; r < 9; r += 1) {
    for (let c = 0; c < 9; c += 1) {
      const x = 286 + c * 45;
      const y = 90 + r * 38;
      cells.push(`<rect x="${x}" y="${y}" width="37" height="31" rx="4" fill="${(r + c) % 2 ? "#d3a463" : "#b9854b"}" stroke="#553119" stroke-width="2"/>`);
    }
  }
  return cover("quoridor", "#c5843a", `
    <g filter="url(#chipShadow)">${cells.join("")}</g>
    <g fill="#3b2314" filter="url(#chipShadow)">
      <rect x="452" y="112" width="16" height="144" rx="5"/>
      <rect x="558" y="221" width="154" height="16" rx="5"/>
      <rect x="315" y="288" width="16" height="128" rx="5"/>
      <rect x="591" y="88" width="16" height="108" rx="5"/>
    </g>
    <g filter="url(#chipShadow)">
      ${circle(482, 406, 27, "#f2eadb")}
      ${circle(482, 371, 18, "#f2eadb")}
      ${circle(482, 145, 27, "#152033")}
      ${circle(482, 110, 18, "#152033")}
    </g>
    <path d="M260 437h440" stroke="#f1d18e" stroke-opacity=".28" stroke-width="10" stroke-linecap="round"/>
  `);
}

function abalone() {
  const holes = [];
  for (let r = 0; r < 9; r += 1) {
    const count = r < 5 ? 5 + r : 13 - r;
    const x0 = 480 - (count - 1) * 28;
    const y = 112 + r * 38;
    for (let c = 0; c < count; c += 1) {
      holes.push(circle(x0 + c * 56, y, 25, "#8a643e", 'stroke="#e1bd7f" stroke-opacity=".26" stroke-width="2"'));
    }
  }
  const marbles = [];
  for (let r = 0; r < 9; r += 1) {
    const count = r < 5 ? 5 + r : 13 - r;
    const x0 = 480 - (count - 1) * 28;
    const y = 112 + r * 38;
    for (let c = 0; c < count; c += 1) {
      if (r <= 2 || (r === 3 && c >= 2 && c <= 6)) marbles.push(circle(x0 + c * 56, y, 20, "#161412", 'filter="url(#chipShadow)"'));
      if (r >= 6 || (r === 5 && c >= 2 && c <= 6)) marbles.push(circle(x0 + c * 56, y, 20, "#f2eee1", 'filter="url(#chipShadow)"'));
    }
  }
  return cover("abalone-classic", "#a2aab5", `
    <path d="M480 72l270 151v94L480 468 210 317v-94z" fill="#6c4a2c" stroke="#e2bf82" stroke-opacity=".48" stroke-width="4" filter="url(#chipShadow)"/>
    <g>${holes.join("")}</g>
    <g>${marbles.join("")}</g>
  `);
}

function ghosts() {
  const cells = [];
  for (let r = 0; r < 6; r += 1) {
    for (let c = 0; c < 6; c += 1) {
      cells.push(`<rect x="${309 + c * 57}" y="${99 + r * 50}" width="48" height="42" rx="7" fill="${(r + c) % 2 ? "#253d6c" : "#1c2f55"}" stroke="#d9e5ff" stroke-opacity=".13"/>`);
    }
  }
  const ghosts = [
    [333, 121, "#edf2ff"], [447, 121, "#edf2ff"], [561, 121, "#edf2ff"],
    [390, 322, "#7662ef"], [504, 322, "#7662ef"], [618, 322, "#7662ef"]
  ];
  const ghostSvg = ghosts.map(([x, y, fill]) => `<path d="M${x} ${y + 52}v-46c0-23 17-39 39-39s39 16 39 39v46l-12-8-13 8-13-8-13 8-13-8z" fill="${fill}" filter="url(#chipShadow)"/>`).join("");
  return cover("ghosts", "#7662ef", `
    <g filter="url(#chipShadow)">${cells.join("")}</g>
    ${ghostSvg}
    <path d="M242 100h74v74m402-74h74v74m0 194v74h-74m-402 0h-74v-74" fill="none" stroke="#eff3ff" stroke-width="11" stroke-linecap="round" opacity=".6"/>
  `, { felt: "#1f335a", feltDark: "#101b34" });
}

function qawale() {
  const pits = [];
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      pits.push(`<g filter="url(#chipShadow)">
        <rect x="${330 + c * 99}" y="${114 + r * 77}" width="72" height="56" rx="16" fill="#8b6844" stroke="#e4c487" stroke-opacity=".3"/>
        <ellipse cx="${366 + c * 99}" cy="${142 + r * 77}" rx="24" ry="15" fill="#5d4028" opacity=".45"/>
      </g>`);
    }
  }
  const stones = [[366, 117, "#e8ddc0"], [663, 117, "#e8ddc0"], [366, 348, "#e8ddc0"], [663, 348, "#e8ddc0"], [465, 270, "#315c8c"], [564, 270, "#d8a748"], [564, 193, "#315c8c"], [465, 347, "#d8a748"]];
  const stoneSvg = stones.map(([x, y, fill], i) => `<g filter="url(#chipShadow)">${circle(x, y + 12, 27, fill)}${circle(x, y - 4, 27, fill)}${i < 4 ? circle(x, y - 20, 27, fill) : ""}</g>`).join("");
  return cover("qawale", "#315c8c", `
    <rect x="290" y="82" width="390" height="366" rx="28" fill="#6a482d" stroke="#e8c27e" stroke-opacity=".35" filter="url(#chipShadow)"/>
    ${pits.join("")}
    ${stoneSvg}
    <path d="M465 270h99m0-77v77m-99 77v-77" stroke="#f0cf7e" stroke-width="10" stroke-linecap="round" opacity=".75"/>
  `);
}

function davinci() {
  const tiles = [
    [246, 164, 68, 146, "#111", "?", "#f7ead0", -10],
    [326, 138, 68, 146, "#f2e7ce", "2", "#18120d", -4],
    [406, 160, 68, 146, "#111", "5", "#f7ead0", 3],
    [486, 132, 68, 146, "#f2e7ce", "?", "#18120d", 8],
    [566, 166, 68, 146, "#111", "8", "#f7ead0", -5],
    [646, 140, 68, 146, "#f2e7ce", "★", "#b4363f", 6]
  ];
  const rack = `<rect x="210" y="324" width="540" height="58" rx="16" fill="#392315" stroke="#d7ad68" stroke-opacity=".55" filter="url(#chipShadow)"/>`;
  return cover("davinci-code-plus", "#d33f49", `
    ${rack}
    ${tiles.map((args) => tile(...args)).join("")}
    <rect x="304" y="392" width="352" height="24" rx="12" fill="#d33f49" opacity=".42"/>
    <g filter="url(#chipShadow)">
      <rect x="376" y="86" width="208" height="44" rx="13" fill="#1c1110" stroke="#e7bf78" stroke-opacity=".35"/>
      ${circle(426, 108, 11, "#f4e8cc")}
      ${circle(480, 108, 11, "#d33f49")}
      ${circle(534, 108, 11, "#090807")}
    </g>
  `);
}

function blokus() {
  const grid = [];
  for (let r = 0; r < 20; r += 1) {
    for (let c = 0; c < 20; c += 1) {
      grid.push(`<rect x="${260 + c * 22}" y="${67 + r * 19}" width="20" height="17" rx="2" fill="${(r + c) % 2 ? "#eee5cf" : "#ddd0b7"}"/>`);
    }
  }
  const blockUnit = 22;
  const shape = (x, y, color, cells) => `<g filter="url(#chipShadow)">${cells.map(([cx, cy]) => `<rect x="${x + cx * blockUnit}" y="${y + cy * blockUnit}" width="${blockUnit}" height="${blockUnit}" rx="3" fill="${color}" stroke="#fff" stroke-opacity=".3" stroke-width="2"/>`).join("")}</g>`;
  return cover("blokus", "#2364aa", `
    <rect x="240" y="48" width="480" height="420" rx="18" fill="#b8a98d" filter="url(#chipShadow)"/>
    <g>${grid.join("")}</g>
    ${shape(282, 104, "#2468c9", [[0,0],[1,0],[1,1],[1,2],[2,2]])}
    ${shape(536, 124, "#d84545", [[0,0],[0,1],[0,2],[1,2],[2,2]])}
    ${shape(414, 268, "#edbd36", [[0,0],[1,0],[2,0],[1,1],[1,2]])}
    ${shape(594, 312, "#249b57", [[0,0],[1,0],[2,0],[2,1],[3,1]])}
    ${shape(326, 354, "#7d4fd8", [[0,0],[0,1],[1,1],[2,1]])}
  `, { felt: "#184232", feltDark: "#0d241d" });
}

function yachtDice() {
  return cover("yacht-dice", "#2f8f83", `
    <path d="M204 118c82-33 158-18 225 9 75 31 143 22 221-3 45-14 86 8 103 53 20 55 7 151-33 192-48 49-146 32-221 21-76-10-136 25-207 16-66-8-103-51-103-119 0-74 6-129 15-169z" fill="#0a4030" stroke="#e0be79" stroke-opacity=".5" stroke-width="5" filter="url(#chipShadow)"/>
    ${die(282, 159, 5, 94, -14)}
    ${die(413, 111, 2, 94, 12)}
    ${die(544, 178, 6, 94, -8)}
    ${die(371, 301, 4, 94, 8)}
    ${die(565, 307, 1, 94, -13)}
    <rect x="220" y="424" width="520" height="23" rx="12" fill="#d7b36d" opacity=".35"/>
  `);
}

function yinsh() {
  const nodes = [];
  for (let r = 0; r < 9; r += 1) {
    const count = r < 5 ? 5 + r : 13 - r;
    const x0 = 480 - (count - 1) * 31;
    const y = 116 + r * 35;
    for (let c = 0; c < count; c += 1) nodes.push(circle(x0 + c * 62, y, 5, "#d9c5a0", 'opacity=".82"'));
  }
  const rings = [[360, 186, "#f0eadb"], [482, 256, "#151515"], [602, 291, "#f0eadb"], [420, 326, "#151515"], [540, 151, "#f0eadb"]];
  return cover("yinsh", "#56a8c4", `
    <g stroke="#d9c5a0" stroke-opacity=".18" stroke-width="2">
      <path d="M260 256h440M320 116l320 280M640 116L320 396"/>
      <path d="M306 186h348M322 326h316"/>
    </g>
    ${nodes.join("")}
    ${rings.map(([x, y, color]) => `<g filter="url(#chipShadow)"><circle cx="${x}" cy="${y}" r="35" fill="none" stroke="${color}" stroke-width="13"/><circle cx="${x + 44}" cy="${y + 18}" r="17" fill="${color === "#151515" ? "#f0eadb" : "#151515"}"/></g>`).join("")}
  `, { felt: "#133b48", feltDark: "#0b222c" });
}

function hangman() {
  const blanks = Array.from({ length: 7 }, (_, i) => `<rect x="${293 + i * 54}" y="178" width="38" height="27" rx="6" fill="${i < 4 ? "#21160f" : "#cbbd98"}" opacity="${i < 4 ? "1" : ".85"}"/>`).join("");
  const keys = ["A", "E", "R", "T", "S", "O"].map((letter, i) => `<g filter="url(#chipShadow)">
    <rect x="${302 + i * 59}" y="282" width="47" height="47" rx="9" fill="#f1e4c6"/>
    <text x="${325 + i * 59}" y="314" text-anchor="middle" font-family="Georgia,serif" font-size="26" font-weight="800" fill="#24150e">${letter}</text>
  </g>`).join("");
  return cover("hangman-board-game", "#b74e59", `
    <rect x="232" y="112" width="496" height="288" rx="28" fill="#2d1b12" stroke="#ddb672" stroke-opacity=".52" filter="url(#chipShadow)"/>
    <rect x="270" y="152" width="420" height="78" rx="15" fill="#eadfbd" filter="url(#chipShadow)"/>
    ${blanks}
    ${keys}
    <rect x="548" y="256" width="122" height="28" rx="14" fill="#b74e59"/>
    <rect x="548" y="302" width="148" height="20" rx="10" fill="#6b3338"/>
    <path d="M238 421h484" stroke="#e5bf75" stroke-opacity=".24" stroke-width="12" stroke-linecap="round"/>
  `);
}

const covers = {
  "guryongtu.svg": guryongtu(),
  "quoridor.svg": quoridor(),
  "abalone-classic.svg": abalone(),
  "ghosts.svg": ghosts(),
  "qawale.svg": qawale(),
  "davinci-code-plus.svg": davinci(),
  "blokus.svg": blokus(),
  "yacht-dice.svg": yachtDice(),
  "yinsh.svg": yinsh(),
  "hangman-board-game.svg": hangman()
};

for (const [file, content] of Object.entries(covers)) {
  writeFileSync(join(outDir, file), content, "utf8");
}

console.log(`Generated ${Object.keys(covers).length} game cover assets in ${outDir}`);
