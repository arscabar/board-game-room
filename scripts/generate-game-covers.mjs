import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = join(process.cwd(), "public", "board-assets", "game-covers");
mkdirSync(outDir, { recursive: true });

const colors = {
  table: "#1f130c",
  table2: "#321f13",
  rail: "#5b3922",
  rail2: "#25160d",
  felt: "#0c4a37",
  felt2: "#06291f",
  gold: "#d2a45d",
  line: "rgba(255,232,185,.32)",
  paper: "#f3e8ca",
  ink: "#24170f"
};

function svg(id, accent, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" role="img" aria-labelledby="${id}-title ${id}-desc">
  <title id="${id}-title">${id} board game cover</title>
  <desc id="${id}-desc">A handcrafted tabletop style representative image for the board game.</desc>
  <defs>
    <linearGradient id="table" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${colors.table2}"/>
      <stop offset=".5" stop-color="${colors.table}"/>
      <stop offset="1" stop-color="#0d0805"/>
    </linearGradient>
    <linearGradient id="rail" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${colors.rail}"/>
      <stop offset=".52" stop-color="#3d2516"/>
      <stop offset="1" stop-color="${colors.rail2}"/>
    </linearGradient>
    <linearGradient id="felt" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${colors.felt}"/>
      <stop offset="1" stop-color="${colors.felt2}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="44%" r="62%">
      <stop offset="0" stop-color="${accent}" stop-opacity=".28"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000" flood-opacity=".42"/>
    </filter>
    <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity=".3"/>
    </filter>
    <pattern id="grain" width="54" height="54" patternUnits="userSpaceOnUse">
      <path d="M0 12c18-9 34 9 54 0M0 31c18 7 33-7 54 0M0 48c20-8 34 8 54 0" fill="none" stroke="#ffe1a0" stroke-opacity=".055" stroke-width="2"/>
    </pattern>
    <pattern id="feltLines" width="42" height="42" patternUnits="userSpaceOnUse" patternTransform="rotate(22)">
      <path d="M0 0h42" stroke="#ffffff" stroke-opacity=".045" stroke-width="2"/>
    </pattern>
  </defs>
  <rect width="960" height="540" rx="36" fill="url(#table)"/>
  <rect width="960" height="540" rx="36" fill="url(#grain)"/>
  <rect x="48" y="42" width="864" height="456" rx="34" fill="url(#rail)" filter="url(#shadow)"/>
  <rect x="75" y="69" width="810" height="402" rx="26" fill="url(#felt)"/>
  <rect x="75" y="69" width="810" height="402" rx="26" fill="url(#feltLines)"/>
  <rect x="75" y="69" width="810" height="402" rx="26" fill="url(#glow)"/>
  <rect x="93" y="87" width="774" height="366" rx="20" fill="none" stroke="${colors.line}" stroke-width="2"/>
  ${body}
</svg>
`;
}

function rect(x, y, w, h, fill, extra = "") {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" ${extra}/>`;
}

