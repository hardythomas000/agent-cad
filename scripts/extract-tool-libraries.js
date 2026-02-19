/**
 * Extract Mastercam .tooldb (SQLite) into JSON tool libraries.
 *
 * Usage: node scripts/extract-tool-libraries.js
 *
 * Reads haas.tooldb and mazak.tooldb, writes:
 *   packages/sdf-kernel/src/tool-libraries/haas.json
 *   packages/sdf-kernel/src/tool-libraries/mazak.json
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const RADIUS_TYPES = { 0: 'flat', 1: 'ballnose', 2: 'corner_radius', 3: 'bull' };

function extractLibrary(dbPath, name) {
  const db = new Database(dbPath, { readonly: true });

  const tools = db.prepare(`
    SELECT t.ToolNumber, m.OverallDiameter, m.OverallLength, m.CuttingDepth,
           m.ShoulderLength, m.FluteCount, m.ArborDiameter, m.MfgToolCode,
           m.MCToolType, e.CornerRadius, e.TlRadiusType
    FROM TlTool t
    JOIN TlToolMill m ON t.ID = m.ID
    LEFT JOIN TlToolEndmill e ON t.ID = e.ID
    ORDER BY t.ToolNumber
  `).all();

  const library = tools.map(t => ({
    number: t.ToolNumber,
    type: RADIUS_TYPES[t.TlRadiusType] || 'endmill',
    diameter: t.OverallDiameter,
    corner_radius: t.CornerRadius || 0,
    flute_length: t.CuttingDepth,
    overall_length: t.OverallLength,
    shoulder_length: t.ShoulderLength,
    flutes: t.FluteCount,
    shank_diameter: t.ArborDiameter,
    mfg_code: t.MfgToolCode || '',
  }));

  db.close();
  console.log(`${name}: ${library.length} tools extracted`);
  return library;
}

// Extract both libraries
const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'packages', 'sdf-kernel', 'src', 'tool-libraries');
fs.mkdirSync(outDir, { recursive: true });

const libraries = {
  haas: path.join(repoRoot, 'Mastercam Haas tool list', 'haas.tooldb'),
  mazak: path.join(repoRoot, 'Mastercam Mazak tool list', 'mazak.tooldb'),
};

for (const [name, dbPath] of Object.entries(libraries)) {
  if (!fs.existsSync(dbPath)) {
    console.log(`Skipping ${name}: ${dbPath} not found`);
    continue;
  }
  const tools = extractLibrary(dbPath, name);
  const outPath = path.join(outDir, `${name}.json`);
  fs.writeFileSync(outPath, JSON.stringify(tools, null, 2) + '\n');
  console.log(`  → ${outPath}`);
}

console.log('\nDone. Tool libraries ready for import.');
