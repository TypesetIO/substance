"use strict";

require('../qunit_extensions');

var Component = require('../../../ui/Component');
var simple = require('../../fixtures/simple');
var createAnnotation = require('../../../model/transform/createAnnotation');
var DocumentSession = require('../../../model/DocumentSession');
var TestContainerEditor = require('./TestContainerEditor');

var components = {
  "paragraph": require('../../../packages/paragraph/ParagraphComponent')
};

QUnit.uiModule('ui/Surface');

// This test was added to cover issue #82
QUnit.uiTest("Set the selection after creating annotation.", function(assert) {
  var doc = simple();
  var documentSession = new DocumentSession(doc);
  var app = Component.mount(TestContainerEditor, {
    doc: doc,
    documentSession: documentSession,
    config: {
      controller: {
        components: components,
        commands: [],
      }
    }
  }, '#qunit-fixture');
  var surface = app.refs.editor;
  // surface.setFocused(true);
  var sel = doc.createSelection(['p1', 'content'], 0, 5);
  surface.setSelection(sel);
  // this should blur the surface which should persist the selection
  surface.el.blur();
  surface.transaction(function(tx, args) {
    args.selection = sel;
    args.node = {type: "strong"};
    args = createAnnotation(tx, args);
    return args;
  });
  surface.el.focus();
  var wsel = window.getSelection();
  var newSel = surface.domSelection.getSelection();
  assert.equal(wsel.rangeCount, 1, "There should be a DOM selection.");
  assert.ok(newSel.equals(sel), "New selection should be equal to initial selection.");
});
