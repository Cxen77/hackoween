// Builds presentation/Model_Making_Process.pptx: how the FloodCast forecast model was made.
const pptxgen = require('pptxgenjs');

const DARK = '0B2E3F';
const PRIMARY = '065A82';
const TEAL = '1C7293';
const AMBER = 'E8A33D';
const TINT = 'EEF5F8';
const TEXT = '1F2933';
const MUTED = '5B6B7A';
const LINE = 'D0D7DE';

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
pres.title = 'How we built the FloodCast forecast model';
pres.author = 'Team Straw_Hats';

const shadow = () => ({ type: 'outer', blur: 6, offset: 2, angle: 90, color: '000000', opacity: 0.12 });

function heading(slide, text, sub) {
  slide.addText(text, { x: 0.6, y: 0.4, w: 12.1, h: 0.85, fontFace: 'Cambria', fontSize: 34, bold: true, color: DARK, margin: 0, valign: 'middle', isTextBox: true });
  if (sub) slide.addText(sub, { x: 0.6, y: 1.25, w: 12.1, h: 0.45, fontFace: 'Calibri', fontSize: 16, color: MUTED, margin: 0, isTextBox: true });
}

function card(slide, x, y, w, h, fill = TINT) {
  slide.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: fill }, shadow: shadow() });
}

function bullets(slide, items, opts) {
  slide.addText(items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < items.length - 1 } })), Object.assign({
    fontFace: 'Calibri', fontSize: 16, color: TEXT, valign: 'top', margin: 0, paraSpaceAfter: 6, isTextBox: true,
  }, opts));
}

function stat(slide, x, y, w, big, label) {
  card(slide, x, y, w, 1.9, 'FFFFFF');
  slide.addText(big, { x: x + 0.25, y: y + 0.2, w: w - 0.5, h: 0.9, fontFace: 'Cambria', fontSize: big.length > 8 ? 28 : 40, bold: true, color: PRIMARY, margin: 0, isTextBox: true });
  slide.addText(label, { x: x + 0.25, y: y + 1.1, w: w - 0.5, h: 0.7, fontFace: 'Calibri', fontSize: 14, color: MUTED, margin: 0, valign: 'top', isTextBox: true });
}

function table(slide, rows, x, y, colW, opts = {}) {
  const data = rows.map((r, ri) => r.map(text => ({
    text,
    options: ri === 0
      ? { bold: true, color: 'FFFFFF', fill: { color: PRIMARY } }
      : { color: TEXT, fill: { color: ri % 2 ? 'FFFFFF' : TINT } },
  })));
  slide.addTable(data, Object.assign({
    x, y, colW, fontFace: 'Calibri', fontSize: 14, rowH: 0.46, margin: 0.06,
    border: { type: 'solid', color: LINE, pt: 0.75 },
  }, opts));
}

function step(slide, n, label, title, body, x, y, w = 3.9, h = 2.45) {
  card(slide, x, y, w, h, TINT);
  slide.addShape(pres.shapes.OVAL, { x: x + 0.25, y: y + 0.25, w: 0.6, h: 0.6, fill: { color: PRIMARY }, line: { color: PRIMARY } });
  slide.addText(String(n), { x: x + 0.25, y: y + 0.25, w: 0.6, h: 0.6, fontFace: 'Cambria', fontSize: 18, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0, isTextBox: true });
  slide.addText(title, { x: x + 1.05, y: y + 0.22, w: w - 1.25, h: 0.66, fontFace: 'Calibri', fontSize: 17, bold: true, color: DARK, margin: 0, valign: 'middle', isTextBox: true });
  slide.addText(body, { x: x + 0.25, y: y + 1.05, w: w - 0.5, h: h - 1.2, fontFace: 'Calibri', fontSize: 14, color: TEXT, margin: 0, valign: 'top', isTextBox: true });
}

