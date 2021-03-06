/**
 * Created by Johan on 4/14/2015.
 */

// process.env.NO_EXIT_ON_UNCAUGHT (not recommended
//                                  - unless your boot-time is v/long and your confidence is v/high
//                                  - it logs error, beware log spew
//                                  TODO: log repeated message "collapse" (by context, by level?)
//                                 )
// process.env.NO_EXIT_ON_SIGTERM
// process.env.STOP_ON_SIGINT (just stops components and disconnects network, no exit) <--- functionality pending
// process.env.START_AS_ROOTED (exposes all mesh nodes in process at global.$happner)
// process.env.UNROOT_ON_REPL (removes $happner from global and attaches it to repl server context during startup)
// process.env.SKIP_AUTO_LOAD (don't perform auto loading from happner.js)

var root = {
  nodes: {},
  utils: {}
}

var depWarned0 = false; // mesh.api
var depWarned1 = false; // componentConfig.meshName
var depWarned2 = false; // componentConfig.setOptions
var depWarned3 = false; // module.directory
var depWarned4 = false; // Happner.start()

if (process.env.START_AS_ROOTED) global.$happner = root;

var Internals = require('./system/shared/internals')
  , MeshClient = require('./system/shared/mesh-client')
  , Happn = require('happn')
  , DataLayer = require('./system/datalayer')
  , Config = require('./system/config')
  , async = require('async')
  , MeshError = require('./system/shared/mesh-error')
  , ComponentInstance = require('./system/component-instance')
  , path = require("path")
  , repl = require('./system/repl')
  , fs = require('fs-extra')
  , Promise = require('bluebird')
  , Packager = require('./system/packager')
  , utilities = require('./system/utilities')
  , Logger = require('happn-logger')
  , events = require("events")
  , EventEmitter = require("events").EventEmitter
;

module.exports = Mesh;
module.exports.MeshClient = MeshClient;

var _meshEvents = new EventEmitter();

var __emit = function (key, data) {
  _meshEvents.emit(key, data);
}

module.exports.on = function (key, handler) {
  return _meshEvents.on(key, handler);
}

module.exports.off = function (key, handler) {
  return _meshEvents.removeListener(key, handler);
}

Logger.emitter.on('after', function (level, message, stack) {
  __emit('mesh-log', {"level": level, "message": message, "stack": stack});
}.bind(this));

// Quick start.
module.exports.create = Promise.promisify(function MeshFactory(config, callback) {

  // node -e 'require("happner").create()'

  config = config || {};
  callback = callback || (typeof config == 'function' ? config : function (err) {
      if (err) {
        console.error(err.stack);
        process.exit(err.errno || 1);
      }
    });


  // node -e 'require("happner").create(9999)'
  if (typeof config == 'number') config = {
    datalayer: {
      port: config
    }
  };

  // node -e 'require("happner").create("5.6.7.88:7654")'
  if (typeof config == 'string') {
    var parts = config.split(':');
    config = {
      datalayer: {}
    };
    config.datalayer.host = parts[0];
    if (parts[1]) config.datalayer.port = parseInt(parts[1]);
  }

  ;
  (new Mesh()).initialize(config, function (err, mesh) {
    if (err) return callback(err, mesh);
    return mesh.start(function (err, mesh) {
      if (err) return callback(err, mesh);
      callback(null, mesh);
    });
  });
});

Object.defineProperty(module.exports, 'start', {
  get: function () {
    if (!depWarned4) {
      depWarned4 = true;
      console.warn('\n[ WARN] Happner.start() is deprecated, use Happner.create().\n');
    }
    return module.exports.create;
  }
});

var __protectedMesh = function(config, meshContext){

  return {
    // (all false) - runlevel 0
    initializing: false,  // true         - runlevel 10
    initialized: false,  // true          - runlevel 20
    starting: false,    // true           - runlevel 30
    started: false,    // true            - runlevel 40
    stopped: false,    // true            - runlevel 00
    config: config || {},

    elements: {},

    description: {},
    endpoints: {},
    exchange: {},
    datalayer: {},

    // Selected internal functions available to _mesh.
    _createElement: function (spec, writeSchema, callback) {
      meshContext._createElement(spec, writeSchema, callback);
    },

    _destroyElement: function (componentName, callback) {
      meshContext._destroyElement(componentName, callback);
    }

    // TODO: add access to start() and stop()

  };
}

function Mesh(config) {

  var _this = this;

  // _mesh
  // -----
  //
  // if   meshConfig: { components: { 'componentName': { accessLevel: 'mesh', ...
  // then $happn._mesh is available in component

  this._mesh = __protectedMesh(config, _this);

  this._stats = {
    proc: {
      up: Date.now()
    },
    component: {}
  };


  // used by packager.js & modules/api
  Object.defineProperty(this, 'tools', {
    value: {}
  });


  Object.defineProperty(this, 'runlevel', {
    get: function () {

      if (_this._mesh.stopped) return 0;

      if (_this._mesh.started) return 40;
      if (_this._mesh.starting) return 30;
      if (_this._mesh.initialized) return 20;
      if (_this._mesh.initializing) return 10;
      return 0;
    },
    // set: function(n) {
    //
    // },
    enumerable: true
  });


  this.initialize = this.initialize; // make function visible in repl (console)
  this.start = this.start;
  this.stop = this.stop;
  this.describe = this.describe;
  this.test = this.test;

  Object.defineProperty(this, 'api', {
    get: function () {
      if (depWarned0) return _this;
      _this.log.warn('Use of mesh.api.* is deprecated. Use mesh.*');
      try {
        _this.log.warn(' - at %s', _this.getCallerTo('mesh.js'));
      } catch (e) {
      }
      depWarned0 = true;
      return _this;
    }
  });
}

