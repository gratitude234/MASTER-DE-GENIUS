/**
 * Visual-dependency integrity, provider visual preservation, duplicate option
 * content and prompt sanitation.
 *
 * Every REGRESSION case here is a question that was really delivered to a
 * student. The provider ids and text are taken from frozen session snapshots,
 * and the ALOC Station payloads reproduce the shape a live `/questions` and
 * `/questions/{id}` response returned on 2026-09-20.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

process.env.ALOC_STATION_API_KEY = 'station-test-key';
process.env.ALOC_STATION_BASE_URL = 'https://station.aloc.test/api/v1';

const { checkQuestionIntegrity, findVisualReference, findDuplicateOptionContent } =
  await import('../features/questions/integrity.ts');
const { normalizeStationQuestion } =
  await import('../features/questions/providers/aloc-station/normalize.ts');
const { normalizeAlocQuestion, cleanText } =
  await import('../features/questions/providers/aloc/normalize.ts');
const { normalizeSdashQuestion } =
  await import('../features/questions/providers/sdash/normalize.ts');
const { AlocStationQuestionProvider } =
  await import('../features/questions/providers/aloc-station/index.ts');
const { assembleDeliverableQuestions } = await import('../features/questions/service.ts');
const { toStudentQuestion, toStudentQuestions } = await import('../features/questions/delivery.ts');

console.info = () => {};
console.warn = () => {};

const OPTIONS = [{ text: 'Speed' }, { text: 'Velocity' }, { text: 'Mass' }, { text: 'Energy' }];

const question = (overrides = {}) => ({
  prompt: 'Which quantity is a vector?',
  instruction: null,
  passage: null,
  assets: [],
  options: OPTIONS,
  ...overrides,
});

const asset = { id: 'aloc-station:q:imageUrl' };

const reject = (overrides, reason) => {
  const result = checkQuestionIntegrity(question(overrides));
  assert.equal(result.valid, false, `expected a rejection for: ${overrides.prompt ?? '(no prompt)'}`);
  assert.equal(result.reason, reason);
  return result;
};

const accept = (overrides) => {
  const result = checkQuestionIntegrity(question(overrides));
  assert.equal(result.valid, true, `unexpectedly rejected (${result.reason}: ${result.detail}): ${overrides.prompt}`);
};

/* ═══════════════════════════════════════════════  1-6. the three screenshots */

test('REGRESSION 1: "Using the table…" is refused without a table and served with one', () => {
  // JAMB Mathematics 2018 Q46, provider id 2ac31703-d8dc-4ebf-9b9e-07154864ed34.
  const prompt = 'Using the table, What is the modal age?';
  reject({ prompt }, 'missing_referenced_asset');
  accept({ prompt, assets: [asset] });
});

test('REGRESSION 2: "The histogram above…" is refused without the histogram', () => {
  // JAMB Mathematics 2009 Q47, provider id 213f8f9e-49f8-4781-8f2e-1f0ce6527e47.
  const prompt = 'The histogram above represents the number of candidates that sat for '
    + 'Mathematics examination in a school. How many candidate scored more than 50 marks?';
  reject({ prompt }, 'missing_referenced_asset');
  accept({ prompt, assets: [asset] });
});

test('REGRESSION 3: "From the graph…" is refused without the graph', () => {
  // JAMB Chemistry 2025 Q34, provider id bd6e7acb-a963-4910-a9ab-ebb4317a7596.
  const prompt = 'From the graph, it can be inferred that';
  reject({ prompt }, 'missing_referenced_asset');
  accept({ prompt, assets: [asset] });
});

test('REGRESSION: a histogram referenced with no direction word at all', () => {
  // JAMB Mathematics 2001 Q50 — "above" never appears, so the original
  // directional rule could not have caught it.
  const prompt = 'The histogram shows the distribution of passengers in taxis at a certain '
    + 'motor park. How many taxis have more than 4 passengers?';
  reject({ prompt }, 'missing_referenced_asset');
  accept({ prompt, assets: [asset] });
});

/* ═══════════════════════════════════════════════  7-9. the other visual kinds */