function circle(cx, cy, r, fill, extra = "") {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${extra}/>`;
}

function dice(x, y, value, rotate = 0) {
  const pips = {
    1: [[.5, .5]],
    2: [[.3, .3], [.7, .7]],
    3: [[.3, .3], [.5, .5], [.7, .7]],
    4: [[.3, .3], [.7, .3], [.3, .7], [.7, .7]],
    5: [[.3, .3], [.7, .3], [.5, .5], [.3, .7], [.7, .7]],
    6: [[.3, .25], [.7, .25], [.3, .5], [.7, .5], [.3, .75], [.7, .75]]
  }[value];
  const pipSvg = pips
    .map(([px, py]) => circle((px * 74).toFixed(1), (py * 74).toFixed(1), 6, "#55251f"))
    .join("");
  return `<g transform="translate(${x} ${y}) rotate(${rotate} 37 37)" filter="url(#softShadow)">
    <rect width="74" height="74" rx="16" fill="#f8efdd"/>
    <rect x="5" y="5" width="64" height="64" rx="12" fill="none" stroke="#cdbb9d" stroke-width="2"/>
    ${pipSvg}
  </g>`;
}

function guryongtu() {
  const tiles = Array.from({ length: 9 }, (_, i) => {
    const x = 173 + i * 69;
    const fill = i === 4 ? "#d4a64e" : "#efe1bd";
    const ink = i === 4 ? "#28190d" : "#302015";
    return `<g filter="url(#softShadow)">${rect(x, 352, 52, 78, fill)}<text x="${x + 26}" y="401" text-anchor="middle" font-family="Georgia,serif" font-size="34" font-weight="700" fill="${ink}">${i + 1}</text></g>`;
  }).join("");
  return svg("guryongtu", "#d4a64e", `
    <path d="M186 154h588l-74 132H260z" fill="#111827" opacity=".72" stroke="#d6b16b" stroke-opacity=".55" stroke-width="3"/>
    <g filter="url(#softShadow)">
      <rect x="315" y="126" width="120" height="164" rx="18" fill="#eee0bf"/>
      <rect x="525" y="126" width="120" height="164" rx="18" fill="#eee0bf"/>
      <text x="375" y="228" text-anchor="middle" font-family="Georgia,serif" font-size="72" font-weight="800" fill="#111827">9</text>
      <text x="585" y="228" text-anchor="middle" font-family="Georgia,serif" font-size="72" font-weight="800" fill="#111827">1</text>
    </g>
    <path d="M465 185l28 34-28 34m30-68l28 34-28 34" fill="none" stroke="#d4a64e" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
    ${tiles}
  `);
}

function quoridor() {
  const cells = [];
  for (let r = 0; r < 9; r += 1) {
    for (let c = 0; c < 9; c += 1) {
      cells.push(`<rect x="${279 + c * 45}" y="${88 + r * 38}" width="35" height="29" rx="4" fill="${(r + c) % 2 ? "#d0a15e" : "#ba8648"}" stroke="#6b3f20" stroke-width="2"/>`);
    }
  }
  return svg("quoridor", "#c78438", `
    <g filter="url(#softShadow)">${cells.join("")}</g>
    <g fill="#372112">
      <rect x="452" y="96" width="14" height="136" rx="5"/>
      <rect x="545" y="220" width="150" height="14" rx="5"/>
      <rect x="318" y="298" width="14" height="116" rx="5"/>
      <rect x="591" y="89" width="14" height="102" rx="5"/>
    </g>
    <g filter="url(#softShadow)">
      ${circle(482, 410, 25, "#f1eadb")}
      ${circle(482, 378, 17, "#f1eadb")}
      ${circle(480, 147, 25, "#1e293b")}
      ${circle(480, 115, 17, "#1e293b")}
    </g>
  `);
}

function abalone() {
  const marbles = [];
  for (let r = 0; r < 7; r += 1) {
    const count = r < 4 ? 5 + r : 11 - r;
    const startX = 480 - (count - 1) * 31;
    const y = 137 + r * 38;
    for (let c = 0; c < count; c += 1) {
      const top = r < 3;
      const bottom = r > 3;
      const fill = top ? "#151515" : bottom ? "#f1eee4" : "#6e5a42";
      marbles.push(circle(startX + c * 62, y, 22, fill, 'filter="url(#softShadow)"'));
    }
  }
  return svg("abalone-classic", "#8c98a4", `
    <path d="M480 91l258 146v68L480 451 222 305v-68z" fill="#9a744a" stroke="#e2c08a" stroke-opacity=".42" stroke-width="3" filter="url(#softShadow)"/>
    ${marbles.join("")}
  `);
}

