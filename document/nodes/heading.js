'use strict';

var TextNode = require('../text_node');
var NodeConverter = require('../node_converter');

var Heading = TextNode.extend({
  name: "heading",
  displayName: "Heading",
  properties: {
    "level": "number"
  },
  static: {
    blockType: true,
    tocType: true
  }
});

Heading.static.addConverter(NodeConverter.extend({
  name: "xml",
  alias: ["html", "clipboard"],
  matchElement: function($el) {
    return /^h\d$/.exec($el[0].tagName.toLowerCase());
  },
  import: function($el, converter) {
    var id = converter.defaultId($el, 'heading');
    var heading = {
      id: id,
      level: parseInt(''+$el[0].tagName[1], 10),
      content: ''
    };
    heading.content = converter.annotatedText($el, [id, 'content']);
    return heading;
  },
  export: function(heading, converter) {
    var id = heading.id;
    var $el = $('<h' + heading.level + '>');
    $el.append(converter.annotatedText([id, 'content']));
    return $el;
  }
});

module.exports = Heading;
