import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SRC = join(ROOT, "src");
const BASELINE_FILE = join(ROOT, "scripts", "spacing-contract-baseline.json");
const SOURCE_EXTENSIONS = new Set([".astro", ".css", ".scss", ".js", ".jsx", ".ts", ".tsx"]);
const METRICS = ["tailwindOffScale", "tailwindArbitrary", "cssMagicValue"];

function collectSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(absolutePath);
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [absolutePath] : [];
  });
}

function isAllowedTailwindSpacing(property, value) {
  if (property.startsWith("m") && value === "auto") return true;
  if (/^\[(?:var\(--(?:space|layout)-|--(?:space|layout)-)/.test(value)) return true;
  if (!/^\d+(?:\.\d+)?$/.test(value)) return false;

  const step = Number(value);
  return Number.isInteger(step) && step % 2 === 0;
}

function auditTailwind(content) {
  const result = { tailwindOffScale: 0, tailwindArbitrary: 0 };
  const classPattern = /(?:^|[\s"'`])(?:[a-z0-9-]+:)*(-?)(gap(?:-[xy])?|space-[xy]|p[trblxy]?|m[trblxy]?)-([^\s"'`<>}]+)/gim;

  for (const match of content.matchAll(classPattern)) {
    const [, , property, rawValue] = match;
    const value = rawValue.replace(/[),;]+$/, "");
    if (isAllowedTailwindSpacing(property, value)) continue;
    result.tailwindOffScale += 1;
    if (value.startsWith("[")) result.tailwindArbitrary += 1;
  }

  return result;
}

function auditCssMagicValues(content) {
  let cssMagicValue = 0;
  const declarationPattern = /\b(?:gap|row-gap|column-gap|padding(?:-(?:block|inline|top|right|bottom|left)(?:-(?:start|end))?)?|margin(?:-(?:block|inline|top|right|bottom|left)(?:-(?:start|end))?)?)\s*:\s*([^;}{]+)/gim;

  for (const match of content.matchAll(declarationPattern)) {
    const value = match[1].trim();
    if (/^(?:0|auto)(?:\s+(?:0|auto)){0,3}$/.test(value)) continue;
    if (/var\(--(?:space|layout)-/.test(value)) continue;
    if (/(?:^|[\s(,+*/-])-?(?:\d*\.)?\d+(?:px|rem|em|ch|vh|vw|vmin|vmax)(?:\b|\))/i.test(value)) {
      cssMagicValue += 1;
    }
  }

  return cssMagicValue;
}

export function auditSpacingContract() {
  const report = {};

  for (const absolutePath of collectSourceFiles(SRC)) {
    const content = readFileSync(absolutePath, "utf8");
    const tailwind = auditTailwind(content);
    const metrics = {
      ...tailwind,
      cssMagicValue: auditCssMagicValues(content),
    };

    if (METRICS.some((metric) => metrics[metric] > 0)) {
      report[relative(ROOT, absolutePath)] = metrics;
    }
  }

  return report;
}

function totals(report) {
  return Object.values(report).reduce(
    (summary, metrics) => {
      for (const metric of METRICS) summary[metric] += metrics[metric] ?? 0;
      return summary;
    },
    Object.fromEntries(METRICS.map((metric) => [metric, 0])),
  );
}

function moduleFor(file) {
  const parts = file.split("/");
  if (parts[1] === "pages" || parts[1] === "components") {
    return parts.length > 3 ? parts.slice(0, 3).join("/") : `${parts[0]}/${parts[1]}/_root`;
  }
  return parts.slice(0, 2).join("/");
}

function totalsByModule(report) {
  const modules = {};

  for (const [file, metrics] of Object.entries(report)) {
    const module = moduleFor(file);
    modules[module] ??= Object.fromEntries(METRICS.map((metric) => [metric, 0]));
    for (const metric of METRICS) modules[module][metric] += metrics[metric] ?? 0;
  }

  return Object.fromEntries(Object.entries(modules).sort(([left], [right]) => left.localeCompare(right)));
}

function compareWithBaseline(report, baseline) {
  const newDebt = [];
  const baselineUpdates = [];
  const modules = totalsByModule(report);

  for (const [module, metrics] of Object.entries(modules)) {
    const allowed = baseline[module];
    if (!allowed) {
      newDebt.push(`${module}: contiene deuda de espaciado nueva`);
      continue;
    }

    for (const metric of METRICS) {
      if ((metrics[metric] ?? 0) > (allowed[metric] ?? 0)) {
        newDebt.push(`${module}: ${metric} subió de ${allowed[metric] ?? 0} a ${metrics[metric] ?? 0}`);
      } else if ((metrics[metric] ?? 0) < (allowed[metric] ?? 0)) {
        baselineUpdates.push(`${module}: ${metric} bajó de ${allowed[metric] ?? 0} a ${metrics[metric] ?? 0}`);
      }
    }
  }

  for (const module of Object.keys(baseline)) {
    if (!modules[module]) baselineUpdates.push(`${module}: ya no contiene deuda; elimina el módulo de la línea base`);
  }

  return { baselineUpdates, newDebt };
}

const report = auditSpacingContract();

if (process.argv.includes("--report")) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}

if (process.argv.includes("--baseline")) {
  process.stdout.write(`${JSON.stringify(totalsByModule(report), null, 2)}\n`);
  process.exit(0);
}

if (!existsSync(BASELINE_FILE)) {
  console.error("Falta scripts/spacing-contract-baseline.json. Ejecuta el reporte y revisa la línea base antes de crearla.");
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
const { baselineUpdates, newDebt } = compareWithBaseline(report, baseline);
const summary = totals(report);

console.log(
  `Contrato de espaciado: ${Object.keys(report).length} archivos heredados; ` +
    `${summary.tailwindOffScale} clases fuera de escala, ` +
    `${summary.tailwindArbitrary} arbitrarias y ${summary.cssMagicValue} declaraciones CSS por migrar.`,
);

if (newDebt.length > 0) {
  console.error("\nSe agregó deuda nueva de padding, margin o gap:");
  for (const failure of newDebt) console.error(`- ${failure}`);
  process.exit(1);
}

if (baselineUpdates.length > 0) {
  console.error("\nLa deuda bajó. Actualiza scripts/spacing-contract-baseline.json para que no pueda regresar:");
  for (const update of baselineUpdates) console.error(`- ${update}`);
  process.exit(1);
}