function ghosts() {
  const cells = [];
  for (let r = 0; r < 6; r += 1) {
    for (let c = 0; c < 6; c += 1) {
      cells.push(`<rect x="${322 + c * 53}" y="${106 + r * 47}" width="44" height="38" rx="6" fill="${(r + c) % 2 ? "#25406f" : "#1f3254"}" stroke="#93a9d8" stroke-opacity=".18"/>`);
    }
  }
  const pieces = [
    [344, 130, "#e8edff"], [450, 130, "#e8edff"], [556, 130, "#e8edff"],
    [397, 318, "#6453d8"], [503, 318, "#6453d8"], [609, 318, "#6453d8"]
  ];
  return svg("ghosts", "#7d73ef", `
    <g filter="url(#softShadow)">${cells.join("")}</g>
    ${pieces.map(([x, y, fill]) => `<path d="M${x} ${y + 38}v-38c0-20 15-34 34-34s34 14 34 34v38l-12-8-11 8-11-8-11 8-11-8z" fill="${fill}" filter="url(#softShadow)"/>`).join("")}
    <path d="M248 107h70v70m394 0v-70h70m-70 325h70v-70m-464 70h-70v-70" fill="none" stroke="#f0e8ff" stroke-width="10" stroke-linecap="round" opacity=".6"/>
  `);
}

function qawale() {
  const stacks = [];
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      const x = 360 + c * 80;
      const y = 132 + r * 69;
      stacks.push(`<rect x="${x - 30}" y="${y - 25}" width="60" height="50" rx="12" fill="#94724c" stroke="#e0c28e" stroke-opacity=".28"/>`);
    }
  }
  const stones = [[330, 107, "#e7d9bd"], [650, 107, "#e7d9bd"], [410, 270, "#234b7c"], [490, 270, "#d8a447"], [570, 270, "#234b7c"], [330, 383, "#e7d9bd"], [650, 383, "#e7d9bd"]];
  return svg("qawale", "#3c75a5", `
    <g filter="url(#softShadow)">${stacks.join("")}</g>
    ${stones.map(([x, y, fill], i) => `<g filter="url(#softShadow)">${circle(x, y + i % 2 * 5, 26, fill)}${circle(x, y - 10, 26, fill)}</g>`).join("")}
    <path d="M410 270h160" stroke="#f4d27d" stroke-width="9" stroke-linecap="round"/>
  `);
}

function davinci() {
  const tiles = [];
  const xs = [240, 315, 390, 465, 540, 615, 690];
  xs.forEach((x, i) => {
    const black = i % 2 === 0;
    tiles.push(`<g filter="url(#softShadow)">
      <rect x="${x}" y="${170 + (i % 3) * 10}" width="58" height="128" rx="10" fill="${black ? "#141414" : "#f3ead4"}" stroke="#d0ac68" stroke-opacity=".55"/>
      <text x="${x + 29}" y="${246 + (i % 3) * 10}" text-anchor="middle" font-family="Georgia,serif" font-size="42" font-weight="800" fill="${black ? "#f7ead0" : "#1a1612"}">${i === 4 ? "?" : i + 1}</text>
    </g>`);
  });
  return svg("davinci-code-plus", "#d6454f", `
    <rect x="198" y="325" width="564" height="54" rx="14" fill="#3b2416" stroke="#d6a565" stroke-opacity=".5" filter="url(#softShadow)"/>
    ${tiles.join("")}
    <g filter="url(#softShadow)">
      <rect x="386" y="86" width="188" height="48" rx="12" fill="#1b1110" stroke="#e7c27c" stroke-opacity=".38"/>
      <circle cx="430" cy="110" r="12" fill="#f1eadb"/>
      <circle cx="480" cy="110" r="12" fill="#d6454f"/>
      <circle cx="530" cy="110" r="12" fill="#111"/>
    </g>
  `);
}

