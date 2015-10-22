'use strict';

var oo = require('../basics/oo');

/**
 * Abstract interface for commands.
 * 
 * @class
 * @memberof module:ui/commands
 */
var Command = function() {
};

Command.Prototype = function() {

  /**
   * Execute command
   *
   * @return {object} info object with execution details
   * @memberof module:ui/commands.Command.prototype
   */
  this.execute = function() {
    throw new Error('execute must be implemented by custom commands');
  };
};

oo.initClass(Command);

module.exports = Command;