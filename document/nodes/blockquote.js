'use strict';

var TextNode = require('../text_node');
var NodeConverter = require('../node_converter');

var Blockquote = TextNode.extend({
  displayName: "Blockquote",
  name: "blockquote",
  static: {
    blockType: true
  }
});

Blockquote.static.addConverter(NodeConverter.extend({
  name: 'xml',
  alias: ['html', 'clipboard'],
  matchElement: function($el) {
    return $el.is('blockquote');
  },
  import: function($el, converter) {
    var id = converter.defaultId($el, 'blockquote');
    var blockquote = {
      id: id,
      content: ''
    };
    blockquote.content = converter.annotatedText($el, [id, 'content']);
    return blockquote;
  },
  export: function(paragraph, converter) {
    var id = paragraph.id;
    var $el = $('<blockquote>')
      .attr('id', id);
    $el.append(converter.annotatedText([id, 'content']));
    return $el;
  },
});

module.exports = Blockquote;
