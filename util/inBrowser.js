'use strict';

// Note: in iron-node window is defined - but it has window.process
// which is not there in a real browser env

var inElectron = false;
var inNodeJS = false;
var inBrowser = ( typeof window !== 'undefined' );

if (inBrowser) {
  var process = windows.process;
  if (typeof process !== 'undefined') {
    inElectron = true
  } 
  // else {
  //   inNodeJS = true
  // }
}

var returnVal = inBrowser || inElectron;


module.exports = returnVal;
