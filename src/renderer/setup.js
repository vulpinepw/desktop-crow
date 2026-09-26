'use strict';
const { createPreview } = require('./preview');
const { PRONOUNS, sanitizeName } = require('../core/text');

const ui = window.crowUI;
const $ = (id) => document.getElementById(id);
let gender = 'she';

createPreview($('stage'), { scale: 1.7, seed: 3 });

function refreshCopy() {
  const p = PRONOUNS[gender];
  $('lede').textContent = `It seems to like it here. Give ${p.obj} a name so you two can get acquainted.`;
  $('go').textContent = `Let ${p.obj} in`;
}

document.querySelectorAll('[data-g]').forEach((b) => {
  b.addEventListener('click', () => {
    gender = b.dataset.g;
    document.querySelectorAll('[data-g]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    refreshCopy();
  });
});

async function init() {
  const s = await ui.getState();
  gender = s.crow.gender;
  document.querySelectorAll('[data-g]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.g === gender)));
  const input = $('name');
  input.value = s.crow.name;
  input.select();
  input.focus();
  const chips = $('chips');
  for (const n of s.suggestions.slice(0, 7)) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'chip';
    c.textContent = n;
    c.addEventListener('click', () => {
      input.value = n;
      input.focus();
    });
    chips.appendChild(c);
  }
  refreshCopy();
}

async function submit() {
  const name = sanitizeName($('name').value, 'Poe');
  $('go').disabled = true;
  await ui.setup({ name, gender });
}

$('go').addEventListener('click', submit);
$('name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit();
});

init();