// 1. Title -------------------------------------------------------------
{
  const s = pres.addSlide();
  s.background = { color: DARK };
  s.addText('How we built the FloodCast forecast model', { x: 0.8, y: 2.0, w: 11.7, h: 1.6, fontFace: 'Cambria', fontSize: 44, bold: true, color: 'FFFFFF', margin: 0, valign: 'bottom', isTextBox: true });
  s.addText('From raw gauge data to a tested, deployed forecaster', { x: 0.8, y: 3.75, w: 11.7, h: 0.6, fontFace: 'Calibri', fontSize: 22, color: 'CADCFC', margin: 0, isTextBox: true });
  s.addText('Team Straw_Hats  ·  FLOODCAST and BASINSHIFT', { x: 0.8, y: 6.3, w: 11.7, h: 0.45, fontFace: 'Calibri', fontSize: 16, color: 'CADCFC', margin: 0, isTextBox: true });
  s.addNotes('Set the scene: this talk follows the model from the first data file to the live website.');
}

// 2. Goal ---------------------------------------------------------------
{
  const s = pres.addSlide();
  heading(s, 'The goal', 'Forecast river flow for rivers the model has never seen');
  stat(s, 0.6, 2.0, 3.8, '+1 · +3 · +7', 'days ahead, as the BASINSHIFT challenge asks');
  stat(s, 4.75, 2.0, 3.8, '90%', 'target coverage of the prediction interval');
  stat(s, 8.9, 2.0, 3.8, '534', 'catchments used for training, from 55 USGS gauges and 479 Caravan basins');
  bullets(s, [
    'Output for each forecast: the flow, a 90% range, and the probability of high flow (Q90) and extreme flow (Q99).',
    'Success means beating persistence (tomorrow equals today) on rivers left out of training.',
    'Two challenges: FLOODCAST (same-day daily estimates for 2025) and BASINSHIFT (the forecast system).',
  ], { x: 0.6, y: 4.4, w: 12.1, h: 2.4, fontSize: 17 });
  s.addNotes('Explain the two targets: the forecast horizons and the probability of a flood-level flow.');
}

// 3. Process overview ---------------------------------------------------
{
  const s = pres.addSlide();
  heading(s, 'The process at a glance', 'Ten steps, each checked before the next one starts');
  const names = [
    ['Get the data', '55 USGS gauges plus 479 Caravan basins'],
    ['Clean it', 'Remove bad, duplicate and impossible values'],
    ['Set baselines', 'Persistence, climatology, weather-only'],
    ['Build features', 'Recent flow, averages, trend, weather'],
    ['Train models', 'LightGBM for change, quantiles and floods'],
    ['Calibrate', 'Conformal intervals, isotonic probabilities'],
    ['Validate on unseen data', 'Held-out gauges and basins, never trained on'],
    ['Find and fix bugs', 'Empty thresholds dropped the big gauges'],
    ['Tune and route by size', 'Pick the best model per river size'],
    ['Deploy', 'Model server, website, tests and test files'],
  ];
  names.forEach(([t, b], i) => {
    const col = i % 5, row = Math.floor(i / 5);
    step(s, i + 1, '', t, b, 0.6 + col * 2.46, 1.95 + row * 2.6, 2.3, 2.35);
  });
  s.addNotes('Walk through the ten steps quickly; the next slides go into each one.');
}

// 4. Step 1 Data --------------------------------------------------------
{
  const s = pres.addSlide();
  heading(s, 'Step 1: The data');
  card(s, 0.6, 1.7, 5.8, 2.1, TINT);
  s.addText([
    { text: 'Training file', options: { bold: true, fontSize: 18, color: DARK, breakLine: true } },
    { text: '293,057 rows · 12 columns', options: { fontSize: 16, color: TEXT, breakLine: true } },
    { text: '55 US gauges · 2010 to 2024', options: { fontSize: 16, color: TEXT } },
  ], { x: 0.9, y: 1.9, w: 5.3, h: 1.7, fontFace: 'Calibri', margin: 0, valign: 'top', paraSpaceAfter: 6, isTextBox: true });
  card(s, 6.9, 1.7, 5.8, 2.1, TINT);
  s.addText([
    { text: 'Test file', options: { bold: true, fontSize: 18, color: DARK, breakLine: true } },
    { text: '19,306 rows · 11 columns (no target)', options: { fontSize: 16, color: TEXT, breakLine: true } },
    { text: '53 US gauges · all of 2025', options: { fontSize: 16, color: TEXT } },
  ], { x: 7.2, y: 1.9, w: 5.3, h: 1.7, fontFace: 'Calibri', margin: 0, valign: 'top', paraSpaceAfter: 6, isTextBox: true });
  table(s, [
    ['Column group', 'Columns', 'Changes daily?'],
    ['Target', 'discharge_cfs (river flow)', 'Yes'],
    ['Weather', 'precipitation, max and min temperature, soil moisture', 'Yes'],
    ['Catchment', 'drainage area, elevation, slope, forest cover, impervious cover', 'No'],
  ], 0.6, 4.2, [2.4, 7.9, 1.8]);
  s.addText('Each row is one gauge on one day. The target is discharge_cfs, in cubic feet per second.', { x: 0.6, y: 6.5, w: 12.1, h: 0.4, fontFace: 'Calibri', fontSize: 14, color: MUTED, margin: 0, isTextBox: true });
  s.addNotes('Explain that the test file has no target column, because the target is what we predict.');
}