// Step1 of two step start with mandatory args (initialize(function Callback(){ start() }))
Mesh.prototype.__initialize = function (config, callback) {

  // TODO: this function is +- 250 lines... (hmmmm)

  var _this = this;

  //so we can redefine properties without failure
  if (_this._mesh.stopped) {
    _this.log.warn('reinitializing previous mesh');
    Internals = require('./system/shared/internals');
    _this._mesh = __protectedMesh(config, _this);
  }

  _this.__events = new EventEmitter();

  _this.on = function (key, handler) {
    return this.__events.on(key, handler);
  }.bind(_this);

  _this.removeListener = function (key, handler) {
    return this.__events.removeListener(key, handler);
  }.bind(_this);

  _this.emit = function (key, value) {
    return this.__events.emit(key, value);
  }.bind(_this);

  _this.startupProgress = function (log, progress) {
    __emit('startup-progress', {"log": log, "progress": progress});
  };

  _this._mesh.initialized = false;
  _this._mesh.initializing = true;

  //util.inherits(this._mesh, EventEmitter);

  _this._mesh.caller = _this.getCallerTo('mesh.js');

  if (typeof config == 'function') {
    callback = config;
    config = _this._mesh.config; // assume config came on constructor
  } else if (!config) {
    config = _this._mesh.config; // again
  } else if (config) {
    _this._mesh.config = config;
  } else {
    config = _this._mesh.config;
  }

  Object.defineProperty(_this, 'version', {
    value: require(__dirname + '/../package.json').version,
    enumerable: true,
  });

  // First mesh in process configures logger
  if (!Logger.configured) Logger.configure(config.util);

  _this.log = Logger.createLogger('Mesh');
  _this.log.context = config.name;

  _this.startupProgress("initializing data layer...", 10);

  //we first need the datalayer up, with a name
  _this._initializeDataLayer(config, function (e) {

    if (e) return callback(e);

    _this.startupProgress("initialized data layer", 50);

    var configer = new Config();

    // Async config step for (ask what i should do)ness <--- functionality pending
    configer.process(_this, config, function (e, config) {

      if (e) return callback(e);

      _this.startupProgress("configured mesh", 55);

      root.nodes[config.name] = _this;

      _this.log.createLogger('Mesh', _this.log);
      _this.log.$$DEBUG('initialize');

      if (!config.home) {
        config.home = config.home || _this._mesh.caller.file ? path.dirname(_this._mesh.caller.file) : null
      }

      if (!config.home) {
        _this.log.warn('home unknown, require() might struggle');
      } else {
        _this.log.info('home %s', config.home);
      }

      // Need to add the caller's module path as first for module searches.
      _this.updateSearchPath(config.home);

      _this.log.info('happner v%s', _this.version);
      _this.log.info('config v%s', (config.version || '..'));
      _this.log.info('localnode \'%s\' at pid %d', config.name, process.pid);


      Object.defineProperty(_this._mesh, 'log', {
        value: _this.log
      });

      if (process.env.START_AS_ROOTED && !config.repl) {
        config.repl = {
          socket: '/tmp/socket.' + config.name
        }
      }

      _this.exchange = {};
      _this.event = {};

      //_this.data = _this._mesh.data;

      // Need to filter access to the data object
      //  eg. $happn.data.pubsub.happn.server.close();
      //   (stops the http server in happn, taking down the whole system)
      // removed for performance cost, we need to hide things in HAPPN

      /*

       [ 'on',
       'off',
       'get',
       'getPaths',
       'set',
       'setSibling',
       'session',
       'remove',
       ].forEach(function(name) {
       Object.defineProperty(_this.data, name, {
       value: function() {
       if (typeof _this._mesh.data[name] == 'function') {
       return _this._mesh.data[name].apply(_this._mesh.data, arguments);
       }
       return _this._mesh.data[name];
       },
       enumerable: name == 'session' ? false : true
       })
       });

       */
      repl.create(_this);

      _this.startupProgress("created repl", 60);

      var stopmesh = function (mesh, last) {
        if (!mesh._mesh.initialized) process.exit(0);
        mesh.stop({exitCode: 0, kill: last}, function (e) {
          mesh._mesh.initialized = false;
          if (e) mesh.log.warn('error during stop', e);
        });
      }

      var pausemesh = function (mesh) {
        mesh.stop(function (e) {
          mesh._mesh.initialized = false;
          if (e) mesh.log.warn('error during stop', e)
        });
      }

      _this.__onUncaughtException = function (err) {
        if (process.env.NO_EXIT_ON_UNCAUGHT) {
          _this.log.error('UNCAUGHT EXCEPTION', err);
          return;
        }
        _this.log.fatal('uncaughtException (or set NO_EXIT_ON_UNCAUGHT)', err);
        process.exit(1);
      };

      _this.__onExit = function (code) {
        Object.keys(root.nodes).forEach(
          function (name) {
            root.nodes[name].stop();
            root.nodes[name].log.info('exit %s', code);
          }
        )
      };

      _this.onSIGTERM = function (code) {
        console.log();
        if (process.env.NO_EXIT_ON_SIGTERM) {
          _this.log.warn('SIGTERM ignored');
          return;
        }
        var last = 0;
        Object.keys(root.nodes).forEach(
          function (name) {
            last++;
            root.nodes[name].log.warn('SIGTERM');
            stopmesh(root.nodes[name], last == Object.keys(root.nodes).length);
          }
        );
      };

      _this.onSIGINT = function () {
        console.log();
        if (process.env.STOP_ON_SIGINT) {
          Object.keys(root.nodes).forEach(
            function (name) {
              root.nodes[name].log.warn('SIGINT without exit');
              pausemesh(root.nodes[name]);
            }
          );
          return;
        }
        var last = 0;
        Object.keys(root.nodes).forEach(
          function (name) {
            last++;
            root.nodes[name].log.warn('SIGINT');
            stopmesh(root.nodes[name], last == Object.keys(root.nodes).length);

          }
        );
      };

      _this.unsubscribeFromProcessEvents = function(logStopEvent){
        try{

          process.removeListener('uncaughtException', _this.__onUncaughtException);
          process.removeListener('exit', _this.__onExit);
          process.removeListener('SIGTERM', _this.onSIGTERM);
          process.removeListener('SIGINT', _this.onSIGINT);

          logStopEvent('$$DEBUG', 'unsubscribed from process events');
        }catch(e){
          logStopEvent('error', 'failed to unsubscribe from process events', e);
          //do nothing
        }
      }

      if (Object.keys(root.nodes).length == 1) {

        // only one listener for each below
        // no matter how many mesh nodes in process

        process.on('uncaughtException', _this.__onUncaughtException);

        process.on('exit', _this.__onExit);

        process.on('SIGTERM', _this.onSIGTERM);

        process.on('SIGINT', _this.onSIGINT);

        // TODO: capacity to reload config! (?tricky?)
        // process.on('SIGHUP', function() {
        //   _this.log.info('SIGHUP ignored');
        // });

      }

      if (!config.modules) config.modules = {};
      if (!config.components) config.components = {};

      // autoload can be set to false (to disable) or alternative configname to load
      if (typeof config.autoload == 'undefined') config.autoload = 'autoload';
      if (typeof config.autoload == 'boolean') {
        if (config.autoload) {
          config.autoload = 'autoload';
        }
      }

      _this.attachSystemComponents(config);

      _this.startupProgress("attached system components", 65);

      async = require("async");

      async.series([
        function (callback) {
          if (!config.autoload || process.env.SKIP_AUTO_LOAD) {
            return callback();
          }
          _this.getPackagedModules(config, callback);
        },
        function (callback) {

          _this.startupProgress("got packaged modules", 70);

          if (!config.autoload || process.env.SKIP_AUTO_LOAD) {
            return callback();
          }
          _this.log.$$DEBUG('searched for autoload');
          _this.loadPackagedModules(config, null, callback);
        },
        function (callback) {

          _this.startupProgress("got autoload modules", 75);

          if (!config.autoload || !process.env.SKIP_AUTO_LOAD) {
            _this.log.$$DEBUG('initialized autoload');
          }
          _this._loadComponentSuites(config, callback);
        },
        function (callback) {

          _this.startupProgress("loaded component suites", 77);

          _this.log.$$DEBUG('loaded component suites');
          _this._registerInitialSchema(config, callback);
        },
        function (callback) {

          _this.startupProgress("registered initial schema", 80);

          _this.log.$$DEBUG('registered initial schema');
          _this._initializePackager(callback);
        },
        function (callback) {
          _this.log.$$DEBUG('initialized packager');

          _this.startupProgress("initialized packager", 82);

          var isServer = true;
          var describe = {};

          Internals._initializeLocal(_this, describe, config, isServer, callback);
        },
        function (callback) {

          _this.startupProgress("initialized local", 86);

          _this.log.$$DEBUG('initialized local');
          _this._initializeElements(config, callback);
        },
        function (callback) {

          _this.startupProgress("initialized elements", 90);

          _this.log.$$DEBUG('initialized elements');
          _this._registerSchema(config, true, callback);
        },
        function (callback) {

          _this.startupProgress("registered schema", 95);

          _this.log.$$DEBUG('registered schema');
          _this._initializeEndpoints(callback);
        },
        function (callback) {

          _this.log.$$DEBUG('initialized endpoints');

          // TODO: This point is never reached if any of the endpoints are hung before writing their description
          //       (https://github.com/happner/happner/issues/21)

          //   Internals._attachProxyPipeline(_this, _this.describe(), Happn, config, callback);
          // },
          // function(callback) {
          //   _this.log.$$DEBUG('attached to proxy pipeline');

          callback();
        }
      ], function (e) {

        if (!e) _this.log.info('initialized!');
        _this._mesh.initialized = true;
        _this._mesh.initializing = false;
        callback(e, _this);

      });
    });
  });
};