function blokus() {
  const grid = [];
  for (let r = 0; r < 20; r += 1) {
    for (let c = 0; c < 20; c += 1) {
      grid.push(`<rect x="${263 + c * 22}" y="${70 + r * 19}" width="19" height="16" rx="2" fill="#e7dcc3" opacity="${(r + c) % 2 ? ".82" : ".68"}"/>`);
    }
  }
  const shapes = [
    ["#2d73d6", "M300 118h66v19h-44v19h22v19h-66v-19h22z"],
    ["#d84242", "M578 137h22v57h44v19h-66z"],
    ["#f0c33c", "M440 270h88v19h-22v38h-22v-38h-44z"],
    ["#2aa85f", "M630 308h22v19h44v19h-66zm22 38h22v19h-22z"]
  ];
  return svg("blokus", "#2d73d6", `
    <g filter="url(#softShadow)">${grid.join("")}</g>
    ${shapes.map(([fill, path]) => `<path d="${path}" fill="${fill}" stroke="#fff" stroke-opacity=".32" stroke-width="2" filter="url(#softShadow)"/>`).join("")}
  `);
}

function yachtDice() {
  return svg("yacht-dice", "#21a078", `
    <path d="M206 116c80-30 154-18 220 10 76 32 144 22 221-3 46-14 85 6 102 49 20 49 9 150-30 191-48 51-147 32-222 22-74-10-134 25-205 17-64-8-103-50-103-118 0-73 7-129 17-168z" fill="#0a3f2f" stroke="#d9b06a" stroke-opacity=".44" stroke-width="4" filter="url(#softShadow)"/>
    ${dice(285, 164, 5, -15)}
    ${dice(410, 122, 2, 12)}
    ${dice(535, 180, 6, -8)}
    ${dice(376, 285, 4, 8)}
    ${dice(555, 304, 1, -14)}
    <rect x="210" y="410" width="540" height="24" rx="12" fill="#d7b36d" opacity=".32"/>
  `);
}

function yinsh() {
  const nodes = [];
  for (let r = 0; r < 9; r += 1) {
    const count = r < 5 ? 5 + r : 13 - r;
    const x0 = 480 - (count - 1) * 31;
    const y = 116 + r * 35;
    for (let c = 0; c < count; c += 1) nodes.push(circle(x0 + c * 62, y, 5, "#d9c5a0", 'opacity=".8"'));
  }
  const rings = [[360, 186, "#f0eadb"], [482, 256, "#151515"], [602, 291, "#f0eadb"], [420, 326, "#151515"], [540, 151, "#f0eadb"]];
  return svg("yinsh", "#56a8c4", `
    <g stroke="#d9c5a0" stroke-opacity=".18" stroke-width="2">
      <path d="M260 256h440M320 116l320 280M640 116L320 396"/>
      <path d="M306 186h348M322 326h316"/>
    </g>
    ${nodes.join("")}
    ${rings.map(([x, y, color]) => `<g filter="url(#softShadow)"><circle cx="${x}" cy="${y}" r="32" fill="none" stroke="${color}" stroke-width="12"/><circle cx="${x + 44}" cy="${y + 18}" r="16" fill="${color === "#151515" ? "#f0eadb" : "#151515"}"/></g>`).join("")}
  `);
}

function hangman() {
  const letters = ["A", "E", "R", "T", "S", "O"];
  return svg("hangman-board-game", "#b74e59", `
    <rect x="238" y="122" width="484" height="260" rx="24" fill="#2c1a12" stroke="#ddb672" stroke-opacity=".48" filter="url(#softShadow)"/>
    <rect x="274" y="158" width="412" height="70" rx="12" fill="#eadfbd"/>
    ${Array.from({ length: 7 }, (_, i) => `<rect x="${295 + i * 53}" y="181" width="36" height="24" rx="5" fill="${i < 4 ? "#1e1a16" : "#c9ba96"}" opacity="${i < 4 ? "1" : ".8"}"/>`).join("")}
    <g filter="url(#softShadow)">${letters.map((letter, i) => `<g><rect x="${304 + i * 58}" y="282" width="45" height="45" rx="8" fill="#f0e4c8"/><text x="${326 + i * 58}" y="313" text-anchor="middle" font-family="Georgia,serif" font-size="25" font-weight="800" fill="#27170f">${letter}</text></g>`).join("")}</g>
    <rect x="566" y="265" width="84" height="26" rx="13" fill="#b74e59"/>
    <rect x="566" y="304" width="130" height="20" rx="10" fill="#6d3437"/>
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
