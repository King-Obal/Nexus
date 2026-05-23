#!/usr/bin/env node
// Validates all Forge card scripts and outputs a report of broken cards.
// Usage: node validate-cards.js > report.txt
// Or:    node validate-cards.js --json > report.json

const fs = require('fs');
const path = require('path');

const CARDS_DIR = path.join(__dirname, '../forge-gui/res/cardsfolder');
const OUTPUT_JSON = process.argv.includes('--json');

// All valid ApiType values extracted from ApiType.java
const VALID_API_TYPES = new Set([
  'Abandon','ActivateAbility','AddOrRemoveCounter','AddPhase','AddTurn',
  'AdvanceCrank','Airbend','AlterAttribute','Amass','Animate','AnimateAll',
  'Ascend','AssembleContraption','AssignGroup','Attach','Balance',
  'BecomeMonarch','BecomesBlocked','BidLife','BlankLine','Blight','Block','Bond',
  'Branch','Camouflage','ChangeCombatants','ChangeSpeed','ChangeTargets',
  'ChangeText','ChangeX','ChangeZone','ChangeZoneAll','ChangeZoneResolve',
  'ChaosEnsues','Charm','ChooseCard','ChooseColor','ChooseDirection',
  'ChooseEvenOdd','ChooseNumber','ChoosePlayer','ChooseSector','ChooseSource',
  'ChooseType','ClaimThePrize','Clash','ClassLevelUp','Cleanup','Cloak','Clone',
  'CompanionChoose','Connive','ControlPlayer','ControlSpell','CopyPermanent',
  'CopySpellAbility','Counter','DamageAll','DamageResolve','DayTime','DealDamage',
  'Debuff','DelayedTrigger','Destroy','DestroyAll','Detain','Dig','DigMultiple',
  'DigUntil','Discard','Discover','Draft','DrainMana','Draw','EachDamage',
  'Earthbend','Effect','Encode','EndCombatPhase','EndTurn','Endure',
  'ExchangeControl','ExchangeControlVariant','ExchangeLife','ExchangeLifeVariant',
  'ExchangePower','ExchangeTextBox','ExchangeZone','Explore','Fight','FlipACoin',
  'FlipOntoBattlefield','Fog','GainControl','GainControlVariant','GainLife',
  'GainOwnership','GameDrawn','GenericChoice','Goad','Haunt','Heist',
  'ImmediateTrigger','Incubate','Intensify','InternalIgnoreEffect',
  'InternalLegendaryRule','InternalRadiation','Investigate','Learn','LookAt',
  'LoseLife','LosePerpetual','LosesGame','MakeCard','Mana','ManaReflected',
  'Manifest','ManifestDread','Meld','Mill','MoveCounter','MultiplePiles',
  'MultiplyCounter','MustBlock','Mutate','NameCard','OpenAttraction',
  'PeekAndReveal','PermanentCreature','PermanentNoncreature','Phases','Planeswalk',
  'Play','PlayLandVariant','Poison','PreventDamage','Proliferate','Protection',
  'ProtectionAll','Pump','PumpAll','PutCounter','PutCounterAll','Radiation',
  'RearrangeTopOfLibrary','Regenerate','Regeneration','RemoveCounter',
  'RemoveCounterAll','RemoveFromCombat','RemoveFromGame','RemoveFromMatch',
  'ReorderZone','Repeat','RepeatEach','ReplaceCounter','ReplaceDamage',
  'ReplaceEffect','ReplaceMana','ReplaceSplitDamage','ReplaceToken','RestartGame',
  'Reveal','RevealHand','ReverseTurnOrder','RingTemptsYou','RollDice',
  'RollPlanarDice','RunChaos','Sacrifice','SacrificeAll','Scry','Seek',
  'SetInMotion','SetLife','SetState','Shuffle','SkipPhase','SkipTurn','StoreSVar',
  'Subgame','Surveil','SwitchBlock','TakeInitiative','Tap','TapAll','TapOrUntap',
  'TapOrUntapAll','TimeTravel','Token','TwoPiles','Unattach','UnlockDoor',
  'Untap','UntapAll','Venture','VillainousChoice','Vote','WinsGame',
]);

// Parse a single card file into key/value pairs
function parseCard(content) {
  const lines = content.split('\n');
  const card = { name: '', abilities: [], svars: {}, rawLines: lines };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.substring(0, colonIdx);
    const value = trimmed.substring(colonIdx + 1);

    if (key === 'Name') {
      card.name = value;
    } else if (key === 'SVar') {
      const svarColonIdx = value.indexOf(':');
      if (svarColonIdx !== -1) {
        const svarName = value.substring(0, svarColonIdx);
        const svarValue = value.substring(svarColonIdx + 1);
        card.svars[svarName] = svarValue;
      }
    } else if (['A', 'T', 'S', 'R'].includes(key)) {
      card.abilities.push({ key, value });
    }
  }

  return card;
}

// Extract ApiType from an ability string (AB$, SP$, DB$, ST$)
function extractApiType(abilityStr) {
  const match = abilityStr.match(/(?:AB|SP|DB|ST)\$\s*([A-Za-z]+)/);
  return match ? match[1] : null;
}

