import PropertySelection from './PropertySelection'
import ContainerSelection from './ContainerSelection'
import NodeSelection from './NodeSelection'
import CustomSelection from './CustomSelection'

export function selectionFromJSON(json) {
  if (!json) return Selection.nullSelection;
  var type = json.type;
  switch(type) {
    case 'property':
      return propertySelectionFromJSON(json);
    case 'container':
      return containerSelectionFromJSON(json);
    case 'node':
      return nodeSelectionFromJSON(json);
    case 'custom':
      return customSelectionFromJSON(json);
    default:
      return Selection.nullSelection;
  }
}