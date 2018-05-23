import { selectionFromJSON } from './selectionHelpers';
import isEqual from "lodash/isEqual";
import isObject from "lodash/isObject";
import isArray from "lodash/isArray";
import map from "lodash/map";
import forEach from "lodash/forEach";
import clone from "lodash/clone";
import cloneDeep from "lodash/cloneDeep";
import oo from "../util/oo";
import uuid from "../util/uuid";
import OperationSerializer from "./data/OperationSerializer";
import ObjectOperation from "./data/ObjectOperation";

const { initClass } = oo;
const { fromJSON, transform } = ObjectOperation;

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
function DocumentChange(ops, before, after) {
  if (arguments.length === 1 && isObject(arguments[0])) {
    const data = arguments[0];
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
    this.sha = uuid();
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

DocumentChange.Prototype = function () {
  /*
    Extract aggregated information about which nodes and properties have been affected.
    This gets called by Document after applying the change.
  */
  this._extractInformation = function (doc) {
    const ops = this.ops;
    const created = {};
    const deleted = {};
    const updated = {};
    const affectedContainerAnnos = [];

    // TODO: we will introduce a special operation type for coordinates
    function _checkAnnotation(op) {
      let node = op.val;
      let path, 
        propName;
      switch (op.type) {
        case 'create':
        case 'delete':
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
        case 'update':
        case 'set':
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

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op.type === 'create') {
        created[op.val.id] = op.val;
        delete deleted[op.val.id];
      }
      if (op.type === 'delete') {
        delete created[op.val.id];
        deleted[op.val.id] = op.val;
      }
      if (op.type === 'set' || op.type === 'update') {
        // The old as well the new one is affected
        updated[op.path] = true;
      }
      _checkAnnotation(op);
    }

    affectedContainerAnnos.forEach((anno) => {
      const container = doc.get(anno.containerId, 'strict');
      const startPos = container.getPosition(anno.startPath[0]);
      const endPos = container.getPosition(anno.endPath[0]);
      for (let pos = startPos; pos <= endPos; pos++) {
        const node = container.getChildAt(pos);
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
    if (Object.keys(deleted).length > 0) {
      forEach(updated, (_, key) => {
        const nodeId = key.split(',')[0];
        if (deleted[nodeId]) {
          delete updated[key];
        }
      });
    }

    this.created = created;
    this.deleted = deleted;
    this.updated = updated;
  };

  this.invert = function () {
    // shallow cloning this
    const copy = this.toJSON();
    copy.ops = [];
    // swapping before and after
    const tmp = copy.before;
    copy.before = copy.after;
    copy.after = tmp;
    const inverted = DocumentChange.fromJSON(copy);
    const ops = [];
    for (let i = this.ops.length - 1; i >= 0; i--) {
      ops.push(this.ops[i].invert());
    }
    inverted.ops = ops;
    return inverted;
  };

  // Inspection API used by DocumentChange listeners
  // ===============================================

  this.isAffected = function (path) {
    return this.updated[path];
  };

  this.isUpdated = this.isAffected;

  /*
    TODO serializers and deserializers should allow
    for application data in 'after' and 'before'
  */

  this.serialize = function () {
    const opSerializer = new OperationSerializer();
    const data = this.toJSON();
    data.ops = this.ops.map(op => opSerializer.serialize(op));
    return JSON.stringify(data);
  };

  this.clone = function () {
    return DocumentChange.fromJSON(this.toJSON());
  };

  this.toJSON = function () {
    const data = {
      // to identify this change
      sha: this.sha,
      // before state
      before: clone(this.before),
      ops: map(this.ops, op => op.toJSON()),
      info: this.info,
      // after state
      after: clone(this.after),
    };

    // Just to make sure rich selection objects don't end up
    // in the JSON result
    data.after.selection = undefined;
    data.before.selection = undefined;

    let sel = this.before.selection;
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

initClass(DocumentChange);

DocumentChange.deserialize = function (str) {
  const opSerializer = new OperationSerializer();
  const data = JSON.parse(str);
  data.ops = data.ops.map(opData => opSerializer.deserialize(opData));
  if (data.before.selection) {
    data.before.selection = selectionFromJSON(data.before.selection);
  }
  if (data.after.selection) {
    data.after.selection = selectionFromJSON(data.after.selection);
  }
  return new DocumentChange(data);
};

DocumentChange.fromJSON = function (data) {
  // Don't write to original object on deserialization
  const change = cloneDeep(data);
  change.ops = data.ops.map(opData => fromJSON(opData));
  change.before.selection = selectionFromJSON(data.before.selection);
  change.after.selection = selectionFromJSON(data.after.selection);
  return new DocumentChange(change);
};

/*
  Transforms change A with B, as if A was done before B.
  A' and B' can be used to update two clients to get to the
  same document content.

     / A - B' \
  v_n          v_n+1
     \ B - A' /
*/
DocumentChange.transformInplace = function (A, B) {
  _transformInplaceBatch(A, B);
};

function _transformInplaceSingle(a, b) {
  for (let i = 0; i < a.ops.length; i++) {
    const a_op = a.ops[i];
    for (let j = 0; j < b.ops.length; j++) {
      const b_op = b.ops[j];
      transform(a_op, b_op, { inplace: true });
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
  if (!isArray(A)) {
    A = [A];
  }
  if (!isArray(B)) {
    B = [B];
  }
  for (let i = 0; i < A.length; i++) {
    const a = A[i];
    for (let j = 0; j < B.length; j++) {
      const b = B[j];
      _transformInplaceSingle(a, b);
    }
  }
}

function _transformSelectionInplace(sel, a) {
  if (!sel || (!sel.isPropertySelection() && !sel.isContainerSelection())) {
    return false;
  }
  const ops = a.ops;
  let hasChanged = false;
  const isCollapsed = sel.isCollapsed();
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
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

DocumentChange.transformSelection = function (sel, a) {
  const newSel = sel.clone();
  const hasChanged = _transformSelectionInplace(newSel, a);
  if (hasChanged) {
    return newSel;
  } else {
    return sel;
  }
};

function _transformCoordinateInplace(coor, op) {
  if (!isEqual(op.path, coor.path)) return false;
  let hasChanged = false;
  if (op.type === 'update' && op.propertyType === 'string') {
    const diff = op.diff;
    let newOffset;
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

export default DocumentChange;
