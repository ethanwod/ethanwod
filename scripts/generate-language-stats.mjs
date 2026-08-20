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

function renderSvg(template, owner, repoCount, languages, generatedAt) {
  if (!template.includes("<!-- TELEMETRY_SLOT -->")) {
    throw new Error("Profile template is missing the TELEMETRY_SLOT marker.");
  }
  const top = languages.slice(0, 7);
  const remainder = languages.slice(7).reduce((sum, item) => sum + item.percentage, 0);
  if (remainder >= 0.05) top.push({ name: "Other", percentage: remainder });
  const totalBytes = languages.reduce((sum, item) => sum + item.bytes, 0);
  const signature = createHash("sha256")
    .update(JSON.stringify({
      repoCount,
      languages: languages.map(({ name, bytes }) => [name, bytes]),
      template: createHash("sha256").update(template).digest("hex"),
    }))
    .digest("hex").slice(0, 16);
  const rows = top.length ? top : [{ name: "NO CODE DATA", percentage: 100 }];

  let offset = 0;
  const segments = rows.map((item, index) => {
    const width = index === rows.length - 1 ? 1056 - offset : Math.max(2, 1056 * item.percentage / 100);
    const segment = `<rect x="${(72 + offset).toFixed(2)}" y="958" width="${width.toFixed(2)}" height="22" fill="${COLORS[index % COLORS.length]}"/>`;
    offset += width;
    return segment;
  }).join("\n    ");

  const entries = rows.map((item, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 76 + column * 544;
    const y = 1042 + row * 50;
    return `<g transform="translate(${x} ${y})">
      <rect width="12" height="12" rx="2" fill="${COLORS[index % COLORS.length]}"/>
      <text x="28" y="13" fill="#dce2e4" class="language">${escapeXml(item.name)}</text>
      <text x="480" y="13" fill="#00f0ff" class="percentage" text-anchor="end">${item.percentage.toFixed(1)}%</text>
      <path d="M28 27H480" fill="none" stroke="#222a2c" stroke-width="1"/>
    </g>`;
  }).join("\n    ");

  const timestamp = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(generatedAt).replace(",", "");

  const telemetry = `<g id="language-telemetry">
    <path d="M38 850H1162V1206L1126 1242H38Z" fill="#0f1314" stroke="#394245" stroke-width="2"/>
    <rect x="38" y="850" width="306" height="44" fill="#fcee0a"/>
    <text x="62" y="879" fill="#080a0b" class="label">03 / LANGUAGE TELEMETRY</text>
    <circle cx="1120" cy="872" r="5" fill="#00f0ff" filter="url(#cyanGlow)"/>
    <text x="1098" y="878" fill="#7d898c" class="small" text-anchor="end">LIVE</text>
    <text x="72" y="928" fill="#f6f7f8" class="display" font-size="28">CODEBASE COMPOSITION</text>
    <text x="1128" y="928" fill="#7d898c" class="small" text-anchor="end">${repoCount} REPOS · ${(totalBytes / 1024 / 1024).toFixed(1)} MiB INDEXED</text>
    <rect x="72" y="958" width="1056" height="22" rx="3" fill="#20282a"/>
    <g>${segments}</g>
    <text x="72" y="1008" fill="#687477" class="small">SOURCE · GITHUB LINGUIST BYTE COUNTS</text>
    <text x="1128" y="1008" fill="#687477" class="small" text-anchor="end">UPDATED ${escapeXml(timestamp)} CST</text>
    ${entries}
  </g>`;

  return template
    .replace("<svg ", `<svg data-signature="${signature}" `)
    .replace("<!-- TELEMETRY_SLOT -->", telemetry)
    .replace("<title id=\"title\">", `<title id="title">${escapeXml(owner)} · `);
}

export { aggregate, renderSvg };

async function main() {
  const owner = process.env.PROFILE_OWNER || process.env.GITHUB_REPOSITORY_OWNER || "ethanwod";
  const output = resolve(process.env.OUTPUT_PATH || "assets/profile-dashboard.svg");
  const templatePath = resolve(process.env.TEMPLATE_PATH || "assets/profile-interface.svg");
  let data;
  if (process.env.LANGUAGE_FIXTURE) {
    data = JSON.parse(await readFile(resolve(process.env.LANGUAGE_FIXTURE), "utf8"));
  } else {
    data = await collectLanguages(owner, process.env.GITHUB_TOKEN);
  }
  const template = await readFile(templatePath, "utf8");
  const svg = renderSvg(template, owner, data.repoCount, aggregate(data.languageMaps), new Date());
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