test('a diagram reference needs a diagram, in every frame real papers use', () => {
  for (const prompt of [
    'In the diagram above, PQR is a circle centre O. If < QPR is x°, find < QRP.',   // directional
    'Based on the above diagram, the candidates would not have cheated if',           // reversed
    'Calculate the effective capacitance of the circuit in the diagram given',        // anchored
    'In the diagram shown, which of the simple pendulum will resonate with P?',       // anchored
    'Find the value of x in the diagram',                                             // directed
    'Study the diagram and name the labelled part',                                   // directed
    'The diagram represents',                                                         // predicated
    'Use the following diagram to answer the question',                               // enumerated
  ]) {
    reject({ prompt }, 'missing_referenced_asset');
    accept({ prompt, assets: [asset] });
  }
});

test('a chart reference needs the chart', () => {
  for (const prompt of [
    'The bar chart above shows the distribution of marks in a class test.',
    'The pie chart above shows the monthly distribution of a man’s salary on food items.',
    'From the chart, determine the modal class',
    'Examine the chart and state the trend',
  ]) {
    reject({ prompt }, 'missing_referenced_asset');
    accept({ prompt, assets: [asset] });
  }
});

test('a map reference needs the map', () => {
  for (const prompt of [
    'The map above shows the vegetation belts of Nigeria.',
    'Using the map, identify the river marked Q',
    'Study the map and name the capital marked X',
  ]) {
    reject({ prompt }, 'missing_referenced_asset');
    accept({ prompt, assets: [asset] });
  }
});

test('tables, graphs, venn diagrams, figures and illustrations are all covered', () => {
  for (const prompt of [
    'The table above shows the scores of a group of students in a physics test.',
    'Calculate the median age of the frequency distribution in the table above',
    'the graph above shows the cumulative frequency curve of the distribution of marks.',
    'The venn diagram shows a class of 50 students with the games they play.',
    'In the figure above, |CD| is the base of the triangle CDE.',
    'The value x in the figure given is',
    'Study the illustration below and answer the question',
    'The picture above shows a simple machine',
    'Refer to the sketch above and name the part labelled P',
    'From the drawing below, identify the component marked R',
  ]) {
    reject({ prompt }, 'missing_referenced_asset');
    accept({ prompt, assets: [asset] });
  }
});

/* ═══════════════════════════════════  10. ordinary prose must survive intact */

test('REGRESSION: non-referential "figure" is never mistaken for a diagram', () => {
  // Every one of these was in the live corpus and must keep being served.
  accept({ prompt: 'Reach each number to two significant figures and then evaluate (0.02174 × 1.2047)/0.023789' });
  accept({ prompt: 'Evaluate 21/9 to 3 significant figures' });
  accept({ prompt: 'Simplify (0.0839 × 6.381)/5.44 to 2 significant figures.' });
  accept({ prompt: 'The figure of speech in which a poet implicitly compares an object or idea with another is called a' });
  accept({ prompt: 'A figure of speech in which an absent person or an object is addressed as if present is referred to as' });
  accept({ prompt: 'Laraba saw a forlorn little figure sitting outside the class?' });
  accept({ prompt: 'The diminutive figure bounces over the track with unfathomable lightness?' });
  accept({ prompt: 'In literary criticism, a casual reference to a figure is' });
  accept({ prompt: 'However, under-porting and the lack of post-mortem makes it impossible to establish exact figures.' });
});

test('REGRESSION: "table", "graph", "chart", "image" and "drawings" in their ordinary senses', () => {
  accept({ prompt: 'Which of the following statements is correct about the periodic table?' });
  accept({ prompt: 'Elements in the same periodic table have the same' });
  accept({ prompt: 'How many possible ways are there of seating seven people at a circular table' });
  accept({ prompt: 'He needn’t have bought that new table' });
  accept({ prompt: 'A few grains of table salt were put in a cup of cold water.' });
  accept({ prompt: 'A cumulative frequency graph is' });
  accept({ prompt: 'If two graphs y = px2 + q and y = 2x2 -1 intersect at x = 2, find the value of p.' });
  accept({ prompt: 'One of the characteristics of a good organizational chart is that it should' });
  accept({ prompt: 'What is the angle of the sector of cassava in a pie chart?' });
  accept({ prompt: 'On a pie chart there are six sectors of which four angles are 30°, 45°, 60°, 90°.' });
  accept({ prompt: 'An object of height 5 cm is placed 20 cm from a concave mirror. the image height is?' });
  accept({ prompt: 'Had he considered his public image carefully, he ..... for his in the election?' });
  accept({ prompt: 'Nebuchadnezzar ordered his subjects to worship the image he set up whenever they' });
  accept({ prompt: 'The pin-hole camera produces a less sharply defined image when the' });
  accept({ prompt: 'In William Blake’s poem, the mental picture created in the mind of the reader is of a' });
  accept({ prompt: 'The illustration of Satan, the adversary who prowls around, is particular to' });
  accept({ prompt: 'Zakari’s personal drawings amounted to' });
  accept({ prompt: 'Interests on drawings made by partners are at 10% per annum.' });
});