Mesh.prototype.initialize = Promise.promisify(function (config, callback) {

  var _this = this;

  if (config.deferListen) {
    if (!config.datalayer)
      config.datalayer = {};
    config.datalayer.deferListen = true;
  }

  _this.__initialize(config, callback);
});

// Step2 of two step start (initialize({},function callback(){ start() }))
Mesh.prototype.start = Promise.promisify(function (callback) {

  var _this = this;

  if (!_this._mesh.initialized) return console.warn('missing initialize()');

  _this._mesh.starting = true;
  _this._mesh.started = false;

  _this.startupProgress("starting mesh", 90);

  var waiting = setInterval(function () {
    Object.keys(_this._mesh.calls.starting).forEach(function (name) {
      _this.log.warn('awaiting startMethod \'%s\'', name);
    });
  }, 10 * 1000);

  var impatient = setTimeout(function () {
    Object.keys(_this._mesh.calls.starting).forEach(function (name) {
      _this.log.fatal('startMethod \'%s\' did not respond', name, new Error('timeout'));
    });
    _this.stop({
      kill: true,
      wait: 200
    })
  }, _this._mesh.config.startTimeout || 60 * 1000);

  _this.__startComponents(function (error) {
    clearInterval(waiting);
    clearTimeout(impatient);
    if (error) return callback(error, _this);

    _this._mesh.starting = false;
    _this._mesh.started = true;
    _this.log.info('started!');

    _this.startupProgress("mesh started", 100);

    callback(null, _this);

  });
});

Mesh.prototype.listen = Promise.promisify(function (options, callback) {
  var _this = this;

  if (typeof options == 'function') {
    callback = options;
    options = {};
  }

  if (!options.times)
    options.times = 10;

  if (!options.interval)
    options.interval = 1000;

  if (!_this._mesh.config.deferListen)
    return callback(new Error('attempt to listen when deferListen is not enabled'));

  async.retry(options, _this._mesh.datalayer.listen, function (e) {
    if (e) return callback(e);
    callback(null, _this);
  });
});

Mesh.prototype.stop = Promise.promisify(function (options, callback) {

  var _this = this;

  if (!_this._mesh.initialized) return;

  _this._mesh.initialized = false;
  _this._mesh.initializing = false;
  _this._mesh.starting = false;
  _this._mesh.started = false;

  // TODO: more thought/planning on runlevels
  //       this stop sets to 0 irrespective of success

  var stopEventLog = [];

  var logStopEvent = function(type, message, data){

    if (!data) data = null;

    stopEventLog.push({"type":type, "message":message, "data":data});

    _this.log[type](message);
  };

  logStopEvent('$$DEBUG', 'initiating stop');

  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  if (options.kill && !options.wait)
    options.wait = 10000;

  var timeout;

  var kill = function () {
    process.exit((typeof options.exitCode == 'number') ? options.exitCode : 1);
  }

  if (options.kill) {
    timeout = setTimeout(function () {
      _this.log.error("failed to stop components, force true");
      kill();
    }, options.wait);
  }

  logStopEvent('$$DEBUG', 'stopping components');

  this.__stopComponents(function (e) {
    //
    // TODO: Only one error!
    //        Multiple components may have failed to stop.

    if (e) {
      // component instance already logged the err
      _this.log.error("failure to stop components");

      /*if (timeout) {

       // Kill is pending.

       // Stop network even tho some components
       // have failed to stop

       // Dont wait for callback.

       console.log(_this._mesh.datalayer);

       _this._mesh.datalayer.server.stop(options, function(e) {

       if (e) return _this.log.error('datalayer stop error', e);

       _this.log.info('datalayer stopped');

       });

       _this.log.warn('datalayer not pending');

       // Give the caller to stop the error,
       // they still some time to do something with it.

       if (callback) return callback(e, _this);

       return;

       }*/

      // Kill is not pending.

      // Some components failed to stop.

      // Dont stop the network.

      // TODO: enable a second call to stop()
      //       that does not stop components that
      //       are already stopped.

      /* _this.log.warn('datalayer not stopped');

       if (callback) return callback(e, _this);

       return;*/

    }

    options.reconnect; // if present, it's being passed into server.stop() below.
                       // causes primus to inform remotes to enter reconect loop

    // All components stopped ok

    logStopEvent('$$DEBUG', 'stopped components');

    logStopEvent('$$DEBUG', 'stopping datalayer');
    _this._mesh.datalayer.server.stop(options, function (e) {

      // Stop the pending kill (if present)
      // clearTimeout(timeout);
      if (e) {

        logStopEvent('error', 'datalayer stop error', e);

        if (options.kill) return kill();
        return;
      }

      logStopEvent('$$DEBUG', 'stopped datalayer');

      if (options.kill) kill();

      delete root.nodes[_this._mesh.config.name];
      //only do this when the stop is clean, we remove this mesh from the meshes collection - if the collection is empty
      // we unsubscribe from the process level events
      if (Object.keys(root.nodes).length == 0)
        _this.unsubscribeFromProcessEvents(logStopEvent);

      logStopEvent('info', 'stopped!');

      _this._mesh.stopped = true;//this state allows for graceful reinitialization

      if (callback) callback(e, _this, stopEventLog);

    });
  });
});

Mesh.prototype.describe = function (cached, componentCached) {

  if (typeof componentCached == 'undefined') componentCached = false;

  if (!this._mesh.config || !this._mesh.config.datalayer) throw new Error('Not ready');
  if (this._mesh.description && cached == true) return this._mesh.description;

  // NB: destroyElement creates endpoint.previousDescription,
  //     which relies on this description being built entirely anew.

  var description = {
    name: this._mesh.config.name,
    // initializing: this._mesh.initializing, // Still true at finel description write.
    // Needs true for remote endpoints to stop
    // waiting in their _initializeEndpoints
    initializing: false,
    components: {},
    setOptions: this._mesh.config.datalayer.setOptions
  };

  for (var componentName in this._mesh.elements) {
    if (this._mesh.elements[componentName].deleted) continue;
    description.components[componentName] = this._mesh.elements[componentName].component.instance.describe(componentCached);
  }

  this._mesh.endpoints[this._mesh.config.name].description = description;
  return this._mesh.description = description;
};

Mesh.prototype.getCallerTo = function (skip) {
  var stack, file, parts, name, result = {};
  var origPrep = Error.prepareStackTrace;
  Error.prepareStackTrace = function (e, stack) {
    return stack;
  }
  try {
    stack = Error.apply(this, arguments).stack;
    stack.shift();
    stack.shift();
    for (var i = 0; i < stack.length; i++) {
      file = stack[i].getFileName();
      line = stack[i].getLineNumber();
      colm = stack[i].getColumnNumber();

      // Since using bluebird some .getFileName()'s are coming up undefined
      if (file) {

        parts = file.split(path.sep);

        // skip calls from the promise implementation

        if (parts.indexOf('bluebird') !== -1) continue;

        if (!skip) {
          result = {
            file: file,
            line: line,
            colm: colm
          };
          break;
        }

        name = parts.pop();

        if (name !== skip) {
          result = {
            file: file,
            line: line,
            colm: colm
          };
          break;
        }
      }
    }
  }
  finally {
    Error.prepareStackTrace = origPrep;
    result.toString = function () {
      return result.file + ':' + result.line + ':' + result.colm
    }
    return result;
  }
};

Mesh.prototype.updateSearchPath = function (startAt) {

  var newPaths = [];

  if (!startAt) return;

  this.log.$$TRACE('updateSearchPath( before ', module.paths);

  var addPath = function (dir) {
    var add = path.normalize(dir + path.sep + 'node_modules');
    if (module.paths.indexOf(add) >= 0) return;
    newPaths.push(add);
  }

  var apply = function (paths) {
    paths.reverse().forEach(function (path) {
      module.paths.unshift(path);
    });
  }

  var recurse = function (dir) {
    addPath(dir);
    var next = path.dirname(dir);
    if (next.length < 2 ||
      (next.length < 4 && next.indexOf(':\\') != -1 )) {
      addPath(next);
      return apply(newPaths);
    }
    recurse(next);
  }

  recurse(startAt);

  this.log.$$TRACE('updateSearchPath( after ', module.paths);
};