// 5. Step 2 Cleaning ----------------------------------------------------
{
  const s = pres.addSlide();
  heading(s, 'Step 2: Cleaning', 'Bad data is removed or repaired before any model sees it');
  step(s, 1, '', 'Check values', 'Negative flow, impossible weather and NaN values are removed.', 0.6, 1.95, 3.9, 2.3);
  step(s, 2, '', 'Remove duplicates', 'Repeated station and date pairs are dropped.', 4.72, 1.95, 3.9, 2.3);
  step(s, 3, '', 'Clip soil moisture', 'Soil moisture is limited to 0 to 1, the physical range.', 8.84, 1.95, 3.9, 2.3);
  step(s, 4, '', 'Fill short gaps', 'Gaps up to 7 days are filled forward. Longer gaps use a weather-only fallback.', 0.6, 4.55, 3.9, 2.3);
  step(s, 5, '', 'Remove Caravan outliers', '583 extreme outlier rows and 228,761 rows from runs of zeros longer than 90 days.', 4.72, 4.55, 3.9, 2.3);
  step(s, 6, '', 'Keep reports', 'Every removal is counted in a saved quality report, shown on the website.', 8.84, 4.55, 3.9, 2.3);
  s.addNotes('Cleaning rules are documented so the panel can see nothing was removed silently.');
}

// 6. Step 3 Baselines ---------------------------------------------------
{
  const s = pres.addSlide();
  heading(s, 'Step 3: Baselines come first', 'A model is only useful if it beats the simple answers');
  step(s, 1, '', 'Persistence', 'Tomorrow equals today. Very hard to beat, and our main benchmark.', 0.6, 1.95, 3.9, 2.4);
  step(s, 2, '', 'Seasonal climatology', 'The typical flow for that month, from earlier years.', 4.72, 1.95, 3.9, 2.4);
  step(s, 3, '', 'Weather-only model', 'Boosted trees using weather but not recent flow.', 8.84, 1.95, 3.9, 2.4);
  card(s, 0.6, 4.75, 12.14, 1.85, 'FFFFFF');
  s.addText([
    { text: 'The score we use: RMSE ratio', options: { bold: true, fontSize: 18, color: DARK, breakLine: true } },
    { text: 'Our error divided by persistence error. Below 1.00 means we win; 0.95 means 5% less error.', options: { fontSize: 16, color: TEXT } },
  ], { x: 0.9, y: 4.95, w: 11.6, h: 1.4, fontFace: 'Calibri', margin: 0, valign: 'top', paraSpaceAfter: 8, isTextBox: true });
  s.addNotes('Explain persistence in one sentence: it is what you would guess with no model at all.');
}

