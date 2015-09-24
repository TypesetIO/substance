var OO = require('../basics/oo');

function NodeConverter() {
}

OO.initClass(NodeConverter);

OO.makeExtensible(NodeConverter,
  // built-in static properties
  {
    // name of the node
    "nodeType": true,
    // name of the converter
    "converter": true
  }
);

module.exports = NodeConverter;