Mesh.prototype._initializeDataLayer = function (config, callback) {

  var _this = this;

  DataLayer = require('./system/datalayer')

  _this._mesh.datalayer = DataLayer.create(_this, config,
    function (err, client) {
      if (err) return callback(err, _this);
      _this._mesh.data = client;

      callback(null, _this);
    }
  );
};

Mesh.prototype._initializePackager = function (callback) {
  Packager = require('./system/packager');
  var packager = new Packager(this);
  packager.initialize(callback);
};

Mesh.prototype._initializeElements = function (config, callback) {
  var _this = this;

  return async.parallel(
    Object.keys(config.components).map(function (componentName) {
        return function (callback) {

          var componentConfig = config.components[componentName];
          var moduleName = componentConfig.moduleName || componentConfig.module || componentName;
          componentConfig.moduleName = moduleName; // pending cleanup of .moduleName usage (preferring just 'module')
          var moduleConfig = config.modules[moduleName];

          if (!moduleConfig || moduleName[0] == '@') {
            moduleConfig = config.modules[moduleName] || {};

            // Handle private modules.
            if (componentName[0] == '@') {

              var originalComponentName = componentName;
              var parts = componentName.split('/'); // windows???

              delete config.modules[moduleName];
              delete config.components[componentName];

              componentName = parts[1];
              moduleName = parts[1];

              config.components[componentName] = componentConfig;
              componentConfig.moduleName = moduleName;

              moduleConfig = config.modules[moduleName] || moduleConfig;

              // TODO: resolve issues that arrise since because path needs to sometimes specify ClassName
              //       eg path: '@private/module-name.ClassName'
              if (!moduleConfig.path) {
                moduleConfig.path = originalComponentName;
              }
            }
          }
          else if (!moduleConfig) {
            moduleConfig = config.modules[moduleName] = {};
          }

          return _this._createElement({
            component: {
              name: componentName,
              config: componentConfig,
            },
            module: {
              name: moduleName,
              config: moduleConfig
            }
          }, false, callback);
        }
      }
    ), function (e) {
      callback(e, _this);
    });
};

Mesh.prototype._destroyElement = Promise.promisify(function (componentName, callback) {

  this.log.$$DEBUG('destroying element with component \'%s\'', componentName);

  var cached = true;
  var description = this.describe(cached).components[componentName];
  var element = this._mesh.elements[componentName];
  var endpointName = this._mesh.config.name;
  var endpoint = this._mesh.endpoints[endpointName];
  var queue = this._mesh.destroyingElementQueue = this._mesh.destroyingElementQueue || [];
  var config = this._mesh.config;

  var _this = this;
  async.series([

    // (Queue) Only allow 1 destroy at a time.
    // - gut feel, might not be necesssary.
    function (done) {
      var interval;
      if (_this._mesh.destroyingElement) {
        queue.push(componentName);
        interval = setInterval(function () {               // ensure deque in create order
          if (!_this._mesh.destroyingElement && queue[0] == componentName) {
            clearInterval(interval);
            queue.shift();
            _this._mesh.destroyingElement = componentName;
            done(); // proceed
          }
        }, 200);
        return;
      }
      _this._mesh.destroyingElement = componentName;
      done();
    },

    function (done) {
      endpoint.previousDescription = endpoint.description;

      var writeSchema = true; // transmit description to subscribers
      // (browsers, other mesh nodes)

      element.deleted = true; // flag informs describe() to no longer list
      // the element being destroyed
      _this._registerSchema(config, writeSchema, done);
    },

    // TODO: Wait for clients/browser to remove functionality
    // from their APIs (per new descripition).
    //
    // Necessary?
    //
    // Is there a simple/'network lite' way to know
    // when they are all done?
    function (done) {
      done();
    },

    // Unclear... Question:
    //
    // - Should the component stopMethod be called before or after detatching it from the mesh.
    // - Similar to startMethod, i think the case can be made for both. Suggesting 2 kinds of
    //   stopMethods:
    //
    //         beforeDetach: can still tell clients
    //         afterDetatch: final cleanup,
    //                       no longer clients present to affect state/data during cleanup
    //
    // Decided to put it after detatch for now. It can still 'talk' to other mesh components
    // viw $happn, but other mesh components can no longer talk to it through $happn
    //
    // // Stop the component.
    // function(done) {
    //   done();
    // },

    function (done) {
      Internals._updateEndpoint(_this, endpointName, _this.exchange, _this.event, done);
    },

    function (done) {
      _this._mesh.elements[componentName].component.instance._detatch(_this._mesh, done);
      done();
    },

    function (done) {
      // TODO: Unregister from security,
      // TODO: Remove registered events and data paths.
      done();
    },

    // Stop the component if it was started and has a stopMethod
    function (done) {
      if (!_this._mesh.started) return done();
      if (!element.component.config.stopMethod) return done();
      _this._eachComponentDo({
        methodCategory: 'stopMethod',
        targets: [componentName],
        logAction: 'stopped'
      }, done);
    },

    function (done) {
      delete _this._mesh.elements[componentName];
      // TODO: double-ensure no further refs remain
      //
      //  ie. Rapidly adding and removing components is a likely use case.
      //      All refs must be gone for garbage collection
      //
      done();
    },

  ], function (e) {
    delete _this._mesh.destroyingElement; // done, (interval above will proceed)
    callback(e);
  });
});

Mesh.prototype._createElement = Promise.promisify(function (spec, writeSchema, callback) {
  var _this = this;
  var config = _this._mesh.config;
  var endpointName = _this._mesh.config.name;

  if (typeof writeSchema == 'function') {
    callback = writeSchema;
    writeSchema = true;
  }

  _this.log.$$TRACE('_createElement( spec', spec);
  _this.log.$$DEBUG(
    'creating element with component \'%s\' on module \'%s\' with writeSchema %s',
    spec.component.name,
    spec.module.name,
    writeSchema
  );
  async.series([
    function (done) {
      _this._createModule(spec, done);
    },
    function (done) {
      _this._happnizeModule(spec, done);
    },
    function (done) {
      _this._originizeModule(spec, done);
    },
    function (done) {
      _this._createComponent(spec, done);
    },
    function (done) {
      if (_this._mesh.initialized) {
        // Don't publish the schema if the mesh is already running
        // because then clients get the description update (new component)
        // before the component has been started.
        //
        // It is still necessary to refresh the description to that the
        // api can be built for the new component.
        //
        return _this._registerSchema(config, false, done);
      }
      _this._registerSchema(config, writeSchema, done);
    },
    function (done) {
      Internals._updateExchangeAPILayer(_this, endpointName, _this.exchange, done);
    },
    function (done) {
      Internals._updateEventAPILayer(_this, endpointName, _this.event, done);
    },
    function (done) {

      if (!_this._mesh.started) return done();

      // New component, mesh already started

      if (!spec.component.config.startMethod) return done();

      _this._eachComponentDo({
        methodCategory: 'startMethod',
        targets: [spec.component.name], // only start this component
        logAction: 'started'
      }, done);

    },
    function (done) {
      if (_this._mesh.initialized) {

        // component has started, publish schema

        return _this._registerSchema(config, writeSchema, done);
      }
      done();
    }

  ], function (e) {
    callback(e)
  });
});

