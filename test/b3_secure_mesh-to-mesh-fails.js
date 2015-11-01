// cannot do mocha test/4-mesh-to-mesh.js --watch
// address already in use for 2nd... runs

var spawn = require('child_process').spawn
  , sep = require('path').sep
  , remote
  , assert = require('assert')
  , mesh
  , Mesh = require('../')

var sep = require('path').sep;
var libFolder = __dirname + sep + 'lib' + sep;

config = {
  name: 'mesh2',
  dataLayer: {
    secure:true,
    port: 3002,
    authTokenSecret: 'a256a2fd43bf441483c5177fc85fd9d3',
    systemSecret: 'mesh',
    log_level: 'info|error|warning'
  },
  endpoints: {
    theFarawayTree: {  // remote mesh node
      config: {
        port: 3001,
        username: '_ADMIN',
        password: 'thispasswordwontwork' // TODO This was necessary, did not default
      }
    }
  },
  modules: {},
  components: {}
};

after(function(done) {
  remote.kill(); 
  mesh.stop(done);
});

describe('secure mesh to mesh fails', function() {
 
  this.timeout(20000);

  it("we can't ride moonface's slippery slip", function(done) {

    var _this = this;

    // spawn remote mesh in another process
    remote = spawn('node', [libFolder + 'b2-first-mesh']);

    remote.stdout.on('data', function(data) {

      // console.log(data.toString());

      if (data.toString().match(/READY/)){
      

        mesh = new Mesh();

        // console.log('starting this one', mesh, config);
        // mesh.initialize(config, function(err) {
        mesh.initialize(config, function(e){

          if (!e) return done(new Error('this should not have been possible'));

          assert(e.toString() == 'AccessDenied: login failed');

          done();

        });
      }

    });
  });

});
