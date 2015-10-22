'use strict';

var OO = require('../../basics/oo');
var Component = require('../../ui/component');
var $$ = Component.$$;
var TextProperty = require('../../ui/text_property_component');

function ParagraphComponent() {
  Component.apply(this, arguments);
}

ParagraphComponent.Prototype = function() {

  this.getClassNames = function() {
    return "content-node paragraph";
  };

  this.render = function() {
    return $$('div')
      .addClass(this.getClassNames())
      .attr("data-id", this.props.node.id)
      .append($$(TextProperty)
        .setProps({
          doc: this.props.doc,
          path: [ this.props.node.id, "content"]
        })
      );
  };
};

OO.inherit(ParagraphComponent, Component);

module.exports = ParagraphComponent;