Mesh.prototype._createModule = function (spec, callback) {

  // NB: If this functionality is moved into another module the
  //     module.paths (as adjusted in updateSearchPath(caller))
  //     will need to be done in the new module.
  //
  //     Otherwise the require() won't search from the caller's
  //     perspective

  var _this = this;

  var moduleName = spec.module.name;
  var moduleConfig = spec.module.config;

  //
  // if (spec.module.config.packageName && this._mesh.config.packaged[spec.module.config.packageName])
  //   spec.module.packaged = this._mesh.config.packaged[spec.module.config.packageName];
  //
  //  spec.module.packaged    isn't used anywhere...
  //

  var modulePath;
  var moduleBasePath;
  var pathParts;
  var callbackIndex = -1;
  var moduleInstance;
  var moduleBase;
  var ignore;
  var home;

  if (moduleConfig.instance) {
    moduleConfig.home = moduleConfig.home || '__NONE__';
    moduleBase = moduleConfig.instance;
    home = moduleConfig.home;
  }

  if (!moduleConfig.path) moduleConfig.path = moduleName;

  try {

    modulePath = moduleConfig.path;

    if (moduleConfig.path.indexOf('system:') == 0) {
      pathParts = moduleConfig.path.split(':');
      modulePath = __dirname + '/modules/' + pathParts[1];
    }

    if (!home) {

      try {

        var dirName = path.dirname(modulePath);
        var baseName = path.basename(modulePath);

        baseName.replace(/\.js$/, '').split('.').map(function (part, ind) {

          if (ind == 0) {

            if (dirName == '.' && modulePath[0] != '.') {
              moduleBasePath = part;
            } else {
              moduleBasePath = part = dirName + path.sep + part;
            }
            _this.log.$$TRACE('requiring module %s', modulePath);
            moduleBase = require(part);
          }
          else
            moduleBase = moduleBase[part];

        });

      } catch (e) {
        try {
          _this.log.$$TRACE('alt-requiring module happner-%s', modulePath);
          moduleBase = require('happner-' + modulePath);
          moduleBasePath = 'happner-' + modulePath;
        } catch (f) {
          _this.log.$$TRACE('alt-requiring happner-%s failed', modulePath, f);
          throw e
        }
      }
    }

    home = home || path.dirname(require.resolve(moduleBasePath));
    Object.defineProperty(spec.module, 'directory', {
      get: function () {
        if (depWarned3) return home;
        _this.log.warn('Use of module.directory is deprecated. Use module.home');
        try {
          _this.log.warn(' - at %s', _this.getCallerTo('mesh.js'));
        } catch (e) {
        }
        depWarned3 = true;
        return home;
      }
    });

    Object.defineProperty(spec.module, 'home', {
      get: function () {
        return home;
      }
    });

  } catch (e) {
    return callback(e);
  }

  var getParameters = function () {
    try {
      var parameters = (moduleConfig.construct || moduleConfig.create).parameters;
      return parameters.map(function (p, i) {
        if (p.parameterType == 'callback') {
          callbackIndex = i;
          return;
        }
        if (p.value) return p.value;
        else return null
      });
    } catch (e) {
      return [];
    }
  }

  var errorIfNull = function (module) {
    if (!module) {
      _this.log.warn('missing or null module \'%s\'', moduleName);
      return {};
    }
    return module;
  }

  var parameters = getParameters();

  if (moduleConfig.construct) {

    _this.log.$$TRACE('construct module \'%s\'', moduleName);

    if (moduleConfig.construct.name)
      moduleBase = moduleBase[moduleConfig.construct.name];

    try {
      moduleInstance = new (Function.prototype.bind.apply(moduleBase, [null].concat(parameters)));
      spec.module.instance = errorIfNull(moduleInstance);
    } catch (e) {
      _this.log.error('error constructing \'%s\'', moduleName, e);
      return callback(e);
    }
    return callback();

  }

  if (moduleConfig.create) {

    _this.log.$$TRACE('create module \'%s\'', moduleName);

    if (moduleConfig.create.name)
      moduleBase = moduleBase[moduleConfig.create.name];

    if (moduleConfig.create.type != 'async') {
      var moduleInstance = moduleBase.apply(null, parameters);
      spec.module.instance = errorIfNull(moduleInstance);
      return callback();
    }

    var constructorCallBack = function () {
      var callbackParameters;
      try {
        callbackParameters = moduleConfig.create.callback.parameters;
      } catch (e) {
        callbackParameters = [
          {parameterType: 'error'},
          {parameterType: 'instance'}
        ];
      }

      for (var index in arguments) {
        var value = arguments[index];

        var callBackParameter = callbackParameters[index];
        if (callBackParameter.parameterType == 'error' && value) {
          return callback(new MeshError('Failed to construct module: ' + moduleName, value));
        }

        if (callBackParameter.parameterType == 'instance' && value) {
          spec.module.instance = errorIfNull(value);
          return callback();
        }
      }
    }

    if (callbackIndex > -1) parameters[callbackIndex] = constructorCallBack;
    else parameters.push(constructorCallBack);

    return moduleBase.apply(moduleBase, parameters);
  }


  if (typeof moduleBase == 'function') {

    _this.log.$$TRACE('construct/create module \'%s\'', moduleName);

    try {
      moduleInstance = new (Function.prototype.bind.apply(moduleBase, [null].concat(parameters)));
    } catch (e) {
      _this.log.error('error construct/creating \'%s\'', moduleName, e);
      return callback(e);
    }

    spec.module.instance = errorIfNull(moduleInstance);
    return callback();
  }

  _this.log.$$TRACE('assign module \'%s\'', moduleName);

  spec.module.instance = errorIfNull(moduleBase);

  return callback();
};

Mesh.prototype._happnizeModule = function (spec, callback) {

  var args, happnSeq, originalFn;
  var module = spec.module.instance;

  for (var fnName in module) {
    originalFn = module[fnName];
    if (typeof originalFn !== 'function') continue;

    args = utilities.getFunctionParameters(originalFn);
    happnSeq = args.indexOf('$happn');
    if (happnSeq < 0) continue;

    Object.defineProperty(module[fnName], '$happnSeq', {value: happnSeq});
  }

  callback(null);
};

Mesh.prototype._originizeModule = function (spec, callback) {

  var args, originSeq, originalFn;
  var module = spec.module.instance;

  for (var fnName in module) {
    originalFn = module[fnName];
    if (typeof originalFn !== 'function') continue;

    args = utilities.getFunctionParameters(originalFn);
    originSeq = args.indexOf('$origin');
    if (originSeq < 0) continue;

    Object.defineProperty(module[fnName], '$originSeq', {value: originSeq});
  }

  callback(null);
};

