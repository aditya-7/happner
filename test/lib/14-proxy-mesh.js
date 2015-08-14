var Mesh = require('../../lib/system/mesh');

var config = {
  name: 'Device1',
  dataLayer: {
    port: 3001,
    authTokenSecret: 'a256a2fd43bf441483c5177fc85fd9d3',
    systemSecret: 'mesh',
    log_level: 'info|error|warning'
  },
  endpoints: {
     cloud: {  // remote mesh node
      config: {
        port: 3002,
        secret: 'mesh',
        host: '127.0.0.1' // TODO This was necessary, did not default
      },
      proxy: {
        registerAs:'Device1Proxied',
        components:'*'
      }
    }
  },
  modules: {
    "module-mesh":{
      path:__dirname + "/14-module-mesh.js",
      constructor:{
        type:"sync",
        parameters:[]
      }
    },
    "module-static":{
      path:__dirname + "/14-module-static.js",
      constructor:{
        type:"sync",
        parameters:[]
      }
    }
  },
  components: {
    "module-mesh":{
      moduleName:"module-mesh",
      schema:{
        "exclusive":false,
        "methods":{
          "getReading": {
            parameters: [
              {name:'parameters',required:false},
              {name:'callback', type:'callback', required:true}
            ]
          }
        }
      }
    },
    "module-static":{
      moduleName:"module-static",
      schema:{
        "exclusive":false
      },
      web: {
        routes: {
          // http://localhost:3001/neptronicUI/...
          "controls":"static"
        }
      }
    }
  }
};

Mesh().initialize(config, function(err) {

  if (err) {
    console.log(err);
    process.exit(err.code || 1);
  }

});