test('REGRESSION: a question that describes its own graph in words is self-contained', () => {
  // "the graph" points backwards at "a graph … is plotted", not at a picture.
  accept({
    prompt: 'In Faradays law of electrolysis, a graph of the mass deposited against the '
      + 'quantity of electricity is plotted. The slope of the graph gives?',
  });
  // Without the indefinite introduction the same clause is a missing visual.
  reject({ prompt: 'The slope of the graph gives?' }, 'missing_referenced_asset');
});

test('"which of the following diagrams" means the options, not a missing picture', () => {
  accept({ prompt: 'Which of the following diagrams represents a series circuit?' });
  // But an instruction genuinely pointing at a supplied one still fails.
  reject({ prompt: 'Use the following table to answer the question' }, 'missing_referenced_asset');
});

test('an instruction that references a visual is judged with the prompt', () => {
  reject({ prompt: 'Find x', instruction: 'Study the diagram above and answer the question.' }, 'missing_referenced_asset');
  accept({ prompt: 'Find x', instruction: 'Study the diagram above and answer the question.', assets: [asset] });
});

test('findVisualReference reports the matched phrase for diagnostics only', () => {
  assert.equal(findVisualReference('Using the table, What is the modal age?'), 'using the table');
  assert.equal(findVisualReference('The histogram above represents the candidates'), 'histogram above');
  assert.equal(findVisualReference('From the graph, it can be inferred that'), 'from the graph');
  assert.equal(findVisualReference('Which quantity is a vector?'), null);
});

/* ═══════════════════════════════  11-12. provider visuals must be preserved */

/** The exact ALOC Station record shape, verified live on 2026-09-20. */
const stationRecord = (overrides = {}) => ({
  id: '2ac31703-d8dc-4ebf-9b9e-07154864ed34',
  text: 'Using the table,What is the modal age?',
  options: { A: '4', B: '5', C: '6', D: '7' },
  correctAnswer: 'B',
  examType: 'jamb',
  subject: 'mathematics',
  year: 2018,
  educationLevel: 'senior_secondary',
  classLevel: null,
  section: null,
  imageUrl: 'https://res.cloudinary.com/aloc-ng/image/upload/v1724006540/ALOC-Questions/Mathematics/2018/JAMB_MATH_2018_Q46_ypiyhc.jpg',
  questionNumber: 46,
  country: 'NG',
  category: 'others',
  institution: null,
  state: null,
  provenance: { contentSource: 'historical', reviewStatus: 'approved' },
  ...overrides,
});

const normalizeStation = (overrides = {}) =>
  normalizeStationQuestion(stationRecord(overrides), {
    examBody: 'jamb', subjectSlug: 'mathematics', subjectName: 'Mathematics',
  });

test('REGRESSION: ALOC Station’s imageUrl becomes a canonical asset', () => {
  // The adapter read `assets ?? image`; Station sends neither. Every Station
  // diagram, graph, histogram and table was discarded at that line.
  const { question: canonical } = normalizeStation();
  assert.equal(canonical.assets.length, 1, 'the provider visual must survive normalization');
  assert.equal(canonical.assets[0].url, stationRecord().imageUrl);
  assert.equal(canonical.assets[0].kind, 'image');
  // Stable and deterministic: the same record always yields the same id.
  assert.equal(canonical.assets[0].id, 'aloc-station:2ac31703-d8dc-4ebf-9b9e-07154864ed34:image');
  assert.equal(normalizeStation().question.assets[0].id, canonical.assets[0].id);
});

test('the preserved Station visual is what makes the question deliverable again', () => {
  assert.equal(checkQuestionIntegrity(normalizeStation().question).valid, true);
  assert.equal(checkQuestionIntegrity(normalizeStation({ imageUrl: null }).question).reason, 'missing_referenced_asset');
});