Mesh.prototype._createComponent = function (spec, callback) {

  var _this = this;

  var config = _this._mesh.config;
  var componentName = spec.component.name;
  var componentConfig = spec.component.config;

  var componentInstance = new ComponentInstance();

  if (!componentConfig.meshName)
    Object.defineProperty(componentConfig, 'meshName', {
      get: function () {
        if (depWarned1) return config.name;
        _this.log.warn('use of $happn.config.meshName is deprecated, use $happn.info.mesh.name');
        try {
          _this.log.warn(' - at %s', _this.getCallerTo('mesh.js'));
        } catch (e) {
        }
        depWarned1 = true;
        return config.name;
      }
    });

  if (!componentConfig.setOptions)
    Object.defineProperty(componentConfig, 'setOptions', {
      get: function () {
        if (depWarned2) return config.datalayer.setOptions;
        _this.log.warn('use of $happn.config.setOptions is deprecated, use $happn.info.datalayer.options');
        try {
          _this.log.warn(' - at %s', _this.getCallerTo('mesh.js'));
        } catch (e) {
        }
        depWarned2 = true;
        return config.datalayer.setOptions;
      }
    });

  _this.log.$$TRACE('created component \'%s\'', componentName, componentConfig);

  _this._stats.component[componentName] = {errors: 0, calls: 0, emits: 0};
  componentInstance.stats = _this._stats;  // TODO?: rather let the stats collector component
  //         have accessLevel: 'mesh' (config in component)
  //          and give each component it's own private stats store

  var __addComponentDataStoreRoutes = function (meshConfig, componentConfig) {

    if (!componentConfig.data || !componentConfig.data.routes) return;

    for (var route in componentConfig.data.routes) {
      var componentRoute = '/_data/' + componentName + '/' + route.replace(/^\//, '');
      _this._mesh.datalayer.server.services.data.addDataStoreFilter(componentRoute, componentConfig.data.routes[route]);
    }

  }.bind(_this);

  //TODO - we need to remove routes somewhere too:

  // var __removeComponentDataStoreRoutes = function(meshConfig, componentConfig){

  //   if (componentConfig.data &&
  //       meshConfig.data &&
  //       meshConfig.data.persist){//persist is set to true if datalayer.filename is set, or is also explicitly set

  //     for (var route in componentConfig.data.routes){
  //       var componentRoute = '/_data/' + componentName + '/' + route.replace(/^\//,'');
  //       console.log('adding route:::', componentRoute);
  //       this._mesh.datalayer.server.services.data.removeDataStoreFilter(componentRoute, componentConfig.data.routes[route]);
  //     }

  //   }

  // }.bind(_this);


  componentInstance.initialize(
    componentName,
    root,
    _this,
    spec.module,
    componentConfig,
    function (e) {
      if (e) return callback(e);

      __addComponentDataStoreRoutes(config, componentConfig);

      spec.component.instance = componentInstance;
      _this._mesh.elements[componentName] = spec;
      callback();

    }
  );
};

Mesh.prototype._registerInitialSchema = function (config, callback) {

  // The datalayer is up and waiting for connections before there has been any
  // description written, remote mesh nodes or clients that attach after
  // the datalater init but before the schema is registered get a null description
  // and become dysfunctional.
  //
  // This registers an initial description marked with initializing = true,
  // the remote has subscribed to further description updates from here, so
  // it will receive the full description (initializing = false) as soon as this
  // meshnode completes it's initialization.
  //
  // The remote does not callback from it's _initializeEndpoints until a full
  // description from each endpoint has arrived there.
  //
  //
  // This is to ensure that ALL functionality EXPECTED by the remote on it's
  // endpoint is present and ready at callback (that no component on the remote
  // is still loading)
  //
  //
  // This above behaviour needs to be configurable.
  // ----------------------------------------------
  //
  //
  // As it stands if all meshnodes start simultaneously, then each takes as
  // long as it's slowest endpoint to callback from initialize()
  //

  // Cannot use this.description(), it requires bits not present yet

  var _this = this;

  var description = {
    initializing: true,
    name: _this._mesh.config.name,
    components: {},
  };

  _this._mesh.data.set('/mesh/schema/description', description, function (e, response) {
    if (e) return callback(e);

    _this._mesh.data.set('/mesh/schema/config', _this._filterConfig(config), function (e, response) {

      callback(e);
    });
  });
};

Mesh.prototype._filterConfig = function (config) {
  // remove direct instance definitions from config,
  // they could contain circles of $vars,
  // unfortunately a deep copy is necessary because the original config need to remain

  var copy = JSON.parse(JSON.stringify(config));

  Object.keys(copy.modules).forEach(function (moduleName) {
    delete copy.modules[moduleName].instance;
  });
  return copy;
};

Mesh.prototype._registerSchema = function (config, writeSchema, callback) {

  // - writeSchema is set to false during intialization as each local component
  //   init calls through here to update the description ahead of it's API
  //   initializations.
  //
  // - This prevents a write to the datalayer for every new component.
  //
  // - New components added __during runtime__ using createElement() call
  //   through here with write as true so that the description change
  //   makes it's way to clients and other attached nodes.
  //

  var _this = this;
  var description = _this.describe(false, true);
  // Always use the cached component descriptions
  // to alleviate load as this function gets called
  // for every local component initialization

  _this.log.$$TRACE('_registerSchema( description with name: %s', description.name, writeSchema ? description : null);

  if (!writeSchema) return callback();

  // TODO: only write if there actually was a change.
  _this._mesh.data.set('/mesh/schema/description', description, function (e, response) {

    if (e) return callback(e);
    _this._mesh.data.set('/mesh/schema/config', _this._filterConfig(config), function (e, response) {
      callback(e);
    });
  });
};

Mesh.prototype._initializeEndpoints = function (callback) {

  var _this = this;
  var config = _this._mesh.config;

  // Externals
  var exchangeAPI = _this.exchange = (_this.exchange || {});
  var eventAPI = _this.event = (_this.event || {});

  // Internals
  _this._mesh = _this._mesh || {};

  _this._mesh.exchange = _this._mesh.exchange || {};

  async.parallel(Object.keys(config.endpoints).map(function (endpointName) {

    // return array of functions for parallel([])

    return function (done) {

      _this.log.$$DEBUG('initialize endpoint \'%s\'', endpointName);

      var calledBack = false;
      var endpointConfig = config.endpoints[endpointName];
      endpointConfig.config = endpointConfig.config || {};

      _this.log.$$TRACE('Happn.client.create( ', endpointConfig);

      endpointConfig.info = endpointConfig.info || {};
      endpointConfig.info.mesh = endpointConfig.info.mesh || {};
      endpointConfig.info.mesh.name = endpointConfig.info.mesh.name || _this._mesh.config.name;

      // TODO: Shouldn't this rather use MeshClient instead of happn.client directly.
      // TODO: Configurable 'wait time' for full description
      // TODO: Configurable stop or carry-on-regardless on timeout

      if (!endpointConfig.config.keyPair)
        endpointConfig.config.keyPair = _this._mesh.datalayer.server.services.security._keyPair;

      Happn.client.create(endpointConfig, function (error, client) {

        var description;

        if (error) {
          _this.log.error('failed connection to endpoint \'%s\'', endpointName, error);
          return done(error);
        }

        client.__endpointConfig = endpointConfig;
        client.__endpointName = endpointName;

        //attach to the happn clients connection status events, the data is bubbled up through mesh events
        client.onEvent('connection-ended', function (eventData) {
          _this.emit('endpoint-connection-ended', {endpointConfig:this.__endpointConfig, endpointName:this.__endpointName, eventData:eventData});
        }.bind(client));

        client.onEvent('reconnect-scheduled', function (eventData) {
          _this.emit('endpoint-reconnect-scheduled', {endpointConfig:this.__endpointConfig, endpointName:this.__endpointName, eventData:eventData});
        }.bind(client));

        client.onEvent('reconnect-successful', function (eventData) {
          _this.emit('endpoint-reconnect-successful', {endpointConfig:this.__endpointConfig, endpointName:this.__endpointName, eventData:eventData});
        }.bind(client));

        var interval;
        var buzy = false;
        var initialize = function () {

          if (buzy) return; // Really slow devices, ensure one initialization attempt at a time.

          buzy = true;

          // Repeats a get instead of subscribing, to defend against the very unlikelyhood
          // that the final description from the endpoint publish message gets lost on the
          // nework.
          //
          // Also performs a subscription, for immediate and latter description updates from
          // the remote.

          client.get('/mesh/schema/description', {}, function (error, description) {
            if (error) {
              buzy = false;
              clearInterval(interval); // stop retrying... ??
              _this.log.error('failed getting description from \'%s\'', endpointName, error);
              if (!calledBack) {
                calledBack = true;
                return done(error);
              }
              return;
            }

            try {

              if (endpointName !== description.name) {
                _this.log.warn('endpoint \'%s\' returned description for \'%s\'', endpointName, description.name);
              }

              if (description.initializing) {
                _this.log.warn('awaiting remote initialization at \'%s\'', endpointName);
                buzy = false;
                return;
              }

              update(description);

            } catch (error) {
              _this.log.warn('Malformed describe from mesh \'%s\' ignored.', endpointName, error);
            }
          });
        }

        interval = setInterval(initialize, 2000); // TODO: configurable inteval
                                                  // TODO: configurable give up time
                                                  //       (currently endless...)

        initialize();

        var update = function (description) {
          _this.log.$$DEBUG('updating endpoint \'%s\'', endpointName);

          clearInterval(interval);

          _this.log.$$TRACE('got description from endpoint \'%s\'', endpointName, description);

          if (!_this._mesh.endpoints[endpointName]) {
            _this._mesh.endpoints[endpointName] = {
              "data": client,
              "name": endpointName
            }
          }

          var endpoint = _this._mesh.endpoints[endpointName];
          endpoint.previousDescription = endpoint.description;
          endpoint.description = description;

          Internals._updateEndpoint(_this, endpointName, exchangeAPI, eventAPI, function (e) {
            buzy = false;

            if (e) {
              if (!calledBack) {
                calledBack = true;
                return done(error);
              }
              _this.log.error('failed to update endpoint \'%s\'', endpointName, e);
              return;
            }

            if (!calledBack) {
              _this.log.info('initialized endpoint \'%s\'', endpointName);
              calledBack = true;
              return done();
            }

            _this.log.info('updated endpoint \'%s\'', endpointName);
          });
        }


        client.on('/mesh/schema/description',
          update, // <------ the function.
          function (e) {
            if (e) {
              if (!calledBack) {
                calledBack = true;
                return callback(e);
              }
              _this.log.error('failed description subscription to \'%s\'', endpointName, e);
            }
          }
        );
      });
    }
  }), function (e) {
    callback(e, _this);
  });
};

Mesh.prototype._eachComponent = function (targets, flow, operator, callback) {
  var _this = this;
  async[flow](
    Object.keys(this._mesh.elements)

      .filter(function (componentName) {
        return targets.indexOf(componentName) != -1;
      })

      .map(function (componentName) {
        return function (done) {
          var component = _this._mesh.elements[componentName].component;
          operator(componentName, component, done);
        }
      }),

    function (e) {
      callback(e, _this);
    }
  )
};

Mesh.prototype._eachComponentDo = function (options, callback) {

  if (!options.methodCategory && !options.methodName)
    return callback(new MeshError("methodName or methodCategory not included in options"));

  if (!options.flow) options.flow = 'series';
  if (!options.targets) options.targets = Object.keys(this._mesh.elements);

  var calls, _this = this;

  this._mesh.calls = this._mesh.calls || {};
  this._mesh.calls.starting = calls = {};

  this._eachComponent(options.targets, options.flow, function (componentName, component, done) {

    var call, config = component.config;

    if (options.methodCategory)
      options.methodName = config[options.methodCategory];

    if (!options.methodName) {
      return done(); // error?
    }

    call = componentName + '.' + options.methodName + '()';

    // default assume async with no args and callback as (error){} only
    if (!config.schema || !config.schema.methods || !config.schema.methods[options.methodName]) {

      calls[call] = Date.now();
      _this.log.$$DEBUG('calling %s \'%s\' as default async', options.methodCategory, call);
      return component.instance.operate(options.methodName, [], function (e, responseArgs) {
        delete calls[call];
        if (e) return done(e);
        if (options.logAction) {
          _this.log.info('%s component \'%s\'', options.logAction, componentName);
        }
        done.apply(_this, responseArgs);
      });
    }

    var methodConfig = config.schema.methods[options.methodName];
    var methodParameters = (
      methodConfig.parameters ? methodConfig.parameters : []
    ).map(function (p) {
        return p.value;
      })
      .filter(function (p) {
        // Assumes startMthod and stopMethod schema either defines values
        // or are optional. Filter out undefines.
        // IMPORTANT because otherwise method receives (undefined, undefined, undefined, callback)
        return typeof p !== 'undefined';
      });


    if (methodConfig.type == "sync") {
      try {
        _this.log.$$DEBUG('calling %s \'%s\' as configured sync', options.methodCategory, call);
        component.instance.operate(options.methodName, methodParameters);
        if (options.logAction) {
          _this.log.info('%s component \'%s\'', options.logAction, componentName);
        }
        done();
      } catch (e) {
        done(new Error(e));
      }
      return;
    }

    calls[call] = Date.now();
    _this.log.$$DEBUG('calling %s \'%s\' as configured async', options.methodCategory, call);
    component.instance.operate(options.methodName, methodParameters, function (e, responseArgs) {
      delete calls[call];
      if (e) return done(e);
      if (options.logAction) {
        _this.log.info('%s component \'%s\'', options.logAction, componentName);
      }
      done.apply(_this, responseArgs);
    });

  }, function (e) {
    callback(e, _this);
  });
};

Mesh.prototype.__startComponents = function (callback) {
  this.log.$$DEBUG('start');
  this._eachComponentDo({
    methodCategory: 'startMethod',
    flow: 'series',
    logAction: 'started'
  }, callback);
};

Mesh.prototype.__stopComponents = function (callback) {
  this.log.$$DEBUG('stopping');
  this._eachComponentDo({
    methodCategory: 'stopMethod',
    flow: 'parallel',
    logAction: 'stopped'
  }, callback);
};

Mesh.prototype.__supplementSuites = function (packaged, suite, moduleName, match) {

  if (!Array.isArray(suite)) suite = [suite];

  var seq = 0;

  var error;

  suite.forEach(function (elementConfig) {

    if (error) return;

    if (!elementConfig.component) {
      error = new Error('Missing component in elementConfig');
      return;
    }

    if (!elementConfig.component.name) {
      if (seq == 0) {

        // First element in the suite name defaults from containing module dirname
        // elementConfig.component.name = parts.slice(-2).shift();
        elementConfig.component.name = moduleName;
      }
      else {

        // All other elements error if not name is specified,
        error = new Error('Missing component name in elementConfig');
        return;
      }
    }

    elementConfig.module = elementConfig.module || {}
    elementConfig.module.name = elementConfig.module.name || elementConfig.component.name;
    elementConfig.module.config = elementConfig.module.config || {};

    elementConfig.component.config = elementConfig.component.config || {};

    if (!elementConfig.component.config.module || elementConfig.component.config.moduleName) {
      elementConfig.component.config.moduleName = elementConfig.module.name;
    }

    elementConfig.packageName = elementConfig.component.name;

    if (match) {

      if (!match.base) { // a node module not nested onto the root of one of the modulePaths
        // ie. deep inside, needs path

        if (!elementConfig.module.config.path) {

          elementConfig.module.config.path = match.filename.replace('/happner.js', '');
        }
      }
    }

    packaged[elementConfig.packageName] = elementConfig;

    seq++;

  });

  return error;
};

/*
 We match happner.js files to modules, by id (so same as npm install id) - if the modules dont autoload,
 their packaged settings are still available in config.packaged - and get handed to them when the module
 is instantiated and control is passed over to the componentInstance
 */
Mesh.prototype.getPackagedModules = function (config, callback) {

  var _this = this;

  if (!config.packaged) config.packaged = {};
  path = require('path');
  // using local path (see .updateSearchPath())
  utilities.findInModules('happner.js', module.paths,
    function (e, matches) {

      // Matches are returned sorted deepest to shallowest, so that shallowest are
      // processed last and therefore overwrite into config.packaged[packageName] so
      // that the shallowest packages are used.
      //

      // Pending, there is a version available,
      //
      //  - use most recent??
      //
      //  - what to do on major version collide?
      //  - what to do on different configs for the same autoloaded module?

      if (e) return callback(e);

      var error;

      var promise = Promise.map(matches, function (match) {

        if (error) return;

        var happnerFile = match.filename;
        var moduleName = match.moduleName;
        // var version = match.version; // <---------- not yet used...
        // var parts = match.parts;

        var happnerConfig = require(happnerFile);

        if (!happnerConfig.configs) {
          error = new Error('Missing happner.js(.configs) in ' + happnerFile);
          return;
        }

        var suite = happnerConfig.configs[config.autoload];

        if (!suite) {
          // No autoload. That's fine.
          return;
        }

        if (typeof suite == 'function') {
          return suite(config).then(function (suite) {
            error = _this.__supplementSuites(config.packaged, suite, moduleName, match);
          });
        }

        error = _this.__supplementSuites(config.packaged, suite, moduleName, match);

      });

      promise.then(function () {
        callback(error);
      });

      promise.catch(function (e) {
        if (error) return callback(error);
        callback(e);
      });
    });
};

Mesh.prototype.loadPackagedModules = function (config, packaged, callback) {

  for (var packageName in packaged || config.packaged) {
    //
    // TODO: sometimes load order is important

    var loadConfig = (packaged || config.packaged)[packageName];

    if (loadConfig) {

      // Shallow merge autoload config (keeping original where present)

      var loadModule = loadConfig.module.config;
      var loadModName = loadConfig.module.name;
      var existingModule = config.modules[loadModName] = config.modules[loadModName] || {};

      Object.keys(loadModule).forEach(function (key) {
        if (typeof existingModule[key] !== 'undefined') return 'dont replace';
        existingModule[key] = loadModule[key];
      });


      var loadComponent = loadConfig.component.config;
      var loadCompName = loadConfig.component.name;
      var existingComponent = config.components[loadCompName] = config.components[loadCompName] || {};

      Object.keys(loadComponent).forEach(function (key) {
        if (key == 'module' || key == 'moduleName') {
          // config support component.module or component.moduleName
          if (typeof existingComponent.module !== 'undefined') return;
          if (typeof existingComponent.moduleName !== 'undefined') return;
        }
        if (typeof existingComponent[key] !== 'undefined') return;
        existingComponent[key] = loadComponent[key];
      });
    }
  }
  callback();
}

Mesh.prototype._loadComponentSuites = function (config, callback) {

  if (!config.components) return callback();

  var _this = this;

  var packaged = {};

  var error;

  Promise.map(Object.keys(config.components), function (name) {

      if (error) return;

      var component = config.components[name];
      var suiteName, fallbackSuiteName;
      var passthroughFunction;

      if (!component.$config && !component.$configure) return;

      if (component.$config) {
        if (typeof component.$config !== 'string') return;
        suiteName = component.$config;
        delete component.$config;
      }

      if (component.$configure) {
        if (typeof component.$configure !== 'function') return;
        passthroughFunction = component.$configure;
        delete component.$configure;
        suiteName = utilities.getFunctionParameters(passthroughFunction)[0];
        fallbackSuiteName = suiteName;
        var changeCase = require('change-case');
        if (suiteName) suiteName = changeCase.paramCase(suiteName);
      }

      // determine module path

      var moduleName = component.module || component.moduleName || name;
      var modulePath = typeof config.modules == 'undefined' ? moduleName :
        typeof config.modules[moduleName] == 'undefined' ? moduleName :
          typeof config.modules[moduleName].path == 'undefined' ? moduleName :
            config.modules[moduleName].path;

      // module.path could define <path>.ClassName

      var parts = modulePath.split(path.sep);
      var last = parts.pop();
      last = last.split('.').shift();
      parts.push(last);
      modulePath = parts.join(path.sep);

      // load happner file from module path and pull out specified config suite

      var resolved, happnerFile, suite;

      try {
        resolved = require.resolve(modulePath);
      } catch (e) {
        _this.log.error('cannot resolve module for component: \'%s\', config suite: \'%s\'', name, suiteName, e);
        throw e;
      }

      happnerFile = path.dirname(resolved) + path.sep + 'happner.js';
      _this.log.$$DEBUG('loading suite from \'%s\'', happnerFile);

      try {
        suite = require(happnerFile).configs[suiteName];
        if (!suite) {
          if (!fallbackSuiteName) throw new Error('undefined suite ' + suiteName);
          // with $configure function arg 'thisName' could mean 'thisName' or 'this-name'
          // fall back to the former
          suite = require(happnerFile).configs[fallbackSuiteName];
          if (!suite) throw new Error('undefined suite ' + suiteName);
        }
      } catch (e) {
        _this.log.error('cannot load config suite: \'%s\' from happner file: \'\'', suiteName, happnerFile, e);
        throw e;
      }

      if (typeof suite == 'function') {
        var promise = suite(config);

        // if suite factory function returned a promise
        if (promise && typeof promise.then == 'function') {
          return promise.then(function (suite) {

            if (suite && passthroughFunction) {
              // deepcopy so that $configure passthrough does not modify original
              suite = passthroughFunction(JSON.parse(JSON.stringify(suite))); // TODO: confirm it's the fastest deepcopy
              if (!suite) throw new Error('$configure function returned nothing');
            }

            if (!suite) throw new Error('empty suite return by \'' + suiteName + '\' in component \'' + name + '\'');

            // if passthrough returned a promise
            if (typeof suite.then == 'function') {
              return suite.then(function (suite) {
                if (!suite) throw new Error('empty suite from $configure \'' + suiteName + '\' in component \'' + name + '\'');
                if (suite[0]) delete suite[0].component.name
                else delete suite.component.name;
                error = _this.__supplementSuites(packaged, suite, name, null);
              });
            }

            // delete component name from first element in sute so that
            // __supplementSuites defaults the name to 'name' passed in.
            // This is so that a component defined in the mesh config
            // can use a suite in the happner.js file without having
            // the same name as the suite's first element.
            if (suite[0]) delete suite[0].component.name
            else delete suite.component.name;
            error = _this.__supplementSuites(packaged, suite, name, null);
          });
        }

        suite = promise;
      }

      if (suite && passthroughFunction) {
        suite = passthroughFunction(JSON.parse(JSON.stringify(suite)));

        if (!suite) throw new Error('empty suite from $configure \'' + suiteName + '\' in component \'' + name + '\'');

        // if passthrough returned a promise
        if (typeof suite.then == 'function') {
          return suite.then(function (suite) {
            if (!suite) throw new Error('empty suite from $configure \'' + suiteName + '\' in component \'' + name + '\'');
            if (suite[0]) delete suite[0].component.name
            else delete suite.component.name;
            error = _this.__supplementSuites(packaged, suite, name, null);
          });
        }
      }

      if (!suite) throw new Error('empty suite \'' + suiteName + '\' in component \'' + name + '\'');

      if (suite[0]) delete suite[0].component.name;
      else delete suite.component.name;
      error = _this.__supplementSuites(packaged, suite, name, null);
    })

    .then(function (componentPackages) {

      if (error) throw error;
      _this.loadPackagedModules(config, packaged, callback)

    })

    .catch(callback);
};

Mesh.prototype.attachSystemComponents = function (config) {

  //set up the modules

  config.modules.api = {
    path: "system:api"
  };

  config.modules.security = {
    path: "system:security"
  };

  config.modules.system = {
    path: "system:system"
  };

  config.modules.data = {
    path: "system:data"
  };

  //create a container for the component configurations

  var mergedComponentConfig = {};

  //add the system ones first

  mergedComponentConfig.security = {
    accessLevel: 'mesh',
    startMethod: 'initialize',
  }

  mergedComponentConfig.api = {
    web: {
      routes: {
        "client": "client"
      }
    }
  };

  mergedComponentConfig.system = {
    accessLevel: 'mesh',
    startMethod: 'initialize',
  }

  //iterate through the configured app-land components - add to the merged configuration

  for (var componentKey in config.components)
    mergedComponentConfig[componentKey] = config.components[componentKey];

  //set the config to the merged config - containing the system components ordered first
  config.components = mergedComponentConfig;

}

//if we are running this mesh in test mode, we iterate through the tests and run them, to return a test report
Mesh.prototype.test = function (callback) {

};

