const Database = require('better-sqlite3');
const db = new Database('c:/Users/hardy.thomas/source/agent-cad/Mastercam Haas tool list/haas.tooldb', { readonly: true });

const RADIUS_TYPES = { 0: 'flat', 1: 'ball', 2: 'corner_r', 3: 'bull' };

const tools = db.prepare(`
  SELECT t.ToolNumber, m.OverallDiameter, m.OverallLength, m.CuttingDepth, m.ShoulderLength,
         m.FluteCount, m.ArborDiameter, m.MfgToolCode, m.MCToolType,
         e.CornerRadius, e.TlRadiusType
  FROM TlTool t
  JOIN TlToolMill m ON t.ID = m.ID
  LEFT JOIN TlToolEndmill e ON t.ID = e.ID
  ORDER BY t.ToolNumber
`).all();

console.log('=== HAAS TOOL LIBRARY (' + tools.length + ' tools) ===\n');

tools.forEach(t => {
  const type = RADIUS_TYPES[t.TlRadiusType] || 'endmill';
  console.log(
    'T' + t.ToolNumber,
    'D' + t.OverallDiameter,
    type + (t.CornerRadius ? ' R' + t.CornerRadius : ''),
    t.FluteCount + 'fl',
    'FL:' + t.CuttingDepth,
    'OAL:' + t.OverallLength,
    t.MfgToolCode || ''
  );
});

// Ballnose tools specifically
const balls = db.prepare(`
  SELECT t.ToolNumber, m.OverallDiameter, m.CuttingDepth, m.FluteCount, m.MfgToolCode, m.ArborDiameter
  FROM TlTool t JOIN TlToolMill m ON t.ID = m.ID
  LEFT JOIN TlToolEndmill e ON t.ID = e.ID
  WHERE e.TlRadiusType = 1
  ORDER BY t.ToolNumber
`).all();

console.log('\n=== BALLNOSE TOOLS ===');
balls.forEach(t => console.log(
  'T' + t.ToolNumber, 'D' + t.OverallDiameter, t.FluteCount + 'fl',
  'FL:' + t.CuttingDepth, 'shank:' + t.ArborDiameter, t.MfgToolCode || ''
));

db.close();
