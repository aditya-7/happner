[&#9664;](modules.md) modules and components | event api [&#9654;](event.md)

## Autoloading and Defaulting

* [happner.js file format](#happnerjs-file-format)
* [Startup Autoloader](#startup-autoloader)
* [Using Specific Configs](#using-specific-configs)


Modules can be packaged with a configuration file (`happner.js`) that is used by the loading MeshNode to default or autoload elements into the mesh.

The `happner.js` file should be placed into the module's root.

eg. (typical node_module with happner.js file)

```
lib/*
node_modules/*
index.js
package.json
happner.js
```

### happner.js file format

The `happner.js` can define an assortment of configs. Each config should define an element, or suite of elements, or function that returns the promise of an element or suite of elements to be loaded into the mesh.

An element is the combination of a module and component definition.

#### With a config defining a single mesh element

```javascript
module.exports = {
  configs: {

    'configName1': {
      module: {
        name: 'module-name',
        config: {
          // module's config
        }
      },
      component: {
        name: 'module-name',
        config: {
          // component's config
        }
      }
    }

  }
}
```

#### With a config defining a suite of mesh elements

```javascript
module.exports = {
  configs: {

    // array of elements (suite)

    'configName2': [
      {
        module: {/* with name: and config: (as above) */},
        component: {/* as above */},
      }, 
      {
        module: {},
        component: {},
      }
    ]
  }
}
```


### With a config defining a function.

The function should return the promise of an element config or suite of element configs.

```javascript
var Promise = require('bluebird');

module.exports = {
  configs: {

    'configName3': function(config) {
      return new Promise(function(resolve, reject) {

        // dynamically determine elements to run in the mesh
        // eg. by os.hostname...

      });
    }

  }
}
```

The module definition can be defaulted out of the element if no construction parameters are needed for the module and the component name is resolvable by `require()`.

eg. (happner.js)

```javascript
module.exports = {
  configs: {
    'configName1': {
      component: {
        name: 'module-name',
        config: {
          schema: {},
          web: {},
          events: {},
          data: {},
        }
      }
    }
  }
}
```


### Startup Autoloader

The elements specified in the special config called __'autoload'__ in the `happner.js` file will be automatically loaded into the mesh.

eg. (autoload in happner.js)
```javascript
module.exports = {
  configs: {
    'autoload': [/* elements */]
    // 'autoload': element
  }
}
```

This enables building a near-zero-config mesh simply by installing component node_modules. 
The entire `module.paths` array is recursed for modules that contain a `happner.js` file. This includes nested node_modules. If more than one module by the same name is found, the shallowest wins.

#### Disabling the Autoloader

If this behaviour is undesirable the autoloader can be disabled by defining the environment variable SKIP_AUTO_LOAD, or by setting `autoload: false,` in the meshConfig

eg. 
```javascript
var meshConfig = {
  name: 'meshname',
  autoload: false,
  endpoints: {},
    // ...etc
}
```



### Using Specific Configs
