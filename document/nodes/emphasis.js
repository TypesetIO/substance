'use strict';

var Annotation = require('../annotation');

var Emphasis = Annotation.extend({
  name: "emphasis",
  displayName: "Emphasis",
  splitContainerSelections: true,
  static: {
    tagName: "em"
  }
});

Emphasis.static.addConverter(Annotation.Converter.extend({
  name: 'xml',
  alias: ['html', 'clipboard']
  matchElement: function($el) {
    return $el.is("em, i");
  }
});

module.exports = Emphasis;