// Runtime-provided variables that are NOT script-defined SVars
const RUNTIME_SVARS = new Set([
  'X','Y','Z','W','Count','Remembered','EvenResults','OddResults',
]);

// Extract all SubAbility and Execute references (SVar names)
function extractSVarRefs(abilityStr) {
  const refs = [];

  // SubAbility and Execute always reference script-defined SVars
  const subAbilityPattern = /(?:SubAbility|Execute|TrueSubAbility|FalseSubAbility|RepeatSubAbility)\$\s*([A-Za-z0-9_]+)/g;
  let m;
  while ((m = subAbilityPattern.exec(abilityStr)) !== null) {
    if (!RUNTIME_SVARS.has(m[1])) refs.push(m[1]);
  }

  // ConditionCheckSVar / ConditionSVar — skip if value contains '$' (property access)
  // or starts with known runtime-computed prefixes
  const condPattern = /ConditionCheckSVar\$\s*([^\s|]+)/g;
  while ((m = condPattern.exec(abilityStr)) !== null) {
    const svar = m[1];
    if (!svar.includes('$') && !RUNTIME_SVARS.has(svar) &&
        !/^(PlayerCount|TriggerCount|Triggered|Targeted)/.test(svar)) {
      refs.push(svar);
    }
  }

  return refs;
}

// Extract SVars defined dynamically (ResultSVar$, ExcessSVar$, Announce$, BranchConditionSVar$)
function extractDynamicSVarDefs(abilityStr) {
  const defs = new Set();
  const patterns = [
    /ResultSVar\$\s*([A-Za-z0-9_]+)/g,
    /ExcessSVar\$\s*([A-Za-z0-9_]+)/g,
    /Announce\$\s*([A-Za-z0-9_]+)/g,
    /RememberSVarAmount\$\s*([A-Za-z0-9_]+)/g,
    // StoreSVar defines a new SVar at runtime: DB$ StoreSVar | SVar$ FooBar
    /DB\$\s*StoreSVar[^|]*\|\s*SVar\$\s*([A-Za-z0-9_]+)/g,
    // MaxRollsResults$ True creates MaxRolls; EvenOddResults$ creates EvenResults/OddResults
  ];
  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(abilityStr)) !== null) {
      defs.add(m[1]);
    }
  }
  if (/MaxRollsResults\$\s*True/i.test(abilityStr)) defs.add('MaxRolls');
  if (/StoreVoteNum\$\s*True/i.test(abilityStr)) defs.add('Votes');
  if (/NoteDoubles\$/.test(abilityStr)) defs.add('Doubles');
  return defs;
}

// Validate a single card, return array of errors
function validateCard(card) {
  const errors = [];

  // Check all ability strings (inline + from SVars)
  const allAbilityStrings = [
    ...card.abilities.map(a => a.value),
    ...Object.values(card.svars),
  ];

  const definedSVars = new Set(Object.keys(card.svars));

  // Collect dynamically-defined SVars from all ability strings
  for (const abilityStr of allAbilityStrings) {
    for (const dyn of extractDynamicSVarDefs(abilityStr)) {
      definedSVars.add(dyn);
    }
  }

  for (const abilityStr of allAbilityStrings) {
    // Check ApiType validity
    const apiType = extractApiType(abilityStr);
    if (apiType && !VALID_API_TYPES.has(apiType)) {
      errors.push({ type: 'INVALID_API_TYPE', detail: apiType });
    }

    // Check SVar references exist
    const svarRefs = extractSVarRefs(abilityStr);
    for (const ref of svarRefs) {
      if (!definedSVars.has(ref)) {
        errors.push({ type: 'MISSING_SVAR', detail: ref });
      }
    }
  }

  return errors;
}

// Walk the cardsfolder recursively
function walkDir(dir, callback) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, callback);
    } else if (entry.name.endsWith('.txt')) {
      callback(fullPath);
    }
  }
}

// Main
const results = [];
let total = 0;
let broken = 0;

walkDir(CARDS_DIR, (filePath) => {
  total++;
  const content = fs.readFileSync(filePath, 'utf8');
  const card = parseCard(content);
  if (!card.name) return;

  const errors = validateCard(card);
  if (errors.length > 0) {
    broken++;
    results.push({ name: card.name, file: path.relative(CARDS_DIR, filePath), errors });
  }
});

if (OUTPUT_JSON) {
  console.log(JSON.stringify({ total, broken, cards: results }, null, 2));
} else {
  console.log(`=== Forge Card Validator ===`);
  console.log(`Cartes analysées : ${total}`);
  console.log(`Cartes avec erreurs : ${broken}`);
  console.log('');

  // Group by error type
  const byType = {};
  for (const card of results) {
    for (const err of card.errors) {
      if (!byType[err.type]) byType[err.type] = [];
      byType[err.type].push({ card: card.name, detail: err.detail });
    }
  }

  for (const [errType, items] of Object.entries(byType)) {
    console.log(`--- ${errType} (${items.length} occurrences) ---`);
    for (const item of items) {
      console.log(`  ${item.card} → ${item.detail}`);
    }
    console.log('');
  }
}
