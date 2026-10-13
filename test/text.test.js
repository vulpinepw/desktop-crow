'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { t, fill, sanitizeName, sanitizeGender } = require('../src/core/text');

test('names are sanitized: trimmed, collapsed, control/bidi characters removed, length-limited', () => {
  assert.equal(sanitizeName('  Poe  '), 'Poe');
  assert.equal(sanitizeName('Poe\tthe\nCrow'), 'Poe the Crow');
  assert.equal(sanitizeName(`Evil${String.fromCharCode(0x202e)}name`), 'Evilname');
  assert.equal(sanitizeName(`a${String.fromCharCode(0x200b)}b`), 'ab');
  assert.equal(sanitizeName(''), 'Poe');
  assert.equal(sanitizeName(null, 'Onyx'), 'Onyx');
  assert.equal([...sanitizeName('x'.repeat(60))].length, 24);
  assert.equal(sanitizeName('Corvo ☆ 🐦'), 'Corvo ☆ 🐦');
  assert.equal(sanitizeName('Ćwierć'), 'Ćwierć');
});

test('gender is she/he only', () => {
  assert.equal(sanitizeGender('he'), 'he');
  assert.equal(sanitizeGender('she'), 'she');
  assert.equal(sanitizeGender('it'), 'she');
});

test('templates use the name and matching pronouns consistently', () => {
  const she = { name: 'Morrigan', gender: 'she' };
  const he = { name: 'Edgar', gender: 'he' };
  assert.equal(t('giftTitle', she), 'Morrigan brought you something!');
  assert.equal(t('giftBody', she), 'Click the shiny thing she left for you to add it to your treasures.');
  assert.equal(t('giftBody', he), 'Click the shiny thing he left for you to add it to your treasures.');
  assert.equal(t('tierUpBody', he, { tier: 'friendly' }), 'He seems friendly now.');
  assert.equal(t('menuFeed', he), 'Feed Edgar');
  assert.equal(fill('{name} loves {poss} shiny {item}; give it to {obj}.', she, { item: 'ring' }), 'Morrigan loves her shiny ring; give it to her.');
  assert.equal(fill('{Poss} gift', he), 'His gift');
});