// 7. Step 4 Features and target -----------------------------------------
{
  const s = pres.addSlide();
  heading(s, 'Step 4: Features and the target');
  card(s, 0.6, 1.7, 5.9, 4.9, TINT);
  s.addText('Inputs the model sees (all built from the past only)', { x: 0.9, y: 1.9, w: 5.3, h: 0.5, fontFace: 'Calibri', fontSize: 17, bold: true, color: DARK, margin: 0, isTextBox: true });
  bullets(s, [
    'Recent flow: the latest value and the day before, plus 7-day and 30-day averages and the 7-day maximum',
    'Variability: 7-day coefficient of variation; trend = recent flow minus the 30-day average',
    'Thresholds: how far recent flow sits from the river\'s own Q90 and Q99 levels',
    'Weather and catchment facts from Step 1',
  ], { x: 0.9, y: 2.5, w: 5.3, h: 3.9, fontSize: 15 });
  card(s, 6.9, 1.7, 5.84, 4.9, 'FFFFFF');
  s.addText('What the model predicts', { x: 7.2, y: 1.9, w: 5.2, h: 0.5, fontFace: 'Calibri', fontSize: 17, bold: true, color: DARK, margin: 0, isTextBox: true });
  s.addText('log(tomorrow\'s flow ÷ today\'s flow)', { x: 7.2, y: 2.5, w: 5.2, h: 0.5, fontFace: 'Cambria', fontSize: 20, color: PRIMARY, margin: 0, isTextBox: true });
  bullets(s, [
    'A ratio suits rivers of very different sizes.',
    'The forecast blends it with today\'s flow: 0.5 × today + 0.5 × (today × exp(predicted change)).',
    'The blend keeps the forecast safe when the learned change is wrong.',
  ], { x: 7.2, y: 3.2, w: 5.2, h: 3.2, fontSize: 15 });
  s.addNotes('Stress that every input is available at forecast time: no future values leak in.');
}

// 8. Step 5 Training heads ----------------------------------------------
{
  const s = pres.addSlide();
  heading(s, 'Step 5: Training the models', 'LightGBM gradient boosting: many small trees, each correcting the last');
  table(s, [
    ['Model', 'What it learns', 'Objective'],
    ['Change model', 'Predicted log-change in flow', 'Regression'],
    ['Lower and upper quantiles', 'The 5th and 95th percentile of that change', 'Quantile regression'],
    ['High-flow classifier', 'Will flow exceed Q90?', 'Binary classification'],
    ['Extreme-flow classifier', 'Will flow exceed Q99?', 'Binary classification'],
    ['Weather-only fallback', 'Flow from weather alone', 'Regression'],
  ], 0.6, 1.95, [3.4, 5.6, 3.1]);
  card(s, 0.6, 5.0, 12.14, 1.6, TINT);
  s.addText([
    { text: 'Settings: ', options: { bold: true, color: DARK } },
    { text: '300 trees · learning rate 0.06 · 63 leaves per tree (127 in the tuned model) · at least 60 rows per leaf · 80% of rows and columns sampled per tree. Each horizon (+1, +3, +7) gets its own set.', options: { color: TEXT } },
  ], { x: 0.9, y: 5.2, w: 11.6, h: 1.2, fontFace: 'Calibri', fontSize: 16, margin: 0, valign: 'middle', isTextBox: true });
  s.addNotes('Keep the model count simple: per horizon, one change model, two quantile models, two classifiers and a fallback.');
}

// 9. Step 6 Calibration -------------------------------------------------
{
  const s = pres.addSlide();
  heading(s, 'Step 6: Calibration', 'Raw model outputs are adjusted so their stated confidence is honest');
  step(s, 1, '', 'Conformal interval', 'Widens the 5% to 95% range using held-aside data, so it covers about 90% of outcomes.', 0.6, 1.95, 5.9, 2.2);
  step(s, 2, '', 'Isotonic probabilities', 'A monotone curve fitted to the classifier scores, so "30%" really happens about 30% of the time.', 6.84, 1.95, 5.9, 2.2);
  card(s, 0.6, 4.55, 12.14, 2.05, 'FFFFFF');
  s.addText([
    { text: 'Why it matters', options: { bold: true, fontSize: 18, color: DARK, breakLine: true } },
    { text: 'A forecast with a 90% range is only useful if the range really holds about 90% of the time. Calibration is checked on the calibration years, not the test years.', options: { fontSize: 16, color: TEXT } },
  ], { x: 0.9, y: 4.75, w: 11.6, h: 1.7, fontFace: 'Calibri', margin: 0, valign: 'top', paraSpaceAfter: 8, isTextBox: true });
  s.addNotes('Calibration uses its own years, so the test years stay untouched.');
}

