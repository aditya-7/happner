// Uses unit test 2 modules
var should = require('chai').should();
var Mesh = require('../');
var spawn = require('child_process').spawn;
var path = require('path');
var expect = require('expect.js');
var async = require('async');

describe('d6-startup-proxy', function (done) {

  require('benchmarket').start();
  after(require('benchmarket').store());

  this.timeout(120000);

  var configDefault = {
    name: "startupProxiedDefault",
    port: 55000,
    "happner-loader": {
    },
    modules: {
      testComponent: {
        instance: require("./lib/d6_slow_startup_component")
      }
    },
    components: {
      testComponent: {
        name: 'testComponent',
        moduleName: 'testComponent',
        startMethod: "init",
        schema: {
          "exclusive": false,
          "methods": {
            "init": {
              type: "async",
              parameters: [
                {name: "delay", value: 5000}
              ]
            }
          }
        }
      }
    }
  };

  var configDeferredListen = {
    name: "startupProxiedDifferentPort",
    port: 55001,
    "happner-loader": {
    },
    deferListen:true
  };

  var configDifferentPortProgressLog = {
    name: "differentPortProgressLog",
    port: 55002
  };

  var configDifferentPortMeshLog = {
    name: "configDifferentPortMeshLog",
    port: 55003
  };

  var configDifferentPortRedirect = {
    name: "startupProxiedDifferentPort",
    port: 55002,
    "happner-loader": {
      redirect: "/ping"
    }
  };

  var meshes = [];
  var mesh;

  function doRequest(path, callback, port) {

    var request = require('request');

    if (!port) port = 55000;

    if (path[0] != '/')
      path = '/' + path;

    var options = {
      url: 'http://127.0.0.1:' + port.toString() + path,
    };

    request(options, function (error, response, body) {
      callback(body);
    });

  }

  var proxyManager;

 // for manually testing the proxy

  // it('starts the proxy server using the proxy manager, long running', function (done) {
  //
  //   this.timeout(60000);
  //
  //   var ProxyManager = require('../lib/startup/proxy_manager');
  //   proxyManager = new ProxyManager();
  //
  //   proxyManager.start({port: 55000}, function (e) {
  //
  //     if (e) return done(e);
  //
  //     proxyManager.progress('test', 10);
  //     proxyManager.progress('test1', 20);
  //
  //     doRequest('/progress', null, null, function(data){
  //
  //       var prog_data = JSON.parse(data);
  //
  //       expect(prog_data[0].log).to.be('test');
  //       expect(prog_data[0].percentComplete).to.be(10);
  //       expect(prog_data[1].log).to.be('test1');
  //       expect(prog_data[1].percentComplete).to.be(20);
  //
  //
  //
  //       setTimeout(done, 40000);
  //
  //
  //     }, 55000);
  //
  //   })
  //
  // });

  it('starts the loader http server', function (done) {

    var LoaderProgress = require('../lib/startup/loader_progress');
    var loaderProgress = new LoaderProgress({port:55000});

    loaderProgress.listen(function(e){

      if (e) return done(e);

      loaderProgress.progress('test', 10);
      loaderProgress.progress('test1', 20);

      doRequest('/progress', function(data){

        var prog_data = JSON.parse(data);

        expect(prog_data[0].log).to.be('test');
        expect(prog_data[0].progress).to.be(10);
        expect(prog_data[1].log).to.be('test1');
        expect(prog_data[1].progress).to.be(20);

        loaderProgress.stop();

        done();

      }, 55000);

    });
  });

  it('starts the loader http server, fails to start happn, stops the http server and successfully starts happn', function (done) {

    var LoaderProgress = require('../lib/startup/loader_progress');
    var loaderProgress = new LoaderProgress({port:55000});

    loaderProgress.listen(function(e){

      if (e) return done(e);

      Mesh
        .create(configDefault, function (e, created) {

          expect(e).to.not.be(null);
          expect(e.code).to.be("EADDRINUSE");

          loaderProgress.stop();

          Mesh
            .create(configDefault, function (e, created) {

              expect(e).to.be(null);

              doRequest('/ping', function(data){

                expect(data).to.be('pong');
                done();

              }, 55000);


            })
        })
    });
  });

  it('starts a mesh with a deferred listen', function (done) {

      Mesh
        .create(configDeferredListen, function (e, created) {

          doRequest('/ping', function(data){

            expect(data).to.be(undefined);

            created.listen(function(e){

              doRequest('/ping', function(data){

                expect(data).to.be('pong');
                done();

              }, 55001);

            });

          }, 55001);

        });

  });

  it('starts a mesh and checks we have progress logs', function (done) {

    var progressLogs = [];

    var eventId = Mesh.on('startup-progress', function(data){

      progressLogs.push(data);

      if (data.progress == 100){
        console.log(progressLogs.length);
        var offHappened = Mesh.off(eventId);

        expect(offHappened).to.be(true);
        expect(progressLogs.length).to.be(15);
        done();
      }

    });

    Mesh
      .create(configDifferentPortProgressLog, function (e, created) {

        if (e) return done(e);

      });

  });

  it('starts a mesh and checks we have mesh logs', function (done) {

    var meshLogs = [];

    var eventId = Mesh.on('mesh-log', function(data){

      meshLogs.push(data);

      if (data.stack == 'started!'){
        expect(meshLogs.length > 16).to.be(true);
        done();
      }

    });

    Mesh
      .create(configDifferentPortMeshLog, function (e, created) {

        if (e) return done(e);

      });

  });

  //node bin/happner-loader --conf ../test/lib/d6_conf_redirect.json
  //node bin/happner-loader --conf ../test/lib/d6_conf.json

  

  // it('starts the proxy server using the proxy manager', function (done) {
  //
  //   var ProxyManager = require('../lib/startup/proxy_manager');
  //   proxyManager = new ProxyManager();
  //
  //   proxyManager.start({port: 55000}, function (e) {
  //
  //     if (e) return done(e);
  //
  //     proxyManager.progress('test', 10);
  //     proxyManager.progress('test1', 20);
  //
  //     doRequest('/progress', null, null, function(data){
  //
  //       var prog_data = JSON.parse(data);
  //
  //       expect(prog_data[0].log).to.be('test');
  //       expect(prog_data[0].percentComplete).to.be(10);
  //       expect(prog_data[1].log).to.be('test1');
  //       expect(prog_data[1].percentComplete).to.be(20);
  //
  //       done();
  //
  //
  //     }, 55000);
  //
  //   })
  //
  // });
  //
  // it('fails to start a mesh because the proxy is up', function (done) {
  //
  //   Mesh
  //     .create(configDefault, function (e, created) {
  //
  //       expect(e).to.not.be(null);
  //       expect(e.code).to.be("EADDRINUSE");
  //
  //       proxyManager.stop();
  //       setTimeout(done, 5000);
  //
  //     })
  //
  // });
  //
  // it('starts a mesh that takes 5 seconds to start', function (done) {
  //
  //   Mesh
  //     .create(configDefault, function (e, created) {
  //       if (e) return done(e);
  //       mesh = created;
  //       meshes.push(mesh);
  //       done();
  //     })
  //
  // });
  //
  // var otherMesh;
  //
  // it('starts a mesh on a different port', function (done) {
  //
  //   Mesh
  //     .create(configDifferentPort, function (e, created) {
  //       if (e) return done(e);
  //       otherMesh = created;
  //       meshes.push(otherMesh);
  //       done();
  //     })
  //
  // });
  //
  // var redirectMesh;
  //
  // it('starts a mesh on a different port, with a redirect configured', function (done) {
  //
  //   Mesh
  //     .create(configDifferentPortRedirect, function (e, created) {
  //       if (e) return done(e);
  //       redirectMesh = created;
  //       meshes.push(redirectMesh);
  //
  //       done();
  //
  //     })
  //
  // });

  after('kills the proxy and stops the mesh if its running', function (done) {

    if (meshes.length > 0)
    async.eachSeries(meshes, function(stopMesh, cb){
      stopMesh.stop({reconnect: false}, cb);
    }, done);
    else done();


  })

  require('benchmarket').stop();

});








