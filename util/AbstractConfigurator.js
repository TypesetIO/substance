

const oo = require('./oo');
const forEach = require('lodash/forEach');
const extend = require('lodash/extend');
const isString = require('lodash/isString');
const DocumentSchema = require('../model/DocumentSchema');
const EditingBehavior = require('../model/EditingBehavior');
const Registry = require('../util/Registry');
const FileClientStub = require('../ui/FileClientStub');
const SaveHandlerStub = require('../ui/SaveHandlerStub');

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
    saveHandler: SaveHandlerStub,
    fileClient: FileClientStub,
    ToolbarClass: null,
  };
}

AbstractConfigurator.Prototype = function () {
  // Record phase API
  // ------------------------

  this.defineSchema = function (schema) {
    this.config.schema = schema;
  };

  /**
   * @param {String} NodeClass node class name.
   */
  this.addNode = function (NodeClass) {
    const name = NodeClass.static.name;
    if (!name) {
      throw new Error('A NodeClass must have a name.');
    }
    if (this.config.nodes[name]) {
      throw new Error(`NodeClass with this name is already registered: ${name}`);
    }
    this.config.nodes[name] = NodeClass;
  };

  this.addConverter = function (type, converter) {
    let converters = this.config.converters[type];
    if (!converters) {
      converters = {};
      this.config.converters[type] = converters;
    }
    if (!converter.type) {
      throw new Error('A converter needs an associated type.');
    }
    converters[converter.type] = converter;
  };

  this.addImporter = function (type, ImporterClass) {
    this.config.importers[type] = ImporterClass;
  };

  this.addExporter = function (type, ExporterClass) {
    this.config.exporters[type] = ExporterClass;
  };

  /**
    @param {String} sassFilePath path to sass style file.
   */
  this.addStyle = function (sassFilePath) {
    this.config.styles.push(sassFilePath);
  };

  this.addComponent = function (name, ComponentClass) {
    if (this.config.components[name]) {
      throw new Error(`${name} already registered`);
    }
    if (!ComponentClass || !ComponentClass.prototype._isComponent) {
      throw new Error('ComponentClass must be a subclass of ui/Component.');
    }
    this.config.components[name] = ComponentClass;
  };

  this.addCommand = function (CommandClass, options) {
    this.config.commands.push({
      Class: CommandClass,
      options: options || {},
    });
  };

  this.addTool = function (ToolClass, options) {
    this.config.tools.push({
      Class: ToolClass,
      options: options || {},
    });
  };

  this.addIcon = function (iconName, options) {
    let iconConfig = this.config.icons[iconName];
    if (!iconConfig) {
      iconConfig = {};
      this.config.icons[iconName] = iconConfig;
    }
    extend(iconConfig, options);
  };

  /**
    @param {String} labelName name of label.
    @param {String} label label.

    Define a new label
    label is either a string or a hash with translations.
    If string is provided 'en' is used as the language.
  */
  this.addLabel = function (labelName, label) {
    if (isString(label)) {
      if (!this.config.labels.en) {
        this.config.labels.en = {};
      }
      this.config.labels.en[labelName] = label;
    } else {
      forEach(label, (currentLabel, lang) => {
        if (!this.config.labels[lang]) {
          this.config.labels[lang] = {};
        }
        this.config.labels[lang][labelName] = currentLabel;
      });
    }
  };

  this.addTextType = function (textType, options) {
    this.config.textTypes.push({
      spec: textType,
      options: options || {},
    });
  };

  this.addEditingBehavior = function (editingBehavior) {
    this.config.editingBehaviors.push(editingBehavior);
  };

  this.addMacro = function (macro) {
    this.config.macros.push(macro);
  };

  this.setSaveHandler = function (saveHandler) {
    this.config.saveHandler = saveHandler;
  };

  this.setToolbarClass = function (ToolbarClass) {
    this.config.ToolbarClass = ToolbarClass;
  };

  this.setFileClient = function (fileClient) {
    this.config.fileClient = fileClient;
  };

  this.import = function (pkg, options) {
    pkg.configure(this, options || {});
  };

  // Config Interpreter APIs
  // ------------------------

  this.getConfig = function () {
    return this.config;
  };

  this.getSchema = function () {
    const schemaConfig = this.config.schema;
    // TODO: We may want to remove passing a schema version as
    // the version is defined by the repository / npm package version
    const schema = new DocumentSchema(schemaConfig.name, '1.0.0');
    schema.getDefaultTextType = function () {
      return schemaConfig.defaultTextType;
    };

    schema.addNodes(this.config.nodes);
    return schema;
  };

  this.createArticle = function (seed) {
    const schemaConfig = this.config.schema;

    const schema = this.getSchema();
    const doc = new schemaConfig.ArticleClass(schema);
    if (seed) {
      seed(doc);
    }
    return doc;
  };

  this.createImporter = function (type) {
    const ImporterClass = this.config.importers[type];
    const config = {
      schema: this.getSchema(),
      converters: this.getConverterRegistry().get(type),
      DocumentClass: this.config.schema.ArticleClass,
    };

    return new ImporterClass(config);
  };

  this.createExporter = function (type) {
    const ExporterClass = this.config.exporters[type];
    const config = {
      schema: this.getSchema(),
      converters: this.getConverterRegistry().get(type),
    };
    return new ExporterClass(config);
  };

  this.getToolRegistry = function () {
    const toolRegistry = new Registry();
    forEach(this.config.tools, (tool) => {
      toolRegistry.add(tool.Class.static.name, tool);
    });
    return toolRegistry;
  };

  this.getComponentRegistry = function () {
    const componentRegistry = new Registry();
    forEach(this.config.components, (ComponentClass, name) => {
      componentRegistry.add(name, ComponentClass);
    });
    return componentRegistry;
  };

  this.getCommands = function () {
    const commands = this.config.commands;
    const CommandClasses = commands.map(c => c.Class);
    return CommandClasses;
  };

  this.getSurfaceCommandNames = function () {
    const commands = this.getCommands();
    const commandNames = commands.map(C => C.static.name);
    return commandNames;
  };

  /*
    A converter registry is a registry by file type and then by node type

    `configurator.getConverterRegistry().get('html').get('paragraph')` provides
    a HTML converter for Paragraphs.
  */
  this.getConverterRegistry = function () {
    if (!this.converterRegistry) {
      const converterRegistry = new Registry();
      forEach(this.config.converters, (converters, name) => {
        converterRegistry.add(name, new Registry(converters));
      });
      this.converterRegistry = converterRegistry;
    }
    return this.converterRegistry;
  };

  this.getFileClient = function () {
    const FileClientClass = this.config.fileClient;
    return new FileClientClass();
  };

  this.getSaveHandler = function () {
    const SaveHandlerClass = this.config.saveHandler;
    return new SaveHandlerClass();
  };

  this.getIconProvider = function () {
    throw new Error('This method is abstract');
  };

  this.getTextTypes = function () {
    return this.config.textTypes.map(t => t.spec);
  };

  this.getI18nInstance = function () {
    throw new Error('This method is abstract.');
  };

  this.getLabelProvider = function () {
    throw new Error('This method is abstract.');
  };

  this.getEditingBehavior = function () {
    const editingBehavior = new EditingBehavior();
    this.config.editingBehaviors.forEach((behavior) => {
      behavior.register(editingBehavior);
    });
    return editingBehavior;
  };

  this.getMacros = function () {
    return this.config.macros;
  };

  this.getToolbarClass = function () {
    return this.config.ToolbarClass;
  };
};

oo.initClass(AbstractConfigurator);

module.exports = AbstractConfigurator;