// 10. Step 7 Validation split -------------------------------------------
{
  const s = pres.addSlide();
  heading(s, 'Step 7: Honest validation', 'Three separate pieces of data, so nothing is tested on what it trained on');
  const blocks = [
    ['Train', 'Rows before 2022', PRIMARY],
    ['Calibrate', '2022 to 2023', TEAL],
    ['Test', 'Scored on separate unseen sets (below)', AMBER],
  ];
  blocks.forEach(([t, d, c], i) => {
    const x = 0.6 + i * 4.1;
    s.addShape(pres.shapes.RECTANGLE, { x, y: 2.0, w: 3.9, h: 1.5, fill: { color: c }, line: { color: c } });
    s.addText(t, { x: x + 0.25, y: 2.1, w: 3.4, h: 0.6, fontFace: 'Cambria', fontSize: 22, bold: true, color: i === 2 ? DARK : 'FFFFFF', margin: 0, isTextBox: true });
    s.addText(d, { x: x + 0.25, y: 2.7, w: 3.4, h: 0.6, fontFace: 'Calibri', fontSize: 15, color: i === 2 ? DARK : 'FFFFFF', margin: 0, isTextBox: true });
  });
  table(s, [
    ['Held out', 'What it is', 'Years tested'],
    ['11 US gauges', 'Whole gauges left out of training (random, seed 42)', '2022 to 2024'],
    ['60 Caravan basins', 'Whole basins left out of training (seed 7)', '2010 to 2014'],
  ], 0.6, 4.0, [3.0, 6.4, 2.74]);
  s.addText('The exact held-out ids are saved in holdout_ids.json, so every test can be repeated.', { x: 0.6, y: 5.9, w: 12.1, h: 0.5, fontFace: 'Calibri', fontSize: 15, color: MUTED, margin: 0, isTextBox: true });
  s.addNotes('Stress: the test set is never used to pick settings. Tuning uses calibration years only.');
}

// 11. The bug we found --------------------------------------------------
{
  const s = pres.addSlide();
  heading(s, 'Problem found: big rivers were silently dropped', 'Testing on unseen gauges exposed it; training scores hid it');
  s.addChart(pres.charts.BAR, [{ name: '1-day RMSE ratio', labels: ['First combined model', 'After tuning', 'Final routed model'], values: [1.072, 1.020, 0.975] }], {
    x: 0.6, y: 1.9, w: 6.6, h: 4.6, barDir: 'col', chartColors: [PRIMARY],
    showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: '0.000', dataLabelFontSize: 14, dataLabelColor: TEXT,
    showTitle: true, title: '1-day error vs persistence on 11 unseen gauges (below 1.00 wins)', titleFontSize: 14, titleColor: DARK,
    showLegend: false, valAxisMinVal: 0, valAxisMaxVal: 1.2, valAxisLabelColor: MUTED, catAxisLabelColor: MUTED,
    valGridLine: { color: 'E5E7EB', size: 0.5 }, catGridLine: { style: 'none' }, catAxisLabelFontSize: 13, valAxisLabelFontSize: 12,
  });
  card(s, 7.6, 1.9, 5.14, 4.6, TINT);
  s.addText([
    { text: 'What went wrong', options: { bold: true, fontSize: 18, color: DARK, breakLine: true } },
    { text: 'The 55 US gauges start in 2010, but thresholds were set from years before 2000. Their thresholds came out empty, so the training code dropped those gauges without any error.', options: { fontSize: 15, color: TEXT, breakLine: true } },
    { text: 'The fix', options: { bold: true, fontSize: 18, color: DARK, breakLine: true } },
    { text: 'A gauge with no early record uses its own first five years. Each data source also gets its own train and calibration split.', options: { fontSize: 15, color: TEXT } },
  ], { x: 7.9, y: 2.1, w: 4.6, h: 4.3, fontFace: 'Calibri', margin: 0, valign: 'top', paraSpaceAfter: 10, isTextBox: true });
  s.addNotes('This is the most important lesson: the training score looked fine, only unseen-gauge testing showed the problem.');
}