test('every provider reads its own media field through the one shared normalizer', () => {
  const url = 'https://cdn.test/diagram.png';

  const station = normalizeStation({ imageUrl: url }).question;
  assert.equal(station.assets[0].url, url);

  const { question: legacy } = normalizeAlocQuestion(
    { id: '101', question: 'In the diagram above, find x', option: { a: '1', b: '2' }, answer: 'a', image: url },
    { examBody: 'jamb', subjectSlug: 'mathematics', subjectName: 'Mathematics' },
  );
  assert.equal(legacy.assets[0].url, url);
  assert.equal(legacy.assets[0].id, 'aloc:101:image');

  const { question: sdash } = normalizeSdashQuestion(
    { id: '4821', question: 'In the diagram above, find x', option: { a: '1', b: '2' }, answer: 'a', image: url },
    { examBody: 'waec', subjectSlug: 'chemistry', subjectName: 'Chemistry', examType: 'wassce' },
  );
  assert.equal(sdash.assets[0].url, url);
});

test('a media field carrying an array or an object is preserved with its alt text', () => {
  const many = normalizeStation({
    imageUrl: null,
    media: [
      { url: 'https://cdn.test/a.png', alt: 'Frequency table of ages' },
      'https://cdn.test/b.png',
    ],
  }).question;
  assert.equal(many.assets.length, 2);
  assert.equal(many.assets[0].altText, 'Frequency table of ages');
  assert.equal(many.assets[1].altText, null);
  // Several assets from one field still get distinct, stable ids.
  assert.notEqual(many.assets[0].id, many.assets[1].id);
});

test('an image supplied as HTML or markdown inside the question body is preserved', () => {
  // `cleanText` strips markup so the product never needs dangerouslySetInnerHTML.
  // The URL is read before that happens, so the diagram is not lost with the tag.
  const html = normalizeStation({
    imageUrl: null,
    text: 'Using the table, what is the modal age? <img src="https://cdn.test/table.png" alt="Age table">',
  }).question;
  assert.equal(html.assets.length, 1);
  assert.equal(html.assets[0].url, 'https://cdn.test/table.png');
  assert.equal(html.assets[0].altText, 'Age table');
  assert.equal(html.prompt.includes('<img'), false, 'markup must still be stripped from the prompt');

  const markdown = normalizeStation({
    imageUrl: null,
    text: 'Using the table, what is the modal age? ![Age table](https://cdn.test/table.png)',
  }).question;
  assert.equal(markdown.assets[0].url, 'https://cdn.test/table.png');
  assert.equal(markdown.assets[0].altText, 'Age table');
});

test('an unusable or unsafe URL never becomes an asset', () => {
  for (const imageUrl of [
    null, undefined, '', '   ', 'not-a-url', '/relative/path.png',
    'javascript:alert(1)', 'data:image/png;base64,AAA', 42,
    'http://cdn.test/insecure.png',        // blocked as mixed content, so useless
  ]) {
    assert.deepEqual(normalizeStation({ imageUrl }).question.assets, [], `${imageUrl} must not become an asset`);
  }
});

test('a worked-answer image is never attached to the question', () => {
  // A live random batch returned `…/MATH_2008_Q30_SOLUTION_nstl3`. Showing it
  // beside the prompt would hand the student the answer.
  const leak = normalizeStation({
    imageUrl: 'https://res.cloudinary.com/aloc-ng/image/upload/v1/ALOC-Questions/Mathematics/2008/MATH_2008_Q30_SOLUTION_nstl3.jpg',
  }).question;
  assert.deepEqual(leak.assets, [], 'a solution image must never be shown as a question visual');
  // A genuine diagram whose subject merely discusses solutions is unaffected.
  const fine = normalizeStation({
    imageUrl: 'https://res.cloudinary.com/aloc-ng/image/upload/v1/ALOC-Questions/Chemistry/2025/Chemistry_2025_Q34_solubility.png',
  }).question;
  assert.equal(fine.assets.length, 1);
});

/* ══════════════════════════════════════  13-15. duplicate option content */

test('REGRESSION: two options reading identically are refused', () => {
  // JAMB Mathematics 2018 Q46 was delivered with B = "5" and C = "5".
  const result = checkQuestionIntegrity(question({
    prompt: 'What is the modal age?',
    options: [{ text: '4' }, { text: '5' }, { text: '5' }, { text: '7' }],
  }));
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'duplicate_option_content');
});

