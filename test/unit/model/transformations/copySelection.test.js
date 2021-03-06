"use strict";

require('../../qunit_extensions');
var simple = require('../../../fixtures/simple');
var sample1 = require('../../../fixtures/sample1');
var containerSample = require('../../../fixtures/container_sample');
var copySelection = require('../../../../model/transform/copySelection');
var CLIPBOARD_PROPERTY_ID = copySelection.CLIPBOARD_PROPERTY_ID;

QUnit.module('model/transform/copySelection');

QUnit.test("Copying a property selection", function(assert) {
  var doc = sample1();
  var sel = doc.createSelection({
    type: 'property',
    path: ['p1', 'content'],
    startOffset: 4,
    endOffset: 9
  });
  var args = {selection: sel};
  var out = copySelection(doc, args);
  var copy = out.doc;
  var textNode = copy.get(CLIPBOARD_PROPERTY_ID);
  assert.isDefinedAndNotNull(textNode, 'There should be a text node for the property fragment.');
  assert.equal(textNode.content, 'graph', 'Selected text should be copied.');
});

QUnit.test("Copying a property selection with annotated text", function(assert) {
  var doc = sample1();
  var sel = doc.createSelection({
    type: 'property',
    path: ['p2', 'content'],
    startOffset: 10,
    endOffset: 19
  });
  var args = {selection: sel};
  var out = copySelection(doc, args);
  var copy = out.doc;
  assert.equal(copy.get([CLIPBOARD_PROPERTY_ID, 'content']), 'with anno', 'Selected text should be copied.');
  var annos = copy.getIndex('annotations').get([CLIPBOARD_PROPERTY_ID, 'content']);
  assert.equal(annos.length, 1, 'There should be one annotation on copied text.');
  var anno = annos[0];
  assert.equal(anno.type, "emphasis", "The annotation should be 'emphasis'.");
  assert.deepEqual([anno.startOffset, anno.endOffset], [5, 9], 'The annotation should be over the text "anno".');
});

QUnit.test("Copying a container selection", function(assert) {
  var doc = sample1();
  var sel = doc.createSelection({
    type: 'container',
    containerId: 'main',
    startPath: ['h1', 'content'],
    startOffset: 4,
    endPath: ['p2', 'content'],
    endOffset: 9
  });
  var args = {selection: sel};
  var out = copySelection(doc, args);
  var copy = out.doc;
  var content = copy.get('clipboard_content');
  assert.isDefinedAndNotNull(content, 'There should be a container node with id "content".');
  // 4 nodes? 'main', 'clipboard_content', 'p1', 'p2'
  assert.equal(content.nodes.length, 4, 'There should be 4 nodes in the copied document.');
  var first = copy.get(content.nodes[0]);
  assert.equal(first.type, 'heading', "The first node should be a heading.");
  assert.equal(first.content, 'ion 1', "Its content should be truncated to 'ion 1'.");
  var last = copy.get(content.nodes[3]);
  assert.equal(last.type, 'paragraph', "The last node should be a paragraph.");
  assert.equal(last.content, 'Paragraph', "Its content should be truncated to 'Paragraph'.");
});

QUnit.test("Copying a node without editable properties", function(assert) {
  var doc = simple();
  doc.create({
    type: 'image',
    id: 'i1',
    src: 'foo'
  });
  doc.get('main').show('i1', 1);
  var sel = doc.createSelection({
    type: 'container',
    containerId: 'main',
    startPath: ['p1', 'content'],
    startOffset: 4,
    endPath: ['p2', 'content'],
    endOffset: 9
  });
  var args = {selection: sel};
  var out = copySelection(doc, args);
  var copy = out.doc;
  var img = copy.get('i1');
  assert.isDefinedAndNotNull(img, 'The image should be copied.');
});

QUnit.test("Copying a paragraph", function(assert) {
  var doc = simple();
  var sel = doc.createSelection({
    type: 'container',
    containerId: 'main',
    startPath: ['p2'],
    startOffset: 0,
    endPath: ['p2'],
    endOffset: 1
  });
  var args = {selection: sel};
  var out = copySelection(doc, args);
  var copy = out.doc;
  var p2 = copy.get('p2');
  assert.equal(p2.content, doc.get('p2').content, 'The whole paragraph should be copied.');
});

QUnit.test("Copying a nested node (list)", function(assert) {
  var doc = containerSample();
  var list1 = doc.get('list1');
  var sel = doc.createSelection({
    type: 'container',
    containerId: 'main',
    startPath: ['list1'],
    startOffset: 0,
    endPath: ['list1'],
    endOffset: list1.items.length
  });
  var args = { selection: sel };
  var out = copySelection(doc, args);
  var copy = out.doc;
  list1 = copy.get('list1');
  assert.equal(list1.items.length, 4, 'Should have 4 list-items.');
});

QUnit.test("Copying a node without properties", function(assert) {
  var doc = simple();
  doc.create({
    type: 'image',
    id: 'i1',
    src: 'foo'
  });
  doc.get('main').show('i1', 1);
  var sel = doc.createSelection({
    type: 'container',
    containerId: 'main',
    startPath: ['i1'],
    startOffset: 0,
    endPath: ['i1'],
    endOffset: 1
  });
  var args = { selection: sel };
  var out = copySelection(doc, args);
  var copy = out.doc;
  var img = copy.get('i1');
  assert.isDefinedAndNotNull(img, 'The image should be copied.');
  assert.equal(img.src, 'foo');
});
