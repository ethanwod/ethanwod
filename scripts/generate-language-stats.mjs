import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

const API_VERSION = "2022-11-28";
const COLORS = ["#fcee0a", "#00f0ff", "#ff365d", "#7d5cff", "#54e38e", "#ff9f1c", "#c7d0d3", "#547980"];

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character]);
}

async function githubJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${url}`);
  return response.json();
}

async function collectLanguages(owner, token) {
  const repos = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubJson(
      `https://api.github.com/users/${encodeURIComponent(owner)}/repos?type=owner&sort=updated&per_page=100&page=${page}`,
      token,
    );
    repos.push(...batch);
    if (batch.length < 100) break;
  }

  const eligible = repos.filter(repo => !repo.archived && !repo.disabled);
  const languageMaps = await Promise.all(eligible.map(repo => githubJson(repo.languages_url, token)));
  return { repoCount: eligible.length, languageMaps };
}

function aggregate(languageMaps) {
  const totals = new Map();
  for (const languages of languageMaps) {
    for (const [name, bytes] of Object.entries(languages)) {
      if (Number.isFinite(bytes) && bytes > 0) totals.set(name, (totals.get(name) ?? 0) + bytes);
    }
  }
  const rows = [...totals].sort((a, b) => b[1] - a[1]);
  const totalBytes = rows.reduce((sum, [, bytes]) => sum + bytes, 0);
  return rows.map(([name, bytes]) => ({ name, bytes, percentage: totalBytes ? bytes / totalBytes * 100 : 0 }));
}

function renderSvg(owner, repoCount, languages, generatedAt) {
  const top = languages.slice(0, 7);
  const remainder = languages.slice(7).reduce((sum, item) => sum + item.percentage, 0);
  if (remainder >= 0.05) top.push({ name: "Other", percentage: remainder });
  const totalBytes = languages.reduce((sum, item) => sum + item.bytes, 0);
  const signature = createHash("sha256")
    .update(JSON.stringify({ repoCount, languages: languages.map(({ name, bytes }) => [name, bytes]) }))
    .digest("hex").slice(0, 16);
  const rows = top.length ? top : [{ name: "NO CODE DATA", percentage: 100 }];

  let offset = 0;
  const segments = rows.map((item, index) => {
    const width = index === rows.length - 1 ? 1080 - offset : Math.max(2, 1080 * item.percentage / 100);
    const segment = `<rect x="${(60 + offset).toFixed(2)}" y="172" width="${width.toFixed(2)}" height="24" fill="${COLORS[index % COLORS.length]}"/>`;
    offset += width;
    return segment;
  }).join("\n    ");

  const entries = rows.map((item, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 64 + column * 558;
    const y = 244 + row * 52;
    return `<g transform="translate(${x} ${y})">
      <rect width="12" height="12" rx="2" fill="${COLORS[index % COLORS.length]}"/>
      <text x="28" y="12" class="name">${escapeXml(item.name)}</text>
      <text x="500" y="12" class="value" text-anchor="end">${item.percentage.toFixed(1)}%</text>
    </g>`;
  }).join("\n    ");

  const timestamp = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(generatedAt).replace(",", "");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="520" viewBox="0 0 1200 520" role="img" aria-labelledby="title desc" data-signature="${signature}">
  <title id="title">${escapeXml(owner)} repository language telemetry</title>
  <desc id="desc">Automatically updated language distribution across ${repoCount} public source repositories.</desc>
  <defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#1b2224"/></pattern>
    <filter id="glow"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <style>
    text { font-family: 'Segoe UI', Arial, sans-serif; }
    .display { font-family: 'Arial Black', 'Segoe UI Black', Arial, sans-serif; font-weight: 900; }
    .mono, .name, .value { font-family: Consolas, Monaco, monospace; }
    .name { fill: #dce2e4; font-size: 18px; font-weight: 700; }
    .value { fill: #00f0ff; font-size: 18px; font-weight: 700; }
  </style>
  <rect width="1200" height="520" rx="16" fill="#080a0b"/>
  <rect x="1" y="1" width="1198" height="518" rx="15" fill="none" stroke="#30383a" stroke-width="2"/>
  <rect width="1200" height="520" rx="16" fill="url(#grid)" opacity=".72"/>
  <path d="M38 36H1162V474L1118 494H38Z" fill="#0f1314" stroke="#fcee0a" stroke-width="3"/>
  <rect x="38" y="36" width="1124" height="54" fill="#fcee0a"/>
  <text x="62" y="72" fill="#080a0b" class="mono" font-size="18" font-weight="700" letter-spacing="2">03 // LANGUAGE TELEMETRY</text>
  <circle cx="1098" cy="63" r="7" fill="#00f0ff" filter="url(#glow)"/>
  <text x="1080" y="69" fill="#080a0b" class="mono" font-size="15" font-weight="700" text-anchor="end">LIVE</text>
  <text x="60" y="137" fill="#f6f7f8" class="display" font-size="30">CODEBASE COMPOSITION</text>
  <text x="1140" y="137" fill="#7d898c" class="mono" font-size="15" text-anchor="end">${repoCount} REPOS · ${(totalBytes / 1024 / 1024).toFixed(1)} MiB INDEXED</text>
  <rect x="60" y="172" width="1080" height="24" rx="3" fill="#20282a"/>
  <g clip-path="inset(0 round 3px)">${segments}</g>
  ${entries}
  <path d="M60 470H430l18 18h430l18-18h244" fill="none" stroke="#ff365d" stroke-width="3"/>
  <text x="60" y="453" fill="#687477" class="mono" font-size="13">SOURCE · GITHUB LINGUIST BYTE COUNTS</text>
  <text x="1140" y="453" fill="#687477" class="mono" font-size="13" text-anchor="end">UPDATED ${escapeXml(timestamp)} CST</text>
</svg>\n`;
}

export { aggregate, renderSvg };

async function main() {
  const owner = process.env.PROFILE_OWNER || process.env.GITHUB_REPOSITORY_OWNER || "ethanwod";
  const output = resolve(process.env.OUTPUT_PATH || "assets/language-stats.svg");
  let data;
  if (process.env.LANGUAGE_FIXTURE) {
    data = JSON.parse(await readFile(resolve(process.env.LANGUAGE_FIXTURE), "utf8"));
  } else {
    data = await collectLanguages(owner, process.env.GITHUB_TOKEN);
  }
  const svg = renderSvg(owner, data.repoCount, aggregate(data.languageMaps), new Date());
  const nextSignature = svg.match(/data-signature="([a-f0-9]+)"/)?.[1];
  try {
    const current = await readFile(output, "utf8");
    if (!process.env.FORCE_UPDATE && nextSignature && current.includes(`data-signature="${nextSignature}"`)) {
      console.log(`No language changes detected across ${data.repoCount} repositories.`);
      return;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, svg, "utf8");
  console.log(`Wrote ${output} from ${data.repoCount} repositories.`);
}

if (process.argv[1] && import.meta.url === new URL(`file:///${resolve(process.argv[1]).replaceAll("\\", "/")}`).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}