// 12. Step 8 Adding Caravan ---------------------------------------------
{
  const s = pres.addSlide();
  heading(s, 'Step 8: Adding Caravan basins', 'More small rivers, so the model learns how small catchments behave');
  stat(s, 0.6, 1.95, 3.8, '479', 'Caravan US basins added, a public research collection');
  stat(s, 4.75, 1.95, 3.8, '5.59M', 'Caravan rows, converted to our column names and units');
  stat(s, 8.9, 1.95, 3.8, '5.89M', 'combined rows from 534 catchments');
  table(s, [
    ['Combined dataset', 'Rows', 'Stations'],
    ['55 USGS gauges (original)', '293,057', '55'],
    ['479 Caravan basins', '5,594,247', '479'],
    ['Combined (with a source column)', '5,887,304', '534'],
  ], 0.6, 4.2, [6.2, 3.0, 2.94]);
  s.addText('Caravan has no impervious-cover value, so that column is empty for those rows.', { x: 0.6, y: 6.25, w: 12.1, h: 0.4, fontFace: 'Calibri', fontSize: 14, color: MUTED, margin: 0, isTextBox: true });
  s.addNotes('Mention the source column: it lets us tell the two data sources apart in every test.');
}

// 13. Step 9 Tuning -----------------------------------------------------
{
  const s = pres.addSlide();
  heading(s, 'Step 9: Tuning', 'Seven settings tested on calibration years only');
  table(s, [
    ['Setting', 'Big-river error', 'Caravan error'],
    ['Baseline (63 leaves, no extra weight)', '0.905', '0.736'],
    ['Extra weight on USGS rows (×5), 127 leaves', '0.872', '0.730'],
    ['Extra weight ×20, 63 leaves', '0.873', '0.742'],
    ['Other settings tried', '0.88 to 0.89', '0.73 to 0.75'],
  ], 0.6, 1.95, [6.6, 2.75, 2.79]);
  card(s, 0.6, 4.6, 12.14, 2.0, TINT);
  s.addText([
    { text: 'Chosen: 5× weight on the 55 gauges and 127 leaves per tree.', options: { bold: true, color: DARK, breakLine: true } },
    { text: 'The gain is small, about 3 to 4% on big rivers and under 1% on Caravan basins. We report it as a small gain, not a breakthrough.', options: { color: TEXT } },
  ], { x: 0.9, y: 4.8, w: 11.6, h: 1.6, fontFace: 'Calibri', fontSize: 16, margin: 0, valign: 'middle', paraSpaceAfter: 8, isTextBox: true });
  s.addNotes('Values are RMSE ratios against persistence on the calibration windows; lower is better.');
}

// 14. Step 10 Routing ---------------------------------------------------
{
  const s = pres.addSlide();
  heading(s, 'Step 10: Routing by river size', 'Each river goes to the model that did better on unseen catchments');
  table(s, [
    ['Drainage area (sq mi)', 'Basins tested', 'Many-basin model (1 / 3 / 7 day)', 'Big-gauge model (1 / 3 / 7 day)', 'Used'],
    ['Under 500', '57', '0.82 / 0.75 / 0.73 (best)', '0.86 / 0.79 / 0.76', 'Many-basin'],
    ['500 to 2,000', '5', '0.85 / 0.78 / 0.75', '0.88 / 0.82 / 0.80', 'Many-basin'],
    ['2,000 to 10,000', '3', '0.87 / 0.79 / 0.75', '0.86 / 0.79 / 0.76', 'Many-basin (near tie)'],
    ['10,000 to 50,000', '3', '0.91 / 0.83 / 0.77', '0.87 / 0.81 / 0.75', 'Big-gauge'],
    ['Over 50,000', '3', '1.05 / 1.02 / 0.96', '1.00 / 0.98 / 0.96', 'Big-gauge'],
  ], 0.6, 1.95, [2.6, 1.6, 3.3, 3.3, 1.34], { rowH: 0.42 });
  card(s, 0.6, 5.0, 12.14, 1.6, 'FFFFFF');
  s.addText([
    { text: 'Cutoff: 10,000 sq mi.', options: { bold: true, color: DARK, breakLine: true } },
    { text: 'Bands above 10,000 rest on only 3 basins each, so treat those winners as indicative.', options: { color: TEXT } },
  ], { x: 0.9, y: 5.2, w: 11.6, h: 1.2, fontFace: 'Calibri', fontSize: 16, margin: 0, valign: 'middle', paraSpaceAfter: 6, isTextBox: true });
  s.addNotes('Be clear this is data-driven routing, decided on held-out catchments, not a hand-picked rule.');
}

