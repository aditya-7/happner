/**
 * Created by Johan on 4/14/2015.
 * Updated by S.Bishop 6/1/2015.
 */

var moment = require('moment');

module.exports = function (options) {
  return new Component1(options);
};

function Component1(options) {

  if (!options)
    options = {};

  if (!options.maximumPings)
    options.maximumPings = 100;

  this.exposedMethod = function ($happn, message, callback) {

    try {

      ////console.log(options);
      message.pingCount++;
      message.message = "Component1";


      //_this.scope.api.events.component2.exposedMethod(function(e, response)
      if (message.pingCount < options.maximumPings)
        $happn.mesh.exchange.component2.exposedMethod(message, function (e, response) {

        });
      else {
        var timeDiff = moment.utc() - message.timestamp;
        var message = 'Hooray, component ping pong test is over!! ' + message.pingCount + ' pings, elapsed time:' + timeDiff + 'ms';
        $happn.emit('maximum-pings-reached', {m: message}, function (e, response) {

        });
      }

      callback(null, message);

    } catch (e) {
      callback(e);
    }
  }

  this.start = function ($happn) {

    //console.log('starting module1 component');

    if (!$happn)
      throw new Error('This module needs component level scope');

    $happn.mesh.exchange.component2.exposedMethod({
      message: "Component1",
      "timestamp": moment.utc(),
      "pingCount": 0
    }, function (e, response) {
      if (e) return //console.log('call to component2 broke...' + e);

    });
  }

  this.stop = function () {

  }

  this.startData = function ($happn) {
    
    $happn._mesh.data.set('/component1/testStartTime', {timestamp: moment.utc()});
    for (var i = 0; i < options.maximumPings; i++) {
      $happn._mesh.data.set('/component1/testDataCount', {count: i});
    }
  }
}