test('whitespace-equivalent and case-equivalent duplicates are refused', () => {
  for (const options of [
    [{ text: 'Abuja' }, { text: 'Kano' }, { text: 'Jos' }, { text: '  Abuja  ' }],
    [{ text: 'Abuja' }, { text: 'Kano' }, { text: 'Jos' }, { text: 'Abuja' }],
    [{ text: 'no charge and a zero potential' }, { text: 'no charge and a zero potential' }],
    [{ text: 'Receive' }, { text: 'had received' }, { text: 'receive' }, { text: 'has received' }],
    // Markup and entities are already removed upstream, so wrappers collapse too.
    [{ text: cleanText('<b>5</b>') }, { text: cleanText('&nbsp;5') }, { text: '7' }],
  ]) {
    assert.equal(
      checkQuestionIntegrity(question({ options })).reason,
      'duplicate_option_content',
      JSON.stringify(options),
    );
  }
});

test('genuinely different mathematical and chemical options are never collapsed', () => {
  for (const options of [
    [{ text: '7!/3!' }, { text: '7!/4!' }, { text: '7!/3!4!' }, { text: '7!/5!' }],
    [{ text: '√((3T-K)/M)' }, { text: '√((3T-M)/K)' }, { text: '√((3T+K)/M)' }],
    [{ text: 'dy/dx=10x5/3/3−8x2/3/3' }, { text: 'dy/dx=10x2/3/3−8x5/3/3' }],
    [{ text: '1/2' }, { text: '0.5' }, { text: '2/1' }, { text: '-1' }],
    [{ text: '2+2' }, { text: '2 + 2' }],                  // spacing is not collapsed away
    [{ text: 'NO₂' }, { text: 'NH₃' }, { text: 'N₂O' }, { text: 'NO' }],
    [{ text: 'CO' }, { text: 'Co' }],                       // case is meaning in chemistry
    [{ text: 'teacher’s' }, { text: 'teacher' }, { text: 'teachers' }],
  ]) {
    assert.equal(findDuplicateOptionContent(options), null, JSON.stringify(options));
  }
});

test('REGRESSION: a stress-pattern option set is not collapsed by case folding', () => {
  // Live WAEC/JAMB English sets mark the stressed syllable with capitals, so
  // capitalisation is the content of every option.
  for (const options of [
    [{ text: 'aSSociation' }, { text: 'associaTION' }, { text: 'associAtion' }, { text: 'Association.' }],
    [{ text: 'dedicaTION' }, { text: 'deDIcation' }, { text: 'dedication' }, { text: 'Dedication' }],
    [{ text: 'inOFfensive' }, { text: 'inoffenSIVE' }, { text: 'inofFENsive' }, { text: 'INoffensive' }],
  ]) {
    assert.equal(findDuplicateOptionContent(options), null, JSON.stringify(options));
  }
  // An exact repeat inside such a set is still a duplicate.
  assert.ok(findDuplicateOptionContent([
    { text: 'aSSociation' }, { text: 'associaTION' }, { text: 'aSSociation' },
  ]));
});

/* ══════════════════════════════════════════════════  16. prompt sanitation */

test('REGRESSION: a space lost after punctuation is restored', () => {
  assert.equal(cleanText('Using the table,What is the modal age?'), 'Using the table, What is the modal age?');
  assert.equal(cleanText('Which would Dr.Fajir not be allowed to do'), 'Which would Dr. Fajir not be allowed to do');
  assert.equal(cleanText('He left.She stayed.'), 'He left. She stayed.');
});

test('sanitation never damages an initialism, a number or an expression', () => {
  for (const text of [
    'A.V. Dicey popularised the principle of',
    'The S.I unit of moment of a force is',
    'If the S.V.P of water vapour was 13.5mmHg at 33ºC',
    'The Economic community of West Africa state (E.C.O.W.A.S) is',
    'I.S∩T∩W=S II. S ∪ T ∪ W = W',
    'Evaluate (0.02174 × 1.2047)/0.023789',
    'He bought a shop costing N 54,000 and stock worth N 7,600.',
    'Find the value of f(x,y) at the origin',
    'According to Luke, Jesus was standing by the......He thereafter entered the boat',
  ]) {
    assert.equal(cleanText(text), text, `sanitation must not rewrite: ${text}`);
  }
});

test('sanitation adds, removes and reorders nothing', () => {
  const before = 'Using the table,What is the modal age?';
  const after = cleanText(before);
  assert.deepEqual(after.split(/\s+/).join(''), before.split(/\s+/).join(''));
});

/* ═════════════════════════════════  20-23. delivery, top-up and leakage */

