'use strict';
const { PRONOUNS, sanitizeName } = require('../core/text');

const ui = window.crowUI;
const $ = (id) => document.getElementById(id);
let current = null;

async function init() {
  const s = await ui.getState();
  current = s.crow;
  const p = PRONOUNS[s.crow.gender];
  $('label').textContent = `What should ${s.crow.name} be called?`;
  $('hint').textContent = `${p.subj[0].toUpperCase()}${p.subj.slice(1)} will answer to it right away.`;
  const input = $('name');
  input.value = s.crow.name;
  input.select();
  input.focus();
}

async function save() {
  const name = sanitizeName($('name').value, current ? current.name : 'Poe');
  await ui.rename(name);
  ui.close();
}

$('save').addEventListener('click', save);
$('cancel').addEventListener('click', () => ui.close());
$('name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') save();
  if (e.key === 'Escape') ui.close();
});

init();
