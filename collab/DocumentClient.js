"use strict";

var oo = require('../util/oo');
var $ = require('../util/jquery');

/*
  HTTP client for talking with DocumentServer
*/
function DocumentClient(config) {
  this.config = config;
}

DocumentClient.Prototype = function() {

  /*
    A generic request method
  */
  this._request = function(method, url, data, cb) {
    var ajaxOpts = {
      type: method,
      url: url,
      contentType: "application/json; charset=UTF-8",
      dataType: "json",
      success: function(data) {
        cb(null, data);
      },
      error: function(err) {
        // console.error(err);
        cb(new Error(err.responseJSON.errorMessage));
      }
    };
    if (data) {
      ajaxOpts.data = JSON.stringify(data);
    }
    $.ajax(ajaxOpts);
  };

  /*
    Create a new document on the server
    
    ```js
    @example
    ```

    documentClient.createDocument({
      schemaName: 'prose-article',
      info: {
        userId: 'userx'
      }
    });
  */
  this.createDocument = function(newDocument, cb) {
    this._request('POST', this.config.httpUrl, newDocument, cb);
  };

  /*
    Get a document from the server

    @example
  
    ```js
    documentClient.getDocument('mydoc-id');
    ```
  */

  this.getDocument = function(documentId, cb) {
    this._request('GET', this.config.httpUrl+documentId, null, cb);
  };

  /*
    Remove a document from the server

    @example
  
    ```js
    documentClient.deleteDocument('mydoc-id');
    ```
  */

  this.deleteDocument = function(documentId, cb) {
    this._request('DELETE', this.config.httpUrl+documentId, null, cb);
  };

};

oo.initClass(DocumentClient);

module.exports = DocumentClient;
