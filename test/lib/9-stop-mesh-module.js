/**
 * Created by Johan on 4/14/2015.
 * Updated by S.Bishop 6/1/2015.
 */

var moment = require('moment');

module.exports = function (options) {
  return new StopMeshModule1(options);
};

function StopMeshModule1(options) {

  this.start = function ($happn) {

  }

  this.stop = function (done) {
    done();
  }
}
