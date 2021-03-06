'use strict';

var isArray = require('lodash/isArray');
var last = require('lodash/last');

/*
 * HTML converter for List.
 */
var ListHtmlConverter = {

  type: "list",

  matchElement: function(el) {
    return el.is('ul, ol');
  },

  /*
   *
   * <ol>
   *   <li>Item 1
   *     <ul>
   *       <li>Point A</li>
   *       <li>Point B</li>
   *     </ul>
   *   </li>
   *   <li>Item 2
   *     <ul>
   *       <li>Point C</li>
   *       <li>Point D</li>
   *     </ul>
   *   </li>
   * </ol>
   *
   * Will be modeled as:
   *
   * list:
   *   - list-item[1,o,"Item 1"]
   *   - list-item[2,u,"Point A"]
   *   - list-item[2,u,"Point B"]
   *   - list-item[1,o,"Item 2"]
   *   - list-item[2,u,"Point A"]
   *   - list-item[2,u,"Point B"]
   */
  import: function(el, list, converter) {
    list.items = [];
    // iterate through the children keeping track of the nesting level
    // and associated list type
    var state = {
      level: 0,
      types: [],
      list: list,
      items: []
    };
    this._importList(state, el, converter);
    state.items.forEach(function(item) {
      list.items.push(item.id);
      item.parent = list.id;
    });
  },

  export: function(node, el, converter) {
    var $$ = converter.$$;
    return this.render(node, {
      createListElement: function(list) {
        var tagName = list.ordered ? 'ol' : 'ul';
        return $$(tagName).attr('data-id', list.id);
      },
      renderListItem: function(item) {
        return $$('li')
          .attr("data-id", item.id)
          .append(converter.annotatedText([item.id, 'content']));
      }
    });
  },

  render: function(list, impl) {
    var children = list.getChildren();
    var el = impl.createListElement(list);

    var j;
    var current = el;
    var stack = [current];
    var level = 1;

    for (var i = 0; i < children.length; i++) {
      var item = children[i];
      if (item.level === level) {
        // nothing to change
      } else if (item.level > level) {
        // push structure
        for (j = level; j < item.level; j++) {
          // create a list element and wrap it into a 'li'
          var listEl = impl.createListElement(item);
          current.append(listEl);
          // update level and stack
          current = listEl;
          stack.push(current);
          level++;
        }
      } else /* if (item.level < level) */ {
        // pop structure
        for (j = level; j > item.level; j--) {
          stack.pop();
          level--;
        }
        current = stack[stack.length-1];
      }
      current.append(impl.renderListItem(item));
    }
    return el;
  },

  _importList: function(state, listEl, converter) {
    state.level++;
    state.types.push(listEl.tagName);
    listEl.getChildren().forEach(function(child) {
      var type = child.tagName;
      if (type === "li") {
        this._importListItem(state, child, converter);
      } else if (type == "ol" || type === "ul") {
        this._importList(state, child, converter);
      }
    }.bind(this));
    state.level--;
    state.types.pop();
  },

  // TODO: this needs to be fleshed out to be 100% robust
  _normalizeListItem: function(state, li) {
    var segments = [[]];
    var lastSegment = segments[0];
    li.getChildNodes().forEach(function(child) {
      var type = child.tagName;
      if (type === "ol" || type === "ul") {
        lastSegment = child;
        segments.push(lastSegment);
      } else {
        if (/^\s*$/.exec(child.textContent)) {
          // skip fragments with only whitespace
          return;
        }
        if (!isArray(lastSegment)) {
          lastSegment = [];
          segments.push(lastSegment);
        }
        lastSegment.push(child);
      }
    });
    return segments;
  },

  _importListItem: function(state, li, converter) {
    var ordered = (last(state.types) === "ol");
    // in our interpretation a list item may have leading annotated text
    // and trailing list element
    var fragments = this._normalizeListItem(state, li, converter);
    for (var i = 0; i < fragments.length; i++) {
      var fragment = fragments[i];
      if (isArray(fragment)) {
        // create a list item and use the fragment as annotated content
        var wrapper = li.createElement('li').append(fragment);
        converter._trimTextContent(wrapper);
        var listItem = converter.convertElement(wrapper);
        listItem.ordered = ordered;
        listItem.level = state.level;
        state.items.push(listItem);
      } else {
        this._importList(state, fragment, converter);
      }
    }
  },

};

module.exports = ListHtmlConverter;