// 15. Results -----------------------------------------------------------
{
  const s = pres.addSlide();
  heading(s, 'Results on rivers the model never saw', 'RMSE ratio vs persistence at +1, +3 and +7 days (below 1.00 wins)');
  table(s, [
    ['Unseen test', '+1 day', '+3 days', '+7 days', '90% interval coverage'],
    ['11 US gauges (2022 to 2024)', '0.975', '0.961', '0.947', '87% to 89%'],
    ['60 Caravan basins (2010 to 2014)', '0.828', '0.764', '0.745', '89% to 90%'],
  ], 0.6, 1.95, [4.4, 1.7, 1.7, 1.7, 2.64], { rowH: 0.55 });
  stat(s, 0.6, 4.2, 3.8, 'AUPRC 0.95', 'high-flow (Q90) detection at +1 day, vs 0.75 for persistence');
  stat(s, 4.75, 4.2, 3.8, '0.94 vs 0.93', 'median NSE at +1 day on the 11 gauges (model vs persistence)');
  stat(s, 8.9, 4.2, 3.8, '0.63 vs 0.18', 'median NSE at +7 days: the gap widens with horizon');
  s.addNotes('Explain NSE: 1 is perfect, 0 means no better than guessing the average, below 0 is worse than guessing.');
}

// 16. Deployment --------------------------------------------------------
{
  const s = pres.addSlide();
  heading(s, 'Step 11: Deployment', 'From trained files to a live forecast on the website');
  const flow = ['Saved models', 'Model server', 'Website', 'Judge tools'];
  flow.forEach((t, i) => {
    const x = 0.6 + i * 3.1;
    card(s, x, 1.95, 2.6, 1.2, i === 1 ? PRIMARY : TINT);
    s.addText(t, { x, y: 1.95, w: 2.6, h: 1.2, fontFace: 'Calibri', fontSize: 18, bold: true, color: i === 1 ? 'FFFFFF' : DARK, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
  });
  bullets(s, [
    'Two model files are saved: one for small and medium rivers, one for rivers of 10,000 sq mi or more. A small file keeps the gauge facts the server needs, so the full training data is not required at run time.',
    'The model server routes each request by drainage area and returns the forecast, interval and probabilities.',
    'Quality checks run automatically: 42 website tests and the Python tests pass, and the production build succeeds.',
    'Judge-style tests are built in: score a CSV, check the output format, and test any gauge.',
  ], { x: 0.6, y: 3.6, w: 12.1, h: 3.3, fontSize: 16 });
  s.addNotes('Mention that the models are included in the repository, so another computer can run the same system.');
}

// 17. Lessons and limits ------------------------------------------------
{
  const s = pres.addSlide();
  s.background = { color: DARK };
  s.addText('What we learned', { x: 0.6, y: 0.4, w: 12.1, h: 0.85, fontFace: 'Cambria', fontSize: 34, bold: true, color: 'FFFFFF', margin: 0, valign: 'middle', isTextBox: true });
  s.addText([
    { text: 'Test on data the model never trained on. The silent bug was invisible in training scores.', options: { bullet: true, breakLine: true } },
    { text: 'Beat the simple baseline first. Persistence is hard to beat, and we report every result against it.', options: { bullet: true, breakLine: true } },
    { text: 'Let the data choose. Routing and the cutoff come from held-out results, not from opinion.', options: { bullet: true, breakLine: true } },
    { text: 'Limits: extreme floods are rare and weakly detected; big-river gains are only a few percent; the 2010+ gauges and large bands rest on few samples.', options: { bullet: true, breakLine: true } },
    { text: 'Next: an all-data retrain, real water-level feeds for India, and a sequence-model baseline.', options: { bullet: true } },
  ], { x: 0.6, y: 1.8, w: 12.1, h: 4.9, fontFace: 'Calibri', fontSize: 19, color: 'FFFFFF', valign: 'top', margin: 0, paraSpaceAfter: 14, isTextBox: true });
  s.addNotes('Close on the honest limits; the panel trusts the numbers more when we name them first.');
}

pres.writeFile({ fileName: 'Model_Making_Process.pptx' }).then(f => console.log('wrote', f));
