'use strict';

var TextNode = require('../text_node');
var NodeConverter = require('../node_converter');

var Codeblock = TextNode.extend({
  displayName: "Codeblock",
  name: "codeblock",
  static: {
    blockType: true
  }
});

Codeblock.static.addConverter(NodeConverter.extend({
  name: "xml",
  alias: ['html', 'clipboard'],
  matchElement: function($el) {
    return $el.is('pre');
  },
  import: function($el, converter) {
    var $codeEl = $el.find('code');
    var id = converter.defaultId($el, 'codeblock');
    var codeblock = {
      id: id,
      content: ''
    };
    codeblock.content = converter.annotatedText($codeEl, [id, 'content']);
    return codeblock;
  },
  export: function(paragraph, converter) {
    var id = codeblock.id;
    var $el = $('<pre>')
      .attr('id', id);
    var $codeEl = $('<code>');
    $codeEl.append(converter.annotatedText([id, 'content']));
    $el.append($codeEl);
    return $el;
  },
});

module.exports = Codeblock;
