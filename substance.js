(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (factory());
}(this, (function () { 'use strict';

  var oo = require('../util/oo');
  var Err = require('../util/SubstanceError');

  /*
    Implements Substance ChangeStore API. This is just a dumb store.
    No integrity checks are made, as this is the task of DocumentEngine
  */
  function ChangeStore(config) {
    this.config = config;
  }

  ChangeStore.Prototype = function() {

    /*
      Gets changes for a given document

      @param {String} args.documentId document id
      @param {Number} args.sinceVersion since which change
    */
    this.getChanges = function(args, cb) {
      var changes = this._getChanges(args.documentId);

      // sinceVersion is optional
      if (!args.sinceVersion) {
        args.sinceVersion = 0;
      }

      if(args.sinceVersion < 0) {
        return cb(new Err('ChangeStore.ReadError', {
          message: 'Illegal argument "sinceVersion":' +args.sinceVersion
        }));
      }

      if(args.toVersion < 0) {
        return cb(new Err('ChangeStore.ReadError', {
          message: 'Illegal argument "toVersion":' +args.toVersion
        }));
      }

      if(args.sinceVersion >= args.toVersion) {
        return cb(new Err('ChangeStore.ReadError', {
          message: 'Illegal version arguments "sinceVersion":' +args.sinceVersion+ ', toVersion":' +args.toVersion
        }));
      }

      var version = this._getVersion(args.documentId);

      var res;

      if (args.sinceVersion === 0) {
        res = {
          version: version,
          changes: changes.slice(0, args.toVersion)
        };
        cb(null, res);
      } else if (args.sinceVersion > 0) {
        res = {
          version: version,
          changes: changes.slice(args.sinceVersion, args.toVersion)
        };
        cb(null, res);
      }
    };

    /*
      Add a change object to the database
    */
    this.addChange = function(args, cb) {
      if (!args.documentId) {
        return cb(new Err('ChangeStore.CreateError', {
          message: 'No documentId provided'
        }));
      }

      if (!args.change) {
        return cb(new Err('ChangeStore.CreateError', {
          message: 'No change provided'
        }));
      }

      this._addChange(args.documentId, args.change);
      var newVersion = this._getVersion(args.documentId);
      cb(null, newVersion);
    };

    /*
      Delete changes for a given documentId
    */
    this.deleteChanges = function(documentId, cb) {
      var deletedChanges = this._deleteChanges(documentId);
      cb(null, deletedChanges.length);
    };

    /*
      Gets the version number for a document
    */
    this.getVersion = function(id, cb) {
      cb(null, this._getVersion(id));
    };

    /*
      Seeds the database with given changes
    */
    this.seed = function(changes, cb) {
      this._changes = changes;
      if (cb) { cb(null); }
      return this;
    };

    // Handy synchronous helpers
    // -------------------------

    this._deleteChanges = function(documentId) {
      var changes = this._getChanges(documentId);
      delete this._changes[documentId];
      return changes;
    };

    this._getVersion = function(documentId) {
      var changes = this._changes[documentId];
      return changes ? changes.length : 0;
    };

    this._getChanges = function(documentId) {
      return this._changes[documentId] || [];
    };

    this._addChange = function(documentId, change) {
      if (!this._changes[documentId]) {
        this._changes[documentId] = [];
      }
      this._changes[documentId].push(change);
    };
  };

  oo.initClass(ChangeStore);
  module.exports = ChangeStore;

  var EventEmitter = require('../util/EventEmitter');
  var Err$1 = require('../util/SubstanceError');
  var __id__ = 0;

  /**
    ClientConnection abstraction. Uses websockets internally
  */
  function ClientConnection(config) {
    ClientConnection.super.apply(this);

    this.__id__ = __id__++;
    this.config = config;
    this._onMessage = this._onMessage.bind(this);
    this._onConnectionOpen = this._onConnectionOpen.bind(this);
    this._onConnectionClose = this._onConnectionClose.bind(this);

    // Establish websocket connection
    this._connect();
  }

  ClientConnection.Prototype = function() {

    this._createWebSocket = function() {
      throw Err$1('AbstractMethodError');
    };

    /*
      Initializes a new websocket connection
    */
    this._connect = function() {
      this.ws = this._createWebSocket();
      this.ws.addEventListener('open', this._onConnectionOpen);
      this.ws.addEventListener('close', this._onConnectionClose);
      this.ws.addEventListener('message', this._onMessage);
    };

    /*
      Disposes the current websocket connection
    */
    this._disconnect = function() {
      this.ws.removeEventListener('message', this._onMessage);
      this.ws.removeEventListener('open', this._onConnectionOpen);
      this.ws.removeEventListener('close', this._onConnectionClose);
      this.ws = null;
    };

    /*
      Emits open event when connection has been established
    */
    this._onConnectionOpen = function() {
      this.emit('open');
    };

    /*
      Trigger reconnect on connection close
    */
    this._onConnectionClose = function() {
      this._disconnect();
      this.emit('close');
      console.info('websocket connection closed. Attempting to reconnect in 5s.');
      setTimeout(function() {
        this._connect();
      }.bind(this), 5000);
    };

    /*
      Delegate incoming websocket messages
    */
    this._onMessage = function(msg) {
      msg = this.deserializeMessage(msg.data);
      this.emit('message', msg);
    };

    /*
      Send message via websocket channel
    */
    this.send = function(msg) {
      if (!this.isOpen()) {
        console.warn('Message could not be sent. Connection is not open.', msg);
        return;
      }
      this.ws.send(this.serializeMessage(msg));
    };

    /*
      Returns true if websocket connection is open
    */
    this.isOpen = function() {
      return this.ws && this.ws.readyState === 1;
    };

    this.serializeMessage = function(msg) {
      return JSON.stringify(msg);
    };

    this.deserializeMessage = function(msg) {
      return JSON.parse(msg);
    };

  };

  EventEmitter.extend(ClientConnection);
  module.exports = ClientConnection;

  var EventEmitter$1 = require('../util/EventEmitter');
  var __id__$1 = 0;

  /**
    Client for CollabServer API

    Communicates via websocket for real-time operations
  */
  function CollabClient(config) {
    CollabClient.super.apply(this);

    this.__id__ = __id__$1++;
    this.config = config;
    this.connection = config.connection;

    // Hard-coded for now
    this.scope = 'substance/collab';

    // Bind handlers
    this._onMessage = this._onMessage.bind(this);
    this._onConnectionOpen = this._onConnectionOpen.bind(this);
    this._onConnectionClose = this._onConnectionClose.bind(this);

    // Connect handlers
    this.connection.on('open', this._onConnectionOpen);
    this.connection.on('close', this._onConnectionClose);
    this.connection.on('message', this._onMessage);
  }

  CollabClient.Prototype = function() {

    this._onConnectionClose = function() {
      this.emit('disconnected');
    };

    this._onConnectionOpen = function() {
      this.emit('connected');
    };

    /*
      Delegate incoming messages from the connection
    */
    this._onMessage = function(msg) {
      if (msg.scope === this.scope) {
        this.emit('message', msg);
      } else {
        console.info('Message ignored. Not sent in hub scope', msg);
      }
    };

    /*
      Send message via websocket channel
    */
    this.send = function(msg) {
      if (!this.connection.isOpen()) {
        console.warn('Message could not be sent. Connection not open.', msg);
        return;
      }

      msg.scope = this.scope;
      if (this.config.enhanceMessage) {
        msg = this.config.enhanceMessage(msg);
      }
      this.connection.send(msg);
    };

    /*
      Returns true if websocket connection is open
    */
    this.isConnected = function() {
      return this.connection.isOpen();
    };

    this.dispose = function() {
      this.connection.off(this);
    };
  };

  EventEmitter$1.extend(CollabClient);

  module.exports = CollabClient;

  var EventEmitter$2 = require('../util/EventEmitter');
  var forEach = require('lodash/forEach');
  var map = require('lodash/map');
  var extend = require('lodash/extend');
  var DocumentChange = require('../model/DocumentChange');
  var Selection = require('../model/Selection');
  var Err$2 = require('../util/SubstanceError');

  /*
    Engine for realizing collaborative editing. Implements the server-methods of
    the real time editing as a reusable library.
  */
  function CollabEngine(documentEngine) {
    CollabEngine.super.apply(this);

    this.documentEngine = documentEngine;

    // Active collaborators
    this._collaborators = {};
  }

  CollabEngine.Prototype = function() {

    /*
      Register collaborator for a given documentId
    */
    this._register = function(collaboratorId, documentId, selection, collaboratorInfo) {
      var collaborator = this._collaborators[collaboratorId];

      if (!collaborator) {
        collaborator = this._collaborators[collaboratorId] = {
          collaboratorId: collaboratorId,
          documents: {}
        };
      }

      // Extend with collaboratorInfo if available
      collaborator.info = collaboratorInfo;

      // Register document
      collaborator.documents[documentId] = {
        selection: selection
      };
    };

    /*
      Unregister collaborator id from document
    */
    this._unregister = function(collaboratorId, documentId) {
      var collaborator = this._collaborators[collaboratorId];
      delete collaborator.documents[documentId];
      var docCount = Object.keys(collaborator.documents).length;
      // If there is no doc left, we can remove the entire collaborator entry
      if (docCount === 0) {
        delete this._collaborators[collaboratorId];
      }
    };

    this._updateSelection = function(collaboratorId, documentId, sel) {
      var docEntry = this._collaborators[collaboratorId].documents[documentId];
      docEntry.selection = sel;
    };

    /*
      Get list of active documents for a given collaboratorId
    */
    this.getDocumentIds = function(collaboratorId) {
      var collaborator = this._collaborators[collaboratorId];
      if (!collaborator) {
        // console.log('CollabEngine.getDocumentIds', collaboratorId, 'not found');
        // console.log('CollabEngine._collaborators', this._collaborators);
        return [];
      }
      return Object.keys(collaborator.documents);
    };

    /*
      Get collaborators for a specific document
    */
    this.getCollaborators = function(documentId, collaboratorId) {
      var collaborators = {};
      forEach(this._collaborators, function(collab) {
        var doc = collab.documents[documentId];
        if (doc && collab.collaboratorId !== collaboratorId) {
          var entry = {
            selection: doc.selection,
            collaboratorId: collab.collaboratorId
          };
          entry = extend({}, collab.info, entry);
          collaborators[collab.collaboratorId] = entry;
        }
      });
      return collaborators;
    };

    /*
      Get only collaborator ids for a specific document
    */
    this.getCollaboratorIds = function(documentId, collaboratorId) {
      var collaborators = this.getCollaborators(documentId, collaboratorId);
      return map(collaborators, function(c) {
        return c.collaboratorId;
      });
    };

    /*
      Client starts a sync

      @param args.documentId
      @param args.version The client's document version (0 if client starts with an empty doc)
      @param args.change pending client change

      Note: a client can reconnect having a pending change
      which is similar to the commit case
    */
    this.sync = function(args, cb) {
      // We now always get a change since the selection should be considered
      this._sync(args, function(err, result) {
        if (err) return cb(err);
        // Registers the collaborator If not already registered for that document
        this._register(args.collaboratorId, args.documentId, result.change.after.selection, args.collaboratorInfo);
        cb(null, result);
      }.bind(this));
    };

    /*
      Internal implementation of sync

      @param {String} args.collaboratorId collaboratorId
      @param {String} args.documentId document id
      @param {Number} args.version client version
      @param {Number} args.change new change

      OUT: version, changes, version
    */
    this._sync = function(args, cb) {
      // Get latest doc version
      this.documentEngine.getVersion(args.documentId, function(err, serverVersion) {
        if (serverVersion === args.version) { // Fast forward update
          this._syncFF(args, cb);
        } else if (serverVersion > args.version) { // Client changes need to be rebased to latest serverVersion
          this._syncRB(args, cb);
        } else {
          cb(new Err$2('InvalidVersionError', {
            message: 'Client version greater than server version'
          }));
        }
      }.bind(this));
    };

    /*
      Update all collaborators selections of a document according to a given change

      WARNING: This has not been tested quite well
    */
    this._updateCollaboratorSelections = function(documentId, change) {
      // By not providing the 2nd argument to getCollaborators the change
      // creator is also included.
      var collaborators = this.getCollaborators(documentId);

      forEach(collaborators, function(collaborator) {
        if (collaborator.selection) {
          var sel = Selection.fromJSON(collaborator.selection);
          change = this.deserializeChange(change);
          sel = DocumentChange.transformSelection(sel, change);
          // Write back the transformed selection to the server state
          this._updateSelection(collaborator.collaboratorId, documentId, sel.toJSON());
        }
      }.bind(this));
    };

    /*
      Fast forward sync (client version = server version)
    */
    this._syncFF = function(args, cb) {
      this._updateCollaboratorSelections(args.documentId, args.change);

      // HACK: On connect we may receive a nop that only has selection data.
      // We don't want to store such changes.
      // TODO: it would be nice if we could handle this in a different
      // branch of connect, so we don't spoil the commit implementation
      if (args.change.ops.length === 0) {
        return cb(null, {
          change: args.change,
          // changes: [],
          serverChange: null,
          version: args.version
        });
      }

      // Store the commit
      this.documentEngine.addChange({
        documentId: args.documentId,
        change: args.change,
        documentInfo: args.documentInfo
      }, function(err, serverVersion) {
        if (err) return cb(err);
        cb(null, {
          change: args.change, // collaborators must be notified
          serverChange: null,
          // changes: [], // no changes missed in fast-forward scenario
          version: serverVersion
        });
      });
    };

    /*
      Rebased sync (client version < server version)
    */
    this._syncRB = function(args, cb) {
      this._rebaseChange({
        documentId: args.documentId,
        change: args.change,
        version: args.version
      }, function(err, rebased) {
        // result has change, changes, version (serverversion)
        if (err) return cb(err);

        this._updateCollaboratorSelections(args.documentId, rebased.change);

        // HACK: On connect we may receive a nop that only has selection data.
        // We don't want to store such changes.
        // TODO: it would be nice if we could handle this in a different
        // branch of connect, so we don't spoil the commit implementation
        if (args.change.ops.length === 0) {
          return cb(null, {
            change: rebased.change,
            serverChange: rebased.serverChange,
            version: rebased.version
          });
        }

        // Store the rebased commit
        this.documentEngine.addChange({
          documentId: args.documentId,
          change: rebased.change, // rebased change
          documentInfo: args.documentInfo
        }, function(err, serverVersion) {
          if (err) return cb(err);
          cb(null, {
            change: rebased.change,
            serverChange: rebased.serverChange, // collaborators must be notified
            version: serverVersion
          });
        });
      }.bind(this));
    };

    /*
      Rebase change

      IN: documentId, change, version (change version)
      OUT: change, changes (server changes), version (server version)
    */
    this._rebaseChange = function(args, cb) {
      this.documentEngine.getChanges({
        documentId: args.documentId,
        sinceVersion: args.version
      }, function(err, result) {
        var B = result.changes.map(this.deserializeChange);
        var a = this.deserializeChange(args.change);
        // transform changes
        DocumentChange.transformInplace(a, B);
        var ops = B.reduce(function(ops, change) {
          return ops.concat(change.ops);
        }, []);
        var serverChange = new DocumentChange(ops, {}, {});

        cb(null, {
          change: this.serializeChange(a),
          serverChange: this.serializeChange(serverChange),
          version: result.version
        });
      }.bind(this));
    };

    /*
      Collaborator leaves a document editing session

      NOTE: This method is synchronous
    */
    this.disconnect = function(args) {
      this._unregister(args.collaboratorId, args.documentId);
    };

    /*
      To JSON
    */
    this.serializeChange = function(change) {
      return change.toJSON();
    };

    /*
      From JSON
    */
    this.deserializeChange = function(serializedChange) {
      var ch = DocumentChange.fromJSON(serializedChange);
      return ch;
    };

  };

  EventEmitter$2.extend(CollabEngine);

  module.exports = CollabEngine;

  var Server = require('./Server');
  var CollabEngine$1 = require('./CollabEngine');
  var Err$3 = require('../util/SubstanceError');
  var forEach$1 = require('lodash/forEach');

  /*
    Implements Substance CollabServer API.
  */
  function CollabServer(config) {
    CollabServer.super.apply(this, arguments);

    this.scope = 'substance/collab';
    this.documentEngine = config.documentEngine;
    this.collabEngine = new CollabEngine$1(this.documentEngine);
  }

  CollabServer.Prototype = function() {
    var _super = CollabServer.super.prototype;

    /*
      Send an error
    */
    this._error = function(req, res, err) {
      res.error({
        type: 'error',
        error: {
          name: req.message.type+'Error',
          cause: {
            name: err.name
          }
        },
        // errorName: err.name,
        documentId: req.message.documentId
      });
      this.next(req, res);
    };

    /*
      Configurable authenticate method
    */
    this.authenticate = function(req, res) {
      if (this.config.authenticate) {
        this.config.authenticate(req, function(err, session) {
          if (err) {
            console.error(err);
            // Send the response with some delay
            this._error(req, res, new Err$3('AuthenticationError', {cause: err}));
            return;
          }
          req.setAuthenticated(session);
          this.next(req, res);
        }.bind(this));
      } else {
        _super.authenticate.apply(this, arguments);
      }
    };

    /*
      Configureable enhanceRequest method
    */
    this.enhanceRequest = function(req, res) {
      if (this.config.enhanceRequest) {
        this.config.enhanceRequest(req, function(err) {
          if (err) {
            console.error('enhanceRequest returned an error', err);
            this._error(req, res, err);
            return;
          }
          req.setEnhanced();
          this.next(req, res);
        }.bind(this));
      } else {
        _super.enhanceRequest.apply(this, arguments);
      }
    };

    /*
      Called when a collaborator disconnects
    */
    this.onDisconnect = function(collaboratorId) {
      // console.log('CollabServer.onDisconnect ', collaboratorId);
      // All documents collaborator is currently collaborating to
      var documentIds = this.collabEngine.getDocumentIds(collaboratorId);
      documentIds.forEach(function(documentId) {
        this._disconnectDocument(collaboratorId, documentId);
      }.bind(this));
    };

    /*
      Execute CollabServer API method based on msg.type
    */
    this.execute = function(req, res) {
      var msg = req.message;
      var method = this[msg.type];

      if (method) {
        method.call(this, req, res);
      } else {
        console.error('Method', msg.type, 'not implemented for CollabServer');
      }
    };

    /*
      Client initiates a sync
    */
    this.sync = function(req, res) {
      var args = req.message;

      // console.log('CollabServer.connect', args.collaboratorId);

      // Takes an optional argument collaboratorInfo
      this.collabEngine.sync(args, function(err, result) {
        // result: changes, version, change
        if (err) {
          this._error(req, res, err);
          return;
        }

        // Get enhance collaborators (e.g. including some app-specific user-info)
        var collaborators = this.collabEngine.getCollaborators(args.documentId, args.collaboratorId);

        // Send the response
        res.send({
          scope: this.scope,
          type: 'syncDone',
          documentId: args.documentId,
          version: result.version,
          serverChange: result.serverChange,
          collaborators: collaborators
        });

        // We need to broadcast a new change if there is one
        // console.log('CollabServer.connect: update is broadcasted to collaborators', Object.keys(collaborators));
        forEach$1(collaborators, function(collaborator) {
          this.send(collaborator.collaboratorId, {
            scope: this.scope,
            type: 'update',
            documentId: args.documentId,
            version: result.version,
            change: result.change,
            // collaboratorId: args.collaboratorId,
            // All except of receiver record
            collaborators: this.collabEngine.getCollaborators(args.documentId, collaborator.collaboratorId)
          });
        }.bind(this));
        this.next(req, res);
      }.bind(this));
    };

    /*
      Expcicit disconnect. User wants to exit a collab session.
    */
    this.disconnect = function(req, res) {
      var args = req.message;
      var collaboratorId = args.collaboratorId;
      var documentId = args.documentId;
      this._disconnectDocument(collaboratorId, documentId);
      // Notify client that disconnect has completed successfully
      res.send({
        scope: this.scope,
        type: 'disconnectDone',
        documentId: args.documentId
      });
      this.next(req, res);
    };

    this._disconnectDocument = function(collaboratorId, documentId) {
      var collaboratorIds = this.collabEngine.getCollaboratorIds(documentId, collaboratorId);

      var collaborators = {};
      collaborators[collaboratorId] = null;

      this.broadCast(collaboratorIds, {
        type: 'update',
        documentId: documentId,
        // Removes the entry
        collaborators: collaborators
      });
      // Exit from each document session
      this.collabEngine.disconnect({
        documentId: documentId,
        collaboratorId: collaboratorId
      });
    };

  };

  Server.extend(CollabServer);
  module.exports = CollabServer;

  var debounce = require('lodash/debounce');
  var forEach$2 = require('lodash/forEach');
  var clone = require('lodash/clone');
  var cloneDeep = require('lodash/cloneDeep');
  var Err$4 = require('../util/SubstanceError');
  var DocumentSession = require('../model/DocumentSession');
  var DocumentChange$1 = require('../model/DocumentChange');
  var Selection$1 = require('../model/Selection');

  /*
    Session that is connected to a Substance Hub allowing
    collaboration in real-time.

    Requires a connected and authenticated collabClient.
  */
  function CollabSession(doc, config) {
    CollabSession.super.call(this, doc, config);

    config = config || {};
    this.config = config;
    this.collabClient = config.collabClient;

    if (config.docVersion) {
      console.warn('config.docVersion is deprecated: Use config.version instead');
    }

    if (config.docVersion) {
      console.warn('config.docId is deprecated: Use config.documentId instead');
    }

    this.version = config.version || config.docVersion;
    this.documentId = config.documentId || config.docId;

    if (config.autoSync !== undefined) {
      this.autoSync = config.autoSync;
    } else {
      this.autoSync = true;
    }

    if (!this.documentId) {
      throw new Err$4('InvalidArgumentsError', {message: 'documentId is mandatory'});
    }

    if (!this.version) {
      throw new Err$4('InvalidArgumentsError', {message: 'version is mandatory'});
    }

    // Internal state
    this._connected = false; // gets flipped to true in syncDone
    this._nextChange = null; // next change to be sent over the wire
    this._pendingChange = null; // change that is currently being synced
    this._error = null;

    // Note: registering a second document:changed handler where we trigger sync requests
    this.doc.on('document:changed', this.afterDocumentChange, this, {priority: -10});

    // Bind handlers
    this._broadCastSelectionUpdateDebounced = debounce(this._broadCastSelectionUpdate, 250);

    // Keep track of collaborators in a session
    this.collaborators = {};

    // This happens on a reconnect
    this.collabClient.on('connected', this.onCollabClientConnected, this);
    this.collabClient.on('disconnected', this.onCollabClientDisconnected, this);

    // Constraints used for computing color indexes
    this.__maxColors = 5;
    this.__nextColorIndex = 0;
    this.collabClient.on('message', this._onMessage.bind(this));

    // Attempt to open a document immediately, but only if the collabClient is
    // already connected. If not the _onConnected handler will take care of it
    // once websocket connection is ready.
    if (this.collabClient.isConnected() && this.autoSync) {
      this.sync();
    }
  }

  CollabSession.Prototype = function() {

    var _super = CollabSession.super.prototype;

    /*
      Unregister event handlers. Call this before throw away
      a CollabSession reference. Otherwise you will leak memory
    */
    this.dispose = function() {
      this.disconnect();
      this.collabClient.off(this);
    };

    /*
      Explicit disconnect initiated by user
    */
    this.disconnect = function() {
      // Let the server know we no longer want to edit this document
      var msg = {
        type: 'disconnect',
        documentId: this.documentId
      };

      // We abort pening syncs
      this._abortSync();
      this._send(msg);
    };

    /*
      Synchronize with collab server
    */
    this.sync = function() {

      // If there is something to sync and there is no running sync
      if (this.__canSync()) {
        var nextChange = this._getNextChange();
        var msg = {
          type: 'sync',
          documentId: this.documentId,
          version: this.version,
          change: this.serializeChange(nextChange)
        };

        this._send(msg);
        this._pendingChange = nextChange;
        // Can be used to reset errors that arised from previous syncs.
        // When a new sync is started, users can use this event to unset the error
        this.emit('sync');
        this._nextChange = null;
        this._error = null;
      } else {
        console.error('Can not sync. Either collabClient is not connected or we are already syncing');
      }
    };

    /*
      When selection is changed explicitly by the user we broadcast
      that update to other collaborators
    */
    this.setSelection = function(sel) {
      // We just remember beforeSel on the CollabSession (need for connect use-case)
      var beforeSel = this.selection;
      _super.setSelection.call(this, sel);
      this._broadCastSelectionUpdateDebounced(beforeSel, sel);
    };

    this.getCollaborators = function() {
      return this.collaborators;
    };

    this.isConnected = function() {
      return this._connected;
    };


    this.serializeChange = function(change) {
      return change.toJSON();
    };

    this.deserializeChange = function(serializedChange) {
      return DocumentChange$1.fromJSON(serializedChange);
    };

    /* Message handlers
       ================ */

    /*
      Dispatching of remote messages.
    */
    this._onMessage = function(msg) {
      // Skip if message is not addressing this document
      if (msg.documentId !== this.documentId) {
        return false;
      }
      // clone the msg to make sure that the original does not get altered
      msg = cloneDeep(msg);
      switch (msg.type) {
        case 'syncDone':
          this.syncDone(msg);
          break;
        case 'syncError':
          this.syncError(msg);
          break;
        case 'update':
          this.update(msg);
          break;
        case 'disconnectDone':
          this.disconnectDone(msg);
          break;
        case 'error':
          this.error(msg);
          break;
        default:
          console.error('CollabSession: unsupported message', msg.type, msg);
          return false;
      }
      return true;
    };

    /*
      Send message

      Returns true if sent, false if not sent (e.g. when not connected)
    */
    this._send = function(msg) {
      if (this.collabClient.isConnected()) {
        this.collabClient.send(msg);
        return true;
      } else {
        console.warn('Try not to call _send when disconnected. Skipping message', msg);
        return false;
      }
    };

    /*
      Apply remote update

      We receive an update from the server. We only apply the remote change if
      there's no pending commit. applyRemoteUpdate is also called for selection
      updates.

      If we are currently in the middle of a sync or have local changes we just
      ignore the update. We will receive all server updates on the next syncDone.
    */
    this.update = function(args) {
      // console.log('CollabSession.update(): received remote update', args);
      var serverChange = args.change;
      var collaborators = args.collaborators;
      var serverVersion = args.version;

      if (!this._nextChange && !this._pendingChange) {
        var oldSelection = this.selection;
        if (serverChange) {
          serverChange = this.deserializeChange(serverChange);
          this._applyRemoteChange(serverChange);
        }
        var newSelection = this.selection;
        if (serverVersion) {
          this.version = serverVersion;
        }
        var update = {
          change: serverChange
        };
        if (newSelection !== oldSelection) {
          update.selection = newSelection;
        }
        // collaboratorsChange only contains information about
        // changed collaborators
        var collaboratorsChange = this._updateCollaborators(collaborators);
        if (collaboratorsChange) {
          update.collaborators = collaboratorsChange;
        }
        this._triggerUpdateEvent(update, { remote: true });
      }
    };

    /*
      Sync has completed

      We apply server changes that happened in the meanwhile and we update
      the collaborators (=selections etc.)
    */
    this.syncDone = function(args) {
      var serverChange = args.serverChange;
      var collaborators = args.collaborators;
      var serverVersion = args.version;

      if (serverChange) {
        serverChange = this.deserializeChange(serverChange);
        this._applyRemoteChange(serverChange);
      }
      this.version = serverVersion;

      // Only apply updated collaborators if there are no local changes
      // Otherwise they will not be accurate. We can safely skip this
      // here as we know the next sync will be triggered soon. And if
      // followed by an idle phase (_nextChange = null) will give us
      // the latest collaborator records
      var collaboratorsChange = this._updateCollaborators(collaborators);
      if (this._nextChange) {
        this._transformCollaboratorSelections(this._nextChange);
      }

      // Important: after sync is done we need to reset _pendingChange and _error
      // In this state we can safely listen to
      this._pendingChange = null;
      this._error = null;

      // Each time the sync worked we consider the system connected
      this._connected = true;

      var update = {
        change: serverChange
      };
      if (collaboratorsChange) {
        update.collaborators = collaboratorsChange;
      }
      this._triggerUpdateEvent(update, { remote: true });

      this.emit('connected');
      // Attempt to sync again (maybe we have new local changes)
      this._requestSync();
    };

    /*
      Handle sync error
    */
    this.syncError = function(error) {
      error('Sync error:', error);
      this._abortSync();
    };

    this.disconnectDone = function() {
      // console.log('disconnect done');
      // Let the server know we no longer want to edit this document
      this._afterDisconnected();
    };

    /*
      Handle errors. This gets called if any request produced
      an error on the server.
    */

    this.error = function(message) {
      var error = message.error;
      var errorFn = this[error.name];
      var err = Err$4.fromJSON(error);

      if (!errorFn) {
        error('CollabSession: unsupported error', error.name);
        return false;
      }

      this.emit('error', err);
      errorFn = errorFn.bind(this);
      errorFn(err);
    };


    /* Event handlers
       ============== */

    this.afterDocumentChange = function(change, info) {
      // Record local changes into nextCommit
      if (!info.remote) {
        this._recordChange(change);
      }
    };

    /*
      A new authenticated collabClient connection is available.

      This happens in a reconnect scenario.
    */
    this.onCollabClientConnected = function() {
      // console.log('CollabClient connected');
      if (this.autoSync) {
        this.sync();
      }
    };

    /*
      Implicit disconnect (server connection drop out)
    */
    this.onCollabClientDisconnected = function() {
      // console.log('CollabClient disconnected');
      this._abortSync();
      if (this._connected) {
        this._afterDisconnected();
      }
    };

    /* Internal methods
       ================ */

    this._commit = function(change, info) {
      var selectionHasChanged = this._commitChange(change);

      var collaboratorsChange = null;
      forEach$2(this.getCollaborators(), function(collaborator) {
        // transform local version of collaborator selection
        var id = collaborator.collaboratorId;
        var oldSelection = collaborator.selection;
        var newSelection = DocumentChange$1.transformSelection(oldSelection, change);
        if (oldSelection !== newSelection) {
          collaboratorsChange = collaboratorsChange || {};
          collaborator = clone(collaborator);
          collaborator.selection = newSelection;
          collaboratorsChange[id] = collaborator;
        }
      });

      var update = {
        change: change
      };
      if (selectionHasChanged) {
        update.selection = this.selection;
      }
      if (collaboratorsChange) {
        update.collaborators = collaboratorsChange;
      }
      this._triggerUpdateEvent(update, info);
    };

    /*
      Apply a change to the document
    */
    this._applyRemoteChange = function(change) {
      // console.log('CollabSession: applying remote change');
      if (change.ops.length > 0) {
        this.stage._apply(change);
        this.doc._apply(change);
        // Only undo+redo history is updated according to the new change
        this._transformLocalChangeHistory(change);
        this.selection = this._transformSelection(change);
      }
    };

    /*
      We record all local changes into a single change (aka commit) that
    */
    this._recordChange = function(change) {
      if (!this._nextChange) {
        this._nextChange = change;
      } else {
        // Merge new change into nextCommit
        this._nextChange.ops = this._nextChange.ops.concat(change.ops);
        this._nextChange.after = change.after;
      }
      this._requestSync();
    };

    /*
      Get next change for sync.

      If there are no local changes we create a change that only
      holds the current selection.
    */
    this._getNextChange = function() {
      var nextChange = this._nextChange;
      if (!nextChange) {
        // Change only holds the current selection
        nextChange = this._getChangeForSelection(this.selection, this.selection);
      }
      return nextChange;
    };

    /*
      Send selection update to other collaborators
    */
    this._broadCastSelectionUpdate = function(beforeSel, afterSel) {
      if (this._nextChange) {
        this._nextChange.after.selection = afterSel;
      } else {
        this._nextChange = this._getChangeForSelection(beforeSel, afterSel);
      }
      this._requestSync();
    };

    this.__canSync = function() {
      return this.collabClient.isConnected() && !this._pendingChange;
    };

    /*
      Triggers a new sync if there is a new change and no pending sync
    */
    this._requestSync = function() {
      if (this._nextChange && this.__canSync()) {
        this.sync();
      }
    };

    /*
      Abots the currently running sync.

      This is called _onDisconnect and could be called after a sync request
      times out (not yet implemented)
    */
    this._abortSync = function() {
      var newNextChange = this._nextChange;

      if (this._pendingChange) {
        newNextChange = this._pendingChange;
        // If we have local changes also, we append them to the new nextChange
        if (this._nextChange) {
          newNextChange.ops = newNextChange.ops.concat(this._nextChange.ops);
          newNextChange.after = this._nextChange.after;
        }
        this._pendingChange = null;
      }
      this._error = null;
      this._nextChange = newNextChange;
    };

    this._transformCollaboratorSelections = function(change) {
      // console.log('Transforming selection...', this.__id__);
      // Transform the selection
      var collaborators = this.getCollaborators();
      if (collaborators) {
        forEach$2(collaborators, function(collaborator) {
          DocumentChange$1.transformSelection(collaborator.selection, change);
        });
      }
    };

    this._updateCollaborators = function(collaborators) {
      var collaboratorsChange = {};

      forEach$2(collaborators, function(collaborator, collaboratorId) {
        if (collaborator) {
          var oldSelection;
          var old = this.collaborators[collaboratorId];
          if (old) {
            oldSelection = old.selection;
          }
          var newSelection = Selection$1.fromJSON(collaborator.selection);
          newSelection.attach(this.doc);

          // Assign colorIndex (try to restore from old record)
          collaborator.colorIndex = old ? old.colorIndex : this._getNextColorIndex();
          collaborator.selection = newSelection;
          this.collaborators[collaboratorId] = collaborator;
          if (!newSelection.equals(oldSelection)) {
            collaboratorsChange[collaboratorId] = collaborator;
          }
        } else {
          collaboratorsChange[collaboratorId] = null;
          delete this.collaborators[collaboratorId];
        }
      }.bind(this));

      if (Object.keys(collaboratorsChange).length>0) {
        return collaboratorsChange;
      }
    };

    /*
      Sets the correct state after a collab session has been disconnected
      either explicitly or triggered by a connection drop out.
    */
    this._afterDisconnected = function() {
      var oldCollaborators = this.collaborators;
      this.collaborators = {};
      var collaboratorIds = Object.keys(oldCollaborators);
      if (collaboratorIds.length > 0) {
        var collaboratorsChange = {};
        // when this user disconnects we will need to remove all rendered collaborator infos (such as selection)
        collaboratorIds.forEach(function(collaboratorId) {
          collaboratorsChange[collaboratorId] = null;
        });
        this._triggerUpdateEvent({
          collaborators: collaboratorsChange
        });
      }
      this._connected = false;
      this.emit('disconnected');
    };

    /*
      Takes beforeSel + afterSel and wraps it in a no-op DocumentChange
    */
    this._getChangeForSelection = function(beforeSel, afterSel) {
      var change = new DocumentChange$1([], {
        selection: beforeSel
      }, {
        selection: afterSel
      });
      return change;
    };

    /*
      Returns true if there are local changes
    */
    this._hasLocalChanges = function() {
      return this._nextChange && this._nextChange.ops.length > 0;
    };

    /*
      Get color index for rendering cursors and selections in round robin style.
      Note: This implementation considers a configured maxColors value. The
      first color will be reused as more then maxColors collaborators arrive.
    */
    this._getNextColorIndex = function() {
      var colorIndex = this.__nextColorIndex;
      this.__nextColorIndex = (this.__nextColorIndex + 1) % this.__maxColors;
      return colorIndex + 1; // so we can 1..5 instead of 0..4
    };

  };

  DocumentSession.extend(CollabSession);

  module.exports = CollabSession;

  var oo$1 = require('../util/oo');
  var request = require('../util/request');

  /*
    HTTP client for talking with DocumentServer
  */
  function DocumentClient(config) {
    this.config = config;
  }

  DocumentClient.Prototype = function() {

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
      request('POST', this.config.httpUrl, newDocument, cb);
    };

    /*
      Get a document from the server

      @example

      ```js
      documentClient.getDocument('mydoc-id');
      ```
    */

    this.getDocument = function(documentId, cb) {
      request('GET', this.config.httpUrl+documentId, null, cb);
    };

    /*
      Remove a document from the server

      @example

      ```js
      documentClient.deleteDocument('mydoc-id');
      ```
    */

    this.deleteDocument = function(documentId, cb) {
      request('DELETE', this.config.httpUrl+documentId, null, cb);
    };

  };

  oo$1.initClass(DocumentClient);

  module.exports = DocumentClient;

  var EventEmitter$3 = require('../util/EventEmitter');
  var JSONConverter = require('../model/JSONConverter');
  var Err$5 = require('../util/SubstanceError');
  var SnapshotEngine = require('./SnapshotEngine');

  /*
    DocumentEngine
  */
  function DocumentEngine(config) {
    DocumentEngine.super.apply(this);

    this.schemas = config.schemas;

    // Where changes are stored
    this.documentStore = config.documentStore;
    this.changeStore = config.changeStore;

    // SnapshotEngine instance is required
    this.snapshotEngine = config.snapshotEngine || new SnapshotEngine({
      schemas: this.schemas,
      documentStore: this.documentStore,
      changeStore: this.changeStore
    });
  }

  DocumentEngine.Prototype = function() {

    /*
      Creates a new empty or prefilled document

      Writes the initial change into the database.
      Returns the JSON serialized version, as a starting point
    */
    this.createDocument = function(args, cb) {
      // TODO: schema is propbably not a good name here
      // as it is a record containing a schema, and a factory
      // providing an empty document
      var schemaConfig = this.schemas[args.schemaName];
      if (!schemaConfig) {
        return cb(new Err$5('SchemaNotFoundError', {
          message: 'Schema not found for ' + args.schemaName
        }));
      }

      var docFactory = schemaConfig.documentFactory;
      var doc = docFactory.createDocument();

      // TODO: I have the feeling that this is the wrong approach.
      // While in our tests we have seeds I don't think that this is a general pattern.
      // A vanilla document should be just empty, or just have what its constructor
      // is creating.
      // To create some initial content, we should use the editor,
      // e.g. an automated script running after creating the document.
      // var change = docFactory.createChangeset()[0];

      // HACK: we use the info object for the change as well, however
      // we should be able to control this separately.
      // change.info = args.info;

      this.documentStore.createDocument({
        schemaName: schemaConfig.name,
        schemaVersion: schemaConfig.version,
        documentId: args.documentId,
        version: 1, // we always start with version 1
        info: args.info
      }, function(err, docRecord) {
        if (err) {
          return cb(new Err$5('CreateError', {
            cause: err
          }));
        }

        // this.changeStore.addChange({
        //   documentId: docRecord.documentId,
        //   change: change
        // }, function(err) {
        //   if (err) {
        //     return cb(new Err('CreateError', {
        //       cause: err
        //     }));
        //   }
        //   var converter = new JSONConverter();
        //   cb(null, {
        //     documentId: docRecord.documentId,
        //     data: converter.exportDocument(doc),
        //     version: 1
        //   });
        // });
        var converter = new JSONConverter();
        cb(null, {
          documentId: docRecord.documentId,
          data: converter.exportDocument(doc),
          version: 1
        });
      }.bind(this)); //eslint-disable-line
    };

    /*
      Get a document snapshot.

      @param args.documentId
      @param args.version
    */
    this.getDocument = function(args, cb) {
      this.snapshotEngine.getSnapshot(args, cb);
    };

    /*
      Delete document by documentId
    */
    this.deleteDocument = function(documentId, cb) {
      this.changeStore.deleteChanges(documentId, function(err) {
        if (err) {
          return cb(new Err$5('DeleteError', {
            cause: err
          }));
        }
        this.documentStore.deleteDocument(documentId, function(err, doc) {
          if (err) {
            return cb(new Err$5('DeleteError', {
              cause: err
            }));
          }
          cb(null, doc);
        });
      }.bind(this));
    };

    /*
      Check if a given document exists
    */
    this.documentExists = function(documentId, cb) {
      this.documentStore.documentExists(documentId, cb);
    };

    /*
      Get changes based on documentId, sinceVersion
    */
    this.getChanges = function(args, cb) {
      this.documentExists(args.documentId, function(err, exists) {
        if (err || !exists) {
          return cb(new Err$5('ReadError', {
            message: !exists ? 'Document does not exist' : null,
            cause: err
          }));
        }
        this.changeStore.getChanges(args, cb);
      }.bind(this));
    };

    /*
      Get version for given documentId
    */
    this.getVersion = function(documentId, cb) {
      this.documentExists(documentId, function(err, exists) {
        if (err || !exists) {
          return cb(new Err$5('ReadError', {
            message: !exists ? 'Document does not exist' : null,
            cause: err
          }));
        }
        this.changeStore.getVersion(documentId, cb);
      }.bind(this));
    };

    /*
      Add change to a given documentId

      args: documentId, change [, documentInfo]
    */
    this.addChange = function(args, cb) {
      this.documentExists(args.documentId, function(err, exists) {
        if (err || !exists) {
          return cb(new Err$5('ReadError', {
            message: !exists ? 'Document does not exist' : null,
            cause: err
          }));
        }
        this.changeStore.addChange(args, function(err, newVersion) {
          if (err) return cb(err);
          // We write the new version to the document store.
          this.documentStore.updateDocument(args.documentId, {
            version: newVersion,
            // Store custom documentInfo
            info: args.documentInfo
          }, function(err) {
            if (err) return cb(err);
            this.snapshotEngine.requestSnapshot(args.documentId, function() {
              // no matter if errored or not we will complete the addChange
              // successfully
              cb(null, newVersion);
            });
          }.bind(this));
        }.bind(this));
      }.bind(this));
    };

  };

  EventEmitter$3.extend(DocumentEngine);

  module.exports = DocumentEngine;

  var oo$2 = require('../util/oo');

  /*
    DocumentServer module. Can be bound to an express instance
  */
  function DocumentServer(config) {
    this.engine = config.documentEngine;
    this.path = config.path;
  }

  DocumentServer.Prototype = function() {

    /*
      Attach this server to an express instance
    */
    this.bind = function(app) {
      app.post(this.path, this._createDocument.bind(this));
      app.get(this.path + '/:id', this._getDocument.bind(this));
      app.delete(this.path + '/:id', this._deleteDocument.bind(this));
    };

    /*
      Create a new document, given a schemaName and schemaVersion
    */
    this._createDocument = function(req, res, next) {
      var args = req.body;
      var newDoc = {
        schemaName: args.schemaName, // e.g. prose-article
        info: args.info // optional
      };

      this.engine.createDocument(newDoc, function(err, result) {
        if (err) return next(err);
        res.json(result);
      });
    };

    /*
      Get a document with given document id
    */
    this._getDocument = function(req, res, next) {
      var documentId = req.params.id;
      this.engine.getDocument({
        documentId: documentId
      }, function(err, result) {
        if (err) return next(err);
        res.json(result);
      });
    };

    /*
      Remove a document with given document id
    */
    this._deleteDocument = function(req, res, next) {
      var documentId = req.params.id;
      this.engine.deleteDocument(documentId, function(err, result) {
        if (err) return next(err);
        res.json(result);
      });
    };
  };

  oo$2.initClass(DocumentServer);
  module.exports = DocumentServer;

  var oo$3 = require('../util/oo');
  var extend$1 = require('lodash/extend');
  var Err$6 = require('../util/SubstanceError');
  var uuid = require('../util/uuid');

  /*
    Implements Substance DocumentStore API. This is just a dumb store.
    No integrity checks are made, as this is the task of DocumentEngine
  */
  function DocumentStore(config) {
    this.config = config;
  }

  DocumentStore.Prototype = function() {

    /*
      Create a new document record

      @return {Object} document record
    */
    this.createDocument = function(props, cb) {

      if (!props.documentId) {
        // We generate a documentId ourselves
        props.documentId = uuid();
      }

      var exists = this._documentExists(props.documentId);
      if (exists) {
        return cb(new Err$6('DocumentStore.CreateError', {
          message: 'Could not create because document already exists.'
        }));
      }
      this._createDocument(props);
      cb(null, this._getDocument(props.documentId));
    };

    /*
      Get document by documentId
    */
    this.getDocument = function(documentId, cb) {
      var doc = this._getDocument(documentId);
      if (!doc) {
        return cb(new Err$6('DocumentStore.ReadError', {
          message: 'Document could not be found.'
        }));
      }
      cb(null, doc);
    };

    /*
      Update document record
    */
    this.updateDocument = function(documentId, newProps, cb) {
      var exists = this._documentExists(documentId);
      if (!exists) {
        return cb(new Err$6('DocumentStore.UpdateError', {
          message: 'Document does not exist.'
        }));
      }
      this._updateDocument(documentId, newProps);
      cb(null, this._getDocument(documentId));
    };

    /*
      Delete document
    */
    this.deleteDocument = function(documentId, cb) {
      var doc = this._getDocument(documentId);
      if (!doc) {
        return cb(new Err$6('DocumentStore.DeleteError', {
          message: 'Document does not exist.'
        }));
      }
      this._deleteDocument(documentId);
      cb(null, doc);
    };

    /*
      Returns true if changeset exists
    */
    this.documentExists = function(documentId, cb) {
      cb(null, this._documentExists(documentId));
    };

    /*
      Seeds the database
    */
    this.seed = function(documents, cb) {
      this._documents = documents;
      if (cb) { cb(null); }
      return this;
    };

    // Handy synchronous helpers
    // -------------------------

    this._createDocument = function(props) {
      this._documents[props.documentId] = props;
    };

    this._deleteDocument = function(documentId) {
      delete this._documents[documentId];
    };

    // Get document record
    this._getDocument = function(documentId) {
      return this._documents[documentId];
    };

    this._updateDocument = function(documentId, props) {
      var doc = this._documents[documentId];
      extend$1(doc, props);
    };

    this._documentExists = function(documentId) {
      return Boolean(this._documents[documentId]);
    };
  };


  oo$3.initClass(DocumentStore);
  module.exports = DocumentStore;

  /* global WeakMap */

  var oo$4 = require('../util/oo');
  var uuid$1 = require('../util/uuid');
  var EventEmitter$4 = require('../util/EventEmitter');

  /**
    Server

    Implements a generic layered architecture
  */
  function Server$1(config) {
    Server$1.super.apply(this);

    this.config = config;
    this._onConnection = this._onConnection.bind(this);
  }

  Server$1.Prototype = function() {

    this.bind = function(wss) {
      if (this.wss) {
        throw new Error('Server is already bound to a websocket');
      }
      this.wss = wss;
      this._connections = new WeakMap();
      this._collaborators = {};
      this.wss.on('connection', this._onConnection);

      var interval = this.config.heartbeat;
      if (interval) {
        this._heartbeat = setInterval(this._sendHeartbeat.bind(this), interval);
      }
      this._bound = true;
    };

    /*
      NOTE: This method is yet untested
    */
    this.unbind = function() {
      if (this._bound) {
        this.wss.off('connection', this._onConnection);
      } else {
        throw new Error('Server is not yet bound to a websocket.');
      }
    };

    /*
      Hook called when a collaborator connects
    */
    this.onConnection = function(/*collaboratorId*/) {
      // noop
    };

    /*
      Hook called when a collaborator disconnects
    */
    this.onDisconnect = function(/*collaboratorId*/) {
      // noop
    };

    /*
      Stub implementation for authenticate middleware.

      Implement your own as a hook
    */
    this.authenticate = function(req, res) {
      req.setAuthenticated();
      this.next(req, res);
    };

    /*
      Stub implementation for authorize middleware

      Implement your own as a hook
    */
    this.authorize = function(req, res) {
      req.setAuthorized();
      this.next(req, res);
    };


    /*
      Ability to enrich the request data
    */
    this.enhanceRequest = function(req, res) {
      req.setEnhanced();
      this.next(req, res);
    };

    /*
      Executes the API according to the message type

      Implement your own as a hook
    */
    this.execute = function(/*req, res*/) {
      throw new Error('This method needs to be specified');
    };

    /*
      Ability to enrich the response data
    */
    this.enhanceResponse = function(req, res) {
      res.setEnhanced();
      this.next(req, res);
    };

    /*
      When a new collaborator connects we generate a unique id for them
    */
    this._onConnection = function(ws) {
      var collaboratorId = uuid$1();
      var connection = {
        collaboratorId: collaboratorId
      };
      this._connections.set(ws, connection);

      // Mapping to find connection for collaboratorId
      this._collaborators[collaboratorId] = {
        connection: ws
      };

      ws.on('message', this._onMessage.bind(this, ws));
      ws.on('close', this._onClose.bind(this, ws));
    };

    /*
      When websocket connection closes
    */
    this._onClose = function(ws) {
      var conn = this._connections.get(ws);
      var collaboratorId = conn.collaboratorId;

      this.onDisconnect(collaboratorId);

      // Remove the connection records
      delete this._collaborators[collaboratorId];
      this._connections.delete(ws);
    };

    /*
      Implements state machine for handling the request response cycle

      __initial -        > authenticated      -> __authenticated, __error
      __authenticated   -> authorize          -> __authorized, __error
      __authorized      -> enhanceRequest     -> __requestEnhanced, __error
      __requestEnhanced -> execute            -> __executed, __error
      __executed        -> enhanceResponse    -> __enhanced, __error
      __enhanced        -> sendResponse       -> __done, __error
      __error           -> sendError          -> __done
      __done // end state
    */
    this.__initial = function(req, res) {
      return !req.isAuthenticated && !req.isAuthorized && !res.isReady;
    };

    this.__authenticated = function(req, res) {
      return req.isAuthenticated && !req.isAuthorized && !res.isReady;
    };

    this.__authorized = function(req, res) {
      return req.isAuthenticated && req.isAuthorized && !req.isEnhanced && !res.isReady;
    };

    this.__requestEnhanced = function(req, res) {
      return req.isAuthenticated && req.isAuthorized && req.isEnhanced && !res.isReady;
    };

    this.__executed = function(req, res) {
      // excecute must call res.send() so res.data is set
      return req.isAuthenticated && req.isAuthorized && res.isReady && res.data && !res.isEnhanced;
    };

    this.__enhanced = function(req, res) {
      return res.isReady && res.isEnhanced && !res.isSent;
    };

    this.__error = function(req, res) {
      return res.err && !res.isSent;
    };

    this.__done = function(req, res) {
      return res.isSent;
    };

    this.next = function(req, res) {
      if (this.__initial(req, res)) {
        this.authenticate(req, res);
      } else if (this.__authenticated(req, res)) {
        this.authorize(req, res);
      } else if (this.__authorized(req, res)) {
        this.enhanceRequest(req, res);
      } else if (this.__requestEnhanced(req, res)) {
        this.execute(req, res);
      } else if (this.__executed(req, res)) {
        this.enhanceResponse(req, res);
      } else if (this.__enhanced(req, res)) {
        this.sendResponse(req, res);
      } else if (this.__error(req, res)) {
        this.sendError(req, res);
      } else if (this.__done(req,res)) ;
    };

    /*
      Send error response
    */
    this.sendError = function(req, res) {
      var collaboratorId = req.message.collaboratorId;
      var msg = res.err;
      this.send(collaboratorId, msg);
      res.setSent();
      this.next(req, res);
    };

    /*
      Sends a heartbeat message to all connected collaborators
    */
    this._sendHeartbeat = function() {
      Object.keys(this._collaborators).forEach(function(collaboratorId) {
        this.send(collaboratorId, {
          type: 'highfive',
          scope: '_internal'
        });
      }.bind(this));
    };

    /*
      Send response
    */
    this.sendResponse = function(req, res) {
      var collaboratorId = req.message.collaboratorId;
      this.send(collaboratorId, res.data);
      res.setSent();
      this.next(req, res);
    };

    this._isWebsocketOpen = function(ws) {
      return ws && ws.readyState === 1;
    };

    /*
      Send message to collaborator
    */
    this.send = function(collaboratorId, message) {
      if (!message.scope && this.config.scope) {
        message.scope = this.config.scope;
      }

      var ws = this._collaborators[collaboratorId].connection;
      if (this._isWebsocketOpen(ws)) {
        ws.send(this.serializeMessage(message));
      } else {
        console.error('Server#send: Websocket for collaborator', collaboratorId, 'is no longer open', message);
      }
    };

    /*
      Send message to collaborator
    */
    this.broadCast = function(collaborators, message) {
      collaborators.forEach(function(collaboratorId) {
        this.send(collaboratorId, message);
      }.bind(this));
    };

    // Takes a request object
    this._processRequest = function(req) {
      var res = new ServerResponse();
      this.next(req, res);
    };

    /*
      Handling of client messages.

      Message comes in in the following format:

      We turn this into a method call internally:

      this.open(ws, 'doc13')

      The first argument is always the websocket so we can respond to messages
      after some operations have been performed.
    */
    this._onMessage = function(ws, msg) {
      // Retrieve the connection data
      var conn = this._connections.get(ws);
      msg = this.deserializeMessage(msg);

      if (msg.scope === this.scope) {
        // We attach a unique collaborator id to each message
        msg.collaboratorId = conn.collaboratorId;
        var req = new ServerRequest(msg, ws);
        this._processRequest(req);
      }
    };

    this.serializeMessage = function(msg) {
      return JSON.stringify(msg);
    };

    this.deserializeMessage = function(msg) {
      return JSON.parse(msg);
    };

  };

  EventEmitter$4.extend(Server$1);

  /*
    ServerRequest
  */

  function ServerRequest(message, ws) {
    this.message = message;
    this.ws = ws;
    this.isAuthenticated = false;
    this.isAuhorized = false;
  }

  ServerRequest.Prototype = function() {
    /*
      Marks a request as authenticated
    */
    this.setAuthenticated = function(session) {
      this.isAuthenticated = true;
      this.session = session;
    };

    /*
      Marks a request as authorized (authorizationData is optional)
    */
    this.setAuthorized = function(authorizationData) {
      this.isAuthorized = true;
      this.authorizationData = authorizationData;
    };

    /*
      Sets the isEnhanced flag
    */
    this.setEnhanced = function() {
      this.isEnhanced = true;
    };
  };

  oo$4.initClass(ServerRequest);

  /*
    ServerResponse
  */
  function ServerResponse() {
    this.isReady = false; // once the response has been set using send
    this.isEnhanced = false; // after response has been enhanced by enhancer
    this.isSent = false; // after response has been sent
    this.err = null;
    this.data = null;
  }

  ServerResponse.Prototype = function() {

    /*
      Sends an error response

      @example

      ```js
      res.error({
        type: 'syncError',
        errorName: 'AuthenticationError',
        documentId: 'doc-1'
      });
      ```
    */
    this.error = function(err) {
      this.err = err;
      this.isReady = true;
    };

    /*
      Send response data
    */
    this.send = function(data) {
      this.data = data;
      this.isReady = true;
    };

    /*
      Sets the isEnhanced flag
    */
    this.setEnhanced = function() {
      this.isEnhanced = true;
    };

    this.setSent = function() {
      this.isSent = true;
    };
  };

  oo$4.initClass(ServerResponse);

  module.exports = Server$1;

  var oo$5 = require('../util/oo');
  var JSONConverter$1 = require('../model/JSONConverter');
  var converter = new JSONConverter$1();
  var each = require('lodash/each');
  var Err$7 = require('../util/SubstanceError');

  /**
    API for creating and retrieving snapshots of documents
  */
  function SnapshotEngine$1(config) {
    this.schemas = config.schemas;
    this.changeStore = config.changeStore;
    this.documentStore = config.documentStore;

    // Optional
    this.snapshotStore = config.snapshotStore;
  }

  SnapshotEngine$1.Prototype = function() {

    /*
      Returns a snapshot for a given documentId and version
    */
    this.getSnapshot = function(args, cb) {
      if (!args || !args.documentId) {
        return cb(new Err$7('InvalidArgumentsError', {
          message: 'args requires a documentId'
        }));
      }
      this._computeSnapshot(args, cb);
    };

    /*
      Called by DocumentEngine.addChange.

      Here the implementer decides whether a snapshot should be created or not.
      It may be a good strategy to only create a snaphot for every 10th version.
      However for now we will just snapshot each change to keep things simple.

      TODO: this could potentially live in DocumentEngine
    */
    this.requestSnapshot = function(documentId, cb) {
      if (this.snapshotStore) {
        this.createSnapshot({
          documentId: documentId
        }, cb);
      } else {
        cb(null); // do nothing
      }
    };

    /*
      Creates a snapshot
    */
    this.createSnapshot = function(args, cb) {
      if (!this.snapshotStore) {
        throw new Err$7('SnapshotStoreRequiredError', {
          message: 'You must provide a snapshot store to be able to create snapshots'
        });
      }
      this._computeSnapshot(args, function(err, snapshot) {
        if (err) return cb(err);
        this.snapshotStore.saveSnapshot(snapshot, cb);
      }.bind(this));
    };

    /*
      Compute a snapshot based on the documentId and version (optional)

      If no version is provided a snaphot for the latest version is created.
    */
    this._computeSnapshot = function(args, cb) {
      this.documentStore.getDocument(args.documentId, function(err, docRecord) {
        if (err) return cb(err);

        if (!args.version) {
          args.version = docRecord.version; // set version to the latest version
        }

        // We add the docRecord to the args object
        args.docRecord = docRecord;

        if (this.snapshotStore) {
          this._computeSnapshotSmart(args, cb);
        } else {
          this._computeSnapshotDumb(args, cb);
        }
      }.bind(this));
    };

    /*
      Used when a snapshot store is present. This way gives a huge performance
      benefit.

      Example: Let's assume we want to request a snapshot for a new version 20.
      Now getLatestSnapshot will give us version 15. This requires us to fetch
      the changes since version 16 and apply those, plus the very new change.
    */
    this._computeSnapshotSmart = function(args, cb) {
      var documentId = args.documentId;
      var version = args.version;
      var docRecord = args.docRecord;
      var doc;

      // snaphot = null if no snapshot has been found
      this.snapshotStore.getSnapshot({
        documentId: documentId,
        version: version,
        findClosest: true
      }, function(err, snapshot) {
        if (err) return cb(err);

        if (snapshot && version === snapshot.version) {
          // we alread have a snapshot for this version
          return cb(null, snapshot);
        }

        var knownVersion;
        if (snapshot) {
          knownVersion = snapshot.version;
        } else {
          knownVersion = 0; // we need to fetch all changes
        }

        doc = this._createDocumentInstance(docRecord.schemaName);
        if (snapshot.data) {
          doc = converter.importDocument(doc, snapshot.data);
        }

        // Now we get the remaining changes after the known version
        this.changeStore.getChanges({
          documentId: documentId,
          sinceVersion: knownVersion, // 1
          toVersion: version // 2
        }, function(err, result) {
          if (err) cb(err);
          // Apply remaining changes to the doc
          this._applyChanges(doc, result.changes);
          // doc here should be already restored
          var snapshot = {
            documentId: documentId,
            version: version,
            data: converter.exportDocument(doc)
          };
          cb(null, snapshot);
        }.bind(this));
      }.bind(this));
    };

    /*
      Compute a snapshot in a dumb way by applying the full change history
    */
    this._computeSnapshotDumb = function(args, cb) {
      var documentId = args.documentId;
      var version = args.version;
      var docRecord = args.docRecord;
      var doc;

      // Get all changes for a document
      this.changeStore.getChanges({
        documentId: documentId,
        sinceVersion: 0
      }, function(err, result) {
        if (err) cb(err);
        doc = this._createDocumentInstance(docRecord.schemaName);
        // Apply remaining changes to the doc
        this._applyChanges(doc, result.changes);
        // doc here should be already restored
        var snapshot = {
          documentId: documentId,
          version: version,
          data: converter.exportDocument(doc)
        };
        cb(null, snapshot);
      }.bind(this));
    };

    /*
      Based on a given schema create a document instance based
      on given schema configuration
    */
    this._createDocumentInstance = function(schemaName) {
      var schemaConfig = this.schemas[schemaName];

      if (!schemaConfig) {
        throw new Err$7('SnapshotEngine.SchemaNotFoundError', {
          message:'Schema ' + schemaName + ' not found'
        });
      }

      var doc = schemaConfig.documentFactory.createDocument();
      return doc;
    };

    /*
      Takes a document and applies the given changes
    */
    this._applyChanges = function(doc, changes) {
      each(changes, function(change) {
        each(change.ops, function(op) {
          doc.data.apply(op);
        });
      });
    };

  };

  oo$5.initClass(SnapshotEngine$1);

  module.exports = SnapshotEngine$1;

  var oo$6 = require('../util/oo');
  var Err$8 = require('../util/SubstanceError');

  /*
    Implements Substance SnapshotStore API. This is just a dumb store.
    No integrity checks are made, as this is the task of SnapshotEngine
  */
  function SnapshotStore(config) {
    this.config = config;

    // Snapshots will stored here
    this._snapshots = {};
  }

  SnapshotStore.Prototype = function() {


    /*
      Get Snapshot by documentId and version. If no version is provided
      the highest version available is returned

      @return {Object} snapshot record
    */
    this.getSnapshot = function(args, cb) {
      if (!args || !args.documentId) {
        return cb(new Err$8('InvalidArgumentsError', {
          message: 'args require a documentId'
        }));
      }
      var documentId = args.documentId;
      var version = args.version;
      var docEntry = this._snapshots[documentId];
      var result;

      if (!docEntry) return cb(null, undefined);

      var availableVersions = Object.keys(docEntry);

      // Exit if no versions are available
      if (availableVersions.length === 0) return cb(null, undefined);

      // If no version is given we return the latest version available
      if (!version) {
        var latestVersion = Math.max.apply(null, availableVersions);
        result = docEntry[latestVersion];
      } else {
        // Attemt to get the version
        result = docEntry[version];
        if (!result && args.findClosest) {
          // We don't have a snaphot for that requested version
          var smallerVersions = availableVersions.filter(function(v) {
            return parseInt(v, 10) < version;
          });

          // Take the closest version if there is any
          var clostestVersion = Math.max.apply(null, smallerVersions);
          result = docEntry[clostestVersion];
        }
      }

      cb(null, result);
    };

    /*
      Stores a snapshot for a given documentId and version.

      Please not that an existing snapshot will be overwritten.
    */
    this.saveSnapshot = function(args, cb) {
      var documentId = args.documentId;
      var version = args.version;
      var data = args.data;
      var docEntry = this._snapshots[documentId];
      if (!docEntry) {
        docEntry = this._snapshots[documentId] = {};
      }
      docEntry[version] = {
        documentId: documentId,
        version: version,
        data: data
      };
      cb(null, docEntry[version]);
    };

    /*
      Removes a snapshot for a given documentId + version
    */
    this.deleteSnaphot = function(documentId, version, cb) {
      var docEntry = this._snapshots[documentId];
      if (!docEntry || !docEntry[version]) {
        return cb(new Err$8('DeleteError', {
          message: 'Snapshot could not be found'
        }));
      }
      var snapshot = this._snapshots[documentId][version];
      delete this._snapshots[documentId][version];
      cb(null, snapshot);
    };

    /*
      Deletes all snapshots for a given documentId
    */
    this.deleteSnapshotsForDocument = function(documentId, cb) {
      var docEntry = this._snapshots[documentId];
      var deleteCount = 0;
      if (docEntry) deleteCount = Object.keys(docEntry).length;
      delete this._snapshots[documentId];
      cb(null, deleteCount);
    };

    /*
      Returns true if a snapshot exists for a certain version
    */
    this.snapshotExists = function(documentId, version, cb) {
      var exists = false;
      var docRecord = this._snapshots[documentId];

      if (docRecord) {
        exists = docRecord[version];
      }
      cb(null, exists);
    };

    /*
      Seeds the database
    */
    this.seed = function(snapshots, cb) {
      this._snapshots = snapshots;
      if (cb) { cb(null); }
      return this;
    };

  };


  oo$6.initClass(SnapshotStore);
  module.exports = SnapshotStore;

  var ClientConnection$1 = require('./ClientConnection');

  /**
    Browser WebSocket abstraction. Handles reconnects etc.
  */
  function WebSocketConnection() {
    WebSocketConnection.super.apply(this, arguments);
  }

  WebSocketConnection.Prototype = function() {

    this._createWebSocket = function() {
      return new window.WebSocket(this.config.wsUrl);
    };

  };

  ClientConnection$1.extend(WebSocketConnection);
  module.exports = WebSocketConnection;

  var Coordinate = require('./Coordinate');

  /*
    Anchors are special annotations which have a zero width.

    Examples are the start and end anchors of ContainerAnnotations, or a Cursor.

    TODO: in future we will need to introduce a built-in type
    for this so that annotation updates can be compared with
    text operations.

    Sub-Classes: model/ContainerAnnotation.Anchor, model/Selection.Cursor

    @class
    @abstract
  */
  function Anchor() {
    Anchor.super.apply(this, arguments);
  }

  Anchor.Prototype = function() {

    this.isAnchor = function() {
      return true;
    };

  };

  Coordinate.extend(Anchor);

  module.exports = Anchor;

  var filter = require('lodash/filter');
  var TreeIndex = require('../util/TreeIndex');
  var DocumentIndex = require('./DocumentIndex');

  function AnchorIndex(doc) {
    this.doc = doc;
    this.byPath = new TreeIndex.Arrays();
    this.byId = {};
  }

  AnchorIndex.Prototype = function() {

    this.select = function(node) {
      return (node._isContainerAnnotation);
    };

    this.reset = function(data) {
      this.byPath.clear();
      this.byId = {};
      this._initialize(data);
    };

    this.get = function(path, containerName) {
      var anchors = this.byPath.getAll(path);
      if (containerName) {
        return filter(anchors, function(anchor) {
          return (anchor.containerId === containerName);
        });
      } else {
        // return a copy of the array
        return anchors.slice(0);
      }
    };

    this.create = function(containerAnno) {
      var startAnchor = containerAnno.getStartAnchor();
      var endAnchor = containerAnno.getEndAnchor();
      this.byPath.add(startAnchor.path, startAnchor);
      this.byPath.add(endAnchor.path, endAnchor);
      this.byId[containerAnno.id] = containerAnno;
    };

    this.delete = function(containerAnno) {
      var startAnchor = containerAnno.getStartAnchor();
      var endAnchor = containerAnno.getEndAnchor();
      this.byPath.remove(startAnchor.path, startAnchor);
      this.byPath.remove(endAnchor.path, endAnchor);
      delete this.byId[containerAnno.id];
    };

    this.update = function(node, path, newValue, oldValue) {
      if (this.select(node)) {
        var anchor = null;
        if (path[1] === 'startPath') {
          anchor = node.getStartAnchor();
        } else if (path[1] === 'endPath') {
          anchor = node.getEndAnchor();
        } else {
          return;
        }
        this.byPath.remove(oldValue, anchor);
        this.byPath.add(anchor.path, anchor);
      }
    };

  };

  DocumentIndex.extend(AnchorIndex);

  module.exports = AnchorIndex;

  module.exports = require('./PropertyAnnotation');

  var each$1 = require('lodash/each');
  var uniq = require('lodash/uniq');
  var uuid$2 = require('../util/uuid');

  // TODO: this should be implemented as transformations

  // A collection of methods to update annotations
  // --------
  //
  // As we treat annotations as overlay of plain text we need to keep them up-to-date during editing.

  var insertedText = function(doc, coordinate, length) {
    if (!length) return;
    var index = doc.getIndex('annotations');
    var annotations = index.get(coordinate.path);
    each$1(annotations, function(anno) {
      var pos = coordinate.offset;
      var start = anno.startOffset;
      var end = anno.endOffset;
      var newStart = start;
      var newEnd = end;
      if ( (pos < start) ||
           (pos === start) ) {
        newStart += length;
      }
      // inline nodes do not expand automatically
      if ( (pos < end) ||
           (pos === end && !anno.isInline()) ) {
        newEnd += length;
      }
      if (newStart !== start) {
        doc.set([anno.id, 'startOffset'], newStart);
      }
      if (newEnd !== end) {
        doc.set([anno.id, 'endOffset'], newEnd);
      }
    });
    // same for container annotation anchors
    index = doc.getIndex('container-annotation-anchors');
    var anchors = index.get(coordinate.path);
    each$1(anchors, function(anchor) {
      var pos = coordinate.offset;
      var start = anchor.offset;
      var changed = false;
      if ( (pos < start) ||
           (pos === start && !coordinate.after) ) {
        start += length;
        changed = true;
      }
      if (changed) {
        var property = (anchor.isStart?'startOffset':'endOffset');
        doc.set([anchor.id, property], start);
      }
    });
  };

  // TODO: clean up replaceText support hackz
  var deletedText = function(doc, path, startOffset, endOffset) {
    if (startOffset === endOffset) return;
    var index = doc.getIndex('annotations');
    var annotations = index.get(path);
    var length = endOffset - startOffset;
    each$1(annotations, function(anno) {
      var pos1 = startOffset;
      var pos2 = endOffset;
      var start = anno.startOffset;
      var end = anno.endOffset;
      var newStart = start;
      var newEnd = end;
      if (pos2 <= start) {
        newStart -= length;
        newEnd -= length;
        doc.set([anno.id, 'startOffset'], newStart);
        doc.set([anno.id, 'endOffset'], newEnd);
      } else {
        if (pos1 <= start) {
          newStart = start - Math.min(pos2-pos1, start-pos1);
        }
        if (pos1 <= end) {
          newEnd = end - Math.min(pos2-pos1, end-pos1);
        }
        // delete the annotation if it has collapsed by this delete
        if (start !== end && newStart === newEnd) {
          doc.delete(anno.id);
        } else {
          if (start !== newStart) {
            doc.set([anno.id, 'startOffset'], newStart);
          }
          if (end !== newEnd) {
            doc.set([anno.id, 'endOffset'], newEnd);
          }
        }
      }
    });
    // same for container annotation anchors
    index = doc.getIndex('container-annotation-anchors');
    var anchors = index.get(path);
    var containerAnnoIds = [];
    each$1(anchors, function(anchor) {
      containerAnnoIds.push(anchor.id);
      var pos1 = startOffset;
      var pos2 = endOffset;
      var start = anchor.offset;
      var changed = false;
      if (pos2 <= start) {
        start -= length;
        changed = true;
      } else {
        if (pos1 <= start) {
          var newStart = start - Math.min(pos2-pos1, start-pos1);
          if (start !== newStart) {
            start = newStart;
            changed = true;
          }
        }
      }
      if (changed) {
        var property = (anchor.isStart?'startOffset':'endOffset');
        doc.set([anchor.id, property], start);
      }
    });
    // check all anchors after that if they have collapsed and remove the annotation in that case
    each$1(uniq(containerAnnoIds), function(id) {
      var anno = doc.get(id);
      var annoSel = anno.getSelection();
      if(annoSel.isCollapsed()) {
        // console.log("...deleting container annotation because it has collapsed" + id);
        doc.delete(id);
      }
    });
  };

  // used when breaking a node to transfer annotations to the new property
  var transferAnnotations = function(doc, path, offset, newPath, newOffset) {
    var index = doc.getIndex('annotations');
    var annotations = index.get(path, offset);
    each$1(annotations, function(a) {
      var isInside = (offset > a.startOffset && offset < a.endOffset);
      var start = a.startOffset;
      var end = a.endOffset;
      var newStart, newEnd;
      // 1. if the cursor is inside an annotation it gets either split or truncated
      if (isInside) {
        // create a new annotation if the annotation is splittable
        if (a.canSplit()) {
          var newAnno = a.toJSON();
          newAnno.id = uuid$2(a.type + "_");
          newAnno.startOffset = newOffset;
          newAnno.endOffset = newOffset + a.endOffset - offset;
          newAnno.path = newPath;
          doc.create(newAnno);
        }
        // in either cases truncate the first part
        newStart = a.startOffset;
        newEnd = offset;
        // if after truncate the anno is empty, delete it
        if (newEnd === newStart) {
          doc.delete(a.id);
        }
        // ... otherwise update the range
        else {
          if (newStart !== start) {
            doc.set([a.id, "startOffset"], newStart);
          }
          if (newEnd !== end) {
            doc.set([a.id, "endOffset"], newEnd);
          }
        }
      }
      // 2. if the cursor is before an annotation then simply transfer the annotation to the new node
      else if (a.startOffset >= offset) {
        // Note: we are preserving the annotation so that anything which is connected to the annotation
        // remains valid.
        newStart = newOffset + a.startOffset - offset;
        newEnd = newOffset + a.endOffset - offset;
        doc.set([a.id, "path"], newPath);
        doc.set([a.id, "startOffset"], newStart);
        doc.set([a.id, "endOffset"], newEnd);
      }
    });
    // same for container annotation anchors
    index = doc.getIndex('container-annotation-anchors');
    var anchors = index.get(path);
    var containerAnnoIds = [];
    each$1(anchors, function(anchor) {
      containerAnnoIds.push(anchor.id);
      var start = anchor.offset;
      if (offset <= start) {
        var pathProperty = (anchor.isStart?'startPath':'endPath');
        var offsetProperty = (anchor.isStart?'startOffset':'endOffset');
        doc.set([anchor.id, pathProperty], newPath);
        doc.set([anchor.id, offsetProperty], newOffset + anchor.offset - offset);
      }
    });
    // check all anchors after that if they have collapsed and remove the annotation in that case
    each$1(uniq(containerAnnoIds), function(id) {
      var anno = doc.get(id);
      var annoSel = anno.getSelection();
      if(annoSel.isCollapsed()) {
        // console.log("...deleting container annotation because it has collapsed" + id);
        doc.delete(id);
      }
    });
  };

  module.exports = {
    insertedText: insertedText,
    deletedText: deletedText,
    transferAnnotations: transferAnnotations
  };

  var isString = require('lodash/isString');
  var isNumber = require('lodash/isNumber');
  var map$1 = require('lodash/map');
  var filter$1 = require('lodash/filter');
  var TreeIndex$1 = require('../util/TreeIndex');
  var DocumentIndex$1 = require('./DocumentIndex');

  // PropertyAnnotation Index
  // ----------------
  //
  // Lets us look up existing annotations by path and type
  //
  // To get all annotations for the content of a text node
  //
  //    var aIndex = doc.annotationIndex;
  //    aIndex.get(["text_1", "content"]);
  //
  // You can also scope for a specific range
  //
  //    aIndex.get(["text_1", "content"], 23, 45);

  function AnnotationIndex() {
    this.byPath = new TreeIndex$1();
    this.byType = new TreeIndex$1();
  }

  AnnotationIndex.Prototype = function() {

    this.property = "path";

    this.select = function(node) {
      return Boolean(node._isPropertyAnnotation);
    };

    this.reset = function(data) {
      this.byPath.clear();
      this.byType.clear();
      this._initialize(data);
    };

    // TODO: use object interface? so we can combine filters (path and type)
    this.get = function(path, start, end, type) {
      var annotations;
      if (isString(path) || path.length === 1) {
        annotations = this.byPath.getAll(path) || {};
      } else {
        annotations = this.byPath.get(path);
      }
      annotations = map$1(annotations);
      if (isNumber(start)) {
        annotations = filter$1(annotations, AnnotationIndex.filterByRange(start, end));
      }
      if (type) {
        annotations = filter$1(annotations, DocumentIndex$1.filterByType(type));
      }
      return annotations;
    };

    this.create = function(anno) {
      this.byType.set([anno.type, anno.id], anno);
      this.byPath.set(anno.path.concat([anno.id]), anno);
    };

    this.delete = function(anno) {
      this.byType.delete([anno.type, anno.id]);
      this.byPath.delete(anno.path.concat([anno.id]));
    };

    this.update = function(node, path, newValue, oldValue) {
      if (this.select(node) && path[1] === this.property) {
        this.delete({ id: node.id, type: node.type, path: oldValue });
        this.create(node);
      }
    };

  };

  DocumentIndex$1.extend(AnnotationIndex);

  AnnotationIndex.filterByRange = function(start, end) {
    return function(anno) {
      var aStart = anno.startOffset;
      var aEnd = anno.endOffset;
      var overlap = (aEnd >= start);
      // Note: it is allowed to omit the end part
      if (isNumber(end)) {
        overlap = overlap && (aStart <= end);
      }
      return overlap;
    };
  };

  module.exports = AnnotationIndex;

  var DocumentNode = require('./DocumentNode');

  function BlockNode() {
    BlockNode.super.apply(this, arguments);
  }

  DocumentNode.extend(BlockNode);

  BlockNode.static.isBlock = true;

  module.exports = BlockNode;

  var extend$2 = require('lodash/extend');
  var isNumber$1 = require('lodash/isNumber');
  var isString$1 = require('lodash/isString');
  var DocumentNode$1 = require('./DocumentNode');
  var ParentNodeMixin = require('./ParentNodeMixin');
  var ContainerAddress = require('./ContainerAddress');

  /**
    A Container represents a list of nodes.

    While most editing occurs on a property level (such as editing text),
    other things happen on a node level, e.g., breaking or mergin nodes,
    or spanning annotations or so called ContainerAnnotations.

    @prop {String[]} nodes

    @example
  */
  function Container() {
    Container.super.apply(this, arguments);

    if (!this.document.isTransactionDocument) {
      this.document.on('document:changed', this._onChange, this);
    }
  }

  Container.Prototype = function() {

    this._isContainer = true;

    extend$2(this, ParentNodeMixin);

    this.dispose = function() {
      this.document.off(this);
    };

    this.getPosition = function(nodeId) {
      // HACK: ATM we are caching only in the real Document
      // i.e., which is connected to the UI etc.
      if (this.document.isTransactionDocument) {
        return this.nodes.indexOf(nodeId);
      } else {
        var positions = this._getCachedPositions();
        var pos = positions[nodeId];
        if (pos === undefined) {
          pos = -1;
        }
        return pos;
      }
    };

    this.getNodes = function() {
      var doc = this.getDocument();
      var nodes = [];
      this.nodes.forEach(function(nodeId){
        var node = doc.get(nodeId);
        if (!node) {
          console.error('Node does not exist: ', nodeId);
        } else {
          nodes.push(node);
        }
      });
      return nodes;
    };

    this.getNodeAt = function(pos) {
      return this.getDocument().get(this.nodes[pos]);
    };

    this.show = function(nodeId, pos) {
      var doc = this.getDocument();
      var arg1 = arguments[0];
      if (!isString$1(arg1)) {
        if (arg1._isNode) {
          nodeId = arg1.id;
        }
      }
      if (!isNumber$1(pos)) {
        pos = this.nodes.length;
      }
      doc.update(this.getContentPath(), { insert: { offset: pos, value: nodeId } });
    };

    this.hide = function(nodeId) {
      var doc = this.getDocument();
      var pos = this.nodes.indexOf(nodeId);
      if (pos >= 0) {
        doc.update(this.getContentPath(), { delete: { offset: pos } });
      }
    };

    this.getAddress = function(coor) {
      if (!coor._isCoordinate) {
        // we have broken with an earlier version of this API
        throw new Error('Illegal argument: Container.getAddress(coor) expects a Coordinate instance.');
      }
      var nodeId = coor.path[0];
      var nodePos = this.getPosition(nodeId);
      var offset;
      if (coor.isNodeCoordinate()) {
        if (coor.offset > 0) {
          offset = Number.MAX_VALUE;
        } else {
          offset = 0;
        }
      } else {
        offset = coor.offset;
      }
      return new ContainerAddress(nodePos, offset);
    };

    this.getChildrenProperty = function() {
      return 'nodes';
    };

    this.getLength = function() {
      return this.nodes.length;
    };

    this._onChange = function(change) {
      if (change.isUpdated(this.getContentPath())) {
        this.positions = null;
      }
    };

    this._getCachedPositions = function() {
      if (!this.positions) {
        var positions = {};
        this.nodes.forEach(function(id, pos) {
          positions[id] = pos;
        });
        this.positions = positions;
      }
      return this.positions;
    };

    this.getContentPath = function() {
      return [this.id, 'nodes'];
    };

  };

  DocumentNode$1.extend(Container);

  Container.static.name = "container";

  Container.static.defineSchema({
    nodes: { type: ['id'], default: [] }
  });

  Object.defineProperty(Container.prototype, 'length', {
    get: function() {
      console.warn('DEPRECATED: want to get rid of unnecessary properties. Use this.getLength() instead.');
      return this.nodes.length;
    }
  });

  module.exports = Container;

  var Container$1 = require('./Container');

  function ContainerAdapter(doc, path) {
    this.document = doc;
    this.path = path;
    this.id = String(path);

    // HACK: putting this into a place so that doc.get(this.id) works
    // Hopefully this won't hurt :/
    doc.data.nodes[this.id] = this;
  }

  ContainerAdapter.Prototype = function() {

    this._isDocumentNode = false;
    this._isContainer = false;

    this.getContentPath = function() {
      return this.path;
    };
  };

  Container$1.extend(ContainerAdapter);

  Object.defineProperties(ContainerAdapter.prototype, {
    nodes: {
      get: function() {
        return this.document.get(this.path);
      },
    }
  });

  module.exports = ContainerAdapter;

  var oo$7 = require('../util/oo');

  function ContainerAddress$1(pos, offset) {
    this.pos = pos;
    this.offset = offset;
  }

  ContainerAddress$1.Prototype = function() {

    this.isBefore = function(other, strict) {
      strict = Boolean(strict);
      if (this.pos < other.pos) {
        return true;
      } else if (this.pos > other.pos) {
        return false;
      } else if (this.offset < other.offset) {
        return true;
      } else if (this.offset > other.offset) {
        return false;
      }
      if (strict) {
        return false;
      } else {
        return true;
      }
    };

    this.isAfter = function(other, strict) {
      return other.isBefore(this, strict);
    };

    this.isEqual = function(other) {
      return (this.pos === other.pos && this.offset === other.offset);
    };

    this.toString = function() {
      return [this.pos,'.',this.offset].join('');
    };
  };

  oo$7.initClass(ContainerAddress$1);

  module.exports = ContainerAddress$1;

  var isEqual = require('lodash/isEqual');
  var last = require('lodash/last');
  var each$2 = require('lodash/each');
  var EventEmitter$5 = require('../util/EventEmitter');
  var DocumentNode$2 = require('./DocumentNode');
  var Selection$2 = require('./Selection');
  var Anchor$1 = require('./Anchor');
  var documentHelpers = require('./documentHelpers');

  /**
    Describes an annotation sticking on a container that can span over multiple
    nodes.

    @class

    @example

    ```js
    {
      "id": "subject_reference_1",
      "type": "subject_reference",
      "containerId": "content",
      "startPath": ["text_2", "content"],
      "startOffset": 100,
      "endPath": ["text_4", "content"],
      "endOffset": 40
    }
    ```
   */

  function ContainerAnnotation() {
    ContainerAnnotation.super.apply(this, arguments);
  }

  ContainerAnnotation.Prototype = function() {

    this._isAnnotation = true;
    this._isContainerAnnotation = true;

    /**
      Get the plain text spanned by this annotation.

      @return {String}
    */
    this.getText = function() {
      var doc = this.getDocument();
      if (!doc) {
        console.warn('Trying to use a ContainerAnnotation which is not attached to the document.');
        return "";
      }
      return documentHelpers.getTextForSelection(doc, this.getSelection());
    };

    /**
      Provides a selection which has the same range as this annotation.

      @return {model/ContainerSelection}
    */
    this.getSelection = function() {
      var doc = this.getDocument();
      // Guard: when this is called while this node has been detached already.
      if (!doc) {
        console.warn('Trying to use a ContainerAnnotation which is not attached to the document.');
        return Selection$2.nullSelection();
      }
      return doc.createSelection({
        type: "container",
        containerId: this.containerId,
        startPath: this.startPath,
        startOffset: this.startOffset,
        endPath: this.endPath,
        endOffset: this.endOffset
      });
    };

    this.setHighlighted = function(highlighted, scope) {
      if (this.highlighted !== highlighted) {
        this.highlighted = highlighted;
        this.highlightedScope = scope;
        this.emit('highlighted', highlighted, scope);

        each$2(this.fragments, function(frag) {
          frag.emit('highlighted', highlighted, scope);
        });
      }
    };

    this.updateRange = function(tx, sel) {
      if (!sel.isContainerSelection()) {
        throw new Error('Cannot change to ContainerAnnotation.');
      }
      if (!isEqual(this.startPath, sel.start.path)) {
        tx.set([this.id, 'startPath'], sel.start.path);
      }
      if (this.startOffset !== sel.start.offset) {
        tx.set([this.id, 'startOffset'], sel.start.offset);
      }
      if (!isEqual(this.endPath, sel.end.path)) {
        tx.set([this.id, 'endPath'], sel.end.path);
      }
      if (this.endOffset !== sel.end.offset) {
        tx.set([this.id, 'endOffset'], sel.end.offset);
      }
    };

    this.getFragments = function() {
      var fragments = [];
      var doc = this.getDocument();
      var container = doc.get(this.containerId);
      var paths = container.getPathRange(this.startPath, this.endPath);
      if (paths.length === 1) {
        fragments.push(new ContainerAnnotation.Fragment(this, paths[0], "property"));
      } else if (paths.length > 1) {
        fragments.push(new ContainerAnnotation.Fragment(this, paths[0], "start"));
        fragments.push(new ContainerAnnotation.Fragment(this, last(paths), "end"));
        for (var i = 1; i < paths.length-1; i++) {
          fragments.push(new ContainerAnnotation.Fragment(this, paths[i], "inner"));
        }
      }
      return fragments;
    };

    this.getStartAnchor = function() {
      if (!this._startAnchor) {
        this._startAnchor = new ContainerAnnotation.Anchor(this, 'isStart');
      }
      return this._startAnchor;
    };

    this.getEndAnchor = function() {
      if (!this._endAnchor) {
        this._endAnchor = new ContainerAnnotation.Anchor(this);
      }
      return this._endAnchor;
    };
  };

  DocumentNode$2.extend(ContainerAnnotation);

  ContainerAnnotation.static.name = "container-annotation";

  ContainerAnnotation.static.defineSchema({
    containerId: "string",
    startPath: ["string"],
    startOffset: "number",
    endPath: ["string"],
    endOffset: "number"
  });

  ContainerAnnotation.static.isContainerAnnotation = true;

  /**
    @class
    @private
  */
  ContainerAnnotation.Anchor = function(anno, isStart) {
    // Note: we are not calling Anchor() as it is not useful for us
    // as we need to delegate to the annos value dynamically
    // Anchor.call(this, path, offset)

    // initializing mixin
    EventEmitter$5.call(this);

    this.type = "container-annotation-anchor";
    this.anno = anno;
    // TODO: remove this.node in favor of this.anno
    this.node = anno;
    this.id = anno.id;
    this.containerId = anno.containerId;
    this.isStart = Boolean(isStart);
    Object.freeze(this);
  };

  ContainerAnnotation.Anchor.Prototype = function() {

    this.getTypeNames = function() {
      return [this.type];
    };

    this.getPath = function() {
      return (this.isStart ? this.node.startPath : this.node.endPath);
    };

    this.getOffset = function() {
      return (this.isStart ? this.node.startOffset : this.node.endOffset);
    };

  };

  Anchor$1.extend(ContainerAnnotation.Anchor, EventEmitter$5.prototype);

  Object.defineProperties(ContainerAnnotation.Anchor.prototype, {
    path: {
      get: function() { return this.getPath(); }
    },
    offset: {
      get: function() { return this.getOffset(); }
    }
  });

  /**
    @class
    @private
  */
  ContainerAnnotation.Fragment = function(anno, path, mode) {
    EventEmitter$5.call(this);

    this.type = "container-annotation-fragment";
    this.anno = anno;
    // HACK: id is necessary for Fragmenter
    this.id = anno.id;
    this.path = path;
    this.mode = mode;
  };

  ContainerAnnotation.Fragment.Prototype = function() {
    this.getTypeNames = function() {
      return [this.type];
    };

    this.getStartOffset = function() {
      return ( (this.mode === "start" || this.mode === "property") ? this.anno.startOffset : 0);
    };

    this.getEndOffset = function() {
      var doc = this.anno.getDocument();
      var textProp = doc.get(this.path);
      var length = textProp.length;
      return ( (this.mode === "end" || this.mode === "property") ? this.anno.endOffset : length);
    };
  };

  EventEmitter$5.extend(ContainerAnnotation.Fragment);

  ContainerAnnotation.Fragment.static.fragmentation = Number.MAX_VALUE;

  Object.defineProperties(ContainerAnnotation.Fragment.prototype, {
    startOffset: {
      get: function() { return this.getStartOffset(); },
      set: function() { throw new Error('ContainerAnnotation.Fragment.startOffset is read-only.'); }
    },
    endOffset: {
      get: function() { return this.getEndOffset(); },
      set: function() { throw new Error('ContainerAnnotation.Fragment.endOffset is read-only.'); }
    },
    highlighted: {
      get: function() {
        return this.anno.highlighted;
      },
      set: function() { throw new Error('ContainerAnnotation.Fragment.highlighted is read-only.'); }
    }
  });

  module.exports = ContainerAnnotation;

  var isString$2 = require('lodash/isString');
  var map$2 = require('lodash/map');
  var filter$2 = require('lodash/filter');
  var TreeIndex$2 = require('../util/TreeIndex');
  var DocumentIndex$2 = require('./DocumentIndex');

  function ContainerAnnotationIndex() {
    this.byId = new TreeIndex$2();
  }

  ContainerAnnotationIndex.Prototype = function() {

    this.select = function(node) {
      return Boolean(node._isContainerAnnotation);
    };

    this.reset = function(data) {
      this.byId.clear();
      this._initialize(data);
    };

    this.get = function(containerId, type) {
      var annotations = map$2(this.byId.get(containerId));
      if (isString$2(type)) {
        annotations = filter$2(annotations, DocumentIndex$2.filterByType);
      }
      return annotations;
    };

    this.create = function(anno) {
      this.byId.set([anno.containerId, anno.id], anno);
    };

    this.delete = function(anno) {
      this.byId.delete([anno.containerId, anno.id]);
    };

    this.update = function(node, path, newValue, oldValue) { // eslint-disable-line
      // TODO should we support moving a container anno from one container to another?
    };

  };

  DocumentIndex$2.extend(ContainerAnnotationIndex);

  module.exports = ContainerAnnotationIndex;

  var isNumber$2 = require('lodash/isNumber');
  var Coordinate$1 = require('./Coordinate');
  var Selection$3 = require('./Selection');
  var PropertySelection = require('./PropertySelection');
  var CoordinateAdapter = PropertySelection.CoordinateAdapter;
  var RangeAdapter = PropertySelection.RangeAdapter;

  /**
    A selection spanning multiple nodes.

    @class
    @extends PropertySelection

    @example

    ```js
    var containerSel = doc.createSelection({
      type: 'container',
      containerId: 'body',
      startPath: ['p1', 'content'],
      startOffset: 5,
      endPath: ['p3', 'content'],
      endOffset: 4,
    });
    ```
  */
  function ContainerSelection(containerId, startPath, startOffset, endPath, endOffset, reverse, surfaceId) {
    Selection$3.call(this);

    /**
      @type {String}
    */
    this.containerId = containerId;

    /**
      The path of the property where this annotations starts.
      @type {String[]}
    */
    this.startPath = startPath;

    /**
      The character position where this annotations starts.
      @type {Number}
    */
    this.startOffset = startOffset;

    /**
      The path of the property where this annotations ends.
      @type {String[]}
    */
    this.endPath = endPath;

    /**
      The character position where this annotations ends.
      @type {Number}
    */
    this.endOffset = endOffset;


    this.reverse = Boolean(reverse);

    this.surfaceId = surfaceId;

    if (!this.containerId || !this.startPath || !isNumber$2(this.startOffset) ||
     !this.endPath || !isNumber$2(this.endOffset) ) {
      throw new Error('Invalid arguments: `containerId`, `startPath`, `startOffset`, `endPath`, and `endOffset` are mandatory');
    }

    // dynamic adapters for Coordinate oriented implementations
    this._internal.start = new CoordinateAdapter(this, 'startPath', 'startOffset');
    this._internal.end = new CoordinateAdapter(this, 'endPath', 'endOffset');
    this._internal.range = new RangeAdapter(this);
  }

  ContainerSelection.Prototype = function() {

    this.toJSON = function() {
      return {
        type: 'container',
        containerId: this.containerId,
        startPath: this.startPath,
        startOffset: this.startOffset,
        endPath: this.endPath,
        endOffset: this.endOffset,
        reverse: this.reverse,
        surfaceId: this.surfaceId
      };
    };

    this._isContainerSelection = true;

    this.isContainerSelection = function() {
      return true;
    };

    this.getType = function() {
      return 'container';
    };

    this.isNull = function() {
      return false;
    };

    this.isCollapsed = function() {
      return this.start.equals(this.end);
    };

    this.isReverse = function() {
      return this.reverse;
    };

    this.equals = function(other) {
      return (
        Selection$3.prototype.equals.call(this, other) &&
        this.containerId === other.containerId &&
        (this.start.equals(other.start) && this.end.equals(other.end))
      );
    };

    this.toString = function() {
      return "ContainerSelection("+ JSON.stringify(this.startPath) + ":" + this.startOffset + " -> " + JSON.stringify(this.endPath) + ":" + this.endOffset + (this.reverse ? ", reverse" : "") + ")";
    };

    /**
      @return {model/Container} The container node instance for this selection.
    */
    this.getContainer = function() {
      if (!this._internal.container) {
        this._internal.container = this.getDocument().get(this.containerId);
      }
      return this._internal.container;
    };

    this.isInsideOf = function(other, strict) {
      // Note: this gets called from PropertySelection.contains()
      // because this implementation can deal with mixed selection types.
      if (other.isNull()) return false;
      strict = Boolean(strict);
      var r1 = this._range(this);
      var r2 = this._range(other);
      return (r2.start.isBefore(r1.start, strict) &&
        r1.end.isBefore(r2.end, strict));
    };

    this.contains = function(other, strict) {
      // Note: this gets called from PropertySelection.isInsideOf()
      // because this implementation can deal with mixed selection types.
      if (other.isNull()) return false;
      strict = Boolean(strict);
      var r1 = this._range(this);
      var r2 = this._range(other);
      return (r1.start.isBefore(r2.start, strict) &&
        r2.end.isBefore(r1.end, strict));
    };

    this.containsNodeFragment = function(nodeId, strict) {
      var container = this.getContainer();
      var coor = new Coordinate$1([nodeId], 0);
      var address = container.getAddress(coor);
      var r = this._range(this);
      // console.log('ContainerSelection.containsNodeFragment', address, 'is within', r.start, '->', r.end, '?');
      var contained = r.start.isBefore(address, strict);
      if (contained) {
        address.offset = 1;
        contained = r.end.isAfter(address, strict);
      }
      return contained;
    };

    this.overlaps = function(other) {
      var r1 = this._range(this);
      var r2 = this._range(other);
      // it overlaps if they are not disjunct
      return !(r1.end.isBefore(r2.start, false) ||
        r2.end.isBefore(r1.start, false));
    };

    this.isLeftAlignedWith = function(other) {
      var r1 = this._range(this);
      var r2 = this._range(other);
      return r1.start.isEqual(r2.start);
    };

    this.isRightAlignedWith = function(other) {
      var r1 = this._range(this);
      var r2 = this._range(other);
      return r1.end.isEqual(r2.end);
    };

    this.containsNode = function(nodeId) {
      var container = this.getContainer();
      var startPos = container.getPosition(this.startPath[0]);
      var endPos = container.getPosition(this.endPath[0]);
      var pos = container.getPosition(nodeId);
      if ((startPos>pos || endPos<pos) ||
          (startPos === pos && this.startPath.length === 1 && this.startOffset > 0) ||
          (endPos === pos && this.endPath.length === 1 && this.endOffset < 1)) {
        return false;
      }
      return true;
    };

    /**
      Collapse a selection to chosen direction.

      @param {String} direction either left of right
      @returns {PropertySelection}
    */
    this.collapse = function(direction) {
      var coor;
      if (direction === 'left') {
        coor = this.start;
      } else {
        coor = this.end;
      }
      return _createNewSelection(this, coor, coor);
    };


    this.expand = function(other) {
      var r1 = this._range(this);
      var r2 = this._range(other);
      var start;
      var end;

      if (r1.start.isEqual(r2.start)) {
        start = new Coordinate$1(this.start.path, Math.min(this.start.offset, other.start.offset));
      } else if (r1.start.isAfter(r2.start)) {
        start = new Coordinate$1(other.start.path, other.start.offset);
      } else {
        start = this.start;
      }
      if (r1.end.isEqual(r2.end)) {
        end = new Coordinate$1(this.end.path, Math.max(this.end.offset, other.end.offset));
      } else if (r1.end.isBefore(r2.end, false)) {
        end = new Coordinate$1(other.end.path, other.end.offset);
      } else {
        end = this.end;
      }

      return _createNewSelection(this, start, end);
    };

    this.truncateWith = function(other) {
      if (other.isInsideOf(this, 'strict')) {
        // the other selection should overlap only on one side
        throw new Error('Can not truncate with a contained selections');
      }
      if (!this.overlaps(other)) {
        return this;
      }
      var r1 = this._range(this);
      var r2 = this._range(other);
      var start, end;
      if (r2.start.isBefore(r1.start, 'strict') && r2.end.isBefore(r1.end, 'strict')) {
        start = other.end;
        end = this.end;
      } else if (r1.start.isBefore(r2.start, 'strict') && r1.end.isBefore(r2.end, 'strict')) {
        start = this.start;
        end = other.start;
      } else if (r1.start.isEqual(r2.start)) {
        if (r2.end.isBefore(r1.end, 'strict')) {
          start = other.end;
          end = this.end;
        } else {
          // the other selection is larger which eliminates this one
          return Selection$3.nullSelection;
        }
      } else if (r1.end.isEqual(r2.end)) {
        if (r1.start.isBefore(r2.start, 'strict')) {
          start = this.start;
          end = other.start;
        } else {
          // the other selection is larger which eliminates this one
          return Selection$3.nullSelection;
        }
      } else if (this.isInsideOf(other)) {
        return Selection$3.nullSelection;
      } else {
        throw new Error('Could not determine coordinates for truncate. Check input');
      }
      return _createNewSelection(this, start, end);
    };

    /**
      Helper to create selection fragments for this ContainerSelection.

      Used for selection rendering, for instance.

      @returns {Selection.Fragment[]} Fragments resulting from splitting this into property selections.
    */
    this.getFragments = function() {
      if(this._internal.fragments) {
        return this._internal.fragments;
      }

      /*
        NOTE:
          This implementation is a bit more complicated
          to simplify implementations at other places.
          A ContainerSelections can be seen as a list of property and node
          fragments.
          The following implementation is covering all cases in a canonical
          way, considering all combinations of start end end coordinates
          either given as ([nodeId, propertyName], offset) or
          ([nodeId], 0|1).
      */


      var fragments = [];

      var doc = this.getDocument();
      var container = this.getContainer();
      var startPos = container.getPosition(this.startPath[0]);
      var endPos = container.getPosition(this.endPath[0]);

      var coor, node, nodeId, fragment, path, offset, text;
      if (startPos !== endPos) {

        // First fragment can either be a property fragment (fully or partial) or a node fragment
        coor = this.start;
        path = coor.path;
        offset = coor.offset;
        nodeId = path[0];
        node = doc.get(nodeId);
        if (!node) {
          throw new Error('Node does not exist:' + nodeId);
        }
        // coordinate is a property coordinate
        if (coor.isPropertyCoordinate()) {
          text = doc.get(path);
          fragment = new Selection$3.Fragment(path, offset, text.length, (offset === 0));
          fragments.push(fragment);
        }
        // coordinate is a node coordinate (before)
        else if (coor.isNodeCoordinate() && offset === 0) {
          fragments.push(
            new Selection$3.NodeFragment(node.id)
          );
        }

        // fragments in-between are either full property fragments or node fragments
        for (var pos= startPos+1; pos < endPos; pos++) {
          node = container.getChildAt(pos);
          if (node.isText()) {
            path = [node.id, 'content'];
            text = doc.get(path);
            fragments.push(
              new Selection$3.Fragment(path, 0, text.length, true)
            );
          } else {
            fragments.push(
              new Selection$3.NodeFragment(container.nodes[pos])
            );
          }
        }

        // last fragment is again either a property fragment (fully or partial) or a node fragment
        coor = this.end;
        path = coor.path;
        offset = coor.offset;
        nodeId = path[0];
        node = doc.get(nodeId);
        if (!node) {
          throw new Error('Node does not exist:' + nodeId);
        }
        // coordinate is a property coordinate
        if (coor.isPropertyCoordinate()) {
          text = doc.get(path);
          fragment = new Selection$3.Fragment(path, 0, offset, (offset === text.length));
          fragments.push(fragment);
        }
        // coordinate is a node coordinate (after)
        else if (coor.isNodeCoordinate() && offset > 0) {
          fragments.push(
            new Selection$3.NodeFragment(node.id)
          );
        }
      } else {
        // startPos === endPos
        path = this.start.path;
        nodeId = path[0];
        node = doc.get(nodeId);
        var startIsNodeCoordinate = this.start.isNodeCoordinate();
        var endIsNodeCoordinate = this.end.isNodeCoordinate();
        if (!node.isText()) {
          fragments.push(
            new Selection$3.NodeFragment(nodeId)
          );
        } else if (startIsNodeCoordinate && endIsNodeCoordinate && this.startOffset < this.endOffset) {
          fragments.push(
            new Selection$3.NodeFragment(nodeId)
          );
        } else if (!startIsNodeCoordinate && endIsNodeCoordinate && this.endOffset > 0) {
          text = doc.get(this.startPath);
          fragments.push(
            new Selection$3.Fragment(path, this.startOffset, text.length, (this.startOffset === 0))
          );
        } else if (startIsNodeCoordinate && !endIsNodeCoordinate && this.startOffset === 0) {
          text = doc.get(this.endPath);
          fragments.push(
            new Selection$3.Fragment(path, 0, this.endOffset, (this.endOffset === text.length))
          );
        } else if (!startIsNodeCoordinate && !endIsNodeCoordinate) {
          text = doc.get(this.startPath);
          fragments.push(
            new Selection$3.Fragment(path, this.startOffset, this.endOffset, (this.startOffset === 0 && this.endOffset === text.length))
          );
        }
      }

      this._internal.fragments = fragments;

      return fragments;
    };

    /**
      Splits a container selection into property selections.

      @returns {PropertySelection[]}
    */
    this.splitIntoPropertySelections = function() {
      var sels = [];
      var fragments = this.getFragments();
      fragments.forEach(function(fragment) {
        if (fragment instanceof Selection$3.Fragment) {
          sels.push(
            new PropertySelection(fragment.path, fragment.startOffset,
              fragment.endOffset, false, this.containerId, this.surfaceId)
          );
        }
      }.bind(this));
      return sels;
    };

    this._clone = function() {
      return new ContainerSelection(this.containerId, this.startPath, this.startOffset, this.endPath, this.endOffset, this.reverse, this.surfaceId);
    };

    this._range = function(sel) {
      // EXPERIMENTAL: caching the internal address based range
      // as we use it very often.
      // However, this is dangerous as this data can get invalid by a change
      if (sel._internal.addressRange) {
        return sel._internal.addressRange;
      }

      var container = this.getContainer();
      var startAddress = container.getAddress(sel.start);
      var endAddress;
      if (sel.isCollapsed()) {
        endAddress = startAddress;
      } else {
        endAddress = container.getAddress(sel.end);
      }
      var addressRange = {
        start: startAddress,
        end: endAddress
      };
      if (sel._isContainerSelection) {
        sel._internal.addressRange = addressRange;
      }
      return addressRange;
    };

    function _createNewSelection(containerSel, start, end) {
      var newSel = new ContainerSelection(containerSel.containerId,
        start.path, start.offset, end.path, end.offset, false, containerSel.surfaceId);
      // we need to attach the new selection
      var doc = containerSel._internal.doc;
      if (doc) {
        newSel.attach(doc);
      }
      return newSel;
    }
  };

  Selection$3.extend(ContainerSelection);

  Object.defineProperties(ContainerSelection.prototype, {
    path: {
      get: function() {
        throw new Error('ContainerSelection has no path property. Use startPath and endPath instead');
      },
      set: function() {
        throw new Error('ContainerSelection has no path property. Use startPath and endPath instead.');
      }
    },
    /**
      @property {Coordinate} ContainerSelection.start
    */
    start: {
      get: function() {
        return this._internal.start;
      },
      set: function() { throw new Error('ContainerSelection.prototype.start is read-only.'); }
    },
    /**
      @property {Coordinate} ContainerSelection.end
    */
    end: {
      get: function() {
        return this._internal.end;
      },
      set: function() { throw new Error('ContainerSelection.prototype.end is read-only.'); }
    },

    range: {
      get: function() {
        return this._internal.range;
      },
      set: function() { throw new Error('ContainerSelection.prototype.range is read-only.'); }
    },

  });

  ContainerSelection.fromJSON = function(properties) {
    // Note: not calling the super ctor as it freezes the instance
    var containerId = properties.containerId;
    var startPath = properties.startPath;
    var endPath = properties.endPath || properties.startPath;
    var startOffset = properties.startOffset;
    var endOffset = properties.endOffset;
    var reverse = Boolean(properties.reverse);
    // Note: to be able to associate selections with surfaces we decided
    // to introduce this optional property
    var surfaceId = properties.surfaceId;
    var sel = new ContainerSelection(containerId, startPath, startOffset, endPath, endOffset, reverse, surfaceId);
    return sel;
  };

  module.exports = ContainerSelection;

  var isArray = require('lodash/isArray');
  var isNumber$3 = require('lodash/isNumber');
  var isEqual$1 = require('lodash/isEqual');
  var oo$8 = require('../util/oo');

  // path: the address of a property, such as ['text_1', 'content']
  // offset: the position in the property
  // after: an internal flag indicating if the address should be associated to the left or right side
  //   Note: at boundaries of annotations there are two possible positions with the same address
  //       foo <strong>bar</strong> ...
  //     With offset=7 normally we associate this position:
  //       foo <strong>bar|</strong> ...
  //     With after=true we can describe this position:
  //       foo <strong>bar</strong>| ...
  function Coordinate$2(path, offset, after) {
    this.path = path;
    this.offset = offset;
    this.after = after;
    if (!isArray(path)) {
      throw new Error('Invalid arguments: path should be an array.');
    }
    if (!isNumber$3(offset) || offset < 0) {
      throw new Error('Invalid arguments: offset must be a positive number.');
    }
    // make sure that path can't be changed afterwards
    if (!Object.isFrozen(path)) {
      Object.freeze(path);
    }
  }

  Coordinate$2.Prototype = function() {

    this._isCoordinate = true;

    this.equals = function(other) {
      return (other === this ||
        (isEqual$1(other.path, this.path) && other.offset === this.offset) );
    };

    this.withCharPos = function(offset) {
      return new Coordinate$2(this.path, offset);
    };

    this.getNodeId = function() {
      return this.path[0];
    };

    this.getPath = function() {
      return this.path;
    };

    this.getOffset = function() {
      return this.offset;
    };

    this.toJSON = function() {
      return {
        path: this.path,
        offset: this.offset,
        after: this.after
      };
    };

    this.toString = function() {
      return "(" + this.path.join('.') + ", " + this.offset + ")";
    };

    this.isPropertyCoordinate = function() {
      return this.path.length > 1;
    };

    this.isNodeCoordinate = function() {
      return this.path.length === 1;
    };

  };

  oo$8.initClass(Coordinate$2);

  module.exports = Coordinate$2;

  var DocumentSession$1 = require('./DocumentSession');

  /*
    Creates a factory for documents and the correspondent initial changeset

    @param {String} name schema identifier
    @param {String} schema schema version

    @example

    var myDocFactory = createDocumentFactory(ProseArticle, function(tx) {
      var body = tx.get('body');
      tx.create({
        id: 'p1',
        type: 'paragraph',
        content: '0123456789'
      });
      body.show('p1');
    });

    myDocFactory.ArticleClass;
    myDocFactory.createEmptyArticle();
    myDocFactory.createArticle();
    myDocFactory.createChangeset();
  */
  function createDocumentFactory(ArticleClass, create) {
    return {
      ArticleClass: ArticleClass,
      createEmptyArticle: function() {
        var doc = new ArticleClass();
        return doc;
      },
      createArticle: function() {
        var doc = new ArticleClass();
        create(doc);
        return doc;
      },
      createChangeset: function() {
        var doc = new ArticleClass();
        var session = new DocumentSession$1(doc);
        var change = session.transaction(create);
        return [change.toJSON()];
      }
    };
  }

  module.exports = createDocumentFactory;

  var cloneDeep$1 = require('lodash/cloneDeep');
  var isEqual$2 = require('lodash/isEqual');

  var Selection$4 = require('./Selection');

  /*
    @
  */
  function CustomSelection(customType, data, surfaceId) {
    Selection$4.call(this);

    this.customType = customType;
    this.data = data;

    this.surfaceId = surfaceId;
  }

  CustomSelection.Prototype = function() {

    this.toString = function() {
      return "custom(" + this.customType + ', ' + JSON.stringify(this.data) + ")";
    };

    this.isCustomSelection = function() {
      return true;
    };

    this.getType = function() {
      return 'custom';
    };

    this.getCustomType = function() {
      return this.customType;
    };

    this.toJSON = function() {
      return {
        type: 'custom',
        customType: this.customType,
        data: cloneDeep$1(this.data),
        surfaceId: this.surfaceId
      };
    };

    this.equals = function(other) {
      return (
        Selection$4.prototype.equals.call(this, other) &&
        other.isCustomSelection() &&
        isEqual$2(this.data, other.data)
      );
    };

  };

  Selection$4.extend(CustomSelection);

  CustomSelection.fromJSON = function(json) {
    return new CustomSelection(json.customType, json.data || {}, json.surfaceId);
  };

  module.exports = CustomSelection;

  var isNumber$4 = require('lodash/isNumber');
  var isEqual$3 = require('lodash/isEqual');
  var cloneDeep$2 = require('lodash/cloneDeep');

  var Operation = require('./Operation');
  var Conflict = require('./Conflict');

  var NOP = "NOP";
  var DELETE = "delete";
  var INSERT = "insert";

  /*
    @class
    @extends Operation
  */
  function ArrayOperation(data) {
    Operation.call(this);

    if (!data || !data.type) {
      throw new Error("Illegal argument: insufficient data.");
    }
    this.type = data.type;
    if (this.type === NOP) return;

    if (this.type !== INSERT && this.type !== DELETE) {
      throw new Error("Illegal type.");
    }
    // the position where to apply the operation
    this.pos = data.pos;
    // the value to insert or delete
    this.val = data.val;
    if (!isNumber$4(this.pos) || this.pos < 0) {
      throw new Error("Illegal argument: expecting positive number as pos.");
    }
  }

  ArrayOperation.fromJSON = function(data) {
    return new ArrayOperation(data);
  };

  ArrayOperation.Prototype = function() {

    this._isArrayOperation = true;

    this.apply = function(array) {
      if (this.type === NOP) {
        return array;
      }
      if (this.type === INSERT) {
        if (array.length < this.pos) {
          throw new Error("Provided array is too small.");
        }
        array.splice(this.pos, 0, this.val);
        return array;
      }
      // Delete
      else /* if (this.type === DELETE) */ {
        if (array.length < this.pos) {
          throw new Error("Provided array is too small.");
        }
        if (!isEqual$3(array[this.pos], this.val)) {
          throw Error("Unexpected value at position " + this.pos + ". Expected " + this.val + ", found " + array[this.pos]);
        }
        array.splice(this.pos, 1);
        return array;
      }
    };

    this.clone = function() {
      var data = {
        type: this.type,
        pos: this.pos,
        val: cloneDeep$2(this.val)
      };
      return new ArrayOperation(data);
    };

    this.invert = function() {
      var data = this.toJSON();
      if (this.type === NOP) data.type = NOP;
      else if (this.type === INSERT) data.type = DELETE;
      else /* if (this.type === DELETE) */ data.type = INSERT;
      return new ArrayOperation(data);
    };

    this.hasConflict = function(other) {
      return ArrayOperation.hasConflict(this, other);
    };

    this.toJSON = function() {
      var result = {
        type: this.type,
      };
      if (this.type === NOP) return result;
      result.pos = this.pos;
      result.val = cloneDeep$2(this.val);
      return result;
    };

    this.isInsert = function() {
      return this.type === INSERT;
    };

    this.isDelete = function() {
      return this.type === DELETE;
    };

    this.getOffset = function() {
      return this.pos;
    };

    this.getValue = function() {
      return this.val;
    };

    this.isNOP = function() {
      return this.type === NOP;
    };

    this.toString = function() {
      return ["(", (this.isInsert() ? INSERT : DELETE), ",", this.getOffset(), ",'", this.getValue(), "')"].join('');
    };
  };

  Operation.extend(ArrayOperation);

  var hasConflict = function(a, b) {
    if (a.type === NOP || b.type === NOP) return false;
    if (a.type === INSERT && b.type === INSERT) {
      return a.pos === b.pos;
    } else {
      return false;
    }
  };

  function transform_insert_insert(a, b) {
    if (a.pos === b.pos) {
      b.pos += 1;
    }
    // a before b
    else if (a.pos < b.pos) {
      b.pos += 1;
    }
    // a after b
    else {
      a.pos += 1;
    }
  }

  function transform_delete_delete(a, b) {
    // turn the second of two concurrent deletes into a NOP
    if (a.pos === b.pos) {
      b.type = NOP;
      a.type = NOP;
      return;
    }
    if (a.pos < b.pos) {
      b.pos -= 1;
    } else {
      a.pos -= 1;
    }
  }

  function transform_insert_delete(a, b) {
    // reduce to a normalized case
    if (a.type === DELETE) {
      var tmp = a;
      a = b;
      b = tmp;
    }
    if (a.pos <= b.pos) {
      b.pos += 1;
    } else {
      a.pos -= 1;
    }
  }

  var transform = function(a, b, options) {
    options = options || {};
    // enable conflicts when you want to notify the user of potential problems
    // Note that even in these cases, there is a defined result.
    if (options['no-conflict'] && hasConflict(a, b)) {
      throw new Conflict(a, b);
    }
    // this is used internally only as optimization, e.g., when rebasing an operation
    if (!options.inplace) {
      a = a.clone();
      b = b.clone();
    }
    if (a.type === NOP || b.type === NOP) ;
    else if (a.type === INSERT && b.type === INSERT) {
      transform_insert_insert(a, b);
    }
    else if (a.type === DELETE && b.type === DELETE) {
      transform_delete_delete(a, b);
    }
    else {
      transform_insert_delete(a, b);
    }
    return [a, b];
  };

  ArrayOperation.transform = transform;
  ArrayOperation.hasConflict = hasConflict;

  /* Factories */

  ArrayOperation.Insert = function(pos, val) {
    return new ArrayOperation({type:INSERT, pos: pos, val: val});
  };

  ArrayOperation.Delete = function(pos, val) {
    return new ArrayOperation({ type:DELETE, pos: pos, val: val });
  };

  ArrayOperation.NOP = NOP;
  ArrayOperation.DELETE = DELETE;
  ArrayOperation.INSERT = INSERT;

  // Export
  // ========

  module.exports = ArrayOperation;

  function Conflict$1(a, b) {
    Error.call(this, "Conflict: " + JSON.stringify(a) +" vs " + JSON.stringify(b));
    this.a = a;
    this.b = b;
  }
  Conflict$1.prototype = Error.prototype;

  module.exports = Conflict$1;

  var isArray$1 = require('lodash/isArray');
  var isString$3 = require('lodash/isString');
  var each$3 = require('lodash/each');
  var cloneDeep$3 = require('lodash/cloneDeep');
  var EventEmitter$6 = require('../../util/EventEmitter');
  var DataObject = require('./DataObject');
  var NodeFactory = require('./NodeFactory');

  /**
    A data storage implemention that supports data defined via a {@link model/data/Schema},
    and incremental updates which are backed by a OT library.

    It forms the underlying implementation for {@link model/Document}.

    @private
    @class Data
    @extends util/EventEmitter
   */

  /**
    @constructor
    @param {Schema} schema
    @param {Object} [options]
  */
  function Data(schema, options) {
    EventEmitter$6.call(this);

    options = options || {};

    this.schema = schema;
    this.nodes = new DataObject();
    this.indexes = {};
    this.options = options || {};

    this.nodeFactory = options.nodeFactory || new NodeFactory(schema.nodeRegistry);

    // Sometimes necessary to resolve issues with updating indexes in presence
    // of cyclic dependencies
    this.__QUEUE_INDEXING__ = false;
    this.queue = [];
  }

  Data.Prototype = function() {

    /**
      Check if this storage contains a node with given id.

      @returns {Boolean} `true` if a node with id exists, `false` otherwise.
     */
    this.contains = function(id) {
      return Boolean(this.nodes[id]);
    };

    /**
      Get a node or value via path.

      @param {String|String[]} path node id or path to property.
      @returns {Node|Object|Primitive|undefined} a Node instance, a value or undefined if not found.
     */
    this.get = function(path, strict) {
      if (!path) {
        throw new Error('Path or id required');
      }
      var result = this.nodes.get(path);
      if (strict && result === undefined) {
        if (isString$3(path)) {
          throw new Error("Could not find node with id '"+path+"'.");
        } else {
          throw new Error("Property for path '"+path+"' us undefined.");
        }
      }
      return result;
    };

    /**
      Get the internal storage for nodes.

      @return The internal node storage.
     */
    this.getNodes = function() {
      return this.nodes;
    };

    /**
      Create a node from the given data.

      @return {Node} The created node.
     */
    this.create = function(nodeData) {
      var node = this.nodeFactory.create(nodeData.type, nodeData);
      if (!node) {
        throw new Error('Illegal argument: could not create node for data:', nodeData);
      }
      if (this.contains(node.id)) {
        throw new Error("Node already exists: " + node.id);
      }
      if (!node.id || !node.type) {
        throw new Error("Node id and type are mandatory.");
      }
      this.nodes[node.id] = node;

      var change = {
        type: 'create',
        node: node
      };

      if (this.__QUEUE_INDEXING__) {
        this.queue.push(change);
      } else {
        this._updateIndexes(change);
      }

      return node;
    };

    /**
      Delete the node with given id.

      @param {String} nodeId
      @returns {Node} The deleted node.
     */
    this.delete = function(nodeId) {
      var node = this.nodes[nodeId];
      node.dispose();
      delete this.nodes[nodeId];

      var change = {
        type: 'delete',
        node: node,
      };

      if (this.__QUEUE_INDEXING__) {
        this.queue.push(change);
      } else {
        this._updateIndexes(change);
      }

      return node;
    };

    /**
      Set a property to a new value.

      @param {Array} property path
      @param {Object} newValue
      @returns {Node} The deleted node.
     */
    this.set = function(path, newValue) {
      var node = this.get(path[0]);
      var oldValue = this.nodes.get(path);
      this.nodes.set(path, newValue);

      var change = {
        type: 'set',
        node: node,
        path: path,
        newValue: newValue,
        oldValue: oldValue
      };

      if (this.__QUEUE_INDEXING__) {
        this.queue.push(change);
      } else {
        this._updateIndexes(change);
      }

      return oldValue;
    };

    /**
      Update a property incrementally.

      DEPRECATED: this will be replaced in Beta 3 with a more intuitive API.

      @param {Array} property path
      @param {Object} diff
      @returns {any} The value before applying the update.

      @deprecated

    */
    this.update = function(path, diff) {
      // TODO: do we really want this incremental implementation here?
      var oldValue = this.nodes.get(path);
      var newValue;
      if (diff.isOperation) {
        newValue = diff.apply(oldValue);
      } else {
        var start, end, pos, val;
        if (isString$3(oldValue)) {
          if (diff['delete']) {
            // { delete: [2, 5] }
            start = diff['delete'].start;
            end = diff['delete'].end;
            newValue = oldValue.split('').splice(start, end-start).join('');
          } else if (diff['insert']) {
            // { insert: [2, "foo"] }
            pos = diff['insert'].offset;
            val = diff['insert'].value;
            newValue = [oldValue.substring(0, pos), val, oldValue.substring(pos)].join('');
          } else {
            throw new Error('Diff is not supported:', JSON.stringify(diff));
          }
        } else if (isArray$1(oldValue)) {
          newValue = oldValue.slice(0);
          if (diff['delete']) {
            // { delete: 2 }
            pos = diff['delete'].offset;
            newValue.splice(pos, 1);
          } else if (diff['insert']) {
            // { insert: [2, "foo"] }
            pos = diff['insert'].offset;
            val = diff['insert'].value;
            newValue.splice(pos, 0, val);
          } else {
            throw new Error('Diff is not supported:', JSON.stringify(diff));
          }
        } else {
          throw new Error('Diff is not supported:', JSON.stringify(diff));
        }
      }
      this.nodes.set(path, newValue);
      var node = this.get(path[0]);

      var change = {
        type: 'update',
        node: node,
        path: path,
        newValue: newValue,
        oldValue: oldValue
      };

      if (this.__QUEUE_INDEXING__) {
        this.queue.push(change);
      } else {
        this._updateIndexes(change);
      }

      return oldValue;
    };

    /**
      Convert to JSON.

      DEPRECATED: We moved away from having JSON as first-class exchange format.
      We will remove this soon.

      @private
      @returns {Object} Plain content.
      @deprecated
     */
    this.toJSON = function() {
      return {
        schema: [this.schema.id, this.schema.version],
        nodes: cloneDeep$3(this.nodes)
      };
    };

    /**
      Clear nodes.

      @private
     */
    this.reset = function() {
      this.nodes.clear();
    };

    /**
      Add a node index.

      @param {String} name
      @param {NodeIndex} index
     */
    this.addIndex = function(name, index) {
      if (this.indexes[name]) {
        console.error('Index with name %s already exists.', name);
      }
      index.reset(this);
      this.indexes[name] = index;
      return index;
    };

    /**
      Get the node index with given name.

      @param {String} name
      @returns {NodeIndex} The node index.
     */
    this.getIndex = function(name) {
      return this.indexes[name];
    };

    /**
      Update a node index by providing of change object.

      @param {Object} change
     */
    this._updateIndexes = function(change) {
      if (!change || this.__QUEUE_INDEXING__) return;
      each$3(this.indexes, function(index) {
        if (index.select(change.node)) {
          if (!index[change.type]) {
            console.error('Contract: every NodeIndex must implement ' + change.type);
          }
          index[change.type](change.node, change.path, change.newValue, change.oldValue);
        }
      });
    };

    /**
      Stops indexing process, all changes will be collected in indexing queue.
    */
    this._stopIndexing = function() {
      this.__QUEUE_INDEXING__ = true;
    };

    /**
      Update all index changes from indexing queue.
    */
    this._startIndexing = function() {
      this.__QUEUE_INDEXING__ = false;
      while(this.queue.length >0) {
        var change = this.queue.shift();
        this._updateIndexes(change);
      }
    };

  };

  EventEmitter$6.extend(Data);

  module.exports = Data;

  var isString$4 = require('lodash/isString');
  var isArray$2 = require('lodash/isArray');
  var get = require('lodash/get');
  var setWith = require('lodash/setWith');
  var unset = require('lodash/unset');
  var oo$9 = require('../../util/oo');

  /*
    An object that can be access via path API.

    @class
    @param {object} [obj] An object to operate on
    @example

    var obj = new DataObject({a: "aVal", b: {b1: 'b1Val', b2: 'b2Val'}});
  */

  function DataObject$1(root) {
    if (root) {
      this.__root__ = root;
    }
  }

  DataObject$1.Prototype = function() {

    this._isDataObject = true;

    this.getRoot = function() {
      if (this.__root__) {
        return this.__root__;
      } else {
        return this;
      }
    };

    /**
      Get value at path

      @return {object} The value stored for a given path

      @example

      obj.get(['b', 'b1']);
      => b1Val
    */
    this.get = function(path) {
      if (!path) {
        return undefined;
      }
      if (isString$4(path)) {
        return this.getRoot()[path];
      }
      if (arguments.length > 1) {
        path = Array.prototype.slice(arguments, 0);
      }
      if (!isArray$2(path)) {
        throw new Error('Illegal argument for DataObject.get()');
      }
      return get(this.getRoot(), path);
    };

    this.set = function(path, value) {
      if (!path) {
        throw new Error('Illegal argument: DataObject.set(>path<, value) - path is mandatory.');
      }
      if (isString$4(path)) {
        this.getRoot()[path] = value;
      } else {
        setWith(this.getRoot(), path, value);
      }
    };

    this.delete = function(path) {
      if (isString$4(path)) {
        delete this.getRoot()[path];
      } else if (path.length === 1) {
        delete this.getRoot()[path[0]];
      } else {
        var success = unset(this.getRoot(), path);
        if (!success) {
          throw new Error('Could not delete property at path' + path);
        }
      }
    };

    this.clear = function() {
      var root = this.getRoot();
      for (var key in root) {
        if (root.hasOwnProperty(key)) {
          delete root[key];
        }
      }
    };

  };

  oo$9.initClass(DataObject$1);

  module.exports = DataObject$1;

  var isString$5 = require('lodash/isString');
  var isArray$3 = require('lodash/isArray');
  var cloneDeep$4 = require('lodash/cloneDeep');
  var Data$1 = require('./Data');
  var ObjectOperation = require('./ObjectOperation');
  var ArrayOperation$1 = require('./ArrayOperation');
  var TextOperation = require('./TextOperation');

  /**
    Incremental data storage implemention.

    @class IncrementalData
    @extends model/data/Data
    @private
   */

  /**
    @constructor
    @param {Schema} schema
    @param {Object} [options]
  */
  function IncrementalData(schema, options) {
    IncrementalData.super.call(this, schema, options);
  }

  IncrementalData.Prototype = function() {

    var _super = IncrementalData.super.prototype;

    /**
      Create a new node.

      @param {Object} nodeData
      @returns {ObjectOperation} The applied operation.
     */
    this.create = function(nodeData) {
      var op = ObjectOperation.Create([nodeData.id], nodeData);
      this.apply(op);
      return op;
    };

    /**
      Delete a node.

      @param {String} nodeId
      @returns {ObjectOperation} The applied operation.
     */
    this.delete = function(nodeId) {
      var op = null;
      var node = this.get(nodeId);
      if (node) {
        var nodeData = node.toJSON();
        op = ObjectOperation.Delete([nodeId], nodeData);
        this.apply(op);
      }
      return op;
    };

    /**
      Update a property incrementally.

      The diff can be of the following forms (depending on the updated property type):
        - String:
          - `{ insert: { offset: Number, value: Object } }`
          - `{ delete: { start: Number, end: Number } }`
        - Array:
          - `{ insert: { offset: Number, value: Object } }`
          - `{ delete: { offset: Number } }`

      @param {Array} path
      @param {Object} diff
      @returns {ObjectOperation} The applied operation.
    */
    this.update = function(path, diff) {
      var diffOp = this._getDiffOp(path, diff);
      var op = ObjectOperation.Update(path, diffOp);
      this.apply(op);
      return op;
    };

    /**
      Set a property to a new value

      @param {Array} path
      @param {Object} newValue
      @returns {ObjectOperation} The applied operation.
     */
    this.set = function(path, newValue) {
      var oldValue = this.get(path);
      var op = ObjectOperation.Set(path, oldValue, newValue);
      this.apply(op);
      return op;
    };

    /**
      Apply a given operation.

      @param {ObjectOperation} op
     */
    this.apply = function(op) {
      if (op.type === ObjectOperation.NOP) return;
      else if (op.type === ObjectOperation.CREATE) {
        // clone here as the operations value must not be changed
        _super.create.call(this, cloneDeep$4(op.val));
      } else if (op.type === ObjectOperation.DELETE) {
        _super.delete.call(this, op.val.id);
      } else if (op.type === ObjectOperation.UPDATE) {
        var oldVal = this.get(op.path);
        var diff = op.diff;
        if (op.propertyType === 'array') {
          if (! (diff._isArrayOperation) ) {
            diff = ArrayOperation$1.fromJSON(diff);
          }
          // array ops work inplace
          diff.apply(oldVal);
        } else if (op.propertyType === 'string') {
          if (! (diff._isTextOperation) ) {
            diff = TextOperation.fromJSON(diff);
          }
          var newVal = diff.apply(oldVal);
          _super.set.call(this, op.path, newVal);
        } else {
          throw new Error("Unsupported type for operational update.");
        }
      } else if (op.type === ObjectOperation.SET) {
        _super.set.call(this, op.path, op.val);
      } else {
        throw new Error("Illegal state.");
      }
      this.emit('operation:applied', op, this);
    };

    /**
      Creates proper operation based on provided node path and diff.

      @param {Array} path
      @param {Object} diff
      @returns {ObjectOperation} operation.

      @private
    */
    this._getDiffOp = function(path, diff) {
      var diffOp = null;
      if (diff.isOperation) {
        diffOp = diff;
      } else {
        var value = this.get(path);
        var start, end, pos, val;
        if (value === null || value === undefined) {
          throw new Error('Property has not been initialized: ' + JSON.stringify(path));
        } else if (isString$5(value)) {
          if (diff['delete']) {
            // { delete: [2, 5] }
            start = diff['delete'].start;
            end = diff['delete'].end;
            diffOp = TextOperation.Delete(start, value.substring(start, end));
          } else if (diff['insert']) {
            // { insert: [2, "foo"] }
            pos = diff['insert'].offset;
            val = diff['insert'].value;
            diffOp = TextOperation.Insert(pos, val);
          }
        } else if (isArray$3(value)) {
          if (diff['delete']) {
            // { delete: 2 }
            pos = diff['delete'].offset;
            diffOp = ArrayOperation$1.Delete(pos, value[pos]);
          } else if (diff['insert']) {
            // { insert: [2, "foo"] }
            pos = diff['insert'].offset;
            val = diff['insert'].value;
            diffOp = ArrayOperation$1.Insert(pos, val);
          }
        }
      }
      if (!diffOp) {
        throw new Error('Unsupported diff: ' + JSON.stringify(diff));
      }
      return diffOp;
    };

  };

  Data$1.extend(IncrementalData);

  module.exports = IncrementalData;

  var isBoolean = require('lodash/isBoolean');
  var isNumber$5 = require('lodash/isNumber');
  var isString$6 = require('lodash/isString');
  var isArray$4 = require('lodash/isArray');
  var isObject = require('lodash/isObject');
  var cloneDeep$5 = require('lodash/cloneDeep');
  var each$4 = require('lodash/each');
  var extend$3 = require('lodash/extend');
  var EventEmitter$7 = require('../../util/EventEmitter');

  /**
    Base node implementation.

    @private
    @class Node
    @node
    @extends EventEmitter
    @param {Object} properties

    @prop {String} id an id that is unique within this data
   */
  function Node(props) {
    EventEmitter$7.call(this);

    var NodeClass = this.constructor;

    if (!NodeClass.static.name) {
      throw new Error('Every NodeClass must provide a static property "name".');
    }

    each$4(NodeClass.static.schema, function(prop, name) {
      // check integrity of provided props, such as type correctness,
      // and mandatory properties
      var propIsGiven = (props[name] !== undefined);
      var hasDefault = prop.hasOwnProperty('default');
      var isOptional = prop.optional;
      if ( (!isOptional && !hasDefault) && !propIsGiven) {
        throw new Error('Property ' + name + ' is mandatory for node type ' + this.type);
      }
      if (propIsGiven) {
        this[name] = _checked(prop, props[name]);
      } else if (hasDefault) {
        this[name] = cloneDeep$5(_checked(prop, prop.default));
      }
    }.bind(this));
  }

  Node.Prototype = function() {

    this._isNode = true;


    this.dispose = function() {};

    /**
      Check if the node is of a given type.

      @param {String} typeName
      @returns {Boolean} true if the node has a parent with given type, false otherwise.
    */
    this.isInstanceOf = function(typeName) {
      return Node.isInstanceOf(this.constructor, typeName);
    };

    /**
      Get a the list of all polymorphic types.

      @returns {String[]} An array of type names.
     */
    this.getTypeNames = function() {
      var typeNames = [];
      var staticData = this.constructor.static;
      while (staticData && staticData.name !== "node") {
        typeNames.push(staticData.name);
        staticData = Object.getPrototypeOf(staticData);
      }
      return typeNames;
    };

    /**
     * Get the type of a property.
     *
     * @param {String} propertyName
     * @returns The property's type.
     */
    this.getPropertyType = function(propertyName) {
      var schema = this.constructor.static.schema;
      return schema[propertyName].type;
    };

    /**
      Convert node to JSON.

      @returns {Object} JSON representation of node.
     */
    this.toJSON = function() {
      var data = {
        type: this.constructor.static.name
      };
      each$4(this.constructor.static.schema, function(prop, name) {
        data[prop.name] = this[name];
      }.bind(this));
      return data;
    };

  };

  EventEmitter$7.extend(Node);

  /**
   * Symbolic name for this model class. Must be set to a unique string by every subclass.
   *
   * @static
   * @type {String}
   */
  Node.static.name = "node";

  Node.static.defineSchema = function(schema) {
    // in ES6 we would just `this` which is bound to the class
    var NodeClass = this.__class__;
    _defineSchema(NodeClass, schema);
  };

  Node.static.defineSchema({
    id: 'string'
  });

  Object.defineProperty(Node.prototype, 'type', {
    configurable: false,
    get: function() {
      return this.constructor.static.name;
    },
    set: function() {
      throw new Error('Property "type" is read-only.');
    }
  });

  /**
    Internal implementation of Node.prototype.isInstanceOf.

    @static
    @private
    @returns {Boolean}
   */
  Node.isInstanceOf = function(NodeClass, typeName) {
    var staticData = NodeClass.static;
    while (staticData && staticData.name !== "node") {
      if (staticData && staticData.name === typeName) {
        return true;
      }
      staticData = Object.getPrototypeOf(staticData);
    }
    return false;
  };

  Node.static.isInstanceOf = Node.isInstanceOf;

  // ### Internal implementation

  function _defineSchema(NodeClass, schema) {
    var compiledSchema = _compileSchema(schema);
    // collects a full schema considering the schemas of parent class
    // we will use the unfolded schema, check integrity of the given props (mandatory, readonly)
    // or fill in default values for undefined properties.
    NodeClass.static.schema = _unfoldedSchema(NodeClass, compiledSchema);
    // computes the set of default properties only once
    NodeClass.static.defaultProps = _extractDefaultProps(NodeClass);

    // still we need that for container, hopefully we find a better approach soon
    if (!NodeClass.static.hasOwnProperty('addressablePropertyNames')) {
      var addressablePropertyNames = [];
      each$4(NodeClass.static.schema, function(prop, name) {
        if (prop.type === "string" && prop.addressable === true) {
          addressablePropertyNames.push(name);
        }
      });
      NodeClass.static.addressablePropertyNames = addressablePropertyNames;
    }
  }

  function _compileSchema(schema) {
    var compiledSchema = {};
    each$4(schema, function(definition, name) {
      if (isString$6(definition) || isArray$4(definition)) {
        definition = { type: definition };
      }
      definition = _compileDefintion(definition);
      definition.name = name;
      compiledSchema[name] = definition;
    });
    return compiledSchema;
  }

  function _compileDefintion(definition) {
    var result = definition;
    if (isArray$4(definition.type) && definition[0] !== "array") {
      definition.type = [ "array", definition.type[0] ];
    } else if (definition.type === 'text') {
      result = {
        type: "string",
        addressable: true,
        default: ''
      };
    }
    return result;
  }

  function _unfoldedSchema(NodeClass, compiledSchema) {
    var schemas = [compiledSchema];
    var clazz = NodeClass;
    while(clazz) {
      var parentProto = Object.getPrototypeOf(clazz.prototype);
      if (!parentProto) {
        break;
      }
      clazz = parentProto.constructor;
      if (clazz && clazz.static && clazz.static.schema) {
        schemas.unshift(clazz.static.schema);
      }
    }
    schemas.unshift({});
    return extend$3.apply(null, schemas);
  }

  function _extractDefaultProps(NodeClass) {
    var unfoldedSchema = NodeClass.static.unfoldedSchema;
    var defaultProps = {};
    each$4(unfoldedSchema, function(prop, name) {
      if (prop.hasOwnProperty('default')) {
        defaultProps[name] = prop['default'];
      }
    });
    return defaultProps;
  }

  function _checked(prop, value) {
    var type;
    if (isArray$4(prop.type)) {
      type = "array";
    } else {
      type = prop.type;
    }
    if (value === null) {
      if (prop.notNull) {
        throw new Error('Value for property ' + prop.name + ' is null.');
      } else {
        return value;
      }
    }
    if (value === undefined) {
      throw new Error('Value for property ' + prop.name + ' is undefined.');
    }
    if (type === "string" && !isString$6(value) ||
        type === "boolean" && !isBoolean(value) ||
        type === "number" && !isNumber$5(value) ||
        type === "array" && !isArray$4(value) ||
        type === "id" && !isString$6(value) ||
        type === "object" && !isObject(value)) {
      throw new Error('Illegal value type for property ' + prop.name + ': expected ' + type + ', was ' + (typeof value));
    }
    return value;
  }

  module.exports = Node;

  var oo$a = require('../../util/oo');

  function NodeFactory$1(nodeRegistry) {
    this.nodeRegistry = nodeRegistry;
  }

  NodeFactory$1.Prototype = function() {

    this.create = function(nodeType, nodeData) {
      var NodeClass = this.nodeRegistry.get(nodeType);
      if (!NodeClass) {
        throw new Error('No Node registered by that name: ' + nodeType);
      }
      return new NodeClass(nodeData);
    };

  };

  oo$a.initClass(NodeFactory$1);

  module.exports = NodeFactory$1;

  var oo$b = require('../../util/oo');
  var isArray$5 = require('lodash/isArray');
  var each$5 = require('lodash/each');
  var extend$4 = require('lodash/extend');
  var TreeIndex$3 = require('../../util/TreeIndex');

  /**
    Index for Nodes.

    Node indexes are first-class citizens in {@link model/data/Data}.
    I.e., they are updated after each operation, and before any other listener is notified.

    @class
    @abstract
   */
  function NodeIndex() {
    /**
     * Internal storage.
     *
     * @property {TreeIndex} index
     * @private
     */
    this.index = new TreeIndex$3();
  }

  NodeIndex.Prototype = function() {

    /**
     * Get all indexed nodes for a given path.
     *
     * @param {Array<String>} path
     * @returns A node or an object with ids and nodes as values.
     */
    this.get = function(path) {
      return this.index.get(path) || {};
    };

    /**
     * Collects nodes recursively.
     *
     * @returns An object with ids as keys and nodes as values.
     */
    this.getAll = function(path) {
      return this.index.getAll(path);
    };

    /**
     * The property used for indexing.
     *
     * @private
     * @type {String}
     */
    this.property = "id";

    /**
     * Check if a node should be indexed.
     *
     * Used internally only. Override this in subclasses to achieve a custom behavior.
     *
     * @private
     * @param {model/data/Node}
     * @returns {Boolean} true if the given node should be added to the index.
     */
    this.select = function(node) {
      if(!this.type) {
        return true;
      } else {
        return node.isInstanceOf(this.type);
      }
    };

    /**
     * Called when a node has been created.
     *
     * Override this in subclasses for customization.
     *
     * @private
     * @param {model/data/Node} node
     */
    this.create = function(node) {
      var values = node[this.property];
      if (!isArray$5(values)) {
        values = [values];
      }
      each$5(values, function(value) {
        this.index.set([value, node.id], node);
      }.bind(this));
    };

    /**
     * Called when a node has been deleted.
     *
     * Override this in subclasses for customization.
     *
     * @private
     * @param {model/data/Node} node
     */
    this.delete = function(node) {
      var values = node[this.property];
      if (!isArray$5(values)) {
        values = [values];
      }
      each$5(values, function(value) {
        this.index.delete([value, node.id]);
      }.bind(this));
    };

    /**
     * Called when a property has been updated.
     *
     * Override this in subclasses for customization.
     *
     * @private
     * @param {model/data/Node} node
     */
    this.update = function(node, path, newValue, oldValue) {
      if (!this.select(node) || path[1] !== this.property) return;
      var values = oldValue;
      if (!isArray$5(values)) {
        values = [values];
      }
      each$5(values, function(value) {
        this.index.delete([value, node.id]);
      }.bind(this));
      values = newValue;
      if (!isArray$5(values)) {
        values = [values];
      }
      each$5(values, function(value) {
        this.index.set([value, node.id], node);
      }.bind(this));
    };

    this.set = function(node, path, newValue, oldValue) {
      this.update(node, path, newValue, oldValue);
    };

    /**
     * Reset the index using a Data instance.
     *
     * @private
     */
    this.reset = function(data) {
      this.index.clear();
      this._initialize(data);
    };

    /**
     * Clone this index.
     *
     * @return A cloned NodeIndex.
     */
    this.clone = function() {
      var NodeIndexClass = this.constructor;
      var clone = new NodeIndexClass();
      return clone;
    };

    this._initialize = function(data) {
      each$5(data.getNodes(), function(node) {
        if (this.select(node)) {
          this.create(node);
        }
      }.bind(this));
    };

  };

  oo$b.initClass( NodeIndex );

  /**
   * Create a new NodeIndex using the given prototype as mixin.
   *
   * @param {Object} prototype
   * @static
   * @returns {model/data/NodeIndex} A customized NodeIndex.
   */
  NodeIndex.create = function(prototype) {
    var index = extend$4(new NodeIndex(), prototype);
    index.clone = function() {
      return NodeIndex.create(prototype);
    };
    return index;
  };

  NodeIndex.filterByType = function(type) {
    return function(node) {
      return node.isInstanceOf(type);
    };
  };

  module.exports = NodeIndex;

  var Registry = require('../../util/Registry');

  /**
    Registry for Nodes.

    @class NodeRegistry
    @extends util/Registry
   */
  function NodeRegistry() {
    Registry.call(this);
  }

  NodeRegistry.Prototype = function() {

    /**
      Register a Node class.

      @param {Class} nodeClass
     */
    this.register = function (nodeClazz) {
      var name = nodeClazz.static && nodeClazz.static.name;
      if ( typeof name !== 'string' || name === '' ) {
        throw new Error( 'Node names must be strings and must not be empty' );
      }
      if ( !( nodeClazz.prototype._isNode) ) {
        throw new Error( 'Nodes must be subclasses of Substance.Data.Node' );
      }
      if (this.contains(name)) {
        throw new Error('Node class is already registered: ' + name);
      }
      this.add(name, nodeClazz);
    };

  };

  Registry.extend(NodeRegistry);

  module.exports = NodeRegistry;

  var isString$7 = require('lodash/isString');
  var isEqual$4 = require('lodash/isEqual');
  var cloneDeep$6 = require('lodash/cloneDeep');
  var DataObject$2 = require('./DataObject');
  var Operation$1 = require('./Operation');
  var TextOperation$1 = require('./TextOperation');
  var ArrayOperation$2 = require('./ArrayOperation');
  var Conflict$2 = require('./Conflict');

  var NOP$1 = "NOP";
  var CREATE = "create";
  var DELETE$1 = 'delete';
  var UPDATE = 'update';
  var SET = 'set';

  /*
    @class
    @extends Operation
  */
  function ObjectOperation$1(data) {
    Operation$1.call(this);
    if (!data) {
      throw new Error('Data of ObjectOperation is missing.');
    }
    if (!data.type) {
      throw new Error('Invalid data: type is mandatory.');
    }
    this.type = data.type;
    if (data.type === NOP$1) {
      return;
    }
    this.path = data.path;
    if (!data.path) {
      throw new Error('Invalid data: path is mandatory.');
    }
    if (this.type === CREATE || this.type === DELETE$1) {
      if (!data.val) {
        throw new Error('Invalid data: value is missing.');
      }
      this.val = data.val;
    }
    else if (this.type === UPDATE) {
      if (data.diff) {
        this.diff = data.diff;
        if (data.diff._isTextOperation) {
          this.propertyType = 'string';
        } else if (data.diff._isArrayOperation) {
          this.propertyType = 'array';
        } else {
          throw new Error('Invalid data: diff must be a TextOperation or an ArrayOperation.');
        }
      } else {
        throw new Error("Invalid data: diff is mandatory for update operation.");
      }
    }
    else if (this.type === SET) {
      this.val = data.val;
      this.original = data.original;
    } else {
      throw new Error('Invalid type: '+ data.type);
    }
  }

  ObjectOperation$1.fromJSON = function(data) {
    data = cloneDeep$6(data);
    if (data.type === "update") {
      switch (data.propertyType) {
        case "string":
          data.diff = TextOperation$1.fromJSON(data.diff);
          break;
        case "array":
          data.diff = ArrayOperation$2.fromJSON(data.diff);
          break;
        default:
          throw new Error("Unsupported update diff:" + JSON.stringify(data.diff));
      }
    }
    var op = new ObjectOperation$1(data);
    return op;
  };

  ObjectOperation$1.Prototype = function() {

    this._isObjectOperation = true;

    this.apply = function(obj) {
      if (this.type === NOP$1) return obj;
      var adapter;
      if (obj._isDataObject) {
        adapter = obj;
      } else {
        adapter = new DataObject$2(obj);
      }
      if (this.type === CREATE) {
        adapter.set(this.path, cloneDeep$6(this.val));
        return obj;
      }
      if (this.type === DELETE$1) {
        adapter.delete(this.path, "strict");
      }
      else if (this.type === UPDATE) {
        var diff = this.diff;
        var oldVal = adapter.get(this.path);
        var newVal;
        if (diff._isArrayOperation) {
          newVal = diff.apply(oldVal);
        } else {
          newVal = diff.apply(oldVal);
        }
        adapter.set(this.path, newVal);
      }
      else /* if (this.type === SET) */ {
        // clone here as the operations value must not be changed
        adapter.set(this.path, cloneDeep$6(this.val));
      }
      return obj;
    };

    this.clone = function() {
      var data = {
        type: this.type,
        path: this.path,
      };
      if (this.val) {
        data.val = cloneDeep$6(this.val);
      }
      if (this.diff) {
        data.diff = this.diff.clone();
      }
      return new ObjectOperation$1(data);
    };

    this.isNOP = function() {
      if (this.type === NOP$1) return true;
      else if (this.type === UPDATE) return this.diff.isNOP();
    };

    this.isCreate = function() {
      return this.type === CREATE;
    };

    this.isDelete = function() {
      return this.type === DELETE$1;
    };

    this.isUpdate = function(propertyType) {
      if (propertyType) {
        return (this.type === UPDATE && this.propertyType === propertyType);
      } else {
        return this.type === UPDATE;
      }
    };

    this.isSet = function() {
      return this.type === SET;
    };

    this.invert = function() {
      if (this.type === NOP$1) {
        return new ObjectOperation$1({ type: NOP$1 });
      }
      var result = new ObjectOperation$1(this);
      if (this.type === CREATE) {
        result.type = DELETE$1;
      }
      else if (this.type === DELETE$1) {
        result.type = CREATE;
      }
      else if (this.type === UPDATE) {
        var invertedDiff;
        if (this.diff._isTextOperation) {
          invertedDiff = TextOperation$1.fromJSON(this.diff.toJSON()).invert();
        } else {
          invertedDiff = ArrayOperation$2.fromJSON(this.diff.toJSON()).invert();
        }
        result.diff = invertedDiff;
      }
      else /* if (this.type === SET) */ {
        result.val = this.original;
        result.original = this.val;
      }
      return result;
    };

    this.hasConflict = function(other) {
      return ObjectOperation$1.hasConflict(this, other);
    };

    this.toJSON = function() {
      if (this.type === NOP$1) {
        return { type: NOP$1 };
      }
      var data = {
        type: this.type,
        path: this.path,
      };
      if (this.type === CREATE || this.type === DELETE$1) {
        data.val = this.val;
      }
      else if (this.type === UPDATE) {
        if (this.diff._isArrayOperation) {
          data.propertyType = "array";
        } else /* if (this.diff._isTextOperation) */ {
          data.propertyType = "string";
        }
        data.diff = this.diff.toJSON();
      }
      else /* if (this.type === SET) */ {
        data.val = this.val;
        data.original = this.original;
      }
      return data;
    };

    this.getType = function() {
      return this.type;
    };

    this.getPath = function() {
      return this.path;
    };

    this.getValue = function() {
      return this.val;
    };

    this.getOldValue = function() {
      return this.original;
    };

    this.getValueOp = function() {
      return this.diff;
    };

    this.toString = function() {
      switch (this.type) {
        case CREATE:
          return ["(+,", JSON.stringify(this.path), JSON.stringify(this.val), ")"].join('');
        case DELETE$1:
          return ["(-,", JSON.stringify(this.path), JSON.stringify(this.val), ")"].join('');
        case UPDATE:
          return ["(>>,", JSON.stringify(this.path), this.propertyType, this.diff.toString(), ")"].join('');
        case SET:
          return ["(=,", JSON.stringify(this.path), this.val, this.original, ")"].join('');
        case NOP$1:
          return "NOP";
        default:
          throw new Error('Invalid type');
      }
    };
  };

  Operation$1.extend(ObjectOperation$1);

  /* Low level implementation */

  var hasConflict$1 = function(a, b) {
    if (a.type === NOP$1 || b.type === NOP$1) return false;
    return isEqual$4(a.path, b.path);
  };

  var transform_delete_delete$1 = function(a, b) {
    // both operations have the same effect.
    // the transformed operations are turned into NOPs
    a.type = NOP$1;
    b.type = NOP$1;
  };

  var transform_create_create = function() {
    throw new Error("Can not transform two concurring creates of the same property");
  };

  var transform_delete_create = function() {
    throw new Error('Illegal state: can not create and delete a value at the same time.');
  };

  var transform_delete_update = function(a, b, flipped) {
    if (a.type !== DELETE$1) {
      return transform_delete_update(b, a, true);
    }
    var op;
    if (b.propertyType === 'string') {
      op = TextOperation$1.fromJSON(b.diff);
    } else /* if (b.propertyType === 'array') */ {
      op = ArrayOperation$2.fromJSON(b.diff);
    }
    // (DELETE, UPDATE) is transformed into (DELETE, CREATE)
    if (!flipped) {
      a.type = NOP$1;
      b.type = CREATE;
      b.val = op.apply(a.val);
    }
    // (UPDATE, DELETE): the delete is updated to delete the updated value
    else {
      a.val = op.apply(a.val);
      b.type = NOP$1;
    }
  };

  var transform_create_update = function() {
    // it is not possible to reasonably transform this.
    throw new Error("Can not transform a concurring create and update of the same property");
  };

  var transform_update_update = function(a, b) {
    // Note: this is a conflict the user should know about
    var op_a, op_b, t;
    if (b.propertyType === 'string') {
      op_a = TextOperation$1.fromJSON(a.diff);
      op_b = TextOperation$1.fromJSON(b.diff);
      t = TextOperation$1.transform(op_a, op_b, {inplace: true});
    } else /* if (b.propertyType === 'array') */ {
      op_a = ArrayOperation$2.fromJSON(a.diff);
      op_b = ArrayOperation$2.fromJSON(b.diff);
      t = ArrayOperation$2.transform(op_a, op_b, {inplace: true});
    }
    a.diff = t[0];
    b.diff = t[1];
  };

  var transform_create_set = function() {
    throw new Error('Illegal state: can not create and set a value at the same time.');
  };

  var transform_delete_set = function(a, b, flipped) {
    if (a.type !== DELETE$1) return transform_delete_set(b, a, true);
    if (!flipped) {
      a.type = NOP$1;
      b.type = CREATE;
      b.original = undefined;
    } else {
      a.val = b.val;
      b.type = NOP$1;
    }
  };

  var transform_update_set = function() {
    throw new Error("Unresolvable conflict: update + set.");
  };

  var transform_set_set = function(a, b) {
    a.type = NOP$1;
    b.original = a.val;
  };

  var _NOP = 0;
  var _CREATE = 1;
  var _DELETE = 2;
  var _UPDATE = 4;
  var _SET = 8;

  var CODE = {};
  CODE[NOP$1] =_NOP;
  CODE[CREATE] = _CREATE;
  CODE[DELETE$1] = _DELETE;
  CODE[UPDATE] = _UPDATE;
  CODE[SET] = _SET;

  /* eslint-disable no-multi-spaces */
  var __transform__ = [];
  __transform__[_DELETE | _DELETE] = transform_delete_delete$1;
  __transform__[_DELETE | _CREATE] = transform_delete_create;
  __transform__[_DELETE | _UPDATE] = transform_delete_update;
  __transform__[_CREATE | _CREATE] = transform_create_create;
  __transform__[_CREATE | _UPDATE] = transform_create_update;
  __transform__[_UPDATE | _UPDATE] = transform_update_update;
  __transform__[_CREATE | _SET   ] = transform_create_set;
  __transform__[_DELETE | _SET   ] = transform_delete_set;
  __transform__[_UPDATE | _SET   ] = transform_update_set;
  __transform__[_SET    | _SET   ] = transform_set_set;
  /* eslint-enable no-multi-spaces */

  var transform$1 = function(a, b, options) {
    options = options || {};
    if (options['no-conflict'] && hasConflict$1(a, b)) {
      throw new Conflict$2(a, b);
    }
    if (!options.inplace) {
      a = a.clone();
      b = b.clone();
    }
    if (a.isNOP() || b.isNOP()) {
      return [a, b];
    }
    var sameProp = isEqual$4(a.path, b.path);
    // without conflict: a' = a, b' = b
    if (sameProp) {
      __transform__[CODE[a.type] | CODE[b.type]](a,b);
    }
    return [a, b];
  };

  ObjectOperation$1.transform = transform$1;
  ObjectOperation$1.hasConflict = hasConflict$1;

  /* Factories */

  ObjectOperation$1.Create = function(idOrPath, val) {
    var path;
    if (isString$7(idOrPath)) {
      path = [idOrPath];
    } else {
      path = idOrPath;
    }
    return new ObjectOperation$1({type: CREATE, path: path, val: val});
  };

  ObjectOperation$1.Delete = function(idOrPath, val) {
    var path;
    if (isString$7(idOrPath)) {
      path = [idOrPath];
    } else {
      path = idOrPath;
    }
    return new ObjectOperation$1({type: DELETE$1, path: path, val: val});
  };

  ObjectOperation$1.Update = function(path, op) {
    return new ObjectOperation$1({
      type: UPDATE,
      path: path,
      diff: op
    });
  };

  ObjectOperation$1.Set = function(path, oldVal, newVal) {
    return new ObjectOperation$1({
      type: SET,
      path: path,
      val: cloneDeep$6(newVal),
      original: cloneDeep$6(oldVal)
    });
  };

  ObjectOperation$1.NOP = NOP$1;
  ObjectOperation$1.CREATE = CREATE;
  ObjectOperation$1.DELETE = DELETE$1;
  ObjectOperation$1.UPDATE = UPDATE;
  ObjectOperation$1.SET = SET;

  module.exports = ObjectOperation$1;

  var oo$c = require('../../util/oo');

  /*
    @class
  */
  function Operation$2() {}

  Operation$2.Prototype = function() {
    this.isOperation = true;
  };

  oo$c.initClass(Operation$2);

  module.exports = Operation$2;

  var isArray$6 = require('lodash/isArray');
  var isNumber$6 = require('lodash/isNumber');
  var isObject$1 = require('lodash/isObject');
  var oo$d = require('../../util/oo');
  var ObjectOperation$2 = require('./ObjectOperation');
  var TextOperation$2 = require('./TextOperation');
  var ArrayOperation$3 = require('./ArrayOperation');

  /*
    Specification:

    - create:
      ```
      'c <JSON.stringify(data)>'
      'c { id: "1123", type: "paragraph", content: ""}'
      ```
    - delete:
      ```
      'd <JSON.stringify(data)>'
      'd { id: "1123", type: "paragraph", content: ""}'
      ```
    - set a property
      ```
      's <property path> <value> <old value>'
      's p1.content foo'
      ```
    - update a property
      ```
      'u <property path> <primitive op>'
      'u p1.content t+ 4 foo'
      ```

  Primitive type operations:

    - insert text
      ```
      't+ <pos> <string>'
      't+ 4 foo'
      ```
    - delete text
      ```
      't- <pos> <string>'
      't- 4 foo'
      ```
    - insert value into array
      ```
      'a+ <pos> <value>'
      'a+ 0 p1'
      ```
    - delete value from array
      ```
      'a- <pos> <value>'
      'a- 0 p1'
      ```
  */

  function OperationSerializer() {
    this.SEPARATOR = '\t';
  }

  OperationSerializer.Prototype = function() {

    this.serialize = function(op) {
      var out = [];
      switch (op.type) {
        case 'create':
          out.push('c');
          out.push(op.val.id);
          out.push(op.val);
          break;
        case 'delete':
          out.push('d');
          out.push(op.val.id);
          out.push(op.val);
          break;
        case 'set':
          out.push('s');
          out.push(op.path.join('.'));
          out.push(op.val);
          out.push(op.original);
          break;
        case 'update':
          out.push('u');
          out.push(op.path.join('.'));
          Array.prototype.push.apply(out, this.serializePrimitiveOp(op.diff));
          break;
        default:
          throw new Error('Unsupported operation type.');
      }
      return out;
    };

    this.serializePrimitiveOp = function(op) {
      var out = [];
      if (op._isTextOperation) {
        if (op.isInsert()) {
          out.push('t+');
        } else if (op.isDelete()) {
          out.push('t-');
        }
        out.push(op.pos);
        out.push(op.str);
      } else if (op._isArrayOperation) {
        if (op.isInsert()) {
          out.push('a+');
        } else if (op.isDelete()) {
          out.push('a-');
        }
        out.push(op.pos);
        out.push(op.val);
      } else {
        throw new Error('Unsupported operation type.');
      }
      return out;
    };

    this.deserialize = function(str, tokenizer) {
      if (!tokenizer) {
        tokenizer = new Tokenizer(str, this.SEPARATOR);
      }
      var type = tokenizer.getString();
      var op, path, val, oldVal, diff;
      switch (type) {
        case 'c':
          path = tokenizer.getPath();
          val = tokenizer.getObject();
          op = ObjectOperation$2.Create(path, val);
          break;
        case 'd':
          path = tokenizer.getPath();
          val = tokenizer.getObject();
          op = ObjectOperation$2.Delete(path, val);
          break;
        case 's':
          path = tokenizer.getPath();
          val = tokenizer.getAny();
          oldVal = tokenizer.getAny();
          op = ObjectOperation$2.Set(path, oldVal, val);
          break;
        case 'u':
          path = tokenizer.getPath();
          diff = this.deserializePrimitiveOp(str, tokenizer);
          op = ObjectOperation$2.Update(path, diff);
          break;
        default:
          throw new Error('Illegal type for ObjectOperation: '+ type);
      }
      return op;
    };

    this.deserializePrimitiveOp = function(str, tokenizer) {
      if (!tokenizer) {
        tokenizer = new Tokenizer(str, this.SEPARATOR);
      }
      var type = tokenizer.getString();
      var op, pos, val;
      switch (type) {
        case 't+':
          pos = tokenizer.getNumber();
          val = tokenizer.getString();
          op = TextOperation$2.Insert(pos, val);
          break;
        case 't-':
          pos = tokenizer.getNumber();
          val = tokenizer.getString();
          op = TextOperation$2.Delete(pos, val);
          break;
        case 'a+':
          pos = tokenizer.getNumber();
          val = tokenizer.getAny();
          op = ArrayOperation$3.Insert(pos, val);
          break;
        case 'a-':
          pos = tokenizer.getNumber();
          val = tokenizer.getAny();
          op = ArrayOperation$3.Delete(pos, val);
          break;
        default:
          throw new Error('Unsupported operation type: ' + type);
      }
      return op;
    };
  };

  oo$d.initClass(OperationSerializer);

  function Tokenizer(str, sep) {
    if (isArray$6(arguments[0])) {
      this.tokens = arguments[0];
    } else {
      this.tokens = str.split(sep);
    }
    this.pos = -1;
  }

  Tokenizer.Prototype = function() {

    this.error = function(msg) {
      throw new Error('Parsing error: ' + msg + '\n' + this.tokens[this.pos]);
    };

    this.getString = function() {
      this.pos++;
      var str = this.tokens[this.pos];
      if (str[0] === '"') {
        str = str.slice(1, -1);
      }
      return str;
    };

    this.getNumber = function() {
      this.pos++;
      var number;
      var token = this.tokens[this.pos];
      try {
        if (isNumber$6(token)) {
          number = token;
        } else {
          number = parseInt(this.tokens[this.pos], 10);
        }
        return number;
      } catch (err) {
        this.error('expected number');
      }
    };

    this.getObject = function() {
      this.pos++;
      var obj;
      var token = this.tokens[this.pos];
      try {
        if (isObject$1(token)) {
          obj = token;
        } else {
          obj = JSON.parse(this.tokens[this.pos]);
        }
        return obj;
      } catch (err) {
        this.error('expected object');
      }
    };

    this.getAny = function() {
      this.pos++;
      var token = this.tokens[this.pos];
      return token;
    };

    this.getPath = function() {
      var str = this.getString();
      return str.split('.');
    };
  };

  oo$d.initClass(Tokenizer);

  OperationSerializer.Tokenizer = Tokenizer;

  module.exports = OperationSerializer;

  var each$6 = require('lodash/each');
  var oo$e = require('../../util/oo');
  var NodeRegistry$1 = require('./NodeRegistry');
  var Node$1 = require('./Node');

  /**
    Schema for Data Objects.

    @class Schema
    @private
   */

  /**
    @constructor Schema
    @param {String} name
    @param {String} version
  */
  function Schema(name, version) {
    /**
      @type {String}
    */
    this.name = name;
    /**
      @type {String}
    */
    this.version = version;
    /**
      @type {NodeRegistry}
      @private
    */
    this.nodeRegistry = new NodeRegistry$1();
    /**
      @type {Array} all Node classes which have `Node.static.tocType = true`
      @private
    */
    this.tocTypes = [];

    // add built-in node classes
    this.addNodes(this.getBuiltIns());
  }

  Schema.Prototype = function() {

    /**
      Add nodes to the schema.

      @param {Array} nodes Array of Node classes
    */
    this.addNodes = function(nodes) {
      if (!nodes) return;
      each$6(nodes, function(NodeClass) {
        if (!NodeClass.prototype._isNode) {
          console.error('Illegal node class: ', NodeClass);
        } else {
          this.addNode(NodeClass);
        }
      }.bind(this));
    };

    this.addNode = function(NodeClass) {
      this.nodeRegistry.register(NodeClass);
      if (NodeClass.static.tocType) {
        this.tocTypes.push(NodeClass.static.name);
      }
    };

    /**
      Get the node class for a type name.

      @param {String} name
      @returns {Class}
    */
    this.getNodeClass = function(name) {
      return this.nodeRegistry.get(name);
    };

    /**
      Provide all built-in node classes.

      @private
      @returns {Node[]} An array of Node classes.
    */
    this.getBuiltIns = function() {
      return [];
    };

    /**
      Checks if a given type is of given parent type.

      @param {String} type
      @param {String} parentType
      @returns {Boolean} true if type is and instance of parentType.
    */
    this.isInstanceOf = function(type, parentType) {
      var NodeClass = this.getNodeClass(type);
      if (NodeClass) {
        return Node$1.static.isInstanceOf(NodeClass, parentType);
      }
      return false;
    };

    /**
      Iterate over all registered node classes.

      See {@link util/Registry#each}

      @param {Function} callback
      @param {Object} context
    */
    this.each = function() {
      this.nodeRegistry.each.apply(this.nodeRegistry, arguments);
    };

    /**
      @returns {Node[]} list of types that should appear in a TOC
    */
    this.getTocTypes = function() {
      return this.tocTypes;
    };

    /**
      @returns {String} the name of the default textish node (e.g. 'paragraph')
    */
    this.getDefaultTextType = function() {
      throw new Error('Schmema.prototype.getDefaultTextType() must be overridden.');
    };

    this.getNodeSchema = function(type) {
      var NodeClass = this.getNodeClass(type);
      if (!NodeClass) {
        console.error('Unknown node type ', type);
        return null;
      }
      return NodeClass.static.schema;
    };
  };

  oo$e.initClass(Schema);

  module.exports = Schema;

  var isString$8 = require('lodash/isString');
  var isNumber$7 = require('lodash/isNumber');
  var Operation$3 = require('./Operation');
  var Conflict$3 = require('./Conflict');

  var INSERT$1 = "insert";
  var DELETE$2 = "delete";

  var hasConflict$2;

  /*
    @class
    @extends Operation
  */
  function TextOperation$3(data) {
    Operation$3.call(this);
    if (!data || data.type === undefined || data.pos === undefined || data.str === undefined) {
      throw new Error("Illegal argument: insufficient data.");
    }
    // 'insert' or 'delete'
    this.type = data.type;
    // the position where to apply the operation
    this.pos = data.pos;
    // the string to delete or insert
    this.str = data.str;
    // sanity checks
    if(!this.isInsert() && !this.isDelete()) {
      throw new Error("Illegal type.");
    }
    if (!isString$8(this.str)) {
      throw new Error("Illegal argument: expecting string.");
    }
    if (!isNumber$7(this.pos) || this.pos < 0) {
      throw new Error("Illegal argument: expecting positive number as pos.");
    }
  }

  TextOperation$3.fromJSON = function(data) {
    return new TextOperation$3(data);
  };

  TextOperation$3.Prototype = function() {

    this._isTextOperation = true;

    this.apply = function(str) {
      if (this.isEmpty()) return str;
      if (this.type === INSERT$1) {
        if (str.length < this.pos) {
          throw new Error("Provided string is too short.");
        }
        if (str.splice) {
          return str.splice(this.pos, 0, this.str);
        } else {
          return str.slice(0, this.pos).concat(this.str).concat(str.slice(this.pos));
        }
      }
      else /* if (this.type === DELETE) */ {
        if (str.length < this.pos + this.str.length) {
          throw new Error("Provided string is too short.");
        }
        if (str.splice) {
          return str.splice(this.pos, this.str.length);
        } else {
          return str.slice(0, this.pos).concat(str.slice(this.pos + this.str.length));
        }
      }
    };

    this.clone = function() {
      return new TextOperation$3(this);
    };

    this.isNOP = function() {
      return this.type === "NOP" || this.str.length === 0;
    };

    this.isInsert = function() {
      return this.type === INSERT$1;
    };

    this.isDelete = function() {
      return this.type === DELETE$2;
    };

    this.getLength = function() {
      return this.str.length;
    };

    this.invert = function() {
      var data = {
        type: this.isInsert() ? DELETE$2 : INSERT$1,
        pos: this.pos,
        str: this.str
      };
      return new TextOperation$3(data);
    };

    this.hasConflict = function(other) {
      return hasConflict$2(this, other);
    };

    this.isEmpty = function() {
      return this.str.length === 0;
    };

    this.toJSON = function() {
      return {
        type: this.type,
        pos: this.pos,
        str: this.str
      };
    };

    this.toString = function() {
      return ["(", (this.isInsert() ? INSERT$1 : DELETE$2), ",", this.pos, ",'", this.str, "')"].join('');
    };
  };

  Operation$3.extend(TextOperation$3);

  hasConflict$2 = function(a, b) {
    // Insert vs Insert:
    //
    // Insertions are conflicting iff their insert position is the same.
    if (a.type === INSERT$1 && b.type === INSERT$1) return (a.pos === b.pos);
    // Delete vs Delete:
    //
    // Deletions are conflicting if their ranges overlap.
    if (a.type === DELETE$2 && b.type === DELETE$2) {
      // to have no conflict, either `a` should be after `b` or `b` after `a`, otherwise.
      return !(a.pos >= b.pos + b.str.length || b.pos >= a.pos + a.str.length);
    }
    // Delete vs Insert:
    //
    // A deletion and an insertion are conflicting if the insert position is within the deleted range.
    var del, ins;
    if (a.type === DELETE$2) {
      del = a; ins = b;
    } else {
      del = b; ins = a;
    }
    return (ins.pos >= del.pos && ins.pos < del.pos + del.str.length);
  };

  // Transforms two Insertions
  // --------

  function transform_insert_insert$1(a, b) {
    if (a.pos === b.pos) {
      b.pos += a.str.length;
    }
    else if (a.pos < b.pos) {
      b.pos += a.str.length;
    }
    else {
      a.pos += b.str.length;
    }
  }

  // Transform two Deletions
  // --------
  //

  function transform_delete_delete$2(a, b, first) {
    // reduce to a normalized case
    if (a.pos > b.pos) {
      return transform_delete_delete$2(b, a, !first);
    }
    if (a.pos === b.pos && a.str.length > b.str.length) {
      return transform_delete_delete$2(b, a, !first);
    }
    // take out overlapping parts
    if (b.pos < a.pos + a.str.length) {
      var s = b.pos - a.pos;
      var s1 = a.str.length - s;
      var s2 = s + b.str.length;
      a.str = a.str.slice(0, s) + a.str.slice(s2);
      b.str = b.str.slice(s1);
      b.pos -= s;
    } else {
      b.pos -= a.str.length;
    }
  }

  // Transform Insert and Deletion
  // --------
  //

  function transform_insert_delete$1(a, b) {
    if (a.type === DELETE$2) {
      return transform_insert_delete$1(b, a);
    }
    // we can assume, that a is an insertion and b is a deletion
    // a is before b
    if (a.pos <= b.pos) {
      b.pos += a.str.length;
    }
    // a is after b
    else if (a.pos >= b.pos + b.str.length) {
      a.pos -= b.str.length;
    }
    // Note: this is a conflict case the user should be noticed about
    // If applied still, the deletion takes precedence
    // a.pos > b.pos && <= b.pos + b.length
    else {
      var s = a.pos - b.pos;
      b.str = b.str.slice(0, s) + a.str + b.str.slice(s);
      a.str = "";
    }
  }

  var transform$2 = function(a, b, options) {
    options = options || {};
    if (options["no-conflict"] && hasConflict$2(a, b)) {
      throw new Conflict$3(a, b);
    }
    if (!options.inplace) {
      a = a.clone();
      b = b.clone();
    }
    if (a.type === INSERT$1 && b.type === INSERT$1) {
      transform_insert_insert$1(a, b);
    }
    else if (a.type === DELETE$2 && b.type === DELETE$2) {
      transform_delete_delete$2(a, b, true);
    }
    else {
      transform_insert_delete$1(a,b);
    }
    return [a, b];
  };

  TextOperation$3.transform = function() {
    return transform$2.apply(null, arguments);
  };

  /* Factories */

  TextOperation$3.Insert = function(pos, str) {
    return new TextOperation$3({ type: INSERT$1, pos: pos, str: str });
  };

  TextOperation$3.Delete = function(pos, str) {
    return new TextOperation$3({ type: DELETE$2, pos: pos, str: str });
  };

  TextOperation$3.INSERT = INSERT$1;
  TextOperation$3.DELETE = DELETE$2;

  module.exports = TextOperation$3;

  /* eslint-disable no-unused-vars */

  var isEqual$5 = require('lodash/isEqual');
  var oo$f = require('../util/oo');
  var ObjectOperation$3 = require('./data/ObjectOperation');

  function DefaultChangeCompressor() {
  }

  DefaultChangeCompressor.Prototype = function() {

    this.shouldMerge = function(lastChange, newChange) {
      return false;
      // var now = Date.now();
      // // var shouldMerge = (now - lastChange.timestamp < MAXIMUM_CHANGE_DURATION);
      // var shouldMerge = true;
      // if (shouldMerge) {
      //   // we are only interested in compressing subsequent operations while typing
      //   // TODO: we could make our lifes easier by just tagging these changes
      //   var firstOp = lastChange.ops[0];
      //   var secondOp = newChange.ops[0];
      //   var firstDiff = firstOp.diff;
      //   var secondDiff = secondOp.diff;
      //   // HACK: this check is pretty optimistic. We should tag changes, so that
      //   // we can compress only changes related to typing here.
      //   shouldMerge = (
      //     firstOp.isUpdate('string') &&
      //     secondOp.isUpdate('string') &&
      //     secondDiff.getLength() === 1 &&
      //     firstDiff.type === secondDiff.type &&
      //     isEqual(firstOp.path, secondOp.path)
      //   );
      // }

      // return shouldMerge;
    };

    /*
      This compresser tries to merge subsequent text operation
      to create more natural changes for persisting.

      @param {DocumentChange} first
      @param {DocumentChange} second
      @returns {boolean} `true` if the second could be merged into the first, `false` otherwise
    */
    this.merge = function(first, second) {
      // we are only interested in compressing subsequent operations while typing
      // TODO: we could make our lifes easier by just tagging these changes
      var firstOp = first.ops[0];
      var secondOp = second.ops[0];
      var firstDiff = firstOp.diff;
      var secondDiff = secondOp.diff;
      var mergedOp = false;
      if (firstDiff.isInsert()) {
        if (firstDiff.pos+firstDiff.getLength() === secondDiff.pos) {
          mergedOp = firstOp.toJSON();
          mergedOp.diff.str += secondDiff.str;
        }
      }
      else if (firstDiff.isDelete()) {
        // TODO: here is one case not covered
        // "012345": del(3, '3') del(3, '4') -> del(3, '34')
        if (firstDiff.pos === secondDiff.pos) {
          mergedOp = firstOp.toJSON();
          mergedOp.diff.str += secondDiff.str;
        } else if (secondDiff.pos+secondDiff.getLength() === firstDiff.pos) {
          mergedOp = firstOp.toJSON();
          mergedOp.diff = secondDiff;
          mergedOp.diff.str += firstDiff.str;
        }
      }
      if (mergedOp) {
        first.ops[0] = ObjectOperation$3.fromJSON(mergedOp);
        if (first.ops.length > 1) {
          // just concatenating the other ops
          // TODO: we could compress the other ops as well, e.g., updates of annotation
          // ranges as they follow the same principle as the originating text operation.
          first.ops = first.ops.concat(second.ops.slice(1));
          first.after = second.after;
        }
        return true;
      }
      return false;
    };

  };

  oo$f.initClass(DefaultChangeCompressor);

  module.exports = DefaultChangeCompressor;

  var isEqual$6 = require('lodash/isEqual');
  var isObject$2 = require('lodash/isObject');
  var isArray$7 = require('lodash/isArray');
  var isString$9 = require('lodash/isString');
  var each$7 = require('lodash/each');
  var uuid$3 = require('../util/uuid');
  var EventEmitter$8 = require('../util/EventEmitter');
  var DocumentIndex$3 = require('./DocumentIndex');
  var AnnotationIndex$1 = require('./AnnotationIndex');
  var ContainerAnnotationIndex$1 = require('./ContainerAnnotationIndex');
  var AnchorIndex$1 = require('./AnchorIndex');
  var DocumentChange$2 = require('./DocumentChange');
  var PathEventProxy = require('./PathEventProxy');
  var IncrementalData$1 = require('./data/IncrementalData');
  var DocumentNodeFactory = require('./DocumentNodeFactory');
  var Selection$5 = require('./Selection');
  var Coordinate$3 = require('./Coordinate');
  var Range = require('./Range');
  var docHelpers = require('./documentHelpers');
  var JSONConverter$2 = require('./JSONConverter');
  var converter$1 = new JSONConverter$2();

  var __id__$2 = 0;

  /**
    Abstract class used for deriving a custom article implementation.
    Requires a {@link model/DocumentSchema} to be provided on construction.

    @class Document
    @abstract
    @extends model/AbstractDocument
    @example

    ```js
    var Document = require('substance/model/Document');
    var articleSchema = require('./myArticleSchema');
    var Article = function() {
      Article.super.call(articleSchema);

      // We set up a container that holds references to
      // block nodes (e.g. paragraphs and figures)
      this.create({
        type: "container",
        id: "body",
        nodes: []
      });
    };

    Document.extend(Article);
    ```
  */

  /**
    @constructor Document
    @param {DocumentSchema} schema The document schema.
  */

  function Document(schema) {
    Document.super.apply(this);

    this.__id__ = __id__$2++;
    if (!schema) {
      throw new Error('A document needs a schema for reflection.');
    }

    this.schema = schema;
    this.nodeFactory = new DocumentNodeFactory(this);
    this.data = new IncrementalData$1(schema, {
      nodeFactory: this.nodeFactory
    });

    // all by type
    this.addIndex('type', DocumentIndex$3.create({
      property: "type"
    }));

    // special index for (property-scoped) annotations
    this.addIndex('annotations', new AnnotationIndex$1());

    // TODO: these are only necessary if there is a container annotation
    // in the schema
    // special index for (container-scoped) annotations
    this.addIndex('container-annotations', new ContainerAnnotationIndex$1());
    this.addIndex('container-annotation-anchors', new AnchorIndex$1());

    // change event proxies are triggered after a document change has been applied
    // before the regular document:changed event is fired.
    // They serve the purpose of making the event notification more efficient
    // In earlier days all observers such as node views where listening on the same event 'operation:applied'.
    // This did not scale with increasing number of nodes, as on every operation all listeners where notified.
    // The proxies filter the document change by interest and then only notify a small set of observers.
    // Example: NotifyByPath notifies only observers which are interested in changes to a certain path.
    this.eventProxies = {
      'path': new PathEventProxy(this),
    };

    // Note: using the general event queue (as opposed to calling _updateEventProxies from within _notifyChangeListeners)
    // so that handler priorities are considered correctly
    this.on('document:changed', this._updateEventProxies, this);
  }

  Document.Prototype = function() {

    this._isDocument = true;

    this.addIndex = function(name, index) {
      return this.data.addIndex(name, index);
    };

    this.getIndex = function(name) {
      return this.data.getIndex(name);
    };

    this.getNodes = function() {
      return this.data.nodes;
    };

    /**
      @returns {model/DocumentSchema} the document's schema.
    */
    this.getSchema = function() {
      return this.schema;
    };

    /**
      Check if this storage contains a node with given id.

      @returns {Boolean} `true` if a node with id exists, `false` otherwise.
    */
    this.contains = function(id) {
      this.data.contains(id);
    };

    /**
      Get a node or value via path.

      @param {String|String[]} path node id or path to property.
      @returns {DocumentNode|any|undefined} a Node instance, a value or undefined if not found.
    */
    this.get = function(path, strict) {
      return this.data.get(path, strict);
    };

    /**
      @return {Object} A hash of {@link model/DocumentNode} instances.
    */
    this.getNodes = function() {
      return this.data.getNodes();
    };

    /**
      Creates a context like a transaction for importing nodes.
      This is important in presence of cyclic dependencies.
      Indexes will not be updated during the import but will afterwards
      when all nodes are have been created.

      @private
      @param {Function} importer a `function(doc)`, where with `doc` is a `model/AbstractDocument`

      @example

      Consider the following example from our documentation generator:
      We want to have a member index, which keeps track of members of namespaces, modules, and classes.
      grouped by type, and in the case of classes, also grouped by 'instance' and 'class'.

      ```
      ui
        - class
          - ui/Component
      ui/Component
        - class
          - method
            - mount
        - instance
          - method
            - render
      ```

      To decide which grouping to apply, the parent type of a member needs to be considered.
      Using an incremental approach, this leads to the problem, that the parent must exist
      before the child. At the same time, e.g. when deserializing, the parent has already
      a field with all children ids. This cyclic dependency is best address, by turning
      off all listeners (such as indexes) until the data is consistent.

    */
    this.import = function(importer) {
      try {
        this.data._stopIndexing();
        importer(this);
        this.data._startIndexing();
      } finally {
        this.data.queue = [];
        this.data._startIndexing();
      }
    };

    /**
      Create a node from the given data.

      @param {Object} plain node data.
      @return {DocumentNode} The created node.

      @example

      ```js
      doc.transaction(function(tx) {
        tx.create({
          id: 'p1',
          type: 'paragraph',
          content: 'Hi I am a Substance paragraph.'
        });
      });
      ```
    */
    this.create = function(nodeData) {
      if (!nodeData.id) {
        nodeData.id = uuid$3(nodeData.type);
      }
      var op = this._create(nodeData);
      var change = new DocumentChange$2([op], {}, {});
      change._extractInformation(this);
      this._notifyChangeListeners(change);
      return this.data.get(nodeData.id);
    };

    /**
      Delete the node with given id.

      @param {String} nodeId
      @returns {DocumentNode} The deleted node.

      @example

      ```js
      doc.transaction(function(tx) {
        tx.delete('p1');
      });
      ```
    */
    this.delete = function(nodeId) {
      var node = this.get(nodeId);
      var op = this._delete(nodeId);
      var change = new DocumentChange$2([op], {}, {});
      change._extractInformation(this);
      this._notifyChangeListeners(change);
      return node;
    };

    /**
      Set a property to a new value.

      @param {String[]} property path
      @param {any} newValue
      @returns {DocumentNode} The deleted node.

      @example

      ```js
      doc.transaction(function(tx) {
        tx.set(['p1', 'content'], "Hello there! I'm a new paragraph.");
      });
      ```
    */
    this.set = function(path, value) {
      var oldValue = this.get(path);
      var op = this._set(path, value);
      var change = new DocumentChange$2([op], {}, {});
      change._extractInformation(this);
      this._notifyChangeListeners(change);
      return oldValue;
    };

    /**
      Update a property incrementally.

      @param {Array} property path
      @param {Object} diff
      @returns {any} The value before applying the update.

      @example


      Inserting text into a string property:
      ```
      doc.update(['p1', 'content'], { insert: {offset: 3, value: "fee"} });
      ```
      would turn "Foobar" into "Foofeebar".

      Deleting text from a string property:
      ```
      doc.update(['p1', 'content'], { delete: {start: 0, end: 3} });
      ```
      would turn "Foobar" into "bar".

      Inserting into an array:
      ```
      doc.update(['p1', 'content'], { insert: {offset: 2, value: 0} });
      ```
      would turn `[1,2,3,4]` into `[1,2,0,3,4]`.

      Deleting from an array:
      ```
      doc.update(['body', 'nodes'], { delete: 2 });
      ```
      would turn `[1,2,3,4]` into `[1,2,4]`.
    */
    this.update = function(path, diff) {
      var op = this._update(path, diff);
      var change = new DocumentChange$2([op], {}, {});
      change._extractInformation(this);
      this._notifyChangeListeners(change);
      return op;
    };

    /**
      Add a document index.

      @param {String} name
      @param {DocumentIndex} index
    */
    this.addIndex = function(name, index) {
      return this.data.addIndex(name, index);
    };

    /**
      @param {String} name
      @returns {DocumentIndex} the node index with given name.
    */
    this.getIndex = function(name) {
      return this.data.getIndex(name);
    };

    /**
      Creates a selection which is attached to this document.
      Every selection implementation provides its own
      parameter format which is basically a JSON representation.

      @param {model/Selection} sel An object describing the selection.

      @example

      Creating a PropertySelection:

      ```js
      doc.createSelection([ 'text1', 'content'], 10, 20);
      ```

      Creating a ContainerSelection:

      ```js
      doc.createSelection('main', [ 'p1', 'content'], 10, [ 'p2', 'content'], 20)
      ```

      Creating a NullSelection:

      ```js
      doc.createSelection(null);
      ```

      You can also call this method with JSON data

      ```js
      doc.createSelection({
        type: 'property',
        path: [ 'p1', 'content'],
        startOffset: 10,
        endOffset: 20
      });
      ```
    */
    this.createSelection = function() {
      var sel = _createSelection.apply(this, arguments);
      if (!sel.isNull()) {
        sel.attach(this);
      }
      return sel;
    };


    function _createSelection() {
      var PropertySelection = require('./PropertySelection');
      var ContainerSelection = require('./ContainerSelection');
      var NodeSelection = require('./NodeSelection');

      var doc = this; // eslint-disable-line
      var coor, range, path, startOffset, endOffset;
      if (arguments.length === 1 && arguments[0] === null) {
        return Selection$5.nullSelection;
      }
      if (arguments[0] instanceof Coordinate$3) {
        coor = arguments[0];
        if (coor.isNodeCoordinate()) {
          return NodeSelection._createFromCoordinate(coor);
        } else {
          return new PropertySelection(coor.path, coor.offset, coor.offset);
        }
      }
      else if (arguments[0] instanceof Range) {
        range = arguments[0];
        var inOneNode = isEqual$6(range.start.path, range.end.path);
        if (inOneNode) {
          if (range.start.isNodeCoordinate()) {
            return NodeSelection._createFromRange(range);
          } else {
            return new PropertySelection(range.start.path, range.start.offset, range.end.offset, range.reverse, range.containerId);
          }
        } else {
          return new ContainerSelection(range.containerId, range.start.path, range.start.offset, range.end.path, range.end.offset, range.reverse);
        }
      }
      else if (arguments.length === 1 && isObject$2(arguments[0])) {
        return _createSelectionFromData(doc, arguments[0]);
      }
      // createSelection(startPath, startOffset)
      else if (arguments.length === 2 && isArray$7(arguments[0])) {
        path = arguments[0];
        startOffset = arguments[1];
        return new PropertySelection(path, startOffset, startOffset);
      }
      // createSelection(startPath, startOffset, endOffset)
      else if (arguments.length === 3 && isArray$7(arguments[0])) {
        path = arguments[0];
        startOffset = arguments[1];
        endOffset = arguments[2];
        return new PropertySelection(path, startOffset, endOffset, startOffset>endOffset);
      }
      // createSelection(containerId, startPath, startOffset, endPath, endOffset)
      else if (arguments.length === 5 && isString$9(arguments[0])) {
        return _createSelectionFromData(doc, {
          type: 'container',
          containerId: arguments[0],
          startPath: arguments[1],
          startOffset: arguments[2],
          endPath: arguments[3],
          endOffset: arguments[4]
        });
      } else {
        console.error('Illegal arguments for Selection.create().', arguments);
        return Selection$5.nullSelection;
      }
    }

    function _createSelectionFromData(doc, selData) {
      var PropertySelection = require('./PropertySelection');
      var ContainerSelection = require('./ContainerSelection');
      var NodeSelection = require('./NodeSelection');
      var CustomSelection = require('./CustomSelection');
      var tmp;
      if (selData.type === 'property') {
        if (selData.endOffset === null || selData.endOffset === undefined) {
          selData.endOffset = selData.startOffset;
        }
        if (!selData.hasOwnProperty('reverse')) {
          if (selData.startOffset>selData.endOffset) {
            tmp = selData.startOffset;
            selData.startOffset = selData.endOffset;
            selData.endOffset = tmp;
            selData.reverse = true;
          } else {
            selData.reverse = false;
          }
        }
        return new PropertySelection(selData.path, selData.startOffset, selData.endOffset, selData.reverse, selData.containerId, selData.surfaceId);
      } else if (selData.type === 'container') {
        var container = doc.get(selData.containerId, 'strict');
        var start = new Coordinate$3(selData.startPath, selData.startOffset);
        var end = new Coordinate$3(selData.endPath, selData.endOffset);
        var startAddress = container.getAddress(start);
        var endAddress = container.getAddress(end);
        var isReverse = selData.reverse;
        if (!startAddress) {
          throw new Error('Invalid arguments for ContainerSelection: ', start.toString());
        }
        if (!endAddress) {
          throw new Error('Invalid arguments for ContainerSelection: ', end.toString());
        }
        if (!selData.hasOwnProperty('reverse')) {
          isReverse = endAddress.isBefore(startAddress, 'strict');
          if (isReverse) {
            tmp = start;
            start = end;
            end = tmp;
          }
        }

        // ATTENTION: since Beta4 we are not supporting partial
        // selections of nodes other than text nodes
        // Thus we are turning other property coordinates into node coordinates
        _allignCoordinate(doc, start, true);
        _allignCoordinate(doc, end, false);

        return new ContainerSelection(container.id, start.path, start.offset, end.path, end.offset, isReverse, selData.surfaceId);
      }
      else if (selData.type === 'node') {
        return NodeSelection.fromJSON(selData);
      } else if (selData.type === 'custom') {
        return CustomSelection.fromJSON(selData);
      } else {
        throw new Error('Illegal selection type', selData);
      }
    }

    function _allignCoordinate(doc, coor, isStart) {
      if (!coor.isNodeCoordinate()) {
        var nodeId = coor.getNodeId();
        var node = doc.get(nodeId);
        if (!node.isText()) {
          console.warn('Selecting a non-textish node partially is not supported. Select the full node.');
          coor.path = [nodeId];
          coor.offset = isStart ? 0 : 1;
        }
      }
    }

    this.getEventProxy = function(name) {
      return this.eventProxies[name];
    };

    this.newInstance = function() {
      var DocumentClass = this.constructor;
      return new DocumentClass(this.schema);
    };

    this.fromSnapshot = function(data) {
      var doc = this.newInstance();
      doc.loadSeed(data);
      return doc;
    };

    this.getDocumentMeta = function() {
      return this.get('document');
    };

    this._apply = function(documentChange) {
      each$7(documentChange.ops, function(op) {
        this.data.apply(op);
        this.emit('operation:applied', op);
      }.bind(this));
      // extract aggregated information, such as which property has been affected etc.
      documentChange._extractInformation(this);
    };

    this._notifyChangeListeners = function(change, info) {
      info = info || {};
      this.emit('document:changed', change, info, this);
    };

    this._updateEventProxies = function(change, info) {
      each$7(this.eventProxies, function(proxy) {
        proxy.onDocumentChanged(change, info, this);
      }.bind(this));
    };

    /**
     * DEPRECATED: We will drop support as this should be done in a more
     *             controlled fashion using an importer.
     * @skip
     */
    this.loadSeed = function(seed) {
      // clear all existing nodes (as they should be there in the seed)
      each$7(this.data.nodes, function(node) {
        this.delete(node.id);
      }.bind(this));
      // create nodes
      each$7(seed.nodes, function(nodeData) {
        this.create(nodeData);
      }.bind(this));
    };

    /**
      Convert to JSON.

      @returns {Object} Plain content.
    */
    this.toJSON = function() {
      return converter$1.exportDocument(this);
    };

    this.getTextForSelection = function(sel) {
      console.warn('DEPRECATED: use docHelpers.getTextForSelection() instead.');
      return docHelpers.getTextForSelection(this, sel);
    };

    this.setText = function(path, text, annotations) {
      // TODO: this should go into document helpers.
      var idx;
      var oldAnnos = this.getIndex('annotations').get(path);
      // TODO: what to do with container annotations
      for (idx = 0; idx < oldAnnos.length; idx++) {
        this.delete(oldAnnos[idx].id);
      }
      this.set(path, text);
      for (idx = 0; idx < annotations.length; idx++) {
        this.create(annotations[idx]);
      }
    };

    this._create = function(nodeData) {
      var op = this.data.create(nodeData);
      return op;
    };

    this._delete = function(nodeId) {
      var op = this.data.delete(nodeId);
      return op;
    };

    this._update = function(path, diff) {
      var op = this.data.update(path, diff);
      return op;
    };

    this._set = function(path, value) {
      var op = this.data.set(path, value);
      return op;
    };

  };

  EventEmitter$8.extend(Document);

  module.exports = Document;

  var isEqual$7 = require('lodash/isEqual');
  var isObject$3 = require('lodash/isObject');
  var isArray$8 = require('lodash/isArray');
  var map$3 = require('lodash/map');
  var forEach$3 = require('lodash/forEach');
  var clone$1 = require('lodash/clone');
  var cloneDeep$7 = require('lodash/cloneDeep');
  var oo$g = require('../util/oo');
  var uuid$4 = require('../util/uuid');
  var OperationSerializer$1 = require('./data/OperationSerializer');
  var ObjectOperation$4 = require('./data/ObjectOperation');
  var Selection$6 = require('./Selection');

  /*

    States:

    - Provisional:

      Change has been applied to the document already. Subsequent changes might be merged
      into it, to achieve a more natural representation.

    - Final:

      Change has been finalized.

    - Pending:

      Change has been committed to the collaboration hub.

    - Acknowledged:

      Change has been applied and acknowledged by the server.
  */
  function DocumentChange$3(ops, before, after) {
    if (arguments.length === 1 && isObject$3(arguments[0])) {
      var data = arguments[0];
      // a unique id for the change
      this.sha = data.sha;
      // when the change has been applied
      this.timestamp = data.timestamp;
      // application state before the change was applied
      this.before = data.before;
      // array of operations
      this.ops = data.ops;
      this.info = data.info; // custom change info
      // application state after the change was applied
      this.after = data.after;
    } else if (arguments.length === 3) {
      this.sha = uuid$4();
      this.info = {};
      this.timestamp = Date.now();
      this.ops = ops.slice(0);
      this.before = before;
      this.after = after;
    } else {
      throw new Error('Illegal arguments.');
    }
    // a hash with all updated properties
    this.updated = null;
    // a hash with all created nodes
    this.created = null;
    // a hash with all deleted nodes
    this.deleted = null;
  }

  DocumentChange$3.Prototype = function() {

    /*
      Extract aggregated information about which nodes and properties have been affected.
      This gets called by Document after applying the change.
    */
    this._extractInformation = function(doc) {
      var ops = this.ops;
      var created = {};
      var deleted = {};
      var updated = {};
      var affectedContainerAnnos = [];

      // TODO: we will introduce a special operation type for coordinates
      function _checkAnnotation(op) {
        var node = op.val;
        var path, propName;
        switch (op.type) {
          case "create":
          case "delete":
            // HACK: detecting annotation changes in an opportunistic way
            if (node.hasOwnProperty('startOffset')) {
              path = node.path || node.startPath;
              updated[path] = true;
            }
            if (node.hasOwnProperty('endPath')) {
              path = node.endPath;
              updated[path] = true;
            }
            break;
          case "update":
          case "set":
            // HACK: detecting annotation changes in an opportunistic way
            node = doc.get(op.path[0]);
            if (node) {
              propName = op.path[1];
              if (node.isPropertyAnnotation()) {
                if ((propName === 'path' || propName === 'startOffset' ||
                     propName === 'endOffset') && !deleted[node.path[0]]) {
                  updated[node.path] = true;
                }
              } else if (node.isContainerAnnotation()) {
                if (propName === 'startPath' || propName === 'startOffset' ||
                    propName === 'endPath' || propName === 'endOffset') {
                  affectedContainerAnnos.push(node);
                }
              }
            }
            break;
          default:
            throw new Error('Illegal state');
        }
      }

      for (var i = 0; i < ops.length; i++) {
        var op = ops[i];
        if (op.type === "create") {
          created[op.val.id] = op.val;
          delete deleted[op.val.id];
        }
        if (op.type === "delete") {
          delete created[op.val.id];
          deleted[op.val.id] = op.val;
        }
        if (op.type === "set" || op.type === "update") {
          // The old as well the new one is affected
          updated[op.path] = true;
        }
        _checkAnnotation(op);
      }

      affectedContainerAnnos.forEach(function(anno) {
        var container = doc.get(anno.containerId, 'strict');
        var startPos = container.getPosition(anno.startPath[0]);
        var endPos = container.getPosition(anno.endPath[0]);
        for (var pos = startPos; pos <= endPos; pos++) {
          var node = container.getChildAt(pos);
          var path;
          if (node.isText()) {
            path = [node.id, 'content'];
          } else {
            path = [node.id];
          }
          if (!deleted[node.id]) {
            updated[path] = true;
          }
        }
      });

      // remove all deleted nodes from updated
      if(Object.keys(deleted).length > 0) {
        forEach$3(updated, function(_, key) {
          var nodeId = key.split(',')[0];
          if (deleted[nodeId]) {
            delete updated[key];
          }
        });
      }

      this.created = created;
      this.deleted = deleted;
      this.updated = updated;
    };

    this.invert = function() {
      // shallow cloning this
      var copy = this.toJSON();
      copy.ops = [];
      // swapping before and after
      var tmp = copy.before;
      copy.before = copy.after;
      copy.after = tmp;
      var inverted = DocumentChange$3.fromJSON(copy);
      var ops = [];
      for (var i = this.ops.length - 1; i >= 0; i--) {
        ops.push(this.ops[i].invert());
      }
      inverted.ops = ops;
      return inverted;
    };

    // Inspection API used by DocumentChange listeners
    // ===============================================

    this.isAffected = function(path) {
      return this.updated[path];
    };

    this.isUpdated = this.isAffected;

    /*
      TODO serializers and deserializers should allow
      for application data in 'after' and 'before'
    */

    this.serialize = function() {
      var opSerializer = new OperationSerializer$1();
      var data = this.toJSON();
      data.ops = this.ops.map(function(op) {
        return opSerializer.serialize(op);
      });
      return JSON.stringify(data);
    };

    this.clone = function() {
      return DocumentChange$3.fromJSON(this.toJSON());
    };

    this.toJSON = function() {
      var data = {
        // to identify this change
        sha: this.sha,
        // before state
        before: clone$1(this.before),
        ops: map$3(this.ops, function(op) {
          return op.toJSON();
        }),
        info: this.info,
        // after state
        after: clone$1(this.after),
      };

      // Just to make sure rich selection objects don't end up
      // in the JSON result
      data.after.selection = undefined;
      data.before.selection = undefined;

      var sel = this.before.selection;
      if (sel && sel._isSelection) {
        data.before.selection = sel.toJSON();
      }
      sel = this.after.selection;
      if (sel && sel._isSelection) {
        data.after.selection = sel.toJSON();
      }
      return data;
    };
  };

  oo$g.initClass(DocumentChange$3);

  DocumentChange$3.deserialize = function(str) {
    var opSerializer = new OperationSerializer$1();
    var data = JSON.parse(str);
    data.ops = data.ops.map(function(opData) {
      return opSerializer.deserialize(opData);
    });
    if (data.before.selection) {
      data.before.selection = Selection$6.fromJSON(data.before.selection);
    }
    if (data.after.selection) {
      data.after.selection = Selection$6.fromJSON(data.after.selection);
    }
    return new DocumentChange$3(data);
  };

  DocumentChange$3.fromJSON = function(data) {
    // Don't write to original object on deserialization
    var change = cloneDeep$7(data);
    change.ops = data.ops.map(function(opData) {
      return ObjectOperation$4.fromJSON(opData);
    });
    change.before.selection = Selection$6.fromJSON(data.before.selection);
    change.after.selection = Selection$6.fromJSON(data.after.selection);
    return new DocumentChange$3(change);
  };

  /*
    Transforms change A with B, as if A was done before B.
    A' and B' can be used to update two clients to get to the
    same document content.

       / A - B' \
    v_n          v_n+1
       \ B - A' /
  */
  DocumentChange$3.transformInplace = function(A, B) {
    _transformInplaceBatch(A, B);
  };

  function _transformInplaceSingle(a, b) {
    for (var i = 0; i < a.ops.length; i++) {
      var a_op = a.ops[i];
      for (var j = 0; j < b.ops.length; j++) {
        var b_op = b.ops[j];
        // ATTENTION: order of arguments is important.
        // First argument is the dominant one, i.e. it is treated as if it was applied before
        ObjectOperation$4.transform(a_op, b_op, {inplace: true});
      }
    }
    if (a.before) {
      _transformSelectionInplace(a.before.selection, b);
    }
    if (a.after) {
      _transformSelectionInplace(a.after.selection, b);
    }
    if (b.before) {
      _transformSelectionInplace(b.before.selection, a);
    }
    if (b.after) {
      _transformSelectionInplace(b.after.selection, a);
    }
  }

  function _transformInplaceBatch(A, B) {
    if (!isArray$8(A)) {
      A = [A];
    }
    if (!isArray$8(B)) {
      B = [B];
    }
    for (var i = 0; i < A.length; i++) {
      var a = A[i];
      for (var j = 0; j < B.length; j++) {
        var b = B[j];
        _transformInplaceSingle(a,b);
      }
    }
  }

  function _transformSelectionInplace(sel, a) {
    if (!sel || (!sel.isPropertySelection() && !sel.isContainerSelection()) ) {
      return false;
    }
    var ops = a.ops;
    var hasChanged = false;
    var isCollapsed = sel.isCollapsed();
    for(var i=0; i<ops.length; i++) {
      var op = ops[i];
      hasChanged |= _transformCoordinateInplace(sel.start, op);
      if (!isCollapsed) {
        hasChanged |= _transformCoordinateInplace(sel.end, op);
      } else {
        if (sel.isContainerSelection()) {
          sel.endPath = sel.startPath;
        }
        sel.endOffset = sel.startOffset;
      }
    }
    return hasChanged;
  }

  DocumentChange$3.transformSelection = function(sel, a) {
    var newSel = sel.clone();
    var hasChanged = _transformSelectionInplace(newSel, a);
    if (hasChanged) {
      return newSel;
    } else {
      return sel;
    }
  };

  function _transformCoordinateInplace(coor, op) {
    if (!isEqual$7(op.path, coor.path)) return false;
    var hasChanged = false;
    if (op.type === 'update' && op.propertyType === 'string') {
      var diff = op.diff;
      var newOffset;
      if (diff.isInsert() && diff.pos <= coor.offset) {
        newOffset = coor.offset + diff.str.length;
        // console.log('Transforming coordinate after inserting %s chars:', diff.str.length, coor.toString(), '->', newOffset);
        coor.offset = newOffset;
        hasChanged = true;
      } else if (diff.isDelete() && diff.pos <= coor.offset) {
        newOffset = Math.max(diff.pos, coor.offset - diff.str.length);
        // console.log('Transforming coordinate after deleting %s chars:', diff.str.length, coor.toString(), '->', newOffset);
        coor.offset = newOffset;
        hasChanged = true;
      }
    }
    return hasChanged;
  }

  module.exports = DocumentChange$3;

  var isString$a = require('lodash/isString');
  var filter$3 = require('lodash/filter');
  var DocumentIndex$4 = require('./DocumentIndex');
  var Selection$7 = require('./Selection');

  /**
    @module
    @example

    ```js
    var documentHelpers = require('substance/model/documentHelpers');
    documentHelpers.isContainerAnnotation(doc, 'comment')
    ```
  */
  var documentHelpers$1 = {};

  /**
    @param {model/Document} doc
    @param {String} type
    @return {Boolean} `true` if given type is a {@link model/ContainerAnnotation}
  */
  documentHelpers$1.isContainerAnnotation = function(doc, type) {
    var schema = doc.getSchema();
    return schema.isInstanceOf(type, 'container-annotation');
  };

  /**
    For a given selection get all property annotations

    @param {model/Document} doc
    @param {model/Selection} sel
    @return {model/PropertyAnnotation[]} An array of property annotations.
            Returns an empty array when selection is a container selection.
  */
  documentHelpers$1.getPropertyAnnotationsForSelection = function(doc, sel, options) {
    options = options || {};
    if (!sel.isPropertySelection()) {
      return [];
    }
    var annotations = doc.getIndex('annotations').get(sel.path, sel.startOffset, sel.endOffset);
    if (options.type) {
      annotations = filter$3(annotations, DocumentIndex$4.filterByType(options.type));
    }
    return annotations;
  };

  /**
    For a given selection get all container annotations

    @param {model/Document} doc
    @param {model/Selection} sel
    @param {String} containerId
    @param {String} options.type provides only annotations of that type
    @return {Array} An array of container annotations
  */
  documentHelpers$1.getContainerAnnotationsForSelection = function(doc, sel, containerId, options) {
    // ATTENTION: looking for container annotations is not as efficient as property
    // selections, as we do not have an index that has notion of the spatial extend
    // of an annotation. Opposed to that, common annotations are bound
    // to properties which make it easy to lookup.
    if (!containerId) {
      throw new Error("'containerId' is required.");
    }
    options = options || {};
    var index = doc.getIndex('container-annotations');
    var annotations = index.get(containerId, options.type);
    annotations = filter$3(annotations, function(anno) {
      return sel.overlaps(anno.getSelection());
    });
    return annotations;
  };

  /**
    For a given selection, get annotations of a certain type

    @param {Document} doc
    @param {Document.Selection} sel
    @param {String} annotationType
    @param {String} containerId (only needed when type is a container annotation)
    @return {Array} all matching annotations
  */
  documentHelpers$1.getAnnotationsForSelection = function(doc, sel, annotationType, containerId) {
    var annos;
    var isContainerAnno = documentHelpers$1.isContainerAnnotation(doc, annotationType);

    if (isContainerAnno) {
      var container = doc.get(containerId, 'strict');
      annos = documentHelpers$1.getContainerAnnotationsForSelection(doc, sel, container, {
        type: annotationType
      });
    } else {
      annos = documentHelpers$1.getPropertyAnnotationsForSelection(doc, sel, { type: annotationType });
    }
    return annos;
  };

  /**
    For a given selection, get the corresponding text string

    @param {Document} doc
    @param {model/Selection} sel
    @return {String} text enclosed by the annotation
  */

  documentHelpers$1.getTextForSelection = function(doc, sel) {
    var text;
    if (!sel || sel.isNull()) {
      return "";
    } else if (sel.isPropertySelection()) {
      text = doc.get(sel.start.path);
      return text.substring(sel.start.offset, sel.end.offset);
    } else if (sel.isContainerSelection()) {
      var result = [];
      var fragments = sel.getFragments();
      fragments.forEach(function(fragment) {
        if (fragment instanceof Selection$7.Fragment) {
          var text = doc.get(fragment.path);
          if (isString$a(text)) {
            result.push(
              text.substring(fragment.startOffset, fragment.endOffset)
            );
          }
        }
      });
      return result.join('\n');
    }
  };

  module.exports = documentHelpers$1;

  var NodeIndex$1 = require('./data/NodeIndex');

  function DocumentIndex$5() {}

  NodeIndex$1.extend(DocumentIndex$5);

  DocumentIndex$5.filterByType = NodeIndex$1.filterByType;

  module.exports = NodeIndex$1;

  var each$8 = require('lodash/each');
  var DataNode = require('./data/Node');

  /**
    Base node type for document nodes.

    @class
    @abstract

    @param {model/Document} doc A document instance
    @param {object} node properties
    @example

    The following example shows how a new node type is defined.


    ```js
    function Todo() {
      Todo.super.apply(this, arguments);
    }
    TextBlock.extend(Todo);
    Todo.static.name = 'todo';
    Todo.static.defineSchema({
      content: 'text',
      done: { type: 'bool', default: false }
    });
    ```

    The following
      data types are supported:

        - `string` bare metal string data type
        - `text` a string that carries annotations
        - `number` numeric values
        - `bool` boolean values
        - 'id' a node id referencing another node in the document
  */

  function DocumentNode$3(doc, props) {
    DataNode.call(this, props);
    if (!doc) {
      throw new Error('Document instance is mandatory.');
    }
    this.document = doc;
  }

  DocumentNode$3.Prototype = function() {

    this._isDocumentNode = true;

    var _super = DocumentNode$3.super.prototype;

    /**
      Get the Document instance.

      @returns {Document}
    */
    this.getDocument = function() {
      return this.document;
    };

    /**
      Whether this node has a parent.

      `parent` is a built-in property for implementing nested nodes.

      @returns {Boolean}
    */
    this.hasParent = function() {
      return Boolean(this.parent);
    };

    /**
      @returns {DocumentNode} the parent node
    */
    this.getParent = function() {
      return this.document.get(this.parent);
    };

    /**
      Checks whether this node has children.

      @returns {Boolean} default: false
    */
    this.hasChildren = function() {
      return false;
    };

    /**
      Get the index of a given child.

      @returns {Number} default: -1
    */
    this.getChildIndex = function(child) { // eslint-disable-line
      return -1;
    };

    /**
      Get a child node at a given position.

      @returns {DocumentNode} default: null
    */
    this.getChildAt = function(idx) { // eslint-disable-line
      return null;
    };

    /**
      Get the number of children nodes.

      @returns {Number} default: 0
    */
    this.getChildCount = function() {
      return 0;
    };

    /**
      Get the root node.

      The root node is the last ancestor returned
      by a sequence of `getParent()` calls.

      @returns {DocumentNode}
    */
    this.getRoot = function() {
      var node = this;
      while (node.hasParent()) {
        node = node.getParent();
      }
      return node;
    };

    /**
      This is used to be able to traverse all properties in a container.
      This is particularly necessary for strucuted nodes, with more than one editable
      text property.

      @example

      For a figure node with `title`, `img`, and `caption` this could look
      be done this way:

      ```
      Figure.static.addressablePropertyNames = ['title', 'caption']
      ```

      The img itself does not need to be addressable, as it can't be edited in the text editor.

      Alternatvely you can use the `text` data type in the schema, which implicitly makes
      these properties addressable.

      ```
      Figure.static.defineSchema({
        title: "text",
        img: "string",
        caption: "text"
      });
      ```

      @private
      @returns {String[]} an array of property names
    */
    this.getAddressablePropertyNames = function() {
      var addressablePropertyNames = this.constructor.static.addressablePropertyNames;
      return addressablePropertyNames || [];
    };

    this.hasAddressableProperties = function() {
      return this.getAddressablePropertyNames().length > 0;
    };

    this.getPropertyNameAt = function(idx) {
      var propertyNames = this.constructor.static.addressablePropertyNames || [];
      return propertyNames[idx];
    };

    // TODO: should this really be here?
    // volatile property necessary to render highlighted node differently
    // TODO: We should get this out here
    this.setHighlighted = function(highlighted, scope) {
      if (this.highlighted !== highlighted) {
        this.highlightedScope = scope;
        this.highlighted = highlighted;
        this.emit('highlighted', highlighted);
      }
    };

    function _matchPropertyEvent(eventName) {
      return /([a-zA-Z_0-9]+):changed/.exec(eventName);
    }

    this.on = function(eventName, handler, ctx) {
      var match = _matchPropertyEvent(eventName);
      if (match) {
        var propertyName = match[1];
        if (this.constructor.static.schema[propertyName]) {
          var doc = this.getDocument();
          doc.getEventProxy('path')
            .on([this.id, propertyName], handler, ctx);
        }
      }
      _super.on.apply(this, arguments);
    };

    this.off = function(ctx, eventName, handler) {
      var doc = this.getDocument();
      var match = false;
      if (!eventName) {
        doc.getEventProxy('path').off(ctx);
      } else {
        match = _matchPropertyEvent(eventName);
      }
      if (match) {
        var propertyName = match[1];
        doc.getEventProxy('path')
          .off(ctx, [this.id, propertyName], handler);
      }
      _super.off.apply(this, arguments);
    };

    // Experimental: we are working on a simpler API replacing the
    // rather inconvenient EventProxy API.
    this.connect = function(ctx, handlers) {
      console.warn('DEPRECATED: use Node.on() instead');
      each$8(handlers, function(func, name) {
        this.on(name, func, ctx);
      }.bind(this));
    };

    this.disconnect = function(ctx) {
      console.warn('DEPRECATED: use Node.off() instead');
      this.off(ctx);
    };

    this._onPropertyChange = function(propertyName) {
      var args = [propertyName + ':changed']
        .concat(Array.prototype.slice.call(arguments, 1));
      this.emit.apply(this, args);
    };

    // Node categories
    // --------------------

    /**
      @returns {Boolean} true if node is a block node (e.g. Paragraph, Figure, List, Table)
    */
    this.isBlock = function() {
      return this.constructor.static.isBlock;
    };

    /**
      @returns {Boolean} true if node is a text node (e.g. Paragraph, Codebock)
    */
    this.isText = function() {
      return this.constructor.static.isText;
    };

    /**
      @returns {Boolean} true if node is an annotation node (e.g. Strong)
    */
    this.isPropertyAnnotation = function() {
      return this.constructor.static.isPropertyAnnotation;
    };

    /**
      @returns {Boolean} true if node is an inline node (e.g. Citation)
    */
    this.isInline = function() {
      return this.constructor.static.isInline;
    };

    /**
      @returns {Boolean} true if node is a container annotation (e.g. multiparagraph comment)
    */
    this.isContainerAnnotation = function() {
      return this.constructor.static.isContainerAnnotation;
    };

  };

  DataNode.extend(DocumentNode$3);

  /**
    The node's name is used to register it in the DocumentSchema.

    @type {String} default: 'node'
  */
  DocumentNode$3.static.name = 'node';

  /**
    Declares a node to be treated as block-type node.

    BlockNodes are considers the direct descendant of `Container` nodes.
    @type {Boolean} default: false
  */
  DocumentNode$3.static.isBlock = false;

  /**
    Declares a node to be treated as text-ish node.

    @type {Boolean} default: false
  */
  DocumentNode$3.static.isText = false;

  /**
    Declares a node to be treated as {@link model/PropertyAnnotation}.

    @type {Boolean} default: false
  */
  DocumentNode$3.static.isPropertyAnnotation = false;

  /**
    Declares a node to be treated as {@link model/ContainerAnnotation}.

    @type {Boolean} default: false
  */
  DocumentNode$3.static.isContainerAnnotation = false;

  /**
    Declares a node to be treated as {@link model/InlineNode}.

    @type {Boolean} default: false
  */
  DocumentNode$3.static.isInline = false;

  module.exports = DocumentNode$3;

  var oo$h = require('../util/oo');

  function DocumentNodeFactory$1(doc) {
    this.doc = doc;
  }

  DocumentNodeFactory$1.Prototype = function() {

    this.create = function(nodeType, nodeData) {
      var NodeClass = this.doc.schema.getNodeClass(nodeType);
      if (!NodeClass) {
        throw new Error('No node registered by that name: ' + nodeType);
      }
      return new NodeClass(this.doc, nodeData);
    };

  };

  oo$h.initClass(DocumentNodeFactory$1);

  module.exports = DocumentNodeFactory$1;

  var Schema$1 = require('./data/Schema');
  var DocumentNode$4 = require('./DocumentNode');
  var Container$2 = require('./Container');
  var PropertyAnnotation = require('./PropertyAnnotation');
  var ContainerAnnotation$1 = require('./ContainerAnnotation');

  /**
    Used to define custom article formats. Predefined node types can be combined with custom ones.

    @class
    @param {String} name schema identifier
    @param {String} schema schema version

    @example

    ```js
    var Paragraph = require('substance/packages/paragraph/Paragraph');
    var Emphasis = require('substance/packages/emphasis/Emphasis');
    var Strong = require('substance/packages/emphasis/Strong');
    var PropertyAnnotation = require('substance/ui/PropertyAnnotation');

    var Comment = PropertyAnnotation.extend({
      name: 'comment',
      properties: {
        content: 'string'
      }
    });

    var schema = new Document.Schema('my-article', '1.0.0');
    schema.getDefaultTextType = function() {
      return 'paragraph';
    };
    schema.addNodes([Paragraph, Emphasis, Strong, Comment]);
    ```
  */

  function DocumentSchema(name, version) {
    DocumentSchema.super.call(this, name, version);
  }

  DocumentSchema.Prototype = function() {

    /**
      Returns default text type. E.g. used when hitting ENTER in a text node, which
      produces a new node of the type returned here. Abstract method, which must be implemented.

      @abstract
      @returns {String} default text type (e.g. 'paragraph')
    */

    this.getDefaultTextType = function() {
      throw new Error('DocumentSchema.getDefaultTextType() is abstract and must be overridden.');
    };

    this.isAnnotationType = function(type) {
      var nodeClass = this.getNodeClass(type);
      return (nodeClass && nodeClass.prototype._isPropertyAnnotation);
    };

    this.getBuiltIns = function() {
      return [DocumentNode$4, PropertyAnnotation, Container$2, ContainerAnnotation$1];
    };

  };

  Schema$1.extend(DocumentSchema);

  module.exports = DocumentSchema;

  var extend$5 = require('lodash/extend');
  var oo$i = require('../util/oo');
  var EventEmitter$9 = require('../util/EventEmitter');
  var TransactionDocument = require('./TransactionDocument');
  var DefaultChangeCompressor$1 = require('./DefaultChangeCompressor');
  var Selection$8 = require('./Selection');
  var SelectionState = require('./SelectionState');
  var DocumentChange$4 = require('./DocumentChange');

  var __id__$3 = 0;

  function DocumentSession$2(doc, options) {
    DocumentSession$2.super.apply(this);

    this.__id__ = __id__$3++;

    options = options || {};
    this.doc = doc;
    this.selectionState = new SelectionState(doc);

    // the stage is a essentially a clone of this document
    // used to apply a sequence of document operations
    // without touching this document
    this.stage = new TransactionDocument(this.doc, this);
    this.isTransacting = false;

    this.doneChanges = [];
    this.undoneChanges = [];
    this._lastChange = null;

    this.compressor = options.compressor || new DefaultChangeCompressor$1();
    this.saveHandler = options.saveHandler;

    // Note: registering twice:
    // to do internal transformations in case changes are coming
    // in from another session -- this must be done as early as possible
    this.doc.on('document:changed', this.onDocumentChange, this, {priority: 1000});
  }

  DocumentSession$2.Prototype = function() {

    this.getDocument = function() {
      return this.doc;
    };

    this.getSelection = function() {
      return this.selectionState.getSelection();
    };

    this.setSelection = function(sel) {
      var selectionHasChanged = this._setSelection(sel);
      if(selectionHasChanged) {
        this._triggerUpdateEvent({
          selection: sel
        });
      }
    };

    this.getSelectionState = function() {
      return this.selectionState;
    };

    /*
      Set saveHandler via API

      E.g. if saveHandler not available at construction
    */
    this.setSaveHandler = function(saveHandler) {
      this.saveHandler = saveHandler;
    };

    this.getCollaborators = function() {
      return null;
    };

    this.canUndo = function() {
      return this.doneChanges.length > 0;
    };

    this.canRedo = function() {
      return this.undoneChanges.length > 0;
    };

    this.undo = function() {
      this._undoRedo('undo');
    };

    this.redo = function() {
      this._undoRedo('redo');
    };


    this._undoRedo = function(which) {
      var from, to;
      if (which === 'redo') {
        from = this.undoneChanges;
        to = this.doneChanges;
      } else {
        from = this.doneChanges;
        to = this.undoneChanges;
      }
      var change = from.pop();
      if (change) {
        this.stage._apply(change);
        this.doc._apply(change);
        var sel = change.after.selection;
        if (sel) {
          sel.attach(this.doc);
        }
        var selectionHasChanged = this._setSelection(sel);
        to.push(change.invert());
        var update = {
          change: change
        };
        if (selectionHasChanged) update.selection = sel;
        this._triggerUpdateEvent(update, { replay: true });
      } else {
        console.warn('No change can be %s.', (which === 'undo'? 'undone':'redone'));
      }
    };

    /**
      Start a transaction to manipulate the document

      @param {function} transformation a function(tx) that performs actions on the transaction document tx

      @example

      ```js
      doc.transaction(function(tx, args) {
        tx.update(...);
        ...
        return {
          selection: newSelection
        };
      })
      ```
    */
    this.transaction = function(transformation, info) {
      if (this.isTransacting) {
        throw new Error('Nested transactions are not supported.');
      }
      this.isTransacting = true;
      this.stage.reset();
      var sel = this.getSelection();
      info = info || {};
      var surfaceId = sel.surfaceId;
      var change = this.stage._transaction(function(tx) {
        tx.before.selection = sel;
        var args = { selection: sel };
        var result = transformation(tx, args) || {};
        sel = result.selection || sel;
        if (sel._isSelection && !sel.isNull() && !sel.surfaceId) {
          sel.surfaceId = surfaceId;
        }
        tx.after.selection = sel;
        extend$5(info, tx.info);
      });
      if (change) {
        this.isTransacting = false;
        this._commit(change, info);
        return change;
      } else {
        this.isTransacting = false;
      }
    };

    this.onDocumentChange = function(change, info) {
      // ATTENTION: this is used if you have two independent DocumentSessions
      // in one client.
      if (info && info.session !== this) {
        this.stage._apply(change);
        this._transformLocalChangeHistory(change, info);
        var newSelection = this._transformSelection(change, info);
        var selectionHasChanged = this._setSelection(newSelection);
        // this._triggerUpdateEvent(update, info);
      }
    };

    this._setSelection = function(sel) {
      return this.selectionState.setSelection(sel);
    };

    this._transformLocalChangeHistory = function(externalChange) {
      // Transform the change history
      // Note: using a clone as the transform is done inplace
      // which is ok for the changes in the undo history, but not
      // for the external change
      var clone = {
        ops: externalChange.ops.map(function(op) { return op.clone(); })
      };
      DocumentChange$4.transformInplace(clone, this.doneChanges);
      DocumentChange$4.transformInplace(clone, this.undoneChanges);
    };

    this._transformSelection = function(change) {
      var oldSelection = this.getSelection();
      var newSelection = DocumentChange$4.transformSelection(oldSelection, change);
      // console.log('Transformed selection', change, oldSelection.toString(), newSelection.toString());
      return newSelection;
    };

    this._commit = function(change, info) {
      var selectionHasChanged = this._commitChange(change);
      var update = {
        change: change
      };
      if (selectionHasChanged) update.selection = this.getSelection();
      this._triggerUpdateEvent(update, info);
    };

    this._commitChange = function(change) {
      change.timestamp = Date.now();
      // update document model
      this.doc._apply(change);

      var currentChange = this._currentChange;
      // try to merge this change with the last to get more natural changes
      // e.g. not every keystroke, but typed words or such.
      var merged = false;
      if (currentChange) {
        if (this.compressor.shouldMerge(currentChange, change)) {
          merged = this.compressor.merge(currentChange, change);
        }
      }
      if (!merged) {
        // push to undo queue and wipe the redo queue
        this._currentChange = change;
        this.doneChanges.push(change.invert());
      }
      // discard old redo history
      this.undoneChanges = [];

      var newSelection = change.after.selection || Selection$8.nullSelection;
      var selectionHasChanged = this._setSelection(newSelection);
      // HACK injecting the surfaceId here...
      // TODO: we should find out where the best place is to do this
      if (!newSelection.isNull()) {
        newSelection.surfaceId = change.after.surfaceId;
      }
      return selectionHasChanged;
    };

    /*
      Are there unsaved changes?
    */
    this.isDirty = function() {
      return this._dirty;
    };

    /*
      Save session / document
    */
    this.save = function() {
      var doc = this.getDocument();
      var saveHandler = this.saveHandler;

      if (this._dirty && !this._isSaving) {
        this._isSaving = true;
        // Pass saving logic to the user defined callback if available
        if (saveHandler) {
          // TODO: calculate changes since last save
          var changes = [];
          saveHandler.saveDocument(doc, changes, function(err) {

            this._isSaving = false;
            if (err) {
              console.error('Error during save');
            } else {
              this._dirty = false;
              this._triggerUpdateEvent({}, {force: true});
            }
          }.bind(this));

        } else {
          console.error('Document saving is not handled at the moment. Make sure saveHandler instance provided to documentSession');
        }
      }
    };

    this._triggerUpdateEvent = function(update, info) {
      info = info || {};
      info.session = this;
      if (update.change && update.change.ops.length > 0) {
        // TODO: I would like to wrap this with a try catch.
        // however, debugging gets inconvenient as caught exceptions don't trigger a breakpoint
        // by default, and other libraries such as jquery throw noisily.
        this.doc._notifyChangeListeners(update.change, info);
        this._dirty = true;
      } else {
        // HACK: removing this from the update when it is NOP
        // this way, we only need to do this check here
        delete update.change;
      }
      if (Object.keys(update).length > 0 || info.force) {
        // slots to have more control about when things get
        // updated, and things have been rendered/updated
        this.emit('update', update, info);
        this.emit('didUpdate', update, info);
      }
    };
  };

  oo$i.inherit(DocumentSession$2, EventEmitter$9);

  module.exports = DocumentSession$2;

  var extend$6 = require('lodash/extend');
  var isString$b = require('lodash/isString');
  var oo$j = require('../util/oo');
  var Registry$1 = require('../util/Registry');
  var Fragmenter = require('./Fragmenter');
  var encodeXMLEntities = require('../util/encodeXMLEntities');

  function DOMExporter(config) {
    if (!config.converters) {
      throw new Error('config.converters is mandatory');
    }
    if (!config.converters._isRegistry) {
      this.converters = new Registry$1();
      config.converters.forEach(function(converter) {
        if (!converter.type) {
          console.error('Converter must provide the type of the associated node.', converter);
          return;
        }
        this.converters.add(converter.type, converter);
      }.bind(this));
    } else {
      this.converters = config.converters;
    }

    this.state = {
      doc: null
    };
    this.config = extend$6({idAttribute: 'id'}, config);

    // NOTE: Subclasses (HTMLExporter and XMLExporter) must initialize this
    // with a proper DOMElement instance which is used to create new elements.
    this._el = null;
    this.$$ = this.createElement.bind(this);
  }

  DOMExporter.Prototype = function() {

    this.exportDocument = function(doc) {
      // TODO: this is no left without much functionality
      // still, it would be good to have a consistent top-level API
      // i.e. converter.importDocument(el) and converter.exportDocument(doc)
      // On the other side, the 'internal' API methods are named this.convert*.
      return this.convertDocument(doc);
    };

    /**
      @param {Document}
      @returns {DOMElement|DOMElement[]} The exported document as DOM or an array of elements
               if exported as partial, which depends on the actual implementation
               of `this.convertDocument()`.

      @abstract
      @example

      this.convertDocument = function(doc) {
        var elements = this.convertContainer(doc, this.state.containerId);
        var out = elements.map(function(el) {
          return el.outerHTML;
        });
        return out.join('');
      };
    */
    this.convertDocument = function(doc) { // eslint-disable-line
      throw new Error('This method is abstract');
    };

    this.convertContainer = function(container) {
      if (!container) {
        throw new Error('Illegal arguments: container is mandatory.');
      }
      var doc = container.getDocument();
      this.state.doc = doc;
      var elements = [];
      container.nodes.forEach(function(id) {
        var node = doc.get(id);
        var nodeEl = this.convertNode(node);
        elements.push(nodeEl);
      }.bind(this));
      return elements;
    };

    this.convertNode = function(node) {
      if (isString$b(node)) {
        // Assuming this.state.doc has been set by convertDocument
        node = this.state.doc.get(node);
      } else {
        this.state.doc = node.getDocument();
      }

      var converter = this.getNodeConverter(node);
      if (!converter) {
        converter = this.getDefaultBlockConverter();
      }
      var el;
      if (converter.tagName) {
        el = this.$$(converter.tagName);
      } else {
        el = this.$$('div');
      }
      el.attr(this.config.idAttribute, node.id);
      if (converter.export) {
        el = converter.export(node, el, this) || el;
      } else {
        el = this.getDefaultBlockConverter().export(node, el, this) || el;
      }
      return el;
    };

    this.convertProperty = function(doc, path, options) {
      this.initialize(doc, options);
      var wrapper = this.$$('div')
        .append(this.annotatedText(path));
      return wrapper.innerHTML;
    };

    this.annotatedText = function(path) {
      var self = this;
      var doc = this.state.doc;
      var annotations = doc.getIndex('annotations').get(path);
      var text = doc.get(path);

      var annotator = new Fragmenter();
      annotator.onText = function(context, text) {
        context.children.push(encodeXMLEntities(text));
      };
      annotator.onEnter = function(fragment) {
        var anno = fragment.node;
        return {
          annotation: anno,
          children: []
        };
      };
      annotator.onExit = function(fragment, context, parentContext) {
        var anno = context.annotation;
        var converter = self.getNodeConverter(anno);
        if (!converter) {
          converter = self.getDefaultPropertyAnnotationConverter();
        }
        var el;
        if (converter.tagName) {
          el = this.$$(converter.tagName);
        } else {
          el = this.$$('span');
        }
        el.attr(this.config.idAttribute, anno.id);
        el.append(context.children);
        if (converter.export) {
          converter.export(anno, el, self);
        }
        parentContext.children.push(el);
      }.bind(this);
      var wrapper = { children: [] };
      annotator.start(wrapper, text, annotations);
      return wrapper.children;
    };

    this.getNodeConverter = function(node) {
      return this.converters.get(node.type);
    };

    this.getDefaultBlockConverter = function() {
      throw new Error('This method is abstract.');
    };

    this.getDefaultPropertyAnnotationConverter = function() {
      throw new Error('This method is abstract.');
    };

    this.getDocument = function() {
      return this.state.doc;
    };

    this.createElement = function(str) {
      return this._el.createElement(str);
    };

  };

  oo$j.initClass(DOMExporter);

  module.exports = DOMExporter;

  var last$1 = require('lodash/last');
  var forEach$4 = require('lodash/forEach');
  var clone$2 = require('lodash/clone');
  var extend$7 = require('lodash/extend');
  var oo$k = require('../util/oo');
  // var uuid = require('../util/uuid');
  var createCountingIdGenerator = require('../util/createCountingIdGenerator');
  var ArrayIterator = require('../util/ArrayIterator');

  /**
    A generic base implementation for XML/HTML importers.

    @class
    @param {Object} config
   */
  function DOMImporter(config) {
    if (!config.converters) {
      throw new Error('config.converters is mandatory');
    }
    this.config = extend$7({ idAttribute: 'id' }, config);
    this.schema = config.schema;
    this.state = null;

    this._defaultBlockConverter = null;
    this._allConverters = [];
    this._blockConverters = [];
    this._propertyAnnotationConverters = [];

    var schema = this.schema;
    var defaultTextType = schema.getDefaultTextType();

    config.converters.forEach(function(Converter) {
      var converter;
      if (typeof Converter === 'function') {
        // console.log('installing converter', Converter);
        converter = new Converter();
      } else {
        converter = Converter;
      }

      if (!converter.type) {
        console.error('Converter must provide the type of the associated node.', converter);
        return;
      }
      if (!converter.matchElement && !converter.tagName) {
        console.error('Converter must provide a matchElement function or a tagName property.', converter);
        return;
      }
      if (!converter.matchElement) {
        converter.matchElement = this._defaultElementMatcher.bind(converter);
      }
      var NodeClass = schema.getNodeClass(converter.type);
      if (!NodeClass) {
        console.error('No node type defined for converter', converter.type);
        return;
      }
      if (!this._defaultBlockConverter && defaultTextType === converter.type) {
        this._defaultBlockConverter = converter;
      }

      this._allConverters.push(converter);
      // Defaults to _blockConverters
      if (NodeClass.static.isPropertyAnnotation) {
        this._propertyAnnotationConverters.push(converter);
      } else {
        this._blockConverters.push(converter);
      }

    }.bind(this));

    this.state = new DOMImporter.State();
  }

  DOMImporter.Prototype = function DOMImporterPrototype() {

    this.reset = function() {
      this.state.reset();
    };

    this.createDocument = function(schema) {
      var doc = this._createDocument(schema);
      return doc;
    };

    this.generateDocument = function() {
      // creating all nodes
      var doc = this.createDocument(this.config.schema);
      this.state.nodes.forEach(function(node) {
        // delete if the node exists already
        if (doc.get(node.id)) {
          doc.delete(node.id);
        }
        doc.create(node);
      });
      // creating annotations afterwards so that the targeted nodes exist for sure
      this.state.inlineNodes.forEach(function(node) {
        if (doc.get(node.id)) {
          doc.delete(node.id);
        }
        doc.create(node);
      });
      return doc;
    };

    this._createDocument = function(schema) {
      // create an empty document and initialize the container if not present
      var doc = new this.config.DocumentClass(schema);
      return doc;
    };

    /**
      Converts and shows all children of a given element.

      @param {ui/DOMElement[]} elements All elements that should be converted into the container.
      @param {String} containerId The id of the target container node.
      @returns {Object} the preliminary container node
     */
    this.convertContainer = function(elements, containerId) {
      var state = this.state;
      state.container = [];
      state.containerId = containerId;
      var iterator = new ArrayIterator(elements);
      while(iterator.hasNext()) {
        var el = iterator.next();
        var blockTypeConverter = this._getConverterForElement(el, 'block');
        var node;
        if (blockTypeConverter) {
          node = this._nodeData(el, blockTypeConverter.type);
          state.pushElementContext(el.tagName);
          node = blockTypeConverter.import(el, node, this) || node;
          state.popElementContext();
          this._createAndShow(node);
        } else {
          if (el.isCommentNode()) ; else if (el.isTextNode()) {
            var text = el.textContent;
            if (/^\s*$/.exec(text)) continue;
            // If we find text nodes on the block level we wrap
            // it into a paragraph element (or what is configured as default block level element)
            iterator.back();
            this._wrapInlineElementsIntoBlockElement(iterator);
          } else if (el.isElementNode()) {
            // NOTE: hard to tell if unsupported nodes on this level
            // should be treated as inline or not.
            // ATM: we apply a catch-all to handle cases where inline content
            // is found on top level
            iterator.back();
            this._wrapInlineElementsIntoBlockElement(iterator);
          }
        }
      }
      var container = {
        type: 'container',
        id: containerId,
        nodes: this.state.container.slice(0)
      };
      this.createNode(container);
      return container;
    };

    /**
      Converts a single HTML element and creates a node in the current document.

      @param {ui/DOMElement} el the HTML element
      @returns {object} the created node as JSON
     */
    this.convertElement = function(el) {
      var node = this._convertElement(el);
      return node;
    };

    this._convertElement = function(el, mode) {
      var node;
      var converter = this._getConverterForElement(el, mode);
      if (converter) {
        node = this._nodeData(el, converter.type);
        this.state.pushElementContext(el.tagName);
        node = converter.import(el, node, this) || node;
        this.state.popElementContext();
        this.createNode(node);
      } else {
        throw new Error('No converter found for '+el.tagName);
      }
      return node;
    };

    this.createNode = function(node) {
      if (this.state.ids[node.id]) {
        throw new Error('Node with id alread exists:' + node.id);
      }
      this.state.ids[node.id] = true;
      this.state.nodes.push(node);
      return node;
    };

    this.show = function(node) {
      this.state.container.push(node.id);
    };

    this._createAndShow = function(node) {
      this.createNode(node);
      this.show(node);
    };

    this._nodeData = function(el, type) {
      var nodeData = {
        type: type,
        id: this.getIdForElement(el, type)
      };
      var NodeClass = this.schema.getNodeClass(type);
      forEach$4(NodeClass.static.schema, function(prop, name) {
        // check integrity of provided props, such as type correctness,
        // and mandatory properties
        var hasDefault = prop.hasOwnProperty('default');
        if (hasDefault) {
          nodeData[name] = clone$2(prop.default);
        }
      });
      return nodeData;
    };

    // /**
    //   Converts an html element into a text property of the document.

    //   @private
    //   @param {Array<String>} path Path of the property to be written
    //   @param {String} html HTML to be converter
    //  */
    // this.convertProperty = function(path, html) {
    //   // TODO: while this method may be useful if html is updated
    //   // piecewise, from an API point of view it is not intuitive.
    //   // We should see if we really need this.
    //   // And we should give it a better naming.
    //   var doc = this.getDocument();
    //   var el = $$('div').setInnerHtml(html);
    //   var text = this.annotatedText(el, path);
    //   doc.setText(path, text, this.state.inlineNodes);
    // };

    /**
      Convert annotated text. You should call this method only for elements
      containing rich-text.

      @param {ui/DOMElement} el
      @param {String[]} path The target property where the extracted text (plus annotations) should be stored.
      @param {Object} options
      @param {Boolean} options.preserveWhitespace when true will preserve whitespace. Default: false.
      @returns {String} The converted text as plain-text
     */
    this.annotatedText = function(el, path, options) {
      var state = this.state;
      if (path) {
        // if (state.stack.length>0) {
        //   throw new Error('Contract: it is not allowed to bind a new call annotatedText to a path while the previous has not been completed.', el.outerHTML);
        // }
        if (options && options.preserveWhitespace) {
          state.preserveWhitespace = true;
        }
        state.stack.push({ path: path, offset: 0, text: ""});
      } else {
        if (state.stack.length===0) {
          throw new Error("Contract: DOMImporter.annotatedText() requires 'path' for non-reentrant call.", el.outerHTML);
        }
      }
      // IMO we should reset the last char, as it is only relevant within one
      // annotated text property. This feature is mainly used to eat up
      // whitespace in XML/HTML at tag boundaries, produced by pretty-printed XML/HTML.
      this.state.lastChar = '';
      var text;
      var iterator = el.getChildNodeIterator();
      this.state.pushElementContext(el.tagName);
      text = this._annotatedText(iterator);
      this.state.popElementContext();
      if (path) {
        state.stack.pop();
        state.preserveWhitespace = false;
      }
      return text;
    };

    /**
      Converts the given element as plain-text.

      @param {ui/DOMElement} el
      @returns {String} The plain text
     */
    this.plainText = function(el) {
      var state = this.state;
      var text = el.textContent;
      if (state.stack.length > 0) {
        var context = last$1(state.stack);
        context.offset += text.length;
        context.text += context.text.concat(text);
      }
      return text;
    };

    /**
      Tells the converter to insert a virutal custom text.

      This is useful when during conversion a generated label needs to be inserted instead
      of real text.

      @param {String}
     */
    this.customText = function(text) {
      var state = this.state;
      if (state.stack.length > 0) {
        var context = last$1(state.stack);
        context.offset += text.length;
        context.text += context.text.concat(text);
      }
      return text;
    };

    /**
      Generates an id. The generated id is unique with respect to all ids generated so far.

      @param {String} a prefix
      @return {String} the generated id
     */
    this.nextId = function(prefix) {
      // TODO: we could create more beautiful ids?
      // however we would need to be careful as there might be another
      // element in the HTML coming with that id
      // For now we use shas
      return this.state.uuid(prefix);
    };

    this.getIdForElement = function(el, type) {
      var id = el.getAttribute(this.config.idAttribute);
      if (id && !this.state.ids[id]) return id;

      var root = el.getRoot();
      id = this.nextId(type);
      while (this.state.ids[id] || root.find('#'+id)) {
        id = this.nextId(type);
      }
      return id;
    };

    this.defaultConverter = function(el, converter) {
      if (!this.IGNORE_DEFAULT_WARNINGS) {
        console.warn('This element is not handled by the converters you provided. This is the default implementation which just skips conversion. Override DOMImporter.defaultConverter(el, converter) to change this behavior.', el.outerHTML);
      }
      var defaultTextType = this.schema.getDefaultTextType();
      var defaultConverter = this._defaultBlockConverter;
      if (!defaultConverter) {
        throw new Error('Could not find converter for default type ', defaultTextType);
      }
      var node = this._nodeData(el, defaultTextType);
      this.state.pushElementContext(el.tagName);
      node = defaultConverter.import(el, node, converter) || node;
      this.state.popElementContext();
      return node;
    };

    this._defaultElementMatcher = function(el) {
      return el.is(this.tagName);
    };

    // Internal function for parsing annotated text
    // --------------------------------------------
    //
    this._annotatedText = function(iterator) {
      var state = this.state;
      var context = last$1(state.stack);
      if (!context) {
        throw new Error('Illegal state: context is null.');
      }
      while(iterator.hasNext()) {
        var el = iterator.next();
        var text = "";
        // Plain text nodes...
        if (el.isTextNode()) {
          text = this._prepareText(state, el.textContent);
          if (text.length) {
            // Note: text is not merged into the reentrant state
            // so that we are able to return for this reentrant call
            context.text = context.text.concat(text);
            context.offset += text.length;
          }
        } else if (el.isCommentNode()) {
          // skip comment nodes
          continue;
        } else if (el.isElementNode()) {
          var inlineTypeConverter = this._getConverterForElement(el, 'inline');
          if (!inlineTypeConverter) {
            if (!this.IGNORE_DEFAULT_WARNINGS) {
              console.warn('Unsupported inline element. We will not create an annotation for it, but process its children to extract annotated text.', el.outerHTML);
            }
            // Note: this will store the result into the current context
            this.annotatedText(el);
            continue;
          }
          // reentrant: we delegate the conversion to the inline node class
          // it will either call us back (this.annotatedText) or give us a finished
          // node instantly (self-managed)
          var startOffset = context.offset;
          var inlineType = inlineTypeConverter.type;
          var inlineNode = this._nodeData(el, inlineType);
          if (inlineTypeConverter.import) {
            // push a new context so we can deal with reentrant calls
            state.stack.push({ path: context.path, offset: startOffset, text: ""});
            state.pushElementContext(el.tagName);
            inlineNode = inlineTypeConverter.import(el, inlineNode, this) || inlineNode;
            state.popElementContext();

            var NodeClass = this.schema.getNodeClass(inlineType);
            // inline nodes are attached to an invisible character
            if (NodeClass.static.isInline) {
              this.customText("\u200B");
            } else {
              // We call this to descent into the element
              // which could be 'forgotten' otherwise.
              // TODO: what if the converter has processed the element already?
              this.annotatedText(el);
            }
            // ... and transfer the result into the current context
            var result = state.stack.pop();
            context.offset = result.offset;
            context.text = context.text.concat(result.text);
          } else {
            this.annotatedText(el);
          }
          // in the mean time the offset will probably have changed to reentrant calls
          var endOffset = context.offset;
          inlineNode.startOffset = startOffset;
          inlineNode.endOffset = endOffset;
          inlineNode.path = context.path.slice(0);
          state.inlineNodes.push(inlineNode);
        } else {
          console.warn('Unknown element type. Taking plain text.', el.outerHTML);
          text = this._prepareText(state, el.textContent);
          context.text = context.text.concat(text);
          context.offset += text.length;
        }
      }
      // return the plain text collected during this reentrant call
      return context.text;
    };

    this._getConverterForElement = function(el, mode) {
      var converters;
      if (mode === "block") {
        if (!el.tagName) return null;
        converters = this._blockConverters;
      } else if (mode === "inline") {
        converters = this._propertyAnnotationConverters;
      } else {
        converters = this._allConverters;
      }
      var converter = null;
      for (var i = 0; i < converters.length; i++) {
        if (this._converterCanBeApplied(converters[i], el)) {
          converter = converters[i];
          break;
        }
      }
      return converter;
    };

    this._converterCanBeApplied = function(converter, el) {
      return converter.matchElement(el, converter);
    };

    this._createElement = function(tagName) {
      return this._el.createElement(tagName);
    };

    /**
      Wraps the remaining (inline) elements of a node iterator into a default
      block node.

      @private
      @param {model/DOMImporter.ChildIterator} childIterator
      @returns {model/DocumentNode}
     */
    this._wrapInlineElementsIntoBlockElement = function(childIterator) {
      var wrapper = this._createElement('div');
      while(childIterator.hasNext()) {
        var el = childIterator.next();
        // if there is a block node we finish this wrapper
        var blockTypeConverter = this._getConverterForElement(el, 'block');
        if (blockTypeConverter) {
          childIterator.back();
          break;
        }
        wrapper.append(el.clone());
      }
      var node = this.defaultConverter(wrapper, this);
      if (node) {
        if (!node.type) {
          throw new Error('Contract: DOMImporter.defaultConverter() must return a node with type.');
        }
        this._createAndShow(node);
      }
      return node;
    };

    /**
      Converts an element into a default block level node.

      @private
      @param {ui/DOMElement} el
      @returns {model/DocumentNode}
     */
    this._createDefaultBlockElement = function(el) {
      var node = this.defaultConverter(el, this);
      if (node) {
        if (!node.type) {
          throw new Error('Contract: Html.defaultConverter() must return a node with type.', el.outerHTML);
        }
        node.id = node.id || this.defaultId(el, node.type);
        this._createAndShow(node);
      }
    };

    var WS_LEFT = /^\s+/g;
    var WS_LEFT_ALL = /^\s*/g;
    var WS_RIGHT = /\s+$/g;
    var WS_ALL = /\s+/g;
    // var ALL_WS_NOTSPACE_LEFT = /^[\t\n]+/g;
    // var ALL_WS_NOTSPACE_RIGHT = /[\t\n]+$/g;
    var SPACE = " ";
    var TABS_OR_NL = /[\t\n\r]+/g;

    // TODO: this needs to be tested and documented
    this._prepareText = function(state, text) {
      if (state.preserveWhitespace) {
        return text;
      }
      var repl = SPACE;
      // replace multiple tabs and new-lines by one space
      text = text.replace(TABS_OR_NL, '');
      // TODO: the last char handling is only necessary for for nested calls
      // i.e., when processing the content of an annotation, for instance
      // we need to work out how we could control this with an inner state
      if (state.lastChar === SPACE) {
        text = text.replace(WS_LEFT_ALL, repl);
      } else {
        text = text.replace(WS_LEFT, repl);
      }
      text = text.replace(WS_RIGHT, repl);
      // EXPERIMENTAL: also remove white-space within
      // this happens if somebody treats the text more like it would be done in Markdown
      // i.e. introducing line-breaks
      if (this.config.REMOVE_INNER_WS || state.removeInnerWhitespace) {
        text = text.replace(WS_ALL, SPACE);
      }
      state.lastChar = text[text.length-1] || state.lastChar;
      return text;
    };

    /**
      Removes any leading and trailing whitespaces from the content
      within the given element.
      Attention: this is not yet implemented fully. Atm, trimming is only done
      on the first and last text node (if they exist).

      @private
      @param {util/jQuery} $el
      @returns {util/jQuery} an element with trimmed text
     */
    this._trimTextContent = function(el) {
      var nodes = el.getChildNodes();
      var firstNode = nodes[0];
      var lastNode = last$1(nodes);
      var text, trimmed;
        // trim the first and last text
      if (firstNode && firstNode.isTextNode()) {
        text = firstNode.textContent;
        trimmed = this._trimLeft(text);
        firstNode.textContent = trimmed;
      }
      if (lastNode && lastNode.isTextNode()) {
        text = lastNode.textContent;
        trimmed = this._trimRight(text);
        lastNode.textContent = trimmed;
      }
      return el;
    };

    this._trimLeft = function(text) {
      return text.replace(WS_LEFT, "");
    };

    this._trimRight = function(text) {
      return text.replace(WS_RIGHT, "");
    };

  };
  oo$k.initClass(DOMImporter);

  DOMImporter.State = function() {
    this.reset();
  };

  DOMImporter.State.Prototype = function() {

    this.reset = function() {
      this.preserveWhitespace = false;
      this.nodes = [];
      this.inlineNodes = [];
      this.containerId = null;
      this.container = [];
      this.ids = {};
      // stack for reentrant calls into _convertElement()
      this.contexts = [];
      // stack for reentrant calls into _annotatedText()
      this.stack = [];
      this.lastChar = "";
      this.skipTypes = {};
      this.ignoreAnnotations = false;

      // experimental: trying to generate simpler ids during import
      // this.uuid = uuid;
      this.uuid = createCountingIdGenerator();
    };

    this.pushElementContext = function(tagName) {
      this.contexts.push({ tagName: tagName });
    };

    this.popElementContext = function() {
      return this.contexts.pop();
    };

    this.getCurrentElementContext = function() {
      return last$1(this.contexts);
    };

  };

  oo$k.initClass(DOMImporter.State);

  module.exports = DOMImporter;

  var oo$l = require('../util/oo');

  function EditingBehavior() {
    this._merge = {};
    this._mergeComponents = {};
    this._break = {};
  }

  EditingBehavior.Prototype = function() {

    this.defineMerge = function(firstType, secondType, impl) {
      if (!this._merge[firstType]) {
        this._merge[firstType] = {};
      }
      this._merge[firstType][secondType] = impl;
      return this;
    };

    this.canMerge = function(firstType, secondType) {
      return (this._merge[firstType] && this._merge[firstType][secondType]);
    };

    this.getMerger = function(firstType, secondType) {
      return this._merge[firstType][secondType];
    };

    this.defineComponentMerge = function(nodeType, impl) {
      this._mergeComponents[nodeType] = impl;
    };

    this.canMergeComponents = function(nodeType) {
      return this._mergeComponents[nodeType];
    };

    this.getComponentMerger = function(nodeType) {
      return this._mergeComponents[nodeType];
    };

    this.defineBreak = function(nodeType, impl) {
      this._break[nodeType] = impl;
      return this;
    };

    this.canBreak = function(nodeType) {
      return this._break[nodeType];
    };

    this.getBreaker = function(nodeType) {
      return this._break[nodeType];
    };

  };

  oo$l.initClass(EditingBehavior);

  module.exports = EditingBehavior;

  var oo$m = require('../util/oo');
  var extend$8 = require('lodash/extend');
  var each$9 = require('lodash/each');
  var isString$c = require('lodash/isString');

  var ENTER = 1;
  var EXIT = -1;
  var ANCHOR = -2;

  // Fragmenter
  // --------
  //
  // An algorithm that is used to fragment overlapping structure elements
  // following a priority rule set.
  // E.g., we use this for creating DOM elements for annotations. The annotations
  // can partially be overlapping. However this is not allowed in general for DOM elements
  // or other hierarchical structures.
  //
  // Example: For the annotation use case consider a 'comment' spanning partially
  // over an 'emphasis' annotation.
  // 'The <comment>quick brown <bold>fox</comment> jumps over</bold> the lazy dog.'
  // We want to be able to create a valid XML structure:
  // 'The <comment>quick brown <bold>fox</bold></comment><bold> jumps over</bold> the lazy dog.'
  //
  // For that one would choose
  //
  //     {
  //        'comment': 0,
  //        'bold': 1
  //     }
  //
  // as priority levels.
  // In case of structural violations as in the example, elements with a higher level
  // would be fragmented and those with lower levels would be preserved as one piece.
  //
  // TODO: If a violation for nodes of the same level occurs an Error should be thrown.
  // Currently, in such cases the first element that is opened earlier is preserved.

  function Fragmenter$1(options) {
    extend$8(this, options);
  }

  Fragmenter$1.Prototype = function() {

    this.start = function(rootContext, text, annotations) {
      if (!isString$c(text)) {
        throw new Error("Illegal argument: 'text' must be a String, but was " + text);
      }
      this._start(rootContext, text, annotations);
    };

    this.onText = function(context, text, entry) { // eslint-disable-line
    };

    // should return the created user context
    this.onEnter = function(entry, parentContext) { // eslint-disable-line
      return null;
    };

    this.onExit = function(entry, context, parentContext) { // eslint-disable-line
    };

    // This is a sweep algorithm wich uses a set of ENTER/EXIT entries
    // to manage a stack of active elements.
    // Whenever a new element is entered it will be appended to its parent element.
    // The stack is ordered by the annotation types.
    //
    // Examples:
    //
    // - simple case:
    //
    //       [top] -> ENTER(idea1) -> [top, idea1]
    //
    //   Creates a new 'idea' element and appends it to 'top'
    //
    // - stacked ENTER:
    //
    //       [top, idea1] -> ENTER(bold1) -> [top, idea1, bold1]
    //
    //   Creates a new 'bold' element and appends it to 'idea1'
    //
    // - simple EXIT:
    //
    //       [top, idea1] -> EXIT(idea1) -> [top]
    //
    //   Removes 'idea1' from stack.
    //
    // - reordering ENTER:
    //
    //       [top, bold1] -> ENTER(idea1) -> [top, idea1, bold1]
    //
    //   Inserts 'idea1' at 2nd position, creates a new 'bold1', and appends itself to 'top'
    //
    // - reordering EXIT
    //
    //       [top, idea1, bold1] -> EXIT(idea1)) -> [top, bold1]
    //
    //   Removes 'idea1' from stack and creates a new 'bold1'
    //

    function _extractEntries(annotations) {
      var openers = [];
      var closers = [];
      each$9(annotations, function(a) {
        var isAnchor = (a.isAnchor ? a.isAnchor() : false);
        // special treatment for zero-width annos such as ContainerAnnotation.Anchors
        if (isAnchor) {
          openers.push({
            mode: ANCHOR,
            pos: a.offset,
            id: a.id,
            level: Fragmenter$1.ALWAYS_ON_TOP,
            type: 'anchor',
            node: a,
            counter: -1,
            length: 0
          });
        } else {
          // TODO better naming, `Node.static.level` does not say enough
          // Better would be `Node.static.fragmentation = Fragmenter.SHOULD_NOT_SPLIT;`
          // meaning, that the fragmenter should try to render the fragment as one single
          // element, and not splitting it up on different stack levels.
          // E.g. When bold an link are overlapping
          // the fragmenter should not split the link element such as A<b>B<a>CD</a></b><a>EF</a>GH
          // but should instead A<b>B</b><a><b>CD</b><a>EF</a>GH

          // use a weak default level when not given
          var l = Fragmenter$1.NORMAL;
          var isInline = (a.isInline ? a.isInline() : false);
          if (isInline) {
            l = Number.MAX_VALUE;
          } else if (a.constructor.static && a.constructor.static.hasOwnProperty('fragmentation')) {
            l = a.constructor.static.fragmentation;
          } else if (a.hasOwnProperty('fragmentationHint')) {
            l = a.fragmentationHint;
          }
          var startOffset = Math.min(a.startOffset, a.endOffset);
          var endOffset = Math.max(a.startOffset, a.endOffset);
          var opener = {
            pos: startOffset,
            mode: ENTER,
            level: l,
            id: a.id,
            type: a.type,
            node: a,
            length: 0,
            counter: -1,
          };
          openers.push(opener);
          closers.push({
            pos: endOffset,
            mode: EXIT,
            level: l,
            id: a.id,
            type: a.type,
            node: a,
            opener: opener
          });
        }
      });

      // sort the openers
      openers.sort(_compareOpeners);
      // store indexes for openers
      for (var i = openers.length - 1; i >= 0; i--) {
        openers[i].idx = i;
      }
      closers.sort(_compareClosers);
      // merge openers and closers, sorted by pos
      var entries = new Array(openers.length+closers.length);
      var idx = 0;
      var idx1 = 0;
      var idx2 = 0;
      var opener = openers[idx1];
      var closer = closers[idx2];
      while(opener || closer) {
        if (opener && closer) {
          // close before open
          if (closer.pos <= opener.pos && closer.opener !== opener) {
            entries[idx] = closer;
            idx2++;
          } else {
            entries[idx] = opener;
            idx1++;
          }
        } else if (opener) {
          entries[idx] = opener;
          idx1++;
        } else if (closer) {
          entries[idx] = closer;
          idx2++;
        }
        opener = openers[idx1];
        closer = closers[idx2];
        idx++;
      }
      return entries;
    }

    function _compareOpeners(a, b) {
      if (a.pos < b.pos) return -1;
      if (a.pos > b.pos) return 1;
      if (a.mode < b.mode) return -1;
      if (a.mode > b.mode) return 1;
      if (a.mode === b.mode) {
        if (a.level < b.level) return -1;
        if (a.level > b.level) return 1;
      }
      return 0;
    }

    // sort in inverse order of openers
    function _compareClosers(a, b) {
      if (a.pos < b.pos) return -1;
      if (a.pos > b.pos) return 1;
      // this makes closer be sorted in inverse order of openers
      // to reduce stack sice
      // HACK: a bit trial error. When we have to collapsed annotations
      // at the same position then we want the closers in the same order
      // as the openers.
      if (a.pos === a.opener.pos && b.pos === b.opener.pos) {
        if (a.opener.idx < b.opener.idx) {
          return -1;
        } else {
          return 1;
        }
      }
      if (a.opener.idx > b.opener.idx) return -1;
      if (a.opener.idx < b.opener.idx) return 1;
      return 0;
    }

    this._enter = function(entry, parentContext) {
      entry.counter++;
      return this.onEnter(entry, parentContext);
    };

    this._exit = function(entry, context, parentContext) {
      this.onExit(entry, context, parentContext);
    };

    this._createText = function(context, text, entry) {
      this.onText(context, text, entry);
    };

    this._start = function(rootContext, text, annotations) {
      var entries = _extractEntries.call(this, annotations);
      var stack = [{context: rootContext, entry: null}];

      var pos = 0;
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        var textFragment = text.substring(pos, entry.pos);
        if (textFragment) {
          // add the last text to the current element
          this._createText(stack[stack.length-1].context, textFragment, entry);
        }

        pos = entry.pos;
        var stackLevel, idx, _entry;
        if (entry.mode === ENTER || entry.mode === ANCHOR) {
          // find the correct position and insert an entry
          for (stackLevel = 1; stackLevel < stack.length; stackLevel++) {
            if (entry.level < stack[stackLevel].entry.level) {
              break;
            }
          }
          // create elements which are open, and are now stacked ontop of the
          // entered entry
          for (idx = stack.length-1; idx >= stackLevel; idx--) {
            _entry = stack[idx].entry;
            // compute number of characters since last 'enter'
            _entry.length = pos - _entry.pos;
            this._exit(_entry, stack[idx].context, stack[idx-1].context);
          }
          stack.splice(stackLevel, 0, {entry: entry});
          // create new elements for all lower entries
          for (idx = stackLevel; idx < stack.length; idx++) {
            _entry = stack[idx].entry;
            // bump 'enter' pos
            _entry.pos = pos;
            stack[idx].context = this._enter(_entry, stack[idx-1].context);
          }
        }
        if (entry.mode === EXIT || entry.mode === ANCHOR) {
          // find the according entry and remove it from the stack
          for (stackLevel = 1; stackLevel < stack.length; stackLevel++) {
            if (stack[stackLevel].entry.node === entry.node) {
              break;
            }
          }
          for (idx = stack.length-1; idx >= stackLevel; idx--) {
            _entry = stack[idx].entry;
            // compute number of characters since last 'enter'
            _entry.length = pos - _entry.pos;
            this._exit(_entry, stack[idx].context, stack[idx-1].context);
          }
          stack.splice(stackLevel, 1);
          // create new elements for all lower entries
          for (idx = stackLevel; idx < stack.length; idx++) {
            _entry = stack[idx].entry;
            // bump 'enter' pos
            _entry.pos = pos;
            stack[idx].context = this._enter(_entry, stack[idx-1].context);
          }
        }
      }

      // Finally append a trailing text node
      var trailingText = text.substring(pos);
      if (trailingText) {
        this._createText(rootContext, trailingText);
      }
    };

  };

  oo$m.initClass(Fragmenter$1);

  Fragmenter$1.SHOULD_NOT_SPLIT = 0;
  Fragmenter$1.NORMAL = 10;
  Fragmenter$1.ANY = 100;
  Fragmenter$1.ALWAYS_ON_TOP = Number.MAX_VALUE;

  module.exports = Fragmenter$1;

  var DOMExporter$1 = require('./DOMExporter');
  var DefaultDOMElement = require('../ui/DefaultDOMElement');
  var extend$9 = require('lodash/extend');
  var each$a = require('lodash/each');
  var isBoolean$1 = require('lodash/isBoolean');
  var isNumber$8 = require('lodash/isNumber');
  var isString$d = require('lodash/isString');

  /**
    @class
    @abstract

    Base class for custom HTML exporters. If you want to use XML as your
    exchange format see {@link model/XMLExporter}.

    @example

    Below is a full example taken from the [Notepad](https://github.com/substance/examples/blob/master/converter/NoteExporter.js) example.

    ```js
    var HTMLExporter = require('substance/model/HTMLExporter');
    var converters = require('./NoteImporter').converters;

    function NoteExporter() {
      NoteExporter.super.call(this, {
        converters: converters,
        containerId: 'body'
      });
    }

    HTMLExporter.extend(NoteExporter);
    ```
  */

  function HTMLExporter(config) {
    config = extend$9({ idAttribute: 'data-id' }, config);
    DOMExporter$1.call(this, config);

    // used internally for creating elements
    this._el = DefaultDOMElement.parseHTML('<html></html>');
  }

  HTMLExporter.Prototype = function() {

    this.exportDocument = function(doc) {
      var htmlEl = DefaultDOMElement.parseHTML('<html><head></head><body></body></html>');
      return this.convertDocument(doc, htmlEl);
    };

    var defaultAnnotationConverter = {
      tagName: 'span',
      export: function(node, el) {
        el.tagName = 'span';
        el.attr('data-type', node.type);
        var properties = node.toJSON();
        each$a(properties, function(value, name) {
          if (name === 'id' || name === 'type') return;
          if (isString$d(value) || isNumber$8(value) || isBoolean$1(value)) {
            el.attr('data-'+name, value);
          }
        });
      }
    };

    var defaultBlockConverter = {
      export: function(node, el, converter) {
        el.attr('data-type', node.type);
        var properties = node.toJSON();
        each$a(properties, function(value, name) {
          if (name === 'id' || name === 'type') {
            return;
          }
          var prop = converter.$$('div').attr('property', name);
          if (node.getPropertyType(name) === 'string' && value) {
            prop.append(converter.annotatedText([node.id, name]));
          } else {
            prop.text(value);
          }
          el.append(prop);
        });
      }
    };

    this.getDefaultBlockConverter = function() {
      return defaultBlockConverter;
    };

    this.getDefaultPropertyAnnotationConverter = function() {
      return defaultAnnotationConverter;
    };

  };

  DOMExporter$1.extend(HTMLExporter);

  module.exports = HTMLExporter;

  var DOMImporter$1 = require('./DOMImporter');
  var DefaultDOMElement$1 = require('../ui/DefaultDOMElement');
  var extend$a = require('lodash/extend');

  /**
    @class
    @abstract

    Base class for custom HTML importers. If you want to use XML as your
    exchange format see {@link model/XMLImporter}.

    @example

    Below is a full example taken from the [Notepad](https://github.com/substance/examples/blob/master/converter/NoteImporter.js) example.

    ```js
    var HTMLImporter = require('substance/model/HTMLImporter');
    var noteSchema = require('../note/noteSchema');
    var Note = require('../note/Note');

    var converters = [
      require('substance/packages/paragraph/ParagraphHTMLConverter'),
      require('substance/packages/blockquote/BlockquoteHTMLConverter'),
      require('substance/packages/codeblock/CodeblockHTMLConverter'),
      require('substance/packages/heading/HeadingHTMLConverter'),
      require('substance/packages/strong/StrongHTMLConverter'),
      require('substance/packages/emphasis/EmphasisHTMLConverter'),
      require('substance/packages/link/LinkHTMLConverter'),
      require('./MarkHTMLConverter'),
      require('./TodoHTMLConverter')
    ];

    function NoteImporter() {
      NoteImporter.super.call(this, {
        schema: noteSchema,
        converters: converters,
        DocumentClass: Note
      });
    }

    NoteImporter.Prototype = function() {
      this.convertDocument = function(bodyEls) {
        this.convertContainer(bodyEls, 'body');
      };
    };

    // Expose converters so we can reuse them in NoteHtmlExporter
    NoteImporter.converters = converters;

    HTMLImporter.extend(NoteImporter);
    ```
  */

  function HTMLImporter(config) {
    config = extend$a({ idAttribute: 'data-id' }, config);
    DOMImporter$1.call(this, config);

    // only used internally for creating wrapper elements
    this._el = DefaultDOMElement$1.parseHTML('<html></html>');
  }

  HTMLImporter.Prototype = function() {

    this.importDocument = function(html) {
      this.reset();
      var parsed = DefaultDOMElement$1.parseHTML(html);
      this.convertDocument(parsed);
      var doc = this.generateDocument();
      return doc;
    };

    /**
      Orchestrates conversion of a whole document.

      This method should be overridden by custom importers to reflect the
      structure of a custom HTML document or fragment, and to control where
      things go to within the document.

      @abstract
      @param {ui/DOMElement} documentEl the document element.

      @example

      When a fragment `<h1>Foo</h1><p></Bar</p>` is imported the implementation
      looks like this.

      ```js
        this.convertDocument = function(els) {
          this.convertContainer(els, 'body');
        };
      ```

      If a full document `<html><body><p>A</p><p>B</p></body></html>` is imported
      you get the `<html>` element instead of a node array.

      ```js
        this.convertDocument = function(htmlEl) {
          var bodyEl = htmlEl.find('body');
          this.convertContainer(bodyEl.children, 'body');
        };
      ```
    */
    this.convertDocument = function(documentEl) { // eslint-disable-line
      throw new Error('This method is abstract');
    };

  };

  DOMImporter$1.extend(HTMLImporter);

  module.exports = HTMLImporter;

  var PropertyAnnotation$1 = require('./PropertyAnnotation');

  function InlineNode() {
    InlineNode.super.apply(this, arguments);
  }

  PropertyAnnotation$1.extend(InlineNode);

  InlineNode.static.isInline = true;

  module.exports = InlineNode;

  var isArray$9 = require('lodash/isArray');
  var each$b = require('lodash/each');
  var oo$n = require('../util/oo');

  function JSONConverter$3() {}

  JSONConverter$3.Prototype = function() {

    this.importDocument = function(doc, json) {
      if (!json.schema || !isArray$9(json.nodes)) {
        throw new Error('Invalid JSON format.');
      }
      var schema = doc.getSchema();
      if (schema.name !== json.schema.name) {
        throw new Error('Incompatible schema.');
      }
      if (schema.version !== json.schema.version) {
        console.error('Different schema version. Conversion might be problematic.');
      }
      // the json should just be an array of nodes
      var nodes = json.nodes;
      // import data in a block with deactivated indexers and listeners
      // as the data contains cyclic references which
      // cause problems.
      doc.import(function(tx) {
        each$b(nodes, function(node) {
          // overwrite existing nodes
          if (tx.get(node.id)) {
            tx.delete(node.id);
          }
          tx.create(node);
        });
      });
      return doc;
    };

    this.exportDocument = function(doc) {
      var schema = doc.getSchema();
      var json = {
        schema: {
          name: schema.name,
          version: schema.version
        },
        nodes: []
      };
      each$b(doc.getNodes(), function(node) {
        if (node._isDocumentNode) {
          json.nodes.push(node.toJSON());
        }
      });
      return json;
    };
  };

  oo$n.initClass(JSONConverter$3);

  module.exports = JSONConverter$3;

  var isString$e = require('lodash/isString');
  var Selection$9 = require('./Selection');
  var Coordinate$4 = require('./Coordinate');

  function NodeSelection(containerId, nodeId, mode, reverse, surfaceId) {
    Selection$9.call(this);

    if (!isString$e(containerId)) {
      throw new Error("'containerId' is mandatory.");
    }
    if (!isString$e(nodeId)) {
      throw new Error("'nodeId' is mandatory.");
    }
    if (['full', 'before', 'after'].indexOf(mode) < 0) {
      throw new Error("'mode' is mandatory.");
    }

    this.containerId = containerId;
    this.nodeId = nodeId;
    this.mode = mode;
    this.reverse = Boolean(reverse);
    this.surfaceId = surfaceId;
  }

  NodeSelection.Prototype = function() {

    this._isNodeSelection = true;

    var _super = NodeSelection.super.prototype;

    this.equals = function(other) {
      return (
        _super.call(this, other) &&
        this.nodeId === other.nodeId &&
        this.mode === other.mode
      );
    };

    this.isNodeSelection = function() {
      return true;
    };

    this.getType = function() {
      return 'node';
    };

    this.getNodeId = function() {
      return this.nodeId;
    };

    this.isFull = function() {
      return this.mode === 'full';
    };

    this.isBefore = function() {
      return this.mode === 'before';
    };

    this.isAfter = function() {
      return this.mode === 'after';
    };

    this.isCollapsed = function() {
      return this.mode !== 'full';
    };

    this.toJSON = function() {
      return {
        containerId: this.containerId,
        nodeId: this.nodeId,
        mode: this.mode,
        reverse: this.reverse,
        surfaceId: this.surfaceId
      };
    };

    this.collapse = function(direction) {
      if (direction === 'left') {
        if (this.isBefore()) {
          return this;
        } else {
          return new NodeSelection(this.containerId, this.nodeId, 'before', this.reverse, this.surfaceId);
        }
      } else if (direction === 'right') {
        if (this.isAfter()) {
          return this;
        } else {
          return new NodeSelection(this.containerId, this.nodeId, 'after', this.reverse, this.surfaceId);
        }
      } else {
        throw new Error("'direction' must be either 'left' or 'right'");
      }
    };

    this._getCoordinate = function() {
      if (this.mode === 'before') {
        return new Coordinate$4([this.nodeId], 0);
      } else if (this.mode === 'after') {
        return new Coordinate$4([this.nodeId], 1);
      }
    };

  };

  Selection$9.extend(NodeSelection);

  NodeSelection.fromJSON = function(json) {
    return new NodeSelection(json.containerId, json.nodeId, json.mode, json.reverse);
  };

  NodeSelection._createFromRange = function(range) {
    var containerId = range.containerId;
    var nodeId = range.start.getNodeId();
    var startOffset = range.start.offset;
    var endOffset = range.end.offset;
    var reverse = range.reverse;
    var mode;
    if (startOffset === endOffset) {
      mode = startOffset === 0 ? 'before' : 'after';
    } else {
      mode = 'full';
    }
    return new NodeSelection(containerId, nodeId, mode, reverse);
  };

  NodeSelection._createFromCoordinate = function(coor) {
    var containerId = coor.containerId;
    var nodeId = coor.getNodeId();
    var mode = coor.offset === 0 ? 'before' : 'after';
    return new NodeSelection(containerId, nodeId, mode, false);
  };

  module.exports = NodeSelection;

  /**
    Mix-in for parent nodes.

    ParentNodes are nodes which have children nodes,
    such as List, Table, TableSection, TableRow.

    @mixin
  */
  var ParentNodeMixin$1 = {

    hasChildren: function() {
      return true;
    },

    getChildrenProperty: function() {
      throw new Error('ParentNodeMixin.getChildrenProperty is abstract and must be implemented in ' + this.constructor.name + '.');
    },

    getChildIndex: function(child) {
      return this[this.getChildrenProperty()].indexOf(child.id);
    },

    getChildren: function() {
      var doc = this.getDocument();
      var childrenIds = this[this.getChildrenProperty()];
      return childrenIds.map(function(id) {
        return doc.get(id);
      });
    },

    getChildAt: function(idx) {
      var children = this[this.getChildrenProperty()];
      if (idx < 0 || idx >= children.length) {
        throw new Error('Array index out of bounds: ' + idx + ", " + children.length);
      }
      return this.getDocument().get(children[idx]);
    },

    getChildCount: function() {
      return this[this.getChildrenProperty()].length;
    },

    getAddressablePropertyNames: function() {
      return [this.getChildrenProperty()];
    },

  };

  module.exports = ParentNodeMixin$1;

  var forEach$5 = require('lodash/forEach');
  var isEqual$8 = require('lodash/isEqual');
  var isArray$a = require('lodash/isArray');
  var oo$o = require('../util/oo');
  var TreeIndex$4 = require('../util/TreeIndex');

  function PathEventProxy$1(doc) {
    this.listeners = new TreeIndex$4.Arrays();
    this._list = [];
    this.doc = doc;
  }

  PathEventProxy$1.Prototype = function() {

    this.on = function(path, method, context) {
      this._add(context, path, method);
    };

    // proxy.off(this)
    // proxy.off(this, path)
    // proxy.off(this, path, this.onPropertyUpdate)
    this.off = function(context, path, method) {
      this._remove(context, path, method);
    };

    this.connect = function(listener, path, method) {
      console.warn('DEPRECATED: use proxy.on(path, this.onPropertyChange, this) instead');
      this.on(path, method, listener);
    };

    this.disconnect = function(listener) {
      console.warn('DEPRECATED: use proxy.off(this) instead');
      this.off(listener);
    };

    this.onDocumentChanged = function(change, info, doc) {
      // stop if no listeners registered
      if (this._list.length === 0) {
        return;
      }
      var listeners = this.listeners;
      forEach$5(change.updated, function(_, pathStr) {
        var scopedListeners = listeners.get(pathStr.split(','));
        if (isArray$a(scopedListeners)) scopedListeners = scopedListeners.slice(0);
        forEach$5(scopedListeners, function(entry) {
          entry.method.call(entry.listener, change, info, doc);
        });
      });
    };

    this._add = function(listener, path, method) {
      if (!method) {
        throw new Error('Invalid argument: expected function but got ' + method);
      }
      var entry = { listener: listener, path: path, method: method };
      this.listeners.add(path, entry);
      this._list.push(entry);
    };

    this._remove = function(listener, path, method) {
      for (var i = 0; i < this._list.length; i++) {
        var item = this._list[i];
        var match = (
          (!path || isEqual$8(item.path, path)) &&
          (!listener || item.listener === listener) &&
          (!method || item.method !== method)
        );
        if (match) {
          var entry = this._list[i];
          this._list.splice(i, 1);
          this.listeners.remove(entry.path, entry);
        }
      }
    };

  };

  oo$o.initClass(PathEventProxy$1);

  module.exports = PathEventProxy$1;

  var isEqual$9 = require('lodash/isEqual');
  var DocumentNode$5 = require('./DocumentNode');

  /**
    A property annotation can be used to overlay text and give it a special meaning.
    PropertyAnnotations only work on text properties. If you want to annotate multiple
    nodes you have to use a {@link model/ContainerAnnotation}.

    @class
    @abstract

    @prop {String[]} path Identifies a text property in the document (e.g. `['text_1', 'content']`)
    @prop {Number} startOffset the character where the annoation starts
    @prop {Number} endOffset: the character where the annoation starts

    @example

    Here's how a **strong** annotation is created. In Substance annotations are stored
    separately from the text. Annotations are just regular nodes in the document.
    They refer to a certain range (`startOffset, endOffset`) in a text property (`path`).

    ```js
    doc.transaction(function(tx) {
      tx.create({
        id: 's1',
        type: 'strong',
        path: ['p1', 'content'],
        "startOffset": 10,
        "endOffset": 19
      });
    });
    ```
  **/

  function PropertyAnnotation$2() {
    PropertyAnnotation$2.super.apply(this, arguments);
  }

  PropertyAnnotation$2.Prototype = function() {

    this._isAnnotation = true;
    this._isPropertyAnnotation = true;

    /**
      Get the plain text spanned by this annotation.

      @returns {String}
    */
    this.getText = function() {
      var doc = this.getDocument();
      if (!doc) {
        console.warn('Trying to use an PropertyAnnotation which is not attached to the document.');
        return "";
      }
      var text = doc.get(this.path);
      return text.substring(this.startOffset, this.endOffset);
    };

    /**
      Determines if an annotation can be split e.g., when breaking a node.

      In these cases, a new annotation will be created attached to the created node.

      For certain annotation types,you may want to the annotation truncated
      rather than split, where you need to override this method returning `false`.
    */
    this.canSplit = function() {
      return true;
    };

    /**
      If this annotation is a an Anchor.

      Anchors are annotations with a zero width.
      For instance, ContainerAnnotation have a start and an end anchor,
      or rendered cursors are modeled as anchors.

      @returns {Boolean}
    */
    this.isAnchor = function() {
      return false;
    };

    // TODO: maybe this should go into documentHelpers
    this.getSelection = function() {
      return this.getDocument().createSelection({
        type: 'property',
        path: this.path,
        startOffset: this.startOffset,
        endOffset: this.endOffset
      });
    };

    this.updateRange = function(tx, sel) {
      if (!sel.isPropertySelection()) {
        throw new Error('Cannot change to ContainerAnnotation.');
      }
      if (!isEqual$9(this.startPath, sel.start.path)) {
        tx.set([this.id, 'path'], sel.start.path);
      }
      if (this.startOffset !== sel.start.offset) {
        tx.set([this.id, 'startOffset'], sel.start.offset);
      }
      if (this.endOffset !== sel.end.offset) {
        tx.set([this.id, 'endOffset'], sel.end.offset);
      }
    };

  };

  DocumentNode$5.extend(PropertyAnnotation$2);

  PropertyAnnotation$2.static.name = "annotation";

  PropertyAnnotation$2.static.defineSchema({
    path: ["string"],
    startOffset: "number",
    endOffset: "number"
  });

  PropertyAnnotation$2.static.isPropertyAnnotation = true;

  // these properties making PropertyAnnotation compatible with ContainerAnnotations
  Object.defineProperties(PropertyAnnotation$2.prototype, {
    startPath: {
      get: function() {
        return this.path;
      }
    },
    endPath: {
      get: function() {
        return this.path;
      }
    }
  });

  module.exports = PropertyAnnotation$2;

  var isEqual$a = require('lodash/isEqual');
  var isNumber$9 = require('lodash/isNumber');
  var Selection$a = require('./Selection');
  var Coordinate$5 = require('./Coordinate');
  var Range$1 = require('./Range');

  /**
    A selection which is bound to a property. Implements {@link model/Selection}.

    @class
    @extends model/Selection

    @example

    ```js
    var propSel = doc.createSelection({
      type: 'property',
      path: ['p1', 'content'],
      startOffset: 3,
      endOffset: 6
    });
  */
  function PropertySelection$1(path, startOffset, endOffset, reverse, containerId, surfaceId) {
    Selection$a.call(this);

    /**
      The path to the selected property.
      @type {String[]}
    */
    this.path = path;

    /**
      Start character position.
      @type {Number}
    */
    this.startOffset = startOffset;

    /**
      End character position.
      @type {Number}
    */
    this.endOffset = endOffset;

    /**
      Selection direction.
      @type {Boolean}
    */
    this.reverse = Boolean(reverse);

    this.containerId = containerId;

    /**
      Identifier of the surface this selection should be active in.
      @type {String}
    */
    this.surfaceId = surfaceId;

    if (!path || !isNumber$9(startOffset)) {
      throw new Error('Invalid arguments: `path` and `startOffset` are mandatory');
    }

    // dynamic adapters for Coordinate oriented implementations
    this._internal.start = new CoordinateAdapter$1(this, 'path', 'startOffset');
    this._internal.end = new CoordinateAdapter$1(this, 'path', 'endOffset');
    this._internal.range = new RangeAdapter$1(this);
  }

  PropertySelection$1.Prototype = function() {

    /**
      Convert container selection to JSON.

      @returns {Object}
    */
    this.toJSON = function() {
      return {
        type: 'property',
        path: this.path,
        startOffset: this.startOffset,
        endOffset: this.endOffset,
        reverse: this.reverse,
        containerId: this.containerId,
        surfaceId: this.surfaceId
      };
    };

    this.isPropertySelection = function() {
      return true;
    };

    this.getType = function() {
      return 'property';
    };

    this.isNull = function() {
      return false;
    };

    this.isCollapsed = function() {
      return this.startOffset === this.endOffset;
    };

    this.isReverse = function() {
      return this.reverse;
    };

    this.equals = function(other) {
      return (
        Selection$a.prototype.equals.call(this, other) &&
        (this.start.equals(other.start) && this.end.equals(other.end))
      );
    };

    this.toString = function() {
      return [
        "PropertySelection(", JSON.stringify(this.path), ", ",
        this.startOffset, " -> ", this.endOffset,
        (this.reverse?", reverse":""),
        ")"
      ].join('');
    };

    /**
      Collapse a selection to chosen direction.

      @param {String} direction either left of right
      @returns {PropertySelection}
    */
    this.collapse = function(direction) {
      var offset;
      if (direction === 'left') {
        offset = this.startOffset;
      } else {
        offset = this.endOffset;
      }
      return this.createWithNewRange(offset, offset);
    };

    // Helper Methods
    // ----------------------

    this.getRange = function() {
      return this.range;
    };

    /**
      Get path of a selection, e.g. target property where selected data is stored.

      @returns {String[]} path
    */
    this.getPath = function() {
      return this.path;
    };

    this.getNodeId = function() {
      return this.path[0];
    };

    /**
      Get start character position.

      @returns {Number} offset
    */
    this.getStartOffset = function() {
      return this.startOffset;
    };

    /**
      Get end character position.

      @returns {Number} offset
    */
    this.getEndOffset = function() {
      return this.endOffset;
    };

    /**
      Checks if this selection is inside another one.

      @param {Selection} other
      @param {Boolean} [strict] true if should check that it is strictly inside the other
      @returns {Boolean}
    */
    this.isInsideOf = function(other, strict) {
      if (other.isNull()) return false;
      if (other.isContainerSelection()) {
        return other.contains(this, strict);
      }
      if (strict) {
        return (isEqual$a(this.path, other.path) &&
          this.startOffset > other.startOffset &&
          this.endOffset < other.endOffset);
      } else {
        return (isEqual$a(this.path, other.path) &&
          this.startOffset >= other.startOffset &&
          this.endOffset <= other.endOffset);
      }
    };

    /**
      Checks if this selection contains another one.

      @param {Selection} other
      @param {Boolean} [strict] true if should check that it is strictly contains the other
      @returns {Boolean}
    */
    this.contains = function(other, strict) {
      if (other.isNull()) return false;
      return other.isInsideOf(this, strict);
    };

    /**
      Checks if this selection overlaps another one.

      @param {Selection} other
      @param {Boolean} [strict] true if should check that it is strictly overlaps the other
      @returns {Boolean}
    */
    this.overlaps = function(other, strict) {
      if (other.isNull()) return false;
      if (other.isContainerSelection()) {
        // console.log('PropertySelection.overlaps: delegating to ContainerSelection.overlaps...');
        return other.overlaps(this);
      }
      if (!isEqual$a(this.path, other.path)) return false;
      if (strict) {
        return (! (this.startOffset>=other.endOffset||this.endOffset<=other.startOffset) );
      } else {
        return (! (this.startOffset>other.endOffset||this.endOffset<other.startOffset) );
      }
    };

    /**
      Checks if this selection has the right boundary in common with another one.

      @param {Selection} other
      @returns {Boolean}
    */
    this.isRightAlignedWith = function(other) {
      if (other.isNull()) return false;
      if (other.isContainerSelection()) {
        // console.log('PropertySelection.isRightAlignedWith: delegating to ContainerSelection.isRightAlignedWith...');
        return other.isRightAlignedWith(this);
      }
      return (isEqual$a(this.path, other.path) &&
        this.endOffset === other.endOffset);
    };

    /**
      Checks if this selection has the left boundary in common with another one.

      @param {Selection} other
      @returns {Boolean}
    */
    this.isLeftAlignedWith = function(other) {
      if (other.isNull()) return false;
      if (other.isContainerSelection()) {
        // console.log('PropertySelection.isLeftAlignedWith: delegating to ContainerSelection.isLeftAlignedWith...');
        return other.isLeftAlignedWith(this);
      }
      return (isEqual$a(this.path, other.path) &&
        this.startOffset === other.startOffset);
    };

    /**
      Expands selection to include another selection.

      @param {Selection} other
      @returns {Selection} a new selection
    */
    this.expand = function(other) {
      if (other.isNull()) return this;

      // if the other is a ContainerSelection
      // we delegate to that implementation as it is more complex
      // and can deal with PropertySelections, too
      if (other.isContainerSelection()) {
        return other.expand(this);
      }
      if (!isEqual$a(this.path, other.path)) {
        throw new Error('Can not expand PropertySelection to a different property.');
      }
      var newStartOffset = Math.min(this.startOffset, other.startOffset);
      var newEndOffset = Math.max(this.endOffset, other.endOffset);
      return this.createWithNewRange(newStartOffset, newEndOffset);
    };


    /**
      Creates a new selection by truncating this one by another selection.

      @param {Selection} other
      @returns {Selection} a new selection
    */
    this.truncateWith = function(other) {
      if (other.isNull()) return this;
      if (other.isInsideOf(this, 'strict')) {
        // the other selection should overlap only on one side
        throw new Error('Can not truncate with a contained selections');
      }
      if (!this.overlaps(other)) {
        return this;
      }
      var otherStartOffset, otherEndOffset;
      if (other.isPropertySelection()) {
        otherStartOffset = other.startOffset;
        otherEndOffset = other.endOffset;
      } else if (other.isContainerSelection()) {
        // either the startPath or the endPath must be the same
        if (isEqual$a(other.startPath, this.path)) {
          otherStartOffset = other.startOffset;
        } else {
          otherStartOffset = this.startOffset;
        }
        if (isEqual$a(other.endPath, this.path)) {
          otherEndOffset = other.endOffset;
        } else {
          otherEndOffset = this.endOffset;
        }
      } else {
        return this;
      }

      var newStartOffset;
      var newEndOffset;
      if (this.startOffset > otherStartOffset && this.endOffset > otherEndOffset) {
        newStartOffset = otherEndOffset;
        newEndOffset = this.endOffset;
      } else if (this.startOffset < otherStartOffset && this.endOffset < otherEndOffset) {
        newStartOffset = this.startOffset;
        newEndOffset = otherStartOffset;
      } else if (this.startOffset === otherStartOffset) {
        if (this.endOffset <= otherEndOffset) {
          return Selection$a.nullSelection;
        } else {
          newStartOffset = otherEndOffset;
          newEndOffset = this.endOffset;
        }
      } else if (this.endOffset === otherEndOffset) {
        if (this.startOffset >= otherStartOffset) {
          return Selection$a.nullSelection;
        } else {
          newStartOffset = this.startOffset;
          newEndOffset = otherStartOffset;
        }
      } else if (other.contains(this)) {
        return Selection$a.nullSelection;
      } else {
        // FIXME: if this happens, we have a bug somewhere above
        throw new Error('Illegal state.');
      }
      return this.createWithNewRange(newStartOffset, newEndOffset);
    };

    /**
      Creates a new selection with given range and same path.

      @param {Number} startOffset
      @param {Number} endOffset
      @returns {Selection} a new selection
    */
    this.createWithNewRange = function(startOffset, endOffset) {
      var sel = new PropertySelection$1(this.path, startOffset, endOffset, false, this.containerId, this.surfaceId);
      var doc = this._internal.doc;
      if (doc) {
        sel.attach(doc);
      }
      return sel;
    };

    /**
      Return fragments for a given selection.

      @returns {Selection.Fragment[]}
    */
    this.getFragments = function() {
      if(this._internal.fragments) {
        return this._internal.fragments;
      }

      var fragments;

      if (this.isCollapsed()) {
        fragments = [new Selection$a.Cursor(this.path, this.startOffset)];
      } else {
        fragments = [new Selection$a.Fragment(this.path, this.startOffset, this.endOffset)];
      }

      this._internal.fragments = fragments;
      return fragments;
    };

    this._clone = function() {
      return new PropertySelection$1(this.path, this.startOffset, this.endOffset, this.reverse, this.containerId, this.surfaceId);
    };

  };

  Selection$a.extend(PropertySelection$1);

  Object.defineProperties(PropertySelection$1.prototype, {
    /**
      @property {Coordinate} PropertySelection.start
    */
    start: {
      get: function() {
        return this._internal.start;
      },
      set: function() { throw new Error('PropertySelection.prototype.start is read-only.'); },
      enumerable: false
    },
    /**
      @property {Coordinate} PropertySelection.end
    */
    end: {
      get: function() {
        return this._internal.end;
      },
      set: function() { throw new Error('PropertySelection.prototype.end is read-only.'); },
      enumerable: false
    },
    range: {
      get: function() {
        return this._internal.range;
      },
      set: function() { throw new Error('PropertySelection.prototype.range is read-only.'); },
      enumerable: false
    },

    // making this similar to ContainerSelection
    startPath: {
      get: function() {
        return this.path;
      },
      set: function() { throw new Error('immutable.'); },
      enumerable: false
    },
    endPath: {
      get: function() {
        return this.path;
      },
      set: function() { throw new Error('immutable.'); },
      enumerable: false
    },
  });

  PropertySelection$1.fromJSON = function(json) {
    var path = json.path;
    var startOffset = json.startOffset;
    var endOffset = json.hasOwnProperty('endOffset') ? json.endOffset : json.startOffset;
    var reverse = json.reverse;
    var containerId = json.containerId;
    var surfaceId = json.surfaceId;
    return new PropertySelection$1(path, startOffset, endOffset, reverse, containerId, surfaceId);
  };

  /*
    Adapter for Coordinate oriented implementations.
    E.g. Coordinate transforms can be applied to update selections
    using OT.
  */
  function CoordinateAdapter$1(propertySelection, pathProperty, offsetProperty) {
    this._sel = propertySelection;
    this._pathProp = pathProperty;
    this._offsetProp = offsetProperty;
    Object.freeze(this);
  }

  Coordinate$5.extend(CoordinateAdapter$1);

  Object.defineProperties(CoordinateAdapter$1.prototype, {
    path: {
      get: function() {
        return this._sel[this._pathProp];
      },
      set: function(path) {
        this._sel[this._pathProp] = path;
      }
    },
    offset: {
      get: function() {
        return this._sel[this._offsetProp];
      },
      set: function(offset) {
        this._sel[this._offsetProp] = offset;
      }
    }
  });

  PropertySelection$1.CoordinateAdapter = CoordinateAdapter$1;

  function RangeAdapter$1(sel) {
    this._sel = sel;
    this.start = sel.start;
    this.end = sel.end;
    Object.freeze(this);
  }

  Range$1.extend(RangeAdapter$1);

  Object.defineProperties(RangeAdapter$1.prototype, {
    reverse: {
      get: function() {
        return this._sel.reverse;
      },
      set: function(reverse) {
        this._sel.reverse = reverse;
      }
    },
    containerId: {
      get: function() {
        return this._sel.containerId;
      },
      set: function(containerId) {
        this._sel.containerId = containerId;
      }
    },
    surfaceId: {
      get: function() {
        return this._sel.surfaceId;
      },
      set: function(surfaceId) {
        this._sel.surfaceId = surfaceId;
      }
    },
  });

  PropertySelection$1.RangeAdapter = RangeAdapter$1;

  module.exports = PropertySelection$1;

  var oo$p = require('../util/oo');

  function Range$2(start, end, reverse, containerId) {
    this.start = start;
    this.end = end;
    this.reverse = Boolean(reverse);
    this.containerId = containerId;
  }

  Range$2.Prototype = function() {

    this._isRange = true;

    this.isCollapsed = function() {
      return this.start.equals(this.end);
    };

    this.equals = function(other) {
      if (this === other) return true;
      else {
        return (
          this.containerId === other.containerId &&
          this.start.equals(other.start) &&
          this.end.equals(other.end)
        );
      }
    };

    this.isReverse = function() {
      return this.reverse;
    };

    this.toString = function() {
      var str = [this.start.toString(), '->', this.end.toString()];
      if (this.isReverse()) {
        str.push('(reverse)');
      }
      return str.join('');
    };

  };

  oo$p.initClass(Range$2);

  module.exports = Range$2;

  var oo$q = require('../util/oo');
  var EventEmitter$a = require('../util/EventEmitter');
  var Anchor$2 = require('./Anchor');

  /**
    A document selection. Refers to a Substance document model, not to the DOM.

    Implemented by {@link model/PropertySelection} and {@link model/ContainerSelection}

    @class
    @abstract
  */

  function Selection$b() {
    // Internal stuff
    var _internal = {};
    Object.defineProperty(this, "_internal", {
      enumerable: false,
      value: _internal
    });
      // set when attached to document
    _internal.doc = null;
  }

  Selection$b.Prototype = function() {

    this._isSelection = true;

    this.clone = function() {
      var newSel = this._clone();
      if (this._internal.doc) {
        newSel.attach(this._internal.doc);
      }
      return newSel;
    };

    /**
      @returns {Document} The attached document instance
    */
    this.getDocument = function() {
      var doc = this._internal.doc;
      if (!doc) {
        throw new Error('Selection is not attached to a document.');
      }
      return doc;
    };

    this.isAttached = function() {
      return Boolean(this._internal.doc);
    };

    /**
      Attach document to the selection.

      @private
      @param {Document} doc document to attach
      @returns {this}
    */
    this.attach = function(doc) {
      this._internal.doc = doc;
      return this;
    };

    /**
      @returns {Boolean} true when selection is null.
    */
    this.isNull = function() {
      return false;
    };

    /**
      @returns {Boolean} true for property selections
    */
    this.isPropertySelection = function() {
      return false;
    };

    /**
      @returns {Boolean} true if selection is a {@link model/ContainerSelection}
    */
    this.isContainerSelection = function() {
      return false;
    };

    /**
      @returns {Boolean} true if selection is a {@link model/NodeSelection}
    */
    this.isNodeSelection = function() {
      return false;
    };

    this.isCustomSelection = function() {
      return false;
    };

    /**
      @returns {Boolean} true when selection is collapsed
    */
    this.isCollapsed = function() {
      return true;
    };

    /**
      @returns {Boolean} true if startOffset < endOffset
    */
    this.isReverse = function() {
      return false;
    };

    this.getType = function() {
      throw new Error('Selection.getType() is abstract.');
    };

    /**
      @returns {Boolean} true if selection equals `other` selection
    */
    this.equals = function(other) {
      if (this === other) {
        return true ;
      } else if (!other) {
        return false;
      } else if (this.isNull() !== other.isNull()) {
        return false;
      } else if (this.getType() !== other.getType()) {
        return false;
      } else {
        // Note: returning true here, so that sub-classes
        // can call this as a predicate in their expression
        return true;
      }
    };

    /**
      @returns {String} This selection as human readable string.
    */
    this.toString = function() {
      return "null";
    };

    /**
      Convert container selection to JSON.

      @abstract
      @returns {Object}
    */
    this.toJSON = function() {
      throw new Error('This method is abstract.');
    };

    /**
      Get selection fragments for this selection.

      A selection fragment is bound to a single property.
      @returns {Selection.Fragment[]}
    */
    this.getFragments = function() {
      return [];
    };

  };

  oo$q.initClass(Selection$b);

  /**
    Class to represent null selections.

    @private
    @class
  */

  Selection$b.NullSelection = function() {
    Selection$b.call(this);
  };

  Selection$b.NullSelection.Prototype = function() {
    this.isNull = function() {
      return true;
    };

    this.getType = function() {
      return 'null';
    };

    this.toJSON = function() {
      return null;
    };

    this.clone = function() {
      return this;
    };
  };

  Selection$b.extend(Selection$b.NullSelection);

  /**
    We use a singleton to represent NullSelections.

    @type {model/Selection}
  */

  Selection$b.nullSelection = Object.freeze(new Selection$b.NullSelection());

  Selection$b.fromJSON = function(json) {
    if (!json) {
      return Selection$b.nullSelection;
    }
    var type = json.type;
    switch(type) {
      case 'property':
        var PropertySelection = require('./PropertySelection');
        return PropertySelection.fromJSON(json);
      case 'container':
        var ContainerSelection = require('./ContainerSelection');
        return ContainerSelection.fromJSON(json);
      case 'node':
        var NodeSelection = require('./NodeSelection');
        return NodeSelection.fromJSON(json);
      case 'custom':
        var CustomSelection = require('./CustomSelection');
        return CustomSelection.fromJSON(json);
      default:
        // console.error('Selection.fromJSON(): unsupported selection data', json);
        return Selection$b.nullSelection;
    }
  };

  Selection$b.create = function() {
    throw new Error('Selection.create() has been removed as it is not possible to create selections consistently without looking into the document.');
  };

  /**
    A selection fragment. Used when we split a {@link model/ContainerSelection}
    into their fragments, each corresponding to a property selection.

    @private
    @class
  */

  Selection$b.Fragment = function(path, startOffset, endOffset, full) {
    EventEmitter$a.call(this);

    this.type = "selection-fragment";
    this.path = path;
    this.startOffset = startOffset;
    this.endOffset = endOffset || startOffset;
    this.full = Boolean(full);
  };

  Selection$b.Fragment.Prototype = function() {

    this.isAnchor = function() {
      return false;
    };

    this.isInline = function() {
      return false;
    };

    this.isPropertyFragment = function() {
      return true;
    };

    this.isNodeFragment = function() {
      return false;
    };

    this.isFull = function() {
      return this.full;
    };

    this.isPartial = function() {
      return !this.full;
    };

    this.getNodeId = function() {
      return this.path[0];
    };

  };

  EventEmitter$a.extend(Selection$b.Fragment);


  Selection$b.NodeFragment = function(nodeId) {
    EventEmitter$a.call(this);

    this.type = "node-fragment";
    this.nodeId = nodeId;
    this.path = [nodeId];
  };

  Selection$b.NodeFragment.Prototype = function() {

    this.isAnchor = function() {
      return false;
    };

    this.isInline = function() {
      return false;
    };

    this.isPropertyFragment = function() {
      return false;
    };

    this.isNodeFragment = function() {
      return true;
    };

    this.isFull = function() {
      return true;
    };

    this.isPartial = function() {
      return false;
    };

    this.getNodeId = function() {
      return this.nodeId;
    };
  };

  EventEmitter$a.extend(Selection$b.NodeFragment);


  /**
    Describe the cursor when creating selection fragments.
    This is used for rendering selections.

    @private
    @class
    @extends Anchor
  */
  Selection$b.Cursor = function(path, offset) {
    Anchor$2.call(this, path, offset);
    this.type = "cursor";
  };

  Selection$b.Cursor.Prototype = function() {

    this.isPropertyFragment = function() {
      return false;
    };

    this.isNodeFragment = function() {
      return false;
    };

  };

  Anchor$2.extend(Selection$b.Cursor);

  module.exports = Selection$b;

  var oo$r = require('../util/oo');
  var TreeIndex$5 = require('../util/TreeIndex');
  var Selection$c = require('./Selection');
  var documentHelpers$2 = require('./documentHelpers');

  function SelectionState$1(doc) {
    this.document = doc;

    this.selection = Selection$c.nullSelection;
    this._state = {};
    this._resetState();
  }

  SelectionState$1.Prototype = function() {

    this.setSelection = function(sel) {
      if (!sel) {
        sel = Selection$c.nullSelection;
      } else {
        sel.attach(this.document);
      }
      // TODO: selection state is selection plus derived state,
      // thus we need to return false only if both did not change
      this._deriveState(sel);
      this.selection = sel;
      return true;
    };

    this.getSelection = function() {
      return this.selection;
    };

    this.getAnnotationsForType = function(type) {
      var state = this._state;
      if (state.annosByType) {
        return state.annosByType.get(type) || [];
      }
      return [];
    };

    this.isInlineNodeSelection = function() {
      return this._state.isInlineNodeSelection;
    };

    this._deriveState = function(sel) {
      var doc = this.document;

      this._resetState();
      var state = this._state;

      // create a mapping by type for the currently selected annotations
      var annosByType = new TreeIndex$5.Arrays();
      var propAnnos = documentHelpers$2.getPropertyAnnotationsForSelection(doc, sel);
      propAnnos.forEach(function(anno) {
        annosByType.add(anno.type, anno);
      });

      if (propAnnos.length === 1 && propAnnos[0].isInline()) {
        state.isInlineNodeSelection = propAnnos[0].getSelection().equals(sel);
      }

      var containerId = sel.containerId;
      if (containerId) {
        var containerAnnos = documentHelpers$2.getContainerAnnotationsForSelection(doc, sel, containerId);
        containerAnnos.forEach(function(anno) {
          annosByType.add(anno.type, anno);
        });
      }
      state.annosByType = annosByType;
    };

    this._resetState = function() {
      this._state = {
        // all annotations under the current selection
        annosByType: null,
        // flags to make node selection (IsolatedNodes) stuff more convenient
        isNodeSelection: false,
        nodeId: null,
        nodeSelectionMode: '', // full, before, after
        // flags for inline nodes
        isInlineNodeSelection: false
      };
      return this._state;
    };

  };

  oo$r.initClass(SelectionState$1);

  module.exports = SelectionState$1;

  var TextNode = require('./TextNode');

  function TextBlock() {
    TextNode.apply(this, arguments);
  }

  TextNode.extend(TextBlock);

  TextBlock.static.isBlock = true;

  module.exports = TextBlock;

  var DocumentNode$6 = require('./DocumentNode');

  /**
    A base class for all text-ish nodes, such as Paragraphs, Headings,
    Prerendered, etc.

    @class
    @abstract
  */

  function TextNode$1() {
    TextNode$1.super.apply(this, arguments);
  }

  TextNode$1.Prototype = function() {

    this.getTextPath = function() {
      return [this.id, 'content'];
    };

    this.getText = function() {
      return this.content;
    };

    this.isEmpty = function() {
      return !this.content;
    };

  };

  DocumentNode$6.extend(TextNode$1);

  TextNode$1.static.name = "text";
  TextNode$1.static.isText = true;

  TextNode$1.static.defineSchema({
    content: 'text'
  });

  module.exports = TextNode$1;

  var isFunction = require('lodash/isFunction');
  var extend$b = require('lodash/extend');
  var each$c = require('lodash/each');
  var uuid$5 = require('../util/uuid');
  var Document$1 = require('./Document');
  var DocumentChange$5 = require('./DocumentChange');
  var IncrementalData$2 = require('./data/IncrementalData');
  var DocumentNodeFactory$2 = require('./DocumentNodeFactory');

  var __id__$4 = 0;

  /**
    A {@link model/Document} instance that is used during transaction.

    During editing a TransactionDocument is kept up-to-date with the real one.
    Whenever a transaction is started on the document, a TransactionDocument is used to
    record changes, which are applied en-bloc when the transaction is saved.

    @class
    @extends model/AbstractDocument
    @example

    @param {model/Document} document a document instance

    To start a transaction run

    ```
    doc.transaction(function(tx) {
      // use tx to record changes
    });
    ```
  */
  function TransactionDocument$1(document, session) {
    this.__id__ = "TX_"+__id__$4++;

    this.schema = document.schema;
    this.nodeFactory = new DocumentNodeFactory$2(this);
    this.data = new IncrementalData$2(this.schema, {
      nodeFactory: this.nodeFactory
    });

    this.document = document;
    this.session = session;

    // ops recorded since transaction start
    this.ops = [];
    // app information state information used to recover the state before the transaction
    // when calling undo
    this.before = {};
    // HACK: copying all indexes
    each$c(document.data.indexes, function(index, name) {
      this.data.addIndex(name, index.clone());
    }.bind(this));

    this.loadSeed(document.toJSON());
  }

  TransactionDocument$1.Prototype = function() {

    this.reset = function() {
      this.ops = [];
      this.before = {};
    };

    this.create = function(nodeData) {
      if (!nodeData.id) {
        nodeData.id = uuid$5(nodeData.type);
      }
      var op = this.data.create(nodeData);
      if (!op) return;
      this.ops.push(op);
      // TODO: incremental graph returns op not the node,
      // so probably here we should too?
      return this.data.get(nodeData.id);
    };

    this.delete = function(nodeId) {
      var op = this.data.delete(nodeId);
      if (!op) return;
      this.ops.push(op);
      return op;
    };

    this.set = function(path, value) {
      var op = this.data.set(path, value);
      if (!op) return;
      this.ops.push(op);
      return op;
    };

    this.update = function(path, diffOp) {
      var op = this.data.update(path, diffOp);
      if (!op) return;
      this.ops.push(op);
      return op;
    };

    /**
      Cancels the current transaction, discarding all changes recorded so far.
    */
    this.cancel = function() {
      this._cancelTransaction();
    };

    this.getOperations = function() {
      return this.ops;
    };

    this._apply = function(documentChange) {
      documentChange.ops.forEach(function(op) {
        this.data.apply(op);
      }.bind(this));
    };

    this._transaction = function(transformation) {
      if (!isFunction(transformation)) {
        throw new Error('Document.transaction() requires a transformation function.');
      }
      // var time = Date.now();
      // HACK: ATM we can't deep clone as we do not have a deserialization
      // for selections.
      this._startTransaction();
      // console.log('Starting the transaction took', Date.now() - time);
      try {
        // time = Date.now();
        transformation(this, {});
        // console.log('Executing the transformation took', Date.now() - time);
        // save automatically if not canceled
        if (!this._isCancelled) {
          return this._saveTransaction();
        }
      } finally {
        if (!this._isSaved) {
          this.cancel();
        }
        // HACK: making sure that the state is reset when an exception has occurred
        this.session.isTransacting = false;
      }
    };

    this._startTransaction = function() {
      this.before = {};
      this.after = {};
      this.info = {};
      this._isCancelled = false;
      this._isSaved = false;
      // TODO: we should use a callback and not an event
      // Note: this is used to initialize
      this.document.emit('transaction:started', this);
    };

    this._saveTransaction = function() {
      if (this._isCancelled) {
        return;
      }
      var beforeState = this.before;
      var afterState = extend$b({}, beforeState, this.after);
      var ops = this.ops;
      var change;
      if (ops.length > 0) {
        change = new DocumentChange$5(ops, beforeState, afterState);
      }
      this._isSaved = true;
      this.reset();
      return change;
    };

    this._cancelTransaction = function() {
      // revert all recorded changes
      for (var i = this.ops.length - 1; i >= 0; i--) {
        this.data.apply(this.ops[i].invert());
      }
      // update state
      this._isCancelled = true;
      this.reset();
    };

    this.newInstance = function() {
      return this.document.newInstance();
    };

    this.isTransactionDocument = true;

  };

  Document$1.extend(TransactionDocument$1);

  module.exports = TransactionDocument$1;

  var uuid$6 = require('../../util/uuid');
  var deleteSelection = require('./deleteSelection');
  var annotationHelpers = require('../annotationHelpers');

  /**
    A transformation that breaks a node at the current position,
    e.g. used when you hit ENTER inside a paragraph.

    @function

    @param {model/TransactionDocument} tx the document instance
    @param {Object} args object with fields `selection`, `containerId`
  */
  function breakNode(tx, args) {
    if (!args.selection) {
      throw new Error("Argument 'selection' is mandatory.");
    }
    if (!args.containerId) {
      throw new Error("Argument 'containerId' is mandatory.");
    }
    if (!args.selection.isCollapsed()) {
      args = deleteSelection(tx, args);
    }
    var sel = args.selection;

    // default breaking behavior for node selections
    if (sel.isNodeSelection()) {
      if (!sel.isFull()) {
        return breakWholeNode(tx, args);
      } else {
        return args;
      }
    }

    var node = tx.get(sel.start.path[0]);
    var behavior = args.editingBehavior;

    if (behavior && behavior.canBreak(node.type)) {
      var breaker = behavior.getBreaker(node.type);
      return breaker.call(breaker, tx, args);
    } else if (node.isText()) {
      return breakTextNode(tx, args);
    } else {
      console.info("Breaking is not supported for node type %s.", node.type);
      return args;
    }
  }

  function breakTextNode(tx, args) {
    var sel = args.selection;
    var containerId = args.containerId;
    if (!sel.isPropertySelection()) {
      throw new Error('Expected property selection.');
    }
    var path = sel.path;
    var offset = sel.startOffset;
    var node = tx.get(path[0]);

    // split the text property and create a new paragraph node with trailing text and annotations transferred
    var text = node.getText();
    var container = tx.get(containerId);
    var nodePos = container.getPosition(node.id);
    var id = uuid$6(node.type);
    var newPath = [id, 'content'];
    var newNode;
    // when breaking at the first position, a new node of the same
    // type will be inserted.
    if (offset === 0) {
      newNode = tx.create({
        id: id,
        type: node.type,
        content: ""
      });
      // show the new node
      container.show(id, nodePos);
      sel = tx.createSelection(path, 0);
    }
    // otherwise break the node
    else {
      newNode = node.toJSON();
      newNode.id = id;
      newNode.content = text.substring(offset);
      // if at the end
      if (offset === text.length) {
        newNode.type = tx.getSchema().getDefaultTextType();
      }
      tx.create(newNode);
      // create a new node
      if (offset < text.length) {
        // transfer annotations which are after offset to the new node
        annotationHelpers.transferAnnotations(tx, path, offset, [id, 'content'], 0);
        // truncate the original property
        tx.update(path, {
          delete: { start: offset, end: text.length }
        });
      }
      // show the new node
      container.show(id, nodePos+1);
      // update the selection
      sel = tx.createSelection(newPath, 0);
    }
    args.selection = sel;
    args.node = newNode;
    return args;
  }

  function breakWholeNode(tx, args) {
    var sel = args.selection;
    var containerId = args.containerId;
    if (!sel) {
      throw new Error('Illegal argument: selection is mandatory.');
    }
    if (!containerId) {
      throw new Error('Illegal argument: containerId is mandatory.');
    }
    if (!sel.isNodeSelection()) {
      throw new Error('Illegal argument: selection should be a NodeSelection');
    }
    var container = tx.get(containerId);
    var nodeId = sel.getNodeId();
    var nodePos = container.getPosition(nodeId);
    var type = tx.getSchema().getDefaultTextType();
    var newNode = tx.create({
      type: type,
      content: ""
    });
    var newSel;
    if (sel.isBefore()) {
      container.show(newNode.id, nodePos);
      // in this case the selection does not change
      newSel = sel;
    } else {
      container.show(newNode.id, nodePos+1);
      newSel = tx.createSelection([newNode.id, 'content'], 0);
    }
    args.selection = newSel;
    args.node = newNode;
    return args;
  }

  module.exports = breakNode;

  var cloneDeep$8 = require('lodash/cloneDeep');
  var each$d = require('lodash/each');
  var last$2 = require('lodash/last');
  var annotationHelpers$1 = require('../annotationHelpers');

  var CLIPBOARD_CONTAINER_ID = "clipboard_content";
  var CLIPBOARD_PROPERTY_ID = "clipboard_property";

  /**
    Creates a new document instance containing only the selected content

    @param {Object} args object with `selection`
    @return {Object} with a `doc` property that has a fresh doc with the copied content
  */

  function copySelection(doc, args) {
    var selection = args.selection;
    if (!selection || !selection._isSelection) {
      throw new Error("'selection' is mandatory.");
    }
    if (selection.isNull() || selection.isCollapsed()) {
      args.doc = null;
    }

    // return a simplified version if only a piece of text is selected
    else if (selection.isPropertySelection()) {
      args.doc = _copyPropertySelection(doc, selection);
    }
    else if (selection.isContainerSelection()) {
      args.doc = _copyContainerSelection(doc, selection);
    }
    else if (selection.isNodeSelection()) {
      args.doc = _copyNodeSelection(doc, selection);
    }
    else {
      console.error('Copy is not yet supported for selection type.');
      args.doc = null;
    }
    return args;
  }

  function _copyPropertySelection(doc, selection) {
    var copy = doc.newInstance();
    var path = selection.start.path;
    var offset = selection.start.offset;
    var endOffset = selection.end.offset;
    var text = doc.get(path);
    var containerNode = copy.get(CLIPBOARD_CONTAINER_ID);
    if (!containerNode) {
      containerNode = copy.create({
        type: 'container',
        id: CLIPBOARD_CONTAINER_ID,
        nodes: []
      });
    }
    copy.create({
      type: doc.schema.getDefaultTextType(),
      id: CLIPBOARD_PROPERTY_ID,
      content: text.substring(offset, endOffset)
    });
    containerNode.show(CLIPBOARD_PROPERTY_ID);
    var annotations = doc.getIndex('annotations').get(path, offset, endOffset);
    each$d(annotations, function(anno) {
      var data = cloneDeep$8(anno.toJSON());
      data.path = [CLIPBOARD_PROPERTY_ID, 'content'];
      data.startOffset = Math.max(offset, anno.startOffset)-offset;
      data.endOffset = Math.min(endOffset, anno.endOffset)-offset;
      copy.create(data);
    });
    return copy;
  }

  // TODO: copying nested nodes is not straight-forward,
  // as it is not clear if the node is valid to be created just partially
  // Basically this needs to be implemented for each nested node.
  // The default implementation ignores partially selected nested nodes.
  function _copyContainerSelection(doc, selection) {
    var copy = doc.newInstance();
    var container = doc.get(selection.containerId);
    // create a new container
    var containerNode = copy.create({
      type: 'container',
      id: CLIPBOARD_CONTAINER_ID,
      nodes: []
    });

    var fragments = selection.getFragments();

    if (fragments.length === 0) {
      return copy;
    }

    var created = {};

    // copy nodes and annotations.
    for (var i = 0; i < fragments.length; i++) {
      var fragment = fragments[i];
      var nodeId = fragment.getNodeId();
      var node = doc.get(nodeId);
      // skip created nodes
      if (!created[nodeId]) {
        _copyNode(copy, node, container, created);
        containerNode.show(nodeId);
      }
    }

    var firstFragment = fragments[0];
    var lastFragment = last$2(fragments);
    var path, offset, text;

    // if first is a text node, remove part before the selection
    if (firstFragment.isPropertyFragment()) {
      path = firstFragment.path;
      offset = firstFragment.startOffset;
      text = doc.get(path);
      copy.update(path, {
        delete: { start: 0, end: offset }
      });
      annotationHelpers$1.deletedText(copy, path, 0, offset);
    }

    // if last is a is a text node, remove part before the selection
    if (lastFragment.isPropertyFragment()) {
      path = lastFragment.path;
      offset = lastFragment.endOffset;
      text = doc.get(path);
      copy.update(path, {
        delete: { start: offset, end: text.length }
      });
      annotationHelpers$1.deletedText(copy, path, offset, text.length);
    }

    return copy;
  }

  function _copyNodeSelection(doc, selection) {
    var copy = doc.newInstance();
    var container = doc.get(selection.containerId);
    // create a new container
    var containerNode = copy.create({
      type: 'container',
      id: CLIPBOARD_CONTAINER_ID,
      nodes: []
    });
    var nodeId = selection.getNodeId();
    var node = doc.get(nodeId);
    _copyNode(copy, node, container, {});
    containerNode.show(node.id);
    return copy;
  }

  function _copyNode(doc, node, container, created) {
    // nested nodes should provide a custom implementation
    if (node.hasChildren()) {
      // TODO: call a customized implementation for nested nodes
      // and continue, to skip the default implementation
      var children = node.getChildren();
      children.forEach(function(child) {
        _copyNode(doc, child, container, created);
      });
    }
    created[node.id] = doc.create(node.toJSON());

    var annotationIndex = doc.getIndex('annotations');
    var annotations = annotationIndex.get([node.id]);
    each$d(annotations, function(anno) {
      doc.create(cloneDeep$8(anno.toJSON()));
    });
  }

  copySelection.CLIPBOARD_CONTAINER_ID = CLIPBOARD_CONTAINER_ID;
  copySelection.CLIPBOARD_PROPERTY_ID = CLIPBOARD_PROPERTY_ID;

  module.exports = copySelection;

  var extend$c = require('lodash/extend');
  var uuid$7 = require('../../util/uuid');
  var helpers = require('../documentHelpers');

  /**
    For a given container selection create property selections of a given type

    @param {model/TransactionDocument} tx the document instance
    @param {model/Selection} args.selection A document selection
    @param {String} args.containerId a valid container id
    @param {Object} args.node data describing the annotation node

    @example

    ```js
    createAnnotation(tx, {
      selection: bodyEditor.getSelection(),
      containerId: bodyEditor.getContainerId(),

      node: {
        type: 'link',
        url: 'http://example.com'
      }
    });
    ```
  */

  function createAnnotation(tx, args) {
    var sel = args.selection;
    if (!sel) throw new Error('selection is required.');
    var annoType = args.annotationType;
    var annoData = args.annotationData;
    var anno = args.node;
    if (!anno && annoType) {
      console.warn('DEPRECATED: Use node: {type: "strong"} instead of annotationType: "strong"');
      anno = { type: annoType };
      extend$c(anno, annoData);
    }
    if (!anno) throw new Error('node is required');

    if (!sel.isPropertySelection() && !sel.isContainerSelection() || sel.isCollapsed()) {
      // the selection must be expanded and of type Property- or ContainerSelection
      throw new Error("Invalid selection for createAnnotation");
    }
    // Special case: We split the current container selection into
    // multiple property annotations
    if (sel.isContainerSelection() && args.splitContainerSelections) {
      return _createPropertyAnnotations(tx, args);
    }
    if (helpers.isContainerAnnotation(tx, anno.type)) {
      anno.startPath = sel.startPath;
      anno.endPath = sel.endPath;
      anno.containerId = sel.containerId;
    } else if (sel.isPropertySelection()) {
      anno.path = sel.path;
    } else {
      throw new Error('Illegal state: can not apply ContainerSelection');
    }
    anno.startOffset = sel.startOffset;
    anno.endOffset = sel.endOffset;
    args.result = tx.create(anno);
    return args;
  }

  function _createPropertyAnnotations(tx, args) {
    var sel = args.selection;
    var node = args.node;
    var sels;
    if (sel.isPropertySelection()) {
      sels = []; // we just do nothing in the property selection case? why?
    } else if (sel.isContainerSelection()) {
      sels = sel.splitIntoPropertySelections();
    }

    for (var i = 0; i < sels.length; i++) {
      var anno = {
        id: uuid$7(node.type)
      };
      extend$c(anno, node);
      anno.path = sels[i].getPath();
      anno.startOffset = sels[i].startOffset;
      anno.endOffset = sels[i].endOffset;
      tx.create(anno);
    }
  }

  module.exports = createAnnotation;

  var extend$d = require('lodash/extend');
  var merge = require('./merge');
  var updateAnnotations = require('./updateAnnotations');
  var deleteNode = require('./deleteNode');

  /*
    The behavior when you press delete or backspace.
    I.e., it starts with a collapsed PropertySelection and deletes the character before
    or after the caret.
    If the caret is at the begin or end it will call `mergeNodes`.
  */
  var deleteCharacter = function(tx, args) {
    var sel = args.selection;
    if (!sel) {
      throw new Error("'selection' is mandatory.");
    }
    if (!sel.isCollapsed()) {
      throw new Error('selection must be collapsed for transformation "deleteCharacter"');
    }
    if (sel.isPropertySelection()) {
      return _deleteCharacterInProperty(tx, args);
    } else if (sel.isNodeSelection()) {
      return _deleteCharacterWithNodeSelection(tx, args);
    }
    console.warn("'deleteChar' can not be used with the given selection", sel.toString());
    return args;
  };

  function _deleteCharacterInProperty(tx, args) {
    var sel = args.selection;
    if (!sel.isPropertySelection()) {
      throw new Error('Expecting a property selection.');
    }
    var direction = args.direction;
    var containerId = args.containerId;
    var startChar, endChar;
    var path = sel.path;
    var text = tx.get(path);
    if ((sel.startOffset === 0 && direction === 'left') ||
        (sel.startOffset === text.length && direction === 'right')) {
      // only try to merge if a containerId is given
      if (containerId) {
        var tmp = merge(tx, extend$d({}, args, {
          selection: sel,
          containerId: containerId,
          path: sel.path,
          direction: direction
        }));
        args.selection = tmp.selection;
      }
    } else {
      // simple delete one character
      startChar = (direction === 'left') ? sel.startOffset-1 : sel.startOffset;
      endChar = startChar+1;
      var op = tx.update(sel.path, { delete: { start: startChar, end: endChar } });
      updateAnnotations(tx, { op: op });
      args.selection = tx.createSelection(sel.path, startChar);
    }
    return args;
  }

  function _deleteCharacterWithNodeSelection(tx, args) {
    var sel = args.selection;
    if (!sel.isNodeSelection()) {
      throw new Error('Expecting a node selection.');
    }
    var direction = args.direction;
    var containerId = args.containerId;
    var nodeId = sel.getNodeId();
    var container = tx.get(containerId);
    var pos, text;
    if (sel.isFull() || ( sel.isBefore() && direction === 'right') || (sel.isAfter() && direction === 'left')) {
      return deleteNode(tx, {
        nodeId: nodeId,
        containerId: containerId
      });
    } else if (sel.isBefore() && direction === 'left') {
      pos = container.getPosition(nodeId);
      if (pos > 0) {
        var previous = container.getNodeAt(pos-1);
        if (previous.isText()) {
          text = previous.getText();
          if (text.length === 0) {
            // don't return the selection returned by deleteNode
            deleteNode(tx, {
              nodeId: previous.id,
              containerId: containerId
            });
          } else {
            // just update the selection
            sel = tx.createSelection(previous.getTextPath(), text.length);
          }
        }
      }
    } else if (sel.isAfter() && direction === 'right') {
      pos = container.getPosition(nodeId);
      if (pos < container.getLength()-1) {
        var next = container.getNodeAt(pos+1);
        if (next.isText() && next.isEmpty()) {
          // don't return the selection returned by deleteNode
          deleteNode(tx, {
            nodeId: next.id,
            containerId: containerId
          });
        }
      }
    }
    return {
      selection: sel
    };
  }

  module.exports = deleteCharacter;

  // var each = require('lodash/each');

  /*
   * Delete a node and all annotations attached to it,
   * and removes the node from all containers.
   *
   * @param args object with fields: `nodeId`.
   */
  function deleteNode$1(tx, args) {
    var nodeId = args.nodeId;
    if (!nodeId) {
      throw new Error('Parameter `nodeId` is mandatory.');
    }
    var node = tx.get(nodeId);
    if (!node) {
      throw new Error("Invalid 'nodeId'. Node does not exist.");
    }
    // optional: containerId - will hide the node before removing it
    var containerId = args.containerId;
    var container;

    // remove all associated annotations
    var annos = tx.getIndex('annotations').get(nodeId);
    var i;
    for (i = 0; i < annos.length; i++) {
      tx.delete(annos[i].id);
    }
    // transfer anchors of ContainerAnnotations to previous or next node:
    //  - start anchors go to the next node
    //  - end anchors go to the previous node
    var anchors = tx.getIndex('container-annotation-anchors').get(nodeId);
    for (i = 0; i < anchors.length; i++) {
      var anchor = anchors[i];
      container = tx.get(anchor.containerId);
      // Note: during the course of this loop we might have deleted the node already
      // so, don't do it again
      if (!tx.get(anchor.id)) continue;
      var pos = container.getPosition(anchor.path[0]);
      var path, offset;
      if (anchor.isStart) {
        if (pos < container.getLength()-1) {
          var nextNode = container.getChildAt(pos+1);
          if (nextNode.isText()) {
            path = [nextNode.id, 'content'];
          } else {
            path = [nextNode.id];
          }
          tx.set([anchor.id, 'startPath'], path);
          tx.set([anchor.id, 'startOffset'], 0);
        } else {
          tx.delete(anchor.id);
        }
      } else {
        if (pos > 0) {
          var previousNode = container.getChildAt(pos-1);
          if (previousNode.isText()) {
            path = [previousNode.id, 'content'];
            offset = tx.get(path).length;
          } else {
            path = [previousNode.id];
            offset = 1;
          }
          tx.set([anchor.id, 'endPath'], path);
          tx.set([anchor.id, 'endOffset'], offset);
        } else {
          tx.delete(anchor.id);
        }
      }
    }
    if (containerId) {
      // hide the node from the one container if provided
      container = tx.get(containerId);
      container.hide(nodeId);
    }
    // hiding automatically is causing troubles with nested containers
    //  else {
    //   // or hide it from all containers
    //   each(tx.getIndex('type').get('container'), function(container) {
    //     container.hide(nodeId);
    //   });
    // }

    // delete nested nodes
    if (node.hasChildren()) {
      node.getChildren().forEach(function(child) {
        deleteNode$1(tx, { nodeId: child.id });
      });
    }
    // finally delete the node itself
    tx.delete(nodeId);
    return args;
  }

  module.exports = deleteNode$1;

  var extend$e = require('lodash/extend');
  var last$3 = require('lodash/last');
  var uuid$8 = require('../../util/uuid');
  var deleteNode$2 = require('./deleteNode');
  var merge$1 = require('./merge');
  var updateAnnotations$1 = require('./updateAnnotations');

  /**
    Deletes a given selection.

    @param {Object} args object with `selection`
    @return {Object} with updated `selection`

    @example

    ```js
    deleteSelection(tx, {
      selection: bodyEditor.getSelection(),
    });
    ```
  */

  function deleteSelection$1(tx, args) {
    var selection = args.selection;
    if (selection.isCollapsed()) ; else if (selection.isPropertySelection()) {
      args = _deletePropertySelection(tx, args);
    } else if (selection.isContainerSelection()) {
      args = _deleteContainerSelection(tx, args);
    } else if (selection.isNodeSelection()) {
      args = _deleteNodeSelection(tx, args);
    }
    return args;
  }

  function _deletePropertySelection(tx, args) {
    var sel = args.selection;
    var path = sel.path;
    var startOffset = sel.startOffset;
    var endOffset = sel.endOffset;
    var op = tx.update(path, { delete: { start: startOffset, end: endOffset } });
    updateAnnotations$1(tx, {op: op});
    args.selection = tx.createSelection(path, startOffset);
    return args;
  }

  function _deleteContainerSelection(tx, args) {
    var sel = args.selection;
    var containerId = sel.containerId;
    var container = tx.get(containerId);

    var startPos = container.getPosition(sel.start.path[0]);
    // var endPos = container.getPosition(sel.end.path[0]);
    var fragments = sel.getFragments();
    if (fragments.length === 0) {
      return args;
    }

    var remainingCoor = null;
    var node, type;

    for (var i = 0; i < fragments.length; i++) {
      var fragment = fragments[i];

      if (fragment.isPropertyFragment()) {
        if (fragment.isPartial()) {
          if (!remainingCoor) {
            remainingCoor = {
              path: fragment.path,
              offset: fragment.startOffset
            };
          }
          _deletePropertySelection(tx, {
            selection: fragment
          });
        } else {
          var nodeId = fragment.path[0];
          deleteNode$2(tx, extend$e({}, args, {
            nodeId: nodeId,
            containerId: container.id
          }));
        }
      } else if (fragment.isNodeFragment()) {
        deleteNode$2(tx, extend$e({}, args, {
          nodeId: fragment.nodeId,
          containerId: container.id
        }));
      }
    }

    // update the selection; take the first component which is not fully deleted
    if (remainingCoor) {
      args.selection = tx.createSelection(remainingCoor.path, remainingCoor.offset);
    } else {
      // if all nodes have been deleted insert a text node
      // TODO: in some cases this is not the desired behavior.
      // it is ok in cases such as:
      //  - when inserting text
      //  - pressing delete or backspace
      // this should not be done when
      //  - pasting a container (as opposed to property)
      //  - inserting a node
      // i.e. only before property operations
      type = tx.getSchema().getDefaultTextType();
      node = {
        type: type,
        id: uuid$8(type),
        content: ""
      };
      tx.create(node);
      container.show(node.id, startPos);
      args.selection = tx.createSelection([node.id, 'content'], 0);
    }

    // try to merge the first and last remaining nodes
    // NOTE: ATM only merges text nodes
    if (fragments.length > 1 &&
        fragments[0].isPartial() &&
        last$3(fragments).isPartial()) {
      merge$1(tx, extend$e({}, args, {
        selection: args.selection,
        containerId: containerId,
        path: sel.endPath,
        direction: 'left'
      }));
    }

    // If the container is empty insert an empty text node
    if (container.nodes.length === 0) {
      type = tx.getSchema().getDefaultTextType();
      node = {
        type: type,
        id: uuid$8(type),
        content: ""
      };
      tx.create(node);
      container.show(node.id, 0);
      args.selection = tx.createSelection([node.id, 'content'], 0);
    }

    return args;
  }

  function _deleteNodeSelection(tx, args) {
    var sel = args.selection;
    if (!sel || !sel.isNodeSelection()) {
      throw new Error("'sel' must be a NodeSelection");
    }
    if (!sel.isFull()) {
      return args;
    }
    var nodeId = sel.getNodeId();
    var containerId = sel.containerId;
    var container = tx.get(containerId);
    var pos = container.getPosition(nodeId);
    deleteNode$2(tx, {
      nodeId: nodeId,
      containerId: containerId
    });
    var newNode = tx.create({
      type: tx.getSchema().getDefaultTextType(),
      content: ""
    });
    container.show(newNode.id, pos);
    return {
      selection: tx.createSelection([newNode.id, 'content'], 0)
    };
  }

  module.exports = deleteSelection$1;

  /*
   @param {model/Document} tx
   @param {model/Annotation} args.anno annotation which should be expanded
   @param {model/Selection}  args.selection selection to which to expand
  */
  function expandAnnotation(tx, args) {
    var sel = args.selection;
    var anno = args.anno;
    if (!sel || !sel._isSelection) throw new Error('Argument "selection" is required.');
    if (!anno || !anno._isAnnotation) throw new Error('Argument "anno" is required.');

    var annoSel = anno.getSelection();
    var newAnnoSel = annoSel.expand(sel);
    anno.updateRange(tx, newAnnoSel);
    args.result = anno;
    return args;
  }

  module.exports = expandAnnotation;

  var each$e = require('lodash/each');
  var isArray$b = require('lodash/isArray');
  var createAnnotation$1 = require('./createAnnotation');

  /*
   @param {model/Document} tx
   @param {model/Annotation[]} args.annos annotations which should be fused
  */
  function fuseAnnotation(tx, args) {
    var annos = args.annos;
    if (!isArray$b(annos) || annos.length < 2) {
      throw new Error('fuseAnnotation(): at least two annotations are necessary.');
    }
    var sel, annoType;
    annos.forEach(function(anno, idx) {
      if (idx === 0) {
        sel = anno.getSelection();
        annoType = anno.type;
      } else {
        if (anno.type !== annoType) {
          throw new Error('fuseAnnotation(): all annotations must be of the same type.');
        }
        sel = sel.expand(anno.getSelection());
      }
    });
    each$e(annos, function(anno) {
      tx.delete(anno.id);
    });
    // The expanded selection
    args.selection = sel;
    args.node = {type: annoType};

    // Sets args.result to new annotation
    return createAnnotation$1(tx, args);
  }

  module.exports = fuseAnnotation;

  var insertText = require('./insertText');
  var createAnnotation$2 = require('./createAnnotation');

  /**
    Inserts a new inline node at the given selection/cursor.

    @param {Object} args object with `selection`, `containerId` and `node` that has the node data

    @return {Object} object with updated selection

    @example

    ```js
    insertInlineNode(tx, {
      selection: bodyEditor.getSelection(),
      containerId: bodyEditor.getContainerId(),
      node: {
        type: 'citation'
      }
    });
    ```
  */

  function insertInlineNode(tx, args) {
    // 1. Insert fake character the inline node will stick
    var tmp = insertText(tx, {
      selection: args.selection,
      text: "\uFEFF"
    });

    var inlineNodeSel = tx.createSelection({
      type: 'property',
      path: tmp.selection.path,
      startOffset: tmp.selection.startOffset-1,
      endOffset: tmp.selection.endOffset
    });

    // 2. Create citation annotation
    args.node = args.node;
    args.selection = inlineNodeSel;
    args = createAnnotation$2(tx, args);
    return args;
  }

  module.exports = insertInlineNode;

  var deleteSelection$2 = require('./deleteSelection');
  var breakNode$1 = require('./breakNode');
  var uuid$9 = require('../../util/uuid');

  /**
    Inserts a new node at the given selection/cursor.

    @param {Object} args object with `selection`, `containerId` and `node` that has the node data

    @return {Object} object with updated selection

    @example

    ```js
    insertNode(tx, {
      selection: bodyEditor.getSelection(),
      containerId: bodyEditor.getContainerId(),
      node: {
        id: 'nodeId',
        type: 'paragraph',
        content: 'hello'
      }
    });
    ```
  */

  function insertNode(tx, args) {
    var selection = args.selection;
    var node = args.node;
    if (!args.containerId) {
      throw new Error("containerId is mandatory");
    }
    if (!args.selection) {
      throw new Error("selection is mandatory");
    }
    if (!args.node) {
      throw new Error("node is mandatory");
    }
    var containerId = args.containerId;
    var container = tx.get(containerId);
    var tmp;
    if (!selection.isCollapsed()) {
      tmp = deleteSelection$2(tx, args);
      selection = tmp.selection;
    }
    tmp = breakNode$1(tx, args);
    selection = tmp.selection;
    // create the node if it does not exist yet
    // notice, that it is also allowed to insert an existing node
    if (!node.id) {
      node.id = uuid$9(node.type);
    }
    if (!tx.get(node.id)) {
      node = tx.create(node);
    }
    // make sure we have the real node, not just its data
    node = tx.get(node.id);
    // insert the new node after the node where the cursor was
    var nodePos = container.getPosition(selection.start.getNodeId());
    container.show(node.id, nodePos);

    // if the new node is a text node we can set the cursor to the
    // first character position
    if (node.isText()) {
      args.selection = tx.createSelection({
        type: 'property',
        path: [node.id, 'content'],
        startOffset: 0
      });
    }
    // otherwise we select the whole new node
    else {
      args.selection = tx.createSelection({
        type: 'container',
        containerId: containerId,
        startPath: [node.id],
        startOffset: 0,
        endPath: [node.id],
        endOffset: 1
      });
    }

    return args;
  }

  module.exports = insertNode;

  var replaceText = require('./replaceText');
  var updateAnnotations$2 = require('./updateAnnotations');

  /**
    Inserts text at the given selection.

    @param {Object} args object with `selection`, `text`
    @return {Object} object with updated `selection`

    @example


    ```js
    insertText(tx, {
      selection: bodyEditor.getSelection(),
      text: 'Guten Tag'
    });
    ```
  */

  var insertText$1 = function(tx, args) {
    var sel = args.selection;
    var text = args.text;
    if (!sel) {
      throw new Error('Argument `selection` is mandatory for transformation `insertText`.');
    }
    if (!text) {
      throw new Error('Argument `text` is mandatory for transformation `insertText`.');
    }
    if (!(sel.isPropertySelection() || sel.isContainerSelection())) {
      console.error("Selection must be a Property- or ContainerSelection.");
      return args;
    }
    // Extra transformation for replacing text, as there are edge cases
    if (!sel.isCollapsed()) {
      return replaceText(tx, args);
    }
    // HACK(?): if the string property is not initialized yet we do it here
    // for convenience.
    if (tx.get(sel.startPath) === undefined) {
      tx.set(sel.startPath, "");
    }
    var op = tx.update(sel.startPath, { insert: { offset: sel.startOffset, value: text } } );
    updateAnnotations$2(tx, {op: op});
    args.selection = tx.createSelection(sel.startPath, sel.startOffset + text.length);
    return args;
  };

  module.exports = insertText$1;

  var extend$f = require('lodash/extend');
  var annotationHelpers$2 = require('../annotationHelpers');
  var deleteNode$3 = require('./deleteNode');

  var merge$2 = function(tx, args) {
    var containerId = args.containerId;
    var path = args.path;
    var direction = args.direction;
    if (!containerId || !path || !direction) {
      throw new Error('Insufficient arguments! mandatory fields: `containerId`, `path`, `direction`');
    }
    var container = tx.get(containerId);
    var nodeId = path[0];
    var node = tx.get(nodeId);
    var nodePos = container.getPosition(nodeId);
    var l = container.getLength();
    var tmp;
    if (direction === 'right' && nodePos < l-1) {
      var nextNodeId = container.nodes[nodePos+1];
      var nextNode = tx.get(nextNodeId);
      if (node.isText() && node.getText().length === 0) {
        deleteNode$3(tx, {
          nodeId: nodeId,
          containerId: containerId
        });
        if (nextNode.isText()) {
          args.selection = tx.createSelection(nextNodeId, 0);
        } else {
          args.selection = tx.createSelection({
            type: 'node',
            nodeId: nextNodeId,
            containerId: containerId,
            mode: 'full'
          });
        }
      } else {
        tmp = _mergeNodes(tx, extend$f({}, args, {
          containerId: containerId,
          firstNodeId: nodeId,
          secondNodeId: nextNodeId
        }));
        args.selection = tmp.selection;
      }
    } else if (direction === 'left' && nodePos > 0) {
      var previousNodeId = container.nodes[nodePos-1];
      var previousNode = tx.get(previousNodeId);
      if (node.isText() && node.getText().length === 0) {
        deleteNode$3(tx, {
          nodeId: nodeId,
          containerId: containerId
        });
        if (previousNode.isText()) {
          args.selection = tx.createSelection(previousNode.getTextPath(), previousNode.getText().length);
        } else {
          args.selection = tx.createSelection({
            type: 'node',
            nodeId: previousNodeId,
            containerId: containerId,
            mode: 'full'
          });
        }
      } else {
        tmp = _mergeNodes(tx, extend$f({}, args, {
          containerId: containerId,
          firstNodeId: previousNodeId,
          secondNodeId: nodeId
        }));
        args.selection = tmp.selection;
      }
    }
    return args;
  };

  function _mergeNodes(tx, args) {
    var firstNodeId = args.firstNodeId;
    var secondNodeId = args.secondNodeId;
    var firstNode = tx.get(firstNodeId);
    var secondNode = tx.get(secondNodeId);
    // most often a merge happens between two different nodes (e.g., 2 paragraphs)
    var mergeTrafo = _getNodeMerger(args.editingBehavior, firstNode, secondNode);
    if (mergeTrafo) {
      return mergeTrafo(tx, extend$f({}, args, {
        containerId: args.containerId,
        first: firstNode,
        second: secondNode
      }));
    }
    return args;
  }

  function _getNodeMerger(behavior, node, otherNode) {
    if (behavior) {
      if (behavior.canMerge(node.type, otherNode.type)) {
        return behavior.getMerger(node.type, otherNode.type);
      }
      // Behaviors with text nodes involved
      //
      // 1. first textish, second custom
      // Example:
      //  <p>abc<p>
      //  <ul>
      //    <li>def</li>
      //    <li>ghi</li>
      //  </ul>
      //
      // could be transformed into
      //
      //  <p>abcdef<p>
      //  <ul>
      //    <li>ghi</li>
      //  </ul>
      else if (node.isInstanceOf('text') &&
        behavior.canMerge('textish', otherNode.type)) {
        return behavior.getMerger('textish', otherNode.type);
      }
      // 2. first custom, second textish
      // Example:
      //  <figure>
      //     ...
      //     <figcaption>abc</figcaption>
      //  </figure>
      //  <p>def</p>
      //
      //  could be transformed into
      //
      //  <figure>
      //     ...
      //     <figcaption>abcdef</figcaption>
      //  </figure>
      //
      else if (otherNode.isInstanceOf('text') &&
        behavior.canMerge(node.type, 'textish')) {
        return behavior.getMerger(node.type, 'textish');
      }
    }
    // Built-in behavior for textish nodes
    if (node.isInstanceOf('text') && otherNode.isInstanceOf('text')) {
      return _mergeTextNodes;
    }
    console.info("No merge behavior defined for %s <- %s", node.type, otherNode.type);
    return null;
  }

  function _mergeTextNodes(tx, args) {
    var containerId = args.containerId;
    var first = args.first;
    var second = args.second;
    var container = tx.get(containerId);
    var firstPath = first.getTextPath();
    var firstText = first.getText();
    var firstLength = firstText.length;
    var secondPath = second.getTextPath();
    var secondText = second.getText();
    var selection;
    if (firstLength === 0) {
      // hide the second node
      container.hide(firstPath[0]);
      // delete the second node
      tx.delete(firstPath[0]);
      // set the selection to the end of the first component
      selection = tx.createSelection({
        type: 'property',
        path: secondPath,
        startOffset: 0
      });
    } else {
      // append the second text
      tx.update(firstPath, { insert: { offset: firstLength, value: secondText } });
      // transfer annotations
      annotationHelpers$2.transferAnnotations(tx, secondPath, 0, firstPath, firstLength);
      // hide the second node
      container.hide(secondPath[0]);
      // delete the second node
      tx.delete(secondPath[0]);
      // set the selection to the end of the first component
      selection = tx.createSelection({
        type: 'property',
        path: firstPath,
        startOffset: firstLength
      });
    }
    args.selection = selection;
    return args;
  }

  module.exports = merge$2;

  var last$4 = require('lodash/last');
  var each$f = require('lodash/each');
  var uuid$a = require('../../util/uuid');
  var annotationHelpers$3 = require('../annotationHelpers');
  var deleteSelection$3 = require('./deleteSelection');
  var insertText$2 = require('./insertText');
  var breakNode$2 = require('./breakNode');

  var CLIPBOARD_CONTAINER_ID$1 = require('./copySelection').CLIPBOARD_CONTAINER_ID;
  var CLIPBOARD_PROPERTY_ID$1 = require('./copySelection').CLIPBOARD_PROPERTY_ID;

  /**
    Pastes clipboard content at the current selection

    @param {Object} args object with `selection` and `doc` for Substance content or
    `text` for external HTML content
    @return {Object} with updated `selection`
  */

  var paste = function(tx, args) {
    args.text = args.text || '';
    if (args.selection.isNull()) {
      console.error("Can not paste, without selection.");
      return args;
    }
    // TODO: is there a better way to detect that this paste is happening within a
    // container?
    var inContainer = Boolean(args.containerId);
    var pasteDoc = args.doc;

    // when we are in a container, we interpret line-breaks
    // and create a document with multiple paragraphs
    // in a PropertyEditor we paste the text as is
    if (!pasteDoc) {
      if (inContainer) {
        args.doc = pasteDoc = _convertPlainTextToDocument(tx, args);
      } else {
        return insertText$2(tx, args);
      }
    }
    if (!args.selection.isCollapsed()) {
      var tmp = deleteSelection$3(tx, args);
      args.selection = tmp.selection;
    }
    var nodes = pasteDoc.get(CLIPBOARD_CONTAINER_ID$1).nodes;
    var schema = tx.getSchema();

    if (nodes.length > 0) {
      var first = pasteDoc.get(nodes[0]);

      if (schema.isInstanceOf(first.type, 'text')) {
        args = _pasteAnnotatedText(tx, args);
        // HACK: this changes the container's nodes array.
        // We do this, to be able to call _pasteDocument inserting the remaining nodes
        nodes.shift();
      }
      // if still nodes left > 0
      if (nodes.length > 0) {
        args = _pasteDocument(tx, args);
      }
    }
    return args;
  };

  /*
    Splits plain text by lines and puts them into paragraphs.
  */
  function _convertPlainTextToDocument(tx, args) {
    var defaultTextType = tx.getSchema().getDefaultTextType();
    var lines = args.text.split(/\s*\n\s*\n/);
    var pasteDoc = tx.newInstance();
    var container = pasteDoc.create({
      type: 'container',
      id: CLIPBOARD_CONTAINER_ID$1,
      nodes: []
    });
    var node;
    if (lines.length === 1) {
      node = pasteDoc.create({
        id: CLIPBOARD_PROPERTY_ID$1,
        type: defaultTextType,
        content: lines[0]
      });
      container.show(node.id);
    } else {
      for (var i = 0; i < lines.length; i++) {
        node = pasteDoc.create({
          id: uuid$a(defaultTextType),
          type: defaultTextType,
          content: lines[i]
        });
        container.show(node.id);
      }
    }
    return pasteDoc;
  }

  function _pasteAnnotatedText(tx, args) {
    var copy = args.doc;
    var selection = args.selection;

    var nodes = copy.get(CLIPBOARD_CONTAINER_ID$1).nodes;
    var textPath = [nodes[0], 'content'];
    var text = copy.get(textPath);
    var annotations = copy.getIndex('annotations').get(textPath);
    // insert plain text
    var path = selection.start.path;
    var offset = selection.start.offset;
    tx.update(path, { insert: { offset: offset, value: text } } );
    annotationHelpers$3.insertedText(tx, selection.start, text.length);
    selection = tx.createSelection({
      type: 'property',
      path: selection.start.path,
      startOffset: selection.start.offset+text.length
    });
    // copy annotations
    each$f(annotations, function(anno) {
      var data = anno.toJSON();
      data.path = path.slice(0);
      data.startOffset += offset;
      data.endOffset += offset;
      if (tx.get(data.id)) {
        data.id = uuid$a(data.type);
      }
      tx.create(data);
    });
    args.selection = selection;
    return args;
  }

  function _pasteDocument(tx, args) {
    var pasteDoc = args.doc;
    var containerId = args.containerId;
    var selection = args.selection;
    var container = tx.get(containerId);

    var startPath = selection.start.path;
    var startPos = container.getPosition(selection.start.getNodeId());
    var text = tx.get(startPath);
    var insertPos;
    // Break, unless we are at the last character of a node,
    // then we can simply insert after the node
    if ( text.length === selection.start.offset ) {
      insertPos = startPos + 1;
    } else {
      var result = breakNode$2(tx, args);
      selection = result.selection;
      insertPos = startPos + 1;
    }
    // TODO how should this check be useful?
    if (insertPos < 0) {
      console.error('Could not find insertion position in ContainerNode.');
    }
    // transfer nodes from content document
    var nodeIds = pasteDoc.get(CLIPBOARD_CONTAINER_ID$1).nodes;
    var annoIndex = pasteDoc.getIndex('annotations');
    var insertedNodes = [];
    for (var i = 0; i < nodeIds.length; i++) {
      var nodeId = nodeIds[i];
      var node = _copyNode$1(tx, pasteDoc.get(nodeId));
      container.show(node.id, insertPos++);
      insertedNodes.push(node);

      // transfer annotations
      // what if we have changed the id of nodes that are referenced by annotations?
      var annos = annoIndex.get(nodeId);
      for (var j = 0; j < annos.length; j++) {
        var data = annos[j].toJSON();
        if (node.id !== nodeId) {
          data.path[0] = node.id;
        }
        if (tx.get(data.id)) {
          data.id = uuid$a(data.type);
        }
        tx.create(data);
      }
    }

    if (insertedNodes.length === 0) return args;

    // select the whole pasted block
    var firstNode = insertedNodes[0];
    var lastNode = last$4(insertedNodes);
    args.selection = tx.createSelection({
      type: 'container',
      containerId: containerId,
      startPath: [firstNode.id],
      startOffset: 0,
      endPath: [lastNode.id],
      endOffset: 1,
    });
    return args;
  }

  function _copyNode$1(tx, pasteNode) {
    var nodeId = pasteNode.id;
    var data = pasteNode.toJSON();
    // create a new id if the node exists already
    if (tx.get(nodeId)) {
      data.id = uuid$a(pasteNode.type);
    }
    if (pasteNode.hasChildren()) {
      var children = pasteNode.getChildren();
      var childrenIds = data[pasteNode.getChildrenProperty()];
      for (var i = 0; i < children.length; i++) {
        var childNode = _copyNode$1(tx, children[i]);
        childrenIds[i] = childNode.id;
      }
    }
    return tx.create(data);
  }

  module.exports = paste;

  var extend$g = require('lodash/extend');
  var deleteSelection$4 = require('./deleteSelection');
  var updateAnnotations$3 = require('./updateAnnotations');

  /*
   * TODO: there is a use-case where this implementation does not suffice:
   * When the text of an annotation is selected fully, instead of deleting
   * the text and the annotation, the annotation should be preserved and adapted
   * to the range of the new text.
   */
  function replaceText$1(tx, args) {
    return _defaultReplace(tx, args);
  }

  function _defaultReplace(tx, args) {
    var out = deleteSelection$4(tx, extend$g({}, args, {
      direction: 'right'
    }));
    var sel = out.selection;
    if (!sel.isPropertySelection()) {
      // Should not happen if deleteSelection works correctly
      throw new Error('Invalid state.');
    }
    var text = args.text;
    var op = tx.update(sel.path, { insert: { offset: sel.startOffset, value: text } } );
    updateAnnotations$3(tx, { op: op });
    args.selection = tx.createSelection(sel.path, sel.startOffset + text.length);
    return args;
  }

  module.exports = replaceText$1;

  var extend$h = require('lodash/extend');
  var uuid$b = require('../../util/uuid');
  var annotationHelpers$4 = require('../annotationHelpers');
  var deleteNode$4 = require('./deleteNode');

  /**
    Switch text type for a given node. E.g. from `paragraph` to `heading`.

    @param {Object} args object with `selection`, `containerId` and `data` with new node data
    @return {Object} object with updated `selection`

    @example

    ```js
    switchTextType(tx, {
      selection: bodyEditor.getSelection(),
      containerId: bodyEditor.getContainerId(),
      data: {
        type: 'heading',
        level: 2
      }
    });
    ```
  */

  function switchTextType(tx, args) {
    var sel = args.selection;
    if (!sel.isPropertySelection()) {
      console.error("Selection must be a PropertySelection.");
      return args;
    }
    var path = sel.path;
    var nodeId = path[0];
    var data = args.data;
    var node = tx.get(nodeId);
    if (!(node.isInstanceOf('text'))) {
      console.warn('Trying to use switchTextType on a non text node. Skipping.');
      return args;
    }
    // create a new node and transfer annotations
    var newNode = extend$h({
      id: uuid$b(data.type),
      type: data.type,
      content: node.content
    }, data);
    var newPath = [newNode.id, 'content'];
    newNode = tx.create(newNode);
    annotationHelpers$4.transferAnnotations(tx, path, 0, newPath, 0);

    // hide the old one, show the new node
    var container = tx.get(args.containerId);
    var pos = container.getPosition(nodeId);
    if (pos >= 0) {
      container.hide(nodeId);
      container.show(newNode.id, pos);
    }
    // remove the old one from the document
    deleteNode$4(tx, { nodeId: node.id });

    args.selection = tx.createSelection(newPath, sel.startOffset, sel.endOffset);
    args.node = newNode;

    return args;
  }

  module.exports = switchTextType;

  /*
   @param {model/Document} tx
   @param {model/Annotation} args.anno annotation which should be expanded
   @param {model/Selection}  args.selection selection to which to expand
  */
  function truncateAnnotation(tx, args) {
    var sel = args.selection;
    var anno = args.anno;
    if (!sel || !sel._isSelection) throw new Error('Argument "selection" is required.');
    if (!anno || !anno._isAnnotation) throw new Error('Argument "anno" is required.');

    var annoSel = anno.getSelection();
    var newAnnoSel = annoSel.truncateWith(sel);
    anno.updateRange(tx, newAnnoSel);
    args.result = anno;
    return args;
  }

  module.exports = truncateAnnotation;

  var annotationHelpers$5 = require('../annotationHelpers');
  var Coordinate$6 = require('../Coordinate');

  function updateAnnotations$4(tx, args) {
    var op = args.op;
    if (op.isUpdate()) {
      var diff = op.diff;
      if (diff.isInsert()) {
        return _upateAfterInsert(tx, args);
      } else if (diff.isDelete()) {
        return _updateAfterDelete(tx, args);
      }
    } else {
      throw new Error('Only text updates are supported.');
    }
    return args;
  }

  function _upateAfterInsert(tx, args) {
    var op = args.op;
    var diff = op.diff;
    annotationHelpers$5.insertedText(tx, new Coordinate$6(op.path, diff.pos), diff.getLength(), args.ignoredAnnotations);
    return args;
  }

  function _updateAfterDelete(tx, args) {
    var op = args.op;
    var diff = op.diff;
    annotationHelpers$5.deletedText(tx, op.path, diff.pos, diff.pos + diff.getLength(), args.replaceTextSupport);
    return args;
  }

  module.exports = updateAnnotations$4;

  var DOMExporter$2 = require('./DOMExporter');
  var DefaultDOMElement$2 = require('../ui/DefaultDOMElement');
  var extend$i = require('lodash/extend');
  var each$g = require('lodash/each');
  var isBoolean$2 = require('lodash/isBoolean');
  var isNumber$a = require('lodash/isNumber');
  var isString$f = require('lodash/isString');

  /**
    @class
    @abstract

    Base class for custom XML exporters. If you want to use HTML as your
    exchange format see {@link model/HTMLExporter}.

    @example

    Below is a full example taken from [Lens](https://github.com/substance/lens/blob/master/model/LensArticleExporter.js).

    ```js
    var XMLExporter = require('substance/model/XMLExporter');
    var converters = require('./LensArticleImporter').converters;
    var each = require('lodash/each');

    function LensArticleExporter() {
      LensArticleExporter.super.call(this, {
        converters: converters,
        containerId: 'main'
      });
    }

    LensArticleExporter.Prototype = function() {
      this.exportDocument = function(doc) {
        this.state.doc = doc;
        var $$ = this.$$;
        var articleEl = $$('article');

        // Export ArticleMeta
        var metaEl = this.convertNode(doc.get('article-meta'));
        articleEl.append(metaEl);

        // Export resources (e.g. bib items)
        var resourceEl = $$('resources');
        var bibItems = doc.getIndex('type').get('bib-item');
        each(bibItems, function(bibItem) {
          var bibItemEl = this.convertNode(bibItem);
          resourceEl.append(bibItemEl);
        }.bind(this));
        articleEl.append(resourceEl);

        // Export article body
        var bodyElements = this.convertContainer(doc.get('main'));
        articleEl.append(
          $$('body').append(bodyElements)
        );
        return articleEl.outerHTML;
      };
    };

    XMLExporter.extend(LensArticleExporter);
    ```
  */

  function XMLExporter(config) {
    config = extend$i({ idAttribute: 'id' }, config);
    DOMExporter$2.call(this, config);

    // used internally for creating elements
    this._el = DefaultDOMElement$2.parseXML('<dummy></dummy>');
  }

  XMLExporter.Prototype = function() {

    var defaultAnnotationConverter = {
      tagName: 'annotation',
      export: function(node, el) {
        el.attr('type', node.type);
        var properties = node.toJSON();
        each$g(properties, function(value, name) {
          if (name === 'id' || name === 'type') return;
          if (isString$f(value) || isNumber$a(value) || isBoolean$2(value)) {
            el.attr(name, value);
          }
        });
      }
    };

    var defaultBlockConverter = {
      tagName: 'block',
      export: function(node, el, converter) {
        el.attr('type', node.type);
        var properties = node.toJSON();
        each$g(properties, function(value, name) {
          if (name === 'id' || name === 'type') {
            return;
          }
          var prop = converter.$$(name);
          if (node.getPropertyType(name) === 'string') {
            prop.append(converter.annotatedText([node.id, name]));
          } else {
            prop.text(value);
          }
          el.append(prop);
        });
      }
    };

    this.getDefaultBlockConverter = function() {
      return defaultBlockConverter;
    };

    this.getDefaultPropertyAnnotationConverter = function() {
      return defaultAnnotationConverter;
    };

  };

  DOMExporter$2.extend(XMLExporter);

  module.exports = XMLExporter;

  var DOMImporter$2 = require('./DOMImporter');
  var DefaultDOMElement$3 = require('../ui/DefaultDOMElement');
  var extend$j = require('lodash/extend');

  /**
    @class
    @abstract

    Base class for custom XML importers. If you want to use HTML as your
    exchange format see {@link model/HTMLImporter}.

    @example

    Below is a full example taken from [Lens](https://github.com/substance/lens/blob/master/model/LensArticleImporter.js).

    ```js
    var XMLImporter = require('substance/model/XMLImporter');
    var articleSchema = require('./articleSchema');
    var LensArticle = require('./LensArticle');

    var converters = [
      require('substance/packages/paragraph/ParagraphHTMLConverter'),
      require('substance/packages/blockquote/BlockquoteHTMLConverter'),
      require('substance/packages/codeblock/CodeblockHTMLConverter'),
      require('substance/packages/heading/HeadingHTMLConverter'),
      require('substance/packages/image/ImageXMLConverter'),
      require('substance/packages/strong/StrongHTMLConverter'),
      require('substance/packages/emphasis/EmphasisHTMLConverter'),
      require('substance/packages/link/LinkHTMLConverter'),

      // Lens-specific converters
      require('../packages/metadata/MetadataXMLConverter'),
      require('../packages/bibliography/BibItemXMLConverter'),
      require('../packages/figures/ImageFigureXMLConverter'),

      require('../packages/figures/ImageFigureCitationXMLConverter'),
      require('../packages/bibliography/BibItemCitationXMLConverter'),
    ];

    function LensArticleImporter() {
      XMLImporter.call(this, {
        schema: articleSchema,
        converters: converters,
        DocumentClass: LensArticle
      });
    }

    LensArticleImporter.Prototype = function() {

      // XML import
      // <article>
      //   <meta>...</meta>
      //   <resources>...</resources>
      //   <body>...</body>
      // </article>
      this.convertDocument = function(articleElement) {
        // Import meta node
        var metaElement = articleElement.find('meta');
        this.convertElement(metaElement);

        // Import resources
        var resources = articleElement.find('resources');
        resources.children.forEach(function(resource) {
          this.convertElement(resource);
        }.bind(this));

        // Import main container
        var bodyNodes = articleElement.find('body').children;
        this.convertContainer(bodyNodes, 'main');
      };
    };

    // Expose converters so we can reuse them in NoteHtmlExporter
    LensArticleImporter.converters = converters;

    XMLImporter.extend(LensArticleImporter);
    ```
  */

  function XMLImporter(config) {
    config = extend$j({ idAttribute: 'id' }, config);
    DOMImporter$2.call(this, config);

    // only used internally for creating wrapper elements
    this._el = DefaultDOMElement$3.parseXML('<dummy></dummy>');
  }

  XMLImporter.Prototype = function() {

    this.importDocument = function(xml) {
      // initialization
      this.reset();
      // converting to JSON first
      var articleElement = DefaultDOMElement$3.parseXML(xml);
      this.convertDocument(articleElement);
      var doc = this.generateDocument();
      return doc;
    };

  };

  DOMImporter$2.extend(XMLImporter);

  module.exports = XMLImporter;

  module.exports = {
    name: 'base',
    configure: function(config) {
      config.addCommand(require('./SwitchTextTypeCommand'));
      config.addCommand(require('./UndoCommand'));
      config.addCommand(require('./RedoCommand'));
      config.addTool(require('./UndoTool'));
      config.addTool(require('./RedoTool'));
      config.addTool(require('./SwitchTextTypeTool'));
      // Icons
      config.addIcon('undo', { 'fontawesome': 'fa-undo' });
      config.addIcon('redo', { 'fontawesome': 'fa-repeat' });
      config.addIcon('edit', { 'fontawesome': 'fa-cog' });
      config.addIcon('delete', { 'fontawesome': 'fa-times' });
      config.addIcon('expand', { 'fontawesome': 'fa-arrows-h' });
      config.addIcon('truncate', { 'fontawesome': 'fa-arrows-h' });
      // Labels
      config.addLabel('undo', {
        en: 'Undo',
        de: 'Rückgängig'
      });
      config.addLabel('redo', {
        en: 'Redo',
        de: 'Wiederherstellen'
      });
      config.addLabel('container-selection', {
        en: 'Container',
        de: 'Container'
      });
      config.addLabel('container', {
        en: 'Container',
        de: 'Container'
      });
      config.addLabel('insert-container', {
        en: 'Insert Container',
        de: 'Container einfügen'
      });
    }
  };

  var Command = require('../../ui/Command');

  function Redo() {
    Redo.super.apply(this, arguments);
  }

  Redo.Prototype = function() {

    this.getCommandState = function(props, context) {
      var docSession = context.documentSession;
      return {
        disabled: !docSession.canRedo(),
        active: false
      };
    };

    this.execute = function(props, context) {
      var docSession = context.documentSession;
      if (docSession.canRedo()) {
        docSession.redo();
        return true;
      } else {
        return false;
      }
    };
  };

  Command.extend(Redo);

  Redo.static.name = 'redo';

  module.exports = Redo;

  var Tool = require('../../ui/Tool');

  function RedoTool() {
    RedoTool.super.apply(this, arguments);
  }

  Tool.extend(RedoTool);

  RedoTool.static.name = 'redo';

  module.exports = RedoTool;

  var Command$1 = require('../../ui/Command');
  var _isMatch = require('lodash/isMatch');
  var _find = require('lodash/find');
  var _clone = require('lodash/clone');

  function SwitchTextType() {
    Command$1.apply(this, arguments);
  }

  SwitchTextType.Prototype = function() {

    // Available text types on the surface
    this.getTextTypes = function(context) {
      var surface = context.surfaceManager.getFocusedSurface();
      if (surface && surface.isContainerEditor()) {
        return surface.getTextTypes();
      } else {
        return [];
      }
    };

    this.getTextType = function(context, textTypeName) {
      var textTypes = this.getTextTypes(context);
      return _find(textTypes, function(t) {
        return t.name === textTypeName;
      });
    };

    // Search which textType matches the current node
    // E.g. {type: 'heading', level: 1} => heading1
    this.getCurrentTextType = function(context, node) {
      var textTypes = this.getTextTypes(context);
      var currentTextType;
      textTypes.forEach(function(textType) {
        var nodeProps = _clone(textType.data);
        delete nodeProps.type;
        if (_isMatch(node, nodeProps) && node.type === textType.data.type) {
          currentTextType = textType;
        }
      });
      return currentTextType;
    };

    this.getCommandState = function(props, context) {
      var doc = context.documentSession.getDocument();
      var sel = context.documentSession.getSelection();
      var surface = context.surfaceManager.getFocusedSurface();
      var node;
      var newState = {
        disabled: false,
        textTypes: this.getTextTypes(context)
      };
      // Set disabled when not a property selection
      if (!surface || !surface.isEnabled() || sel.isNull()) {
        newState.disabled = true;
      } else if (sel.isContainerSelection()) {
        newState.disabled = true;
        newState.currentTextType = {name: 'container-selection'};
      } else if (sel.isPropertySelection()) {
        var path = sel.getPath();
        node = doc.get(path[0]);
        // There are cases where path points to an already deleted node,
        // so we need to guard node
        if (node) {
          if (node.isText() && node.isBlock()) {
            newState.currentTextType = this.getCurrentTextType(context, node);
          }
          if (!newState.currentTextType) {
            // We 'abuse' the currentTextType field by providing a property
            // identifier that is translated into a name using an default label set.
            // E.g. this.getLabel('figure.caption') -> Figure Caption
            newState.currentTextType = {name: [node.type, path[1]].join('.')};
            newState.disabled = true;
          }
        }
      } else if (sel.isNodeSelection()) {
        node = doc.get(sel.getNodeId());
        newState.currentTextType = {name: node.type};
        newState.disabled = true;
      } else if (sel.isCustomSelection()) {
        newState.currentTextType = {name: 'custom'};
        newState.disabled = true;
      }
      return newState;
    };

    /**
      Trigger a switchTextType transaction

      @param {String} textTypeName identifier (e.g. heading1)
    */
    this.execute = function(props, context) {
      var textType = this.getTextType(context, props.textType);
      var nodeData = textType.data;
      var surface = context.surfaceManager.getFocusedSurface();
      if (!surface) {
        console.warn('No focused surface. Stopping command execution.');
        return;
      }
      surface.transaction(function(tx, args) {
        args.data = nodeData;
        return surface.switchType(tx, args);
      });
      return nodeData;
    };
  };

  Command$1.extend(SwitchTextType);
  SwitchTextType.static.name = 'switch-text-type';

  module.exports = SwitchTextType;

  var each$h = require('lodash/each');
  var Tool$1 = require('../../ui/Tool');
  var keys = require('../../util/keys');

  /**
    SwitchTextTypeTool. Implements the SurfaceTool API.

    @class
    @component
  */
  function SwitchTextTypeTool() {
    SwitchTextTypeTool.super.apply(this, arguments);

    // cursor for keyboard navigation
    this._navIdx = -1;
  }

  SwitchTextTypeTool.Prototype = function() {

    var _super = SwitchTextTypeTool.super.prototype;

    // UI Specific parts
    // ----------------

    this.didMount = function() {
      _super.didMount.call(this);

      this._focusToggle();
    };


    this.render = function($$) {
      var labelProvider = this.context.labelProvider;
      var textTypeName = 'No selection';

      if (this.props.currentTextType) {
        textTypeName = this.props.currentTextType.name;
      }
      var el = $$('div').addClass('sc-switch-text-type');

      var toggleButton = $$('button').ref('toggle')
        .addClass('se-toggle')
        .attr('title', labelProvider.getLabel('switch_text'))
        .append(labelProvider.getLabel(textTypeName))
        .on('click', this.toggleAvailableTextTypes);

      if (this.props.disabled || !this.props.currentTextType) {
        el.addClass('sm-disabled');
        toggleButton.attr('tabindex', -1);
      } else {
        toggleButton.attr('tabindex', 1);
      }

      el.append(toggleButton);

      if (this.state.open) {
        el.addClass('sm-open');

        // dropdown options
        var options = $$('div').addClass("se-options").ref('options');
        each$h(this.props.textTypes, function(textType) {
          var button = $$('button')
              .addClass('se-option sm-'+textType.name)
              .attr('data-type', textType.name)
              .append(labelProvider.getLabel(textType.name))
              .on('click', this.handleClick);
          options.append(button);
        }.bind(this));
        el.append(options);
        el.on('keydown', this.onKeydown);
      }

      return el;
    };

    this.didUpdate = function() {
      this._focusToggle();
    };

    this._focusToggle = function() {
      if (this.state.open) {
        this.refs.toggle.focus();
      }
    };

    this.executeCommand = function(textType) {
      this.context.commandManager.executeCommand('switch-text-type', {
        textType: textType
      });
    };

    this.getTextCommands = function() {
      var surface = this.getSurface();
      if (!this.textCommands && surface) {
        this.textCommands = surface.getTextCommands();
      }
      return this.textCommands || {};
    };

    this.handleClick = function(e) {
      e.preventDefault();
      // Modifies the tool's state so that state.open is undefined, which is nice
      // because it means the dropdown will be closed automatically
      this.executeCommand(e.currentTarget.dataset.type);
    };

    this.onKeydown = function(event) {
      var handled = false;
      switch (event.keyCode) {
        case keys.UP:
          this._nav(-1);
          handled = true;
          break;
        case keys.DOWN:
          this._nav(1);
          handled = true;
          break;
        case keys.ESCAPE:
          this.toggleDropdown();
          handled = true;
          break;
        default:
          // nothing
      }
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    this.toggleAvailableTextTypes = function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (this.props.disabled) return;

      // HACK: This only updates the view state state.open is not set on the tool itself
      // That way the dropdown automatically closes when the selection changes
      this.toggleDropdown();
    };

    this.toggleDropdown = function() {
      // reset index for keyboard navigation
      this._navIdx = -1;
      this.extendState({
        open: !this.state.open
      });
    };

    this._nav = function(step) {
      this._navIdx += step;
      this._navIdx = Math.max(0, this._navIdx);
      this._navIdx = Math.min(this._getOptionsCount()-1, this._navIdx);

      if (this._navIdx >= 0) {
        var option = this.refs.options.children[this._navIdx];
        option.focus();
      }
    };

    this._getOptionsCount = function() {
      return this.refs.options.children.length;
    };

  };

  Tool$1.extend(SwitchTextTypeTool);

  SwitchTextTypeTool.static.name = 'switch-text-type';

  module.exports = SwitchTextTypeTool;

  var Command$2 = require('../../ui/Command');

  function Undo() {
    Undo.super.apply(this, arguments);
  }

  Undo.Prototype = function() {

    this.getCommandState = function(props, context) {
      var docSession = context.documentSession;
      return {
        disabled: !docSession.canUndo(),
        active: false
      };
    };

    this.execute = function(props, context) {
      var docSession = context.documentSession;
      if (docSession.canUndo()) {
        docSession.undo();
        return true;
      }
      return false;
    };
  };

  Command$2.extend(Undo);

  Undo.static.name = 'undo';

  module.exports = Undo;

  var Tool$2 = require('../../ui/Tool');

  function UndoTool() {
    UndoTool.super.apply(this, arguments);
  }

  Tool$2.extend(UndoTool);
  UndoTool.static.name = 'undo';

  module.exports = UndoTool;

  var TextBlock$1 = require('../../model/TextBlock');

  function Blockquote() {
    Blockquote.super.apply(this, arguments);
  }

  TextBlock$1.extend(Blockquote);

  Blockquote.static.name = "blockquote";

  module.exports = Blockquote;

  var TextBlockComponent = require('../../ui/TextBlockComponent');

  function BlockquoteComponent() {
    BlockquoteComponent.super.apply(this, arguments);
  }

  BlockquoteComponent.Prototype = function() {

    var _super = BlockquoteComponent.super.prototype;

    this.render = function($$) {
      var el = _super.render.call(this, $$);
      return el.addClass('sc-blockquote');
    };

  };

  TextBlockComponent.extend(BlockquoteComponent);

  module.exports = BlockquoteComponent;

  /*
   * HTML converter for Blockquote.
   */
  module.exports = {

    type: 'blockquote',
    tagName: 'blockquote',

    import: function(el, node, converter) {
      node.content = converter.annotatedText(el, [node.id, 'content']);
    },

    export: function(node, el, converter) {
      el.append(
        converter.annotatedText([node.id, 'content'])
      );
    },

  };

  var Blockquote$1 = require('./Blockquote');
  var BlockquoteComponent$1 = require('./BlockquoteComponent');
  var BlockquoteHTMLConverter = require('./BlockquoteHTMLConverter');

  module.exports = {
    name: 'blockquote',
    configure: function(config) {
      config.addNode(Blockquote$1);
      config.addComponent(Blockquote$1.static.name, BlockquoteComponent$1);
      config.addConverter('html', BlockquoteHTMLConverter);
      config.addTextType({
        name: 'blockquote',
        data: {type: 'blockquote'}
      });
      config.addLabel('blockquote', {
        en: 'Blockquote',
        de: 'Blockzitat'
      });
    }
  };

  module.exports = require('./BlockquoteHTMLConverter');

  var PropertyAnnotation$3 = require('../../model/PropertyAnnotation');

  function Code() {
    Code.super.apply(this, arguments);
  }
  PropertyAnnotation$3.extend(Code);

  Code.static.name = 'code';

  module.exports = Code;

  var AnnotationCommand = require('../../ui/AnnotationCommand');

  var CodeCommand = AnnotationCommand.extend();

  CodeCommand.static.name = 'code';

  module.exports = CodeCommand;

  /*
   * HTML converter for Code.
   */
  module.exports = {

    type: 'code',
    tagName: 'code',

  };

  var Code$1 = require('./Code');
  var CodeTool = require('./CodeTool');
  var CodeCommand$1 = require('./CodeCommand');

  module.exports = {
    name: 'code',
    configure: function(config) {
      config.addNode(Code$1);
      config.addCommand(CodeCommand$1);
      config.addTool(CodeTool);
      config.addIcon('code', { 'fontawesome': 'fa-code' });

      config.addLabel('code', {
        en: 'Code',
        de: 'Code'
      });
    }
  };

  var AnnotationTool = require('../../ui/AnnotationTool');

  function CodeTool$1() {
    AnnotationTool.apply(this, arguments);
  }

  AnnotationTool.extend(CodeTool$1);

  CodeTool$1.static.name = 'code';

  module.exports = CodeTool$1;

  module.exports = require('./CodeHTMLConverter');

  var TextBlock$2 = require('../../model/TextBlock');

  function Codeblock() {
    Codeblock.super.apply(this, arguments);
  }

  TextBlock$2.extend(Codeblock);

  Codeblock.static.name = "codeblock";

  module.exports = Codeblock;

  var TextBlockComponent$1 = require('../../ui/TextBlockComponent');

  function CodeblockComponent() {
    CodeblockComponent.super.apply(this, arguments);
  }

  CodeblockComponent.Prototype = function() {

    var _super = CodeblockComponent.super.prototype;

    this.render = function($$) {
      var el = _super.render.call(this, $$);
      return el.addClass('sc-codeblock');
    };

  };

  TextBlockComponent$1.extend(CodeblockComponent);

  module.exports = CodeblockComponent;

  /*
   * HTML converter for Codeblock.
   */
  module.exports = {

    type: 'codeblock',
    tagName: 'pre',

    import: function(el, node, converter) {
      var codeEl = el.find('code');
      if (codeEl) {
        node.content = converter.annotatedText(codeEl, [node.id, 'content'], { preserveWhitespace: true });
      }
    },

    export: function(node, el, converter) {
      var $$ = converter.$$;
      el.append(
        $$('code').append(
          converter.annotatedText([node.id, 'content'])
        )
      );
    }

  };

  var Codeblock$1 = require('./Codeblock');
  var CodeblockComponent$1 = require('./CodeblockComponent');
  var CodeblockHTMLConverter = require('./CodeblockHTMLConverter');

  module.exports = {
    name: 'codeblock',
    configure: function(config) {
      config.addNode(Codeblock$1);
      config.addComponent(Codeblock$1.static.name, CodeblockComponent$1);
      config.addConverter('html', CodeblockHTMLConverter);
      config.addTextType({
        name: 'codeblock',
        data: {type: 'codeblock'}
      });

      config.addLabel('codeblock', {
        en: 'Codeblock',
        de: 'Codeblock'
      });
    }
  };

  module.exports = require('./CodeblockHTMLConverter');

  var PropertyAnnotation$4 = require('../../model/PropertyAnnotation');
  var Fragmenter$2 = require('../../model/Fragmenter');

  function Emphasis() {
    Emphasis.super.apply(this, arguments);
  }

  PropertyAnnotation$4.extend(Emphasis);

  Emphasis.static.name = "emphasis";

  // hint for rendering in presence of overlapping annotations
  Emphasis.static.fragmentation = Fragmenter$2.ANY;

  module.exports = Emphasis;

  var AnnotationCommand$1 = require('../../ui/AnnotationCommand');

  function EmphasisCommand() {
    EmphasisCommand.super.apply(this, arguments);
  }
  AnnotationCommand$1.extend(EmphasisCommand);

  EmphasisCommand.static.name = 'emphasis';

  module.exports = EmphasisCommand;

  /*
   * HTML converter for Blockquote.
   */
  module.exports = {

    type: 'emphasis',
    tagName: 'em',

    matchElement: function(el) {
      return el.is('em, i');
    }

  };

  var Emphasis$1 = require('./Emphasis');
  var EmphasisTool = require('./EmphasisTool');
  var EmphasisCommand$1 = require('./EmphasisCommand');
  var EmphasisHTMLConverter = require('./EmphasisHTMLConverter');
  var EmphasisXMLConverter = require('./EmphasisXMLConverter');

  module.exports = {
    name: 'emphasis',
    configure: function(config) {
      config.addNode(Emphasis$1);
      config.addCommand(EmphasisCommand$1);
      config.addTool(EmphasisTool);
      config.addConverter('html', EmphasisHTMLConverter);
      config.addConverter('xml', EmphasisXMLConverter);
      config.addIcon('emphasis', { 'fontawesome': 'fa-italic' });

      config.addLabel('emphasis', {
        en: 'Emphasis',
        de: 'Betonung'
      });
    }
  };

  var AnnotationTool$1 = require('../../ui/AnnotationTool');

  function EmphasisTool$1() {
    EmphasisTool$1.super.apply(this, arguments);
  }

  AnnotationTool$1.extend(EmphasisTool$1);

  EmphasisTool$1.static.name = 'emphasis';

  module.exports = EmphasisTool$1;

  module.exports = require('./EmphasisHTMLConverter');

  var TextBlock$3 = require('../../model/TextBlock');

  function Heading() {
    Heading.super.apply(this, arguments);
  }

  TextBlock$3.extend(Heading);

  Heading.static.name = "heading";

  Heading.static.defineSchema({
    "level": { type: "number", default: 1 }
  });

  module.exports = Heading;

  var TextBlockComponent$2 = require('../../ui/TextBlockComponent');

  function HeadingComponent() {
    HeadingComponent.super.apply(this, arguments);
  }

  HeadingComponent.Prototype = function() {

    var _super = HeadingComponent.super.prototype;

    this.render = function($$) {
      var el = _super.render.call(this, $$);
      return el.addClass("sc-heading sm-level-"+this.props.node.level);
    };

  };

  TextBlockComponent$2.extend(HeadingComponent);

  module.exports = HeadingComponent;

  /*
   * HTML converter for Paragraphs.
   */
  module.exports = {

    type: "heading",

    matchElement: function(el) {
      return /^h\d$/.exec(el.tagName);
    },

    import: function(el, node, converter) {
      node.level = Number(el.tagName[1]);
      node.content = converter.annotatedText(el, [node.id, 'content']);
    },

    export: function(node, el, converter) {
      el.tagName = 'h'+node.level;
      el.append(
        converter.annotatedText([node.id, 'content'])
      );
    }

  };

  var Heading$1 = require('./Heading');
  var HeadingComponent$1 = require('./HeadingComponent');
  var HeadingHTMLConverter = require('./HeadingHTMLConverter');

  module.exports = {
    name: 'heading',
    configure: function(config) {
      config.addNode(Heading$1);
      config.addComponent(Heading$1.static.name, HeadingComponent$1);
      config.addConverter('html', HeadingHTMLConverter);
      config.addTextType({
        name: 'heading1',
        data: {type: 'heading', level: 1}
      });
      config.addTextType({
        name: 'heading2',
        data: {type: 'heading', level: 2}
      });
      config.addTextType({
        name: 'heading3',
        data: {type: 'heading', level: 3}
      });
      config.addLabel('heading1', {
        en: 'Heading 1',
        de: 'Überschrift 1'
      });
      config.addLabel('heading2', {
        en: 'Heading 2',
        de: 'Überschrift 2'
      });
      config.addLabel('heading3', {
        en: 'Heading 3',
        de: 'Überschrift 3'
      });
    }
  };

  module.exports = require('./HeadingHTMLConverter');

  var DocumentNode$7 = require('../../model/DocumentNode');

  function Image() {
    Image.super.apply(this, arguments);
  }

  DocumentNode$7.extend(Image);

  Image.static.name = "image";

  Image.static.defineSchema({
    "src": { type: "string", default: "http://" },
    "previewSrc": { type: "string", optional: true }
  });

  module.exports = Image;

  var BlockNodeComponent = require('../../ui/BlockNodeComponent');

  function ImageComponent() {
    ImageComponent.super.apply(this, arguments);
  }

  ImageComponent.Prototype = function() {

    var _super = ImageComponent.super.prototype;

    this.didMount = function() {
      _super.didMount.call(this);

      this.props.node.on('src:changed', this.rerender, this);
    };

    this.dispose = function() {
      _super.dispose.call(this);

      this.props.node.off(this);
    };

    this.getTagName = function() {
      return 'img';
    };

    this.render = function($$) {
      var el = _super.render.call(this, $$);
      el.addClass('sc-image')
        .attr({
          src: this.props.node.src,
        });
      return el;
    };

  };

  BlockNodeComponent.extend(ImageComponent);

  module.exports = ImageComponent;

  /*
   * HTML converter for Paragraphs.
   */
  module.exports = {

    type: 'image',
    tagName: 'img',

    import: function(el, node) {
      node.src = el.attr('src');
      node.previewSrc = el.attr('data-preview-src');
    },

    export: function(node, el) {
      el.attr('src', node.src)
        .attr('data-preview-src', node.previewSrc);
    }
  };

  var ImageNode = require('./Image');
  var ImageComponent$1 = require('./ImageComponent');
  var InsertImageCommand = require('./InsertImageCommand');
  var InsertImageTool = require('./InsertImageTool');

  module.exports = {
    name: 'image',
    configure: function(config) {
      config.addNode(ImageNode);
      config.addComponent(ImageNode.static.name, ImageComponent$1);
      config.addCommand(InsertImageCommand);
      config.addTool(InsertImageTool);
      config.addIcon(InsertImageCommand.static.name, { 'fontawesome': 'fa-image' });
      config.addLabel('image', {
        en: 'Image',
        de: 'Bild'
      });
      config.addLabel('insert-image', {
        en: 'Insert image',
        de: 'Bild einfügen'
      });
    }
  };

  /*
   * XML converter for Images.
   */
  module.exports = {

    type: 'image',
    tagName: 'image',

    import: function(el, node) {
      node.src = el.attr('src');
      node.previewSrc = el.attr('preview-src');
    },

    export: function(node, el) {
      el.attr('src', node.src)
        .attr('preview-src', node.previewSrc);
    }
  };

  var uuid$c = require('../../util/uuid');
  var Command$3 = require('../../ui/Command');

  function ImageCommand() {
    ImageCommand.super.apply(this, arguments);
  }

  ImageCommand.Prototype = function() {

    this.getCommandState = function(props, context) {
      var documentSession = context.documentSession;
      var sel = documentSession.getSelection();

      var newState = {
        disabled: true,
        active: false
      };
      if (sel && !sel.isNull() && sel.isPropertySelection()) {
        newState.disabled = false;
      }
      return newState;
    };

    /**
      Initiates a fileupload and performs image insertion after the fileupload
      has been completed.

      TODO: Think about ways to make ImagCommand CLI-compatible.
    */
    this.execute = function(props, context) {
      var state = this.getCommandState(props, context);
      // Return if command is disabled
      if (state.disabled) return;

      var surface = context.surfaceManager.getFocusedSurface();
      var fileClient = context.fileClient;
      var file = props.file;
      if (!file) {
        throw new Error("'file' is mandatory.");
      }
      fileClient.uploadFile(file, function(err, figureUrl) {
        // NOTE: we are providing a custom beforeState, to make sure
        // thate the correct initial selection is used.
        surface.transaction(function(tx, args) {
          var newImage = {
            id: uuid$c('image'),
            type: 'image',
            src: figureUrl,
            previewSrc: figureUrl
          };
          // Note: returning the result which will contain an updated selection
          return surface.insertNode(tx, {
            selection: args.selection,
            node: newImage,
            containerId: surface.getContainerId()
          });
        });
      });

      return {
        status: 'file-upload-process-started'
      };
    };

  };

  Command$3.extend(ImageCommand);

  ImageCommand.static.name = 'insert-image';

  module.exports = ImageCommand;

  var Tool$3 = require('../../ui/Tool');

  function InsertImageTool$1() {
    InsertImageTool$1.super.apply(this, arguments);
  }

  InsertImageTool$1.Prototype = function() {

    var _super = InsertImageTool$1.super.prototype;

    this.getClassNames = function() {
      return 'sc-insert-image-tool';
    };

    this.renderButton = function($$) {
      var button = _super.renderButton.apply(this, arguments);
      var input = $$('input').attr('type', 'file').ref('input')
        .on('change', this.onFileSelect);
      return [button, input];
    };

    this.onClick = function() {
      this.refs.input.click();
    };

    this.onFileSelect = function(e) {
      // Pick the first file
      var file = e.currentTarget.files[0];
      this.performAction({
        file: file
      });
    };

  };

  Tool$3.extend(InsertImageTool$1);

  InsertImageTool$1.static.name = 'insert-image';

  module.exports = InsertImageTool$1;

  var BlockNode$1 = require('../../model/BlockNode');

  function Include() {
    Include.apply(this, arguments);
  }

  BlockNode$1.extend(Include, function IncludePrototype() {
    this.getIncludedNode = function() {
      return this.getDocument().get(this.nodeId);
    };
  });

  Include.static.name = "include";

  Include.static.defineSchema({
    "nodeType": "string",
    "nodeId": "id"
  });

  module.exports = Include;

  var BlockNodeComponent$1 = require('../../ui/BlockNodeComponent');
  var UnsupportedNode = require('../../ui/UnsupportedNodeComponent');

  function IncludeComponent() {
    IncludeComponent.super.apply(this, arguments);
  }

  IncludeComponent.Prototype = function() {

    var _super = IncludeComponent.super.prototype;

    this.render = function($$) {
      var doc = this.props.doc;
      var node = doc.get(this.props.node.nodeId);
      var componentRegistry = this.context.componentRegistry;
      var ComponentClass = componentRegistry.get(node.type);
      if (!ComponentClass) {
        console.error('Could not resolve a component for type: ' + node.type);
        ComponentClass = UnsupportedNode;
      }

      var el = _super.render.call(this, $$);
      el.addClass("sc-include")
        .append(
          $$(ComponentClass, { doc: doc, node: node }).ref(node.id)
        );
      return el;
    };
  };

  BlockNodeComponent$1.extend(IncludeComponent);

  module.exports = IncludeComponent;

  /*
    HTML converter for Includes.
  */
  module.exports = {

    type: 'include',
    tagName: 'include',

    import: function(el, node) {
      node.nodeId = el.attr('data-rid');
      node.nodeType = el.attr('data-rtype');
    },

    export: function(node, el) {
      el.attr('data-rtype', node.nodeType)
        .attr('data-rid', node.nodeId);
    }

  };

  var InlineNode$1 = require('../../model/InlineNode');

  function InlineWrapper() {
    InlineWrapper.super.apply(this, arguments);
  }

  InlineNode$1.extend(InlineWrapper);

  InlineWrapper.static.name = 'inline-wrapper';

  InlineWrapper.static.defineSchema({
    wrappedNode: 'id'
  });

  module.exports = InlineWrapper;

  var Component = require('../../ui/Component');

  function InlineWrapperComponent() {
    InlineWrapperComponent.super.apply(this, arguments);
  }

  InlineWrapperComponent.Prototype = function() {

    this.render = function($$) {
      var node = this.props.node;
      var doc = node.getDocument();
      var el = $$('span').addClass('sc-inline-wrapper')
        .attr('data-id', node.id);
      var wrappedNode = doc.get(node.wrappedNode);
      if (wrappedNode) {
        var componentRegistry = this.context.componentRegistry;
        var ComponentClass = componentRegistry.get(wrappedNode.type);
        if (ComponentClass) {
          el.append($$(ComponentClass, {
            node: wrappedNode,
            disabled: this.props.disabled
          }));
        } else {
          console.error('No component registered for node type' + wrappedNode.type);
        }
      } else {
        console.error('Could not find wrapped node: ' + node.wrappedNode);
      }
      return el;
    };

  };

  Component.extend(InlineWrapperComponent);

  module.exports = InlineWrapperComponent;

  module.exports = {

    type: 'inline-wrapper',

    matchElement: function(el, converter) {
      var blockConverter = converter._getConverterForElement(el, 'block');
      return Boolean(blockConverter);
    },

    import: function(el, node, converter) {
      // HACK monkey patching the context
      node.id = converter.nextId('inline-wrapper');
      var state = converter.state;
      state.popElementContext();
      state.pushElementContext(state.getCurrentElementContext().tagName);
      node.wrappedNode = converter.convertElement(el).id;
    },

    export: function(node, el, converter) {
      return converter.convertNode(node.wrappedNode);
    }

  };

  var InlineWrapper$1 = require('./InlineWrapper');
  var InlineWrapperComponent$1 = require('./InlineWrapperComponent');
  var InlineWrapperConverter = require('./InlineWrapperConverter');

  /*
    This package adds a node to the model which can be used
    to use a block-level node within an inline context.

      The quick brown fox jumps over the lazy <fig><img src='./dog.jpg'/></fig>.

    To register the converter you must provide `config.converters` which is
    an array of names of the converters you want this to be registered in.
  */
  module.exports = {
    name: 'inline-wrapper',
    configure: function(config, options) {
      config.addNode(InlineWrapper$1);
      config.addComponent(InlineWrapper$1.static.name, InlineWrapperComponent$1);
      if (options.converters) {
        options.converters.forEach(function(name) {
          config.addConverter(name, InlineWrapperConverter);
        });
      }
    }
  };

  var Component$1 = require('../../ui/Component');
  var clone$3 = require('lodash/clone');
  var Prompt = require('../../ui/Prompt');

  /**
    Component to edit an existing link.

    Designed so that it can be used either in a toolbar, or within
    an overlay on the Surface.
  */
  function EditLinkTool() {
    EditLinkTool.super.apply(this, arguments);
  }

  EditLinkTool.Prototype = function() {

    this.render = function($$) {
      var node = this.props.node;
      var el = $$('div').addClass('sc-edit-link-tool');

      el.append(
        $$(Prompt).append(
          $$(Prompt.Input, {
            type: 'url',
            path: [node.id, 'url'],
            placeholder: 'Paste or type a link url'
          }),
          $$(Prompt.Separator),
          $$(Prompt.Link, {
            name: 'open-link',
            href: node.url,
            title: this.getLabel('open-link')
          }),
          $$(Prompt.Action, {name: 'delete', title: this.getLabel('delete')})
            .on('click', this.onDelete)
        )
      );
      return el;
    };

    this.onDelete = function(e) {
      e.preventDefault();
      var node = this.props.node;
      var documentSession = this.context.documentSession;
      documentSession.transaction(function(tx) {
        tx.delete(node.id);
      });
    };
  };

  Component$1.extend(EditLinkTool);

  EditLinkTool.static.getProps = function(commandStates) {
    if (commandStates.link.mode === 'edit') {
      return clone$3(commandStates.link);
    } else {
      return undefined;
    }
  };

  EditLinkTool.static.name = 'edit-link';

  module.exports = EditLinkTool;

  var PropertyAnnotation$5 = require('../../model/PropertyAnnotation');
  var Fragmenter$3 = require('../../model/Fragmenter');

  function Link() {
    Link.super.apply(this, arguments);
  }

  PropertyAnnotation$5.extend(Link);

  Link.static.name = "link";

  Link.static.defineSchema({
    title: { type: 'string', optional: true },
    url: { type: 'string', 'default': 'http://'}
  });

  // in presence of overlapping annotations will try to render this as one element
  Link.static.fragmentation = Fragmenter$3.SHOULD_NOT_SPLIT;

  module.exports = Link;

  var AnnotationCommand$2 = require('../../ui/AnnotationCommand');

  function LinkCommand() {
    LinkCommand.super.apply(this, arguments);
  }

  LinkCommand.Prototype = function() {

    this.getAnnotationData = function() {
      return {
        url: ""
      };
    };

    this.canFuse = function() {
      return false;
    };

    // When there's some overlap with only a single annotation we do an expand
    this.canEdit = function(annos, sel) { // eslint-disable-line
      return annos.length === 1;
    };

    this.canDelete = function(annos, sel) { // eslint-disable-line
      return false;
    };

  };

  AnnotationCommand$2.extend(LinkCommand);

  LinkCommand.static.name = 'link';

  module.exports = LinkCommand;

  var AnnotationComponent = require('../../ui/AnnotationComponent');

  function LinkComponent() {
    LinkComponent.super.apply(this, arguments);
  }

  LinkComponent.Prototype = function() {

    var _super = LinkComponent.super.prototype;

    this.didMount = function() {
      _super.didMount.apply(this, arguments);

      var node = this.props.node;
      node.on('properties:changed', this.rerender, this);
    };

    this.dispose = function() {
      _super.dispose.apply(this, arguments);

      var node = this.props.node;
      node.off(this);
    };

    this.render = function($$) { // eslint-disable-line
      var el = _super.render.apply(this, arguments);

      el.tagName = 'a';
      el.attr('href', this.props.node.url);

      var titleComps = [this.props.node.url];
      if (this.props.node.title) {
        titleComps.push(this.props.node.title);
      }

      return el.attr("title", titleComps.join(' | '));
    };

  };

  AnnotationComponent.extend(LinkComponent);

  module.exports = LinkComponent;

  /*
   * HTML converter for Paragraphs.
   */
  module.exports = {

    type: "link",
    tagName: 'a',

    import: function(el, node) {
      node.url = el.attr('href');
      node.title = el.attr('title');
    },

    export: function(link, el) {
      el.attr({
        href: link.url,
        title: link.title
      });
    }

  };

  var Link$1 = require('./Link');
  var LinkComponent$1 = require('./LinkComponent');
  var LinkCommand$1 = require('./LinkCommand');
  var LinkHTMLConverter = require('./LinkHTMLConverter');
  var LinkTool = require('./LinkTool');
  var EditLinkTool$1 = require('./EditLinkTool');

  module.exports = {
    name: 'link',
    configure: function(config) {
      config.addNode(Link$1);
      config.addComponent(Link$1.static.name, LinkComponent$1);
      config.addConverter('html', LinkHTMLConverter);
      config.addCommand(LinkCommand$1);
      config.addTool(LinkTool);
      config.addTool(EditLinkTool$1, { overlay: true });
      config.addIcon(LinkCommand$1.static.name, { 'fontawesome': 'fa-link'});
      config.addIcon('open-link', { 'fontawesome': 'fa-external-link' });
      config.addLabel('link', {
        en: 'Link',
        de: 'Link'
      });
    }
  };

  var AnnotationTool$2 = require('../../ui/AnnotationTool');

  function LinkTool$1() {
    LinkTool$1.super.apply(this, arguments);
  }

  AnnotationTool$2.extend(LinkTool$1);
  LinkTool$1.static.name = 'link';

  module.exports = LinkTool$1;

  module.exports = require('./LinkHTMLConverter');

  var uuid$d = require('../../util/uuid');
  var annotationHelpers$6 = require('../../model/annotationHelpers');

  module.exports = function(tx, args) {
    var sel = args.selection;
    var containerId = args.containerId;
    if (!sel.isPropertySelection()) {
      throw new Error('Expected property selection.');
    }
    var path = sel.path;
    var offset = sel.startOffset;
    var node = tx.get(path[0]);
    // split the text property and create a new paragraph node with trailing text and annotations transferred
    var text = node.getText();
    var container = tx.get(containerId);
    var nodePos = container.getPosition(node.id);
    var newNode, nodeData, selNodeId;
    var insertPos = nodePos+1;
    // when breaking at the first position, a new node of the same
    // type will be inserted.
    if (text.length === 0) {
      var type = tx.getSchema().getDefaultTextType();
      nodeData = {
        type: type,
        content:''
      };
      newNode = tx.create(nodeData);
      container.hide(node.id);
      tx.delete(node.id);
      container.show(newNode.id, nodePos);
      selNodeId = newNode.id;
    } else {
      nodeData = node.toJSON();
      nodeData.id = uuid$d(node.type);
      if (offset === 0) {
        nodeData.content = '';
      } else {
        nodeData.content = text.substring(offset);
      }
      newNode = tx.create(nodeData);
      selNodeId = newNode.id;
      if (offset === 0) {
        // if selection is at the begin of line
        // we insert a new empty node above
        // and leave the cursor in the old node
        insertPos = nodePos;
        selNodeId = node.id;
      } else if (offset < text.length) {
        // transfer annotations which are after offset to the new node
        annotationHelpers$6.transferAnnotations(tx, path, offset, [newNode.id, 'content'], 0);
        // truncate the original property
        tx.update(path, {
          delete: { start: offset, end: text.length }
        });
      }
      container.show(newNode.id, insertPos);
    }
    sel = tx.createSelection([selNodeId, 'content'], 0);
    return {
      selection: sel,
      node: newNode
    };
  };

  var Component$2 = require('../../ui/Component');
  var ListHtmlConverter = require('./ListHTMLConverter');
  var ListItemComponent = require('./ListItemComponent');

  function ListComponent() {
    ListComponent.super.apply(this, arguments);
  }

  ListComponent.Prototype = function() {

    this.didMount = function() {
      this.doc = this.props.doc;
      this.doc.getEventProxy('path').on([this.props.node.id, 'items'], this.onItemsChanged, this);
    };

    this.dispose = function() {
      this.doc.getEventProxy('path').off(this);
      this.doc = null;
    };

    this.render = function($$) {
      return ListHtmlConverter.render(this.props.node, {
        createListElement: function(list) {
          var tagName = list.ordered ? 'ol' : 'ul';
          return $$(tagName)
            .attr('data-id', list.id)
            .addClass('sc-list');
        },
        renderListItem: function(item) {
          return $$(ListItemComponent, {node: item});
        }
      });
    };

    this.onItemsChanged = function() {
      this.rerender();
    };

  };

  Component$2.extend(ListComponent);

  module.exports = ListComponent;

  var breakList = require('./breakList');

  module.exports = {

    register: function(behavior) {
      behavior
        .defineBreak('list-item', breakList);
    }

  };

  var TextBlock$4 = require('../../model/TextBlock');

  function ListItem() {
    ListItem.super.apply(this, arguments);
  }

  TextBlock$4.extend(ListItem);

  ListItem.static.name = 'list-item';

  ListItem.static.defineSchema({
    listType: { type: 'string', default: 'unordered' },
    level: { type: 'number', default: 1 }
  });

  module.exports = ListItem;

  var Component$3 = require('../../ui/Component');
  var TextProperty = require('../../ui/TextPropertyComponent');

  function ListItemComponent$1() {
    ListItemComponent$1.super.apply(this, arguments);
  }

  ListItemComponent$1.Prototype = function() {

    this.render = function($$) {
      var node = this.props.node;
      var el = $$('div')
        .addClass('sc-list-item')
        .addClass('sm-' + node.listType)
        .attr('data-id', this.props.node.id)
        .append($$(TextProperty, {
          path: [ this.props.node.id, 'content']
        })
      );
      return el;
    };

  };

  Component$3.extend(ListItemComponent$1);

  module.exports = ListItemComponent$1;

  var switchTextType$1 = require('../../model/transform/switchTextType');
  var deleteSelection$5 = require('../../model/transform/deleteSelection');

  var ListMacro = {

    appliesTo: ['paragraph'],

    execute: function(props, context) {
      if (this.appliesTo.indexOf(props.node.type) === -1) {
        return false;
      }
      var match = /^\*\s/.exec(props.text);

      if (match) {
        var surface = context.surfaceManager.getSurface(props.selection.surfaceId);
        surface.transaction(function(tx, args) {
          var deleteSel = tx.createSelection(props.path, 0, match[0].length);
          deleteSelection$5(tx, {
            selection: deleteSel
          });
          var switchTextResult = switchTextType$1(tx, {
            selection: props.selection,
            containerId: args.containerId,
            data: {
              type: 'list-item'
            }
          });
          if (props.action === 'type') {
            return {
              selection: tx.createSelection(switchTextResult.node.getTextPath(), 0)
            };
          }
        });
        return true;
      }
    }

  };

  module.exports = ListMacro;

  var ListItem$1 = require('./ListItem');
  var ListItemComponent$2 = require('./ListItemComponent');
  var ListEditing = require('./ListEditing');
  var ListMacro$1 = require('./ListMacro');

  module.exports = {
    name: 'list-item',
    configure: function(config, options) {
      config.addNode(ListItem$1);
      config.addComponent(ListItem$1.static.name, ListItemComponent$2);
      config.addTextType({
        name: 'list-item',
        data: { type: 'list-item' }
      });
      config.addEditingBehavior(ListEditing);
      if (options.enableMacro) {
        config.addMacro(ListMacro$1);
      }
      config.addLabel('list', {
        en: 'List',
        de: 'Liste'
      });
      config.addLabel('list-item', {
        en: 'List',
        de: 'Liste'
      });
    }
  };

  var TextBlock$5 = require('../../model/TextBlock');

  function Paragraph() {
    Paragraph.super.apply(this, arguments);
  }

  TextBlock$5.extend(Paragraph);

  Paragraph.static.name = "paragraph";

  module.exports = Paragraph;

  var TextBlockComponent$3 = require('../../ui/TextBlockComponent');

  function ParagraphComponent() {
    ParagraphComponent.super.apply(this, arguments);
  }

  ParagraphComponent.Prototype = function() {

    var _super = ParagraphComponent.super.prototype;

    this.render = function($$) {
      var el = _super.render.call(this, $$);
      return el.addClass('sc-paragraph');
    };

  };

  TextBlockComponent$3.extend(ParagraphComponent);

  module.exports = ParagraphComponent;

  /*
   * HTML converter for Paragraph.
   */
  module.exports = {

    type: 'paragraph',
    tagName: 'p',

    import: function(el, node, converter) {
      node.content = converter.annotatedText(el, [node.id, 'content']);
    },

    export: function(node, el, converter) {
      el.append(converter.annotatedText([node.id, 'content']));
    }

  };

  var Paragraph$1 = require('./Paragraph');
  var ParagraphComponent$1 = require('./ParagraphComponent');
  var ParagraphHTMLConverter = require('./ParagraphHTMLConverter');

  module.exports = {
    name: 'paragraph',
    configure: function(config) {
      config.addNode(Paragraph$1);
      config.addComponent(Paragraph$1.static.name, ParagraphComponent$1);
      config.addConverter('html', ParagraphHTMLConverter);
      config.addTextType({
        name: 'paragraph',
        data: {type: 'paragraph'}
      });
      config.addLabel('paragraph', {
        en: 'Paragraph',
        de: 'Paragraph'
      });
      config.addLabel('paragraph.content', {
        en: 'Paragraph',
        de: 'Paragraph'
      });
    }
  };

  module.exports = require('./ParagraphHTMLConverter');

  module.exports = {
    name: 'persistence',
    configure: function(config) {
      config.addCommand(require('./SaveCommand'));
      config.addTool(require('./SaveTool'));
      // Icons
      config.addIcon('save', { 'fontawesome': 'fa-save' });
      // Labels
      config.addLabel('save', {
        en: 'Save',
        de: 'Speichern'
      });
    }
  };

  var Command$4 = require('../../ui/Command');

  function SaveCommand() {
    SaveCommand.super.apply(this, arguments);
  }

  SaveCommand.Prototype = function() {
    this.getCommandState = function(props, context) {
      var dirty = context.documentSession.isDirty();
      return {
        disabled: !dirty,
        active: false
      };
    };

    this.execute = function(props, context) {
      var documentSession = context.documentSession;
      documentSession.save();
      return {
        status: 'saving-process-started'
      };
    };
  };

  Command$4.extend(SaveCommand);
  SaveCommand.static.name = 'save';

  module.exports = SaveCommand;

  var Tool$4 = require('../../ui/Tool');

  function SaveTool() {
    SaveTool.super.apply(this, arguments);
  }

  Tool$4.extend(SaveTool);
  SaveTool.static.name = 'save';
  module.exports = SaveTool;

  var Document$2 = require('../../model/Document');

  function ProseArticle(schema) {
    Document$2.call(this, schema);
    this._initialize();
  }

  ProseArticle.Prototype = function() {

    this._initialize = function() {
      this.create({
        type: 'container',
        id: 'body',
        nodes: []
      });
    };

  };

  Document$2.extend(ProseArticle);

  module.exports = ProseArticle;

  var HTMLImporter$1 = require('../../model/HTMLImporter');
  var ProseArticle$1 = require('./ProseArticle');
  var schema = ProseArticle$1.schema;

  var converters = [
    require('../paragraph/ParagraphHTMLConverter'),
    require('../heading/HeadingHTMLConverter'),
    require('../codeblock/CodeBlockHTMLConverter'),
    require('../image/ImageHTMLConverter'),
    require('../strong/StrongHTMLConverter'),
    require('../emphasis/EmphasisHTMLConverter'),
    require('../link/LinkHTMLConverter'),
  ];

  function ProseArticleImporter() {
    ProseArticleImporter.super.call(this, {
      schema: schema,
      converters: converters,
      DocumentClass: ProseArticle$1
    });
  }

  ProseArticleImporter.Prototype = function() {
    /*
      Takes an HTML string.
    */
    this.convertDocument = function(bodyEls) {
      // Just to make sure we always get an array of elements
      if (!bodyEls.length) bodyEls = [bodyEls];
      this.convertContainer(bodyEls, 'body');
    };
  };

  HTMLImporter$1.extend(ProseArticleImporter);

  ProseArticleImporter.converters = converters;

  module.exports = ProseArticleImporter;

  var ContainerEditor = require('../../ui/ContainerEditor');
  var Component$4 = require('../../ui/Component');
  var SplitPane = require('../../ui/SplitPane');
  var ScrollPane = require('../../ui/ScrollPane');
  var ProseEditorOverlay = require('./ProseEditorOverlay');
  var CommandManager = require('../../ui/CommandManager');
  var SurfaceManager = require('../../ui/SurfaceManager');
  var MacroManager = require('../../ui/MacroManager');
  var GlobalEventHandler = require('../../ui/GlobalEventHandler');

  function ProseEditor() {
    ProseEditor.super.apply(this, arguments);
    this._initialize(this.props);
  }

  ProseEditor.Prototype = function() {

    this.didMount = function() {
      // this.refs.body.selectFirst();
      this.documentSession.on('didUpdate', this._documentSessionUpdated, this);
    };

    this.willReceiveProps = function(nextProps) {
      var newSession = nextProps.documentSession;
      var shouldDispose = newSession && newSession !== this.documentSession;
      if (shouldDispose) {
        this._dispose();
        this._initialize(nextProps);
      }
    };

    /**
      Is called when component life ends. If you need to implement dispose
      in your custom Controller class, don't forget the super call.
    */
    this.dispose = function() {
      this._dispose();
    };

    this._dispose = function() {
      this.surfaceManager.dispose();
      this.commandManager.dispose();
      this.globalEventHandler.dispose();
      this.documentSession.off(this);
      // Note: we need to clear everything, as the childContext
      // changes which is immutable
      this.empty();
    };

    this.willUpdateState = function(newState) {
      this.handleStateUpdate(newState);
    };

    this._initialize = function(props) {
      var configurator = props.configurator;
      var commands = configurator.getCommands();

      if (!props.documentSession) {
        throw new Error('DocumentSession instance required');
      }
      this.documentSession = props.documentSession;
      this.doc = this.documentSession.getDocument();

      this.saveHandler = configurator.getSaveHandler();
      this.documentSession.setSaveHandler(this.saveHandler);
      this.componentRegistry = configurator.getComponentRegistry();
      this.toolRegistry = configurator.getToolRegistry();
      this.surfaceManager = new SurfaceManager(this.documentSession);
      this.fileClient = configurator.getFileClient();
      this.commandManager = new CommandManager(this.getCommandContext(), commands);
      this.macroManager = new MacroManager(this.getMacroContext(), configurator.getMacros());
      this.iconProvider = configurator.getIconProvider();
      this.converterRegistry = configurator.getConverterRegistry();
      this.globalEventHandler = new GlobalEventHandler(this.documentSession, this.surfaceManager);
      this.editingBehavior = configurator.getEditingBehavior();
      this.labelProvider = configurator.getLabelProvider();
    };

    this.getCommandContext = function() {
      return {
        documentSession: this.documentSession,
        surfaceManager: this.surfaceManager,
        fileClient: this.fileClient,
        saveHandler: this.saveHandler,
        converterRegistry: this.converterRegistry
      };
    };

    this.getMacroContext = function() {
      return {
        documentSession: this.documentSession,
        surfaceManager: this.surfaceManager
      };
    };

    this.getChildContext = function() {
      return {
        controller: this,
        iconProvider: this.iconProvider,
        documentSession: this.documentSession,
        doc: this.doc, // TODO: remove in favor of documentSession
        componentRegistry: this.componentRegistry,
        surfaceManager: this.surfaceManager,
        commandManager: this.commandManager,
        toolRegistry: this.toolRegistry,
        labelProvider: this.labelProvider,
        converterRegistry: this.converterRegistry,
        globalEventHandler: this.globalEventHandler,
        editingBehavior: this.editingBehavior
      };
    };


    this._documentSessionUpdated = function() {
      var commandStates = this.commandManager.getCommandStates();
      this.refs.toolbar.setProps({
        commandStates: commandStates
      });
    };

    this.render = function($$) {
      var configurator = this.props.configurator;
      var commandStates = this.commandManager.getCommandStates();
      var ToolbarClass = configurator.getToolbarClass();

      return $$('div').addClass('sc-prose-editor').append(
        $$(SplitPane, {splitType: 'horizontal'}).append(
          $$(ToolbarClass, {
            commandStates: commandStates
          }).ref('toolbar'),
          $$(ScrollPane, {
            scrollbarType: 'substance',
            scrollbarPosition: 'right',
            overlay: ProseEditorOverlay,
          }).append(
            $$(ContainerEditor, {
              disabled: this.props.disabled,
              documentSession: this.documentSession,
              node: this.doc.get('body'),
              commands: configurator.getSurfaceCommandNames(),
              textTypes: configurator.getTextTypes()
            }).ref('body')
          ).ref('contentPanel')
        )
      );
    };
  };

  Component$4.extend(ProseEditor);

  module.exports = ProseEditor;

  var Component$5 = require('../../ui/Component');

  function ProseEditorOverlay$1() {
    Component$5.apply(this, arguments);
  }

  ProseEditorOverlay$1.Prototype = function() {

    this.render = function($$) {
      var el = $$('div').addClass('sc-prose-editor-overlay');
      var commandStates = this.props.commandStates;
      var toolRegistry = this.context.toolRegistry;

      toolRegistry.forEach(function(tool) {
        if (tool.options.overlay) {
          var toolProps = tool.Class.static.getProps(commandStates);
          if (toolProps) {
            el.append(
              $$(tool.Class, toolProps)
            );
          }
        }
      });
      return el;
    };
  };

  Component$5.extend(ProseEditorOverlay$1);

  module.exports = ProseEditorOverlay$1;

  // Base packages
  var BasePackage = require('../base/BasePackage');
  var ParagraphPackage = require('../paragraph/ParagraphPackage');
  var HeadingPackage = require('../heading/HeadingPackage');
  var CodeblockPackage = require('../codeblock/CodeblockPackage');
  var BlockquotePackage = require('../blockquote/BlockquotePackage');
  var ListPackage = require('../list/ListPackage');
  var LinkPackage = require('../link/LinkPackage');
  var EmphasisPackage = require('../emphasis/EmphasisPackage');
  var StrongPackage = require('../strong/StrongPackage');
  var CodePackage = require('../code/CodePackage');
  var SubscriptPackage = require('../subscript/SubscriptPackage');
  var SuperscriptPackage = require('../superscript/SuperscriptPackage');
  var ProseEditorToolbar = require('./ProseEditorToolbar');
  var Overlay = require('../../ui/Overlay');

  // Article Class
  var ProseArticle$2 = require('./ProseArticle');

  module.exports = {
    name: 'prose-editor',
    configure: function(config) {
      config.defineSchema({
        name: 'prose-article',
        ArticleClass: ProseArticle$2,
        defaultTextType: 'paragraph'
      });

      config.setToolbarClass(ProseEditorToolbar);
      config.addComponent('overlay', Overlay);

      // Now import base packages
      config.import(BasePackage);
      config.import(ParagraphPackage);
      config.import(HeadingPackage);
      config.import(CodeblockPackage);
      config.import(BlockquotePackage);
      config.import(ListPackage);
      config.import(EmphasisPackage);
      config.import(StrongPackage);
      config.import(SubscriptPackage);
      config.import(SuperscriptPackage);
      config.import(CodePackage);
      config.import(LinkPackage);
    }
  };

  var Component$6 = require('../../ui/Component');
  var ToolGroup = require('../../ui/ToolGroup');

  function ProseEditorToolbar$1() {
    Component$6.apply(this, arguments);
  }

  ProseEditorToolbar$1.Prototype = function() {

    this.render = function($$) {
      var el = $$("div").addClass('sc-prose-editor-toolbar');
      var commandStates = this.props.commandStates;
      var toolRegistry = this.context.toolRegistry;

      var tools = [];
      toolRegistry.forEach(function(tool, name) {
        if (!tool.options.overlay) {
          tools.push(
            $$(tool.Class, commandStates[name])
          );
        }
      });

      el.append(
        $$(ToolGroup).append(tools)
      );
      return el;
    };
  };

  Component$6.extend(ProseEditorToolbar$1);
  module.exports = ProseEditorToolbar$1;

  var PropertyAnnotation$6 = require('../../model/PropertyAnnotation');
  var Fragmenter$4 = require('../../model/Fragmenter');

  function Strong() {
    Strong.super.apply(this, arguments);
  }

  PropertyAnnotation$6.extend(Strong);

  Strong.static.name = "strong";

  // a hint that makes in case of overlapping annotations that this
  // annotation gets fragmented more often
  Strong.static.fragmentation = Fragmenter$4.ANY;

  module.exports = Strong;

  var AnnotationCommand$3 = require('../../ui/AnnotationCommand');

  function StrongCommand() {
    StrongCommand.super.apply(this, arguments);
  }

  AnnotationCommand$3.extend(StrongCommand);

  StrongCommand.static.name = 'strong';

  module.exports = StrongCommand;

  /*
   * HTML converter for Strong.
   */
  module.exports = {

    type: "strong",
    tagName: "strong",

    matchElement: function(el) {
      return el.is("strong, b");
    }

  };

  var Strong$1 = require('./Strong');
  var StrongTool = require('./StrongTool');
  var StrongCommand$1 = require('./StrongCommand');

  module.exports = {
    name: 'strong',
    configure: function(config) {
      config.addNode(Strong$1);
      config.addCommand(StrongCommand$1);
      config.addTool(StrongTool);
      config.addIcon(StrongCommand$1.static.name, { 'fontawesome': 'fa-bold' });

      config.addLabel('strong', {
        en: 'Strong emphasis',
        de: 'Starke Betonung'
      });
    }
  };

  var AnnotationTool$3 = require('../../ui/AnnotationTool');

  function StrongTool$1() {
    StrongTool$1.super.apply(this, arguments);
  }
  AnnotationTool$3.extend(StrongTool$1);

  StrongTool$1.static.name = 'strong';

  module.exports = StrongTool$1;

  module.exports = require('./StrongHTMLConverter');

  var PropertyAnnotation$7 = require('../../model/PropertyAnnotation');
  var Fragmenter$5 = require('../../model/Fragmenter');

  function Subscript() {
    Subscript.super.apply(this, arguments);
  }

  PropertyAnnotation$7.extend(Subscript);

  Subscript.static.name = 'subscript';

  // hint for rendering in presence of overlapping annotations
  Subscript.static.fragmentation = Fragmenter$5.ANY;

  module.exports = Subscript;

  var AnnotationCommand$4 = require('../../ui/AnnotationCommand');

  var SubscriptCommand = AnnotationCommand$4.extend();

  SubscriptCommand.static.name = 'subscript';

  module.exports = SubscriptCommand;

  /*
     HTML converter for Subscript.
  */
  module.exports = {
    type: 'subscript',
    tagName: 'sub',
  };

  var Subscript$1 = require('./Subscript');
  var SubscriptTool = require('./SubscriptTool');
  var SubscriptCommand$1 = require('./SubscriptCommand');

  module.exports = {
    name: 'subscript',
    configure: function(config) {
      config.addNode(Subscript$1);
      config.addCommand(SubscriptCommand$1);
      config.addTool(SubscriptTool);
      config.addIcon(SubscriptCommand$1.static.name, { 'fontawesome': 'fa-subscript' });
      config.addLabel('subscript', {
        en: 'Subscript',
        de: 'Tiefgestellt'
      });
    }
  };

  var AnnotationTool$4 = require('../../ui/AnnotationTool');

  function SubscriptTool$1() {
    SubscriptTool$1.super.apply(this, arguments);
  }
  AnnotationTool$4.extend(SubscriptTool$1);

  SubscriptTool$1.static.name = 'subscript';

  module.exports = SubscriptTool$1;

  module.exports = require('./SubscriptHTMLConverter');

  var PropertyAnnotation$8 = require('../../model/PropertyAnnotation');
  var Fragmenter$6 = require('../../model/Fragmenter');

  function Superscript() {
    Superscript.super.apply(this, arguments);
  }

  PropertyAnnotation$8.extend(Superscript);

  Superscript.static.name = 'superscript';

  // hint for rendering in presence of overlapping annotations
  Superscript.static.fragmentation = Fragmenter$6.ANY;

  module.exports = Superscript;

  var AnnotationCommand$5 = require('../../ui/AnnotationCommand');

  function SuperscriptCommand() {
    SuperscriptCommand.super.apply(this, arguments);
  }

  AnnotationCommand$5.extend(SuperscriptCommand);

  SuperscriptCommand.static.name = 'superscript';

  module.exports = SuperscriptCommand;

  /*
   * HTML converter for Blockquote.
   */
  module.exports = {
    type: 'superscript',
    tagName: 'sup',
  };

  var Superscript$1 = require('./Superscript');
  var SuperscriptTool = require('./SuperscriptTool');
  var SuperscriptCommand$1 = require('./SuperscriptCommand');

  module.exports = {
    name: 'superscript',
    configure: function(config) {
      config.addNode(Superscript$1);
      config.addCommand(SuperscriptCommand$1);
      config.addTool(SuperscriptTool);
      config.addIcon(SuperscriptCommand$1.static.name, { 'fontawesome': 'fa-superscript' });
      config.addLabel('superscript', {
        en: 'Superscript',
        de: 'Hochgestellt'
      });
    }
  };

  var AnnotationTool$5 = require('../../ui/AnnotationTool');

  function SuperscriptTool$1() {
    SuperscriptTool$1.super.apply(this, arguments);
  }
  AnnotationTool$5.extend(SuperscriptTool$1);

  SuperscriptTool$1.static.name = 'superscript';

  module.exports = SuperscriptTool$1;

  module.exports = require('./SubscriptHTMLConverter');

  var InsertNodeCommand = require('../../ui/InsertNodeCommand');
  var uuid$e = require('../../util/uuid');

  function InsertTableCommand() {
    InsertTableCommand.super.apply(this, arguments);
  }

  InsertTableCommand.Prototype = function() {

    this.createNodeData = function(tx, args) { // eslint-disable-line
      // TODO: make this configurable, e.g. via args
      var nrows = 5;
      var ncols = 6;
      var cells = [];

      for (var i = 0; i < nrows; i++) {
        var cols = [];
        for (var j = 0; j < ncols; j++) {
          var node = tx.create({id: uuid$e(), type: 'paragraph', content: ''});
          cols.push({content: node.id});
        }


        cells.push(cols);
      }

      return {
        type: 'table',
        cells: cells
      };
    };

  };

  InsertNodeCommand.extend(InsertTableCommand);

  InsertTableCommand.static.name = 'insert-table';

  module.exports = InsertTableCommand;

  var Tool$5 = require('../../ui/Tool');

  function InsertTableTool() {
    InsertTableTool.super.apply(this, arguments);
  }

  Tool$5.extend(InsertTableTool);

  InsertTableTool.static.name = 'insert-table';

  module.exports = InsertTableTool;

  var Component$7 = require('../../ui/Component');
  var CustomSelection$1 = require('../../model/CustomSelection');
  var DefaultDOMElement$4 = require('../../ui/DefaultDOMElement');
  var tableHelpers = require('./tableHelpers');
  var keys$1 = require('../../util/keys');
  var getRelativeBoundingRect = require('../../util/getRelativeBoundingRect');
  var TextCellContent = require('./TextCellContent');

  function TableComponent() {
    TableComponent.super.apply(this, arguments);

    if (this.context.surfaceParent) {
      this.surfaceId = this.context.surfaceParent.getId();
    } else {
      this.surfaceId = this.props.node.id;
    }

    this._selectedCells = {};
  }

  TableComponent.Prototype = function() {

    this.didMount = function() {
      var documentSession = this.getDocumentSession();
      documentSession.on('didUpdate', this.onSessionDidUpdate, this);

      var globalEventHandler = this.context.globalEventHandler;
      if (globalEventHandler) {
        globalEventHandler.on('keydown', this.onKeydown, this, { id: this.surfaceId });
      }
    };

    this.dispose = function() {
      var documentSession = this.getDocumentSession();
      documentSession.off(this);

      var globalEventHandler = this.context.globalEventHandler;
      if (globalEventHandler) {
        globalEventHandler.off(this);
      }
    };

    this.render = function($$) {
      var node = this.props.node;

      var el = $$('div').addClass('sc-table');

      var tableEl = $$('table');
      var cellEntries = node.cells;

      var nrows = node.getRowCount();
      var ncols = node.getColCount();
      var i,j;

      var thead = $$('thead').addClass('se-head');
      var colControls = $$('tr').addClass('se-column-controls');
      colControls.append($$('td').addClass('se-corner-tl'));
      colControls.append($$('td').addClass('se-hspace'));
      for (j = 0; j < ncols; j++) {
        colControls.append(
          $$('td').addClass('se-column-handle').attr('data-col', j).ref('col-handle'+j)
            .on('mousedown', this._onColumnHandle)
            .append(tableHelpers.getColumnName(j))
        );
      }
      colControls.append($$('td').addClass('se-hspace'));
      thead.append(colControls);
      thead.append($$('tr').addClass('se-vspace'));

      var tbody = $$('tbody').addClass('se-body').ref('body');
      for (i = 0; i < nrows; i++) {
        var row = cellEntries[i];
        var rowEl = $$('tr').addClass('se-row').attr('data-row', i);

        rowEl.append(
          $$('td').addClass('se-row-handle').attr('data-row', i).ref('row-handle'+i)
            .on('mousedown', this._onRowHandle)
            .append(tableHelpers.getRowName(i))
        );
        rowEl.append($$('td').addClass('se-hspace'));

        console.assert(row.length === ncols, 'row should be complete.');
        for (j = 0; j < ncols; j++) {
          var cellId = row[j];
          var cellEl = this.renderCell($$, cellId);
          cellEl.attr('data-col', j)
            .on('mousedown', this._onCell);
          rowEl.append(cellEl);
        }
        rowEl.append($$('td').addClass('se-hspace'));

        tbody.append(rowEl);
      }

      var tfoot = $$('tfoot').addClass('se-foot');
      tfoot.append($$('tr').addClass('se-vspace'));
      colControls = $$('tr').addClass('se-column-controls');
      colControls.append($$('td').addClass('se-corner-bl'));
      colControls.append($$('td').addClass('se-hspace'));
      for (j = 0; j < ncols; j++) {
        colControls.append($$('td').addClass('se-hspace'));
      }
      colControls.append($$('td').addClass('se-hspace'));
      tfoot.append(colControls);

      tableEl.append(thead);
      tableEl.append(tbody);
      tableEl.append(tfoot);

      el.append(tableEl);

      // selection as an overlay
      el.append(
        $$('div').addClass('se-selection').ref('selection')
          .on('mousedown', this._whenClickingOnSelection)
      );

      return el;
    };

    this.renderCell = function($$, cellId) {
      var cellEl = $$('td').addClass('se-cell');
      var doc = this.props.node.getDocument();
      var cellContent = doc.get(cellId);
      if (cellContent) {
        // TODO: we need to derive disabled state
        // 1. if table is disabled all cells are disabled
        // 2. if sel is TableSelection then cell is disabled if not in table selection range
        // 3. else cell is disabled if not focused/co-focused
        cellEl.append(
          $$(TextCellContent, {
            disabled: !this._selectedCells[cellId],
            node: cellContent,
          }).ref(cellId)
        );
      }

      return cellEl;
    };

    this.getId = function() {
      return this.surfaceId;
    };

    this.getDocumentSession = function() {
      return this.context.documentSession;
    };

    this.getSelection = function() {
      var documentSession = this.getDocumentSession();
      var sel = documentSession.getSelection();
      if (sel && sel.isCustomSelection() && sel.getCustomType() === 'table' && sel.surfaceId === this.getId()) {
        return sel;
      } else {
        return null;
      }
    };

    this._setSelection = function(startRow, startCol, endRow, endCol) {
      var documentSession = this.getDocumentSession();
      documentSession.setSelection(new CustomSelection$1('table', {
        startRow: startRow, startCol: startCol,
        endRow: endRow, endCol: endCol
      }, this.getId()));
    };

    this.onSessionDidUpdate = function(update) {
      if (update.selection) {
        var sel = this.getSelection();
        this._selectedCells = {};
        if (sel) {
          var rect = this._getRectangle(sel);
          for(var i=rect.minRow; i<=rect.maxRow; i++) {
            for(var j=rect.minCol; j<=rect.maxCol; j++) {
              var cellId = this.props.node.cells[i][j];
              this._selectedCells[cellId] = true;
            }
          }
          this._renderSelection(sel);
        }
      }
    };

    this.onKeydown = function(e) {
      var handled = false;
      switch (e.keyCode) {
        case keys$1.LEFT:
          this._changeSelection(0, -1, e.shiftKey);
          handled = true;
          break;
        case keys$1.RIGHT:
          this._changeSelection(0, 1, e.shiftKey);
          handled = true;
          break;
        case keys$1.DOWN:
          this._changeSelection(1, 0, e.shiftKey);
          handled = true;
          break;
        case keys$1.UP:
          this._changeSelection(-1, 0, e.shiftKey);
          handled = true;
          break;
        default:
          // nothing
      }
      if (handled) {
        e.preventDefault();
      }
    };

    this._onColumnHandle = function(e) {
      e.stopPropagation();
      e.preventDefault();
      var el = DefaultDOMElement$4.wrapNativeElement(e.currentTarget);
      var col = parseInt(el.attr('data-col'), 10);
      var rowCount = this.props.node.getRowCount();
      this._setSelection(0, col, rowCount-1, col);
    };

    this._onRowHandle = function(e) {
      e.stopPropagation();
      e.preventDefault();
      var el = DefaultDOMElement$4.wrapNativeElement(e.currentTarget);
      var row = parseInt(el.attr('data-row'), 10);
      var colCount = this.props.node.getColCount();
      this._setSelection(row, 0, row, colCount-1);
    };

    this._onCell = function(e) {
      e.stopPropagation();
      e.preventDefault();

      var el = DefaultDOMElement$4.wrapNativeElement(e.currentTarget);
      var col = parseInt(el.attr('data-col'), 10);
      var row = parseInt(el.parentNode.attr('data-row'), 10);

      this._setSelection(row, col, row, col);
    };

    this._changeSelection = function(rowInc, colInc, expand) {
      var sel = this.getSelection();
      if (sel) {
        var maxRow = this.props.node.getRowCount()-1;
        var maxCol = this.props.node.getColCount()-1;
        if (expand) {
          var endRow = Math.max(0, Math.min(sel.data.endRow + rowInc, maxRow));
          var endCol = Math.max(0, Math.min(sel.data.endCol + colInc, maxCol));
          this._setSelection(sel.data.startRow, sel.data.startCol, endRow, endCol);
        } else {
          var row = Math.max(0, Math.min(sel.data.endRow + rowInc, maxRow));
          var col = Math.max(0, Math.min(sel.data.endCol + colInc, maxCol));
          this._setSelection(row, col, row, col);
        }
      }
    };

    this._getRectangle = function(sel) {
      return {
        minRow: Math.min(sel.data.startRow, sel.data.endRow),
        maxRow: Math.max(sel.data.startRow, sel.data.endRow),
        minCol: Math.min(sel.data.startCol, sel.data.endCol),
        maxCol: Math.max(sel.data.startCol, sel.data.endCol)
      };
    };

    this._renderSelection = function() {
      var sel = this.getSelection();
      if (!sel) return;

      var rect = this._getRectangle(sel);

      var startCell = this._getCell(rect.minRow, rect.minCol);
      var endCell = this._getCell(rect.maxRow, rect.maxCol);

      var startEl = startCell.getNativeElement();
      var endEl = endCell.getNativeElement();
      var tableEl = this.el.el;
      // Get the  bounding rect for startEl, endEl relative to tableEl
      var selRect = getRelativeBoundingRect([startEl, endEl], tableEl);
      this.refs.selection.css(selRect).addClass('sm-visible');
      this._enableCells();
    };

    this._enableCells = function() {
      var node = this.props.node;
      for(var i=0; i<node.cells.length; i++) {
        var row = node.cells[i];
        for(var j=0; j<row.length; j++) {
          var cellId = row[j];
          var cell = this._getCell(i, j).getChildAt(0);
          if (this._selectedCells[cellId]) {
            cell.extendProps({ disabled: false });
          } else {
            cell.extendProps({ disabled: true });
          }
        }
      }
    };

    this._getCell = function(row, col) {
      var rowEl = this.refs.body.getChildAt(row);
      // +2 because we have a row handle plus a spacer cell
      var cellEl = rowEl.getChildAt(col + 2);
      return cellEl;
    };

    this._whenClickingOnSelection = function(e) { //eslint-disable-line
      // HACK: invalidating the selection so that we can click the selection overlay away
      this.context.documentSession.setSelection(new CustomSelection$1('null', {}, this.getId()));
      this.refs.selection.css({
        height: '0px', width: '0px'
      }).removeClass('sm-visible');
    };
  };

  Component$7.extend(TableComponent);

  module.exports = TableComponent;

  var isNumber$b = require('lodash/isNumber');

  var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  function getColumnName(col) {
    if (!isNumber$b(col)) {
      throw new Error('Illegal argument.');
    }
    var name = "";
    while(col >= 0) {
      var mod = col % ALPHABET.length;
      col = Math.floor(col/ALPHABET.length);
      name = ALPHABET[mod] + name;
      if (col > 0) col--;
      else break;
    }
    return name;
  }

  function getRowName(idx) {
    return String(idx+1);
  }

  function getColumnIndex(colStr) {
    var index = 0;
    var rank = 1;
    for (var i = 0; i < colStr.length; i++) {
      var letter = colStr[i];
      index += rank * ALPHABET.indexOf(letter);
      rank++;
    }
    return index;
  }

  function getCellId(row,col) {
    return getColumnName(col)+(row+1);
  }

  function getRowColFromId(id) {
    var match = /^([A-Z]+)([1-9][0-9]*)$/.exec(id);
    return [
      parseInt(match[2], 10)-1,
      getColumnIndex(match[1])
    ];
  }

  module.exports = {
    getColumnName: getColumnName,
    getRowName: getRowName,
    getColumnIndex: getColumnIndex,
    getCellId: getCellId,
    getRowColFromId: getRowColFromId
  };

  var BlockNode$2 = require('../../model/BlockNode');

  function TableNode() {
    TableNode.super.apply(this, arguments);
  }

  TableNode.Prototype = function() {

    this.getRowCount = function() {
      return this.cells.length;
    };

    this.getColCount = function() {
      if (this.cells.length > 0) {
        return this.cells[0].length;
      } else {
        return 0;
      }
    };

  };

  BlockNode$2.extend(TableNode);

  TableNode.static.name = "table";

  TableNode.static.defineSchema({
    // HACK: very low-levelish schema, where the objects will be entries
    // like `{ content: 'p1'}` plus maybe some more meta such as `cellType`
    // TODO: refine when we know exactly what we need
    "cells": { type: ['array', 'array', 'id'], default: [] }
  });

  module.exports = TableNode;

  var TableNode$1 = require('./TableNode');
  var TableComponent$1 = require('./TableComponent');
  var InsertTableCommand$1 = require('./InsertTableCommand');
  var InsertTableTool$1 = require('./InsertTableTool');

  module.exports = {
    name: 'table',
    configure: function(config) {
      config.addNode(TableNode$1);
      config.addComponent(TableNode$1.static.name, TableComponent$1);
      config.addCommand(InsertTableCommand$1);
      config.addTool(InsertTableTool$1);
      config.addIcon(InsertTableCommand$1.static.name, { 'fontawesome': 'fa-table' } );
      config.addLabel('table', {
        en: 'Table',
        de: 'Tabelle'
      });
    }
  };

  var Component$8 = require('../../ui/Component');
  var TextPropertyEditor = require('../../ui/TextPropertyEditor');

  function TextCellContent$1() {
    TextCellContent$1.super.apply(this, arguments);
  }

  TextCellContent$1.Prototype = function() {

    this.render = function($$) {
      var el = $$('div').addClass('sc-text-cell');

      var path;
      if (this.props.node) {
        path = this.props.node.getTextPath();
      } else {
        path = this.props.path;
      }

      el.append($$(TextPropertyEditor, {
        path: path,
        disabled: this.props.disabled
      }).ref('editor'));

      return el;
    };

  };

  Component$8.extend(TextCellContent$1);

  module.exports = TextCellContent$1;

  var Fragmenter$7 = require('../model/Fragmenter');
  var Component$9 = require('./Component');
  var AnnotationComponent$1 = require('./AnnotationComponent');
  var InlineNodeComponent = require('./InlineNodeComponent');

  /**
    Renders an anotated text. Used internally by {@link ui/TextPropertyComponent}.

    @class
    @component
    @extends ui/Component
  */

  function AnnotatedTextComponent() {
    AnnotatedTextComponent.super.apply(this, arguments);
  }

  AnnotatedTextComponent.Prototype = function() {

    // TODO: this component should listen on changes to the property
    // Otherwise will not be updated.
    // Note that in contrast, TextPropertyComponents get updated by Surface.

    /**
      Node render implementation. Use model/Fragmenter for rendering of annotations.

      @return {VirtualNode} VirtualNode created using ui/Component
     */
    this.render = function($$) {
      var el = this._renderContent($$)
        .addClass('sc-annotated-text')
        .css({
          whiteSpace: "pre-wrap"
        });
      return el;
    };

    this.getText = function() {
      return this.props.text;
    };

    this.getAnnotations = function() {
      return this.props.annotations || [];
    };

    this._renderContent = function($$) {
      var text = this.getText();
      var annotations = this.getAnnotations();
      var el = $$(this.props.tagName || 'span');
      var fragmenter = new Fragmenter$7({
        onText: this._renderTextNode.bind(this),
        onEnter: this._renderFragment.bind(this, $$),
        onExit: this._finishFragment.bind(this)
      });
      fragmenter.start(el, text, annotations);
      return el;
    };

    this._renderTextNode = function(context, text) {
      if (text && text.length > 0) {
        context.append(text);
      }
    };

    this._renderFragment = function($$, fragment) {
      var doc = this.getDocument();
      var componentRegistry = this.getComponentRegistry();
      var node = fragment.node;
      if (node.type === "container-annotation-fragment") {
        return $$(AnnotationComponent$1, { doc: doc, node: node })
          .addClass("se-annotation-fragment")
          .addClass(node.anno.getTypeNames().join(' ').replace(/_/g, "-"));
      } else if (node.type === "container-annotation-anchor") {
        return $$(AnnotationComponent$1, { doc: doc, node: node })
          .addClass("se-anchor")
          .addClass(node.anno.getTypeNames().join(' ').replace(/_/g, "-"))
          .addClass(node.isStart?"start-anchor":"end-anchor");
      }
      var ComponentClass;
      if (node.constructor.static.isInline) {
        ComponentClass = InlineNodeComponent;
      } else {
        ComponentClass = componentRegistry.get(node.type);
        if (!ComponentClass) {
          // console.warn('No component registered for type %s. Using AnnotationComponent.', node.type);
          ComponentClass = AnnotationComponent$1;
        }
      }
      var el = $$(ComponentClass, { doc: doc, node: node });
      return el;
    };

    this._finishFragment = function(fragment, context, parentContext) {
      parentContext.append(context);
    };

    /**
      Gets document instance.

      @return {Document} The document instance
     */
    this.getDocument = function() {
      return this.props.doc || this.context.doc;
    };

    this.getComponentRegistry = function() {
      return this.props.componentRegistry || this.context.componentRegistry;
    };

  };

  Component$9.extend(AnnotatedTextComponent);

  module.exports = AnnotatedTextComponent;

  var Command$5 = require('./Command');
  var createAnnotation$3 = require('../model/transform/createAnnotation');
  var fuseAnnotation$1 = require('../model/transform/fuseAnnotation');
  var expandAnnotation$1 = require('../model/transform/expandAnnotation');
  var truncateAnnotation$1 = require('../model/transform/truncateAnnotation');

  /**
    A class for commands intended to be executed on the annotations.
    See the example below to learn how to define a custom `AnnotationCommand`.

    @class
    @extends ui/Command

    @example

    ```js
    var AnnotationCommand = require('substance/ui/AnnotationCommand');

    function SmallCapsCommand() {
      SmallCaps.super.apply(this, arguments);
    }

    var SmallCapsCommand = AnnotationCommand.extend();

    SmallCapsCommand.static.name = 'smallcaps';
    ```
  */
  function AnnotationCommand$6() {
    Command$5.call(this);
  }

  AnnotationCommand$6.Prototype = function() {

    /**
      Get the type of an annotation.

      @returns {String} The annotation's type.
     */
    this.getAnnotationType = function() {
      // Note: AnnotationCommand.static.annotationType is only necessary if
      // it is different to Annotation.static.name
      var annotationType = this.constructor.static.annotationType || this.constructor.static.name;
      if (annotationType) {
        return annotationType;
      } else {
        throw new Error('Contract: AnnotationCommand.static.annotationType should be associated to a document annotation type.');
      }
    };

    /**
      Get the annotation's data.

      @returns {Object} The annotation's data.
     */
    this.getAnnotationData = function() {
      return {};
    };

    /**
      Checks if command couldn't be executed with current selection.

      @param {Array} annos annotations
      @param {Object} sel selection

      @returns {Boolean} Whether or not command could be executed.
     */
    this.isDisabled = function(sel) {
      // TODO: Container selections should be valid if the annotation type
      // is a container annotation. Currently we only allow property selections.
      if (!sel || sel.isNull() || !sel.isAttached() || sel.isCustomSelection()||
          sel.isNodeSelection() || sel.isContainerSelection()) {
        return true;
      }
      return false;
    };

    // Not implemented by default
    this.canEdit = function(annos, sel) { // eslint-disable-line
      return false;
    };

    /**
      Checks if new annotations could be created.
      There should be no annotation overlapping, selection must be not collapsed.

      @param {Array} annos annotations
      @param {Object} sel selection

      @returns {Boolean} Whether or not annotation could be created.
     */
    // When there's no existing annotation overlapping, we create a new one.
    this.canCreate = function(annos, sel) {
      return (annos.length === 0 && !sel.isCollapsed());
    };

    /**
      Checks if annotations could be fused.
      There should be more than one annotation overlaped by current selection.

      @param {Array} annos annotations
      @param {Object} sel selection

      @returns {Boolean} Whether or not annotations could be fused.
     */
    // When more than one annotation overlaps with the current selection
    this.canFuse = function(annos, sel) {
      return (annos.length >= 2 && !sel.isCollapsed());
    };

    /**
      Checks if annotation could be deleted.
      Cursor or selection must be inside an existing annotation.

      @param {Array} annos annotations
      @param {Object} sel selection

      @returns {Boolean} Whether or not annotation could be deleted.
     */
    // When the cursor or selection is inside an existing annotation
    this.canDelete = function(annos, sel) {
      if (annos.length !== 1) return false;
      var annoSel = annos[0].getSelection();
      return sel.isInsideOf(annoSel);
    };

    /**
      Checks if annotation could be expanded.
      There should be overlap with only a single annotation,
      selection should be also outside of this annotation.

      @param {Array} annos annotations
      @param {Object} sel selection

      @returns {Boolean} Whether or not annotation could be expanded.
     */
    // When there's some overlap with only a single annotation we do an expand
    this.canExpand = function(annos, sel) {
      if (annos.length !== 1) return false;
      var annoSel = annos[0].getSelection();
      return sel.overlaps(annoSel) && !sel.isInsideOf(annoSel);
    };

    /**
      Checks if annotation could be truncated.
      There should be overlap with only a single annotation,
      selection should also have boundary in common with this annotation.

      @param {Array} annos annotations
      @param {Object} sel selection

      @returns {Boolean} Whether or not annotation could be truncated.
     */
    this.canTruncate = function(annos, sel) {
      if (annos.length !== 1) return false;
      var annoSel = annos[0].getSelection();

      return (sel.isLeftAlignedWith(annoSel) || sel.isRightAlignedWith(annoSel)) &&
             !sel.contains(annoSel) &&
             !sel.isCollapsed();
    };

    /**
      Gets command state object.

      @param {Object} state.selection the current selection
      @returns {Object} info object with command details.
    */
    this.getCommandState = function(props, context) { // eslint-disable-line
      context = context || {};
      var sel = this._getSelection(props);
      // We can skip all checking if a disabled condition is met
      // E.g. we don't allow toggling of property annotations when current
      // selection is a container selection
      if (this.isDisabled(sel)) {
        return {
          disabled: true
        };
      }
      var annos = this._getAnnotationsForSelection(props, context);
      var newState = {
        disabled: false,
        active: false,
        mode: null
      };
      if (this.canCreate(annos, sel)) {
        newState.mode = "create";
      } else if (this.canFuse(annos, sel)) {
        newState.mode = "fusion";
      } else if (this.canTruncate(annos, sel)) {
        newState.active = true;
        newState.mode = "truncate";
      } else if (this.canExpand(annos, sel)) {
        newState.mode = "expand";
      } else if (this.canEdit(annos, sel)) {
        newState.mode = "edit";
        newState.node = annos[0];
        newState.active = true;
      } else if (this.canDelete(annos, sel)) {
        newState.active = true;
        newState.mode = "delete";
      } else {
        newState.disabled = true;
      }
      return newState;
    };

    /**
      Execute command and trigger transformation.

      @returns {Object} info object with execution details.
    */
    // Execute command and trigger transformations
    this.execute = function(props, context) {
      props = props || {};
      props.selection = this._getSelection(props);
      if (props.disabled) return false;
      var mode = props.mode;
      switch(mode) {
        case 'create':
          return this.executeCreate(props, context);
        case 'fuse':
          return this.executeFuse(props, context);
        case 'truncate':
          return this.executeTruncate(props, context);
        case 'expand':
          return this.executeExpand(props, context);
        case 'edit':
          return this.executeEdit(props, context);
        case 'delete':
          return this.executeDelete(props, context);
        default:
          console.warn('Command.execute(): unknown mode', mode);
          return false;
      }
    };

    this.executeCreate = function(props, context) {
      var annos = this._getAnnotationsForSelection(props, context);
      this._checkPrecondition(props, context, annos, this.canCreate);
      var newAnno = this._applyTransform(props, context, function(tx) {
        props.node = this.getAnnotationData();
        props.node.type = this.getAnnotationType();
        return createAnnotation$3(tx, props);
      }.bind(this));
      return {
        mode: 'create',
        anno: newAnno
      };
    };

    this.executeFuse = function(props, context) {
      var annos = this._getAnnotationsForSelection(props, context);
      this._checkPrecondition(props, context, annos, this.canFuse);
      var fusedAnno = this._applyTransform(props, context, function(tx) {
        var result = fuseAnnotation$1(tx, {
          annos: annos
        });
        return {
          result: result.node
        };
      });
      return {
        mode: 'fuse',
        anno: fusedAnno
      };
    };

    this.executeTruncate = function(props, context) {
      var annos = this._getAnnotationsForSelection(props, context);
      var anno = annos[0];
      this._checkPrecondition(props, context, annos, this.canTruncate);
      this._applyTransform(props, context, function(tx) {
        return truncateAnnotation$1(tx, {
          selection: props.selection,
          anno: anno
        });
      });
      return {
        mode: 'truncate',
        anno: anno
      };
    };

    this.executeExpand = function(props, context) {
      var annos = this._getAnnotationsForSelection(props, context);
      var anno = annos[0];
      this._checkPrecondition(props, context, annos, this.canExpand);
      this._applyTransform(props, context, function(tx) {
        expandAnnotation$1(tx, {
          selection: props.selection,
          anno: anno
        });
      });
      return {
        mode: 'expand',
        anno: anno
      };
    };

    // TODO: do we still need this?
    this.executeEdit = function(props, context) { // eslint-disable-line
      var annos = this._getAnnotationsForSelection(props, context);
      this._checkPrecondition(props, context, annos, this.canEdit);
      return {
        mode: "edit",
        anno: annos[0],
        readyOnly: true
      };
    };

    this.executeDelete = function(props, context) {
      var annos = this._getAnnotationsForSelection(props, context);
      var anno = annos[0];
      this._checkPrecondition(props, context, annos, this.canDelete);
      this._applyTransform(props, context, function(tx) {
        return tx.delete(anno.id);
      });
      return {
        mode: 'delete',
        annoId: anno.id
      };
    };

    this._checkPrecondition = function(props, context, annos, checker) {
      var sel = this._getSelection(props);
      if (!checker.call(this, annos, sel)) {
        throw new Error("AnnotationCommand: can't execute command for selection " + sel.toString());
      }
    };

    this._getAnnotationsForSelection = function(props) {
      return props.selectionState.getAnnotationsForType(this.getAnnotationType());
    };

    /**
      Apply an annotation transformation.

      @returns {Object} transformed annotations.
     */
    // Helper to trigger an annotation transformation
    this._applyTransform = function(props, context, transformFn) {
      // HACK: this looks a bit too flexible. Maybe we want to go for
      var sel = this._getSelection(props);
      var documentSession = this._getDocumentSession(props, context);
      var surface = props.surface;
      props.selection = sel;

      var result; // to store transform result
      if (sel.isNull()) return;
      documentSession.transaction(function(tx) {
        tx.before.selection = sel;
        if (surface) {
          tx.before.surfaceId = surface.getId();
        }
        var out = transformFn(tx, props);
        if (out) {
          result = out.result;
        }
        return out;
      });
      return result;
    };

  };

  Command$5.extend(AnnotationCommand$6);

  module.exports = AnnotationCommand$6;

  var Component$a = require('./Component');

  /**
    Renders an annotation. Used internally by different components (e.g. ui/AnnotatedTextComponent)

    @class
    @component
    @extends ui/Component

    @prop {Object} doc document
    @prop {Object} node node which describes annotation

    @example

    ```js
    $$(AnnotationComponent, {
      doc: doc,
      node: node
    })
    ```
  */

  function AnnotationComponent$2() {
    Component$a.apply(this, arguments);
  }

  AnnotationComponent$2.Prototype = function() {

    // TODO: we should avoid to have a didMount hook on an abstract base class
    this.didMount = function() {
      var node = this.props.node;
      node.on('highlighted', this.onHighlightedChanged, this);
    };

    // TODO: we should avoid to have a didMount hook on an abstract base class
    this.dispose = function() {
      var node = this.props.node;
      node.off(this);
    };

    this.render = function($$) {
      var el = $$('span')
        .attr("data-id", this.props.node.id)
        .addClass(this.getClassNames());
      if (this.props.node.highlighted) {
        el.addClass('sm-highlighted');
      }
      el.append(this.props.children);
      return el;
    };

    this.getClassNames = function() {
      return 'sc-'+this.props.node.type;
    };

    this.onHighlightedChanged = function() {
      if (this.props.node.highlighted) {
        this.el.addClass('sm-highlighted');
      } else {
        this.el.removeClass('sm-highlighted');
      }
    };
  };

  Component$a.extend(AnnotationComponent$2);

  module.exports = AnnotationComponent$2;

  var Tool$6 = require('./Tool');

  /*
   * Abstract class for annotation tools like StrongTool, EmphasisTool, LinkTool.
   *
   * @component
   */

  function AnnotationTool$6() {
    Tool$6.apply(this, arguments);
  }

  AnnotationTool$6.Prototype = function() {
    var _super = AnnotationTool$6.super.prototype;

    this.render = function($$) {
      var el = _super.render.call(this, $$);
      el.addClass('sm-annotation-tool');
      return el;
    };

    this.renderButton = function($$) {
      var el = _super.renderButton.call(this, $$);
      el.append(this.renderMode($$));  
      return el;
    };

    /*
      Renders a small hint for the mode (expand, truncate, edit, etc)
    */
    this.renderMode = function($$) {
      var mode = this.props.mode;
      var el = $$('div').addClass('se-mode');

      var iconEl = this.context.iconProvider.renderIcon($$, mode);
      if (iconEl) {
        el.append(iconEl);
      }
      
      return el;
    };
  };

  Tool$6.extend(AnnotationTool$6);
  module.exports = AnnotationTool$6;

  var NodeComponent = require('./NodeComponent');

  function BlockNodeComponent$2() {
    BlockNodeComponent$2.super.apply(this, arguments);
  }

  BlockNodeComponent$2.Prototype = function() {
    // maybe someday we need some BlockNode specific rendering
  };

  NodeComponent.extend(BlockNodeComponent$2);

  module.exports = BlockNodeComponent$2;

  var isString$g = require('lodash/isString');
  var isNumber$c = require('lodash/isNumber');
  var oo$s = require('../util/oo');
  var DOMElement = require('./DOMElement');
  var DelegatedEvent = require('./DelegatedEvent');

  var elProto = window.Element.prototype;
  var matches = (
    elProto.matches || elProto.matchesSelector ||
    elProto.msMatchesSelector || elProto.webkitMatchesSelector
  );

  function BrowserDOMElement(el) {
    console.assert(el instanceof window.Node, "Expecting native DOM node.");
    this.el = el;
    el._wrapper = this;
    this.eventListeners = [];
    this.htmlProps = {};
  }

  BrowserDOMElement.Prototype = function() {

    this._isBrowserDOMElement = true;

    this.getNativeElement = function() {
      return this.el;
    };

    this.hasClass = function(className) {
      return this.el.classList.contains(className);
    };

    this.addClass = function(className) {
      this.el.classList.add(className);
      return this;
    };

    this.removeClass = function(className) {
      this.el.classList.remove(className);
      return this;
    };

    this.getClasses = function() {
      return this.el.className;
    };

    this.setClasses = function(classString) {
      this.el.className = classString;
      return this;
    };

    this.getAttribute = function(name) {
      return this.el.getAttribute(name);
    };

    this.setAttribute = function(name, value) {
      this.el.setAttribute(name, value);
      return this;
    };

    this.removeAttribute = function(name) {
      this.el.removeAttribute(name);
      return this;
    };

    this.getAttributes = function() {
      var result = {};
      var attributes = this.el.attributes;
      var l = attributes.length;
      for(var i=0; i < l; i++) {
        var attr = attributes.item(i);
        result[attr.name] = attr.value;
      }
      return result;
    };

    this.getProperty = function(name) {
      return this.el[name];
    };

    this.setProperty = function(name, value) {
      this.htmlProps[name] = value;
      this.el[name] = value;
      return this;
    };

    this.removeProperty = function(name) {
      delete this.htmlProps[name];
      delete this.el[name];
      return this;
    };

    this.getTagName = function() {
      if (this.el.tagName) {
        return this.el.tagName.toLowerCase();
      }
    };

    this.setTagName = function(tagName) {
      var newEl = BrowserDOMElement.createElement(tagName);
      var attributes = this.el.attributes;
      var l = attributes.length;
      var i;
      for(i = 0; i < l; i++) {
        var attr = attributes.item(i);
        newEl.setAttribute(attr.name, attr.value);
      }
      for (var key in this.htmlProps) {
        if (this.htmlProps.hasOwnProperty(key)) {
          newEl[key] = this.htmlProps[key];
        }
      }
      this.eventListeners.forEach(function(listener) {
        newEl.addEventListener(listener.eventName, listener.handler, listener.capture);
      });
      this._replaceNativeEl(newEl);
      return this;
    };

    this.getId = function() {
      return this.el.id;
    };

    this.setId = function(id) {
      this.el.id = id;
      return this;
    };

    this.getValue = function() {
      return this.el.value;
    };

    this.setValue = function(value) {
      this.el.value = value;
      return this;
    };

    this.getStyle = function(name) {
      // NOTE: important to provide computed style, otherwise we don't get inherited styles
      var style = this.getComputedStyle();
      return style[name] || this.el.style[name];
    };

    this.getComputedStyle = function() {
      return window.getComputedStyle(this.el);
    };

    var _pxStyles = {
      top: true,
      bottom: true,
      left: true,
      right: true,
      height: true,
      width: true
    };

    this.setStyle = function(name, value) {
      if (_pxStyles[name] && isNumber$c(value)) {
        value = value + "px";
      }
      this.el.style[name] = value;
      return this;
    };

    this.getTextContent = function() {
      return this.el.textContent;
    };

    this.setTextContent = function(text) {
      this.el.textContent = text;
      return this;
    };

    this.getInnerHTML = function() {
      var innerHTML = this.el.innerHTML;
      if (!isString$g(innerHTML)) {
        var frag = this.el.ownerDocument.createDocumentFragment();
        for (var c = this.el.firstChild; c; c = c.nextSibling) {
          frag.appendChild(c.cloneNode(true));
        }
        var xs = new window.XMLSerializer();
        innerHTML = xs.serializeToString(frag);
      }
      return innerHTML;
    };

    this.setInnerHTML = function(html) {
      this.el.innerHTML = html;
      return this;
    };

    this.getOuterHTML = function() {
      var outerHTML = this.el.outerHTML;
      if (!isString$g(outerHTML)) {
        var xs = new window.XMLSerializer();
        outerHTML = xs.serializeToString(this.el);
      }
      return outerHTML;
    };

    this.addEventListener = function(eventName, handler, options) {
      var listener;
      if (arguments.length === 1 && arguments[0]) {
        listener = arguments[0];
      } else {
        listener = new DOMElement.EventListener(eventName, handler, options);
      }
      if (listener.options.selector && !listener.__hasEventDelegation__) {
        listener.handler = this._delegatedHandler(listener);
        listener.__hasEventDelegation__ = true;
      }
      this.el.addEventListener(listener.eventName, listener.handler, listener.capture);
      listener._el = this;
      this.eventListeners.push(listener);
      return this;
    };

    this._delegatedHandler = function(listener) {
      var handler = listener.handler;
      var context = listener.context;
      var selector = listener.options.selector;
      var nativeTop = this.getNativeElement();
      return function(event) {
        var nativeEl = event.target;
        while(nativeEl) {
          if (matches.call(nativeEl, selector)) {
            handler(new DelegatedEvent(context, event.target, event));
            break;
          }
          if (nativeEl === nativeTop) {
            break;
          }
          nativeEl = nativeEl.parentNode;
        }
      };
    };

    this.removeEventListener = function(eventName, handler) {
      // console.log('removing event listener', eventName, handler);
      var listener = null, idx = -1;
      idx = DOMElement._findEventListenerIndex(this.eventListeners, eventName, handler);
      listener = this.eventListeners[idx];
      if (idx > -1) {
        this.eventListeners.splice(idx, 1);
        // console.log('BrowserDOMElement.removeEventListener:', eventName, this.eventListeners.length);
        listener._el = null;
        this.el.removeEventListener(listener.eventName, listener.handler);
      }
      return this;
    };

    this.removeAllEventListeners = function() {
      for (var i = 0; i < this.eventListeners.length; i++) {
        var listener = this.eventListeners[i];
        // console.log('BrowserDOMElement.removeEventListener:', eventName, this.eventListeners.length);
        listener._el = null;
        this.el.removeEventListener(listener.eventName, listener.handler);
      }
      this.eventListeners = [];
    };

    this.getEventListeners = function() {
      return this.eventListeners;
    };

    this.getChildCount = function() {
      return this.el.childNodes.length;
    };

    this.getChildNodes = function() {
      var childNodes = [];
      for (var node = this.el.firstChild; node; node = node.nextSibling) {
        childNodes.push(BrowserDOMElement.wrapNativeElement(node));
      }
      return childNodes;
    };

    this.getChildren = function() {
      var children = [];
      for (var node = this.el.firstChild; node; node = node.nextSibling) {
        if (node.nodeType === window.Node.ELEMENT_NODE) {
          children.push(BrowserDOMElement.wrapNativeElement(node));
        }
      }
      return children;
    };

    this.getChildAt = function(pos) {
      return BrowserDOMElement.wrapNativeElement(this.el.childNodes[pos]);
    };

    this.getChildIndex = function(child) {
      if (!child._isBrowserDOMElement) {
        throw new Error('Expecting a BrowserDOMElement instance.');
      }
      return Array.prototype.indexOf.call(this.el.childNodes, child.el);
    };

    this.getFirstChild = function() {
      var firstChild = this.el.firstChild;
      if (firstChild) {
        return BrowserDOMElement.wrapNativeElement(firstChild);
      } else {
        return null;
      }
    };

    this.getLastChild = function() {
      var lastChild = this.el.lastChild;
      if (lastChild) {
        return BrowserDOMElement.wrapNativeElement(lastChild);
      } else {
        return null;
      }
    };

    this.getNextSibling = function() {
      var next = this.el.nextSibling;
      if (next) {
        return BrowserDOMElement.wrapNativeElement(next);
      } else {
        return null;
      }
    };

    this.getPreviousSibling = function() {
      var previous = this.el.previousSibling;
      if (previous) {
        return BrowserDOMElement.wrapNativeElement(previous);
      } else {
        return null;
      }
    };

    this.isTextNode = function() {
      return (this.el.nodeType === window.Node.TEXT_NODE);
    };

    this.isElementNode = function() {
      return (this.el.nodeType === window.Node.ELEMENT_NODE);
    };

    this.isCommentNode = function() {
      return (this.el.nodeType === window.Node.COMMENT_NODE);
    };

    this.isDocumentNode = function() {
      return (this.el.nodeType === window.Node.DOCUMENT_NODE);
    };

    this.clone = function() {
      var clone = this.el.cloneNode(true);
      return BrowserDOMElement.wrapNativeElement(clone);
    };

    this.createElement = function(tagName) {
      var el = this.el.ownerDocument.createElement(tagName);
      return BrowserDOMElement.wrapNativeElement(el);
    };

    this.createTextNode = function(text) {
      var el = this.el.ownerDocument.createTextNode(text);
      return BrowserDOMElement.wrapNativeElement(el);
    };

    this.is = function(cssSelector) {
      // ATTENTION: looking at https://developer.mozilla.org/en/docs/Web/API/Element/matches
      // Element.matches might not be supported by some mobile browsers
      var el = this.el;
      if (this.isElementNode()) {
        return matches.call(el, cssSelector);
      } else {
        return false;
      }
    };

    this.getParent = function() {
      var parent = this.el.parentNode;
      if (parent) {
        return BrowserDOMElement.wrapNativeElement(parent);
      } else {
        return null;
      }
    };

    this.getRoot = function() {
      var el = this.el;
      var parent = el;
      while (parent) {
        el = parent;
        parent = el.parentNode;
      }
      return BrowserDOMElement.wrapNativeElement(el);
    };

    this.find = function(cssSelector) {
      var result = null;
      if (this.el.querySelector) {
        result = this.el.querySelector(cssSelector);
      }
      if (result) {
        return BrowserDOMElement.wrapNativeElement(result);
      } else {
        return null;
      }
    };

    this.findAll = function(cssSelector) {
      var result = [];
      if (this.el.querySelectorAll) {
        result = this.el.querySelectorAll(cssSelector);
      }
      return Array.prototype.map.call(result, function(el) {
        return BrowserDOMElement.wrapNativeElement(el);
      });
    };

    this._normalizeChild = function(child) {
      if (child instanceof window.Node) {
        if (!child._wrapper) {
          child = BrowserDOMElement.wrapNativeElement(child);
        } else {
          return child;
        }
      }
      if (isString$g(child)) {
        child = this.createTextNode(child);
      }
      if (!child || !child._isBrowserDOMElement) {
        throw new Error('Illegal child type.');
      }
      // HACK: I thought it isn't possible to create
      // a BrowserDOMElement instance without having this
      // done already
      if (!child.el._wrapper) {
        child.el._wrapper = child;
      }
      console.assert(child.el._wrapper === child, "Expecting a backlink between native element and CheerioDOMElement");
      return child.getNativeElement();
    };

    this.appendChild = function(child) {
      var nativeChild = this._normalizeChild(child);
      this.el.appendChild(nativeChild);
      return this;
    };

    this.insertAt = function(pos, child) {
      var nativeChild = this._normalizeChild(child);
      var childNodes = this.el.childNodes;
      if (pos >= childNodes.length) {
        this.el.appendChild(nativeChild);
      } else {
        this.el.insertBefore(nativeChild, childNodes[pos]);
      }
      return this;
    };

    this.insertBefore = function(child, before) {
      if (!before || !before._isBrowserDOMElement) {
        throw new Error('insertBefore(): Illegal arguments. "before" must be a BrowserDOMElement instance.');
      }
      var nativeChild = this._normalizeChild(child);
      this.el.insertBefore(nativeChild, before.el);
      return this;
    };

    this.removeAt = function(pos) {
      this.el.removeChild(this.el.childNodes[pos]);
      return this;
    };

    this.removeChild = function(child) {
      if (!child || !child._isBrowserDOMElement) {
        throw new Error('removeChild(): Illegal arguments. Expecting a BrowserDOMElement instance.');
      }
      this.el.removeChild(child.el);
      return this;
    };

    this.replaceChild = function(oldChild, newChild) {
      if (!newChild || !oldChild ||
          !newChild._isBrowserDOMElement || !oldChild._isBrowserDOMElement) {
        throw new Error('replaceChild(): Illegal arguments. Expecting BrowserDOMElement instances.');
      }
      // Attention: Node.replaceChild has weird semantics
      this.el.replaceChild(newChild.el, oldChild.el);
      return this;
    };

    this.empty = function() {
      // http://jsperf.com/empty-an-element/4 suggests that this is the fastest way to
      // clear an element
      var el = this.el;
      while (el.lastChild) {
        el.removeChild(el.lastChild);
      }
      return this;
    };

    this.remove = function() {
      if (this.el.parentNode) {
        this.el.parentNode.removeChild(this.el);
      }
      return this;
    };

    this.serialize = function() {
      var outerHTML = this.el.outerHTML;
      if (isString$g(outerHTML)) {
        return outerHTML;
      } else {
        var xs = new window.XMLSerializer();
        return xs.serializeToString(this.el);
      }
    };

    this.isInDocument = function() {
      var el = this.el;
      while(el) {
        if (el.nodeType === window.Node.DOCUMENT_NODE) {
          return true;
        }
        el = el.parentNode;
      }
    };

    this._replaceNativeEl = function(newEl) {
      console.assert(newEl instanceof window.Node, "Expecting a native element.");
      var oldEl = this.el;
      var parentNode = oldEl.parentNode;
      if (parentNode) {
        parentNode.replaceChild(newEl, oldEl);
      }
      this.el = newEl;
    };

    this._getChildNodeCount = function() {
      return this.el.childNodes.length;
    };

    this.focus = function() {
      this.el.focus();
      return this;
    };

    this.blur = function() {
      this.el.focus();
      return this;
    };

    this.click = function() {
      this.el.click();
      return this;
    };

    this.getWidth = function() {
      var rect = this.el.getClientRects()[0];
      if (rect) {
        return rect.width;
      } else {
        return 0;
      }
    };

    this.getHeight = function() {
      var rect = this.el.getClientRects()[0];
      if (rect) {
        return rect.height;
      } else {
        return 0;
      }
    };

    this.getOffset = function() {
      var rect = this.el.getBoundingClientRect();
      return {
        top: rect.top + document.body.scrollTop,
        left: rect.left + document.body.scrollLeft
      };
    };

    this.getPosition = function() {
      return {left: this.el.offsetLeft, top: this.el.offsetTop};
    };

    this.getOuterHeight = function(withMargin) {
      var outerHeight = this.el.offsetHeight;
      if (withMargin) {
        var style = this.getComputedStyle();
        outerHeight += parseInt(style.marginTop, 10) + parseInt(style.marginBottom, 10);
      }
      return outerHeight;
    };

  };

  DOMElement.extend(BrowserDOMElement);

  DOMElement._defineProperties(BrowserDOMElement, DOMElement._propertyNames);

  BrowserDOMElement.createTextNode = function(text) {
    return window.document.createTextNode(text);
  };

  BrowserDOMElement.createElement = function(tagName) {
    return window.document.createElement(tagName);
  };

  BrowserDOMElement.parseMarkup = function(str, format, isFullDoc) {
    var nativeEls = [];
    var doc;
    if (!str) {
      // Create an empty XML document
      if (format === 'xml') {
        doc = (new window.DOMParser()).parseFromString('<dummy/>', 'text/xml');
      } else {
        doc = (new window.DOMParser()).parseFromString('<html></html>', 'text/html');
      }
      return new BrowserDOMElement(doc);
    } else {
      var parser = new window.DOMParser();
      if (format === 'html') {
        isFullDoc = (str.search(/<\s*html/i)>=0);
        doc = parser.parseFromString(str, 'text/html');
      } else if (format === 'xml') {
        doc = parser.parseFromString(str, 'text/xml');
      }
      if (doc) {
        if (format === 'html') {
          if (isFullDoc) {
            nativeEls = [doc.querySelector('html')];
          } else {
            // if the provided html is just a partial
            // then DOMParser still creates a full document
            // thus we pick the body and provide its content
            var body = doc.querySelector('body');
            nativeEls = body.childNodes;
          }
        } else if (format === 'xml') {
          if (isFullDoc) {
            nativeEls = [doc];
          } else {
            nativeEls = doc.childNodes;
          }
        }
      } else {
        throw new Error('Could not parse DOM string.');
      }
    }
    var elements = Array.prototype.map.call(nativeEls, function(el) {
      return new BrowserDOMElement(el);
    });
    if (elements.length === 1) {
      return elements[0];
    } else {
      return elements;
    }
  };

  BrowserDOMElement.wrapNativeElement = function(el) {
    if (el) {
      if (el._wrapper) {
        return el._wrapper;
      } else if (el instanceof window.Node) {
        if (el.nodeType === 3) {
          return new TextNode$2(el);
        } else {
          return new BrowserDOMElement(el);
        }
      } else if (el === window) {
        return BrowserDOMElement.getBrowserWindow();
      }
    } else {
      return null;
    }
  };

  function TextNode$2(nativeEl) {
    console.assert(nativeEl instanceof window.Node && nativeEl.nodeType === 3, "Expecting native TextNode.");
    this.el = nativeEl;
    nativeEl._wrapper = this;
  }
  TextNode$2.Prototype = function() {
    this._isBrowserDOMElement = true;
    [
      'getParent', 'getNextSibling', 'getPreviousSibling',
      'getTextContent', 'setTextContent',
      'getInnerHTML', 'setInnerHTML', 'getOuterHTML',
      'getNativeElement', 'clone'
    ].forEach(function(name) {
      this[name] = BrowserDOMElement.prototype[name];
    }.bind(this));
  };
  DOMElement.TextNode.extend(TextNode$2);
  DOMElement._defineProperties(TextNode$2, ['nodeType', 'textContent', 'innerHTML', 'outerHTML', 'parentNode']);

  BrowserDOMElement.TextNode = TextNode$2;

  /*
    Wrapper for the window element only exposing the eventlistener API.
  */
  function BrowserWindow() {
    this.el = window;
    window.__BrowserDOMElementWrapper__ = this;
    this.eventListeners = [];
  }

  BrowserWindow.Prototype = function() {
    var _super = BrowserDOMElement.prototype;
    this.on = function() {
      return _super.on.apply(this, arguments);
    };
    this.off = function() {
      return _super.off.apply(this, arguments);
    };
    this.addEventListener = function() {
      return _super.addEventListener.apply(this, arguments);
    };
    this.removeEventListener = function() {
      return _super.removeEventListener.apply(this, arguments);
    };
    this.getEventListeners = BrowserDOMElement.prototype.getEventListeners;
  };

  oo$s.initClass(BrowserWindow);

  BrowserDOMElement.getBrowserWindow = function() {
    if (window.__BrowserDOMElementWrapper__) return window.__BrowserDOMElementWrapper__;
    return new BrowserWindow(window);
  };

  var _r1, _r2;

  BrowserDOMElement.isReverse = function(anchorNode, anchorOffset, focusNode, focusOffset) {
    // the selection is reversed when the focus propertyEl is before
    // the anchor el or the computed charPos is in reverse order
    if (focusNode && anchorNode) {
      if (!_r1) {
        _r1 = window.document.createRange();
        _r2 = window.document.createRange();
      }
      _r1.setStart(anchorNode.getNativeElement(), anchorOffset);
      _r2.setStart(focusNode.getNativeElement(), focusOffset);
      var cmp = _r1.compareBoundaryPoints(window.Range.START_TO_START, _r2);
      if (cmp === 1) {
        return true;
      }
    }
    return false;
  };

  BrowserDOMElement.getWindowSelection = function() {
    var nativeSel = window.getSelection();
    var result = {
      anchorNode: BrowserDOMElement.wrapNativeElement(nativeSel.anchorNode),
      anchorOffset: nativeSel.anchorOffset,
      focusNode: BrowserDOMElement.wrapNativeElement(nativeSel.focusNode),
      focusOffset: nativeSel.focusOffset
    };
    return result;
  };

  module.exports = BrowserDOMElement;

  var Component$b = require('./Component');

  function Button() {
    Component$b.apply(this, arguments);
  }

  Button.Prototype = function() {

    this.render = function($$) {
      var el = $$('button').addClass('sc-button');
      el.append(this.props.children);
      if (this.props.disabled) {
        el.attr({disabled: 'disabled'});
      }
      return el;
    };
  };

  Component$b.extend(Button);
  module.exports = Button;

  var isString$h = require('lodash/isString');
  var last$5 = require('lodash/last');
  var extend$k = require('lodash/extend');
  var clone$4 = require('lodash/clone');
  var map$4 = require('lodash/map');
  var $ = require('../util/cheerio.customized');
  var DOMElement$1 = require('./DOMElement');

  function CheerioDOMElement(el) {
    this.el = el;
    this.$el = $(el);
    el._wrapper = this;
    this.htmlProps = {};
  }

  CheerioDOMElement.Prototype = function() {

    this._isCheerioDOMElement = true;

    this.getNativeElement = function() {
      return this.el;
    };

    this._wrapNativeElement = function(el) {
      if (el._wrapper) {
        return el._wrapper;
      } else {
        return new CheerioDOMElement(el);
      }
    };


    this.hasClass = function(className) {
      return this.$el.hasClass(className);
    };

    this.addClass = function(className) {
      this.$el.addClass(className);
      return this;
    };

    this.removeClass = function(className) {
      this.$el.removeClass(className);
      return this;
    };

    this.getClasses = function() {
      return this.$el.attr('class');
    };

    this.setClasses = function(classString) {
      this.$el.attr('class', classString);
      return this;
    };

    this.getAttribute = function(name) {
      return this.$el.attr(name);
    };

    this.setAttribute = function(name, value) {
      this.$el.attr(name, value);
      return this;
    };

    this.removeAttribute = function(name) {
      this.$el.removeAttr(name);
      return this;
    };

    this.getAttributes = function() {
      var attributes = clone$4(this.el.attribs);
      return attributes;
    };

    this.getProperty = function(name) {
      return this.$el.prop(name);
    };

    this.setProperty = function(name, value) {
      this.htmlProps[name] = value;
      this.$el.prop(name, value);
      return this;
    };

    // TODO: verify that this.el[name] is correct
    this.removeProperty = function(name) {
      delete this.htmlProps[name];
      delete this.el[name];
      return this;
    };

    this.getTagName = function() {
      if (this.el.type !== 'tag') {
        return "";
      } else {
        return this.el.name.toLowerCase();
      }
    };

    this.setTagName = function(tagName) {
      var newEl = $._createElement(tagName, this.el.root);
      var $newEl = $(newEl);
      $newEl.html(this.$el.html());
      newEl.attribs = extend$k({}, this.el.attribs);
      this._replaceNativeEl(newEl);
      return this;
    };

    this.getId = function() {
      return this.$el.attr('id');
    };

    this.setId = function(id) {
      this.$el.attr('id', id);
      return this;
    };

    this.getTextContent = function() {
      return this.$el.text();
    };

    this.setTextContent = function(text) {
      this.$el.text(text);
      return this;
    };

    this.getInnerHTML = function() {
      return this.$el.html();
    };

    this.setInnerHTML = function(html) {
      this.$el.html(html);
      return this;
    };

    this.getOuterHTML = function() {
      // TODO: this is not really jquery
      return $._serialize(this.el);
    };

    this.getValue = function() {
      return this.$el.val();
    };

    this.setValue = function(value) {
      this.$el.val(value);
      return this;
    };

    this.getStyle = function(name) {
      return this.$el.css(name);
    };

    this.setStyle = function(name, value) {
      this.$el.css(name, value);
      return this;
    };

    this.addEventListener = function() {
      return this;
    };

    this.removeEventListener = function() {
      return this;
    };

    this.removeAllEventListeners = function() {
      return this;
    };

    this.getEventListeners = function() {
      return [];
    };

    this.getChildCount = function() {
      return this.el.children.length;
    };

    this.getChildNodes = function() {
      var childNodes = this.el.children;
      childNodes = childNodes.map(function(node) {
        return this._wrapNativeElement(node);
      }.bind(this));
      return childNodes;
    };

    this.getChildren = function() {
      var children = this.el.children;
      children = children.filter(function(node) {
        return node.type === "tag";
      });
      children = children.map(function(node) {
        return this._wrapNativeElement(node);
      }.bind(this));
      return children;
    };

    this.getChildAt = function(pos) {
      return this._wrapNativeElement(this.el.children[pos]);
    };

    this.getChildIndex = function(child) {
      if (!child._isCheerioDOMElement) {
        throw new Error('Expecting a CheerioDOMElement instance.');
      }
      return this.el.children.indexOf(child.el);
    };

    this.getFirstChild = function() {
      var firstChild = this.el.children[0];
      if (firstChild) {
        return CheerioDOMElement.wrapNativeElement(firstChild);
      } else {
        return null;
      }
    };

    this.getLastChild = function() {
      var lastChild = last$5(this.el.children);
      if (lastChild) {
        return CheerioDOMElement.wrapNativeElement(lastChild);
      } else {
        return null;
      }
    };

    this.getNextSibling = function() {
      var next = this.el.next;
      if (next) {
        return CheerioDOMElement.wrapNativeElement(next);
      } else {
        return null;
      }
    };

    this.getPreviousSibling = function() {
      var previous = this.el.previous;
      if (previous) {
        return CheerioDOMElement.wrapNativeElement(previous);
      } else {
        return null;
      }
    };

    this.isTextNode = function() {
      // cheerio specific
      return this.el.type === "text";
    };

    this.isElementNode = function() {
      // cheerio specific
      return this.el.type === "tag";
    };

    this.isCommentNode = function() {
      // cheerio specific
      return this.el.type === "comment";
    };

    this.isDocumentNode = function() {
      return this.el === this.el.root;
    };

    this.clone = function() {
      var clone = this.$el.clone()[0];
      return this._wrapNativeElement(clone);
    };

    this.createElement = function(tagName) {
      var el = $._createElement(tagName, this.el.root);
      return this._wrapNativeElement(el);
    };

    this.createTextNode = function(text) {
      var el = $._createTextNode(text);
      return this._wrapNativeElement(el);
    };

    this.is = function(cssSelector) {
      // Note: unfortunately there is no cross-browser supported selectr matcher
      // Element.matches is not supported by all (mobile) browsers
      return this.$el.is(cssSelector);
    };

    this.getParent = function() {
      var parent = this.el.parent;
      if (parent) {
        return this._wrapNativeElement(parent);
      } else {
        return null;
      }
    };

    this.getRoot = function() {
      var el = this.el;
      var parent = el;
      while (parent) {
        el = parent;
        parent = el.parent;
      }
      return this._wrapNativeElement(el);
    };

    this.find = function(cssSelector) {
      var result = this.$el.find(cssSelector);
      if (result.length > 0) {
        return this._wrapNativeElement(result[0]);
      } else {
        return null;
      }
    };

    this.findAll = function(cssSelector) {
      var result = this.$el.find(cssSelector);
      if (result.length > 0) {
        return map$4(result, function(el) {
          return this._wrapNativeElement(el);
        }.bind(this));
      } else {
        return [];
      }
    };

    this._normalizeChild = function(child) {
      if (isString$h(child)) {
        child = this.createTextNode(child);
      }
      if (child._wrapper) {
        child = child._wrapper;
      }
      if (!child || !child._isCheerioDOMElement) {
        throw new Error('Illegal argument: only String and CheerioDOMElement instances are valid.');
      }
      console.assert(child.el._wrapper === child, "Expecting a backlink between native element and CheerioDOMElement");
      return child.getNativeElement();
    };

    this.appendChild = function(child) {
      child = this._normalizeChild(child);
      this.el.children.push(child);
      child.parent = this.el;
      return this;
    };

    this.insertAt = function(pos, child) {
      child = this._normalizeChild(child);
      var children = this.el.children;
      // NOTE: manipulating cheerio's internal children array
      // as otherwise cheerio clones the element loosing our custom data
      if (pos >= children.length) {
        children.push(child);
      } else {
        children.splice(pos, 0, child);
      }
      child.parent = this.el;
      return this;
    };

    this.insertBefore = function(child, before) {
      var pos = this.el.children.indexOf(before.el);
      if (pos > -1) {
        return this.insertAt(pos, child);
      } else {
        throw new Error('insertBefore(): reference node is not a child of this element.');
      }
    };

    this.removeAt = function(pos) {
      if (pos < 0 || pos >= this.el.children.length) {
        throw new Error('removeAt(): Index out of bounds.');
      }
      // NOTE: again manipulating cheerio's internal children array --
      // it works.
      var child = this.el.children[pos];
      child.parent = null;
      this.el.children.splice(pos, 1);
      return this;
    };

    this.removeChild = function(child) {
      if (!child || !child._isCheerioDOMElement) {
        throw new Error('removeChild(): Illegal arguments. Expecting a CheerioDOMElement instance.');
      }
      var idx = this.el.children.indexOf(child.el);
      if (idx < 0) {
        throw new Error('removeChild(): element is not a child.');
      }
      this.removeAt(idx);
      return this;
    };

    this.replaceChild = function(oldChild, newChild) {
      if (!newChild || !oldChild ||
          !newChild._isCheerioDOMElement || !oldChild._isCheerioDOMElement) {
        throw new Error('replaceChild(): Illegal arguments. Expecting BrowserDOMElement instances.');
      }
      var idx = this.el.children.indexOf(oldChild.el);
      if (idx > -1) {
        this.removeAt(idx);
        this.insertAt(idx, newChild.el);
      }
      return this;
    };

    this.empty = function() {
      this.$el.empty();
      return this;
    };

    this.remove = function() {
      this.$el.remove();
      return this;
    };

    this._replaceNativeEl = function(newEl) {
      var $newEl = $(newEl);
      this.$el.replaceWith($newEl);
      this.el = newEl;
      this.$el = $newEl;
    };

    this.isInDocument = function() {
      var el = this.el;
      while (el) {
        if (el === el.root) {
          return true;
        }
        el = el.parent;
      }
      return false;
    };

  };

  DOMElement$1.extend(CheerioDOMElement);

  DOMElement$1._defineProperties(CheerioDOMElement, DOMElement$1._propertyNames);

  CheerioDOMElement.createTextNode = function(text) {
    return $._createTextNode(text);
  };

  CheerioDOMElement.createElement = function(tagName) {
    return $('<' + tagName + '>')[0];
  };

  CheerioDOMElement.parseMarkup = function(str, format) {
    var nativeEls = [];
    var doc;

    if (!str) {
      // Create an empty XML document
      if (format === 'xml') {
        doc = $.parseXML('');
      } else {
        doc = $.parseHTML('');
      }
      return new CheerioDOMElement(doc);
    } else {
      nativeEls = $.parseXML(str);
    }
    var elements = nativeEls.map(function(el) {
      return new CheerioDOMElement(el);
    });
    if (elements.length === 1) {
      return elements[0];
    } else {
      return elements;
    }
  };

  CheerioDOMElement.wrapNativeElement = function(el) {
    if (el._wrapper) {
      return el._wrapper;
    } else {
      return new CheerioDOMElement(el);
    }
  };

  module.exports = CheerioDOMElement;

  var oo$t = require('../util/oo');
  var documentHelpers$3 = require('../model/documentHelpers');
  var ClipboardImporter = require('./ClipboardImporter');
  var ClipboardExporter = require('./ClipboardExporter');
  var substanceGlobals = require('../util/substanceGlobals');
  var platform = require('../util/platform');

  /**
    The Clipboard is a Component which should be rendered as a sibling component
    of one or multiple Surfaces.

    It uses the JSONImporter and JSONExporter for internal copy'n'pasting,
    i.e., within one window or between two instances with the same DocumentSchema.

    For inter-application copy'n'paste, the ClipboardImporter and ClipboardExporter is used.

    @class Clipboard
  */
  function Clipboard(surface, config) {

    this.surface = surface;
    var doc = surface.getDocument();
    var schema = doc.getSchema();

    var htmlConverters = [];
    if (config.converterRegistry) {
      htmlConverters = config.converterRegistry.get('html') || [];
    }
    var _config = {
      schema: schema,
      DocumentClass: doc.constructor,
      converters: htmlConverters
    };

    this.htmlImporter = new ClipboardImporter(_config);
    this.htmlExporter = new ClipboardExporter(_config);

    this.onCopy = this.onCopy.bind(this);
    this.onCut = this.onCut.bind(this);

    if (platform.isIE) {
      this.onBeforePasteShim = this.onBeforePasteShim.bind(this);
      this.onPasteShim = this.onPasteShim.bind(this);
    } else {
      this.onPaste = this.onPaste.bind(this);
    }
  }

  Clipboard.Prototype = function() {

    this.getSurface = function() {
      return this.surface;
    };

    /*
      Called by to enable clipboard handling on a given root element.

      @private
      @param {util/jquery} a jQuery wrapped element
    */
    this.attach = function(el) {
      // WORKAROUND: Edge is not permitting access the clipboard during onCopy
      if (!platform.isEdge) {
        el.addEventListener('copy', this.onCopy, { context: this });
      }
      el.addEventListener('cut', this.onCut, { context: this });
      if (this.isIe) {
        el.addEventListener('beforepaste', this.onBeforePasteShim, { context: this });
        el.addEventListener('paste', this.onPasteShim, { context: this });
      } else {
        el.addEventListener('paste', this.onPaste, { context: this });
      }
    };

    this.didMount = function() {
      var el = this.surface;
      // Note: we need a hidden content-editable element to be able to intercept native pasting.
      // We put this element into document.body and share it among all Clipboard instances.
      // This element must be content-editable, thus it must not have `display:none` or `visibility:hidden`,
      // To hide it from the view we use a zero width and position it outside of the screen.
      if (!Clipboard._sharedPasteElement) {
        var root = el.getRoot();
        var body = root.find('body');
        if (body) {
          var _sharedPasteElement = body.createElement('div')
            .attr('contenteditable', true)
            .attr('tabindex', -1)
            .css({
              position: 'fixed',
              opacity: '0.0',
              bottom: '-1000px',
              width: '0px'
            });
          Clipboard._sharedPasteElement = _sharedPasteElement;
          body.append(_sharedPasteElement);
        }
      }
      this.el = Clipboard._sharedPasteElement;
    };

    /*
      Called by to disable clipboard handling.
    */
    this.detach = function(rootElement) {
      rootElement.off('copy', this.onCopy);
      rootElement.off('cut', this.onCut);
      if (this.isIe) {
        rootElement.off('beforepaste', this.onBeforePasteShim);
        rootElement.off('paste', this.onPasteShim);
      } else {
        rootElement.off('paste', this.onPaste);
      }
    };

    /*
      Called when copy event fired.

      @param {Event} event
    */
    this.onCopy = function(event) {
      // console.log("Clipboard.onCopy", arguments);
      var clipboardData = this._copy();
      // in the case that browser doesn't provide event.clipboardData
      // we keep the copied data for internal use.
      // Then we have copy'n'paste at least within one app
      Clipboard.clipboardData = clipboardData;
      // FOR DEBUGGING
      substanceGlobals.clipboardData = clipboardData;
      if (event.clipboardData && clipboardData.doc) {
        event.preventDefault();
        // store as plain text and html
        event.clipboardData.setData('text/plain', clipboardData.text);
        event.clipboardData.setData('text/html', clipboardData.html);
      }
    };

    /*
      Called when cut event fired.

      @param {Event} event
    */
    this.onCut = function(event) {
      // preventing default behavior to avoid that contenteditable
      // destroys our DOM
      event.preventDefault();
      // console.log("Clipboard.onCut", arguments);
      this.onCopy(event);
      var surface = this.getSurface();
      if (!surface) return;
      surface.transaction(function(tx, args) {
        return surface.delete(tx, args);
      });
    };

    /*
      Called when paste event fired.

      @param {Event} event
    */
    // Works on Safari/Chrome/FF
    this.onPaste = function(event) {
      var clipboardData = event.clipboardData;

      var types = {};
      for (var i = 0; i < clipboardData.types.length; i++) {
        types[clipboardData.types[i]] = true;
      }
      // console.log('onPaste(): received content types', types);

      event.preventDefault();
      event.stopPropagation();

      var plainText;
      var html;
      if (types['text/plain']) {
        plainText = clipboardData.getData('text/plain');
      }
      if (types['text/html']) {
        html = clipboardData.getData('text/html');
      }

      // FOR DEBUGGING
      substanceGlobals.clipboardData = {
        text: plainText,
        html: html
      };
      // console.log('onPaste(): html = ', html);

      // WORKAROUND: FF does not provide HTML coming in from other applications
      // so fall back to pasting plain text
      if (this.isFF && !html) {
        this._pastePlainText(plainText);
        return;
      }

      // if we have content given as HTML we let the importer assess the quality first
      // and fallback to plain text import if it's bad
      if (html) {
        if (Clipboard.NO_CATCH) {
          this._pasteHtml(html, plainText);
        } else {
          try {
            this._pasteHtml(html, plainText);
          } catch (err) {
            this._pastePlainText(plainText);
          }
        }
      } else {
        this._pastePlainText(plainText);
      }
    };

    /*
      Pastes a given plain text into the surface.

      @param {String} plainText plain text
    */
    this._pastePlainText = function(plainText) {
      var surface = this.getSurface();
      surface.transaction(function(tx, args) {
        args.text = plainText;
        return surface.paste(tx, args);
      });
    };

    this.onBeforePasteShim = function() {
      var surface = this.getSurface();
      if (!surface) return;
      // console.log("Clipboard.onBeforePasteShim...");
      // HACK: need to work on the native element here
      var el = this._getNativeElement();
      el.focus();
      var range = document.createRange();
      range.selectNodeContents(el);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    };

    this.onPasteShim = function() {
      // HACK: need to work on the native element here
      var el = this.el;
      el.innerHTML = "";
      var sel = this.surface.getSelection();
      // NOTE: this delay is necessary to let the browser paste into the paste bin
      window.setTimeout(function() {
        this.surface.selection = sel;
        var html = el.innerHTML;
        var text = el.textContent;
        el.innerHTML = "";
        // FOR DEBUGGING
        substanceGlobals.clipboardData = {
          text: text,
          html: html
        };
        if (Clipboard.NO_CATCH) {
          this._pasteHtml(html, text);
        } else {
          try {
            this._pasteHtml(html, text);
          } catch (err) {
            this._pastePlainText(text);
          }
        }
      }.bind(this));
    };

    /*
      Copies data from surface to clipboard.
    */
    this._copy = function() {
      var surface = this.getSurface();
      var sel = surface.getSelection();
      var doc = surface.getDocument();
      var clipboardDoc = null;
      var clipboardText = "";
      var clipboardHtml = "";
      if (!sel.isCollapsed()) {
        clipboardText = documentHelpers$3.getTextForSelection(doc, sel);
        clipboardDoc = surface.copy(doc, sel);
        clipboardHtml = this.htmlExporter.exportDocument(clipboardDoc);
      }
      return {
        doc: clipboardDoc,
        html: clipboardHtml,
        text: clipboardText
      };
    };

    /*
      Pastes a given parsed html document into the surface.

      @param {ui/DOMElement} docElement
      @param {String} text plain text representation used as a fallback
    */
    this._pasteHtml = function(html, text) {
      var surface = this.getSurface();
      if (!surface) return;
      // TODO: the clipboard importer should make sure
      // that the container exists
      var content = this.htmlImporter.importDocument(html);
      if (content) {
        surface.transaction(function(tx, args) {
          args.text = text;
          args.doc = content;
          return surface.paste(tx, args);
        });
        return true;
      }
    };

    this._getNativeElement = function() {
      return this.el.el;
    };
  };

  oo$t.initClass(Clipboard);

  /*
    A shim for browsers with an unsupported native clipboard.
  */
  Clipboard.clipboardData = {
    doc: null,
    html: "",
    text: ""
  };


  module.exports = Clipboard;

  var HtmlExporter = require('../model/HTMLExporter');
  var ClipboardImporter$1 = require('./ClipboardImporter');
  var CLIPBOARD_CONTAINER_ID$2 = ClipboardImporter$1.CLIPBOARD_CONTAINER_ID;
  var CLIPBOARD_PROPERTY_ID$2 = ClipboardImporter$1.CLIPBOARD_PROPERTY_ID;
  var JSONConverter$4 = require('../model/JSONConverter');

  /**
    Export HTML from clipboard. Used for inter-application copy'n'paste.
  */
  function ClipboardExporter$1(config) {
    ClipboardExporter$1.super.call(this, config);
  }

  ClipboardExporter$1.Prototype = function() {

    /**
      Exports document in html format.

      @param {Document} doc document to export

      @return {String} html representation of given document
    */
    this.exportDocument = function(doc) {
      this.state.doc = doc;
      var html;
      var elements = this.convertDocument(doc);
      if (elements.length === 1 && elements[0].attr('data-id') === CLIPBOARD_PROPERTY_ID$2) {
        html = elements[0].innerHTML;
      } else {
        html = elements.map(function(el) {
          return el.outerHTML;
        }).join('');
      }
      var jsonConverter = new JSONConverter$4();
      var jsonStr = JSON.stringify(jsonConverter.exportDocument(doc));
      var meta = [
        "<meta name='substance' content='",
        btoa(jsonStr),
        "'>"
      ].join('');
      return '<html><head>' +meta+ '</head><body>' + html + '</body></html>';
    };

    /**
      Coverts document to set of DOM elements.

      @param {Document} doc document to convert

      @return {Array} array of DOM elements each represented single node
    */
    this.convertDocument = function(doc) {
      var content = doc.get(CLIPBOARD_CONTAINER_ID$2);
      if (!content) {
        throw new Error('Illegal clipboard document: could not find container "' + CLIPBOARD_CONTAINER_ID$2 + '"');
      }
      return this.convertContainer(content);
    };

  };

  HtmlExporter.extend(ClipboardExporter$1);

  ClipboardExporter$1.CLIPBOARD_CONTAINER_ID = CLIPBOARD_CONTAINER_ID$2;

  module.exports = ClipboardExporter$1;

  var isArray$c = require('lodash/isArray');
  var extend$l = require('lodash/extend');
  var forEach$6 = require('lodash/forEach');
  var Registry$2 = require('../util/Registry');
  var HTMLImporter$2 = require('../model/HTMLImporter');
  var DefaultDOMElement$5 = require('./DefaultDOMElement');
  var JSONConverter$5 = require('../model/JSONConverter');
  var platform$1 = require('../util/platform');

  // Note: sharing the symbol with the transformation
  var CLIPBOARD_CONTAINER_ID$3 = require('../model/transform/copySelection').CLIPBOARD_CONTAINER_ID;
  var CLIPBOARD_PROPERTY_ID$3 = require('../model/transform/copySelection').CLIPBOARD_PROPERTY_ID;

  /**
    Import HTML from clipboard. Used for inter-application copy'n'paste.
  */

  function ClipboardImporter$2(config) {
    ClipboardImporter$2._addConverters(config);

    if (!config.schema) {
      throw new Error('Missing argument: config.schema is required.');
    }
    // disabling warnings about default importers
    this.IGNORE_DEFAULT_WARNINGS = true;

    extend$l(config, {
      trimWhitespaces: true,
      REMOVE_INNER_WS: true
    });
    ClipboardImporter$2.super.call(this, config);

    // ATTENTION: this is only here so we can enfore windows conversion
    // mode from within tests
    this._isWindows = platform$1.isWindows;
  }

  ClipboardImporter$2.Prototype = function() {

    /**
      Parses HTML and applies some sanitization/normalization.
    */
    this.importDocument = function(html) {
      var body, el;

      if (this._isWindows) {
        // Under windows we can exploit <!--StartFragment--> and <!--EndFragment-->
        // to have an easier life
        var match = /<!--StartFragment\-->(.*)<!--EndFragment-->/.exec(html);
        if (match) {
          html = match[1];
        }
      }

      // when copying from a substance editor we store JSON in a meta tag
      // Then we parse the
      // If the import fails e.g. because the schema is incompatible
      // we fall back to plain HTML import
      if (html.search(/meta name=.substance./)>=0) {
        el = DefaultDOMElement$5.parseHTML(html);
        var substanceData = el.find('meta[name="substance"]');
        if (substanceData) {
          var jsonStr = atob(substanceData.attr('content'));
          jsonStr = decodeURIComponent(jsonStr);
          try {
            return this.importFromJSON(jsonStr);
          } catch(err) {
            console.error(err);
          }
        }
      }

      el = DefaultDOMElement$5.parseHTML(html);
      if (isArray$c(el)) {
        body = this._createElement('body');
        body.append(el);
      } else {
        body = el.find('body');
      }
      if (!body) {
        body = this._createElement('body');
        body.append(el);
      }
      body = _fixupGoogleDocsBody(body);
      if (!body) {
        console.warn('Invalid HTML.');
        return null;
      }

      this.reset();
      this.convertBody(body);
      var doc = this.generateDocument();
      return doc;
    };

    function _fixupGoogleDocsBody(body) {
      if (!body) return;
      // Google Docs has a strange convention to use a bold tag as
      // container for the copied elements
      // HACK: we exploit the fact that this element has an id with a
      // specific format, e.g., id="docs-internal-guid-5bea85da-43dc-fb06-e327-00c1c6576cf7"
      var bold = body.find('b');
      if (bold && /^docs-internal/.exec(bold.id)) {
        return bold;
      }
      return body;
    }

    this.importFromJSON = function(jsonStr) {
      var doc = this.createDocument();
      var jsonData = JSON.parse(jsonStr);
      var converter = new JSONConverter$5();
      converter.importDocument(doc, jsonData);
      return doc;
    };

    /**
      Converts all children of a given body element.

      @param {String} body body element of given HTML document
    */
    this.convertBody = function(body) {
      this.convertContainer(body.childNodes, CLIPBOARD_CONTAINER_ID$3);
    };

    this._wrapInlineElementsIntoBlockElement = function(childIterator) {
      var wrapper = this._createElement('p');
      while(childIterator.hasNext()) {
        var el = childIterator.next();
        // if there is a block node we finish this wrapper
        var blockTypeConverter = this._getConverterForElement(el, 'block');
        if (blockTypeConverter) {
          childIterator.back();
          break;
        }
        wrapper.append(el.clone());
      }
      // HACK: usually when we run into this case, then there is inline data only
      // Instead of detecting this case up-front we just set the proper id
      // and hope that all goes well.
      // Note: when this is called a second time, the id will be overridden.
      wrapper.attr('data-id', CLIPBOARD_PROPERTY_ID$3);
      var node = this.defaultConverter(wrapper, this);
      if (node) {
        if (!node.type) {
          throw new Error('Contract: Html.defaultConverter() must return a node with type.');
        }
        this._createAndShow(node);
      }
      return node;
    };

    /**
      Creates substance document to paste.

      @return {Document} the document instance
    */
    this.createDocument = function() {
      var doc = this._createDocument(this.schema);
      if (!doc.get(CLIPBOARD_CONTAINER_ID$3)) {
        doc.create({
          type: 'container',
          id: CLIPBOARD_CONTAINER_ID$3,
          nodes: []
        });
      }
      return doc;
    };

    this._getUnsupportedNodeConverter = function() {
      // nothing
    };

  };

  HTMLImporter$2.extend(ClipboardImporter$2);

  ClipboardImporter$2.CLIPBOARD_CONTAINER_ID = CLIPBOARD_CONTAINER_ID$3;
  ClipboardImporter$2.CLIPBOARD_PROPERTY_ID = CLIPBOARD_PROPERTY_ID$3;

  var _converters = {
    'catch-all-block': {
      type: 'paragraph',
      matchElement: function(el) { return el.is('div'); },
      import: function(el, node, converter) {
        node.content = converter.annotatedText(el, [node.id, 'content']);
      }
    }
  };

  ClipboardImporter$2._addConverters = function(config) {
    if (config.converters) {
      var registry = new Registry$2();
      config.converters.forEach(function(conv, name) {
        registry.add(name, conv);
      });
      forEach$6(_converters, function(converter, name) {
        registry.add(name, converter);
      });
      config.converters = registry;
    }
  };

  module.exports = ClipboardImporter$2;

  var oo$u = require('../util/oo');

  /**
   Abstract interface for commands.

   @class
  */

  var Command$6 = function() {};

  Command$6.Prototype = function() {

    this.getName = function() {
      return this.constructor.static.name;
    };

    this.getCommandState = function(props, context) { // eslint-disable-line
      throw new Error('Command.getCommandState() is abstract.');
    };

    /**
      Execute command

      @abstract
      @return {Object} info object with execution details
    */
    this.execute = function(props, context) { // eslint-disable-line
      throw new Error('Command.execute() is abstract.');
    };

    this._getDocumentSession = function(props, context) {
      var docSession = props.documentSession || context.documentSession;
      if (!docSession) {
        throw new Error("'documentSession' is required.");
      }
      return docSession;
    };

    this._getSelection = function(props) {
      var sel = props.selection || props.selectionState.getSelection();
      if (!sel) {
        throw new Error("'selection' is required.");
      }
      return sel;
    };

  };

  oo$u.initClass(Command$6);

  module.exports = Command$6;

  var oo$v = require('../util/oo');
  var extend$m = require('lodash/extend');
  var forEach$7 = require('lodash/forEach');
  var isEqual$b = require('lodash/isEqual');
  var Registry$3 = require('../util/Registry');

  /*
    Listens to changes on the document and selection and updates registered tools accordingly.

    @class
  */
  function CommandManager$1(context, commands) {
    if (!context.documentSession) {
      throw new Error('DocumentSession required.');
    }
    this.documentSession = context.documentSession;
    this.context = extend$m({}, context, {
      // for convenienve we provide access to the doc directly
      doc: this.documentSession.getDocument()
    });

    // Set up command registry
    this.commandRegistry = new Registry$3();
    forEach$7(commands, function(CommandClass) {
      var cmd = new CommandClass();
      this.commandRegistry.add(CommandClass.static.name, cmd);
    }.bind(this));

    this.documentSession.on('update', this.updateCommandStates, this);

    this.updateCommandStates();
  }

  CommandManager$1.Prototype = function() {

    this.dispose = function() {
      this.documentSession.off(this);
    };

    this.getCommandContext = function() {
      return this.context;
    };

    /*
      Compute new command states object
    */
    this.updateCommandStates = function() {
      var commandStates = {};
      var commandContext = this.getCommandContext();
      var props = this._getCommandProps();
      this.commandRegistry.forEach(function(cmd) {
        commandStates[cmd.getName()] = cmd.getCommandState(props, commandContext);
      });
      // poor-man's immutable style
      if (!isEqual$b(this.commandStates, commandStates)) {
        this.commandStates = commandStates;
      }
    };

    /*
      Exposes the current commandStates object
    */
    this.getCommandStates = function() {
      return this.commandStates;
    };

    /*
      Execute a command, given a context and arguments
    */
    this.executeCommand = function(commandName, props) {
      var cmd = this.commandRegistry.get(commandName);
      if (!cmd) {
        console.warn('command', commandName, 'not registered');
        return;
      }
      var commandState = this.commandStates[commandName];
      props = extend$m(this._getCommandProps(), commandState, props);
      var info = cmd.execute(props, this.getCommandContext());
      // TODO: why do we required commands to return a result?
      if (info === undefined) {
        console.warn('command ', commandName, 'must return either an info object or true when handled or false when not handled');
      }
      return info;
    };

    // TODO: while we need it here this should go into the flow thingie later
    this._getCommandProps = function() {
      var documentSession = this.context.documentSession;
      var selectionState = documentSession.getSelectionState();
      var sel = selectionState.getSelection();
      var surface = this.context.surfaceManager.getFocusedSurface();
      return {
        documentSession: documentSession,
        selectionState: selectionState,
        surface: surface,
        selection: sel
      };
    };

  };

  oo$v.initClass(CommandManager$1);

  module.exports = CommandManager$1;

  var isString$i = require('lodash/isString');
  var isFunction$1 = require('lodash/isFunction');
  var extend$n = require('lodash/extend');
  var each$i = require('lodash/each');
  var EventEmitter$b = require('../util/EventEmitter');
  var RenderingEngine = require('./RenderingEngine');
  var VirtualElement = require('./VirtualElement');
  var DOMElement$2 = require('./DOMElement');
  var DefaultDOMElement$6 = require('./DefaultDOMElement');
  var inBrowser = require('../util/inBrowser');

  var __id__$5 = 0;

  /**
    A light-weight component implementation inspired by React and Ember. In contrast to the
    large frameworks it does much less things automagically in favour of synchronous
    rendering and a minimalistic life-cycle. It also provides *up-tree*
    communication and *dependency injection*.

    Concepts:

    - `props` are provided by a parent component.  An initial set of properties is provided
    via constructor. After that, the parent component can call `setProps` or `extendProps`
    to update these properties which triggers rerendering if the properties change.

    - `state` is a set of flags and values which are used to control how the component
    gets rendered given the current props. Using `setState` the component can change
    its internal state, which leads to a rerendering if the state changes.

    - A child component with a `ref` id will be reused on rerender. All others will be
    wiped and rerender from scratch. If you want to preserve a grand-child (or lower), then
    make sure that all anchestors have a ref id. After rendering the child will be
    accessible via `this.refs[ref]`.

    - A component can send actions via `send` which are bubbled up through all parent
    components until one handles it.

    @class
    @abstract
    @extends ui/DOMElement
    @implements util/EventEmitter

    @example

    Define a component:

    ```
    var HelloMessage = Component.extend({
      render: function() {
        return $$('div').append(
          'Hello ',
          this.props.name
        );
      }
    });
    ```

    And mount it to a DOM Element:

    ```
    Component.mount(
      $$(HelloMessage, {name: 'John'}),
      document.body
    );
    ```
  */
  function Component$c(parent, props) {
    EventEmitter$b.call(this);
    this.__id__ = __id__$5++;

    this.parent = parent;
    this.el = null;
    this.refs = {};

    // HACK: a temporary solution to handle refs owned by an ancestor
    // is to store them here as well, so that we can map virtual components
    // efficiently
    this.__foreignRefs__ = {};
    this._actionHandlers = {};

    // context from parent (dependency injection)
    this.context = this._getContext() || {};
    Object.freeze(this.context);
    // setting props without triggering willReceiveProps
    this.props = props || {};
    Object.freeze(this.props);
    this.state = this.getInitialState() || {};
    Object.freeze(this.state);
  }

  Component$c.Prototype = function() {

    extend$n(this, EventEmitter$b.prototype);

    this._isComponent = true;

    /**
      Provides the context which is delivered to every child component. Override if you want to
      provide your own child context.

      @return object the child context
    */
    this.getChildContext = function() {
      return this.childContext || {};
    };

    /**
      Provide the initial component state.

      @return object the initial state
    */
    this.getInitialState = function() {
      return {};
    };

    /**
      Provides the parent of this component.

      @return object the parent component or null if this component does not have a parent.
    */
    this.getParent = function() {
      return this.parent;
    };

    this.getRoot = function() {
      var comp = this;
      var parent = comp;
      while (parent) {
        comp = parent;
        parent = comp.getParent();
      }
      return comp;
    };

    /*
      Short hand for using labelProvider API
    */
    this.getLabel = function(name) {
      var labelProvider = this.context.labelProvider;
      if (!labelProvider) throw new Error('Missing labelProvider.');
      return labelProvider.getLabel(name);
    };

    /**
      Render the component.

      ATTENTION: this does not create a DOM presentation but
      a virtual representation which is compiled into a DOM element later.

      Every Component should override this method.

      @param {Function} $$ method to create components
      @return {VirtualNode} VirtualNode created using $$
     */
    this.render = function($$) {
      /* istanbul ignore next */
      return $$('div');
    };

    this.mount = function(el) {
      if (!this.el) {
        this._render();
      }
      if (!el._isDOMElement) {
        el = DefaultDOMElement$6.wrapNativeElement(el);
      }
      el.appendChild(this.el);
      if (el.isInDocument()) {
        this.triggerDidMount(true);
      }
      return this;
    };

    /**
     * Determines if Component.rerender() should be run after
     * changing props or state.
     *
     * The default implementation performs a deep equal check.
     *
     * @return a boolean indicating whether rerender() should be run.
     */
    this.shouldRerender = function(newProps) { // eslint-disable-line
      return true;
    };

    /**
     * Rerenders the component.
     *
     * Call this to manually trigger a rerender.
     */
    this.rerender = function() {
      this._rerender(this.props, this.state);
    };

    this._rerender = function(oldProps, oldState) {
      this._render(oldProps, oldState);
      // when this component is not mounted still trigger didUpdate()
      if (!this.isMounted()) {
        this.didUpdate(oldProps, oldState);
      }
    };

    this._render = function(oldProps, oldState) {
      if (this.__isRendering__) {
        throw new Error('Component is rendering already.');
      }
      this.__isRendering__ = true;
      try {
        var engine = new RenderingEngine();
        engine._render(this, oldProps, oldState);
      } finally {
        delete this.__isRendering__;
      }
    };

    /**
     * Triggers didMount handlers recursively.
     *
     * Gets called when using `component.mount(el)` on an element being
     * in the DOM already. Typically this is done for a root component.
     *
     * If this is not possible because you want to do things differently, make sure
     * you call 'component.triggerDidMount()' on root components.
     *
     * @param isMounted an optional param for optimization, it's used mainly internally
     * @private
     * @example
     *
     * ```
     * var frag = document.createDocumentFragment();
     * var comp = Component.mount($$(MyComponent), frag);
     * ...
     * $('body').append(frag);
     * comp.triggerDidMount();
     * ```
     */
    this.triggerDidMount = function() {
      // Trigger didMount for the children first
      this.getChildren().forEach(function(child) {
        // We pass isMounted=true to save costly calls to Component.isMounted
        // for each child / grandchild
        child.triggerDidMount(true);
      });
      // To prevent from multiple calls to didMount, which can happen under
      // specific circumstances we use a guard.
      if (!this.__isMounted__) {
        this.__isMounted__ = true;
        this.didMount();
      }
    };

    /**
     * Called when the element is inserted into the DOM.
     *
     * Node: make sure that you call `component.mount(el)` using an element
     * which is already in the DOM.
     *
     * @example
     *
     * ```
     * var component = new MyComponent();
     * component.mount($('body')[0])
     * ```
     */
    this.didMount = function() {};


    /**
      Hook which is called after each rerender.
    */
    this.didUpdate = function() {};

    /**
      @return a boolean indicating if this component has been mounted
     */
    this.isMounted = function() {
      return this.__isMounted__;
    };

    /**
     * Triggers dispose handlers recursively.
     *
     * @private
     */
    this.triggerDispose = function() {
      this.getChildren().forEach(function(child) {
        child.triggerDispose();
      });
      this.dispose();
      this.__isMounted__ = false;
    };

    /**
      A hook which is called when the component is unmounted, i.e. removed from DOM, hence disposed
     */
    this.dispose = function() {};

    /*
      Attention: this is used when a preserved component is relocated.
      E.g., rendered with a new parent.
    */
    this._setParent = function(newParent) {
      this.parent = newParent;
      this.context = this._getContext() || {};
      Object.freeze(this.context);
    };

    /**
      Send an action request to the parent component, bubbling up the component
      hierarchy until an action handler is found.

      @param action the name of the action
      @param ... arbitrary number of arguments
      @returns {Boolean} true if the action was handled, false otherwise
      @example
    */
    this.send = function(action) {
      var comp = this;
      while(comp) {
        if (comp._actionHandlers && comp._actionHandlers[action]) {
          comp._actionHandlers[action].apply(comp, Array.prototype.slice.call(arguments, 1));
          return true;
        }
        comp = comp.getParent();
      }
      console.warn('Action', action, 'was not handled.');
      return false;
    };

    /**
      Define action handlers. Call this during construction/initialization of a component.

      @example

      ```
      function MyComponent() {
        Component.apply(this, arguments);
        ...
        this.handleActions({
         'openPrompt': this.openPrompt,
         'closePrompt': this.closePrompt
        });
      }
      ```
    */
    this.handleActions = function(actionHandlers) {
      each$i(actionHandlers, function(method, actionName) {
        this.handleAction(actionName, method);
      }.bind(this));
      return this;
    };

    /**
      Define an action handler. Call this during construction/initialization of a component.

      @param {String} action name
      @param {Functon} a function of this component.
    */
    this.handleAction = function(name, handler) {
      if (!name || !handler || !isFunction$1(handler)) {
        throw new Error('Illegal arguments.');
      }
      handler = handler.bind(this);
      this._actionHandlers[name] = handler;
    };

    /**
      Get the current component state

      @return {Object} the current state
    */
    this.getState = function() {
      return this.state;
    };

    /**
      Sets the state of this component, potentially leading to a rerender.

      Usually this is used by the component itself.
    */
    this.setState = function(newState) {
      var oldProps = this.props;
      var oldState = this.state;
      // Note: while setting props it is allowed to call this.setState()
      // which will not lead to an extra rerender
      var needRerender = !this.__isSettingProps__ &&
        this.shouldRerender(this.getProps(), newState);
      // triggering this to provide a possibility to look at old before it is changed
      this.willUpdateState(newState);
      this.state = newState || {};
      Object.freeze(this.state);
      if (needRerender) {
        this._rerender(oldProps, oldState);
      } else if (!this.__isSettingProps__) {
        this.didUpdate(oldProps, oldState);
      }
    };

    /**
      This is similar to `setState()` but extends the existing state instead of replacing it.
      @param {object} newState an object with a partial update.
    */
    this.extendState = function(newState) {
      newState = extend$n({}, this.state, newState);
      this.setState(newState);
    };

    /**
      Called before state is changed.
    */
    this.willUpdateState = function(newState) { // eslint-disable-line
    };

    /**
      Get the current properties

      @return {Object} the current state
    */
    this.getProps = function() {
      return this.props;
    };

    /**
      Sets the properties of this component, potentially leading to a rerender.

      @param {object} an object with properties
    */
    this.setProps = function(newProps) {
      var oldProps = this.props;
      var oldState = this.state;
      var needRerender = this.shouldRerender(newProps, this.state);
      this._setProps(newProps);
      if (needRerender) {
        this._rerender(oldProps, oldState);
      } else {
        this.didUpdate(oldProps, oldState);
      }
    };

    this._setProps = function(newProps) {
      newProps = newProps || {};
      // set a flag so that this.setState() can omit triggering render
      this.__isSettingProps__ = true;
      try {
        this.willReceiveProps(newProps);
        this.props = newProps || {};
        Object.freeze(newProps);
      } finally {
        delete this.__isSettingProps__;
      }
    };

    /**
      Extends the properties of the component, without reppotentially leading to a rerender.

      @param {object} an object with properties
    */
    this.extendProps = function(updatedProps) {
      var newProps = extend$n({}, this.props, updatedProps);
      this.setProps(newProps);
    };

    /**
      Hook which is called before properties are updated. Use this to dispose objects which will be replaced when properties change.

      For example you can use this to derive state from props.
      @param {object} newProps
    */
    this.willReceiveProps = function(newProps) { // eslint-disable-line
    };

    this.getChildNodes = function() {
      if (!this.el) return [];
      var childNodes = this.el.getChildNodes();
      childNodes = childNodes.map(_unwrapComp).filter(notNull);
      return childNodes;
    };

    this.getChildren = function() {
      if (!this.el) return [];
      var children = this.el.getChildren();
      children = children.map(_unwrapComp).filter(notNull);
      return children;
    };

    this.getChildAt = function(pos) {
      var node = this.el.getChildAt(pos);
      return _unwrapCompStrict(node);
    };

    this.find = function(cssSelector) {
      var el = this.el.find(cssSelector);
      return _unwrapComp(el);
    };

    this.findAll = function(cssSelector) {
      var els = this.el.findAll(cssSelector);
      return els.map(_unwrapComp).filter(notNull);
    };

    this.appendChild = function(child) {
      this.insertAt(this.getChildCount(), child);
    };

    this.insertAt = function(pos, childEl) {
      if (isString$i(childEl)) {
        childEl = new VirtualElement.TextNode(childEl);
      }
      if (!childEl._isVirtualElement) {
        throw new Error('Invalid argument: "child" must be a VirtualElement.');
      }
      var child = new RenderingEngine()._renderChild(this, childEl);
      this.el.insertAt(pos, child.el);
      _mountChild(this, child);
    };

    this.removeAt = function(pos) {
      var childEl = this.el.getChildAt(pos);
      if (childEl) {
        var child = _unwrapCompStrict(childEl);
        _disposeChild(child);
        this.el.removeAt(pos);
      }
    };

    this.removeChild = function(child) {
      if (!child || !child._isComponent) {
        throw new Error('removeChild(): Illegal arguments. Expecting a Component instance.');
      }
      // TODO: remove ref from owner
      _disposeChild(child);
      this.el.removeChild(child.el);
    };

    this.replaceChild = function(oldChild, newChild) {
      if (!newChild || !oldChild ||
          !newChild._isComponent || !oldChild._isComponent) {
        throw new Error('replaceChild(): Illegal arguments. Expecting BrowserDOMElement instances.');
      }
      // Attention: Node.replaceChild has weird semantics
      _disposeChild(oldChild);
      this.el.replaceChild(newChild.el, oldChild.el);
      if (this.isMounted()) {
        newChild.triggerDidMount(true);
      }
    };

    function _disposeChild(child) {
      child.triggerDispose();
      if (child._owner && child._ref) {
        console.assert(child._owner.refs[child._ref] === child, "Owner's ref should point to this child instance.");
        delete child._owner.refs[child._ref];
      }
    }

    function _mountChild(parent, child) {
      if (parent.isMounted()) {
        child.triggerDidMount(true);
      }
      if (child._owner && child._ref) {
        child._owner.refs[child._ref] = child;
      }
    }

    this.empty = function() {
      if (this.el) {
        this.getChildNodes().forEach(function(child) {
          _disposeChild(child);
        });
        this.el.empty();
      }
      return this;
    };

    this.remove = function() {
      _disposeChild(this);
      this.el.remove();
    };

    this._getContext = function() {
      var context = {};
      var parent = this.getParent();
      if (parent) {
        context = extend$n(context, parent.context);
        if (parent.getChildContext) {
          return extend$n(context, parent.getChildContext());
        }
      }
      return context;
    };

    this.addEventListener = function() {
      throw new Error("Not supported.");
    };

    this.removeEventListener = function() {
      throw new Error("Not supported.");
    };

    this.insertBefore = function() {
      throw new Error("Not supported.");
    };

  };

  DOMElement$2.Delegator.extend(Component$c);

  DOMElement$2._defineProperties(Component$c, DOMElement$2._propertyNames);

  function _unwrapComp(el) {
    if (el) return el._comp;
  }

  function _unwrapCompStrict(el) {
    console.assert(el._comp, "Expecting a back-link to the component instance.");
    return _unwrapComp(el);
  }

  function notNull(n) { return n; }

  Component$c.unwrap = _unwrapComp;

  Component$c.static.render = function(props) {
    props = props || {};
    var ComponentClass = this.__class__;
    var comp = new ComponentClass(null, props);
    comp._render();
    return comp;
  };

  Component$c.static.mount = function(props, el) {
    if (arguments.length === 1) {
      props = {};
      el = arguments[0];
    }
    if (isString$i(el)) {
      var selector = el;
      if (inBrowser) {
        el = window.document.querySelector(selector);
      } else {
        throw new Error("This selector is not supported on server side.");
      }
    }
    if (!el._isDOMElement) {
      el = new DefaultDOMElement$6.wrapNativeElement(el);
    }
    var ComponentClass = this.__class__;
    var comp = new ComponentClass(null, props);
    comp.mount(el);
    return comp;
  };

  Component$c.mount = function(ComponentClass, props, el) {
    if (arguments.length === 2) {
      props = {};
      el = arguments[1];
    }
    return ComponentClass.static.mount(props, el);
  };

  function ElementComponent(parent, virtualComp) {
    if (!parent._isComponent) {
      throw new Error("Illegal argument: 'parent' must be a Component.");
    }
    if (!virtualComp._isVirtualHTMLElement) {
      throw new Error("Illegal argument: 'virtualComp' must be a VirtualHTMLElement.");
    }
    this.parent = parent;
    this.context = this._getContext() || {};
    Object.freeze(this.context);
  }

  ElementComponent.Prototype = function() {
    this._isElementComponent = true;
  };

  Component$c.extend(ElementComponent);
  Component$c.Element = ElementComponent;

  function TextNodeComponent(parent, virtualComp) {
    if (!parent._isComponent) {
      throw new Error("Illegal argument: 'parent' must be a Component.");
    }
    if (!virtualComp._isVirtualTextNode) {
      throw new Error("Illegal argument: 'virtualComp' must be a VirtualTextNode.");
    }
    this.parent = parent;
  }

  TextNodeComponent.Prototype = function() {
    this._isTextNodeComponent = true;

    this.setTextContent = function(text) {
      if (!this.el) {
        throw new Error('Component must be rendered first.');
      }
      if (this.el.textContent !== text) {
        var newEl = this.el.createTextNode(text);
        this.el._replaceNativeEl(newEl.getNativeElement());
      }
    };
  };

  Component$c.extend(TextNodeComponent);
  Component$c.TextNode = TextNodeComponent;

  Object.defineProperty(Component$c, '$$', {
    get: function() {
      throw new Error([
        "With Substance Beta 4 we introduced a breaking change.",
        "We needed to turn the former static Component.$$ into a contextualized implementation, which is now served via Component.render($$).",
        "FIX: change your signature of 'this.render()' in all your Components to 'this.render($$)"
      ].join("\n"));
    }
  });

  Component$c.unwrapDOMElement = function(el) {
    return _unwrapComp(el);
  };

  module.exports = Component$c;

  var each$j = require('lodash/each');
  var ContainerEditor$1 = require('./ContainerEditor');

  /**
    Represents a flow annotator that manages a sequence of nodes in a container. Needs to
    be instantiated within a ui/Controller context. Works like a {@link ui/ContainerEditor}
    but you can only annotate, not edit.

    @class ContainerAnnotator
    @component
    @extends ui/ContainerEditor

    @prop {String} name unique editor name
    @prop {String} containerId container id
    @prop {ui/SurfaceCommand[]} commands array of command classes to be available

    @example

    ```js
    $$(ContainerAnnotator, {
      name: 'bodySurface',
      containerId: 'main',
      doc: doc,
      commands: [ToggleStrong]
    })
    ```
   */

  function ContainerAnnotator() {
    ContainerAnnotator.super.apply(this, arguments);
  }

  ContainerAnnotator.Prototype = function() {

    this.render = function($$) {
      var doc = this.getDocument();
      var containerNode = doc.get(this.props.containerId);

      var el = $$("div")
        .addClass('surface container-node ' + containerNode.id)
        .attr({
          spellCheck: false,
          "data-id": containerNode.id,
          "contenteditable": false
        });

      // node components
      each$j(containerNode.getNodes(), function(node) {
        el.append(this.renderNode(node));
      }.bind(this));

      return el;
    };

  };

  ContainerEditor$1.extend(ContainerAnnotator);

  module.exports = ContainerAnnotator;

  var isString$j = require('lodash/isString');
  var each$k = require('lodash/each');
  var last$6 = require('lodash/last');
  var uuid$f = require('../util/uuid');
  var keys$2 = require('../util/keys');
  var platform$2 = require('../util/platform');
  var EditingBehavior$1 = require('../model/EditingBehavior');
  var breakNode$3 = require('../model/transform/breakNode');
  var insertNode$1 = require('../model/transform/insertNode');
  var switchTextType$2 = require('../model/transform/switchTextType');
  var paste$1 = require('../model/transform/paste');
  var Surface = require('./Surface');
  var RenderingEngine$1 = require('./RenderingEngine');
  var IsolatedNodeComponent = require('./IsolatedNodeComponent');

  /**
    Represents a flow editor that manages a sequence of nodes in a container. Needs to be
    instantiated inside a {@link ui/Controller} context.

    @class ContainerEditor
    @component
    @extends ui/Surface

    @prop {String} name unique editor name
    @prop {String} containerId container id
    @prop {Object[]} textTypes array of textType definition objects
    @prop {ui/SurfaceCommand[]} commands array of command classes to be available

    @example

    Create a full-fledged `ContainerEditor` for the `body` container of a document.
    Allow Strong and Emphasis annotations and to switch text types between paragraph
    and heading at level 1.

    ```js
    $$(ContainerEditor, {
      name: 'bodyEditor',
      containerId: 'body',
      textTypes: [
        {name: 'paragraph', data: {type: 'paragraph'}},
        {name: 'heading1',  data: {type: 'heading', level: 1}}
      ],
      commands: [StrongCommand, EmphasisCommand, SwitchTextTypeCommand],
    })
    ```
   */

  function ContainerEditor$2(parent, props) {
    // default props derived from the given props
    props.containerId = props.containerId || props.node.id;
    props.name = props.name || props.containerId || props.node.id;

    ContainerEditor$2.super.apply(this, arguments);

    this.containerId = this.props.containerId;
    if (!isString$j(this.containerId)) {
      throw new Error("Property 'containerId' is mandatory.");
    }
    var doc = this.getDocument();
    this.container = doc.get(this.containerId);
    if (!this.container) {
      throw new Error('Container with id ' + this.containerId + ' does not exist.');
    }

    this.editingBehavior = this.context.editingBehavior || new EditingBehavior$1();

    // derive internal state variables
    ContainerEditor$2.prototype._deriveInternalState.call(this, this.props);
  }

  ContainerEditor$2.Prototype = function() {

    var _super = Object.getPrototypeOf(this);

    this._isContainerEditor = true;

    // Note: this component is self managed
    this.shouldRerender = function(newProps) {
      if (newProps.disabled !== this.props.disabled) return true;
      // TODO: we should still detect when the document has changed,
      // see https://github.com/substance/substance/issues/543
      return false;
    };

    this.willReceiveProps = function(newProps) {
      _super.willReceiveProps.apply(this, arguments);
      ContainerEditor$2.prototype._deriveInternalState.call(this, newProps);
    };

    this.didMount = function() {
      _super.didMount.apply(this, arguments);
      // var doc = this.getDocument();
      // to do incremental updates
      this.container.on('nodes:changed', this.onContainerChange, this);
    };

    this.dispose = function() {
      _super.dispose.apply(this, arguments);
      // var doc = this.getDocument();
      // doc.off(this);
      this.container.off(this);
    };

    this.render = function($$) {
      var el = _super.render.call(this, $$);

      var doc = this.getDocument();
      var containerId = this.getContainerId();
      var containerNode = doc.get(containerId);
      if (!containerNode) {
        console.warn('No container node found for ', containerId);
      }
      el.addClass('sc-container-editor container-node ' + containerId)
        .attr({
          spellCheck: false,
          "data-id": containerId
        });

      if (this.isEmpty()) {
        el.append(
          $$('a').attr('href', '#').append('Start writing').on('click', this.onCreateText)
        );
      } else {
        // node components
        each$k(containerNode.getNodes(), function(node) {
          el.append(this._renderNode($$, node));
        }.bind(this));
      }

      if (!this.props.disabled) {
        el.addClass('sm-enabled');
        el.setAttribute('contenteditable', true);
      }

      return el;
    };

    this._renderNode = function($$, node) {
      if (!node) throw new Error('Illegal argument');
      if (node.isText()) {
        return _super.renderNode.call(this, $$, node);
      } else {
        var componentRegistry = this.context.componentRegistry;
        var ComponentClass = componentRegistry.get(node.type);
        if (ComponentClass.prototype._isIsolatedNodeComponent) {
          return $$(ComponentClass, { node: node }).ref(node.id);
        } else {
          return $$(IsolatedNodeComponent, { node: node }).ref(node.id);
        }
      }
    };

    this._deriveInternalState = function(props) {
      var _state = this._state;
      if (!props.hasOwnProperty('enabled') || props.enabled) {
        _state.enabled = true;
      } else {
        _state.enabled = false;
      }
    };

    this._handleUpOrDownArrowKey = function (event) {
      event.stopPropagation();
      var direction = (event.keyCode === keys$2.UP) ? 'left' : 'right';
      var selState = this.getDocumentSession().getSelectionState();
      var sel = selState.getSelection();

      // Note: this collapses the selection, just to let ContentEditable continue doing a cursor move
      if (sel.isNodeSelection() && sel.isFull() && !event.shiftKey) {
        this.domSelection.collapse(direction);
      }
      // HACK: ATM we have a cursor behavior in Chrome and FF when collapsing a selection
      // e.g. have a selection from up-to-down and the press up, seems to move the focus
      else if (!platform$2.isIE && !sel.isCollapsed() && !event.shiftKey) {
        var doc = this.getDocument();
        if (direction === 'left') {
          this.setSelection(doc.createSelection(sel.start.path, sel.start.offset));
        } else {
          this.setSelection(doc.createSelection(sel.end.path, sel.end.offset));
        }
      }
      // Note: we need this timeout so that CE updates the DOM selection first
      // before we try to map it to the model
      window.setTimeout(function() {
        if (!this.isMounted()) return;
        this._updateModelSelection({ direction: direction });
      }.bind(this));
    };

    this._handleLeftOrRightArrowKey = function (event) {
      event.stopPropagation();
      var direction = (event.keyCode === keys$2.LEFT) ? 'left' : 'right';
      var selState = this.getDocumentSession().getSelectionState();
      var sel = selState.getSelection();
      // Note: collapsing the selection and let ContentEditable still continue doing a cursor move
      if (sel.isNodeSelection() && sel.isFull() && !event.shiftKey) {
        event.preventDefault();
        this.setSelection(sel.collapse(direction));
        return;
      } else {
        _super._handleLeftOrRightArrowKey.call(this, event);
      }
    };

    this._handleEnterKey = function(event) {
      var sel = this.getDocumentSession().getSelection();
      if (sel.isNodeSelection() && sel.isFull()) {
        event.preventDefault();
        event.stopPropagation();
      } else {
        _super._handleEnterKey.apply(this, arguments);
      }
    };

    // Used by Clipboard
    this.isContainerEditor = function() {
      return true;
    };

    /**
      Returns the containerId the editor is bound to
    */
    this.getContainerId = function() {
      return this.containerId;
    };

    // TODO: do we really need this in addition to getContainerId?
    this.getContainer = function() {
      return this.getDocument().get(this.getContainerId());
    };

    this.isEmpty = function() {
      var containerNode = this.getContainer();
      return (containerNode && containerNode.nodes.length === 0);
    };

    this.isEditable = function() {
      return _super.isEditable.call(this) && !this.isEmpty();
    };

    /*
      TODO: Select first content to be found
    */
    this.selectFirst = function() {
      console.warn('TODO: Implement selection of first content to be found.');
    };

    /*
      Register custom editor behavior using this method
    */
    this.extendBehavior = function(extension) {
      extension.register(this.editingBehavior);
    };

    this.getTextTypes = function() {
      return this.textTypes || [];
    };

    // Used by SwitchTextTypeTool
    // TODO: Filter by enabled commands for this Surface
    this.getTextCommands = function() {
      var textCommands = {};
      this.commandRegistry.each(function(cmd) {
        if (cmd.constructor.static.textTypeName) {
          textCommands[cmd.getName()] = cmd;
        }
      });
      return textCommands;
    };

    /* Editing behavior */


    /**
      Performs a {@link model/transform/breakNode} transformation
    */
    this.break = function(tx, args) {
      return breakNode$3(tx, args);
    };

    /**
      Performs an {@link model/transform/insertNode} transformation
    */
    this.insertNode = function(tx, args) {
      if (args.selection.isPropertySelection() || args.selection.isContainerSelection()) {
        return insertNode$1(tx, args);
      }
    };

    /**
     * Performs a {@link model/transform/switchTextType} transformation
     */
    this.switchType = function(tx, args) {
      if (args.selection.isPropertySelection()) {
        return switchTextType$2(tx, args);
      }
    };

    /**
      Selects all content in the container
    */
    this.selectAll = function() {
      var doc = this.getDocument();
      var container = doc.get(this.getContainerId());
      if (container.nodes.length === 0) {
        return;
      }
      var firstNodeId = container.nodes[0];
      var lastNodeId = last$6(container.nodes);
      var sel = doc.createSelection({
        type: 'container',
        containerId: container.id,
        startPath: [firstNodeId],
        startOffset: 0,
        endPath: [lastNodeId],
        endOffset: 1
      });
      this.setSelection(sel);
    };

    this.selectFirst = function() {
      var doc = this.getDocument();
      var nodes = this.getContainer().nodes;
      if (nodes.length === 0) {
        console.warn('ContainerEditor.selectFirst(): Container is empty.');
        return;
      }
      var node = doc.get(nodes[0]);
      var sel;
      if (node.isText()) {
        sel = doc.createSelection(node.getTextPath(), 0);
      } else {
        sel = doc.createSelection(this.getContainerId(), [node.id], 0, [node.id], 1);
      }
      this.setSelection(sel);
    };

    /**
      Performs a {@link model/transform/paste} transformation
    */
    this.paste = function(tx, args) {
      if (args.selection.isPropertySelection() || args.selection.isContainerSelection()) {
        return paste$1(tx, args);
      }
    };

    this.onContainerChange = function(change) {
      var doc = this.getDocument();
      // first update the container
      var renderContext = RenderingEngine$1.createContext(this);
      var $$ = renderContext.$$;
      var container = this.getContainer();
      var path = container.getContentPath();
      for (var i = 0; i < change.ops.length; i++) {
        var op = change.ops[i];
        if (op.type === "update" && op.path[0] === path[0]) {
          var diff = op.diff;
          if (diff.type === "insert") {
            var nodeId = diff.getValue();
            var node = doc.get(nodeId);
            var nodeEl;
            if (node) {
              nodeEl = this._renderNode($$, node);
            } else {
              // node does not exist anymore
              // so we insert a stub element, so that the number of child
              // elements is consistent
              nodeEl = $$('div');
            }
            this.insertAt(diff.getOffset(), nodeEl);
          } else if (diff.type === "delete") {
            this.removeAt(diff.getOffset());
          }
        }
      }
    };

    // Create a first text element
    this.onCreateText = function(e) {
      e.preventDefault();

      var newSel;
      this.transaction(function(tx) {
        var container = tx.get(this.props.containerId);
        var textType = tx.getSchema().getDefaultTextType();
        var node = tx.create({
          id: uuid$f(textType),
          type: textType,
          content: ''
        });
        container.show(node.id);

        newSel = tx.createSelection({
          type: 'property',
          path: [ node.id, 'content'],
          startOffset: 0,
          endOffset: 0
        });
      }.bind(this));
      this.rerender();
      this.setSelection(newSel);
    };

    this.transaction = function(transformation, info) {
      var documentSession = this.documentSession;
      var surfaceId = this.getId();
      var containerId = this.getContainerId();
      return documentSession.transaction(function(tx, args) {
        var sel = tx.before.selection;
        if (sel && !sel.isNull()) {
          sel.containerId = sel.containerId || containerId;
        }
        tx.before.surfaceId = surfaceId;
        args.containerId = this.getContainerId();
        args.editingBehavior = this.editingBehavior;
        var result = transformation(tx, args);
        if (result) {
          sel = result.selection;
          if (sel && !sel.isNull()) {
            sel.containerId = containerId;
          }
          return result;
        }
      }.bind(this), info);
    };

  };

  Surface.extend(ContainerEditor$2);

  ContainerEditor$2.static.isContainerEditor = true;

  module.exports = ContainerEditor$2;

  var inBrowser$1 = require('../util/inBrowser');

  var DOMElementImpl;

  if (inBrowser$1) {
    DOMElementImpl = require('./BrowserDOMElement.js');
  } else {
    DOMElementImpl = require('./CheerioDOMElement.js');
  }

  var DefaultDOMElement$7 = {};

  DefaultDOMElement$7.createTextNode = function(text) {
    var el = DOMElementImpl.createTextNode(text);
    return new DOMElementImpl(el);
  };

  DefaultDOMElement$7.createElement = function(tagName) {
    var el = DOMElementImpl.createElement(tagName);
    return new DOMElementImpl(el);
  };

  DefaultDOMElement$7._create = function(el) {
    return new DOMElementImpl(el);
  };

  /*
    A wrapper for Browser's `window` providing
    the DOMElement's eventlistener API.
  */
  DefaultDOMElement$7.getBrowserWindow = function() {
    if (inBrowser$1) {
      return DOMElementImpl.getBrowserWindow();
    } else {
      // just a stub if not in browser
      return DefaultDOMElement$7.createElement('div');
    }
  };

  /*
    @param {String} html
    @returns {DOMElement|DOMElement[]}
  */
  DefaultDOMElement$7.parseHTML = function(html) {
    return DOMElementImpl.parseMarkup(html, 'html');
  };

  /*
    @param {String} xml
    @returns {DOMElement|DOMElement[]}
  */
  DefaultDOMElement$7.parseXML = function(xml, fullDoc) {
    return DOMElementImpl.parseMarkup(xml, 'xml', fullDoc);
  };

  DefaultDOMElement$7.wrapNativeElement = function(el) {
    if (el) {
      if (inBrowser$1 && (el instanceof window.Node || el === window) ) {
        var BrowserDOMElement = require('./BrowserDOMElement');
        return BrowserDOMElement.wrapNativeElement(el);
      } else if (el.root && el.root.type === "root" ) {
        var CheerioDOMElement = require('./CheerioDOMElement');
        return CheerioDOMElement.wrapNativeElement(el);
      }
    } else {
      return null;
    }
  };

  DefaultDOMElement$7.isReverse = function(anchorNode, anchorOffset, focusNode, focusOffset) {
    if (inBrowser$1 ) {
      var BrowserDOMElement = require('./BrowserDOMElement');
      return BrowserDOMElement.isReverse(anchorNode, anchorOffset, focusNode, focusOffset);
    } else {
      throw new Error('Not implemented.');
    }
  };

  module.exports = DefaultDOMElement$7;

  var oo$w = require('../util/oo');

  /**
   Default label provider implementation
  */

  function LabelProvider(labels, lang) {
    this.lang = lang || 'en';
    this.labels = labels;
  }

  LabelProvider.Prototype = function() {

    this.getLabel = function(name) {
      var labels = this.labels[this.lang];
      if (!labels) return name;
      return labels[name] || name;
    };
  };

  oo$w.initClass(LabelProvider);

  module.exports = LabelProvider;

  /*
    A wrapper for native DOM events when using event delegation via
    `DOMElement.on(eventName, selector, handler)`.

    @param [Component] owner
    @param [Element] selectedTarget native DOM element
    @param [Event] originalEvent native DOM event
  */
  function DelegatedEvent$1(owner, selectedTarget, originalEvent) {
    this.owner = owner;
    this.target = selectedTarget;
    this.originalEvent = originalEvent;
  }

  module.exports = DelegatedEvent$1;

  /* eslint-disable no-unused-vars */

  var oo$x = require('../util/oo');
  var isFunction$2 = require('lodash/isFunction');
  var isObject$4 = require('lodash/isObject');
  var isString$k = require('lodash/isString');
  var isArray$d = require('lodash/isArray');
  var findIndex = require('lodash/findIndex');
  var forEach$8 = require('lodash/forEach');
  var ArrayIterator$1 = require('../util/ArrayIterator');

  /**
    A unified interface for DOM elements used by Substance.

    There are three different implementations of this interface:
    - {@link ui/DefaultDOMElement}
    - {@link ui/VirtualDOMElement}
    - {@link ui/Component}

    Methods which rely on a CSS selector implementation are only available for {@link ui/DefaultDOMElement} instance, which is used during DOM import.
    I.e., don't use the following methods in Component renderers:
    - {@link ui/DOMElement#is}
    - {@link ui/DOMElement#find}
    - {@link ui/DOMElement#findAll}

    @class
    @abstract
    @interface
  */
  function DOMElement$3() {

    /**
      The element's id.
      @property {String} ui/DOMElement#id
    */

    /**
      The element's tag name in lower case.
      @property {String} ui/DOMElement#tagName
    */

    /**
      @property {String} ui/DOMElement#textContent
     */

    /**
      The inner HTML string.

      @property {String} ui/DOMElement#innerHTML
     */

    /**
      The outer HTML string.

      @property {String} ui/DOMElement#outerHTML
     */

    /**
      An array of child nodes, including nodes such as TextNodes.

      @property {Array<ui/DOMElement>} ui/DOMElement#childNodes
     */

    /**
      An array of child elements.

      @property {Array<ui/DOMElement>} ui/DOMElement#children children
     */

    /**
      The computed height.

      @property {Array<ui/DOMElement>} ui/DOMElement#height
     */

    /**
      The computed width.

      @property {Array<ui/DOMElement>} ui/DOMElement#width
     */

  }

  DOMElement$3.Prototype = function() {

    this._isDOMElement = true;

    var NOT_IMPLEMENTED = 'This method is not implemented.';

    this.getNativeElement = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Checks if a CSS class is set.

      @abstract
      @param {String} className
      @returns {Boolean} true if the CSS class is set
    */
    this.hasClass = function(className) {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Adds a CSS class.

      @abstract
      @param {String} classString A space-separated string with CSS classes
      @returns {this}
    */
    this.addClass = function(classString) {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Removes a CSS class.

      @abstract
      @param {String} classString A space-separated string with CSS classes
      @returns {this}
    */
    this.removeClass = function(classString) {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      jQuery style getter and setter for attributes.

      @abstract
      @param {String} name
      @param {String} [value] if present the attribute will be set
      @returns {String|this} if used as getter the attribute value, otherwise this element for chaining
     */
    this.attr = function() {
      if (arguments.length === 1) {
        if (isString$k(arguments[0])) {
          return this.getAttribute(arguments[0]);
        } else if (isObject$4(arguments[0])) {
          forEach$8(arguments[0], function(value, name) {
            this.setAttribute(name, value);
          }.bind(this));
        }
      } else if (arguments.length === 2) {
        this.setAttribute(arguments[0], arguments[1]);
      }
      return this;
    };

    /**
      Removes an attribute.

      @abstract
      @param {String} name
      @returns {this}
    */
    this.removeAttr = function(name) {
      var names = name.split(/\s+/);
      if (names.length === 1) {
        this.removeAttribute(name);
      } else {
        names.forEach(function(name) {
          this.removeAttribute(name);
        }.bind(this));
      }
      return this;
    };

    /**
      Get the attribute with a given name.

      @abstract
      @returns {String} the attribute's value.
    */
    this.getAttribute = function(name) {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Set the attribute with a given name.

      @abstract
      @param {String} the attribute's value.
      @returns {this}
    */
    this.setAttribute = function(name, value) {
      throw new Error(NOT_IMPLEMENTED);
    };

    this.removeAttribute = function(name) {
      throw new Error(NOT_IMPLEMENTED);
    };

    this.getAttributes = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      jQuery style getter and setter for HTML element properties.

      @abstract
      @param {String} name
      @param {String} [value] if present the property will be set
      @returns {String|this} if used as getter the property value, otherwise this element for chaining
     */
    this.htmlProp = function() {
      if (arguments.length === 1) {
        if (isString$k(arguments[0])) {
          return this.getProperty(arguments[0]);
        } else if (isObject$4(arguments[0])) {
          forEach$8(arguments[0], function(value, name) {
            this.setProperty(name, value);
          }.bind(this));
        }
      } else if (arguments.length === 2) {
        this.setProperty(arguments[0], arguments[1]);
      }
      return this;
    };

    this.getProperty = function(name) {
      throw new Error(NOT_IMPLEMENTED);
    };

    this.setProperty = function(name, value) {
      throw new Error(NOT_IMPLEMENTED);
    };

    this.removeProperty = function(name) {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Get the tagName of this element.

      @abstract
      @private
      @note Considered as private API, in favor of the property {ui/DOMElement.prototype.tagName}
      @returns {String} the tag name in lower-case.
     */
    this.getTagName = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Set the tagName of this element.

      @abstract
      @private
      @note Considered as private API, in favor of the property {ui/DOMElement.prototype.tagName}
      @param {String} tagName the new tag name
      @returns {this}
    */
    this.setTagName = function(tagName) {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Get the id of this element.

      @abstract
      @private
      @note Considered as private API, in favor of the property {ui/DOMElement.prototype.id}
      @returns {String} the id.
     */
    this.getId = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Set the id of this element.

      @abstract
      @private
      @note Considered as private API, in favor of the property {ui/DOMElement.prototype.id}
      @param {String} id the new id
      @returns {this}
    */
    this.setId = function(id) {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      jQuery style getter and setter for the *value* of an element.

      @abstract
      @param {String} [value] The value to set.
      @returns {String|this} the value if used as a getter, `this` otherwise
    */
    this.val = function(value) {
      if (arguments.length === 0) {
        return this.getValue();
      } else {
        this.setValue(value);
        return this;
      }
    };

    this.getValue = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    this.setValue = function(value) {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      jQuery style method to set or get inline CSS styles.

      @param {String} name the style name
      @param {String} [value] the style value
      @returns {String|this} the style value or this if used as a setter
    */
    this.css = function() {
      if (arguments.length === 1) {
        if (isString$k(arguments[0])) {
          return this.getStyle(arguments[0]);
        } else if (isObject$4(arguments[0])) {
          forEach$8(arguments[0], function(value, name) {
            this.setStyle(name, value);
          }.bind(this));
        } else {
          throw new Error('Illegal arguments.');
        }
      } else if (arguments.length === 2) {
        this.setStyle(arguments[0], arguments[1]);
      } else {
        throw new Error('Illegal arguments.');
      }
      return this;
    };

    this.getStyle = function(name) {
      throw new Error(NOT_IMPLEMENTED);
    };

    this.setStyle = function(name, value) {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Gets or sets the text content of an element.

      @abstract
      @param {String} [text] The text content to set.
      @returns {String|this} The text content if used as a getter, `this` otherwise
    */
    this.text = function(text) {
      if (arguments.length === 0) {
        return this.getTextContent();
      } else {
        this.setTextContent(text);
      }
      return this;
    };

    /**
      Get the textContent of this element.

      @abstract
      @private
      @note Considered as private API, in favor of the property {ui/DOMElement.prototype.innerHTML}
      @returns {String}
    */
    this.getTextContent = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Set the textContent of this element.

      @abstract
      @private
      @note Considered as private API, in favor of the property {ui/DOMElement.prototype.innerHTML}
      @param {String} text the new text content
      @returns {this}
    */
    this.setTextContent = function(text) {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      jQuery style getter and setter for the innerHTML of an element.

      @abstract
      @param {String} [html] The html to set.
      @returns {String|this} the inner html if used as a getter, `this` otherwise
     */
    this.html = function(html) {
      if (arguments.length === 0) {
        return this.getInnerHTML();
      } else {
        this.setInnerHTML(html);
      }
      return this;
    };

    /**
      Get the innerHTML of this element.

      @abstract
      @private
      @note Considered as private API, in favor of the property {@link ui/DOMElement.prototype.innerHTML}
      @returns {String}
    */
    this.getInnerHTML = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Set the innerHTML of this element.

      @abstract
      @private
      @note Considered as private API, in favor of the property {@link ui/DOMElement.prototype.innerHTML}
      @param {String} text the new text content
      @returns {this}
    */
    this.setInnerHTML = function(html) {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Get the outerHTML of this element.

      @abstract
      @private
      @note Considered as private API, in favor of the property {@link ui/DOMElement.prototype.outerHTML}
      @returns {String}
    */
    this.getOuterHTML = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Registers an Element event handler.

      @param {String} event The event name.
      @param {String} [selector] A css selector which is used to filter events by evaluating `event.target.is(selector)`.
      @param {Function} handler The handler function.
      @returns {this}
    */
    this.on = function(eventName, handler, context, options) {
      if (!isString$k(eventName)) {
        throw new Error('Illegal argument: "event" must be a String.');
      }
      options = options || {};
      if (context) {
        options.context = context;
      }
      if (options.selector && !isString$k(options.selector)) {
        throw new Error('Illegal argument: selector must be a string.');
      }
      if (!handler || !isFunction$2(handler)) {
        throw new Error('Illegal argument: invalid handler function for event ' + eventName);
      }
      this.addEventListener(eventName, handler, options);
      return this;
    };

    /**
      Unregisters the handler of a given event.

      @param {String} event The event name.
      @returns {this}
    */
    this.off = function(eventName, handler) {
      // el.off(this): disconnect all listeners bound to the given context
      if (arguments.length === 1 && !isString$k(eventName)) {
        var context = arguments[0];
        var listeners = this.getEventListeners().filter(function(l) {
          return l.context === context;
        }).forEach(function(l) {
          this.removeEventListener(l);
        }.bind(this));
      } else {
        this.removeEventListener(eventName, handler);
      }
      return this;
    };

    this.addEventListener = function(eventName, handler, options) {
      throw new Error(NOT_IMPLEMENTED);
    };

    this.removeEventListener = function(eventName, handler) {
      throw new Error(NOT_IMPLEMENTED);
    };

    this.getEventListeners = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Gets the type of this element in lower-case.

      @private
      @note Considered as private API, in favor of the property {@link ui/DOMElement.prototype.nodeType}
      @returns {String}
    */
    this.getNodeType = function() {
      if (this.isTextNode()) {
        return "text";
      } else if (this.isCommentNode()) {
        return "comment";
      } else if (this.isElementNode()) {
        return "element";
      } else if (this.isDocumentNode()) {
        return "document";
      } else {
        throw new Error("Unsupported node type");
      }
    };

    this.getChildCount = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Get child nodes of this element.

      This method provides a new array with wrapped native elements.
      Better use getChildAt().

      @abstract
      @private Considered as private API, in favor of the property {ui/DOMElement.prototype.childNodes}
      @returns {Array<ui/DOMElement>}
     */
    this.getChildNodes = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Get child elements of this element.

      This method provides a new array with wrapped native elements.
      Better use getChildAt().

      @abstract
      @private Considered as private API, in favor of the property {ui/DOMElement.prototype.children}
      @returns {Array<ui/DOMElement>}
     */
    this.getChildren = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    this.getChildAt = function(pos) {
      throw new Error(NOT_IMPLEMENTED);
    };

    this.getChildIndex = function(child) {
      throw new Error(NOT_IMPLEMENTED);
    };

    this.getChildNodeIterator = function() {
      return new ArrayIterator$1(this.getChildNodes());
    };

    this.getLastChild = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    this.getFirstChild = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    this.getNextSibling = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    this.getPreviousSibling = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Checks if the element is a TextNode.

      @abstract
      @returns {Boolean} true if the element is of type `Node.TEXT_NODE`
     */
    this.isTextNode = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Checks if the element is actually an element as opposed to a node.

      @abstract
      @returns {Boolean} true if the element is of type `Node.ELEMENT_NODE`
     */
    this.isElementNode = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Checks if the element is a CommentNode.

      @abstract
      @returns {Boolean} true if the element is of type `Node.COMMENT_NODE`
     */
    this.isCommentNode = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Checks if the element is a DocumentNode.

      @abstract
      @returns {Boolean} true if the element is of type `Node.DOCUMENT_NODE`
     */
    this.isDocumentNode = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Creates a clone of the current element.

      @abstract
      @returns {ui/DOMElement} A clone of this element.
    */
    this.clone = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Creates a DOMElement.

      @param {String} str a tag name or an HTML element as string.
      @returns {ui/DOMElement}
    */
    this.createElement = function(str) {
      throw new Error(NOT_IMPLEMENTED);
    };

    this.createTextNode = function(text) {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Checks if a given CSS selector matches for this element.

      **Attention**
      This method is currently not implemented for {ui/VirtualElement}.
      This means you should use it only in importer implementations.

      @abstract
      @param {String} cssSelector
      @returns {Boolean}
     */
    this.is = function(cssSelector) {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Get the parent element of this element.

      @abstract
      @returns {ui/DOMElement} the parent element
     */
    this.getParent = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Get the root ancestor element of this element.

      In the browser this is the `window.document`.

      @abstract
      @returns {ui/DOMElement} the root element
     */
    this.getRoot = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Find the first descendant element matching the given CSS selector.
      Note this differs from jQuery.find() that it returns only one element.

      **Attention**
      This method is currently not implemented for {ui/VirtualElement}.
      This means you can use it only in importer implementations, but not in render or exporter implementations.

      @abstract
      @param {String} cssSelector
      @returns {ui/DOMElement} found element
     */
    this.find = function(cssSelector) {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Find all descendant elements matching the given CSS selector.

      **Attention**
      This method is currently not implemented for {ui/VirtualElement}.
      This means you can use it only in importer implementations, but not in render or exporter implementations.

      @abstract
      @param {String} cssSelector
      @returns {Array<ui/DOMElement>} found elements
     */
    this.findAll = function(cssSelector) {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Append a child element.

      @abstract
      @param {ui/DOMElement|String} child An element or text to append
      @returns {this}
     */
    this.append = function(child) {
      var children;
      if (arguments.length === 1) {
        if (isArray$d(child)) {
          children = child;
        } else {
          this.appendChild(child);
          return this;
        }
      } else {
        children = arguments;
      }
      if (children) {
        Array.prototype.forEach.call(children, this.appendChild.bind(this));
      }
      return this;
    };

    this.appendChild = function(child) {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Insert a child element at a given position.

      @abstract
      @param {Number} pos insert position
      @param {ui/DOMElement|String} child The child element or text to insert.
      @returns {this}
    */
    this.insertAt = function(pos, child) {
      throw new Error(NOT_IMPLEMENTED);
    };

    this.insertBefore = function(newChild, before) {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Remove the child at a given position.

      @abstract
      @param {Number} pos
      @returns {this}
    */
    this.removeAt = function(pos) {
      throw new Error(NOT_IMPLEMENTED);
    };

    this.removeChild = function(child) {
      throw new Error(NOT_IMPLEMENTED);
    };

    this.replaceChild = function(oldChild, newChild) {
      throw new Error(NOT_IMPLEMENTED);
    };

    this.remove = function() {
      var parent = this.getParent();
      if (parent) {
        parent.removeChild(this);
      }
    };

    /**
      Removes all child nodes from this element.

      @abstract
      @returns {this}
    */
    this.empty = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    /**
      Removes this element from its parent.

      @abstract
      @returns {this}
    */
    this.remove = function() {
      throw new Error(NOT_IMPLEMENTED);
    };

    this.serialize = function() {
      return this.outerHTML;
    };

    this.isInDocument = function() {
      return false;
    };

    /**
      Focusses this element.

      **Attention: this makes only sense for elements which are rendered in the browser**

    */
    this.focus = function() {
      return this;
    };

    /**
      Blur this element.
    */
    this.blur = function() {
      return this;
    };

    /**
      Trigger a click event on this element.
    */
    this.click = function() {
      return this;
    };

    /* API to retrieve layout information */

    this.getWidth = function() {
      return 0;
    };

    this.getHeight = function() {
      return 0;
    };

    /**
      Outer height as provided by $.outerHeight(withMargin)
    */
    this.getOuterHeight = function(withMargin) {
      return 0;
    };

    /**
      Offset values as provided by $.offset()
    */
    this.getOffset = function() {
      return { top: 0, left: 0 };
    };

    /**
      Position values as provided by $.position()
    */
    this.getPosition = function() {
      return { top: 0, left: 0 };
    };

  };

  oo$x.initClass(DOMElement$3);


  var _propertyDefinitions = {
    'id': {
      configurable: true,
      get: function() {
        return this.getId();
      },
      set: function(id) {
        this.setId(id);
      }
    },
    'tagName': {
      configurable: true,
      get: function() {
        return this.getTagName();
      },
      set: function(tagName) {
        this.setTagName(tagName);
      }
    },
    'nodeName': {
      configurable: true,
      get: function() {
        return this.getTagName();
      }
    },
    'nodeType': {
      configurable: true,
      get: function() {
        return this.getNodeType();
      },
      set: function() {
        throw new Error('ui/DOMElement#nodeType is readonly.');
      }
    },
    'textContent': {
      configurable: true,
      get: function() {
        return this.getTextContent();
      },
      set: function(text) {
        this.setTextContent(text);
      }
    },
    'innerHTML': {
      configurable: true,
      get: function() {
        return this.getInnerHTML();
      },
      set: function(html) {
        this.setInnerHTML(html);
      }
    },
    'outerHTML': {
      configurable: true,
      get: function() {
        return this.getOuterHTML();
      },
      set: function() {
        throw new Error('ui/DOMElement#outerHTML is readonly.');
      }
    },
    'childNodes': {
      configurable: true,
      get: function() {
        return this.getChildNodes();
      },
      set: function() {
        throw new Error('ui/DOMElement#childNodes is readonly.');
      }
    },
    'children': {
      configurable: true,
      get: function() {
        return this.getChildren();
      },
      set: function() {
        throw new Error('ui/DOMElement#children is readonly.');
      }
    },
    'parentNode': {
      configurable: true,
      get: function() {
        return this.getParent();
      },
      set: function() {
        throw new Error('ui/DOMElement#parentNode is readonly.');
      }
    },
    'height': {
      configurable: true,
      get: function() {
        return this.getHeight();
      },
    },
    'width': {
      configurable: true,
      get: function() {
        return this.getWidth();
      },
    },
  };

  DOMElement$3._propertyNames = Object.keys(_propertyDefinitions);

  DOMElement$3._defineProperties = function(DOMElementClass, propertyNames) {
    propertyNames = propertyNames || DOMElement$3._propertyNames;
    propertyNames.forEach(function(name) {
      var def = _propertyDefinitions[name];
      if (def) {
        Object.defineProperty(DOMElementClass.prototype, name, def);
      }
    });
  };

  /**
    Parses a given HTML string.

    @param {String} html HTML string
    @returns {Array<ui/DefaultDOMElement>} parsed elements
  */
  DOMElement$3.parseHTML = function(html) {
    var DefaultDOMElement = require('./DefaultDOMElement');
    return DefaultDOMElement.parseHTML(html);
  };

  DOMElement$3.parseXML = function(xml) {
    var DefaultDOMElement = require('./DefaultDOMElement');
    return DefaultDOMElement.parseXML(xml);
  };

  function DOMElementDelegator() {
    this.el = null;
  }

  DOMElementDelegator.Prototype = function() {

    var _delegators = {
      'getNativeElement': null,
      'hasClass': false,
      'getAttribute': null,
      'getAttributes': {},
      'getProperty': null,
      'getTagName': 'throw',
      'getId': 'throw',
      'getValue': null,
      'getStyle': null,
      'getTextContent': '',
      'getInnerHTML': '',
      'getOuterHTML': '',
      'getChildCount': 0,
      'getChildNodes': [],
      'getChildren': [],
      'getChildAt': null,
      'getParent': null,
      'getRoot': null,
      'getEventListeners': [],
      'find': null,
      'findAll': [],
      'is': false,
      'isTextNode': false,
      'isElementNode': false,
      'isCommentNode': false,
      'isDocumentNode': false,
      'isInDocument': false,
      'position': null
    };

    forEach$8(_delegators, function(defaultValue, method) {
      this[method] = function() {
        if (!this.el) {
          if (defaultValue === 'throw') {
            throw new Error('This component has not been rendered yet.');
          } else {
            return defaultValue;
          }
        }
        return this.el[method].apply(this.el, arguments);
      };
    }.bind(this));

    // Delegators implementing the DOMElement interface
    // these are chainable
    [
      'addClass', 'removeClass',
      'setAttribute', 'removeAttribute',
      'setProperty', 'removeProperty',
      'setTagName', 'setId', 'setValue', 'setStyle',
      'setTextContent', 'setInnerHTML',
      'addEventListener', 'removeEventListener',
      'appendChild', 'insertAt', 'insertBefore',
      'remove', 'removeAt', 'removeChild', 'replaceChild', 'empty',
      'focus', 'blur', 'click'
    ].forEach(function(method) {
      this[method] = function() {
        if (!this.el) {
          throw new Error('This component has not been rendered yet.');
        }
        this.el[method].apply(this.el, arguments);
        return this;
      };
    }.bind(this));
  };

  DOMElement$3.extend(DOMElementDelegator);
  DOMElement$3.Delegator = DOMElementDelegator;

  function DOMEventListener(eventName, handler, options) {
    if (!isString$k(eventName) || !isFunction$2(handler)) {
      throw new Error("Illegal arguments: 'eventName' must be a String, and 'handler' must be a Function.");
    }
    options = options || {};
    var origHandler = handler;
    var context = options.context;
    var capture = Boolean(options.capture);

    if (context) {
      handler = handler.bind(context);
    }
    if (options.once === true) {
      handler = _once(this, handler);
    }

    this.eventName = eventName;
    this.originalHandler = origHandler;
    this.handler = handler;
    this.capture = capture;
    this.context = context;
    this.options = options;
    // set when this gets attached to a DOM element
    this._el = null;
  }

  DOMEventListener.prototype._isDOMEventListener = true;

  DOMEventListener.matches = function(l1, l2) {
    return l1.eventName === l2.eventName && l1.originalHandler === l2.originalHandler;
  };

  function _once(listener, handler) {
    return function(event) {
      handler(event);
      listener._el.removeEventListener(listener);
    };
  }

  DOMElement$3.EventListener = DOMEventListener;

  DOMElement$3._findEventListenerIndex = function(eventListeners, eventName, handler) {
    var idx = -1;
    if (arguments[1]._isDOMEventListener) {
      idx = eventListeners.indexOf(arguments[1]);
    } else {
      idx = findIndex(eventListeners,
        DOMEventListener.matches.bind(null, {
          eventName: eventName,
          originalHandler: handler
        })
      );
    }
    return idx;
  };

  function TextNode$3() {}

  TextNode$3.Prototype = function() {
    this._isDOMElement = true;

    this.isTextNode = function() {
      return true;
    };

    this.getNodeType = function() {
      return 'text';
    };

    this.isElementNode =
    this.isDocumentNode =
    this.isCommentNode = function() {
      return false;
    };

    [
      'getParent', 'getNextSibling', 'getPreviousSibling',
      'text', 'getTextContent', 'setTextContent',
      'clone'
    ].forEach(function(name) {
      this[name] = DOMElement$3.prototype[name];
    }.bind(this));

  };

  oo$x.initClass(TextNode$3);

  DOMElement$3.TextNode = TextNode$3;

  module.exports = DOMElement$3;

  var last$7 = require('lodash/last');
  var oo$y = require('../util/oo');
  var Coordinate$7 = require('../model/Coordinate');
  var Range$3 = require('../model/Range');
  var DefaultDOMElement$8 = require('./DefaultDOMElement');
  var TextPropertyComponent = require('./TextPropertyComponent');
  var InlineNodeComponent$1 = require('./InlineNodeComponent');
  var IsolatedNodeComponent$1 = require('./IsolatedNodeComponent');

  /*
   * A class that maps DOM selections to model selections.
   *
   * There are some difficulties with mapping model selections:
   * 1. DOM selections can not model discontinuous selections.
   * 2. Not all positions reachable via ContentEditable can be mapped to model selections. For instance,
   *    there are extra positions before and after non-editable child elements.
   * 3. Some native cursor behaviors need to be overidden.
   *
   * @class DOMSelection
   * @constructor
   * @param {Element} rootElement
   */
  function DOMSelection(surface) {
    this.surface = surface;
    this._wrange = window.document.createRange();
  }

  DOMSelection.Prototype = function() {

    /**
      Create a model selection by mapping the current DOM selection
      to model coordinates.

      @param {object} options
        - `direction`: `left` or `right`; a hint for disambiguations, used by Surface during cursor navigation.
      @returns {model/Selection}
    */
    this.getSelection = function(options) {
      var range = this.mapDOMSelection(options);
      var doc = this.surface.getDocument();
      return doc.createSelection(range);
    };

    // function _printStacktrace() {
    //   try {
    //     throw new Error();
    //   } catch (err) {
    //     console.log(err.stack);
    //   }
    // }

    /**
      Transfer a given model selection into the DOM.

      @param {model/Selection} sel
    */
    this.setSelection = function(sel) {
      // console.log('### DOMSelection: setting selection', sel.toString());
      var wSel = window.getSelection();
      if (sel.isNull() || sel.isCustomSelection()) {
        this.clear();
        return;
      }
      var start, end;
      if (sel.isPropertySelection() || sel.isContainerSelection()) {
        start = this._getDOMCoordinate(sel.start);
        if (!start) {
          console.warn('FIXME: selection seems to be invalid.');
          this.clear();
          return;
        }
        if (sel.isCollapsed()) {
          end = start;
        } else {
          end = this._getDOMCoordinate(sel.end);
          if (!end) {
            console.warn('FIXME: selection seems to be invalid.');
            this.clear();
            return;
          }
        }
      } else if (sel.isNodeSelection()) {
        var comp = this.surface.find('*[data-id="'+sel.getNodeId()+'"]');
        if (!comp) {
          console.error('Could not find component with id', sel.getNodeId());
          this.clear();
          return;
        }
        if (comp._isIsolatedNodeComponent) {
          var coors = IsolatedNodeComponent$1.getDOMCoordinates(comp);
          if (sel.isFull()) {
            start = coors.start;
            end = coors.end;
          } else if (sel.isBefore()) {
            start = end = coors.start;
          } else {
            start = end = coors.end;
          }
        } else {
          var _nodeEl = comp.el;
          start = {
            container: _nodeEl.getNativeElement(),
            offset: 0
          };
          end = {
            container: _nodeEl.getNativeElement(),
            offset: _nodeEl.getChildCount()
          };
          if (sel.isBefore()) {
            end = start;
          } else if (sel.isAfter()) {
            start = end;
          }
        }
      }
      // console.log('Model->DOMSelection: mapped to DOM coordinates', start.container, start.offset, end.container, end.offset, 'isReverse?', sel.isReverse());

      // if there is a range then set replace the window selection accordingly
      var wRange;
      if (wSel.rangeCount > 0) {
        wRange = wSel.getRangeAt(0);
      } else {
        wRange = this._wrange;
      }
      wSel.removeAllRanges();
      if (sel.isCollapsed()) {
        wRange.setStart(start.container, start.offset);
        wRange.setEnd(start.container, start.offset);
        wSel.addRange(wRange);
      } else {
        if (sel.isReverse()) {
          // console.log('DOMSelection: rendering a reverse selection.');
          var tmp = start;
          start = end;
          end = tmp;
          // HACK: using wRange setEnd does not work reliably
          // so we set just the start anchor
          // and then use window.Selection.extend()
          // unfortunately we are not able to test this behavior as it needs
          // triggering native keyboard events
          wRange.setStart(start.container, start.offset);
          wRange.setEnd(start.container, start.offset);
          wSel.addRange(wRange);
          wSel.extend(end.container, end.offset);
        } else {
          wRange.setStart(start.container, start.offset);
          wRange.setEnd(end.container, end.offset);
          wSel.addRange(wRange);
        }
      }
      // console.log('Model->DOMSelection: mapped selection to DOM', 'anchorNode:', wSel.anchorNode, 'anchorOffset:', wSel.anchorOffset, 'focusNode:', wSel.focusNode, 'focusOffset:', wSel.focusOffset, 'collapsed:', wSel.collapsed);
    };

    this._getDOMCoordinate = function(coor) {
      var comp, domCoor = null;
      if (coor.isNodeCoordinate()) {
        comp = this.surface.find('*[data-id="'+coor.getNodeId()+'"]');
        if (comp) {
          if (comp._isIsolatedNodeComponent) {
            domCoor = IsolatedNodeComponent$1.getDOMCoordinate(comp, coor);
          } else {
            domCoor = {
              container: comp.getNativeElement(),
              offset: coor.offset
            };
          }
        }
      } else {
        comp = this.surface._getTextPropertyComponent(coor.path);
        if (comp) {
          domCoor = comp.getDOMCoordinate(coor.offset);
        }
      }
      return domCoor;
    };

    /*
      Map a DOM range to a model range.

      @param {Range} range
      @returns {model/Range}
    */
    this.mapDOMRange = function(wRange) {
      return this._getRange(wRange.startContainer, wRange.startOffset,
        wRange.endContainer, wRange.endOffset);
    };

    /*
      Maps the current DOM selection to a model range.

      @param {object} [options]
        - `direction`: `left` or `right`; a hint for disambiguations, used by Surface during cursor navigation.
      @returns {model/Range}
    */
    this.mapDOMSelection = function(options) {
      var range;
      var wSel = window.getSelection();
      // Use this log whenever the mapping goes wrong to analyze what
      // is actually being provided by the browser
      // console.log('DOMSelection->Model: anchorNode:', wSel.anchorNode, 'anchorOffset:', wSel.anchorOffset, 'focusNode:', wSel.focusNode, 'focusOffset:', wSel.focusOffset, 'collapsed:', wSel.collapsed);
      if (wSel.rangeCount === 0) {
        return null;
      }
      var anchorNode = DefaultDOMElement$8.wrapNativeElement(wSel.anchorNode);
      if (wSel.isCollapsed) {
        var coor = this._getCoordinate(anchorNode, wSel.anchorOffset, options);
        // EXPERIMENTAL: when the cursor is in an IsolatedNode
        // we return a selection for the whole node
        if (coor.__inIsolatedBlockNode__) {
          range = _createRangeForIsolatedBlockNode(coor.path[0], this.getContainerId());
        } else if (coor.__inInlineNode__) {
          // HACK: relying on hints left by InlineNodeComponent.getCoordinate()
          range = _createRange(
            new Coordinate$7(coor.path, coor.__startOffset__),
            new Coordinate$7(coor.path, coor.__endOffset__),
            false, this.getContainerId()
          );
        } else {
          range = _createRange(coor, coor, false, this.getContainerId());
        }
      }
      // HACK: special treatment for edge cases as addressed by #354.
      // Sometimes anchorNode and focusNodes are the surface
      else {
        if (anchorNode.isElementNode() && anchorNode.is('.sc-surface')) {
          range = this._getEnclosingRange(wSel.getRangeAt(0));
        } else {
          var focusNode = DefaultDOMElement$8.wrapNativeElement(wSel.focusNode);
          range = this._getRange(anchorNode, wSel.anchorOffset, focusNode, wSel.focusOffset);
        }
      }
      // console.log('DOMSelection->Model: extracted range', range.toString());
      return range;
    };

    /*
      Clear the DOM selection.
    */
    this.clear = function() {
      window.getSelection().removeAllRanges();
    };

    this.collapse = function(dir) {
      var wSel = window.getSelection();
      var wRange;
      if (wSel.rangeCount > 0) {
        wRange = wSel.getRangeAt(0);
        wRange.collapse(dir === 'left');
        wSel.removeAllRanges();
        wSel.addRange(wRange);
      }
    };

    this.getContainerId = function() {
      if (this.surface.isContainerEditor()) {
        return this.surface.getContainerId();
      } else {
        return null;
      }
    };

    /*
      Extract a model range from given DOM elements.

      @param {Node} anchorNode
      @param {number} anchorOffset
      @param {Node} focusNode
      @param {number} focusOffset
      @returns {model/Range}
    */
    this._getRange = function(anchorNode, anchorOffset, focusNode, focusOffset) {
      var start = this._getCoordinate(anchorNode, anchorOffset);
      var end;
      if (anchorNode === focusNode && anchorOffset === focusOffset) {
        end = start;
      } else {
        end = this._getCoordinate(focusNode, focusOffset);
      }
      var isReverse = DefaultDOMElement$8.isReverse(anchorNode, anchorOffset, focusNode, focusOffset);
      if (start && end) {
        return _createRange(start, end, isReverse, this.getContainerId());
      } else {
        return null;
      }
    };

    /*
      Map a DOM coordinate to a model coordinate.

      @param {Node} node
      @param {number} offset
      @param {object} options
      @param {object} [options]
        - `direction`: `left` or `right`; a hint for disambiguation.
      @returns {model/Coordinate}

      @info

      `options.direction` can be used to control the result when this function is called
      after cursor navigation. The root problem is that we are using ContentEditable on
      Container level (as opposed to TextProperty level). The native ContentEditable allows
      cursor positions which do not make sense in the model sense.

      For example,

      ```
      <div contenteditable=true>
        <p data-path="p1.content">foo</p>
        <img>
        <p data-path="p1.content">bar</p>
      </div>
      ```
      would allow to set the cursor directly before or after the image, which
      we want to prevent, as it is not a valid insert position for text.
      Instead, if we find the DOM selection in such a situation, then we map it to the
      closest valid model address. And this depends on the direction of movement.
      Moving `left` would provide the previous address, `right` would provide the next address.
      The default direction is `right`.
    */
    this._getCoordinate = function(nodeEl, offset, options) {
      // Trying to apply the most common situation first
      // and after that covering known edge cases
      var surfaceEl = this.surface.el;
      var coor = null;
      if (!coor) {
        coor = InlineNodeComponent$1.getCoordinate(nodeEl, offset);
        if (coor) {
          coor.__inInlineNode__ = true;
        }
      }
      // as this is the most often case, try to map the coordinate within
      // a TextPropertyComponent
      if (!coor) {
        coor = TextPropertyComponent.getCoordinate(surfaceEl, nodeEl, offset);
      }
      // special treatment for isolated nodes
      if (!coor) {
        coor = IsolatedNodeComponent$1.getCoordinate(surfaceEl, nodeEl, offset);
        if (coor) {
          coor.__inIsolatedBlockNode__ = true;
        }
      }
      // finally fall back to a brute-force search
      if (!coor) {
        coor = this._searchForCoordinate(nodeEl, offset, options);
      }
      return coor;
    };

    /*
      Map a DOM coordinate to a model coordinate via a brute-force search
      on all properties.

      This is used as a backup strategy for delicate DOM selections.

      @param {Node} node
      @param {number} offset
      @param {object} options
      @param {'left'|'right'} options.direction
      @returns {model/Coordinate} the coordinate
    */
    this._searchForCoordinate = function(node, offset, options) {
      // NOTE: assuming that most situations are covered by
      // TextPropertyComponent.getCoordinate already, we are trying just to
      // solve the remaining scenarios, in an opportunistic way
      options = options || {};
      options.direction = options.direction || 'right';
      var dir = options.direction;
      if (node.isElementNode()) {
        var childCount = node.getChildCount();
        offset = Math.max(0, Math.min(childCount, offset));
        var el = node.getChildAt(offset);
        while (el) {
          var textPropertyEl;
          if (dir === 'right') {
            if (el.isElementNode()) {
              if (el.getAttribute('data-path')) {
                textPropertyEl = el;
              } else {
                textPropertyEl = el.find('*[data-path]');
              }
              if (textPropertyEl) {
                return new Coordinate$7(_getPath(textPropertyEl), 0);
              }
            }
            el = el.getNextSibling();
          } else {
            if (el.isElementNode()) {
              if (el.getAttribute('data-path')) {
                textPropertyEl = el;
              } else {
                var textPropertyEls = el.findAll('*[data-path]');
                textPropertyEl = last$7(textPropertyEls);
              }
              if (textPropertyEl) {
                var path = _getPath(textPropertyEl);
                var doc = this.surface.getDocument();
                var text = doc.get(path);
                return new Coordinate$7(path, text.length);
              }
            }
            el = el.getPreviousSibling();
          }
        }
      }
      // if we land here then we could not find an addressable element on this level.
      // try to find it one level higher
      if (node !== this.surface.el) {
        var parent = node.getParent();
        var nodeIdx = parent.getChildIndex(node);
        if (dir === 'right') {
          nodeIdx++;
        }
        return this._searchForCoordinate(parent, nodeIdx, options);
      }

      return null;
    };

    /*
      Computes a model range that encloses all properties
      spanned by a given DOM range.

      This is used in edge cases, where DOM selection anchors are not
      within TextProperties.

      @param {Range} range
      @returns {model/Range}
    */
    this._getEnclosingRange = function(wRange) {
      var frag = wRange.cloneContents();
      var props = frag.querySelectorAll('*[data-path]');
      if (props.length === 0) {
        return null;
      } else {
        var doc = this.surface.getDocument();
        var first = props[0];
        var last = props[props.length-1];
        var startPath = _getPath(first);
        var text;
        if (first === last) {
          text = doc.get(startPath);
          return new Range$3(
            new Coordinate$7(startPath, 0),
            new Coordinate$7(startPath, text.length),
            false
          );
        } else {
          var endPath = _getPath(last);
          text = doc.get(endPath);
          return new Range$3(
            new Coordinate$7(startPath, 0),
            new Coordinate$7(endPath, text.length),
            false
          );
        }
      }
    };

    function _getPath(el) {
      if (!el._isDOMElement) {
        el = DefaultDOMElement$8.wrapNativeElement(el);
      }
      if (el.isElementNode()) {
        var pathStr = el.getAttribute('data-path');
        return pathStr.split('.');
      }
      throw new Error("Can't get path from element:" + el.outerHTML);
    }

    /*
     Helper for creating a model range correctly
     as for model/Range start should be before end.

     In contrast to that, DOM selections are described with anchor and focus coordinates,
     i.e. bearing the information of direction implicitly.
     To simplify the implementation we treat anchor and focus equally
     and only at the end exploit the fact deriving an isReverse flag
     and bringing start and end in the correct order.
    */
    function _createRange(start, end, isReverse, containerId) {
      if (isReverse) {
        var tmp = start;
        start = end;
        end = tmp;
      }
      return new Range$3(start, end, isReverse, containerId);
    }

    function _createRangeForIsolatedBlockNode(nodeId, containerId) {
      return new Range$3(new Coordinate$7([nodeId], 0), new Coordinate$7([nodeId], 1), false, containerId);
    }

  };

  oo$y.initClass(DOMSelection);

  module.exports = DOMSelection;

  var oo$z = require('../util/oo');

  var FileClientStub = function() {
  };

  FileClientStub.Prototype = function() {
    this.uploadFile = function(file, cb) {
      // Default file upload implementation
      // We just return a temporary objectUrl
      var fileUrl = window.URL.createObjectURL(file);
      cb(null, fileUrl);
    };
  };

  oo$z.initClass(FileClientStub);

  module.exports = FileClientStub;

  var Component$d = require('./Component');

  function FontAwesomeIcon() {
    FontAwesomeIcon.super.apply(this, arguments);
  }

  FontAwesomeIcon.Prototype = function() {

    this.render = function($$) {
      return $$('i').addClass('fa ' + this.props.icon);
    };

  };

  Component$d.extend(FontAwesomeIcon);

  module.exports = FontAwesomeIcon;

  var forEach$9 = require('lodash/forEach');
  var oo$A = require('../util/oo');
  var Icon = require('./FontAwesomeIcon');

  function FontAwesomeIconProvider(icons) {
    this.map = {};
    forEach$9(icons, function(config, name) {
      var faClass = config['fontawesome'];
      if (faClass) {
        this.addIcon(name, faClass);
      }
    }.bind(this));
  }

  FontAwesomeIconProvider.Prototype = function() {

    this.renderIcon = function($$, name) {
      var iconClass = this.map[name];
      if (iconClass) {
        return $$(Icon, {icon:iconClass});
      }
    };

    this.addIcon = function(name, faClass) {
      this.map[name] = faClass;
    };
  };

  oo$A.initClass(FontAwesomeIconProvider);

  module.exports = FontAwesomeIconProvider;

  /*
    Experimental

    We are seeking for a solution providing access to global DOM events
    while considering the current app state ~ document session state.

    This implementation is just a prototype and might change with the next releases.
  */

  var oo$B = require('../util/oo');
  var inBrowser$2 = require('../util/inBrowser');
  var DefaultDOMElement$9 = require('./DefaultDOMElement');
  var DOMElement$4 = require('./DOMElement');

  /*
    TODO: to be 100% safe we would need to introduce a hidden contenteditable
    where we put the selection in case of non-surface situations
    so that we are still able to receive events such as 'copy' -- actually only Edge is not dispatching
    to window.document.
  */

  function GlobalEventHandler$1(documentSession, surfaceManager) {
    this.documentSession = documentSession;
    this.surfaceManager = surfaceManager;
    this.listeners = [];
    this.initialize();
  }

  GlobalEventHandler$1.Prototype = function() {

    var events = [ 'keydown', 'keyup', 'keypress', 'mousedown', 'mouseup' , 'copy'];

    this.initialize = function() {
      if (inBrowser$2) {
        var document = DefaultDOMElement$9.wrapNativeElement(window.document);
        events.forEach(function(name) {
          document.on(name, this._dispatch.bind(this, name), this);
        }.bind(this));
      }
    };

    this.dispose = function() {
      if (inBrowser$2) {
        var document = DefaultDOMElement$9.wrapNativeElement(window.document);
        document.off(this);
      }
    };

    this.on = DOMElement$4.prototype.on;

    this.off = DOMElement$4.prototype.off;

    this.addEventListener = function(eventName, handler, options) {
      if (!options.id) {
        throw new Error("GlobalEventHandler can only be used with option 'id'");
      }
      var listener = new DOMElement$4.EventListener(eventName, handler, options);
      this.listeners.push(listener);
    };

    this.removeEventListener = function(listener) {
      var idx = this.listeners.indexOf(listener);
      if (idx > -1) {
        this.listeners.splice(idx, 1);
      }
    };

    this.getEventListeners = function() {
      return this.listeners;
    };

    this._getActiveListener = function(eventName) {
      var documentSession = this.documentSession;
      var sel = documentSession.getSelection();
      if (sel) {
        var surfaceId = sel.surfaceId;
        for (var i = 0; i < this.listeners.length; i++) {
          var listener = this.listeners[i];
          if (listener.eventName === eventName && listener.options.id === surfaceId) {
            return listener;
          }
        }
      }
    };

    this._dispatch = function(eventName, e) {
      var listener = this._getActiveListener(eventName);
      if (listener) {
        listener.handler(e);
      }
    };
  };

  oo$B.initClass(GlobalEventHandler$1);

  module.exports = GlobalEventHandler$1;

  var Component$e = require('./Component');

  /*
    Simple component for realizing grid layouts
  */
  function Grid() {
    Component$e.apply(this, arguments);
  }

  Grid.Prototype = function() {

    this.render = function($$) {
      var el = $$('div').addClass('sc-grid');
      if (this.props.mobile) {
        el.addClass('sm-mobile');
      }
      el.append(this.props.children);
      return el;
    };
  };

  Component$e.extend(Grid);

  /*
    A grid row
  */
  function Row() {
    Component$e.apply(this, arguments);
  }

  Row.Prototype = function() {

    this.render = function($$) {
      var el = $$('div').addClass('se-row');
      el.append(this.props.children);
      return el;
    };
  };

  Component$e.extend(Row);

  /*
    A grid cell
  */
  function Cell() {
    Component$e.apply(this, arguments);
  }

  Cell.Prototype = function() {

    this.render = function($$) {
      var el = $$('div').addClass('se-cell');
      el.addClass('sm-column-'+this.props.columns);
      el.append(this.props.children);
      return el;
    };
  };

  Component$e.extend(Cell);

  Grid.Row = Row;
  Grid.Cell = Cell;

  module.exports = Grid;

  var EventEmitter$c = require('../util/EventEmitter');
  var each$l = require('lodash/each');
  var without = require('lodash/without');

  /**
    Manages highlights. Used by {@link ui/ScrollPane}.

    @class

    @param {model/Document} doc document instance

    @example

    ```
    var contentHighlights = new Highlights(doc);
    ```
  */

  function Highlights(doc) {
    EventEmitter$c.apply(this, arguments);

    this.doc = doc;
    this._highlights = {};
  }

  Highlights.Prototype = function() {

    /**
      Get currently active highlights.

      @return {Object} Returns current highlights as a scoped object.
    */
    this.get = function() {
      return this._highlights;
    };

    /**
      Set highlights.

      @param {Object} scoped object describing highlights

      @example

      ```js
        highlights.set({
          'figures': ['figure-1', 'figure-3']
          'citations': ['citation-1', 'citation-5']
        });
      ```
    */
    this.set = function(highlights) {
      var oldHighlights = this._highlights;
      var doc = this.doc;
      // Iterate over scopes of provided highlights
      each$l(highlights, function(newScopedHighlights, scope) {
        var oldScopedHighlights = oldHighlights[scope] || [];

        // old [1,2,3]  -> new [2,4,5]
        // toBeDeleted: [1,3]
        // toBeAdded:   [4,5]
        var toBeDeleted = without(oldScopedHighlights, newScopedHighlights);
        var toBeAdded = without(newScopedHighlights, oldScopedHighlights);

        // if (scopedHighlights) {
        each$l(toBeDeleted, function(nodeId) {
          var node = doc.get(nodeId);
          // Node could have been deleted in the meanwhile
          if (node) {
            node.setHighlighted(false, scope);
          }
        });

        each$l(toBeAdded, function(nodeId) {
          var node = doc.get(nodeId);
          node.setHighlighted(true, scope);
        });
      });

      this._highlights = highlights;
      this.emit('highlights:updated', highlights);
    };
  };

  /**
    Emitted when highlights have been updated

    @event ui/Highlights@highlights:updated
  */

  EventEmitter$c.extend(Highlights);

  module.exports = Highlights;

  var Command$7 = require('./Command');
  var insertInlineNode$1 = require('../model/transform/insertInlineNode');

  function InlineNodeCommand() {
    InlineNodeCommand.super.apply(this, arguments);
  }

  InlineNodeCommand.Prototype = function() {

    /**
      Get the type of an annotation.

      @returns {String} The annotation's type.
     */
    this.getAnnotationType = function() {
      // Note: AnnotationCommand.static.annotationType is only necessary if
      // it is different to Annotation.static.name
      var annotationType = this.constructor.static.annotationType || this.constructor.static.name;
      if (annotationType) {
        return annotationType;
      } else {
        throw new Error('Contract: AnnotationCommand.static.annotationType should be associated to a document annotation type.');
      }
    };

    this.getCommandState = function(props, context) {
      var sel = context.documentSession.getSelection();
      var newState = {
        disabled: true,
        active: false,
        node: undefined
      };

      if (sel && !sel.isNull() && sel.isPropertySelection()) {
        newState.disabled = false;
      }

      var annos = this._getAnnotationsForSelection(props, context);
      if (annos.length === 1 && annos[0].getSelection().equals(sel)) {
        newState.active = true;
        newState.node = annos[0];
      }

      return newState;
    };

    this._getAnnotationsForSelection = function(props) {
      return props.selectionState.getAnnotationsForType(this.getAnnotationType());
    };

    this.execute = function(props, context) {
      var state = this.getCommandState(props, context);
      if (state.disabled) return;
      var surface = context.surface ||context.surfaceManager.getFocusedSurface();
      if (surface) {
        surface.transaction(function(tx, args) {
          return this.insertInlineNode(tx, args);
        }.bind(this));
      }
      return true;
    };

    this.insertInlineNode = function(tx, args) {
      args.node = this.createNodeData(tx, args);
      return insertInlineNode$1(tx, args);
    };

    this.createNodeData = function(tx, args) { // eslint-disable-line
      throw new Error('InsertNodeCommand.createNodeData() is abstract.');
    };

  };

  Command$7.extend(InlineNodeCommand);

  module.exports = InlineNodeCommand;

  var isEqual$c = require('lodash/isEqual');
  var startsWith = require('lodash/startsWith');
  var Coordinate$8 = require('../model/Coordinate');
  var IsolatedNodeComponent$2 = require('./IsolatedNodeComponent');

  function InlineNodeComponent$2() {
    InlineNodeComponent$2.super.apply(this, arguments);
  }

  InlineNodeComponent$2.Prototype = function() {

    var _super = InlineNodeComponent$2.super.prototype;

    // use spans everywhere
    this.__elementTag = 'span';
    this.__slugChar = "\uFEFF";

    this.render = function($$) { // eslint-disable-line
      var el = _super.render.apply(this, arguments);

      el.addClass('sc-inline-node')
        .removeClass('sc-isolated-node')
        .attr("data-id", this.props.node.id)
        .attr('data-inline', '1');

      return el;
    };

    this._getContentClass = function(node) {
      return _super._getContentClass.call(this, node);
    };

    this._deriveStateFromSelectionState = function(selState) {
      var sel = selState.getSelection();
      var surfaceId = sel.surfaceId;
      if (!surfaceId) return;
      var id = this.getId();
      var node = this.props.node;
      var parentId = this._getSurfaceParent().getId();
      var inParentSurface = (surfaceId === parentId);
      // detect cases where this node is selected or co-selected by inspecting the selection
      if (inParentSurface) {
        if (sel.isPropertySelection() && !sel.isCollapsed() && isEqual$c(sel.path, node.path)) {
          var nodeSel = node.getSelection();
          if(nodeSel.equals(sel)) {
            return { mode: 'selected' };
          }
          if (sel.contains(nodeSel)) {
            return { mode: 'co-selected' };
          }
        }
        return;
      }
      // for all other cases (focused / co-focused) the surface id prefix must match
      if (!startsWith(surfaceId, id)) return;
      // Note: trying to distinguisd focused
      // surfaceIds are a sequence of names joined with '/'
      // a surface inside this node will have a path with length+1.
      // a custom selection might just use the id of this IsolatedNode
      var p1 = id.split('/');
      var p2 = surfaceId.split('/');
      if (p2.length >= p1.length && p2.length <= p1.length+1) {
        return { mode: 'focused' };
      } else {
        return { mode: 'co-focused' };
      }
    };

    this._selectNode = function() {
      // console.log('IsolatedNodeComponent: selecting node.');
      var surface = this.context.surface;
      var doc = surface.getDocument();
      var node = this.props.node;
      surface.setSelection(doc.createSelection({
        type: 'property',
        path: node.path,
        startOffset: node.startOffset,
        endOffset: node.endOffset
      }));
    };

  };

  IsolatedNodeComponent$2.extend(InlineNodeComponent$2);

  InlineNodeComponent$2.getCoordinate = function(el) {
    // special treatment for block-level isolated-nodes
    var parent = el.getParent();
    if (el.isTextNode() && parent.is('.se-slug')) {
      var slug = parent;
      var nodeEl = slug.getParent();
      if (nodeEl.is('.sc-inline-node')) {
        var startOffset = Number(nodeEl.getAttribute('data-offset'));
        var len = Number(nodeEl.getAttribute('data-length'));
        var charPos = startOffset;
        if (slug.is('sm-after')) charPos += len;
        var path;
        while ( (nodeEl = nodeEl.getParent()) ) {
          var pathStr = nodeEl.getAttribute('data-path');
          if (pathStr) {
            path = pathStr.split('.');
            var coor = new Coordinate$8(path, charPos);
            coor.__inInlineNode__ = true;
            coor.__startOffset__ = startOffset;
            coor.__endOffset__ = startOffset+len;
            return coor;
          }
        }
      }
    }
    return null;
  };

  module.exports = InlineNodeComponent$2;

  var Component$f = require('./Component');

  function Input() {
    Component$f.apply(this, arguments);
  }

  Input.Prototype = function() {

    this.render = function($$) {
      var el = $$('input').attr({
        value: this.props.value,
        type: this.props.type,
        placeholder: this.props.placeholder
      })
      .addClass('sc-input');

      if (this.props.centered) {
        el.addClass('sm-centered');
      }

      return el;
    };
  };

  Component$f.extend(Input);
  module.exports = Input;

  var Command$8 = require('./Command');
  var insertNode$2 = require('../model/transform/insertNode');

  function InsertNodeCommand$1() {
    InsertNodeCommand$1.super.apply(this, arguments);
  }

  InsertNodeCommand$1.Prototype = function() {

    this.getCommandState = function(props, context) {
      var sel = context.documentSession.getSelection();
      var newState = {
        disabled: true,
        active: false
      };
      if (sel && !sel.isNull() && sel.isPropertySelection()) {
        newState.disabled = false;
      }
      return newState;
    };

    this.execute = function(props, context) {
      var state = this.getCommandState(props, context);
      if (state.disabled) return;
      var surface = context.surface ||context.surfaceManager.getFocusedSurface();
      if (surface) {
        surface.transaction(function(tx, args) {
          return this.insertNode(tx, args);
        }.bind(this));
      }
      return true;
    };

    this.insertNode = function(tx, args) {
      args.node = this.createNodeData(tx, args);
      return insertNode$2(tx, args);
    };

    this.createNodeData = function(tx, args) { // eslint-disable-line
      throw new Error('InsertNodeCommand.createNodeData() is abstract.');
    };
  };

  Command$8.extend(InsertNodeCommand$1);

  module.exports = InsertNodeCommand$1;

  var startsWith$1 = require('lodash/startsWith');
  var keys$3 = require('../util/keys');
  var createSurfaceId = require('../util/createSurfaceId');
  var Coordinate$9 = require('../model/Coordinate');
  var Component$g = require('./Component');

  function IsolatedNodeComponent$3() {
    IsolatedNodeComponent$3.super.apply(this, arguments);

    this.name = this.props.node.id;
    this._id = createSurfaceId(this);
    this._state = {
      selectionFragment: null
    };

    this.handleAction('escape', this._escape);
    this.ContentClass = this._getContentClass(this.props.node) || Component$g;
  }

  IsolatedNodeComponent$3.Prototype = function() {

    var _super = IsolatedNodeComponent$3.super.prototype;

    this._isIsolatedNodeComponent = true;

    // InlineNode uses 'span'
    this.__elementTag = 'div';
    this.__slugChar = "|";

    this.getChildContext = function() {
      return {
        surfaceParent: this
      };
    };

    this.getInitialState = function() {
      var selState = this.context.documentSession.getSelectionState();
      return this._deriveStateFromSelectionState(selState);
    };

    this.didMount = function() {
      _super.didMount.call(this);

      var docSession = this.context.documentSession;
      docSession.on('update', this.onSessionUpdate, this);
    };

    this.dispose = function() {
      _super.dispose.call(this);

      var docSession = this.context.documentSession;
      docSession.off(this);
    };

    this.render = function($$) {
      var node = this.props.node;
      // console.log('##### IsolatedNodeComponent.render()', $$.capturing);
      var el = _super.render.apply(this, arguments);
      el.tagName = this.__elementTag;

      var ContentClass = this.ContentClass;

      el.addClass('sc-isolated-node')
        .addClass('sm-'+this.props.node.type)
        .attr("data-id", node.id);

      if (this.state.mode) {
        el.addClass('sm-'+this.state.mode);
      } else {
        el.addClass('sm-not-selected');
      }

      if (!ContentClass.static.noStyle) {
        el.addClass('sm-default-style');
      }

      el.on('mousedown', this.onMousedown);
      // shadowing handlers of the parent surface
      // TODO: extract this into a helper so that we can reuse it anywhere where we want
      // to prevent propagation to the parent surface
      el.on('keydown', this.onKeydown)
        .on('keypress', this._stopPropagation)
        .on('keyup', this._stopPropagation)
        .on('compositionstart', this._stopPropagation)
        .on('textInput', this._stopPropagation);

      el.append(
        $$(this.__elementTag).addClass('se-slug').addClass('sm-before').ref('before')
          // NOTE: better use a regular character otherwise Edge has problems
          .append(this.__slugChar)
      );

      var level = this._getLevel();


      var container = $$(this.__elementTag).addClass('se-container')
        .attr('contenteditable', false)
        .css({ 'z-index': 2*level });

      if (ContentClass.static.fullWidth) {
        container.addClass('sm-full-width');
      }

      if (this.state.mode === 'cursor' && this.state.position === 'before') {
        container.append(
          $$(this.__elementTag).addClass('se-cursor').addClass('sm-before').attr('contenteditable', false)
        );
      }
      container.append(this.renderContent($$, node));

      if (this._isDisabled() || this.state.mode === 'co-focused') {
        container.addClass('sm-disabled');
        // NOTE: there are some content implementations which work better without a blocker
        var blocker = $$(this.__elementTag).addClass('se-blocker')
          .css({ 'z-index': 2*level+1 });
        container.append(blocker);
      }

      if (this.state.mode === 'cursor' && this.state.position === 'after') {
        container.append(
          $$(this.__elementTag).addClass('se-cursor').addClass('sm-after').attr('contenteditable', false)
        );
      }

      el.append(container);

      el.append(
        $$(this.__elementTag).addClass('se-slug').addClass('sm-after').ref('after')
          // NOTE: better use a regular character otherwise Edge has problems
          .append(this.__slugChar)
      );

      return el;
    };

    this.renderContent = function($$, node) {
      var ComponentClass = this.ContentClass;
      if (!ComponentClass) {
        console.error('Could not resolve a component for type: ' + node.type);
        return $$(this.__elementTag);
      } else {
        var props = {
          node: node,
          disabled: this._isDisabled(),
          isolatedNodeState: this.state.mode
        };
        if (this.state.mode === 'focused') {
          props.focused = true;
        }
        return $$(ComponentClass, props).ref('content');
      }
    };

    this.getId = function() {
      return this._id;
    };

    this.getMode = function() {
      return this.state.mode;
    };

    this.isNotSelected = function() {
      return !this.state.mode;
    };

    this.isSelected = function() {
      return this.state.mode === 'selected';
    };

    this.isCoSelected = function() {
      return this.state.mode === 'co-selected';
    };

    this.isFocused = function() {
      return this.state.mode === 'focused';
    };

    this.isCoFocused = function() {
      return this.state.mode === 'co-focused';
    };

    this._getContentClass = function(node) {
      var componentRegistry = this.context.componentRegistry;
      var ComponentClass = componentRegistry.get(node.type);
      return ComponentClass;
    };

    this._isDisabled = function() {
      return !this.state.mode || ['co-selected', 'cursor'].indexOf(this.state.mode) > -1;
    };

    this._getSurfaceParent = function() {
      return this.context.surface;
    };

    this._getLevel = function() {
      var level = 1;
      var parent = this._getSurfaceParent();
      while (parent) {
        level++;
        parent = parent._getSurfaceParent();
      }
      return level;
    };

    this.onSessionUpdate = function(update) {
      if (update.selection) {
        var documentSession = this.context.documentSession;
        var newState = this._deriveStateFromSelectionState(documentSession.getSelectionState());
        if (!newState && this.state.mode) {
          this.setState({});
        } else if (newState && newState.mode !== this.state.mode) {
          this.setState(newState);
        }
      }
    };

    this._deriveStateFromSelectionState = function(selState) {
      var sel = selState.getSelection();
      var surfaceId = sel.surfaceId;
      if (!surfaceId) return;
      var id = this.getId();
      var nodeId = this.props.node.id;
      var parentId = this._getSurfaceParent().getId();
      var inParentSurface = (surfaceId === parentId);
      // detect cases where this node is selected or co-selected by inspecting the selection
      if (inParentSurface) {
        if (sel.isNodeSelection() && sel.getNodeId() === nodeId) {
          if (sel.isFull()) {
            return { mode: 'selected' };
          } else if (sel.isBefore()) {
            return { mode: 'cursor', position: 'before' };
          } else if (sel.isAfter()) {
            return { mode: 'cursor', position: 'after' };
          }
        }
        if (sel.isContainerSelection() && sel.containsNodeFragment(nodeId)) {
          return { mode: 'co-selected' };
        }
        return;
      }
      if (sel.isCustomSelection() && id === surfaceId) {
        return { mode: 'focused' };
      }
      // HACK: a looks a bit hacky and is, but
      // fine for now. The structure of surfaceId is only exploited here
      else if (startsWith$1(surfaceId, id)) {
        if (surfaceId[id.length] === '/' && surfaceId.indexOf('/', id.length+1) < 0) {
          return { mode: 'focused' };
        } else {
          return { mode: 'co-focused' };
        }
      }
    };

    this.onMousedown = function(event) {
      // console.log('IsolatedNodeComponent.onMousedown', this.getId());
      event.stopPropagation();
      switch (this.state.mode) {
        case 'selected':
        case 'focused':
          break;
        default:
          event.preventDefault();
          this._selectNode();
          this.setState({ mode: 'selected' });
      }
    };

    this.onKeydown = function(event) {
      event.stopPropagation();
      // console.log('####', event.keyCode, event.metaKey, event.ctrlKey, event.shiftKey);
      // TODO: while this works when we have an isolated node with input or CE,
      // there is no built-in way of receiving key events in other cases
      // We need a global event listener for keyboard events which dispatches to the current isolated node
      if (event.keyCode === keys$3.ESCAPE && this.state.mode === 'focused') {
        event.preventDefault();
        this._escape();
      }
    };

    this._escape = function() {
      this._selectNode();
      // TODO: Is this still necessary?
      // The state should be set during the next update cycle.
      this.setState({ mode: 'selected' });
    };

    this._stopPropagation = function(event) {
      event.stopPropagation();
    };

    this._selectNode = function() {
      // console.log('IsolatedNodeComponent: selecting node.');
      var surface = this.context.surface;
      var doc = surface.getDocument();
      var nodeId = this.props.node.id;
      surface.setSelection(doc.createSelection({
        type: 'node',
        containerId: surface.getContainerId(),
        nodeId: nodeId,
        mode: 'full'
      }));
    };

  };

  Component$g.extend(IsolatedNodeComponent$3);

  IsolatedNodeComponent$3.getCoordinate = function(surfaceEl, node) {
    // special treatment for block-level isolated-nodes
    var parent = node.getParent();
    if (node.isTextNode() && parent.is('.se-slug')) {
      var boundary = parent;
      var isolatedNodeEl = boundary.getParent();
      var nodeId = isolatedNodeEl.getAttribute('data-id');
      if (nodeId) {
        var charPos = boundary.is('sm-after') ? 1 : 0;
        return new Coordinate$9([nodeId], charPos);
      } else {
        console.error('FIXME: expecting a data-id attribute on IsolatedNodeComponent');
      }
    }
    return null;
  };

  IsolatedNodeComponent$3.getDOMCoordinate = function(comp, coor) {
    var domCoor;
    if (coor.offset === 0) {
      domCoor = {
        container: comp.refs.before.getNativeElement(),
        offset: 0
      };
    } else {
      domCoor = {
        container: comp.refs.after.getNativeElement(),
        offset: 1
      };
    }
    return domCoor;
  };

  IsolatedNodeComponent$3.getDOMCoordinates = function(comp) {
    return {
      start: {
        container: comp.refs.before.getNativeElement(),
        offset: 0
      },
      end: {
        container: comp.refs.after.getNativeElement(),
        offset: 1
      }
    };
  };

  module.exports = IsolatedNodeComponent$3;

  var Component$h = require('./Component');

  /**
    Layout component for simple layout tasks, without having to write CSS

    @class
    @component

    @prop {String} width 'small', 'medium', 'large' and 'full'
    @prop {String} [textAlign] 'center', 'left' or 'right'
    @prop {String} [noPadding] No padding around layout, will fill the whole space

    @example

    ```js
    var form = $$(Layout, {
      width: 'large',
      textAlign: 'center'
    });
    ```
  */
  function Layout() {
    Component$h.apply(this, arguments);
  }

  Layout.Prototype = function() {

    this.render = function($$) {
      var el = $$('div').addClass('sc-layout');
      el.addClass('sm-width-'+this.props.width);
      if (this.props.textAlign) {
        el.addClass('sm-text-align-'+this.props.textAlign);
      }

      if (this.props.noPadding) {
        el.addClass('sm-no-padding');
      }

      el.append(this.props.children);
      return el;
    };
  };

  Component$h.extend(Layout);
  module.exports = Layout;

  var oo$C = require('../util/oo');

  function MacroManager$1(context, macros) {
    this.context = context;
    this.macros = macros;
    this.context.documentSession.on('update', this.onUpdate, this);
  }

  MacroManager$1.Prototype = function() {

    this.onUpdate = function(update, info) {
      if (update.change) {
        this.executeMacros(update, info);
      }
    };

    this.executeMacros = function(update, info) {
      var change = update.change;
      if (!change) {
        return;
      }
      var doc = this.context.documentSession.getDocument();
      var nodeId, node, text;
      var path;
      if (info.action === 'type') {
        // HACK: we know that there is only one op when we type something
        var op = change.ops[0];
        path = op.path;
        nodeId = path[0];
        node = doc.get(nodeId);
        text = doc.get(path);
      } else {
        return;
      }

      var props = {
        action: info.action,
        node: node,
        path: path,
        text: text,
        selection: this.context.documentSession.getSelection()
      };
      for (var i = 0; i < this.macros.length; i++) {
        var macro = this.macros[i];
        var executed = macro.execute(props, this.context);

        if (executed) {
          break;
        }
      }
    };
  };

  oo$C.initClass(MacroManager$1);

  module.exports = MacroManager$1;

  var Component$i = require('./Component');

  /**
    Modal dialog component

    @class
    @component

    @prop {String} width 'small', 'medium', 'large' and 'full'

    @example

    ```js
    var form = $$(Modal, {
      width: 'medium',
      textAlign: 'center'
    });
    ```
  */
  function Modal() {
    Component$i.apply(this, arguments);
  }

  Modal.Prototype = function() {

    this.render = function($$) {
      var el = $$('div').addClass('sc-modal');

      // TODO: don't think that this is good enough. Right the modal is closed by any unhandled click.
      // Need to be discussed.
      el.on('click', this._closeModal);

      if (this.props.width) {
        el.addClass('sm-width-'+this.props.width);
      }

      el.append(
        $$('div').addClass('se-body').append(
          this.props.children
        )
      );
      return el;
    };

    this._closeModal = function(e) {
      var closeSurfaceClick = e.target.classList.contains('sc-modal');
      if (closeSurfaceClick) {
        this.send('closeModal');
      }
    };

  };

  Component$i.extend(Modal);
  module.exports = Modal;

  var Component$j = require('./Component');

  function NodeComponent$1() {
    NodeComponent$1.super.apply(this, arguments);
  }

  NodeComponent$1.Prototype = function() {

    this.render = function($$) {
      var tagName = this.getTagName();
      var el = $$(tagName)
        .attr("data-id", this.props.node.id)
        .addClass('sc-node');
      return el;
    };

    this.getTagName = function() {
      return 'div';
    };

  };

  Component$j.extend(NodeComponent$1);

  module.exports = NodeComponent$1;

  var Component$k = require('./Component');

  /**
    Overlay component

    Used internally by surface to place overlay relative to selection/cursor

    @class
    @component
  */
  function Overlay$1() {
    Component$k.apply(this, arguments);

    this.commandStates = this._getCommandStates();
  }

  Overlay$1.Prototype = function() {

    this.shouldRerender = function() {
      var commandStates = this._getCommandStates();
      if (commandStates !== this.commandStates) {
        this.commandStates = commandStates;
        return true;
      }
      return false;
    };

    this.render = function($$) {
      var el = $$('div').addClass('sc-overlay sm-hidden');
      var commandStates = this.context.commandManager.getCommandStates();
      var ComponentClass = this.props.overlay;
      el.append($$(ComponentClass, {
        commandStates: commandStates
      }).ref('overlayContent'));
      return el;
    };

    this.didMount = function() {
      // rerender the overlay content after anything else has been updated
      this.context.documentSession.on('didUpdate', this._onSessionDidUpdate, this);
    };

    this.dispose = function() {
      this.context.documentSession.off(this);
    };

    this.position = function(hints) {
      var content = this.refs.overlayContent;
      if (content.childNodes.length > 0) {
        // Position based on rendering hints
        this._position(hints);
        this.el.removeClass('sm-hidden');
      }
    };

    this._onSessionDidUpdate = function() {
      if (this.shouldRerender()) {
        this.rerender();
      }
    };

    this._getCommandStates = function() {
      return this.context.commandManager.getCommandStates();
    };

    this._position = function(hints) {
      if (hints) {
        var contentWidth = this.el.htmlProp('offsetWidth');
        var selectionMaxWidth = hints.rectangle.width;

        // By default, Overlays are aligned center/bottom to the selection
        this.el.css('top', hints.rectangle.top + hints.rectangle.height);
        var leftPos = hints.rectangle.left + selectionMaxWidth/2 - contentWidth/2;
        // Must not exceed left bound
        leftPos = Math.max(leftPos, 0);
        // Must not exceed right bound
        var maxLeftPos = hints.rectangle.left + selectionMaxWidth + hints.rectangle.right - contentWidth;
        leftPos = Math.min(leftPos, maxLeftPos);
        this.el.css('left', leftPos);
      }
    };
  };

  Component$k.extend(Overlay$1);
  module.exports = Overlay$1;

  var Component$l = require('./Component');

  function Prompt$1() {
    Prompt$1.super.apply(this, arguments);
  }

  Prompt$1.Prototype = function() {

    this.render = function($$) {
      var el = $$('div').addClass('sc-prompt');
      el.append($$('div').addClass('se-arrow'));
      el.append(
        $$('div').addClass('se-content').append(
          this.props.children
        )
      );
      return el;
    };
  };

  Component$l.extend(Prompt$1);

  /*
    Action (represented as an icon)
  */
  function Action() {
    Action.super.apply(this, arguments);
  }

  Action.Prototype = function() {

    this.render = function($$) {
      var iconEl = this.context.iconProvider.renderIcon($$, this.props.name);
      var el = $$('button')
        .attr({title: this.props.title})
        .addClass('se-action').append(
          iconEl
        );
      return el;
    };
  };

  Component$l.extend(Action);


  /*
    Link (represented as an icon)
  */
  function Link$2() {
    Action.super.apply(this, arguments);
  }

  Link$2.Prototype = function() {

    this.render = function($$) {
      var iconEl = this.context.iconProvider.renderIcon($$, this.props.name);
      var el = $$('a')
        .attr({
          href: this.props.href,
          title: this.props.title,
          target: 'blank'
        })
        .addClass('se-action').append(
          iconEl,
          '\uFEFF' // Zero-width char so line-height property has an effect
        );
      return el;
    };
  };

  Component$l.extend(Link$2);


  /*
    Label for the prompt (not interactive)
  */
  function Label() {
    Label.super.apply(this, arguments);
  }

  Label.Prototype = function() {

    this.render = function($$) {
      var el = $$('div').addClass('se-label').append(this.props.label);
      return el;
    };
  };

  Component$l.extend(Label);


  /*
    Takes a path to a string property and makes it editable
  */
  function Input$1() {
    Component$l.apply(this, arguments);
  }

  Input$1.Prototype = function() {
    this._onChange = function() {
      var documentSession = this.context.documentSession;
      var path = this.props.path;
      var newVal = this.el.val();

      documentSession.transaction(function(tx) {
        tx.set(path, newVal);
      });
    };

    this.render = function($$) {
      var documentSession = this.context.documentSession;
      var doc = documentSession.getDocument();
      var val = doc.get(this.props.path);

      var el = $$('input')
        .attr({
          value: val,
          type: this.props.type || 'text',
          placeholder: this.props.placeholder
        })
        .on('change', this._onChange)
        .addClass('se-input');

      return el;
    };
  };

  Component$l.extend(Input$1);

  /*
    Divider can be used to sepate prompt items
  */
  function Separator() {
    Label.super.apply(this, arguments);
  }

  Separator.Prototype = function() {
    this.render = function($$) {
      return $$('div').addClass('se-separator');
    };
  };

  Component$l.extend(Separator);

  Prompt$1.Action = Action;
  Prompt$1.Label = Label;
  Prompt$1.Link = Link$2;
  Prompt$1.Input = Input$1;
  Prompt$1.Separator = Separator;

  module.exports = Prompt$1;

  var each$m = require('lodash/each');
  var oo$D = require('../util/oo');
  var uuid$g = require('../util/uuid');
  var substanceGlobals$1 = require('../util/substanceGlobals');
  var VirtualElement$1 = require('./VirtualElement');
  var DefaultDOMElement$a = require('./DefaultDOMElement');

  function RenderingEngine$2() {}

  RenderingEngine$2.Prototype = function() {

    this._render = function(comp, oldProps, oldState) {
      // var t0 = Date.now();
      var vel = _createWrappingVirtualComponent(comp);
      var state = new RenderingEngine$2.State();
      if (oldProps) {
        state.setOldProps(vel, oldProps);
      }
      if (oldState) {
        state.setOldState(vel, oldState);
      }
      try {
        _capture(state, vel, 'forceCapture');
        if (vel._isVirtualComponent) {
          _render(state, vel._content);
        } else {
          _render(state, vel);
        }
        _triggerUpdate(state, vel);
      } finally {
        state.dispose();
      }
      // console.log("RenderingEngine: finished rendering in %s ms", Date.now()-t0);
    };

    // this is used together with the incremental Component API
    this._renderChild = function(comp, vel) {
      // HACK: to make this work with the rest of the implementation
      // we ingest a fake parent
      var state = new RenderingEngine$2.State();
      vel.parent = { _comp: comp };
      try {
        _capture(state, vel);
        _render(state, vel);
        return vel._comp;
      } finally {
        state.dispose();
      }
    };

    function _create(state, vel) {
      var Component = require('./Component');
      var comp = vel._comp;
      console.assert(!comp, "Component instance should not exist when this method is used.");
      var parent = vel.parent._comp;
      // making sure the parent components have been instantiated
      if (!parent) {
        parent = _create(state, vel.parent);
      }
      if (vel._isVirtualComponent) {
        console.assert(parent, "A Component should have a parent.");
        comp = new vel.ComponentClass(parent, vel.props);
        comp.__htmlConfig__ = vel._copyHTMLConfig();
      } else if (vel._isVirtualHTMLElement) {
        comp = new Component.Element(parent, vel);
      } else if (vel._isVirtualTextNode) {
        comp = new Component.TextNode(parent, vel);
      }
      if (vel._ref) {
        comp._ref = vel._ref;
      }
      if (vel._owner) {
        comp._owner = vel._owner._comp;
      }
      vel._comp = comp;
      return comp;
    }

    function _capture(state, vel, forceCapture) {
      if (state.isCaptured(vel)) {
        return vel;
      }
      // a captured VirtualElement has a component instance attached
      var comp = vel._comp;
      if (!comp) {
        comp = _create(state, vel);
        state.setNew(vel);
      }
      if (vel._isVirtualComponent) {
        var needRerender;
        // NOTE: forceCapture is used for the first entrance
        // from this.render(comp) where we want to fource capturing
        // as it has already been cleared that a rerender is necessary
        if (forceCapture) {
          needRerender = true;
        } else {
          // NOTE: don't ask shouldRerender if no element is there yet
          needRerender = !comp.el || comp.shouldRerender(vel.props);
          comp.__htmlConfig__ = vel._copyHTMLConfig();
          state.setOldProps(vel, comp.props);
          state.setOldState(vel, comp.state);
          // updates prop triggering willReceiveProps
          comp._setProps(vel.props);
          if (!state.isNew(vel)) {
            state.setUpdated(vel);
          }
        }
        if (needRerender) {
          var context = new CaptureContext(vel);
          var content = comp.render(context.$$);
          if (!content || !content._isVirtualHTMLElement) {
            throw new Error("Component.render must return VirtualHTMLElement");
          }

          if (comp.__htmlConfig__) {
            content._mergeHTMLConfig(comp.__htmlConfig__);
          }
          content._comp = comp;
          vel._content = content;
          if (!state.isNew(vel) && comp.isMounted()) {
            state.setUpdated(vel);
          }
          // Mapping: map virtual elements to existing components based on refs
          _prepareVirtualComponent(state, comp, content);
          // Descending
          // TODO: only do this in DEBUG mode
          if (substanceGlobals$1.DEBUG_RENDERING) {
            // in this case we use the render() function as iterating function, where
            // $$ is a function which creates components and renders them recursively.
            // first we can create all element components that can be reached
            // without recursion
            var stack = content.children.slice(0);
            while (stack.length) {
              var child = stack.shift();
              if (state.isCaptured(child) || child._isVirtualComponent) {
                continue;
              }
              if (!child._comp) {
                _create(state, child);
              }
              if (child._isVirtualHTMLElement && child.children.length > 0) {
                stack = stack.concat(child.children);
              }
              state.setCaptured(child);
            }
            state.setCaptured(content);
            // then we run comp.render($$) with a special $$ that captures VirtualComponent's
            // recursively
            var descendingContext = new DescendingContext(state, context);
            while (descendingContext.hasPendingCaptures()) {
              descendingContext.reset();
              comp.render(descendingContext.$$);
            }
          } else {
            // a VirtualComponent has its content as a VirtualHTMLElement
            // which needs to be captured recursively
            _capture(state, vel._content);
          }
        } else {
          state.setSkipped(vel);
        }
      } else if (vel._isVirtualHTMLElement) {
        for (var i = 0; i < vel.children.length; i++) {
          _capture(state, vel.children[i]);
        }
      }
      state.setCaptured(vel);
      return vel;
    }

    function _render(state, vel) {
      if (state.isSkipped(vel)) return;

      // before changes can be applied, a VirtualElement must have been captured
      console.assert(state.isCaptured(vel), 'VirtualElement must be captured before rendering');

      var comp = vel._comp;
      console.assert(comp && comp._isComponent, "A captured VirtualElement must have a component instance attached.");

      // VirtualComponents apply changes to its content element
      if (vel._isVirtualComponent) {
        _render(state, vel._content);
        return;
      }
      // render the element
      if (!comp.el) {
        comp.el = _createElement(vel);
        comp.el._comp = comp;
      }
      _updateElement(comp, vel);

      // structural updates are necessary only for HTML elements (without innerHTML set)
      if (vel._isVirtualHTMLElement && !vel.hasInnerHTML()) {
        var newChildren = vel.children;
        var oldComp, virtualComp, newComp;
        var pos1 = 0; var pos2 = 0;

        // HACK: removing all childNodes that are not owned by a component
        // this happened in Edge every 1s. Don't know why.
        // With this implementation all external DOM mutations will be eliminated
        var oldChildren = [];
        comp.el.getChildNodes().forEach(function(node) {
          var childComp = node._comp;
          // remove orphaned nodes and relocated components
          if (!childComp || state.isRelocated(childComp)) {
            comp.el.removeChild(node);
          } else {
            oldChildren.push(childComp);
          }
        });

        while(pos1 < oldChildren.length || pos2 < newChildren.length) {
          // skip detached components
          // Note: components get detached when preserved nodes
          // are found in a swapped order. Then the only way is
          // to detach one of them from the DOM, and reinsert it later at the new position
          do {
            oldComp = oldChildren[pos1++];
          } while (oldComp && (state.isDetached(oldComp)));

          virtualComp = newChildren[pos2++];
          // remove remaining old ones if no new one is left
          if (oldComp && !virtualComp) {
            while (oldComp) {
              _removeChild(state, comp, oldComp);
              oldComp = oldChildren[pos1++];
            }
            break;
          }

          // Try to reuse TextNodes to avoid unnecesary DOM manipulations
          if (oldComp && oldComp.el.isTextNode() &&
              virtualComp && virtualComp._isVirtualTextNode &&
              oldComp.el.textContent === virtualComp.text ) {
            continue;
          }

          if (!state.isRendered(virtualComp)) {
            _render(state, virtualComp);
          }

          newComp = virtualComp._comp;

          // ATTENTION: relocating a component does not update its context
          if (state.isRelocated(newComp)) {
            newComp._setParent(comp);
          }

          console.assert(newComp, 'Component instance should now be available.');
          // append remaining new ones if no old one is left
          if (virtualComp && !oldComp) {
            _appendChild(state, comp, newComp);
            continue;
          }
          // Differential update
          else if (state.isMapped(virtualComp)) {
            // identity
            if (newComp === oldComp) ; else {
              // the order of elements with ref has changed
              state.setDetached(oldComp);
              _removeChild(state, comp, oldComp);
              pos2--;
            }
          }
          else if (state.isMapped(oldComp)) {
            _insertChildBefore(state, comp, newComp, oldComp);
            pos1--;
          } else {
            // both elements are not mapped
            // TODO: we could try to reuse components if they are of same type
            // However, this needs a better mapping strategy, not only
            // based on refs.
            _replaceChild(state, comp, oldComp, newComp);
          }
        }
      }

      // HACK: a temporary solution to handle refs owned by an ancestor
      // is to store them here as well, so that we can map virtual components
      // efficiently
      var refs = {};
      var foreignRefs = {};
      if (vel._context) {
        each$m(vel._context.refs, function(vel, ref) {
          refs[ref] = vel._comp;
        });
        each$m(vel._context.foreignRefs, function(vel, ref) {
          foreignRefs[ref] = vel._comp;
        });
      }
      comp.refs = refs;
      comp.__foreignRefs__ = foreignRefs;

      state.setRendered(vel);
    }

    function _triggerUpdate(state, vel) {
      if (vel._isVirtualComponent) {
        if (!state.isSkipped(vel)) {
          vel._content.children.forEach(_triggerUpdate.bind(null, state));
        }
        if (state.isUpdated(vel)) {
          vel._comp.didUpdate(state.getOldProps(vel), state.getOldState(vel));
        }
      } else if (vel._isVirtualHTMLElement) {
        vel.children.forEach(_triggerUpdate.bind(null, state));
      }
    }

    function _appendChild(state, parent, child) {
      parent.el.appendChild(child.el);
      _triggerDidMount(state, parent, child);
    }

    function _replaceChild(state, parent, oldChild, newChild) {
      parent.el.replaceChild(oldChild.el, newChild.el);
      if (!state.isDetached(oldChild)) {
        oldChild.triggerDispose();
      }
      _triggerDidMount(state, parent, newChild);
    }

    function _insertChildBefore(state, parent, child, before) {
      parent.el.insertBefore(child.el, before.el);
      _triggerDidMount(state, parent, child);
    }

    function _removeChild(state, parent, child) {
      parent.el.removeChild(child.el);
      if (!state.isDetached(child)) {
        child.triggerDispose();
      }
    }

    function _triggerDidMount(state, parent, child) {
      if (!state.isDetached(child) &&
          parent.isMounted() && !child.isMounted()) {
        child.triggerDidMount(true);
      }
    }

    /*
      Prepares a new virtual component by comparing it with
      the old version.

      It sets the _comp references in the new version where its ancestors
      can be mapped to corresponding virtual components in the old version.
    */
    function _prepareVirtualComponent(state, comp, vc) {
      var newRefs = {};
      var foreignRefs = {};
      // TODO: iron this out. refs are stored on the context
      // though, it would be cleaner if they were on the VirtualComponent
      // Where vc._owner would need to be a VirtualComponent and not a
      // component.
      if (vc._context) {
        newRefs = vc._context.refs;
        foreignRefs = vc._context.foreignRefs;
      }
      var oldRefs = comp.refs;
      var oldForeignRefs = comp.__foreignRefs__;
      // map virtual components to existing ones
      each$m(newRefs, function(vc, ref) {
        var comp = oldRefs[ref];
        if (comp) _mapComponents(state, comp, vc);
      });
      each$m(foreignRefs, function(vc, ref) {
        var comp = oldForeignRefs[ref];
        if (comp) _mapComponents(state, comp, vc);
      });
    }

    /*
      This tries to map the virtual component to existing component instances
      by looking at the old and new refs, making sure that the element type is
      compatible.
      This is then applied to the ancestors leading to an implicit
      mapping of parent elements, which makes
    */

    function _mapComponents(state, comp, vc) {
      if (!comp && !vc) return true;
      if (!comp || !vc) return false;
      // Stop if one them has been mapped already
      // or the virtual element has its own component already
      // or if virtual element and component do not match semantically
      // Note: the owner component is mapped at very first, so this
      // recursion will stop at the owner at the latest.
      if (state.isMapped(vc) || state.isMapped(comp)) {
        return vc._comp === comp;
      }
      if (vc._comp) {
        if (vc._comp === comp) {
          state.setMapped(vc);
          state.setMapped(comp);
          return true;
        } else {
          return false;
        }
      }
      if (!_isOfSameType(comp, vc)) {
        return false;
      }

      vc._comp = comp;
      state.setMapped(vc);
      state.setMapped(comp);

      var canMapParent;
      var parent = comp.getParent();
      if (vc.parent) {
        canMapParent = _mapComponents(state, parent, vc.parent);
      }
      // to be able to support implicit retaining of elements
      // we need to propagate mapping through the 'preliminary' parent chain
      // i.e. not taking the real parents as rendered, but the Components into which
      // we have passed children (via vel.append() or vel.outlet().append())
      else if (vc._preliminaryParent) {
        while (parent && parent._isElementComponent) {
          parent = parent.getParent();
        }
        canMapParent = _mapComponents(state, parent, vc._preliminaryParent);
      }
      if (!canMapParent) {
        state.setRelocated(vc);
        state.setRelocated(comp);
      }
      return canMapParent;
    }

    function _isOfSameType(comp, vc) {
      return (
        (comp._isElementComponent && vc._isVirtualHTMLElement) ||
        (comp._isComponent && vc._isVirtualComponent && comp.constructor === vc.ComponentClass) ||
        (comp._isTextNodeComponent && vc._isVirtualTextNode)
      );
    }

    function _createElement(vel) {
      var el;
      // TODO: we need a element factory here
      // this is fine as long we have only one DOMElement implementation per platform
      if (vel._isVirtualTextNode) {
        el = DefaultDOMElement$a.createTextNode(vel.text);
      } else {
        el = DefaultDOMElement$a.createElement(vel.tagName);
      }
      return el;
    }

    function _updateElement(comp, vel) {
      if (comp._isTextNodeComponent) {
        comp.setTextContent(vel.text);
        return;
      }
      var el = comp.el;
      console.assert(el, "Component's element should exist at this point.");
      var tagName = el.getTagName();
      if (vel.tagName !== tagName) {
        el.setTagName(vel.tagName);
      }
      _updateHash({
        oldHash: el.getAttributes(),
        newHash: vel.getAttributes(),
        update: function(key, val) {
          el.setAttribute(key, val);
        },
        remove: function(key) {
          el.removeAttribute(key);
        }
      });
      _updateHash({
        oldHash: el.htmlProps,
        newHash: vel.htmlProps,
        update: function(key, val) {
          el.setProperty(key, val);
        },
        remove: function(key) {
          el.removeProperty(key);
        }
      });
      _updateListeners({
        el: el,
        oldListeners: el.getEventListeners(),
        newListeners: vel.getEventListeners()
      });

      // special treatment of HTML elements having custom innerHTML
      if (vel.hasInnerHTML()) {
        if (!el._hasInnerHTML) {
          el.empty();
          el.setInnerHTML(vel.getInnerHTML());
        } else {
          var oldInnerHTML = el.getInnerHTML();
          var newInnerHTML = vel.getInnerHTML();
          if (oldInnerHTML !== newInnerHTML) {
            el.setInnerHTML(newInnerHTML);
          }
        }
        el._hasInnerHTML = true;
      }
    }

    function _updateHash(args) {
      var newHash = args.newHash;
      var oldHash = args.oldHash || {};
      var updatedKeys = {};
      var update = args.update;
      var remove = args.remove;
      var key;
      for (key in newHash) {
        if (newHash.hasOwnProperty(key)) {
          var oldVal = oldHash[key];
          var newVal = newHash[key];
          updatedKeys[key] = true;
          if (oldVal !== newVal) {
            update(key, newVal);
          }
        }
      }
      for (key in oldHash) {
        if (oldHash.hasOwnProperty(key) && !updatedKeys[key]) {
          remove(key);
        }
      }
    }

    function _updateListeners(args) {
      var el = args.el;
      // NOTE: considering the low number of listeners
      // it is quicker to just remove all
      // and add again instead of computing the minimal update
      var newListeners = args.newListeners || [];
      el.removeAllEventListeners();
      for (var i=0; i<newListeners.length;i++) {
        el.addEventListener(newListeners[i]);
      }
    }

    function DescendingContext(state, captureContext) {
      this.state = state;
      this.owner = captureContext.owner;
      this.refs = {};
      this.foreignRefs = {};
      this.elements = captureContext.elements;
      this.pos = 0;
      this.updates = captureContext.components.length;
      this.remaining = this.updates;

      this.$$ = this._createComponent.bind(this);
    }
    DescendingContext.Prototype = function() {

      this._createComponent = function() {
        var state = this.state;
        var vel = this.elements[this.pos++];
        // only capture VirtualComponent's with a captured parent
        // all others have been captured at this point already
        // or will either be captured by a different owner
        if (!state.isCaptured(vel) && vel._isVirtualComponent &&
             vel.parent && state.isCaptured(vel.parent)) {
          _capture(state, vel);
          this.updates++;
          this.remaining--;
        }
        // Note: we return a new VirtualElement so that the render method does work
        // as expected.
        // TODO: instead of creating a new VirtualElement each time, we could return
        // an immutable wrapper for the already recorded element.
        vel = VirtualElement$1.createElement.apply(null, arguments);
        // these variables need to be set make the 'ref()' API work
        vel._context = this;
        vel._owner = this.owner;
        // Note: important to deactivate these methods as otherwise the captured
        // element will be damaged when calling el.append()
        vel._attach = function() {};
        vel._detach = function() {};
        return vel;
      };
      this.hasPendingCaptures = function() {
        return this.updates > 0 && this.remaining > 0;
      };
      this.reset = function() {
        this.pos = 0;
        this.updates = 0;
      };
      this._ancestorsReady = function(vel) {
        while (vel) {
          if (this.state.isCaptured(vel) ||
              // TODO: iron this out
              vel === this.owner || vel === this.owner._content) {
            return true;
          }
          vel = vel.parent;
        }
        return false;
      };
    };
    oo$D.initClass(DescendingContext);

    RenderingEngine$2._internal = {
      _capture: _capture,
      _wrap: _createWrappingVirtualComponent,
    };

  };

  oo$D.initClass(RenderingEngine$2);

  function CaptureContext(owner) {
    this.owner = owner;
    this.refs = {};
    this.foreignRefs = {};
    this.elements = [];
    this.components = [];
    this.$$ = this._createComponent.bind(this);
    this.$$.capturing = true;
  }

  CaptureContext.prototype._createComponent = function() {
    var vel = VirtualElement$1.createElement.apply(null, arguments);
    vel._context = this;
    vel._owner = this.owner;
    if (vel._isVirtualComponent) {
      // virtual components need to be captured recursively
      this.components.push(vel);
    }
    this.elements.push(vel);
    return vel;
  };

  function _createWrappingVirtualComponent(comp) {
    var vel = new VirtualElement$1.Component(comp.constructor);
    vel._comp = comp;
    if (comp.__htmlConfig__) {
      vel._mergeHTMLConfig(comp.__htmlConfig__);
    }
    return vel;
  }

  RenderingEngine$2.createContext = function(comp) {
    var vel = _createWrappingVirtualComponent(comp);
    return new CaptureContext(vel);
  };

  function State() {
    this.poluted = [];
    this.id = "__"+uuid$g();
  }

  State.Prototype = function() {

    this.dispose = function() {
      var id = this.id;
      this.poluted.forEach(function(obj) {
        delete obj[id];
      });
    };

    this.set = function(obj, key, val) {
      var info = obj[this.id];
      if (!info) {
        info = {};
        obj[this.id] = info;
      }
      info[key] = val;
    };

    this.get = function(obj, key) {
      var info = obj[this.id];
      if (info) {
        return info[key];
      }
    };

    this.setMapped = function(c) {
      this.set(c, 'mapped', true);
    };


    this.isMapped = function(c) {
      return Boolean(this.get(c, 'mapped'));
    };

    this.setRelocated = function(c) {
      this.set(c, 'relocated', true);
    };

    this.isRelocated = function(c) {
      return Boolean(this.get(c, 'relocated'));
    };

    this.setDetached = function(c) {
      this.set(c, 'detached', true);
    };

    this.isDetached = function(c) {
      return Boolean(this.get(c, 'detached'));
    };

    this.setCaptured = function(vc) {
      this.set(vc, 'captured', true);
    };

    this.isCaptured = function(vc) {
      return Boolean(this.get(vc, 'captured'));
    };

    this.setNew = function(vc) {
      this.set(vc, 'created', true);
    };

    this.isNew = function(vc) {
      return Boolean(this.get(vc, 'created'));
    };

    this.setUpdated = function(vc) {
      this.set(vc, 'updated', true);
    };

    this.isUpdated = function(vc) {
      return Boolean(this.get(vc, 'updated'));
    };

    this.setSkipped = function(vc) {
      this.set(vc, 'skipped', true);
    };

    this.isSkipped = function(vc) {
      return Boolean(this.get(vc, 'skipped'));
    };

    this.setRendered = function(vc) {
      this.set(vc, 'rendered', true);
    };

    this.isRendered = function(vc) {
      return Boolean(this.get(vc, 'rendered'));
    };

    this.setOldProps = function(vc, oldProps) {
      this.set(vc, 'oldProps', oldProps);
    };

    this.getOldProps = function(vc) {
      return this.get(vc, 'oldProps');
    };

    this.setOldState = function(vc, oldState) {
      this.set(vc, 'oldState', oldState);
    };

    this.getOldState = function(vc) {
      return this.get(vc, 'oldState');
    };

  };

  oo$D.initClass(State);

  RenderingEngine$2.State = State;

  module.exports = RenderingEngine$2;

  var inBrowser$3 = require('substance/util/inBrowser');
  var DefaultDOMElement$b = require('substance/ui/DefaultDOMElement');
  var Component$m = require('substance/ui/Component');
  var cloneDeep$9 = require('lodash/cloneDeep');

  function ResponsiveApplication() {
    Component$m.apply(this, arguments);

    this.pages = {};

    this.handleActions({
      'navigate': this.navigate,
    });
  }

  ResponsiveApplication.Prototype = function() {

    this.getInitialState = function() {
      return {
        route: undefined,
        mobile: this._isMobile()
      };
    };

    this.didMount = function() {
      if (inBrowser$3) {
        var _window = DefaultDOMElement$b.getBrowserWindow();
        _window.on('resize', this._onResize, this);
      }
      this.router = this.getRouter();
      this.router.on('route:changed', this._onRouteChanged, this);
      var route = this.router.readRoute();
      // Replaces the current entry without creating new history entry
      // or triggering hashchange
      this.navigate(route, {replace: true});
    };

    this.dispose = function() {
      this.router.off(this);
      this.router.dispose();
    };

    /*
      Used to navigate the app based on given route.

      Example route: {documentId: 'example.xml'}
      On app level, never use setState/extendState directly as this may
      lead to invalid states.
    */
    this.navigate = function(route, opts) {
      this.extendState({
        route: route
      });
      this.router.writeRoute(route, opts);
    };

    this._onRouteChanged = function(route) {
      // console.log('NotesApp._onRouteChanged', route);
      this.navigate(route, {replace: true});
    };

    this._isMobile = function() {
      if (inBrowser$3) {
        return window.innerWidth < 700;
      }
    };

    this._onResize = function() {
      if (this._isMobile()) {
        // switch to mobile
        if (!this.state.mobile) {
          this.extendState({
            mobile: true
          });
        }
      } else {
        if (this.state.mobile) {
          this.extendState({
            mobile: false
          });
        }
      }
    };

    this._getPage = function() {
      return this.state.route.page || this.getDefaultPage();
    };

    this._getPageClass = function() {
      var page = this._getPage();
      return this.pages[page];
    };

    this._getPageProps = function() {
      var props = cloneDeep$9(this.state.route);
      delete props.page;
      props.mobile = this.state.mobile;
      return props;
    };

    this.addPage = function(pageName, PageClass) {
      this.pages[pageName] = PageClass;
    };

    this.renderPage = function($$) {
      var PageClass = this._getPageClass();
      var pageName = this._getPage();
      return $$(PageClass, this._getPageProps()).ref(pageName);
    };

    this.render = function($$) {
      var el = $$('div').addClass('sc-responsive-application');

      if (this.state.route === undefined) {
        // Not yet initialized by router
        return el;
      }

      el.append(
        this.renderPage($$)
      );

      return el;
    };

  };

  Component$m.extend(ResponsiveApplication);
  module.exports = ResponsiveApplication;

  var each$n = require('lodash/each');
  var EventEmitter$d = require('../util/EventEmitter');
  var DefaultDOMElement$c = require('./DefaultDOMElement');

  function Router() {
    EventEmitter$d.apply(this, arguments);
    this.__isStarted__ = false;
  }

  Router.Prototype = function() {

    /*
      Starts listening for hash-changes
    */
    this.start = function() {
      var window = DefaultDOMElement$c.getBrowserWindow();
      window.on('hashchange', this._onHashChange, this);
      this.__isStarted__ = true;
    };

    /*
      Reads out the current route
    */
    this.readRoute = function() {
      if (!this.__isStarted__) this.start();
      return this.parseRoute(this.getRouteString());
    };

    /*
      Writes out a given route as a string url
    */
    this.writeRoute = function(route, opts) {
      opts = opts || {};
      var routeString = this.stringifyRoute(route);
      if (!routeString) {
        this.clearRoute(opts);
      } else {
        this._writeRoute(routeString, opts);
      }
    };

    this.dispose = function() {
      var window = DefaultDOMElement$c.getBrowserWindow();
      window.off(this);
    };

    /*
      Maps a route URL to a route object

      @abstract
      @param String route content of the URL's hash fragment
    */
    this.parseRoute = function(routeString) {
      return Router.routeStringToObject(routeString);
    };

    /*
      Maps a route object to a route URL

      This can be overriden by an application specific router.

      @abstract
    */
    this.stringifyRoute = function(route) {
      return Router.objectToRouteString(route);
    };

    this.getRouteString = function() {
      return window.location.hash.slice(1);
    };

    this._writeRoute = function(route, opts) {
      this.__isSaving__ = true;
      try {
        if (opts.replace) {
          window.history.replaceState({} , '', '#'+route);
        } else {
          window.history.pushState({} , '', '#'+route);
        }
      } finally {
        this.__isSaving__ = false;
      }
    };

    this.clearRoute = function(opts) {
      this._writeRoute('', opts);
    };

    this._onHashChange = function() {
      // console.log('_onHashChange');
      if (this.__isSaving__) {
        return;
      }
      if (this.__isLoading__) {
        console.error('FIXME: router is currently applying a route.');
        return;
      }
      this.__isLoading__ = true;
      try {
        var routeString = this.getRouteString();
        var route = this.parseRoute(routeString);
        this.emit('route:changed', route);
      } finally {
        this.__isLoading__ = false;
      }
    };

  };

  EventEmitter$d.extend(Router);

  Router.objectToRouteString = function(obj) {
    var route = [];
    each$n(obj, function(val, key) {
      route.push(key+'='+val);
    });
    return route.join(',');
  };

  Router.routeStringToObject = function(routeStr) {
    var obj = {};
    // Empty route maps to empty route object
    if (!routeStr) return obj;
    var params = routeStr.split(',');
    params.forEach(function(param) {
      var tuple = param.split('=');
      if (tuple.length !== 2) {
        throw new Error('Illegal route.');
      }
      obj[tuple[0].trim()] = tuple[1].trim();
    });
    return obj;
  };

  module.exports = Router;

  var oo$E = require('../util/oo');

  var SaveHandlerStub = function() {
  };

  SaveHandlerStub.Prototype = function() {
    this.saveDocument = function(doc, changes, cb) {
      console.warn('No SaveHandler provided. Using Stub.');
      cb(null);
    };
  };

  oo$E.initClass(SaveHandlerStub);

  module.exports = SaveHandlerStub;

  var Component$n = require('./Component');
  var each$o = require('lodash/each');
  var DefaultDOMElement$d = require('./DefaultDOMElement');

  /**
    A rich scrollbar implementation that supports highlights.   Usually
    instantiated by {@link ScrollPane}, so you will likely not create it
    yourself.

    @class Scrollbar
    @component
    @private

    @prop {ui/ScrollPane} scrollPane scroll pane the scrollbar operates on
    @prop {object} highlights hightlights grouped by scope

    @example

    ```js
    $$(Scrollbar, {
      scrollPane: this,
      highlights: {
        'bib-items': ['bib-item-citation-1', 'bib-item-citation-2']
      }
    }).ref('scrollbar')
    ```
  */

  function Scrollbar() {
    Scrollbar.super.apply(this, arguments);
  }

  Scrollbar.Prototype = function() {

    this.didMount = function() {
      // do a full rerender when window gets resized
      DefaultDOMElement$d.getBrowserWindow().on('resize', this.onResize, this);
      // update the scroll handler on scroll
      this.props.scrollPane.on('scroll', this.onScroll, this);
      // TODO: why is this necessary here?
      setTimeout(function() {
        this.updatePositions();
      }.bind(this));
    };

    this.dispose = function() {
      DefaultDOMElement$d.getBrowserWindow().off(this);
      this.props.scrollPane.off(this);
    };

    this.didUpdate = function() {
      this.updatePositions();
    };

    this.render = function($$) {
      var el = $$('div')
        .addClass('sc-scrollbar')
        .on('mousedown', this.onMouseDown);

      if (this.props.highlights) {
        var highlightEls = [];

        each$o(this.props.highlights, function(highlights, scope) {
          each$o(highlights, function(h) {
            highlightEls.push(
              $$('div').ref(h).addClass('se-highlight sm-'+scope)
            );
          });
        });

        el.append(
          $$('div').ref('highlights')
            .addClass('se-highlights')
            .append(highlightEls)
        );
      }

      el.append($$('div').ref('thumb').addClass('se-thumb'));
      return el;
    };

    this.updatePositions = function() {
      var scrollPane = this.props.scrollPane;
      var scrollableEl = scrollPane.getScrollableElement();
      var contentHeight = scrollPane.getContentHeight();
      var scrollPaneHeight = scrollPane.getHeight();
      var scrollTop = scrollPane.getScrollPosition();

      // Needed for scrollbar interaction
      this.factor = (contentHeight / scrollPaneHeight);

      // Update thumb
      this.refs.thumb.css({
        top: scrollTop / this.factor,
        height: scrollPaneHeight / this.factor
      });

      // If we have highlights, update them as well
      if (this.props.highlights) {
        // Compute highlights
        each$o(this.props.highlights,function(highlights) {
          each$o(highlights, function(nodeId) {
            var nodeEl = scrollableEl.find('*[data-id="'+nodeId+'"]');
            if (!nodeEl) return;
            var top = nodeEl.getPosition().top / this.factor;
            var height = nodeEl.getOuterHeight(true) / this.factor;

            // Use specified minHeight for highlights
            if (height < Scrollbar.overlayMinHeight) {
              height = Scrollbar.overlayMinHeight;
            }

            var highlightEl = this.refs[nodeId];
            if (highlightEl) {
              this.refs[nodeId].css({
                top: top,
                height: height
              });
            } else {
              console.warn('no ref found for highlight', nodeId);
            }
          }.bind(this));
        }.bind(this));
      }
    };

    this.getScrollableElement = function() {
      return this.props.scrollPane.getScrollableElement();
    };

    this.onResize = function() {
      this.rerender();
    };

    this.onScroll = function() {
      this.updatePositions();
    };

    this.onMouseDown = function(e) {
      e.stopPropagation();
      e.preventDefault();
      this._mouseDown = true;

      // temporarily, we bind to events on window level
      // because could leave the this element's area while dragging
      var _window = DefaultDOMElement$d.getBrowserWindow();
      _window.on('mousemove', this.onMouseMove, this);
      _window.on('mouseup', this.onMouseUp, this);

      var scrollBarOffset = this.el.getOffset().top;
      var y = e.pageY - scrollBarOffset;
      var thumbEl = this.refs.thumb.el;
      if (e.target !== thumbEl.getNativeElement()) {
        // Jump to mousedown position
        this.offset = thumbEl.height / 2;
        this.onMouseMove(e);
      } else {
        this.offset = y - thumbEl.getPosition().top;
      }
    };

    // Handle Mouse Up
    this.onMouseUp = function() {
      this._mouseDown = false;
      var _window = DefaultDOMElement$d.getBrowserWindow();
      _window.off('mousemove', this.onMouseMove, this);
      _window.off('mouseup', this.onMouseUp, this);
    };

    this.onMouseMove = function(e) {
      if (this._mouseDown) {
        var scrollPane = this.props.scrollPane;
        var scrollableEl = scrollPane.getScrollableElement();
        var scrollBarOffset = this.el.getOffset().top;
        var y = e.pageY - scrollBarOffset;

        // find offset to visible-area.top
        var scroll = (y-this.offset)*this.factor;
        scrollableEl.setProperty('scrollTop', scroll);
      }
    };
  };

  Component$n.extend(Scrollbar);
  Scrollbar.overlayMinHeight = 2;

  module.exports = Scrollbar;

  var platform$3 = require('../util/platform');
  var Component$o = require('./Component');
  var Scrollbar$1 = require('./Scrollbar');
  var getRelativeBoundingRect$1 = require('../util/getRelativeBoundingRect');

  /**
    Wraps content in a scroll pane.

    @class ScrollPane
    @component

    @prop {String} scrollbarType 'native' or 'substance' for a more advanced visual scrollbar. Defaults to 'native'
    @prop {String} [scrollbarPosition] 'left' or 'right' only relevant when scrollBarType: 'substance'. Defaults to 'right'
    @prop {ui/Highlights} [highlights] object that maintains highlights and can be manipulated from different sources
    @prop {ui/TOCProvider} [tocProvider] object that maintains table of content entries

    @example

    ```js
    $$(ScrollPane, {
      scrollbarType: 'substance', // defaults to native
      scrollbarPosition: 'left', // defaults to right
      onScroll: this.onScroll.bind(this),
      highlights: this.contentHighlights,
      tocProvider: this.tocProvider
    })
    ```
   */
  function ScrollPane$1() {
    Component$o.apply(this, arguments);
  }

  ScrollPane$1.Prototype = function() {

    /*
      Expose scrollPane as a child context
    */
    this.getChildContext = function() {
      return {
        scrollPane: this
      };
    };

    this.didMount = function() {
      if (this.props.highlights) {
        this.props.highlights.on('highlights:updated', this.onHighlightsUpdated, this);
      }
      // HACK: Scrollbar should use DOMMutationObserver instead
      if (this.refs.scrollbar) {
        this.context.doc.on('document:changed', this.onDocumentChange, this, { priority: -1 });
      }

      this.handleActions({
        'updateOverlayHints': this._updateOverlayHints
      });
    };

    this.dispose = function() {
      if (this.props.highlights) {
        this.props.highlights.off(this);
      }
      this.context.doc.off(this);
    };

    this.render = function($$) {
      var el = $$('div')
        .addClass('sc-scroll-pane');
      var overlay;

      if (platform$3.isFF) {
        el.addClass('sm-firefox');
      }

      // Initialize Substance scrollbar (if enabled)
      if (this.props.scrollbarType === 'substance') {
        el.addClass('sm-substance-scrollbar');
        el.addClass('sm-scrollbar-position-'+this.props.scrollbarPosition);

        el.append(
          // TODO: is there a way to pass scrollbar highlights already
          // via props? Currently the are initialized with a delay
          $$(Scrollbar$1, {
            scrollPane: this
          }).ref('scrollbar')
            .attr('id', 'content-scrollbar')
        );

        // Scanline is debugging purposes, display: none by default.
        el.append(
          $$('div').ref("scanline").addClass('se-scanline')
        );
      }

      if (this.props.overlay) {
        var componentRegistry = this.context.componentRegistry;
        var OverlayClass = componentRegistry.get('overlay');
        overlay = $$(OverlayClass, {
          overlay: this.props.overlay
        }).ref('overlay');
      }

      el.append(
        $$('div').ref('scrollable').addClass('se-scrollable').append(
          $$('div').ref('content').addClass('se-content')
            .append(overlay)
            .append(
              this.props.children
            )
        ).on('scroll', this.onScroll)
      );
      return el;
    };

    this._updateOverlayHints = function(overlayHints) {
      // Remember overlay hints for next update
      var overlay = this.refs.overlay;
      if (overlay) {
        overlay.position(overlayHints);
      }
    };

    // HACK: Scrollbar should use DOMMutationObserver instead
    this.onDocumentChange = function() {
      this.refs.scrollbar.updatePositions();
    };

    this.onHighlightsUpdated = function(highlights) {
      this.refs.scrollbar.extendProps({
        highlights: highlights
      });
    };

    this.onScroll = function() {
      var scrollPos = this.getScrollPosition();
      var scrollable = this.refs.scrollable;
      if (this.props.onScroll) {
        this.props.onScroll(scrollPos, scrollable);
      }
      // Update TOCProvider given
      if (this.props.tocProvider) {
        this.props.tocProvider.markActiveEntry(this);
      }
      this.emit('scroll', scrollPos, scrollable);
    };

    /**
      Returns the height of scrollPane (inner content overflows)
    */
    this.getHeight = function() {
      var scrollableEl = this.getScrollableElement();
      return scrollableEl.height;
    };

    /**
      Returns the cumulated height of a panel's content
    */
    this.getContentHeight = function() {
      var contentHeight = 0;
      var contentEl = this.refs.content.el;
      contentEl.childNodes.forEach(function(el) {
        contentHeight += el.getOuterHeight();
      });
      return contentHeight;
    };

    /**
      Get the `.se-content` element
    */
    this.getContentElement = function() {
      return this.refs.content.el;
    };

    /**
      Get the `.se-scrollable` element
    */
    this.getScrollableElement = function() {
      return this.refs.scrollable.el;
    };

    /**
      Get current scroll position (scrollTop) of `.se-scrollable` element
    */
    this.getScrollPosition = function() {
      var scrollableEl = this.getScrollableElement();
      return Math.floor(scrollableEl.getProperty('scrollTop') + 1);
    };

    /**
      Get offset relative to `.se-content`.

      @param {DOMNode} el DOM node that lives inside the
    */
    this.getPanelOffsetForElement = function(el) {
      var nativeEl = el.el;
      var contentContainerEl = this.refs.content.el.el;
      var rect = getRelativeBoundingRect$1(nativeEl, contentContainerEl);
      return rect.top;
    };

    /**
      Scroll to a given sub component.

      @param {String} componentId component id, must be present in data-id attribute
    */
    this.scrollTo = function(componentId) {
      var scrollableEl = this.getScrollableElement();
      var targetNode = scrollableEl.find('*[data-id="'+componentId+'"]');
      if (targetNode) {
        var offset = this.getPanelOffsetForElement(targetNode);
        scrollableEl.setProperty('scrollTop', offset);
      } else {
        console.warn(componentId, 'not found in scrollable container');
      }
    };
  };

  Component$o.extend(ScrollPane$1);

  module.exports = ScrollPane$1;

  var Component$p = require('./Component');

  /**
    A split view layout component. Takes properties for configuration and 2 children via append.

    @class SplitPane
    @component

    @prop {String} splitType either 'vertical' (default) or 'horizontal'.
    @prop {String} sizeA size of the first pane (A). '40%' or '100px' or 'inherit' are valid values.
    @prop {String} sizeB size of second pane. sizeA and sizeB can not be combined.

    @example

    ```js
    $$(SplitPane, {
      sizeA: '30%'
      splitType: 'horizontal'
    }).append(
      $$('div').append('Pane A')
      $$('div').append('Pane B')
    )
    ```
  */

  function SplitPane$1() {
    Component$p.apply(this, arguments);
  }

  SplitPane$1.Prototype = function() {

    this.render = function($$) {
      if (this.props.children.length !== 2) {
        throw new Error('SplitPane only works with exactly two child elements');
      }

      var el = $$('div').addClass('sc-split-pane');
      if (this.props.splitType === 'horizontal') {
        el.addClass('sm-horizontal');
      } else {
        el.addClass('sm-vertical');
      }

      var paneA = this.props.children[0];
      var paneB = this.props.children[1];

      // Apply configured size either to pane A or B.
      if (this.props.sizeB) {
        paneB.addClass('se-pane sm-sized');
        paneB.css(this.getSizedStyle(this.props.sizeB));
        paneA.addClass('se-pane sm-auto-fill');
      } else {
        paneA.addClass('se-pane sm-sized');
        paneA.css(this.getSizedStyle(this.props.sizeA));
        paneB.addClass('se-pane sm-auto-fill');
      }

      el.append(
        paneA,
        paneB
      );
      return el;
    };

    // Accepts % and px units for size property
    this.getSizedStyle = function(size) {
      if (!size || size === 'inherit') return {};
      if (this.props.splitType === 'horizontal') {
        return {'height': size};
      } else {
        return {'width': size};
      }
    };

  };

  Component$p.extend(SplitPane$1);

  module.exports = SplitPane$1;

  var Component$q = require('./Component');

  var ICONS_FOR_TYPE = {
    "error": "fa-exclamation-circle",
    "info": "fa-info",
    "progress": "fa-exchange",
    "success": "fa-check-circle",
  };

  /*
    A simple StatusBar implementation that displays a document's title and
    renders messages.

    @class
    @component

    @prop {model/Document} doc The document instance

    @state {String} message The message displayed in the status bar.
  */

  function StatusBar() {
    Component$q.apply(this, arguments);
  }

  StatusBar.Prototype = function() {

    this.didMount = function() {
      var logger = this.context.controller.getLogger();
      logger.on('messages:updated', this.handleStatusUpdate, this);
    };

    this.dispose = function() {
      var logger = this.context.controller.getLogger();
      logger.off(this);
    };

    this.render = function($$) {
      var meta = this.props.doc.getDocumentMeta();
      var title = meta ? meta.title : this.getLabel('untitled');
      var message = this.state.message;

      var el = $$('div').addClass("status-bar-component fill-light");
      el.append($$("div").addClass("document-status").append(title));

      if (message) {
        el.addClass(message.type);
        el.append(
          $$('div').addClass('notifications').append(
            $$("div").addClass("icon").append(
              $$('i').addClass('fa '+ICONS_FOR_TYPE[message.type])
            )
          ),
          $$('div').addClass('message').append(message.message)
        );
      }
      return el;
    };

    this.handleStatusUpdate = function(messages) {
      var currentMessage = messages.pop();
      this.setState({
        message: currentMessage
      });
    };
  };

  Component$q.extend(StatusBar);

  module.exports = StatusBar;

  var forEach$a = require('lodash/forEach');
  var isUndefined = require('lodash/isUndefined');
  var startsWith$2 = require('lodash/startsWith');
  var createSurfaceId$1 = require('../util/createSurfaceId');
  var getRelativeBoundingRect$2 = require('../util/getRelativeBoundingRect');
  var keys$4 = require('../util/keys');
  var platform$4 = require('../util/platform');
  var inBrowser$4 = require('../util/inBrowser');
  var copySelection$1 = require('../model/transform/copySelection');
  var deleteSelection$6 = require('../model/transform/deleteSelection');
  var deleteCharacter$1 = require('../model/transform/deleteCharacter');
  var insertText$3 = require('../model/transform/insertText');
  var Clipboard$1 = require('./Clipboard');
  var Component$r = require('./Component');
  var DefaultDOMElement$e = require('./DefaultDOMElement');
  var DOMSelection$1 = require('./DOMSelection');
  var UnsupportedNode$1 = require('./UnsupportedNodeComponent');

  /**
     Abstract interface for editing components.
     Dances with contenteditable, so you don't have to.

     @class
     @component
     @abstract
  */
  function Surface$1() {
    Surface$1.super.apply(this, arguments);

    // DocumentSession instance must be provided either as a prop
    // or via dependency-injection
    this.documentSession = this.props.documentSession || this.context.documentSession;
    if (!this.documentSession) {
      throw new Error('No DocumentSession provided');
    }
    this.name = this.props.name;
    if (!this.name) {
      throw new Error('Surface must have a name.');
    }
    if (this.name.indexOf('/') > -1) {
      // because we are using '/' to deal with nested surfaces (isolated nodes)
      throw new Error("Surface.name must not contain '/'");
    }
    // this path is an identifier unique for this surface
    // considering nesting in IsolatedNodes
    this._surfaceId = createSurfaceId$1(this);

    this.clipboard = new Clipboard$1(this, {
      converterRegistry: this.context.converterRegistry
    });

    this.domSelection = null;
    this.domObserver = null;

    // HACK: we need to listen to mousup on document
    // to catch events outside the surface
    if (inBrowser$4) {
      this.documentEl = DefaultDOMElement$e.wrapNativeElement(window.document);
    }

    // set when editing is enabled
    this.undoEnabled = true;
    this.textTypes = this.props.textTypes;

    // a registry for TextProperties which allows us to dispatch changes
    this._textProperties = {};

    this._state = {
      // true if the document session's selection is addressing this surface
      skipNextFocusEvent: false,
      skipNextObservation: false,
      // used to avoid multiple rerenderings (e.g. simultanous update of text and fragments)
      isDirty: false,
      dirtyProperties: {},
      // while fragments are provided as a hash of (type -> [Fragment])
      // we derive a hash of (prop-key -> [Fragment]); in other words, Fragments grouped by property
      fragments: {},
      // we want to show the cursor fragment only when blurred, so we keep it separated from the other fragments
      cursorFragment: null,
    };

    Surface$1.prototype._deriveInternalState.call(this, this.props);
  }

  Surface$1.Prototype = function() {

    this.getChildContext = function() {
      return {
        surface: this,
        surfaceParent: this,
        doc: this.getDocument()
      };
    };

    this.didMount = function() {
      if (this.context.surfaceManager) {
        this.context.surfaceManager.registerSurface(this);
      }
      if (!this.isReadonly() && inBrowser$4) {
        this.domSelection = new DOMSelection$1(this);
        this.clipboard.didMount();
        // this.domObserver = new window.MutationObserver(this.onDomMutations.bind(this));
        // this.domObserver.observe(this.el.getNativeElement(), { subtree: true, characterData: true, characterDataOldValue: true });
      }
      this.documentSession.on('update', this._onSessionUpdate, this);
    };


    this.dispose = function() {
      this.documentSession.off(this);
      this.domSelection = null;
      if (this.domObserver) {
        this.domObserver.disconnect();
      }
      if (this.context.surfaceManager) {
        this.context.surfaceManager.unregisterSurface(this);
      }
    };

    this.willReceiveProps = function(nextProps) {
      Surface$1.prototype._deriveInternalState.call(this, nextProps);
    };

    this.didUpdate = function(oldProps, oldState) {
      this._update(oldProps, oldState);
    };

    this.render = function($$) {
      var tagName = this.props.tagName || 'div';
      var el = $$(tagName)
        .addClass('sc-surface')
        .attr('spellCheck', false)
        .attr('tabindex', 2);

      if (!this.isDisabled()) {
        if (this.isEditable()) {
          // Keyboard Events
          el.on('keydown', this.onKeyDown);
          // OSX specific handling of dead-keys
          if (!platform$4.isIE) {
            el.on('compositionstart', this.onCompositionStart);
          }
          // Note: TextEvent in Chrome/Webkit is the easiest for us
          // as it contains the actual inserted string.
          // Though, it is not available in FF and not working properly in IE
          // where we fall back to a ContentEditable backed implementation.
          if (inBrowser$4 && window.TextEvent && !platform$4.isIE) {
            el.on('textInput', this.onTextInput);
          } else {
            el.on('keypress', this.onTextInputShim);
          }
        }
        if (!this.isReadonly()) {
          // Mouse Events
          el.on('mousedown', this.onMouseDown);
          // disable drag'n'drop
          el.on('dragstart', this.onDragStart);
          // we will react on this to render a custom selection
          el.on('focus', this.onNativeFocus);
          el.on('blur', this.onNativeBlur);
          // activate the clipboard
          this.clipboard.attach(el);
        }
      }
      return el;
    };

    this.renderNode = function($$, node) {
      var doc = this.getDocument();
      var componentRegistry = this.getComponentRegistry();
      var ComponentClass = componentRegistry.get(node.type);
      if (!ComponentClass) {
        console.error('Could not resolve a component for type: ' + node.type);
        ComponentClass = UnsupportedNode$1;
      }
      return $$(ComponentClass, {
        doc: doc,
        node: node
      }).ref(node.id);
    };

    this.getComponentRegistry = function() {
      return this.context.componentRegistry || this.props.componentRegistry;
    };

    this.getName = function() {
      return this.name;
    };

    this.getId = function() {
      return this._surfaceId;
    };

    this.isDisabled = function() {
      return this.props.disabled;
    };

    this.isEditable = function() {
      return (this.props.editing === "full" || this.props.editing === undefined);
    };

    this.isSelectable = function() {
      return (this.props.editing === "selection" || this.props.editing === "full");
    };

    this.isReadonly = function() {
      return this.props.editing === "readonly";
    };

    this.getElement = function() {
      return this.el;
    };

    this.getController = function() {
      return this.context.controller;
    };

    this.getDocument = function() {
      return this.documentSession.getDocument();
    };

    this.getDocumentSession = function() {
      return this.documentSession;
    };

    this.isEnabled = function() {
      return !this.state.disabled;
    };

    this.isContainerEditor = function() {
      return false;
    };

    this.getContainerId = function() {
      return null;
    };

    /**
      Run a transformation as a transaction properly configured for this surface.

      @param transformation a transformation function(tx, args) which receives
                            the selection the transaction was started with, and should return
                            output arguments containing a selection, as well.

      @example

      Returning a new selection:
      ```js
      surface.transaction(function(tx, args) {
        var selection = args.selection;
        ...
        selection = tx.createSelection(...);
        return {
          selection: selection
        };
      });
      ```

      Adding event information to the transaction:

      ```js
      surface.transaction(function(tx, args) {
        tx.info.foo = 'bar';
        ...
      });
      ```
     */
    this.transaction = function(transformation, info) {
      // TODO: we would like to get rid of this method, and only have
      // documentSession.transaction()
      // The problem is, that we need to get surfaceId into the change,
      // to be able to set the selection into the right surface.
      // ATM we put this into the selection, which is hacky, and makes it
      // unnecessarily inconvient to create selections.
      // Maybe documentSession should provide a means to augment the before/after
      // state of a change.
      var documentSession = this.documentSession;
      var surfaceId = this.getId();
      return documentSession.transaction(function(tx, args) {
        tx.before.surfaceId = surfaceId;
        return transformation(tx, args);
      }, info);
    };

    this.getSelection = function() {
      return this.documentSession.getSelection();
    };

    /**
     * Set the model selection and update the DOM selection accordingly
     */
    this.setSelection = function(sel) {
      // console.log('Surface.setSelection()', this.name, sel);
      // storing the surface id so that we can associate
      // the selection with this surface later
      if (sel && !sel.isNull()) {
        sel.surfaceId = this.getId();
        sel.containerId = sel.containerId || this.getContainerId();
      }
      this._setSelection(sel);
    };

    this.blur = function() {
      if (this.el) {
        this.el.blur();
      }
    };

    this.focus = function() {
      if (this.isDisabled()) return;
      // console.log('Focusing surface %s explicitly with Surface.focus()', this.getId());
      // NOTE: FF is causing problems with dynamically activated contenteditables
      // and focusing
      if (platform$4.isFF) {
        this.domSelection.clear();
        this.el.getNativeElement().blur();
      }
      this._focus();
    };

    this.rerenderDOMSelection = function() {
      if (this.isDisabled()) return;
      if (inBrowser$4) {
        // console.log('Surface.rerenderDOMSelection', this.__id__);
        var sel = this.getSelection();
        if (sel.surfaceId === this.getId()) {
          this.domSelection.setSelection(sel);
        }
      }
    };

    this.getDomNodeForId = function(nodeId) {
      return this.el.getNativeElement().querySelector('*[data-id="'+nodeId+'"]');
    };

    /* Editing behavior */

    /* Note: In a regular Surface all text properties are treated independently
       like in a form */

    /**
      Selects all text
    */
    this.selectAll = function() {
      var doc = this.getDocument();
      var sel = this.getSelection();
      if (sel.isPropertySelection()) {
        var path = sel.path;
        var text = doc.get(path);
        sel = doc.createSelection({
          type: 'property',
          path: path,
          startOffset: 0,
          endOffset: text.length
        });
        this.setSelection(sel);
      }
    };

    /**
      Performs an {@link model/transform/insertText} transformation
    */
    this.insertText = function(tx, args) {
      var sel = args.selection;
      if (sel.isPropertySelection() || sel.isContainerSelection()) {
        return insertText$3(tx, args);
      }
    };

    /**
      Performs a {@link model/transform/deleteSelection} transformation
    */
    this.delete = function(tx, args) {
      var sel = args.selection;
      if (!sel.isCollapsed()) {
        return deleteSelection$6(tx, args);
      }
      else if (sel.isPropertySelection() || sel.isNodeSelection()) {
        return deleteCharacter$1(tx, args);
      }
    };

    // No breaking in properties, insert softbreak instead
    this.break = function(tx, args) {
      return this.softBreak(tx, args);
    };

    /**
      Inserts a soft break
    */
    this.softBreak = function(tx, args) {
      args.text = "\n";
      return this.insertText(tx, args);
    };

    /**
      Copy the current selection. Performs a {@link model/transform/copySelection}
      transformation.
    */
    this.copy = function(doc, selection) {
      var result = copySelection$1(doc, { selection: selection });
      return result.doc;
    };

    /**
      Performs a {@link model/transform/paste} transformation
    */
    this.paste = function(tx, args) {
      // TODO: for now only plain text is inserted
      // We could do some stitching however, preserving the annotations
      // received in the document
      if (args.text) {
        return this.insertText(tx, args);
      }
    };

    /* Event handlers */

    /*
     * Handle document key down events.
     */
    this.onKeyDown = function(event) {
      // console.log('Surface.onKeyDown()', this.getId());

      var commandManager = this.context.commandManager;
      if ( event.which === 229 ) {
        // ignore fake IME events (emitted in IE and Chromium)
        return;
      }
      switch ( event.keyCode ) {
        case keys$4.LEFT:
        case keys$4.RIGHT:
          return this._handleLeftOrRightArrowKey(event);
        case keys$4.UP:
        case keys$4.DOWN:
          return this._handleUpOrDownArrowKey(event);
        case keys$4.ENTER:
          return this._handleEnterKey(event);
        case keys$4.SPACE:
          return this._handleSpaceKey(event);
        case keys$4.BACKSPACE:
        case keys$4.DELETE:
          return this._handleDeleteKey(event);
        case keys$4.HOME:
        case keys$4.END:
          return this._handleHomeOrEndKey(event);
        case keys$4.PAGEUP:
        case keys$4.PAGEDOWN:
          return this._handlePageUpOrDownKey(event);
        default:
          break;
      }

      // Note: when adding a new handler you might want to enable this log to see keyCodes etc.
      // console.log('####', event.keyCode, event.metaKey, event.ctrlKey, event.shiftKey);

      // Built-in key combos
      // Ctrl+A: select all
      var handled = false;
      if ( (event.ctrlKey||event.metaKey) && event.keyCode === 65) {
        this.selectAll();
        handled = true;
      }
      // Undo/Redo: cmd+z, cmd+shift+z
      else if (this.undoEnabled && event.keyCode === 90 && (event.metaKey||event.ctrlKey)) {
        if (event.shiftKey) {
          commandManager.executeCommand('redo');
        } else {
          commandManager.executeCommand('undo');
        }
        handled = true;
      }
      // Toggle strong: cmd+b ctrl+b
      else if (event.keyCode === 66 && (event.metaKey||event.ctrlKey)) {
        commandManager.executeCommand('strong');
        handled = true;
      }
      // Toggle emphasis: cmd+i ctrl+i
      else if (event.keyCode === 73 && (event.metaKey||event.ctrlKey)) {
        commandManager.executeCommand('emphasis');
        handled = true;
      }
      // Toggle link: cmd+k ctrl+k
      else if (event.keyCode === 75 && (event.metaKey||event.ctrlKey)) {
        commandManager.executeCommand('link');
        handled = true;
      }

      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    this.onTextInput = function(event) {
      // console.log("TextInput:", event);
      event.preventDefault();
      event.stopPropagation();
      if (!event.data) return;
      // necessary for handling dead keys properly
      this._state.skipNextObservation=true;
      this.transaction(function(tx, args) {
        if (this.domSelection) {
          // trying to remove the DOM selection to reduce flickering
          this.domSelection.clear();
        }
        args.text = event.data;
        return this.insertText(tx, args);
      }.bind(this), { action: 'type' });
    };

    // Handling Dead-keys under OSX
    this.onCompositionStart = function() {
      // just tell DOM observer that we have everything under control
      this._state.skipNextObservation = true;
    };

    this.onTextInputShim = function(event) {
      // Filter out non-character keys
      if (
        // Catches most keys that don't produce output (charCode === 0, thus no character)
        event.which === 0 || event.charCode === 0 ||
        // Opera 12 doesn't always adhere to that convention
        event.keyCode === keys$4.TAB || event.keyCode === keys$4.ESCAPE ||
        // prevent combinations with meta keys, but not alt-graph which is represented as ctrl+alt
        Boolean(event.metaKey) || (Boolean(event.ctrlKey)^Boolean(event.altKey))
      ) {
        return;
      }
      var character = String.fromCharCode(event.which);
      this._state.skipNextObservation=true;
      if (!event.shiftKey) {
        character = character.toLowerCase();
      }
      if (character.length>0) {
        this.transaction(function(tx, args) {
          if (this.domSelection) {
            // trying to remove the DOM selection to reduce flickering
            this.domSelection.clear();
          }
          args.text = character;
          return this.insertText(tx, args);
        }.bind(this), { action: 'type' });
        event.preventDefault();
        event.stopPropagation();
        return;
      } else {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    // TODO: the whole mouse event based selection mechanism needs
    // to be redesigned. The current implementation works basically
    // though, there are some things which do not work well cross-browser
    // particularly, double- and triple clicks.
    this.onMouseDown = function(event) {
      // console.log('mousedown on', this.name);
      event.stopPropagation();

      // special treatment for triple clicks
      if (!(platform$4.isIE && platform$4.version<12) && event.detail >= 3) {
        var sel = this.getSelection();
        if (sel.isPropertySelection()) {
          this._selectProperty(sel.path);
          event.preventDefault();
          event.stopPropagation();
          return;
        } else if (sel.isContainerSelection()) {
          this._selectProperty(sel.startPath);
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
      // TODO: what is this exactly?
      if ( event.which !== 1 ) {
        return;
      }
      // 'mouseDown' is triggered before 'focus' so we tell
      // our focus handler that we are already dealing with it
      // The opposite situation, when the surface gets focused e.g. using keyboard
      // then the handler needs to kick in and recover a persisted selection or such
      this._state.skipNextFocusEvent = true;

      // UX-wise, the proper way is to apply the selection on mousedown, and if a drag is started (range selection)
      // we could maybe map the selection during the drag, but finally once after mouse is released.
      // TODO: this needs to be solved properly; be aware of browser incompatibilities
      // HACK: not working in IE which then does not allow a range selection anymore
      if (!platform$4.isIE) {
        // HACK: clearing the DOM selection, otherwise we have troubles with the old selection being in the way for the next selection
        this.domSelection.clear();
        setTimeout(function() {
          if (this.domSelection) {
            var sel = this.domSelection.getSelection();
            this.setSelection(sel);
          }
        }.bind(this));
      }

      // Bind mouseup to the whole document in case of dragging out of the surface
      if (this.documentEl) {
        // TODO: we should handle mouse up only if we started a drag (and the selection has really changed)
        this.documentEl.on('mouseup', this.onMouseUp, this, { once: true });
      }
    };

    this.onMouseUp = function() {
      // ATTENTION: this delay is necessary for cases the user clicks
      // into an existing selection. In this case the window selection still
      // holds the old value, and is set to the correct selection after this
      // being called.
      setTimeout(function() {
        if (this.domSelection) {
          var sel = this.domSelection.getSelection();
          this.setSelection(sel);
        }
      }.bind(this));
    };

    this.onDomMutations = function(e) {
      if (this._state.skipNextObservation) {
        this._state.skipNextObservation = false;
        return;
      }
      // Known use-cases:
      //  - Context-menu:
      //      - Delete
      //      - Note: copy, cut, paste work just fine
      //  - dragging selected text
      //  - spell correction
      console.info("We want to enable a DOM MutationObserver which catches all changes made by native interfaces (such as spell corrections, etc). Lookout for this message and try to set Surface.skipNextObservation=true when you know that you will mutate the DOM.", e);
    };

    this.onDragStart = function(event) {
      event.preventDefault();
      event.stopPropagation();
    };

    this.onNativeBlur = function() {
      // console.log('Native blur on surface', this.getId());
      var _state = this._state;
      _state.hasNativeFocus = false;
    };

    this.onNativeFocus = function() {
      // console.log('Native focus on surface', this.getId());
      var _state = this._state;
      _state.hasNativeFocus = true;
    };

    // Internal implementations

    // called whenever we receive props
    // used to compute fragments that get dispatched to TextProperties
    this._deriveInternalState = function(nextProps) {
      var _state = this._state;
      var oldFragments = _state.fragments;
      if (oldFragments) {
        forEach$a(oldFragments, function(frag, key) {
          if (this._getComponentForKey(key)) {
            _markAsDirty(_state, key);
          }
        }.bind(this));
      }
      var nextFragments = nextProps.fragments;
      if (nextFragments) {
        this._deriveFragments(nextFragments);
      }
    };

    // fragments are all dynamic informations that we are displaying
    // like annotations (such as selections)
    this._deriveFragments = function(newFragments) {
      // console.log('deriving fragments', newFragments, this.getId());
      var _state = this._state;
      _state.cursorFragment = null;
      // group fragments by property
      var fragments = {};
      _forEachFragment(newFragments, function(frag, owner) {
        var key = frag.path.toString();
        frag.key = key;
        // skip frags which are not rendered here
        if (!this._getComponentForKey(key)) return;
        // extract the cursor fragment for special treatment (not shown when focused)
        if (frag.type === 'cursor' && owner === 'local-user') {
          _state.cursorFragment = frag;
          return;
        }
        var propertyFrags = fragments[key];
        if (!propertyFrags) {
          propertyFrags = [];
          fragments[key] = propertyFrags;
        }
        propertyFrags.push(frag);
        _markAsDirty(_state, key);
      }.bind(this));
      _state.fragments = fragments;
      // console.log('derived fragments', fragments, window.clientId);
    };

    function _forEachFragment(fragments, fn) {
      forEach$a(fragments, function(frags, owner) {
        frags.forEach(function(frag) {
          fn(frag, owner);
        });
      });
    }

    // called by SurfaceManager to know which text properties need to be
    // updated because of model changes
    this._checkForUpdates = function(change) {
      var _state = this._state;
      Object.keys(change.updated).forEach(function(key) {
        if (this._getComponentForKey(key)) {
          _markAsDirty(_state, key);
        }
      }.bind(this));
      return _state.isDirty;
    };

    this._update = function(oldProps, oldState) {
      this._updateContentEditableState(oldState);
      this._updateProperties();
    };

    this._updateContentEditableState = function(oldState) {
      // ContentEditable management
      // Note: to be able to isolate nodes, we need to control
      // how contenteditable is used in a hieriarchy of surfaces.
      if (oldState.mode === 'co-focused') {
        this.el.off('mousedown', this._enableContentEditable, this);
      }
      if (!this.isEditable()) {
        this.el.setAttribute('contenteditable', false);
      } else if (this.state.mode !== oldState.mode) {
        switch(this.state.mode) {
          case 'co-focused':
            this.el.setAttribute('contenteditable', false);
            this.el.on('mousedown', this._enableContentEditable, this);
            break;
          default:
            this.el.setAttribute('contenteditable', true);
        }
      }
    };

    this._enableContentEditable = function() {
      this.el.setAttribute('contenteditable', true);
    };

    this._updateProperties = function() {
      var _state = this._state;
      var dirtyProperties = Object.keys(_state.dirtyProperties);
      for (var i = 0; i < dirtyProperties.length; i++) {
        this._updateProperty(dirtyProperties[i]);
      }
      _state.isDirty = false;
      _state.dirtyProperties = {};
    };

    function _markAsDirty(_state, key) {
      _state.isDirty = true;
      _state.dirtyProperties[key] = true;
    }

    this._updateProperty = function(key) {
      var _state = this._state;
      // hide the cursor fragment when focused
      var cursorFragment = this._hasNativeFocus() ? null : _state.cursorFragment;
      var frags = _state.fragments[key] || [];
      if (cursorFragment && cursorFragment.key === key) {
        frags = frags.concat([cursorFragment]);
      }
      var comp = this._getComponentForKey(key);
      if (comp) {
        comp.extendProps({
          fragments: frags
        });
      }
    };

    this._onSessionUpdate = function(update) {
      if (update.selection) {
        var newMode = this._deriveModeFromSelection(update.selection);
        if (this.state.mode !== newMode) {
          this.extendState({
            mode: newMode
          });
        }
      }
    };

    // helper to manage surface mode which is derived from the current selection
    this._deriveModeFromSelection = function(sel) {
      var surfaceId = sel.surfaceId;
      var id = this.getId();
      var mode;
      if (startsWith$2(surfaceId, id)) {
        if (surfaceId.length === id.length) {
          mode = 'focused';
        } else {
          mode = 'co-focused';
        }
      }
      return mode;
    };

    // surface parent is either a Surface or IsolatedNode
    this._getSurfaceParent = function() {
      return this.context.surfaceParent;
    };

    this._getComponentForKey = function(key) {
      return this._textProperties[key];
    };

    this._focus = function() {
      this._state.hasNativeFocus = true;
      // HACK: we must not focus explicitly in Chrome/Safari
      // as otherwise we get a crazy auto-scroll
      // Still, this is ok, as everything is working fine
      // there, without that (as opposed to FF/Edge)
      if (this.el && !platform$4.isWebkit) {
        this._state.skipNextFocusEvent = true;
        // ATTENTION: unfortunately, focusing the contenteditable does lead to auto-scrolling
        // in some browsers
        this.el.focus();
        this._state.skipNextFocusEvent = false;
      }
    };

    this._handleLeftOrRightArrowKey = function (event) {
      event.stopPropagation();

      var direction = (event.keyCode === keys$4.LEFT) ? 'left' : 'right';
      var selState = this.getDocumentSession().getSelectionState();
      var sel = selState.getSelection();
      // Note: collapsing the selection and let ContentEditable still continue doing a cursor move
      if (selState.isInlineNodeSelection() && !event.shiftKey) {
        event.preventDefault();
        this.setSelection(sel.collapse(direction));
        return;
      }

      // Note: we need this timeout so that CE updates the DOM selection first
      // before we map it to the model
      window.setTimeout(function() {
        if (!this.isMounted()) return;
        var options = {
          direction: (event.keyCode === keys$4.LEFT) ? 'left' : 'right'
        };
        this._updateModelSelection(options);
      }.bind(this));
    };

    this._handleUpOrDownArrowKey = function (event) {
      event.stopPropagation();
      // Note: we need this timeout so that CE updates the DOM selection first
      // before we map it to the model
      window.setTimeout(function() {
        if (!this.isMounted()) return;
        var options = {
          direction: (event.keyCode === keys$4.UP) ? 'left' : 'right'
        };
        this._updateModelSelection(options);
      }.bind(this));
    };

    this._handleHomeOrEndKey = function (event) {
      event.stopPropagation();
      // Note: we need this timeout so that CE updates the DOM selection first
      // before we map it to the model
      window.setTimeout(function() {
        if (!this.isMounted()) return;
        var options = {
          direction: (event.keyCode === keys$4.HOME) ? 'left' : 'right'
        };
        this._updateModelSelection(options);
      }.bind(this));
    };

    this._handlePageUpOrDownKey = function (event) {
      event.stopPropagation();
      // Note: we need this timeout so that CE updates the DOM selection first
      // before we map it to the model
      window.setTimeout(function() {
        if (!this.isMounted()) return;
        var options = {
          direction: (event.keyCode === keys$4.PAGEUP) ? 'left' : 'right'
        };
        this._updateModelSelection(options);
      }.bind(this));
    };

    this._handleSpaceKey = function(event) {
      event.preventDefault();
      event.stopPropagation();
      this.transaction(function(tx, args) {
        // trying to remove the DOM selection to reduce flickering
        this.domSelection.clear();
        args.text = " ";
        return this.insertText(tx, args);
      }.bind(this), { action: 'type' });
    };

    this._handleEnterKey = function(event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        this.transaction(function(tx, args) {
          return this.softBreak(tx, args);
        }.bind(this), { action: 'break' });
      } else {
        this.transaction(function(tx, args) {
          return this.break(tx, args);
        }.bind(this), { action: 'break' });
      }
    };

    this._handleDeleteKey = function (event) {
      event.preventDefault();
      event.stopPropagation();
      var direction = (event.keyCode === keys$4.BACKSPACE) ? 'left' : 'right';
      this.transaction(function(tx, args) {
        args.direction = direction;
        return this.delete(tx, args);
      }.bind(this), { action: 'delete' });
    };

    this._hasNativeFocus = function() {
      return Boolean(this._state.hasNativeFocus);
    };

    this._setSelection = function(sel) {
      // Since we allow the surface be blurred natively when clicking
      // on tools we now need to make sure that the element is focused natively
      // when we set the selection
      // This is actually only a problem on FF, other browsers set the focus implicitly
      // when a new DOM selection is set.
      // ATTENTION: in FF 44 this was causing troubles, making the CE unselectable
      // until the next native blur.
      // Should not be necessary anymore as this should be covered by this._focus()
      // which will eventually be called at the end of the update flow
      if (!sel.isNull() && sel.surfaceId === this.getId() && platform$4.isFF) {
        this._focus();
      }
      this.documentSession.setSelection(sel);
    };

    this._updateModelSelection = function(options) {
      var sel = this.domSelection.getSelection(options);
      // console.log('Surface: updating model selection', sel.toString());
      // NOTE: this will also lead to a rerendering of the selection
      // via session.on('update')
      this.setSelection(sel);
    };

    this._selectProperty = function(path) {
      var doc = this.getDocument();
      var text = doc.get(path);
      this.setSelection(doc.createSelection(path, 0, text.length));
    };

    // internal API for TextProperties to enable dispatching
    // TextProperty components are registered via path
    this._registerTextProperty = function(textPropertyComponent) {
      var path = textPropertyComponent.getPath();
      this._textProperties[path] = textPropertyComponent;
    };

    this._unregisterTextProperty = function(textPropertyComponent) {
      var path = textPropertyComponent.getPath();
      if (this._textProperties[path] === textPropertyComponent) {
        delete this._textProperties[path];
      }
    };

    this._getTextPropertyComponent = function(path) {
      return this._textProperties[path];
    };

    // TODO: we could integrate container node rendering into this helper
    // TODO: this helper should be available also in non surface context
    this._renderNode = function($$, nodeId) {
      var doc = this.getDocument();
      var node = doc.get(nodeId);
      var componentRegistry = this.context.componentRegistry || this.props.componentRegistry;
      var ComponentClass = componentRegistry.get(node.type);
      if (!ComponentClass) {
        console.error('Could not resolve a component for type: ' + node.type);
        ComponentClass = UnsupportedNode$1;
      }
      return $$(ComponentClass, {
        doc: doc,
        node: node
      });
    };

    /*
      Called when starting a transaction to populate the transaction
      arguments.
      ATM used only by ContainerEditor.
    */
    this._prepareArgs = function(args) { // eslint-disable-line
    };

    this.setSelectionFromEvent = function(evt) {
      if (this.domSelection) {
        this._state.skipNextFocusEvent = true;
        var domRange = Surface$1.getDOMRangeFromEvent(evt);
        var range = this.domSelection.getSelectionFromDOMRange(domRange);
        var sel = this.getDocument().createSelection(range);
        this.setSelection(sel);
      }
    };

    // EXPERIMENTAL: get bounding box for current selection
    this.getBoundingRectangleForSelection = function() {
      var sel = this.getSelection();
      if (this.isDisabled() ||
          !sel || sel.isNull() ||
          sel.isNodeSelection() || sel.isCustomSelection()) return {};

      // TODO: selection rectangle should be calculated
      // relative to scrolling container, which either is
      // the parent scrollPane, or the body element
      var containerEl;
      if (this.context.scrollPane) {
        containerEl = this.context.scrollPane.refs.content.el.el;
      } else {
        containerEl = document.body;
      }

      var wsel = window.getSelection();
      var wrange;
      if (wsel.rangeCount > 0) {
        wrange = wsel.getRangeAt(0);
      }

      // having a DOM selection?
      if (wrange && wrange.collapsed) {
        // unfortunately, collapsed selections do not have a boundary rectangle
        // thus we need to insert a span temporarily and take its rectangle
        // if (wrange.collapsed) {
        var span = document.createElement('span');
        // Ensure span has dimensions and position by
        // adding a zero-width space character
        this._state.skipNextObservation = true;
        span.appendChild(window.document.createTextNode("\u200b"));
        wrange.insertNode(span);
        var rect = getRelativeBoundingRect$2(span, containerEl);
        var spanParent = span.parentNode;
        this._state.skipNextObservation = true;
        spanParent.removeChild(span);
        // Glue any broken text nodes back together
        spanParent.normalize();
        // HACK: in FF the DOM selection gets corrupted
        // by the span-insertion above
        if (platform$4.isFF) {
          this.rerenderDOMSelection();
        }
        return rect;
      } else {
        var nativeEl = this.el.el;
        if (sel.isCollapsed()) {
          var cursorEl = nativeEl.querySelector('.se-cursor');
          if (cursorEl) {
            return getRelativeBoundingRect$2(cursorEl, containerEl);
          } else {
            // TODO: in the most cases we actually do not have a
            // cursor element.
            // console.warn('FIXME: there should be a rendered cursor element.');
            return {};
          }
        } else {
          var selFragments = nativeEl.querySelectorAll('.se-selection-fragment');
          if (selFragments.length > 0) {
            return getRelativeBoundingRect$2(selFragments, containerEl);
          } else {
            console.warn('FIXME: there should be a rendered selection fragments element.');
            return {};
          }
        }
      }
    };

    this._sendOverlayHints = function() {
      // TODO: we need to rethink this.
      // The overlay is owned by the ScrollPane.
      // So the current solution is to send up hints
      // which are dispatched to the overlay instance.
      var selectionRect = this.getBoundingRectangleForSelection();
      this.send('updateOverlayHints', {
        rectangle: selectionRect
      });
    };

  };

  Component$r.extend(Surface$1);

  Surface$1.getDOMRangeFromEvent = function(evt) {
    var range, x = evt.clientX, y = evt.clientY;

    // Try the simple IE way first
    if (document.body.createTextRange) {
      range = document.body.createTextRange();
      range.moveToPoint(x, y);
    }

    else if (!isUndefined(document.createRange)) {
      // Try Mozilla's rangeOffset and rangeParent properties,
      // which are exactly what we want
      if (!isUndefined(evt.rangeParent)) {
        range = document.createRange();
        range.setStart(evt.rangeParent, evt.rangeOffset);
        range.collapse(true);
      }

      // Try the standards-based way next
      else if (document.caretPositionFromPoint) {
        var pos = document.caretPositionFromPoint(x, y);
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }

      // Next, the WebKit way
      else if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(x, y);
      }
    }

    return range;
  };

  module.exports = Surface$1;

  var forEach$b = require('lodash/forEach');
  var clone$5 = require('lodash/clone');
  var oo$F = require('../util/oo');
  var inBrowser$5 = require('../util/inBrowser');

  function SurfaceManager$1(documentSession) {
    this.documentSession = documentSession;

    this.surfaces = {};

    this._state = {
      focusedSurfaceId: null,
      // grouped by surfaceId and the by fragment type ('selection' | collaboratorId)
      fragments: {},
      selection: null,
      collaborators: {},
    };

    this.documentSession.on('update', this.onSessionUpdate, this);
    // HACK: trying to make rerendering the DOM selection the very last
    // TODO: we want to introduce a FlowManager, which will hopefully
    // make this prio hack obsolete
    this.documentSession.on('didUpdate', this.onSessionDidUpdate, this, {
      priority: -1000000
    });
  }

  SurfaceManager$1.Prototype = function() {

    this.dispose = function() {
      this.documentSession.off(this);
    };

    /**
     * Get Surface instance
     *
     * @param {String} name Name under which the surface is registered
     * @return {ui/Surface} The surface instance
     */
    this.getSurface = function(name) {
      if (name) {
        return this.surfaces[name];
      }
    };

    /**
     * Get the currently focused Surface.
     *
     * @return {ui/Surface} Surface instance
     */
    this.getFocusedSurface = function() {
      if (this._state.focusedSurfaceId) {
        return this.getSurface(this._state.focusedSurfaceId);
      }
    };

    /**
     * Register a surface
     *
     * @param surface {ui/Surface} A new surface instance to register
     */
    this.registerSurface = function(surface) {
      this.surfaces[surface.getId()] = surface;
    };

    /**
     * Unregister a surface
     *
     * @param surface {ui/Surface} A surface instance to unregister
     */
    this.unregisterSurface = function(surface) {
      surface.off(this);
      var surfaceId = surface.getId();
      var registeredSurface = this.surfaces[surfaceId];
      if (registeredSurface === surface) {
        var focusedSurface = this.getFocusedSurface();
        delete this.surfaces[surfaceId];
        if (surface && focusedSurface === surface) {
          this._state.focusedSurfaceId = null;
        }
      }
    };

    // keeps track of selection fragments and collaborator fragments
    this.onSessionUpdate = function(update) {
      var _state = this._state;

      var updatedSurfaces = {};
      if (update.selection) {
        var focusedSurface = this.surfaces[update.selection.surfaceId];
        _state.focusedSurfaceId = update.selection.surfaceId;
        if (focusedSurface && !focusedSurface.isDisabled()) {
          focusedSurface._focus();
        } else if (update.selection.isCustomSelection() && inBrowser$5) {
          // HACK: removing DOM selection *and* blurring when having a CustomSelection
          // otherwise we will receive events on the wrong surface
          // instead of bubbling up to GlobalEventManager
          window.getSelection().removeAllRanges();
          window.document.activeElement.blur();
        }
      }

      if (update.change) {
        forEach$b(this.surfaces, function(surface, surfaceId) {
          if (surface._checkForUpdates(update.change)) {
            updatedSurfaces[surfaceId] = true;
          }
        });
      }

      var fragments = _state.fragments || {};

      // get fragments for surface with id or create a new hash
      function _fragmentsForSurface(surfaceId) {
        // surfaceFrags is a hash, where fragments are stored grouped by owner
        var surfaceFrags = fragments[surfaceId];
        if (!surfaceFrags) {
          surfaceFrags = {};
          fragments[surfaceId] = surfaceFrags;
        }
        return surfaceFrags;
      }

      // gets selection fragments with collaborator attached to each fragment
      // as used by TextPropertyComponent
      function _getFragmentsForSelection(sel, collaborator) {
        var frags = sel.getFragments();
        if (collaborator) {
          frags = frags.map(function(frag) {
            frag.collaborator = collaborator;
            return frag;
          });
        }
        return frags;
      }

      function _updateSelectionFragments(oldSel, newSel, collaborator) {
        // console.log('SurfaceManager: updating selection fragments', oldSel, newSel, collaborator);
        var oldSurfaceId = oldSel ? oldSel.surfaceId : null;
        var newSurfaceId = newSel ? newSel.surfaceId : null;
        var owner = 'local-user';
        if (collaborator) {
          owner = collaborator.collaboratorId;
        }
        // clear old fragments
        if (oldSurfaceId && oldSurfaceId !== newSurfaceId) {
          _fragmentsForSurface(oldSurfaceId)[owner] = [];
          updatedSurfaces[oldSurfaceId] = true;
        }
        if (newSurfaceId) {
          _fragmentsForSurface(newSurfaceId)[owner] = _getFragmentsForSelection(newSel, collaborator);
          updatedSurfaces[newSurfaceId] = true;
        }
      }

      if (update.selection) {
        _updateSelectionFragments(_state.selection, update.selection);
        _state.selection = update.selection;
      }

      if (update.collaborators) {
        forEach$b(update.collaborators, function(collaborator, collaboratorId) {
          var oldCollaborator = _state.collaborators[collaboratorId];
          var oldSel, newSel;
          if (oldCollaborator){
            oldSel = oldCollaborator.selection;
          }
          if (collaborator){
            newSel = collaborator.selection;
          }
          if (!oldSel || !oldSel.equals(newSel)) {
            _updateSelectionFragments(oldSel, newSel, collaborator);
          }
          _state.collaborators[collaboratorId] = {
            collaboratorId: collaboratorId,
            selection: newSel
          };
        });
      }

      updatedSurfaces = Object.keys(updatedSurfaces);
      // console.log('SurfaceManager: updating surfaces', updatedSurfaces);

      updatedSurfaces.forEach(function(surfaceId) {
        var surface = this.surfaces[surfaceId];
        if (surface) {
          var newFragments = fragments[surfaceId];
          // console.log('SurfaceManager: providing surface %s with new fragments', surfaceId, newFragments);
          surface.extendProps({
            fragments: clone$5(newFragments)
          });
        }
      }.bind(this));
    };

    this.onSessionDidUpdate = function(update, info) {
      if (info.skipSelection) return;
      // at the end of the update flow, make sure the surface is focused
      // and displays the right DOM selection.
      var focusedSurface = this.getFocusedSurface();
      if (focusedSurface && !focusedSurface.isDisabled()) {
        focusedSurface.focus();
        // console.log('rerenderingDOMSelection', this.documentSession.getSelection().toString());
        focusedSurface.rerenderDOMSelection();
        focusedSurface._sendOverlayHints();
      }
    };

  };

  oo$F.initClass(SurfaceManager$1);

  module.exports = SurfaceManager$1;

  var Component$s = require('./Component');
  var each$p = require('lodash/each');

  /**
    A tabbed pane layout component. The actual content is specified via append.

    @class TabbedPane
    @component

    @prop {Object[]} tabs an array of objects with id and name properties
    @prop {String} activeTab id of currently active tab

    @example

    ```js
    $$(TabbedPane, {
      tabs: [
        {id: 'tabA', 'A'},
        {id: 'tabB', 'B'},
      ],
      activeTab: 'tabA'
    }).ref('tabbedPane').append(
      tabAContent
    )
    ```
  */

  function TabbedPane() {
    Component$s.apply(this, arguments);
  }

  TabbedPane.Prototype = function() {

    this.render = function($$) {
      var el = $$('div').addClass('sc-tabbed-pane');
      var tabsEl = $$('div').addClass('se-tabs');
      each$p(this.props.tabs, function(tab) {
        var tabEl = $$('a')
          .addClass("se-tab")
          .attr({
            href: "#",
            "data-id": tab.id,
          })
          .on('click', this.onTabClicked);
        if (tab.id === this.props.activeTab) {
          tabEl.addClass("sm-active");
        }
        tabEl.append(
          $$('span').addClass('label').append(tab.name)
        );
        tabsEl.append(tabEl);
      }.bind(this));

      el.append(tabsEl);
      // Active content
      el.append(
        $$('div').addClass('se-tab-content').ref('tabContent').append(
          this.props.children
        )
      );
      return el;
    };

    this.onTabClicked = function(e) {
      e.preventDefault();
      var tabId = e.currentTarget.dataset.id;
      this.send('switchTab', tabId);
    };
  };

  Component$s.extend(TabbedPane);

  module.exports = TabbedPane;

  var BlockNodeComponent$3 = require('./BlockNodeComponent');
  var TextProperty$1 = require('./TextPropertyComponent');

  function TextBlockComponent$4() {
    TextBlockComponent$4.super.apply(this, arguments);
  }

  TextBlockComponent$4.Prototype = function() {

    var _super = TextBlockComponent$4.super.prototype;

    this.render = function($$) {
      var el = _super.render.call(this, $$);
      el.append($$(TextProperty$1, {
        path: [ this.props.node.id, "content"]
      }));
      return el;
    };

  };

  BlockNodeComponent$3.extend(TextBlockComponent$4);

  module.exports = TextBlockComponent$4;

  var Surface$2 = require('./Surface');
  var TextPropertyManager = require('../model/TextPropertyManager');
  var TextProperty$2 = require('./TextPropertyComponent');

  /**
    Annotator for a text property. Needs to be instantiated inside a {@link ui/Controller}
    context. Works like a TextPropertyEditor but you can only annotate, not edit.

    @class
    @component
    @extends ui/Surface

    @prop {String} name unique surface name
    @prop {String[]} path path to a text property
    @prop {ui/Command[]} commands array of command classes to be available

    @example

    ```js
    $$(TextPropertyAnnotator, {
      name: 'abstract',
      path: ['metadata', 'abstract'],
      commands: [EmphasisCommand]
    })
    ```
  */

  function TextPropertyAnnotator() {
    Surface$2.apply(this, arguments);
    var doc = this.getDocument();
    this.textPropertyManager = new TextPropertyManager(doc);
  }

  TextPropertyAnnotator.Prototype = function() {

    this.render = function($$) {
      var el = $$(this.props.tagName || 'div')
        .addClass("sc-text-property-annotator")
        .append(
          $$(TextProperty$2, {
            tagName: "div",
            path: this.props.path
          })
        );
      return el;
    };

    this.isContainerEditor = function() {
      return false;
    };

  };

  Surface$2.extend(TextPropertyAnnotator);

  module.exports = TextPropertyAnnotator;

  var isNumber$d = require('lodash/isNumber');
  var Coordinate$a = require('../model/Coordinate');
  var AnnotatedTextComponent$1 = require('./AnnotatedTextComponent');

  /**
    Renders a text property. Used internally by different components to render editable text.

    @class
    @component
    @extends ui/AnnotatedTextComponent

    @prop {String[]} path path to a text property
    @prop {String} [tagName] specifies which tag should be used - defaults to `div`

    @example

    ```js
    $$(TextProperty, {
      path: [ 'paragraph-1', 'content']
    })
    ```
  */

  function TextPropertyComponent$1() {
    TextPropertyComponent$1.super.apply(this, arguments);
  }

  TextPropertyComponent$1.Prototype = function() {

    var _super = TextPropertyComponent$1.super.prototype;

    this.didMount = function() {
      _super.didMount.call(this);
      var surface = this.getSurface();
      if (surface) {
        surface._registerTextProperty(this);
      }
    };

    this.dispose = function() {
      _super.dispose.call(this);
      var surface = this.getSurface();
      if (surface) {
        surface._unregisterTextProperty(this);
      }
    };

    this.render = function($$) {
      var path = this.getPath();

      var el = this._renderContent($$)
        .addClass('sc-text-property')
        .attr({
          'data-path': path.join('.'),
          spellCheck: false,
        })
        .css({
          'white-space': 'pre-wrap'
        });

      if (this.props.editable) {
        el.attr('contentEditable', true);
      }

      el.append($$('br'));
      return el;
    };

    this._renderFragment = function($$, fragment) {
      var node = fragment.node;
      var id = node.id;
      var el;
      if (node.type === 'cursor' || node.type === 'selection-fragment') {
        el = $$('span').addClass('se-'+node.type);

        if (node.type === 'cursor') {
          // Add zero-width character. Since we have a non-empty element, the
          // outline style set on the cursor would not be visible in certain
          // scenarios (e.g. when cursor is at the very beginning of a text.
          el.append("\uFEFF");
          el.append($$('div').addClass('se-cursor-inner'));
        }

        if (node.collaborator) {
          var collaboratorIndex = node.collaborator.colorIndex;
          el.addClass('sm-collaborator-'+collaboratorIndex);
        } else {
          el.addClass('sm-local-user');
        }
      } else {
        el = _super._renderFragment.apply(this, arguments);
        if (node.constructor.static.isInline) {
          // FIXME: enabling this reveals a bug in RenderEngine with reusing a component but reattached to a new parent.
          el.ref(id);
        }
        // Adding refs here, enables preservative rerendering
        // TODO: while this solves problems with rerendering inline nodes
        // with external content, it decreases the overall performance too much.
        // We should optimize the component first before we can enable this.
        else if (this.context.config && this.context.config.preservativeTextPropertyRendering) {
          el.ref(id + '@' + fragment.counter);
        }
      }
      el.attr('data-offset', fragment.pos);
      return el;
    };

    this.getPath = function() {
      return this.props.path;
    };

    this.getText = function() {
      return this.getDocument().get(this.getPath());
    };

    this.getAnnotations = function() {
      var path = this.getPath();
      var annotations = this.getDocument().getIndex('annotations').get(path);
      var fragments = this.props.fragments;
      if (fragments) {
        annotations = annotations.concat(fragments);
      }
      return annotations;
    };

    this.setFragments = function() {
      this.children[0].extendProps({ annotations: this.getAnnotations() });
    };

    this.getDocument = function() {
      return this.props.doc ||this.context.doc;
    };

    this.getController = function() {
      return this.props.controller || this.context.controller;
    };

    this.getSurface = function() {
      return this.props.surface ||this.context.surface;
    };

    this.isEditable = function() {
      return this.getSurface().isEditable();
    };

    this.isReadonly = function() {
      return this.getSurface().isReadonly();
    };

    this.getDOMCoordinate = function(charPos) {
      return this._getDOMCoordinate(this.el, charPos);
    };

    this._finishFragment = function(fragment, context, parentContext) {
      context.attr('data-length', fragment.length);
      parentContext.append(context);
    };

    this._getDOMCoordinate = function(el, charPos) {
      var l;
      var idx = 0;
      if (charPos === 0) {
        return {
          container: el.getNativeElement(),
          offset: 0
        };
      }
      for (var child = el.getFirstChild(); child; child=child.getNextSibling(), idx++) {
        if (child.isTextNode()) {
          l = child.textContent.length;
          if (l >= charPos) {
            return {
              container: child.getNativeElement(),
              offset: charPos
            };
          } else {
            charPos -= l;
          }
        } else if (child.isElementNode()) {
          var length = child.getAttribute('data-length');
          if (length) {
            l = parseInt(length, 10);
            if (l>= charPos) {
              // special handling for InlineNodes
              if (child.attr('data-inline')) {
                var nextSibling = child.getNextSibling();
                if (nextSibling && nextSibling.isTextNode()) {
                  return {
                    container: nextSibling.getNativeElement(),
                    offset: 0
                  };
                } else {
                  return {
                    container: el.getNativeElement(),
                    offset: el.getChildIndex(child) + 1
                  };
                }
              }
              return this._getDOMCoordinate(child, charPos, idx);
            } else {
              charPos -= l;
            }
          } else {
            console.error('FIXME: Can not map to DOM coordinates.');
            return null;
          }
        }
      }
    };
  };

  AnnotatedTextComponent$1.extend(TextPropertyComponent$1);

  // Helpers for DOM selection mapping

  TextPropertyComponent$1.getCoordinate = function(root, node, offset) {
    var context = _getPropertyContext(root, node, offset);
    if (!context) {
      return null;
    }
    // in some cases we need to normalize the DOM coordinate
    // before we can use it for retrieving charPos
    // E.g. observed with #273
    node = context.node;
    offset = context.offset;
    var charPos = _getCharPos(context.node, context.offset);
    if (isNumber$d(charPos)) {
      return new Coordinate$a(context.path, charPos);
    }
    return null;
  };

  function _getPropertyContext(root, node, offset) {
    var result = {
      el: null,
      path: null,
      node: node,
      offset: offset
    };
    while (node && node !== root) {
      if (node.isElementNode()) {
        var path = node.getAttribute('data-path');
        if (path) {
          result.el = node;
          result.path = path.split('.');
          return result;
        }
        if (node.getAttribute('data-inline')) {
          // we need to normalize situations where the DOM coordinate
          // is inside an inline node, which we have observed
          // can actually happen.
          result.node = node;
          if (offset > 0) {
            result.offset = 1;
          }
        }
      }
      node = node.getParent();
    }
    return null;
  }

  function _getCharPos(node, offset) {
    var charPos = offset;
    var parent, childIdx;

    /*
      In the following implementation we are exploiting two facts
      for optimization:
      - an element with data-path is assumed to be the text property element
      - an element with data-offset is assumed to be an annotation element

      Particularly, the data-offset property is helpful to get the character position
      in just one iteration.
    */

    parent = node.getParent();
    if (node.isTextNode()) {
      // TextNode is first child
      if (node === parent.firstChild) {
        // ... we can stop if parent is text property
        var parentPath = parent.getAttribute('data-path');
        var parentOffset = parent.getAttribute('data-offset');
        if (parentPath) {
          charPos = offset;
        }
        // ... and we can stop if parent has an offset hint
        else if (parentOffset) {
          charPos = parseInt(parentOffset, 10) + offset;
        }
        // ... otherwise we count the charPos by recursing up-tree
        else {
          charPos = _getCharPos(parent, 0) + offset;
        }
      } else {
        // the node has a predecessor so we can apply recurse using the child index
        childIdx = parent.getChildIndex(node);
        charPos = _getCharPos(parent, childIdx) + offset;
      }
    } else if (node.isElementNode()) {
      var pathStr = node.getAttribute('data-path');
      var offsetStr = node.getAttribute('data-offset');
      // if node is the element of a text property, then offset is a child index
      // up to which we need to sum up all lengths
      if (pathStr) {
        charPos = _countCharacters(node, offset);
      }
      // similar if node is the element of an annotation, and we can use the
      // element's offset
      else if (offsetStr) {
        childIdx = parent.getChildIndex(node);
        charPos = parseInt(offsetStr, 10) + _countCharacters(node, offset);
      }
      // for other elements we need to count characters in the child tree
      // adding the offset of this element which needs to be computed by recursing up-tree
      else {
        childIdx = parent.getChildIndex(node);
        charPos = _getCharPos(parent, childIdx) + _countCharacters(node, offset);
      }
    } else {
      // Unsupported case
      return null;
    }
    return charPos;
  }

  function _countCharacters(el, maxIdx) {
    var charPos = 0;
    // inline elements have a length of 1
    if (el.getAttribute('data-inline')) {
      return maxIdx === 0 ? 0 : 1;
    }
    var l = el.getChildCount();
    if (arguments.length === 1) {
      maxIdx = l;
    }
    maxIdx = Math.min(l, maxIdx);
    for (var i=0, child = el.getFirstChild(); i < maxIdx; child = child.getNextSibling(), i++) {
      if (child.isTextNode()) {
        charPos += child.getTextContent().length;
      } else if (child.isElementNode()) {
        var length = child.getAttribute('data-length');
        if (child.getAttribute('data-inline')) {
          charPos += 1;
        } else if (length) {
          charPos += parseInt(length, 10);
        } else {
          charPos += _countCharacters(child);
        }
      }
    }
    return charPos;
  }

  module.exports = TextPropertyComponent$1;

  var Surface$3 = require('./Surface');
  var TextProperty$3 = require('./TextPropertyComponent');

  /**
    Editor for a text property (annotated string). Needs to be
    instantiated inside a {@link ui/Controller} context.

    @class
    @component
    @extends ui/Surface

    @prop {String} name unique editor name
    @prop {String[]} path path to a text property
    @prop {ui/SurfaceCommand[]} commands array of command classes to be available

    @example

    Create a `TextPropertyEditor` for the `name` property of an author object. Allow emphasis annotations.

    ```js
    $$(TextPropertyEditor, {
      name: 'authorNameEditor',
      path: ['author_1', 'name'],
      commands: [EmphasisCommand]
    })
    ```
  */

  function TextPropertyEditor$1(parent, props) {
    // making props.name optional
    props.name = props.name || props.path.join('.');
    Surface$3.apply(this, arguments);

    if (!props.path) {
      throw new Error("Property 'path' is mandatory.");
    }
  }

  TextPropertyEditor$1.Prototype = function() {

    var _super = TextPropertyEditor$1.super.prototype;

    this.render = function($$) {
      var el = _super.render.apply(this, arguments);
      el.addClass("sc-text-property-editor");

      if (!this.props.disabled) {
        el.addClass('sm-enabled');
        el.setAttribute('contenteditable', true);
      }

      el.append(
        $$(TextProperty$3, {
          tagName: "div",
          path: this.props.path
        })
      );
      return el;
    };

    /**
      Selects all text
    */
    this.selectAll = function() {
      var doc = this.getDocument();
      var path = this.props.path;
      var text = doc.get(path);
      var sel = doc.createSelection({
        type: 'property',
        path: path,
        startOffset: 0,
        endOffset: text.length
      });
      this.setSelection(sel);
    };

  };

  Surface$3.extend(TextPropertyEditor$1);

  module.exports = TextPropertyEditor$1;

  var Component$t = require('./Component');
  var ScrollPane$2 = require('./ScrollPane');
  var Icon$1 = require('./FontAwesomeIcon');

  function TOC() {
    Component$t.apply(this, arguments);
  }

  TOC.Prototype = function() {

    this.didMount = function() {
      var tocProvider = this.context.tocProvider;
      tocProvider.on('toc:updated', this.onTOCUpdated, this);
    };

    this.dispose = function() {
      var tocProvider = this.context.tocProvider;
      tocProvider.off(this);
    };

    this.render = function($$) {
      var tocProvider = this.context.tocProvider;
      var activeEntry = tocProvider.activeEntry;

      var tocEntries = $$("div")
        .addClass("se-toc-entries")
        .ref('tocEntries');

      var entries = tocProvider.getEntries();
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        var level = entry.level;

        var tocEntryEl = $$('a')
          .addClass('se-toc-entry')
          .addClass('sm-level-'+level)
          .attr({
            href: "#",
            "data-id": entry.id,
          })
          .ref(entry.id)
          .on('click', this.handleClick)
          .append(
            $$(Icon$1, {icon: 'fa-caret-right'}),
            entry.name
          );
        if (activeEntry === entry.id) {
          tocEntryEl.addClass("sm-active");
        }
        tocEntries.append(tocEntryEl);
      }

      var el = $$('div').addClass('sc-toc-panel').append(
        $$(ScrollPane$2).ref('panelEl').append(
          tocEntries
        )
      );
      return el;
    };

    this.getDocument = function() {
      return this.context.doc;
    };

    this.onTOCUpdated = function() {
      this.rerender();
    };

    this.handleClick = function(e) {
      var nodeId = e.currentTarget.dataset.id;
      e.preventDefault();
      this.send('tocEntrySelected', nodeId);
    };
  };

  Component$t.extend(TOC);

  module.exports = TOC;

  var each$q = require('lodash/each');
  var includes = require('lodash/includes');
  var EventEmitter$e = require('../util/EventEmitter');

  /**
    Manages a table of content for a container. Default implementation considers
    all headings as TOC entries. You can extend this implementation and override
    `computeEntries`. Instantiate this class on controller level and pass it to relevant components
    (such as {@link ui/TOCPanel} and {@link ui/ScrollPane}).

    @class TOCProvider
    @component

    @prop {Controller}
   */

  function TOCProvider(document, config) {
    EventEmitter$e.apply(this, arguments);
    this.document = document;
    this.config = config;

    this.entries = this.computeEntries();
    if (this.entries.length > 0) {
      this.activeEntry = this.entries[0].id;
    } else {
      this.activeEntry = null;
    }

    this.document.on('document:changed', this.handleDocumentChange, this);
  }

  TOCProvider.Prototype = function() {

    this.dispose = function() {
      var doc = this.getDocument();
      doc.disconnect(this);
    };

    // Inspects a document change and recomputes the
    // entries if necessary
    this.handleDocumentChange = function(change) {
      var doc = this.getDocument();
      var needsUpdate = false;
      var tocTypes = this.constructor.static.tocTypes;

      // HACK: this is not totally correct but works.
      // Actually, the TOC should be updated if tocType nodes
      // get inserted or removed from the container, plus any property changes
      // This implementation just checks for changes of the node type
      // not the container, but as we usually create and show in
      // a single transaction this works.
      for (var i = 0; i < change.ops.length; i++) {
        var op = change.ops[i];
        var nodeType;
        if (op.isCreate() || op.isDelete()) {
          var nodeData = op.getValue();
          nodeType = nodeData.type;
          if (includes(tocTypes, nodeType)) {
            needsUpdate = true;
            break;
          }
        } else {
          var id = op.path[0];
          var node = doc.get(id);
          if (node && includes(tocTypes, node.type)) {
            needsUpdate = true;
            break;
          }
        }
      }
      if (needsUpdate) {
        this.entries = this.computeEntries();
        this.emit('toc:updated');
      }
    };

    this.computeEntries = function() {
      var doc = this.getDocument();
      var config = this.config;
      var entries = [];
      var contentNodes = doc.get(config.containerId).nodes;
      each$q(contentNodes, function(nodeId) {
        var node = doc.get(nodeId);
        if (node.type === 'heading') {
          entries.push({
            id: node.id,
            name: node.content,
            level: node.level,
            node: node
          });
        }
      });
      return entries;
    };

    this.getEntries = function() {
      return this.entries;
    };

    this.getDocument = function() {
      return this.document;
    };

    this.markActiveEntry = function(scrollPane) {
      var panelContent = scrollPane.getContentElement();
      var contentHeight = scrollPane.getContentHeight();
      var scrollPaneHeight = scrollPane.getHeight();
      var scrollPos = scrollPane.getScrollPosition();

      var scrollBottom = scrollPos + scrollPaneHeight;
      var regularScanline = scrollPos;
      var smartScanline = 2 * scrollBottom - contentHeight;
      var scanline = Math.max(regularScanline, smartScanline);

      // For debugging purposes
      // TODO: FIXME this code does not make sense anymore.
      //       The scanline should be part of the scrolled content not the scrollbar
      // To activate remove display:none for .scanline in the CSS
      // $('.se-scanline').css({
      //   top: (scanline - scrollTop)+'px'
      // });

      var tocNodes = this.computeEntries();
      if (tocNodes.length === 0) return;

      // Use first toc node as default
      var activeEntry = tocNodes[0].id;
      for (var i = tocNodes.length - 1; i >= 0; i--) {
        var tocNode = tocNodes[i];
        var nodeEl = panelContent.find('[data-id="'+tocNode.id+'"]');
        if (!nodeEl) {
          console.warn('Not found in Content panel', tocNode.id);
          return;
        }
        var panelOffset = scrollPane.getPanelOffsetForElement(nodeEl);
        if (scanline >= panelOffset) {
          activeEntry = tocNode.id;
          break;
        }
      }

      if (this.activeEntry !== activeEntry) {
        this.activeEntry = activeEntry;
        this.emit('toc:updated');
      }
    };
  };

  EventEmitter$e.extend(TOCProvider);

  TOCProvider.static.tocTypes = ['heading'];

  module.exports = TOCProvider;

  var capitalize = require('lodash/capitalize');
  var extend$o = require('lodash/extend');
  var Component$u = require('./Component');

  /**
    Default Tool implementation

    A tool must be associated with a Command, which holds all the logic, while the tool
    is just the visual representation of the command state.

    @class
    @component
  */
  function Tool$7() {
    Tool$7.super.apply(this, arguments);
  }

  Tool$7.Prototype = function() {

    /**
      Default tool rendering. You can override this method to provide your custom markup
    */
    this.render = function($$) {
      var el = $$('div')
        .addClass('se-tool');

      var customClassNames = this.getClassNames();
      if (customClassNames) {
        el.addClass(customClassNames);
      }

      var title = this.getTitle();
      if (title) {
        el.attr('title', title);
        el.attr('aria-label', title);
      }
      //.sm-disabled
      if (this.props.disabled) {
        el.addClass('sm-disabled');
      }
      // .sm-active
      if (this.props.active) {
        el.addClass('sm-active');
      }

      // button
      el.append(this.renderButton($$));
      return el;
    };

    this.getClassNames = function() {
      return '';
    };

    this.renderButton = function($$) {
      var button = $$('button')
        .on('click', this.onClick)
        .append(this.renderIcon($$));

      if (this.props.disabled) {
        // make button inaccessible
        button.attr('tabindex', -1).attr('disabled', true);
      } else {
        // make button accessible for tab-navigation
        button.attr('tabindex', 1);
      }
      return button;
    };

    this.renderIcon = function($$) {
      var commandName = this.getCommandName();
      var iconEl = this.context.iconProvider.renderIcon($$, commandName);
      return iconEl;
    };

    this.getTitle = function() {
      var labelProvider = this.context.labelProvider;
      var title = this.props.title || labelProvider.getLabel(this.getName());
      // Used only by annotation tool so far
      if (this.props.mode) {
        title = [capitalize(this.props.mode), title].join(' ');
      }
      return title;
    };

    /**
      Get tool registration name
    */
    this.getName = function() {
      return this.constructor.static.name;
    };

    this.getCommandName = function() {
      return this.constructor.static.command || this.constructor.static.name;
    };

    this.onClick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (!this.props.disabled) this.performAction();
    };

    /**
      Executes the associated command
    */
    this.performAction = function(props) {
      this.context.commandManager.executeCommand(this.getCommandName(), extend$o({
        mode: this.props.mode
      }, props));
    };
  };

  Component$u.extend(Tool$7);

  module.exports = Tool$7;

  var Component$v = require('./Component');

  /**
    @class ToolGroup
    @component

    @prop {ui/VirtualDOMElement} name unique editor name

    @example

    ```js
    $$(ToolGroup).append(
      $$(StrongTool)
    )
    ```
  */
  function ToolGroup$1() {
    Component$v.apply(this, arguments);
  }

  ToolGroup$1.Prototype = function() {
    this.render = function($$) {
      var el = $$('div').addClass('sc-tool-group');
      el.append(this.props.children);
      return el;
    };
  };

  Component$v.extend(ToolGroup$1);

  module.exports = ToolGroup$1;

  var Component$w = require('./Component');

  function UnsupportedNodeComponent() {
    Component$w.apply(this, arguments);
  }

  UnsupportedNodeComponent.Prototype = function() {

    this.render = function($$) {
      return $$('pre')
        .addClass('content-node unsupported')
        .attr({
          'data-id': this.props.node.id,
          contentEditable: false
        })
        .append(
          JSON.stringify(this.props.node.properties, null, 2)
        );
    };
  };

  Component$w.extend(UnsupportedNodeComponent);

  module.exports = UnsupportedNodeComponent;

  var isFunction$3 = require('lodash/isFunction');
  var isString$l = require('lodash/isString');
  var isArray$e = require('lodash/isArray');
  var map$5 = require('lodash/map');
  var clone$6 = require('lodash/clone');
  var extend$p = require('lodash/extend');
  var omit = require('lodash/omit');
  var without$1 = require('lodash/without');
  var DOMElement$5 = require('./DOMElement');

  /**
    A virtual {@link ui/DOMElement} which is used by the {@link ui/Component} API.

    A VirtualElement is just a description of a DOM structure. It represents a virtual
    DOM mixed with Components. This virtual structure needs to be compiled to a {@link ui/Component}
    to actually create a real DOM element.

    @class
  */
  function VirtualElement$2(owner) {
    // set when this gets inserted into another virtual element
    this.parent = null;
    // set when created by RenderingContext
    this._owner = owner;
    // set when ref'd
    this._ref = null;
  }

  VirtualElement$2.Prototype = function() {

    /*
      For instance of like checks.
    */
    this._isVirtualElement = true;

    this.getParent = function() {
      return this.parent;
    };

    /**
      Associates a reference identifier with this element.

      When rendered the corresponding component is stored in the owner using the given key.
      In addition to that, components with a reference are preserved when its parent is rerendered.

      @param {String} ref id for the compiled Component
    */
    this.ref = function(ref) {
      if (!ref) {
        throw new Error('Illegal argument');
      }
      this._ref = ref;
      if (this._context) {
        this._context.refs[ref] = this;
      }
      return this;
    };

  };

  DOMElement$5.extend(VirtualElement$2);

  DOMElement$5._defineProperties(VirtualElement$2, without$1(DOMElement$5._propertyNames, 'children'));

  /*
    A virtual HTML element.

    @private
    @class VirtualElement.VirtualHTMLElement
    @extends ui/VirtualElement
  */
  function VirtualHTMLElement(tagName) {
    VirtualHTMLElement.super.call(this);

    this._tagName = tagName;
    this.classNames = null;
    this.attributes = null;
    this.htmlProps = null;
    this.style = null;
    this.eventListeners = null;

    this.children = [];

  }

  VirtualHTMLElement.Prototype = function() {

    this._isVirtualHTMLElement = true;

    this.getTagName = function() {
      return this._tagName;
    };

    this.setTagName = function(tagName) {
      this._tagName = tagName;
      return this;
    };

    this.hasClass = function(className) {
      if (this.classNames) {
        return this.classNames.indexOf(className) > -1;
      }
      return false;
    };

    this.addClass = function(className) {
      if (!this.classNames) {
        this.classNames = [];
      }
      this.classNames.push(className);
      return this;
    };

    this.removeClass = function(className) {
      if (this.classNames) {
        this.classNames = without$1(this.classNames, className);
      }
      return this;
    };

    this.removeAttr = function(attr) {
      if (this.attributes) {
        if (isString$l(attr)) {
          delete this.attributes[attr];
        } else {
          this.attributes = omit(this.attributes, attr);
        }
      }
      return this;
    };

    this.getAttribute = function(name) {
      if (this.attributes) {
        return this.attributes[name];
      }
    };

    this.setAttribute = function(name, value) {
      if (!this.attributes) {
        this.attributes = {};
      }
      this.attributes[name] = value;
      return this;
    };

    this.getAttributes = function() {
      // we are having separated storages for differet
      // kind of attributes which we now pull together
      // in the same way as a native DOM element has it
      var attributes = {};
      if (this.attributes) {
        extend$p(attributes, this.attributes);
      }
      if (this.classNames) {
        attributes.class = this.classNames.join(' ');
      }
      if (this.style) {
        attributes.style = map$5(this.style, function(val, key) {
          return key + ":" + val;
        }).join(';');
      }
      return attributes;
    };

    this.getId = function() {
      return this.getAttribute('id');
    };

    this.setId = function(id) {
      this.setAttribute('id', id);
      return this;
    };

    this.setTextContent = function(text) {
      text = text || '';
      this.empty();
      this.appendChild(text);
      return this;
    };

    this.setInnerHTML = function(html) {
      html = html || '';
      this.empty();
      this._innerHTMLString = html;
      return this;
    };

    this.getInnerHTML = function() {
      if (!this.hasOwnProperty('_innerHTMLString')) {
        throw new Error('Not supported.');
      } else {
        return this._innerHTMLString;
      }
    };

    this.getValue = function() {
      return this.htmlProp('value');
    };

    this.setValue = function(value) {
      this.htmlProp('value', value);
      return this;
    };

    this.getChildNodes = function() {
      return this.children;
    };

    this.getChildren = function() {
      return this.children.filter(function(child) {
        return child.getNodeType() !== "text";
      });
    };

    this.isTextNode = function() {
      return false;
    };

    this.isElementNode = function() {
      return true;
    };

    this.isCommentNode = function() {
      return false;
    };

    this.isDocumentNode = function() {
      return false;
    };

    this.append = function() {
      if (this._innerHTMLString) {
        throw Error('It is not possible to mix $$.html() with $$.append(). You can call $$.empty() to reset this virtual element.');
      }
      this._append(this.children, arguments);
      return this;
    };

    this.appendChild = function(child) {
      if (this._innerHTMLString) {
        throw Error('It is not possible to mix $$.html() with $$.append(). You can call $$.empty() to reset this virtual element.');
      }
      this._appendChild(this.children, child);
      return this;
    };

    this.insertAt = function(pos, child) {
      child = this._normalizeChild(child);
      if (!child) {
        throw new Error('Illegal child: ' + child);
      }
      if (!child._isVirtualElement) {
        throw new Error('Illegal argument for $$.insertAt():' + child);
      }
      if (pos < 0 || pos > this.children.length) {
        throw new Error('insertAt(): index out of bounds.');
      }
      this._insertAt(this.children, pos, child);
      return this;
    };

    this.insertBefore = function(child, before) {
      var pos = this.children.indexOf(before);
      if (pos > -1) {
        this.insertAt(pos, child);
      } else {
        throw new Error('insertBefore(): reference node is not a child of this element.');
      }
      return this;
    };

    this.removeAt = function(pos) {
      if (pos < 0 || pos >= this.children.length) {
        throw new Error('removeAt(): Index out of bounds.');
      }
      this._removeAt(pos);
      return this;
    };

    this.removeChild = function(child) {
      if (!child || !child._isVirtualElement) {
        throw new Error('removeChild(): Illegal arguments. Expecting a CheerioDOMElement instance.');
      }
      var idx = this.children.indexOf(child);
      if (idx < 0) {
        throw new Error('removeChild(): element is not a child.');
      }
      this.removeAt(idx);
      return this;
    };

    this.replaceChild = function(oldChild, newChild) {
      if (!newChild || !oldChild ||
          !newChild._isVirtualElement || !oldChild._isVirtualElement) {
        throw new Error('replaceChild(): Illegal arguments. Expecting BrowserDOMElement instances.');
      }
      var idx = this.children.indexOf(oldChild);
      if (idx < 0) {
        throw new Error('replaceChild(): element is not a child.');
      }
      this.removeAt(idx);
      this.insertAt(idx, newChild);
      return this;
    };

    this.empty = function() {
      var children = this.children;
      while (children.length) {
        var child = children.pop();
        child.parent = null;
      }
      delete this._innerHTMLString;
      return this;
    };

    this.getProperty = function(name) {
      if (this.htmlProps) {
        return this.htmlProps[name];
      }
    };

    this.setProperty = function(name, value) {
      if (!this.htmlProps) {
        this.htmlProps = {};
      }
      this.htmlProps[name] = value;
      return this;
    };

    this.removeProperty = function(name) {
      if (this.htmlProps) {
        delete this.htmlProps[name];
      }
      return this;
    };

    this.getStyle = function(name) {
      if (this.style) {
        return this.style[name];
      }
    };

    this.setStyle = function(name, value) {
      if (!this.style) {
        this.style = {};
      }
      this.style[name] = value;
      return this;
    };

    this.addEventListener = function(eventName, handler, options) {
      var listener;
      if (arguments.length === 1 && arguments[0]._isDOMEventListener) {
        listener = arguments[0];
      } else {
        options = options || {};
        options.context = options.context || this._owner._comp;
        listener = new DOMElement$5.EventListener(eventName, handler, options);
      }
      if (!this.eventListeners) {
        this.eventListeners = [];
      }
      this.eventListeners.push(listener);
      return this;
    };

    this.removeEventListener = function(eventName, handler) {
      if (this.eventListeners) {
        DOMElement$5._findEventListenerIndex(this.eventListeners, eventName, handler);
      }
      return this;
    };

    this.getEventListeners = function() {
      return this.eventListeners;
    };

    this.getNodeType = function() {
      return "element";
    };

    this.hasInnerHTML = function() {
      return Boolean(this._innerHTMLString);
    };

    this._normalizeChild = function(child) {
      if (isString$l(child)) {
        child = new VirtualTextNode(child);
      }
      return child;
    };

    this._append = function(outlet, args) {
      if (args.length === 1 && !isArray$e(args[0])) {
        this._appendChild(outlet, args[0]);
        return;
      }
      var children;
      if (isArray$e(args[0])) {
        children = args[0];
      } else if (arguments.length > 1) {
        children = Array.prototype.slice.call(args,0);
      } else {
        return;
      }
      children.forEach(this._appendChild.bind(this, outlet));
    };

    this._appendChild = function(outlet, child) {
      child = this._normalizeChild(child);
      // TODO: discuss. Having a bad feeling about this,
      // because it could obscure an implementation error
      if (!child) return;
      outlet.push(child);
      this._attach(child);
      return child;
    };

    this._insertAt = function(outlet, pos, child) {
      if (!child) return;
      outlet.splice(pos, 0, child);
      this._attach(child);
    };

    this._removeAt = function(outlet, pos) {
      var child = outlet[pos];
      outlet.splice(pos, 1);
      this._detach(child);
    };

    this._attach = function(child) {
      child.parent = this;
      if (this._context && child._owner !== this._owner && child._ref) {
        this._context.foreignRefs[child._ref] = child;
      }
    };

    this._detach = function(child) {
      child.parent = null;
      if (this._context && child._owner !== this._owner && child._ref) {
        delete this.context.foreignRefs[child._ref];
      }
    };

    this._mergeHTMLConfig = function(other) {
      if (other.classNames) {
        if (!this.classNames) {
          this.classNames = [];
        }
        this.classNames = this.classNames.concat(other.classNames);
      }
      if (other.attributes) {
        if (!this.attributes) {
          this.attributes = {};
        }
        extend$p(this.attributes, other.attributes);
      }
      if (other.htmlProps) {
        if (!this.htmlProps) {
          this.htmlProps = {};
        }
        extend$p(this.htmlProps, other.htmlProps);
      }
      if (other.style) {
        if (!this.style) {
          this.style = {};
        }
        extend$p(this.style, other.style);
      }
      if (other.eventListeners) {
        if (!this.eventListeners) {
          this.eventListeners = [];
        }
        this.eventListeners = this.eventListeners.concat(other.eventListeners);
      }
    };
  };

  VirtualElement$2.extend(VirtualHTMLElement);

  /*
    A virtual element which gets rendered by a custom component.

    @private
    @class VirtualElement.VirtualComponent
    @extends ui/VirtualElement
  */
  function VirtualComponent(ComponentClass, props) {
    VirtualComponent.super.call(this);

    props = props || {};

    this.ComponentClass = ComponentClass;
    this.props = props;
    if (!props.children) {
      props.children = [];
    }
    this.children = props.children;
  }

  VirtualComponent.Prototype = function() {

    this._isVirtualComponent = true;

    this.getComponent = function() {
      return this._comp;
    };

    // Note: for VirtualComponentElement we put children into props
    // so that the render method of ComponentClass can place it.
    this.getChildren = function() {
      return this.props.children;
    };

    this.getNodeType = function() {
      return 'component';
    };

    this.outlet = function(name) {
      return new Outlet(this, name);
    };

    this._attach = function(child) {
      child._preliminaryParent = this;
    };

    this._detach = function(child) {
      child._preliminaryParent = null;
    };

    this._copyHTMLConfig = function() {
      return {
        classNames: clone$6(this.classNames),
        attributes: clone$6(this.attributes),
        htmlProps: clone$6(this.htmlProps),
        style: clone$6(this.style),
        eventListeners: clone$6(this.eventListeners)
      };
    };

    function Outlet(virtualEl, name) {
      this.virtualEl = virtualEl;
      this.name = name;
      Object.freeze(this);
    }

    Outlet.prototype._getOutlet = function() {
      var outlet = this.virtualEl.props[this.name];
      if (!outlet) {
        outlet = [];
        this.virtualEl.props[this.name] = outlet;
      }
      return outlet;
    };

    Outlet.prototype.append = function() {
      var outlet = this._getOutlet();
      this.virtualEl._append(outlet, arguments);
      return this;
    };

    Outlet.prototype.empty = function() {
      var arr = this.virtualEl.props[this.name];
      arr.forEach(function(el) {
        this._detach(el);
      }.bind(this));
      arr.splice(0, arr.length);
      return this;
    };

  };

  VirtualHTMLElement.extend(VirtualComponent);

  function VirtualTextNode(text) {
    this.text = text;
  }

  VirtualTextNode.Prototype = function() {
    this._isVirtualTextNode = true;
  };

  VirtualElement$2.extend(VirtualTextNode);

  VirtualElement$2.Component = VirtualComponent;
  VirtualElement$2.TextNode = VirtualTextNode;

  /**
    Create a virtual DOM representation which is used by Component
    for differential/reactive rendering.

    @param elementType HTML tag name or Component class
    @param [props] a properties object for Component classes
    @return {VirtualElement} a virtual DOM node

    @example

    Create a virtual DOM Element

    ```
    $$('a').attr({href: './foo'}).addClass('se-nav-item')
    ```

    Create a virtual Component

    ```
    $$(HelloMessage, {name: 'John'})
    ```
  */
  VirtualElement$2.createElement = function() {
    var content = null;
    if (isString$l(arguments[0])) {
      if (arguments.length !== 1) {
        throw new Error('Illegal usage of VirtualElement.createElement()');
      }
      content = new VirtualHTMLElement(arguments[0]);
    } else if (isFunction$3(arguments[0]) && arguments[0].prototype._isComponent) {
      if (arguments.length < 1 || arguments.length > 2) {
        throw new Error('Illegal usage of VirtualElement.createElement()');
      }
      var props = {};
      if (arguments.length === 2) {
        // shallow cloning the original object
        props = clone$6(arguments[1]);
      }
      content = new VirtualComponent(arguments[0], props);
    } else if (arguments[0] === undefined) {
      throw new Error('Provided Component was undefined.');
    } else {
      throw new Error('Illegal usage of VirtualElement.createElement()');
    }
    return content;
  };

  module.exports = VirtualElement$2;

  var oo$G = require('./oo');
  var forEach$c = require('lodash/forEach');
  var extend$q = require('lodash/extend');
  var isString$m = require('lodash/isString');
  var DocumentSchema$1 = require('../model/DocumentSchema');
  var EditingBehavior$2 = require('../model/EditingBehavior');
  var Registry$4 = require('../util/Registry');
  var FileClientStub$1 = require('../ui/FileClientStub');
  var SaveHandlerStub$1 = require('../ui/SaveHandlerStub');

  /**
   * Abstract Configurator for Substance editors.
   *
   * @module
   */
  function AbstractConfigurator() {
    this.config = {
      schema: {},
      styles: [],
      nodes: {},
      components: {},
      converters: {},
      importers: {},
      exporters: {},
      commands: [],
      tools: [],
      textTypes: [],
      editingBehaviors: [],
      macros: [],
      icons: {},
      labels: {},
      saveHandler: SaveHandlerStub$1,
      fileClient: FileClientStub$1,
      ToolbarClass: null
    };
  }

  AbstractConfigurator.Prototype = function() {

    // Record phase API
    // ------------------------

    this.defineSchema = function(schema) {
      this.config.schema = schema;
    };

    /**
     * @param {String} NodeClass node class name.
     */
    this.addNode = function(NodeClass) {
      var name = NodeClass.static.name;
      if (!name) {
        throw new Error('A NodeClass must have a name.');
      }
      if (this.config.nodes[name]) {
        throw new Error('NodeClass with this name is already registered: ' + name);
      }
      this.config.nodes[name] = NodeClass;
    };

    this.addConverter = function(type, converter) {
      var converters = this.config.converters[type];
      if (!converters) {
        converters = {};
        this.config.converters[type] = converters;
      }
      if (!converter.type) {
        throw new Error('A converter needs an associated type.');
      }
      converters[converter.type] = converter;
    };

    this.addImporter = function(type, ImporterClass) {
      this.config.importers[type] = ImporterClass;
    };

    this.addExporter = function(type, ExporterClass) {
      this.config.exporters[type] = ExporterClass;
    };

    /**
      @param {String} sassFilePath path to sass style file.
     */
    this.addStyle = function(sassFilePath) {
      this.config.styles.push(sassFilePath);
    };

    this.addComponent = function(name, ComponentClass) {
      if (this.config.components[name]) {
        throw new Error(name+' already registered');
      }
      if (!ComponentClass || !ComponentClass.prototype._isComponent) {
        throw new Error('ComponentClass must be a subclass of ui/Component.');
      }
      this.config.components[name] = ComponentClass;
    };

    this.addCommand = function(CommandClass, options) {
      this.config.commands.push({
        Class: CommandClass,
        options: options || {}
      });
    };

    this.addTool = function(ToolClass, options) {
      this.config.tools.push({
        Class: ToolClass,
        options: options || {}
      });
    };

    this.addIcon = function(iconName, options) {
      var iconConfig = this.config.icons[iconName];
      if (!iconConfig) {
        iconConfig = {};
        this.config.icons[iconName] = iconConfig;
      }
      extend$q(iconConfig, options);
    };

    /**
      @param {String} labelName name of label.
      @param {String} label label.

      Define a new label
      label is either a string or a hash with translations.
      If string is provided 'en' is used as the language.
    */
    this.addLabel = function(labelName, label) {
      if (isString$m(label)) {
        if(!this.config.labels['en']) {
          this.config.labels['en'] = {};
        }
        this.config.labels['en'][labelName] = label;
      } else {
        forEach$c(label, function(label, lang) {
          if (!this.config.labels[lang]) {
            this.config.labels[lang] = {};
          }
          this.config.labels[lang][labelName] = label;
        }.bind(this));
      }
    };

    this.addTextType = function(textType, options) {
      this.config.textTypes.push({
        spec: textType,
        options: options || {}
      });
    };

    this.addEditingBehavior = function(editingBehavior) {
      this.config.editingBehaviors.push(editingBehavior);
    };

    this.addMacro = function(macro) {
      this.config.macros.push(macro);
    };

    this.setSaveHandler = function(saveHandler) {
      this.config.saveHandler = saveHandler;
    };

    this.setToolbarClass = function(ToolbarClass) {
      this.config.ToolbarClass = ToolbarClass;
    };

    this.setFileClient = function(fileClient) {
      this.config.fileClient = fileClient;
    };

    this.import = function(pkg, options) {
      pkg.configure(this, options || {});
    };

    // Config Interpreter APIs
    // ------------------------

    this.getConfig = function() {
      return this.config;
    };

    this.getSchema = function() {
      var schemaConfig = this.config.schema;
      // TODO: We may want to remove passing a schema version as
      // the version is defined by the repository / npm package version
      var schema = new DocumentSchema$1(schemaConfig.name, '1.0.0');
      schema.getDefaultTextType = function() {
        return schemaConfig.defaultTextType;
      };

      schema.addNodes(this.config.nodes);
      return schema;
    };

    this.createArticle = function(seed) {
      var schemaConfig = this.config.schema;

      var schema = this.getSchema();
      var doc = new schemaConfig.ArticleClass(schema);
      if (seed) {
        seed(doc);
      }
      return doc;
    };

    this.createImporter = function(type) {
      var ImporterClass = this.config.importers[type];
      var config = {
        schema: this.getSchema(),
        converters: this.getConverterRegistry().get(type),
        DocumentClass: this.config.schema.ArticleClass
      };

      return new ImporterClass(config);
    };

    this.createExporter = function(type) {
      var ExporterClass = this.config.exporters[type];
      var config = {
        schema: this.getSchema(),
        converters: this.getConverterRegistry().get(type)
      };
      return new ExporterClass(config);
    };

    this.getToolRegistry = function() {
      var toolRegistry = new Registry$4();
      forEach$c(this.config.tools, function(tool) {
        toolRegistry.add(tool.Class.static.name, tool);
      });
      return toolRegistry;
    };

    this.getComponentRegistry = function() {
      var componentRegistry = new Registry$4();
      forEach$c(this.config.components, function(ComponentClass, name) {
        componentRegistry.add(name, ComponentClass);
      });
      return componentRegistry;
    };

    this.getCommands = function() {
      var commands = this.config.commands;
      var CommandClasses = commands.map(function(c) {
        return c.Class;
      });
      return CommandClasses;
    };

    this.getSurfaceCommandNames = function() {
      var commands = this.getCommands();
      var commandNames = commands.map(function(C) {
        return C.static.name;
      });
      return commandNames;
    };

    /*
      A converter registry is a registry by file type and then by node type

      `configurator.getConverterRegistry().get('html').get('paragraph')` provides
      a HTML converter for Paragraphs.
    */
    this.getConverterRegistry = function() {
      if (!this.converterRegistry) {
        var converterRegistry = new Registry$4();
        forEach$c(this.config.converters, function(converters, name) {
          converterRegistry.add(name, new Registry$4(converters));
        });
        this.converterRegistry = converterRegistry;
      }
      return this.converterRegistry;
    };

    this.getFileClient = function() {
      var FileClientClass = this.config.fileClient;
      return new FileClientClass();
    };

    this.getSaveHandler = function() {
      var SaveHandlerClass = this.config.saveHandler;
      return new SaveHandlerClass();
    };

    this.getIconProvider = function() {
      throw new Error('This method is abstract');
    };

    this.getTextTypes = function() {
      return this.config.textTypes.map(function(t) {
        return t.spec;
      });
    };

    this.getI18nInstance = function() {
      throw new Error('This method is abstract.');
    };

    this.getLabelProvider = function() {
      throw new Error('This method is abstract.');
    };

    this.getEditingBehavior = function() {
      var editingBehavior = new EditingBehavior$2();
      this.config.editingBehaviors.forEach(function(behavior) {
        behavior.register(editingBehavior);
      });
      return editingBehavior;
    };

    this.getMacros = function() {
      return this.config.macros;
    };

    this.getToolbarClass = function() {
      return this.config.ToolbarClass;
    };
  };

  oo$G.initClass(AbstractConfigurator);

  module.exports = AbstractConfigurator;

  var oo$H = require('./oo');

  /*
    An iterator for arrays.
    @class
    @param {Array} arr
   */
  function ArrayIterator$2(arr) {
    this.arr = arr;
    this.pos = -1;
  }

  ArrayIterator$2.Prototype = function() {

    this._isArrayIterator = true;

    /**
      @returns {Boolean} true if there is another child node left.
     */
    this.hasNext = function() {
      return this.pos < this.arr.length - 1;
    };

    /**
      Increments the iterator providing the next child node.

      @returns {HTMLElement} The next child node.
     */
    this.next = function() {
      this.pos += 1;
      var next = this.arr[this.pos];
      return next;
    };

    /**
      Decrements the iterator.
     */
    this.back = function() {
      if (this.pos >= 0) {
        this.pos -= 1;
      }
      return this;
    };

  };

  oo$H.initClass(ArrayIterator$2);

  module.exports = ArrayIterator$2;

  /* eslint-disable no-console */

  module.exports = function() {
    console.assert.apply(console, arguments);
  };

  var extend$r = require('lodash/extend');

  var $$1 = null;

  function _createElement(data) {
    var options = {};
    if (data.root && data.root.options) {
      options = data.root.options;
    }
    return extend$r({
      attribs: {},
      children: [],
      parent: null,
      root: null,
      options: options,
      next: null,
      prev: null
    }, data);
  }

  if (!$$1) {
    var cheerio = require('cheerio');
    if (cheerio.prototype) {
      cheerio.prototype.prop = cheerio.prototype.attr;
      cheerio.prototype.removeProp = cheerio.prototype.removeAttr;
      cheerio.prototype.on = function() {};
      cheerio.prototype.off = function() {};
      $$1 = cheerio.load('', {decodeEntities: false, recognizeCDATA: true});

      $$1._createElement = function(tagName, root) {
        return _createElement({
          type: "tag",
          name: tagName,
          root: root
        });
      };

      /*
         we need to be able to create native text nodes efficiently
         this code is taken from:
         https://github.com/cheeriojs/cheerio/blob/106e42a04e38f0d2c7c096d693be2f725c89dc85/lib/api/manipulation.js#L366
      */
      $$1._createTextNode = function(text, root) {
        return _createElement({
          type: 'text',
          data: text,
          root: root
        });
      };

      var parseMarkup = function(str, options) {
        var parsed = $$1.load(str, options);
        var root = parsed.root()[0];
        if (!root.options) {
          root.options = options;
        }
        return root.children.slice();
      };

      $$1.parseHTML = function(str) {
        return parseMarkup(str, { xmlMode: false });
      };

      $$1.parseXML = function(str) {
        return parseMarkup(str, { xmlMode: true });
      };

      $$1._serialize = function(el) {
        var serialize = require('dom-serializer');
        var opts = el.options || (el.root && el.root.options);
        return serialize(el, opts);
      };
    }
  }

  module.exports = $$1;

  var AbstractConfigurator$1 = require('./AbstractConfigurator');
  var FontAwesomeIconProvider$1 = require('../ui/FontAwesomeIconProvider');

  // Setup default label provider
  var LabelProvider$1 = require('../ui/DefaultLabelProvider');

  /*
    Default Configurator for Substance editors

    This works well for single-column apps (such as ProseEditor).
    Write your own Configurator for apps that require more complex
    configuration (e.g. when there are multiple surfaces involved
    each coming with different textTypes, enabled commands etc.)
  */
  function Configurator(firstPackage) {
    AbstractConfigurator$1.call(this);

    if (firstPackage) {
      this.import(firstPackage);
    }
  }

  Configurator.Prototype = function() {

    this.getIconProvider = function() {
      return new FontAwesomeIconProvider$1(this.config.icons);
    };

    this.getLabelProvider = function() {
      return new LabelProvider$1(this.config.labels);
    };

  };

  AbstractConfigurator$1.extend(Configurator);

  module.exports = Configurator;

  module.exports = function createCountingIdGenerator() {
    var counters = {};
    return function uuid(prefix) {
      if (!counters.hasOwnProperty(prefix)) {
        counters[prefix] = 1;
      }
      var result = [prefix, '-', counters[prefix]++].join('');
      return result;
    };
  };

  module.exports = function createSurfaceId(surface) {
    var surfaceParent = surface._getSurfaceParent();
    if (surfaceParent) {
      return surfaceParent.getId() + '/' + surface.name;
    } else {
      return surface.name;
    }
  };

  function deleteFromArray(array, value) {
    for (var i = 0; i < array.length; i++) {
      if (array[i] === value) {
        array.splice(i, 1);
        i--;
      }
    }
  }

  module.exports = deleteFromArray;

  /*
    Escape XML Entities

    HACK: this is just a cheap implementation to escape XML entities
  */
  function encodeXMLEntities$1(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  module.exports = encodeXMLEntities$1;

  var oo$I = require("./oo");
  var forEach$d = require('lodash/forEach');
  var isObject$5 = require('lodash/isObject');
  var warn = require('./warn');

  /**
    Event support.

    @class
    @private
  */
  function EventEmitter$f() {
    this.__events__ = {};
  }

  EventEmitter$f.Prototype = function() {

    /**
     * Emit an event.
     *
     * @param {String} event
     * @param ...arguments
     * @return true if a listener was notified, false otherwise.
     */
    this.emit = function (event) {
      if (event in this.__events__) {
        // console.log("Emitting event %s (%d listeners) on", event, this.__events__[event].length, this);
        // Clone the list of bindings so that handlers can remove or add handlers during the call.
        var bindings = this.__events__[event].slice();
        var args = Array.prototype.slice.call(arguments, 1);
        for (var i = 0, len = bindings.length; i < len; i++) {
          var binding = bindings[i];
          // console.log("- triggering %s", binding.context.constructor.name);
          binding.method.apply(binding.context, args);
        }
        return true;
      }
      return false;
    };

    // sort descending as a listener with higher priority should be
    // called earlier
    function byPriorityDescending(a, b) {
      return b.priority - a.priority;
    }

    /**
     * Connect a listener to a set of events.
     *
     * Optionally, a `priority` can be provided to control the order
     * of all bindings. The default priority is 0. All listeners with the
     * same priority remain in order of registration.
     * A lower priority will make the listener be called later, a higher
     * priority earlier.
     *
     * @param {Object} listener
     * @param {Object} hash with event as keys, and handler functions as values.
     * @param {Number} hash with `priority` as ordering hint (default is 0).
     * @chainable
     */
    this.connect = function (obj, methods, options) { // eslint-disable-line no-unused-vars
      warn('DEPRECATED: Use EventEmitter.on(event, method, context) instead.');
      return _connect.apply(this, arguments);
    };

    /**
     * Disconnect a listener (all bindings).
     *
     * @method disconnect
     * @param {Object} listener
     * @chainable
     */
    this.disconnect = function(listener) {
      warn('DEPRECATED: Use EventEmitter.off(listener) instead.');
      return _disconnect.call(this, listener);
    };

    /**
     * Subscribe a listener to an event.
     *
     * @param {String} event
     * @param {Function} method
     * @param {Object} context
     * @param {Object} options
     */
    this.on = function(event, method, context, options) {
      var priority = 0;
      if (arguments.length === 4) {
        priority = options.priority || priority;
      }
      _on.call(this, event, method, context, priority);
      this.__events__[event].sort(byPriorityDescending);
    };

    /**
     * Unsubscrive a listener from an event.
     *
     * @param {String} event
     * @param {Function} method
     * @param {Object} context
     * @param {Object} options
     */
    this.off = function(event, method, context) { // eslint-disable-line no-unused-vars
      if (arguments.length === 1 && isObject$5(arguments[0])) {
        _disconnect.call(this, arguments[0]);
      } else {
        _off.apply(this, arguments);
      }
    };

    function validateMethod(method, context) {
      // Validate method and context
      if (typeof method === 'string') {
        // Validate method
        if (context === undefined || context === null) {
          throw new Error( 'Method name "' + method + '" has no context.' );
        }
        if (!(method in context)) {
          // Technically the method does not need to exist yet: it could be
          // added before call time. But this probably signals a typo.
          throw new Error( 'Method not found: "' + method + '"' );
        }
        if (typeof context[method] !== 'function') {
          // Technically the property could be replaced by a function before
          // call time. But this probably signals a typo.
          throw new Error( 'Property "' + method + '" is not a function' );
        }
      } else if (typeof method !== 'function') {
        throw new Error( 'Invalid callback. Function or method name expected.' );
      }
    }

    /**
     * Internal implementation for registering a listener.
     *
     * @param {String} event
     * @param {Function} method
     * @param {Object} context
     * @private
     */
    function _on(event, method, context, priority) {
      /* eslint-disable no-invalid-this */
      var bindings;
      validateMethod( method, context );
      if (this.__events__.hasOwnProperty(event)) {
        bindings = this.__events__[event];
      } else {
        // Auto-initialize bindings list
        bindings = this.__events__[event] = [];
      }
      // Add binding
      bindings.push({
        method: method,
        context: context || null,
        priority: priority
      });
      return this;
      /*eslint-enable no-invalid-this */
    }

    /**
     * Remove a listener.
     *
     * @param {String} event
     * @param {Function} method
     * @param {Object} context
     * @private
     */
    function _off(event, method, context) {
      /* eslint-disable no-invalid-this */
      var i, bindings;
      if ( arguments.length === 1 ) {
        // Remove all bindings for event
        delete this.__events__[event];
        return this;
      }
      validateMethod( method, context );
      if ( !( event in this.__events__ ) || !this.__events__[event].length ) {
        // No matching bindings
        return this;
      }
      // Default to null context
      if ( arguments.length < 3 ) {
        context = null;
      }
      // Remove matching handlers
      bindings = this.__events__[event];
      i = bindings.length;
      while ( i-- ) {
        if ( bindings[i].method === method && bindings[i].context === context ) {
          bindings.splice( i, 1 );
        }
      }
      // Cleanup if now empty
      if ( bindings.length === 0 ) {
        delete this.__events__[event];
      }
      return this;
      /* eslint-enable no-invalid-this */
    }

    /**
     * Internal implementation of connect.
     *
     * @private
     */
    function _connect(obj, methods, options) {
      /* eslint-disable no-invalid-this */
      var priority = 0;
      if (arguments.length === 3) {
        priority = options.priority || priority;
      }
      forEach$d(methods, function(method, event) {
        _on.call(this, event, method, obj, priority);
        this.__events__[event].sort(byPriorityDescending);
      }.bind(this));
      return this;
      /* eslint-enable no-invalid-this */
    }

    /**
     * Internal implementation of disconnect.
     *
     * @private
     */
    function _disconnect(context) {
      /* eslint-disable no-invalid-this */
      // Remove all connections to the context
      forEach$d(this.__events__, function(bindings, event) {
        for (var i = bindings.length-1; i>=0; i--) {
          // bindings[i] may have been removed by the previous steps
          // so check it still exists
          if (bindings[i] && bindings[i].context === context) {
            _off.call(this, event, bindings[i].method, context);
          }
        }
      }.bind(this));
      return this;
      /* eslint-enable no-invalid-this */
    }

    this._debugEvents = function() {
      /* eslint-disable no-console */
      console.log('### EventEmitter: ', this);
      forEach$d(this.__events__, function(handlers, name) {
        console.log("- %s listeners for %s: ", handlers.length, name, handlers);
      });
      /* eslint-enable no-console */
    };
  };

  oo$I.initClass(EventEmitter$f);

  module.exports = EventEmitter$f;

  var Registry$5 = require('./Registry');

  /*
   * Simple factory implementation.
   *
   * @class Factory
   * @extends Registry
   * @memberof module:util
   */
  function Factory() {
    Factory.super.call(this);
  }

  Factory.Prototype = function() {

    /**
     * Create an instance of the clazz with a given name.
     *
     * @param {String} name
     * @return A new instance.
     * @method create
     * @memberof module:Basics.Factory.prototype
     */
    this.create = function ( name ) {
      var clazz = this.get(name);
      if ( !clazz ) {
        throw new Error( 'No class registered by that name: ' + name );
      }
      // call the clazz providing the remaining arguments
      var args = Array.prototype.slice.call( arguments, 1 );
      var obj = Object.create( clazz.prototype );
      clazz.apply( obj, args );
      return obj;
    };

  };

  Registry$5.extend(Factory);

  module.exports = Factory;

  var forEach$e = require('lodash/forEach');
  var map$6 = require('lodash/map');

  /*
    Calculate a bounding rectangle for a set of rectangles.

    Note: Here, `bounds.right` and `bounds.bottom` are relative to
    the left top of the viewport.
  */
  function _getBoundingRect(rects) {
    var bounds = {
      left: Number.POSITIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
      width: Number.NaN,
      height: Number.NaN
    };

    forEach$e(rects, function(rect) {
      if (rect.left < bounds.left) {
        bounds.left = rect.left;
      }
      if (rect.top < bounds.top) {
        bounds.top = rect.top;
      }
      if (rect.left + rect.width > bounds.right) {
        bounds.right = rect.left + rect.width;
      }
      if (rect.top + rect.height > bounds.bottom) {
        bounds.bottom = rect.top + rect.height;
      }
    });
    bounds.width = bounds.right - bounds.left;
    bounds.height = bounds.bottom - bounds.top;
    return bounds;
  }

  /*
    Calculate the bounding rect of a single element relative to a parent.

    The rectangle dimensions are calculated as the union of the given elements
    clientRects. A selection fragment, for example, may appear as a multi-line span
    element that consists of a single client rect per line of text in variable widths.
  */
  function _getBoundingOffsetsRect(el, relativeParentEl) {
    var relativeParentElRect = relativeParentEl.getBoundingClientRect();
    var elRect = _getBoundingRect(el.getClientRects());

    var left = elRect.left - relativeParentElRect.left;
    var top = elRect.top - relativeParentElRect.top;
    return {
      left: left,
      top: top,
      right: relativeParentElRect.width - left - elRect.width,
      bottom: relativeParentElRect.height - top - elRect.height,
      width: elRect.width,
      height: elRect.height
    };
  }

  /**
    Get bounding rectangle relative to a given parent element. Allows multiple
    elements being passed (we need this for selections that consist of multiple
    selection fragments). Takes a relative parent element that is used as a
    reference point, instead of the browser's viewport.

    @param {Array} els elements to compute the bounding rectangle for
    @param {DOMElement} containerEl relative parent used as a reference point
    @return {object} rectangle description with left, top, right, bottom, width and height
  */
  function getRelativeBoundingRect$3(els, containerEl) {
    if (els.length === undefined) {
      els = [els];
    }
    var elRects = map$6(els, function(el) {
      return _getBoundingOffsetsRect(el, containerEl);
    });

    var elsRect = _getBoundingRect(elRects);
    var containerElRect = containerEl.getBoundingClientRect();
    return {
      left: elsRect.left,
      top: elsRect.top,
      right: containerElRect.width - elsRect.left - elsRect.width,
      bottom: containerElRect.height - elsRect.top - elsRect.height,
      width: elsRect.width,
      height: elsRect.height
    };
  }

  module.exports = getRelativeBoundingRect$3;

  /*
   * Mostly taken from lodash.
   *
   * @module Basics/Helpers
   * @static
   * @memberof module:Basics
   */
  var Helpers = {};

  // Lang helpers

  /*
   * See https://lodash.com/docs#isEqual
   * @method isEqual
   */
  Helpers.isEqual = require('lodash/isEqual');
  /*
   * See https://lodash.com/docs#isObject
   * @method isObject
   */
  Helpers.isObject = require('lodash/isObject');
  /*
   * See https://lodash.com/docs#isArray
   * @method isArray
   */
  Helpers.isArray = require('lodash/isArray');
  /*
   * See https://lodash.com/docs#isString
   * @method isString
   */
  Helpers.isString = require('lodash/isString');
  /*
   * See https://lodash.com/docs#isNumber
   * @method isNumber
   */
  Helpers.isNumber = require('lodash/isNumber');
  /*
   * See https://lodash.com/docs#isBoolean
   * @method isBoolean
   */
  Helpers.isBoolean = require('lodash/isBoolean');
  /*
   * See https://lodash.com/docs#isFunction
   * @method isFunction
   */
  Helpers.isFunction = require('lodash/isFunction');
  /*
   * See https://lodash.com/docs#cloneDeep
   * @method cloneDeep
   */
  Helpers.cloneDeep = require('lodash/cloneDeep');

  /*
   * See https://lodash.com/docs#clone
   * @method clone
   */
  Helpers.clone = require('lodash/clone');

  /*
   * See https://lodash.com/docs#isEmpty
   * @method isEmpty
   */
  Helpers.isEmpty = require('lodash/isEmpty');

  // Function helpers

  /*
   * See https://lodash.com/docs#bind
   * @method bind
   */
  Helpers.bind = require('lodash/bind');
  /*
   * See https://lodash.com/docs#delay
   * @method delay
   */
  Helpers.delay = require('lodash/delay');
  /*
   * See https://lodash.com/docs#debounce
   * @method debounce
   */
  Helpers.debounce = require('lodash/debounce');

  // Object helpers

  /*
   * See https://lodash.com/docs#extend
   * @method extend
   */
  Helpers.extend = require('lodash/extend');
  /*
   * See https://lodash.com/docs#omit
   * @method omit
   */
  Helpers.omit = require('lodash/omit');
  /*
   * See https://lodash.com/docs#values
   * @method values
   */
  Helpers.values = require('lodash/values');

  // Array helpers

  /*
   * See https://lodash.com/docs#last
   * @method last
   */
  Helpers.last = require('lodash/last');
  /*
   * See https://lodash.com/docs#head
   */
  Helpers.first = require('lodash/head');
  /*
   * See https://lodash.com/docs#compact
   * @method compact
   */
  Helpers.compact = require('lodash/compact');
  /*
   * See https://lodash.com/docs#uniq
   * @method uniq
   */
  Helpers.uniq = require('lodash/uniq');
  /*
   * See https://lodash.com/docs#intersection
   * @method intersection
   */
  Helpers.intersection = require('lodash/intersection');
  /*
   * See https://lodash.com/docs#union
   * @method union
   */
  Helpers.union = require('lodash/union');
  /*
   * See https://lodash.com/docs#without
   * @method without
   */
  Helpers.without = require('lodash/without');

  // Collection helpers

  /*
   * See https://lodash.com/docs#each
   * @method each
   */
  Helpers.each = require('lodash/forEach');
  /*
   * See https://lodash.com/docs#filter
   * @method filter
   */
  Helpers.filter = require('lodash/filter');
  /*
   * See https://lodash.com/docs#includes
   * @method includes
   */
  Helpers.includes = require('lodash/includes');
  /*
   * See https://lodash.com/docs#find
   * @method find
   */
  Helpers.find = require('lodash/find');
  /*
   * See https://lodash.com/docs#map
   * @method map
   */
  Helpers.map = require('lodash/map');
  /*
   * See https://lodash.com/docs#sortBy
   * @method sortBy
   */
  Helpers.sortBy = require('lodash/sortBy');

  // String helpers

  /*
   * See https://lodash.com/docs#capitalize
   * @method capitalize
   */
  Helpers.capitalize = require('lodash/capitalize');

  /*
   * Removes all occurrence of value in array using Array.splice
   * I.e., this changes the array instead of creating a new one
   * as _.without() does.
   *
   * @method deleteFromArray
   * @param {Array} array
   * @param value
   */
  Helpers.deleteFromArray = require('./deleteFromArray');

  /*
   * Alias for {{#crossLink "Helpers/cloneDeep:method"}}{{/crossLink}}.
   * @method deepClone
   */
  Helpers.deepclone = Helpers.cloneDeep;

  Helpers.uuid = require('./uuid');

  Helpers.request = require('./request');

  module.exports = Helpers;

  // Note: in iron-node window is defined - but it has window.process
  // which is not there in a real browser env

  var inElectron = false;
  var inBrowser$6 = ( typeof window !== 'undefined' );

  if (inBrowser$6) {
    var process = window.process;
    if (typeof process !== 'undefined') {
      inElectron = true;
    } 
  }

  var returnVal = inBrowser$6 || inElectron;


  module.exports = returnVal;

  /* eslint-disable no-console */

  module.exports = function() {
    console.info.apply(console, arguments);
  };

  /* eslint-disable strict */
  module.exports = {
    UNDEFINED: 0,
    BACKSPACE: 8,
    DELETE: 46,
    LEFT: 37,
    RIGHT: 39,
    UP: 38,
    DOWN: 40,
    ENTER: 13,
    END: 35,
    HOME: 36,
    TAB: 9,
    PAGEUP: 33,
    PAGEDOWN: 34,
    ESCAPE: 27,
    SHIFT: 16,
    SPACE: 32
  };

  var EventEmitter$g = require("./EventEmitter");

  function Logger() {
    EventEmitter$g.call(this);

    this.messages = [];
  }

  Logger.Prototype = function() {

    this.addMessage = function(msg) {
      this.messages.push(msg);
      this.emit('messages:updated', this.messages);
    };

    this.log = function(msg) {
      this.addMessage({
        type: 'info',
        message: msg
      });
    };

    this.error = function(msg) {
      this.addMessage({
        type: 'error',
        message: msg
      });
    };

    this.warn = this.log;
    this.info = this.log;

    this.clearMessages = function() {
      this.messages = [];
      this.emit('messages:updated', this.messages);
    };
  };

  EventEmitter$g.extend(Logger);

  module.exports = Logger;

  module.exports = function makeMap(keys) {
    return keys.reduce(function(obj, key) {
      obj[key] = true;
      return obj;
    }, {});
  };

  var merge$3 = require('lodash/merge');
  var mergeWith = require('lodash/mergeWith');
  var isArray$f = require('lodash/isArray');

  function _concatArrays(objValue, srcValue) {
    if (isArray$f(objValue)) {
      return objValue.concat(srcValue);
    } else {
      return null;
    }
  }

  function _replaceArrays(objValue, srcValue) {
    if (isArray$f(objValue)) {
      return srcValue;
    } else {
      return null;
    }
  }

  /**
    Same as lodash/merge except that it provides options how to
    treat arrays.

    The default implementation overwrites elements.
     get concatenated rather than overwritten.
  */
  module.exports = function(a, b, options) {
    options = options || {};
    var _with = null;
    if (options.array === 'replace') {
      _with = _replaceArrays;
    } else if (options.array === 'concat') {
      _with = _concatArrays;
    }
    if (_with) {
      return mergeWith(a, b, _with);
    } else {
      return merge$3(a, b);
    }
  };

  var isObject$6 = require('lodash/isObject');
  var isFunction$4 = require('lodash/isFunction');

  /**
   * Helpers for oo programming.
   *
   * @module
   */
  var oo$J = {};

  /**
    Initialize a class.

    After initializing a class has a `static` scope which can be used for static properties
    and functions. These static members get inherited by subclasses, which makes this approach
    as close as possible to ES6.

    An initialized class has an `extend` function which can be used to derive subclasses.

    @param {Constructor} clazz

    @example

    ```
    function MyClass() {
      ...
    }
    oo.initClass(MyClass);
    ```

    #### Extending a class

    The simplest way to create a subclass is

    ```
    var Foo = MyClass.extend()
    ```

    This is the disadvantage, that the created class is anonymous, i.e., in a debugger it
    does not have a senseful name.

    The preferred way is to extend a subclass this way:

    ```
    function Foo() {
      Foo.super.apply(this, arguments);
    }
    MyClass.extend(Foo);
    ```

    This correnponds to what would do in ES6 with

    ```
    class Foo extends MyClass {}
    ```

    It is also possible to derive a class and provide a prototype as an object:

    ```
    var Foo = MyClass.extend({
      bla: function() { return "bla"; }
    });
    ```

    Again the result is an anonymous class, without the ability to show a meaningful name in a
    debugger.

    If you want to define a prototype, the preferred way is extending an already defined class:

    ```
    function Foo() {
      Foo.super.apply(this, arguments);
    }
    MyClass.extend(Foo, {
      bla: function() { return "bla"; }
    });
    ```

    If you prefer to write prototypes as functions you should do it this way:

    ```
    function Foo() {
      Foo.super.apply(this, arguments);
    }
    MyClass.extend(Foo, function() {
      this.bla = function() { return "bla"; };
    });
    ```

    In that case the protoype is an anonymous class, i.e. it won't have a meaningful name in the debugger.

    To overcome this you can give the prototype function a name:

    ```
    function Foo() {
      Foo.super.apply(this, arguments);
    }
    MyClass.extend(Foo, function FooPrototype() {
      this.bla = function() { return "bla"; };
    });
    ```

    #### Static variables

    Static variables can either be set directly on the `static` scope:

    ```
    var Foo = MyClass.extend();
    Foo.static.foo = "foo"
    ```

    Or with a prototype you can provide them in a `static` object property of the prototype:

    ```
    MyClass.extend({
      static: {
        foo: "foo"
      }
    });
    MyClass.static.foo -> "foo"
    ```

    A static scope of a class comes with a reference to its owning class. I.e.,

    ```
    MyClass.static.__class__
    ```

    Gives gives access to `MyClass`.


    #### Mix-ins

    Mixins must be plain objects. They get merged into the created prototype.

    ```
    var MyMixin = {
      foo: "foo";
    };
    function Foo() {
      Foo.super.apply(this, arguments);
    }
    MyClass.extend(Foo, MyMixin);
    ```

    This is also possible in combination with prototype functions.

    ```
    var MyMixin = {
      foo: "foo";
      bar: "bar";
    };
    function Foo() {
      Foo.super.apply(this, arguments);
    }
    MyClass.extend(Foo, MyMixin, function() {
      this.bar = "this wins"
    });
    ```
    Mixins never override existing prototype functions, or already other mixed in members.

  */
  oo$J.initClass = function(clazz) {
    _initClass(clazz);
    _makeExtensible(clazz);
  };

  /**
   * Inherit from a parent class.
   *
   * @param {Constructor} clazz class constructor
   * @param {Constructor} parentClazz parent constructor
   *
   * @example
   *
   * ```js
   * var oo = require('substance/basics/oo');
   * var Parent = function() {};
   * Parent.Prototype = function() {
   *   this.foo = function() { return 'foo'; }
   * }
   * var Child = function() {
   *   Parent.apply(this, arguments);
   * }
   * oo.inherit(Child, Parent);
   * ```
   */
  oo$J.inherit = function(clazz, parentClazz) {
    if (!clazz.__is_initialized__) {
      oo$J.initClass(clazz);
    }
    _inherit(clazz, parentClazz);
    _afterClassInitHook(clazz);
  };

  /*
   * @param clazz {Constructor} class constructor
   * @param mixinClazz {Constructor} parent constructor
   */
  oo$J.mixin = function(Clazz, mixin) {
    if (!Clazz.__is_initialized__) {
      oo$J.initClass(Clazz);
    }
    _mixin(Clazz, mixin);
  };

  // ### Internal implementations

  function _initClass(clazz) {
    if (clazz.__is_initialized__) return;
    if (clazz.Prototype && !(clazz.prototype instanceof clazz.Prototype)) {
      clazz.prototype = new clazz.Prototype();
      clazz.prototype.constructor = clazz;
    }
    var StaticScope = _StaticScope();
    clazz.static = clazz.static || new StaticScope(clazz);
    clazz.__is_initialized__ = true;
  }

  function _inherit(ChildClass, ParentClass) {
    if (ChildClass.prototype instanceof ParentClass) {
      throw new Error('Target already inherits from origin');
    }
    // Customization: supporting a prototype constructor function
    // defined as a static member 'Prototype' of the target function.
    var PrototypeCtor = ChildClass.Prototype;
    // Provide a shortcut to the parent constructor
    ChildClass.super = ParentClass;
    if (PrototypeCtor) {
      PrototypeCtor.prototype = Object.create(ParentClass.prototype, {
        // Restore constructor property of clazz
        constructor: {
          value: PrototypeCtor,
          enumerable: false,
          writable: true,
          configurable: true
        }
      });
      ChildClass.prototype = new PrototypeCtor();
      ChildClass.prototype.constructor = ChildClass;
    } else {
      ChildClass.prototype = Object.create(ParentClass.prototype, {
        // Restore constructor property of clazz
        constructor: {
          value: ChildClass,
          enumerable: false,
          writable: true,
          configurable: true
        }
      });
    }
    // provide a shortcut to the parent class
    // ChildClass.prototype.super = ParentClass;
    // Extend static properties - always initialize both sides
    var StaticScope = _StaticScope();
    if (ParentClass.static) {
      StaticScope.prototype = ParentClass.static;
    }
    ChildClass.static = new StaticScope(ChildClass);
    if (ChildClass.static._makeExtendFunction) {
      ChildClass.extend = ChildClass.static._makeExtendFunction(ChildClass);
    } else {
      _makeExtensible(ChildClass);
    }
  }

  function _afterClassInitHook(childClazz) {
    var proto = childClazz.prototype;
    for(var key in proto) {
      if (key === "constructor" ||
          key === "__class__" ||
          !proto.hasOwnProperty(key)) continue;
      // built-in: extend class.static with prototype.static
      if (key === 'static') {
        _copyStaticProps(childClazz.static, proto.static);
        continue;
      }
    }
  }

  /*
    extend() -> lazy inheritance without a proto
    extend({...}) -> lazy inheritance with a proto
    extend(Function) -> inheritance without a proto
    extend(Function, {}) -> inherit with a proto
    extend(Function, Function) -> inheritance with prototype function
  */
  function _extendClass(ParentClass) {

    // this ctor is used when extend is not provided with a constructor function.
    function AnonymousClass() {
      ParentClass.apply(this, arguments);

      if (this.initialize) {
        this.initialize();
      }
    }

    var args = Array.prototype.slice.call(arguments, 1);
    //var childOrProto = args[args.length-1];
    var ChildClass;
    var mixins = [];

    // the first argument must be a Class constructor, otherwise we will use an anonymous ctor.
    var idx = 0;
    if (isFunction$4(args[0])) {
      ChildClass = args[0];
      idx++;
    } else {
      ChildClass = AnonymousClass;
    }
    // the remaining arguments should be Objects used as a mixin for the created prototype
    // the last argument may be a prototype constructor function.
    for (; idx < args.length; idx++) {
      if (isFunction$4(args[idx])) {
        if (idx !== args.length-1) {
          throw new Error('Illegal use of Class.extend(): Prototype function must be last argument.');
        }
        if (ChildClass.hasOwnProperty('Prototype')) {
          throw new Error('Class ' + ChildClass.name + ' has defined ' + ChildClass.name +
           '.Prototype which would be overwritten by Class.extend().\n' +
           'You provided a prototype function when calling Class.extend().');
        } else {
          ChildClass.Prototype = args[idx];
        }
        break;
      } else if (isObject$6(args[idx])) {
        mixins.push(args[idx]);
      } else {
        throw new Error('Illegal use of Class.extend');
      }
    }
    _inherit(ChildClass, ParentClass);

    // from right to left copy all mixins into the prototype
    // but never overwrite
    // like with lodash/extend, the mixin later in the args list 'wins'
    for (var i = mixins.length - 1; i >= 0; i--) {
      _mixin(ChildClass, mixins[i]);
    }

    return ChildClass;
  }

  function _mixin(Clazz, mixin) {
    var proto = Clazz.prototype;
    for(var key in mixin) {
      if (mixin.hasOwnProperty(key)) {
        // built-in: extend class.static with prototype.static
        if (key === 'static') {
          _copyStaticProps(Clazz.static, mixin.static);
          continue;
        } else {
          if (!proto.hasOwnProperty(key)) {
            proto[key] = mixin[key];
          }
        }
      }
    }
  }

  function _makeExtensible(clazz) {
    if (!clazz.static) {
      oo$J.initClass(clazz);
    }
    clazz.static._makeExtendFunction = function(parentClazz) {
      return _extendClass.bind(clazz, parentClazz);
    };
    clazz.extend = clazz.static._makeExtendFunction(clazz);
  }

  oo$J.makeExtensible = _makeExtensible;

  function _StaticScope() {
    return function StaticScope(clazz) {
      this.__class__ = clazz;
    };
  }

  function _copyStaticProps(staticProps, parentStaticProps) {
    for ( var key in parentStaticProps ) {
      if ( key === 'constructor' ||
           key === '__class__' ||
           !parentStaticProps.hasOwnProperty( key ) ||
           // don't overwrite static properties
           staticProps.hasOwnProperty(key) ) {
        continue;
      }
      staticProps[key] = parentStaticProps[key];
    }
  }

  module.exports = oo$J;

  var inBrowser$7 = require('./inBrowser');

  /**
    @module

    Platform utilities such as browser detection etc.

    @example

    ```js
    var platform = require('substance/util/platform');
    ```
  */
  var platform$5 = {
    /**
      True if user agent is Internet Explorer or Microsoft Edge.
    */
    isIE: false,
    /**
      True if user agent is Firefox
    */

    isFF: false,

    isWebkit: false,

    /*
      Major version

      ATTENTION: at the moment only extracted for IE
    */
    version: -1,

    // TODO: make sure that this is implemented correctly

    isWindows: (inBrowser$7 && window.navigator !== undefined && window.navigator.appVersion && window.navigator.appVersion.indexOf("Win") !== -1),

  };

  if (typeof window !== 'undefined') {
    // Detect Internet Explorer / Edge
    var ua = window.navigator.userAgent;
    var msie = ua.indexOf('MSIE ');
    var trident = ua.indexOf('Trident/');
    var edge = ua.indexOf('Edge/');

    if (msie > 0) {
      // IE 10 or older => return version number
      platform$5.isIE = true;
      platform$5.version = 10;
      // TODO: if we need someday, this would be the exact version number
      // parseInt(ua.substring(msie + 5, ua.indexOf('.', msie)), 10);
    } else if (trident > 0) {
      // IE 11 => return version number
      platform$5.isIE = true;
      platform$5.version = 11;
      platform$5.isTrident = true;
      // TODO: if we need someday, this would be the exact version number
      // var rv = ua.indexOf('rv:');
      // parseInt(ua.substring(rv + 3, ua.indexOf('.', rv)), 10);
    } else if (edge > 0) {
      // IE 12 => return version number
      platform$5.isIE = true;
      platform$5.version = 12;
      platform$5.isEdge = true;
      // TODO: if we need someday, this would be the exact version number
      parseInt(ua.substring(edge + 5, ua.indexOf('.', edge)), 10);
    }

    // Detect Firefox
    platform$5.isFF = window.navigator.userAgent.toLowerCase().indexOf('firefox') > -1;

    // TODO: explicit detection of Webkit&/Blink
    platform$5.isWebkit = !platform$5.isFF && !platform$5.isIE;
  }

  module.exports = platform$5;

  var map$7 = require('lodash/map');

  module.exports = function(collection, prop) {
    return map$7(collection, function(item) { return item[prop]; });
  };

  var forEach$f = require('lodash/forEach');
  var oo$K = require('./oo');
  var warn$1 = require('./warn');

  // just as a reference to detect name collisions
  // with native Object properties
  var _obj = {};

  /*
   * Simple registry implementation.
   *
   * @class Registry
   * @private
   */
  function Registry$6(entries) {
    this.entries = {};
    this.names = [];

    if (entries) {
      forEach$f(entries, function(entry, name) {
        this.add(name, entry);
      }.bind(this));
    }
  }

  Registry$6.Prototype = function() {

    this._isRegistry = true;

    /**
     * Check if an entry is registered for a given name.
     *
     * @param {String} name
     * @method contains
     * @memberof module:Basics.Registry.prototype
     */
    this.contains = function(name) {
      return this.entries.hasOwnProperty(name);
    };

    /**
     * Add an entry to the registry.
     *
     * @param {String} name
     * @param {Object} entry
     * @method add
     * @memberof module:Basics.Registry.prototype
     */
    this.add = function(name, entry) {
      if (_obj[name]) {
        throw new Error('Illegal key: "'+name+'" is a property of Object which is thus not allowed as a key.');
      }
      if (this.contains(name)) {
        this.remove(name);
      }
      this.entries[name] = entry;
      this.names.push(name);
    };

    /**
     * Remove an entry from the registry.
     *
     * @param {String} name
     * @method remove
     * @memberof module:Basics.Registry.prototype
     */
    this.remove = function(name) {
      var pos = this.names.indexOf(name);
      if (pos >= 0) {
        this.names.splice(pos, 1);
      }
      delete this.entries[name];
    };

    /**
     * @method clear
     * @memberof module:Basics.Registry.prototype
     */
    this.clear = function() {
      this.names = [];
      this.entries = {};
    };

    /**
     * Get the entry registered for a given name.
     *
     * @param {String} name
     * @return The registered entry
     * @method get
     * @memberof module:Basics.Registry.prototype
     */
    this.get = function(name) {
      return this.entries[name];
    };

    /*
     * Iterate all registered entries in the order they were registered.
     *
     * @param {Function} callback with signature function(entry, name)
     * @param {Object} execution context
     */
    this.each = function(callback, ctx) {
      warn$1('DEPRECATED: use Registry.forEach(cb) instead');
      return this.forEach(callback.bind(ctx));
    };

    this.forEach = function(callback) {
      for (var i = 0; i < this.names.length; i++) {
        var name = this.names[i];
        var _continue = callback(this.entries[name], name);
        if (_continue === false) {
          break;
        }
      }
    };

  };

  oo$K.initClass(Registry$6);

  module.exports = Registry$6;

  var error = require('./error');

  module.exports = function renderNode($$, component, node) {
    var componentRegistry = component.context.componentRegistry || component.props.componentRegistry;
    var ComponentClass = componentRegistry.get(node.type);
    if (!ComponentClass) {
      error('Could not resolve a component for type: ' + node.type);
      return $$('div');
    }
    return $$(ComponentClass, {
      node: node,
      doc: node.getDocument()
    });
  };

  /**
    Performs an asynchronous HTTP request.

    @param {String} method HTTP method to use for the request
    @param {String} url url to which the request is sent
    @param {Object} data json to be sent to the server
    @param {Function} cb callback that takes error and response data

    @example

    ```js
    request('GET', './data.json', null, function(err, data) {
      if (err) return cb(err); 
      cb(null, data);
    });
    ```
  */

  function request$1(method, url, data, cb) {
    var request = new XMLHttpRequest();
    request.open(method, url, true);
    request.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');
    request.onload = function() {
      if (request.status >= 200 && request.status < 400) {
        var res = request.responseText;
        if(isJson(res)) res = JSON.parse(res); 
        cb(null, res);
      } else {
        return cb(new Error('Request failed. Returned status: ' + request.status));
      }
    };

    if (data) {
      request.send(JSON.stringify(data));
    } else {
      request.send();
    }
  }

  function isJson(str) {
    try {
      JSON.parse(str);
    } catch (e) {
      return false;
    }
    return true;
  }

  module.exports = request$1;

  /* eslint-disable no-console */

  var browserify = require('browserify');
  var sass = require('node-sass');
  var fs = require('fs');
  var each$r = require('lodash/each');

  /**
    @module
    @example

    ```js
    var server = require('substance/util/server');
    ```
  */
  var server = {};


  /**
    Serves a bundled JS file. Browserify is used as a module bundler.

    @param {ExpressApplication} expressApp Express.js application instance
    @param {String} route Express route under which the bundled javascript should be served
    @param {String} sourcePath entry point for js bundling

    @example

    ```js
    server.serveJS(app, 'app.js', path.join(__dirname, 'src', 'app.js'));
    ```
  */
  server.serveJS = function(expressApp, route, sourcePath) {
    expressApp.get(route, function(req, res) {
      browserify({ debug: true, cache: false })
        .add(sourcePath)
        .bundle()
        .on('error', function(err) {
          console.error(err.message);
        })
        .pipe(res);
    });
  };

  /**
    Serves a bundled CSS file. For compilation Sass is used.

    @param {ExpressApplication} expressApp Express.js application instance
    @param {String} route Express route under which the styles should be served
    @param {String} sourcePath entry point for sass compilation

    @example

    ```js
    server.serveStyles(app, '/app.css', path.join(__dirname, 'src', 'app.scss'));
    ```
  */
  server.serveStyles = function(expressApp, route, sourcePath) {
    expressApp.get(route, function(req, res) {
      sass.render({
        file: sourcePath,
        sourceMap: true,
        sourceMapEmbed: true,
        outFile: 'app.css',
      }, function(err, result) {
        if (err) {
          console.error(err);
          res.status(400).json(err);
        } else {
          res.set('Content-Type', 'text/css');
          res.send(result.css);
        }
      });
    });
  };

  server.serveHTML = function(expressApp, route, sourcePath, config) {
    expressApp.get(route, function(req, res) {
      fs.readFile(sourcePath, function (err, data) {
        if (err) {
          res.status(500).json(err);
          return;
        }
        var html = data.toString();
        var metaTags = [];
        each$r(config, function(val, key) {
          metaTags.push('<meta name="'+key+'" content="'+val+'">');
        });
        html = html.replace('<!--CONFIG-->', metaTags.join(''));
        res.set('Content-Type', 'text/html');
        res.send(html);
      });
    });
  };


  module.exports = server;

  var oo$L = require('./oo');

  /**
    Custom error object for all Substance related errors

    @example

    ```js
    var Err = require('substance/util/SubstanceError');
    throw new Err('Document.SelectionUpdateError', {message: 'Could not update selection.'});
    ```

    For better inspection allows you to pass a cause (the error that caused the error).
    That way we can attach context information on each level and we can also ensure
    security, by not passing the cause-chain to the client.

    Resources:
      http://www.bennadel.com/blog/2828-creating-custom-error-objects-in-node-js-with-error-capturestacktrace.htm
      https://gist.github.com/justmoon/15511f92e5216fa2624b
      https://github.com/davepacheco/node-verror/blob/master/lib/verror.js
  */
  function SubstanceError(name, options) {
    this.name = name;
    this.message = options.message;
    this.info = options.info;
    this.errorCode = options.errorCode;
    this.cause = options.cause;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, (SubstanceError));
    }
  }

  SubstanceError.Prototype = function() {
    this.inspect = function() {
      var parts = [];

      // This gives us a full node.js error including error name + message + stack trace
      parts.push(this.stack);

      // We just print additional info here
      if (this.info) {
        parts.push(this.info + '. ');
      }

      // We also print the cause in the same way
      if (this.cause) {
        parts.push('\nCaused by: ');

        if (this.cause.inspect) {
          // If cause is again a Substance error
          parts.push(this.cause.inspect());
        } else {
          // If not we just use Error.toString
          parts.push(this.cause.toString());
        }
      }
      return parts.join('');
    };
  };

  oo$L.initClass(Error);

  Error.extend(SubstanceError);

  SubstanceError.fromJSON = function(err) {
    if (!err) return null;
    var error = new SubstanceError(err.name, {
      message: err.message,
      info: err.info,
      errorCode: err.errorCode,
      cause: SubstanceError.fromJSON(err.cause)
    });
    return error;
  };

  module.exports = SubstanceError;

  var warn$2 = require('./warn');
  /**
    A place to store global variables.
  */
  var substanceGlobals$2 = {};

  if (global.hasOwnProperty('Substance')) {
    warn$2('global.Substance is already defined.');
    substanceGlobals$2 = global.Substance;
  } else {
    global.Substance = substanceGlobals$2;
  }

  module.exports = substanceGlobals$2;

  var isString$n = require('lodash/isString');
  var isArray$g = require('lodash/isArray');
  var get$1 = require('lodash/get');
  var setWith$1 = require('lodash/setWith');
  var oo$M = require('./oo');
  var deleteFromArray$1 = require('./deleteFromArray');

  function TreeNode() {}

  /*
   * A tree-structure for indexes.
   *
   * @class TreeIndex
   * @param {object} [obj] An object to operate on
   * @memberof module:Basics
   * @example
   *
   * var index = new TreeIndex({a: "aVal", b: {b1: 'b1Val', b2: 'b2Val'}});
   */

  function TreeIndex$6() {}

  TreeIndex$6.Prototype = function() {

    /**
     * Get value at path.
     *
     * @return {object} The value stored for a given path
     *
     * @example
     *
     * obj.get(['b', 'b1']);
     * => b1Val
     */
    this.get = function(path) {
      if (arguments.length > 1) {
        path = Array.prototype.slice(arguments, 0);
      }
      if (isString$n(path)) {
        path = [path];
      }
      return get$1(this, path);
    };

    this.getAll = function(path) {
      if (arguments.length > 1) {
        path = Array.prototype.slice(arguments, 0);
      }
      if (isString$n(path)) {
        path = [path];
      }
      if (!isArray$g(path)) {
        throw new Error('Illegal argument for TreeIndex.get()');
      }
      var node = get$1(this, path);
      return this._collectValues(node);
    };

    this.set = function(path, value) {
      if (isString$n(path)) {
        path = [path];
      }
      setWith$1(this, path, value, function(val) {
        if (!val) return new TreeNode();
      });
    };

    this.delete = function(path) {
      if (isString$n(path)) {
        delete this[path];
      } else if(path.length === 1) {
        delete this[path[0]];
      } else {
        var key = path[path.length-1];
        path = path.slice(0, -1);
        var parent = get$1(this, path);
        if (parent) {
          delete parent[key];
        }
      }
    };

    this.clear = function() {
      var root = this;
      for (var key in root) {
        if (root.hasOwnProperty(key)) {
          delete root[key];
        }
      }
    };

    this.traverse = function(fn) {
      this._traverse(this, [], fn);
    };

    this.forEach = this.traverse;

    this._traverse = function(root, path, fn) {
      var id;
      for (id in root) {
        if (!root.hasOwnProperty(id)) continue;
        var child = root[id];
        var childPath = path.concat([id]);
        if (child instanceof TreeNode) {
          this._traverse(child, childPath, fn);
        } else {
          fn(child, childPath);
        }
      }
    };

    this._collectValues = function(root) {
      // TODO: don't know if this is the best solution
      // We use this only for indexes, e.g., to get all annotation on one node
      var vals = {};
      this._traverse(root, [], function(val, path) {
        var key = path[path.length-1];
        vals[key] = val;
      });
      return vals;
    };
  };

  oo$M.initClass(TreeIndex$6);

  TreeIndex$6.Arrays = function() {};

  TreeIndex$6.Arrays.Prototype = function() {

    var _super = Object.getPrototypeOf(this);

    this.get = function(path) {
      var val = _super.get.call(this, path);
      if (val instanceof TreeNode) {
        val = val.__values__ || [];
      }
      return val;
    };

    this.set = function() {
      throw new Error('TreeIndex.set() is not supported for array type.');
    };

    this.add = function(path, value) {
      if (isString$n(path)) {
        path = [path];
      }
      if (!isArray$g(path)) {
        throw new Error('Illegal arguments.');
      }
      var arr;

      // We are using setWith, as it allows us to create nodes on the way down
      // setWith can be controlled via a hook called for each key in the path
      // If val is not defined, a new node must be created and returned.
      // If val is defined, then we must return undefined to keep the original tree node
      // __dummy__ is necessary as setWith is used to set a value, but we want
      // to append to the array
      setWith$1(this, path.concat(['__values__','__dummy__']), undefined, function(val, key) {
        if (key === '__values__') {
          if (!val) val = [];
          arr = val;
        } else if (!val) {
          val = new TreeNode();
        }
        return val;
      });
      delete arr.__dummy__;
      arr.push(value);
    };

    this.remove = function(path, value) {
      var arr = get$1(this, path);
      if (arr instanceof TreeNode) {
        deleteFromArray$1(arr.__values__, value);
      }
    };

    this._collectValues = function(root) {
      var vals = [];
      this._traverse(root, [], function(val) {
        vals.push(val);
      });
      vals = Array.prototype.concat.apply([], vals);
      return vals;
    };

  };

  TreeIndex$6.extend(TreeIndex$6.Arrays);

  module.exports = TreeIndex$6;

  /*!
  Math.uuid.js (v1.4)
  http://www.broofa.com
  mailto:robert@broofa.com
  Copyright (c) 2010 Robert Kieffer
  Dual licensed under the MIT and GPL licenses.
  */

  /**
   * Generates a unique id.
   *
   * @param {String} [prefix] if provided the UUID will be prefixed.
   * @param {Number} [len] if provided a UUID with given length will be created.
   * @return A generated uuid.
   */
  function uuid$h(prefix, len) {
    if (prefix && prefix[prefix.length-1] !== "-") {
      prefix = prefix.concat("-");
    }
    var chars = '0123456789abcdefghijklmnopqrstuvwxyz'.split('');
    var uuid = [];
    var radix = 16;
    var idx;
    len = len || 32;
    if (len) {
      // Compact form
      for (idx = 0; idx < len; idx++) uuid[idx] = chars[0 | Math.random()*radix];
    } else {
      // rfc4122, version 4 form
      var r;
      // rfc4122 requires these characters
      uuid[8] = uuid[13] = uuid[18] = uuid[23] = '-';
      uuid[14] = '4';
      // Fill in random data.  At i==19 set the high bits of clock sequence as
      // per rfc4122, sec. 4.1.5
      for (idx = 0; idx < 36; idx++) {
        if (!uuid[idx]) {
          r = 0 | Math.random()*16;
          uuid[idx] = chars[(idx === 19) ? (r & 0x3) | 0x8 : r];
        }
      }
    }
    return (prefix ? prefix : "") + uuid.join('');
  }

  module.exports = uuid$h;

  /* eslint-disable no-console */

  module.exports = function() {
    console.warn.apply(console, arguments);
  };

})));