function stationUpstream(batches) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const data = batches[Math.min(calls.length - 1, batches.length - 1)] ?? [];
    return new Response(JSON.stringify({ data, meta: { creditsUsed: data.length } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  return { calls, provider: new AlocStationQuestionProvider(fetchImpl, async () => {}) };
}

/** A question that depends on a visual it never received. */
const brokenVisual = (id) => stationRecord({
  id: `broken-${id}`,
  text: 'The histogram above represents the number of candidates. How many scored more than 50 marks?',
  imageUrl: null,
});

/** The same question, with the visual its text depends on. */
const soundVisual = (id) => stationRecord({
  id: `sound-${id}`,
  text: 'The histogram above represents the number of candidates. How many scored more than 50 marks?',
  imageUrl: `https://cdn.test/histogram-${id}.png`,
});

test('a missing-visual question is replaced from the same provider, not delivered', async () => {
  const { calls, provider } = stationUpstream([
    [brokenVisual(1), brokenVisual(2), soundVisual(3)],
    [soundVisual(4), soundVisual(5)],
  ]);

  const result = await assembleDeliverableQuestions(provider, {
    examBody: 'jamb', subjectSlug: 'mathematics', count: 3, requestType: 'practice',
  });

  assert.equal(result.questions.length, 3, 'the student asked for three and must receive three');
  for (const delivered of result.questions) {
    assert.ok(delivered.assets.length > 0, 'every delivered visual question carries its visual');
    assert.equal(checkQuestionIntegrity(delivered).valid, true);
  }
  assert.equal(result.rejections.length, 2);
  for (const rejection of result.rejections) {
    assert.equal(rejection.reason, 'missing_referenced_asset');
    assert.equal(rejection.provider, 'aloc_station');
  }
  assert.ok(calls.length > 1, 'a top-up round must have been spent');
  // No cross-provider fallback: every round went back to Station.
  for (const url of calls) assert.equal(url.host, 'station.aloc.test');
});

test('a duplicate-option question is rejected before freeze with its own reason', async () => {
  const { provider } = stationUpstream([
    [stationRecord({ id: 'dupe-1', text: 'What is the modal age?', options: { A: '4', B: '5', C: '5', D: '7' }, imageUrl: null })],
    [stationRecord({ id: 'ok-1', text: 'What is the modal age?', options: { A: '4', B: '5', C: '6', D: '7' }, imageUrl: null })],
  ]);

  const result = await assembleDeliverableQuestions(provider, {
    examBody: 'jamb', subjectSlug: 'mathematics', count: 1, requestType: 'practice',
  });

  assert.equal(result.questions.length, 1);
  assert.deepEqual(result.rejections.map((r) => r.reason), ['duplicate_option_content']);
  assert.deepEqual(result.questions[0].options.map((o) => o.text), ['4', '5', '6', '7']);
});

test('the frozen student snapshot carries the visual and never the answer key', () => {
  const canonical = normalizeStation().question;
  const snapshot = toStudentQuestion(canonical);

  // 22: the visual survives into the snapshot a session is frozen from.
  assert.equal(snapshot.assets.length, 1);
  assert.equal(snapshot.assets[0].url, stationRecord().imageUrl);
  // The same rule that admitted it still passes when re-run on the snapshot.
  assert.equal(checkQuestionIntegrity(snapshot).valid, true);

  // 21: nothing that reveals the answer travels with it.
  assert.equal('correctOptionKey' in snapshot, false);
  assert.equal('explanation' in snapshot, false);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes('correctAnswer'), false);
  assert.equal(serialized.includes(canonical.correctOptionKey === 'B' ? '"correctOptionKey"' : '"correctOptionKey"'), false);
});

test('23: the snapshot exposes the asset URL and no other provider detail', () => {
  const [snapshot] = toStudentQuestions([normalizeStation().question]);
  const asset = snapshot.assets[0];

  // The asset carries exactly the four canonical fields the renderer needs.
  assert.deepEqual(Object.keys(asset).sort(), ['altText', 'caption', 'id', 'kind', 'url']);

  // Provider field names, credentials and internal routing never travel with it.
  const serialized = JSON.stringify(snapshot);
  for (const leaked of [
    'imageUrl', 'correctAnswer', 'examType', 'questionNumber', 'provenance',
    'educationLevel', 'ALOC_STATION_API_KEY', 'station-test-key', 'X-API-Key',
  ]) {
    assert.equal(serialized.includes(leaked), false, `"${leaked}" must not reach the student payload`);
  }
  // The id is a diagnostic namespace, not a secret, and stays stable.
  assert.match(asset.id, /^aloc-station:[0-9a-f-]+:image$/);
});
