'use strict';

var _ = require('../basics');
var Data = require('../data');

var Node = Data.Node.extend({
  displayName: "DocumentNode",
  name: "node",

  attach: function(document) {
    this.document = document;
    this.didAttach(document);
  },

  detach: function() {
    var doc = this.document;
    _.each(this.constructor.schema, function(type, propertyName) {
      doc.getEventProxy('path').remove([this.id, propertyName], this);
    });
    this.document = null;
    this.didDetach(doc);
  },

  didAttach: function() {},

  didDetach: function() {},

  isAttached: function() {
    return this.document !== null;
  },

  getDocument: function() {
    return this.document;
  },

  hasParent: function() {
    return !!this.parent;
  },

  getParent: function() {
    return this.document.get(this.parent);
  },

  getRoot: function() {
    var node = this;
    while (node.hasParent()) {
      node = node.getParent();
    }
    return node;
  },

  getComponents: function() {
    var componentNames = this.constructor.static.components || [];
    if (componentNames.length === 0) {
      console.warn('Contract: a node must define its editable properties.', this.constructor.static.name);
    }
    return componentNames;
  },

  // volatile property necessary to render highlighted node differently
  setHighlighted: function(highlighted) {
    if (this.highlighted !== highlighted) {
      this.highlighted = highlighted;
      this.emit('highlighted', highlighted);
    }
  },

  isExternal: function() {
    return this.constructor.static.external;
  },

  // Note: children are provided for inline nodes only.
  toHtml: function(converter, children) {
    return this.constructor.static.toHtml(this, converter, children);
  },

  connect: function(ctx, handlers) {
    _.each(handlers, function(func, name) {
      var match = /([a-zA-Z_0-9]+):changed/.exec(name);
      if (match) {
        var propertyName = match[1];
        if (this.constructor.static.schema[propertyName]) {
          this.getDocument().getEventProxy('path').add([this.id, propertyName], this, this._onPropertyChange.bind(this, propertyName));
        }
      }
    });
    Data.Node.prototype.connect.apply(this, arguments);
  },

  disconnect: function() {
    // TODO: right now do not unregister from the event proxy
    // when there is no property listener left
    // We would need to implement disconnect
    Data.Node.prototype.disconnect.apply(this, arguments);
  },

  _onPropertyChange: function(propertyName) {
    var args = [propertyName + ':changed']
      .concat(Array.prototype.slice.call(arguments, 1));
    this.emit.apply(this, args);
  },

});

// default HTML serialization
Node.static.toHtml = function(node, converter) {
  var $el = $('<div itemscope>')
    .attr('data-id', node.id)
    .attr('data-type', node.type);
  _.each(node.properties, function(value, name) {
    var $prop = $('<div>').attr('itemprop', name);
    if (node.getPropertyType === 'string') {
      $prop[0].appendChild(converter.annotatedText([node.id, name]));
    } else {
      $prop.text(value);
    }
    $el.append($prop);
  });
  return $el;
};

Node.static.addConverter = function(nodeConverter) {
  if (!nodeConverter.static.name) {
    throw new Error('NodeConverter.name is mandatory.');
  }
  var NodeClass = this.__NodeClass__;
  // such as 'xml' or 'html'
  var converterName = nodeConverter.static.name;
  var nodeType = NodeClass.static.name;
  if (!Object.hasOwnProperty('converters')) {
    this.converters = {};
  }
  this.converters[converterName] = nodeConverter;
  if (nodeConverter.prototype.alias) {
    if (_.isString(nodeConverter.prototype.alias)) {
        this.converters[nodeConverter.prototype.alias] = nodeConverter
    } else if (_.isArray(nodeConverter.prototype.alias)) {
      _.each(nodeConverter.prototype.alias, function(alias) {
        this.converters[alias] = nodeConverter
      }, this);
    }
  }
};

Node.static.getConverter = function(converterName) {
  var NodeClass = this.__NodeClass__;
  var nodeType = NodeClass.static.name;
  var staticContext = this;
  while (staticContext) {
    if (staticContext.converters &&
        staticContext.converters[converterName]) {
      return staticContext.converters[converterName];
    }
    // iterate through the static contexts of parent classes
    staticContext = staticContext.prototype;
  }
};

Node.static.external = false;

module.exports = Node;
