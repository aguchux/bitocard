// Anjio's answers: the few tags the API lets through become blocks of text the app draws; nothing else is ever a tag.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { answerBlocks, answerText } from '../src/lib/answer-html.ts';

test('paragraphs, bold, italic and line breaks become runs', () => {
  assert.deepEqual(answerBlocks('<p>Hello <strong>Ada</strong>, <em>welcome</em>.<br>Ask me.</p><p>Second</p>'), [
    { kind: 'p', runs: [{ text: 'Hello ' }, { text: 'Ada', bold: true }, { text: ', ' }, { text: 'welcome', italic: true }, { text: '.' }, { br: true }, { text: 'Ask me.' }] },
    { kind: 'p', runs: [{ text: 'Second' }] },
  ]);
});

test('lists keep their items and whether they are numbered', () => {
  assert.deepEqual(answerBlocks('<p>Check:</p><ol><li>The <strong>IMEI</strong></li><li>The screen</li></ol><ul><li>One</li></ul>'), [
    { kind: 'p', runs: [{ text: 'Check:' }] },
    { kind: 'list', ordered: true, items: [[{ text: 'The ' }, { text: 'IMEI', bold: true }], [{ text: 'The screen' }]] },
    { kind: 'list', ordered: false, items: [[{ text: 'One' }]] },
  ]);
});

test('links keep only https addresses and the site’s own paths', () => {
  const blocks = answerBlocks('<p><a href="/ng/l/77-iphone">This one</a>, <a href="https://udozo.com/safe-trade">the guide</a> and <a href="javascript:alert(1)">no</a></p>');
  assert.deepEqual(blocks[0], {
    kind: 'p',
    runs: [{ text: 'This one', href: '/ng/l/77-iphone' }, { text: ', ' }, { text: 'the guide', href: 'https://udozo.com/safe-trade' }, { text: ' and no' }],
  });
});

test('other tags are dropped, entities decoded, and plain answers become paragraphs', () => {
  assert.deepEqual(answerBlocks('<p>Tom &amp; Jerry <script>x</script><img src=x></p>'), [{ kind: 'p', runs: [{ text: 'Tom & Jerry x' }] }]);
  assert.deepEqual(answerBlocks('First line\nsecond\n\nNext'), [
    { kind: 'p', runs: [{ text: 'First line' }, { br: true }, { text: 'second' }] },
    { kind: 'p', runs: [{ text: 'Next' }] },
  ]);
  assert.deepEqual(answerBlocks('Loose <strong>words</strong><li>an item</li>'), [
    { kind: 'p', runs: [{ text: 'Loose ' }, { text: 'words', bold: true }] },
    { kind: 'list', ordered: false, items: [[{ text: 'an item' }]] },
  ]);
  assert.deepEqual(answerBlocks(''), []);
});

test('the words alone, for screen readers and copying', () => {
  assert.equal(answerText('<p>Hi <strong>there</strong></p><ol><li>One</li><li>Two</li></ol>'), 'Hi there\n\n1. One\n2. Two');
});
